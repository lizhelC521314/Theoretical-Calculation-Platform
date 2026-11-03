/**
 * §9 校准触发与规则（本期留接口：触发判断可用，校准算法桩）
 * §10 接口（REST 对应的本地函数实现）
 */
import type {
  ComparisonRecord, ExperimentRecord, GoldenCase, MisfitCase,
  ModelRegistryEntry, ReportStatus, RootCause, Verdict,
} from './types';
import { LabStore } from './store';
import { assertTransit } from './stateMachine';
import { qcReport, type QcIssue } from './qc';
import { compareCurve, compareScalar, finalVerdict } from './compare';
import { missingMetadataLabels, requireFields } from './validate';
import type { ParsedReport } from './parser';

// ============================================================
// §9 校准（留接口）
// ============================================================

/** 白名单系数（§9.2：只允许校准这些系数，并限制物理范围） */
export interface CalibrationWhitelistEntry {
  key: string;
  min: number;
  max: number;
}

export interface CalibrationRequest {
  modelId: string;
  /** 白名单系数及物理范围 */
  whitelist: CalibrationWhitelistEntry[];
  /** 训练/验证/测试划分按产品族；5 折交叉验证 */
  folds: 5;
}

export interface CalibrationResult {
  ok: boolean;
  message: string;
}

/** §9.1 触发判断：每产品族 misfit ≥30 条，或 golden 覆盖 <3 个工况 */
export function calibrationTrigger(store: LabStore, productFamily: string): { shouldCalibrate: boolean; reason: string } {
  const misfits = (store.listCases('misfit') as MisfitCase[]).filter((c) => {
    const exp = store.getExperiment(c.reportId);
    return exp?.meta.productFamily === productFamily;
  });
  const goldens = (store.listCases('golden') as GoldenCase[]).filter((c) => {
    const exp = store.getExperiment(c.reportId);
    return exp?.meta.productFamily === productFamily;
  });
  const goldenConditions = new Set(goldens.map((g) => store.getExperiment(g.reportId)?.meta.flowRate)).size;
  if (misfits.length >= 30) return { shouldCalibrate: true, reason: `${productFamily} 偏差案例 ${misfits.length} 条 ≥ 30，触发校准` };
  if (goldenConditions < 3) return { shouldCalibrate: true, reason: `${productFamily} golden 覆盖工况 ${goldenConditions} 个 < 3，触发校准` };
  return { shouldCalibrate: false, reason: `${productFamily} misfit ${misfits.length} 条、golden 工况 ${goldenConditions} 个，未达触发条件` };
}

/** §9.3~9.5 校准算法桩：贝叶斯校准 + 模型偏差项，待实现 */
export function calibrateModel(_req: CalibrationRequest): CalibrationResult {
  return { ok: false, message: '接口预留：贝叶斯校准 + 模型偏差项（§9.3）待实现；<10 条偏差样本只做案例参考，不更新公式（§9.5）' };
}

// ============================================================
// §10 接口（REST 对应的本地实现）
// ============================================================

export interface IngestResult {
  ok: boolean;
  reportId?: string;
  status?: ReportStatus;
  qcIssues?: QcIssue[];
  message?: string;
}

/** POST /reports：上传 → 解析 → 元数据校验 → QC（状态机前四态） */
export function ingestReport(store: LabStore, parsed: ParsedReport, file: { path: string; hash: string }, actor: string): IngestResult {
  const metaPartial = parsed.meta;
  const missing = missingMetadataLabels(metaPartial);
  const reportId = String(metaPartial.reportId ?? '') || `EXP-${Date.now()}`;

  if (missing.length > 0) {
    // 元数据缺失：登记为 QC_FAILED（可追溯），不入案例库
    const meta = requireFields(metaPartial);
    store.addExperiment({ reportId, status: 'UPLOADED', meta, curves: parsed.curves, fileHash: file.hash, filePath: file.path, suspectQuantities: [] }, actor);
    store.transit(reportId, 'PARSED', actor);
    store.transit(reportId, 'QC_FAILED', actor);
    return { ok: false, reportId, status: 'QC_FAILED', message: `元数据缺失：${missing.join('、')}` };
  }

  const meta = metaPartial as ExperimentRecord['meta'];
  store.addExperiment({ reportId, status: 'UPLOADED', meta, curves: parsed.curves, fileHash: file.hash, filePath: file.path, suspectQuantities: [] }, actor);
  store.transit(reportId, 'PARSED', actor);

  const qc = qcReport(meta, parsed.curves);
  store.transit(reportId, qc.passed ? 'QC_PASSED' : 'QC_FAILED', actor);
  const rec = store.getExperiment(reportId)!;
  rec.suspectQuantities = qc.suspectQuantities;
  if (!qc.passed) {
    return { ok: false, reportId, status: 'QC_FAILED', qcIssues: qc.issues, message: 'QC 未通过（退回补测）' };
  }
  return { ok: true, reportId, status: 'QC_PASSED', qcIssues: qc.issues };
}

/** GET /reports/{id}/status */
export function reportStatus(store: LabStore, reportId: string): ReportStatus | undefined {
  return store.getExperiment(reportId)?.status;
}

export interface CompareRequest {
  reportId: string;
  modelId: string;
  modelVersion: string;
  inputJson: Record<string, number>;
  /** 标量对比：quantity → 模型值 */
  scalars?: Record<string, number>;
  /** 曲线对比 */
  curve?: { quantity: string; points: { x: number; y: number }[] };
  actor: string;
}

/** POST /comparisons：写 theory_run + 逐量对比 + §8 分流 */
export function runComparison(store: LabStore, req: CompareRequest): { ok: boolean; comparisons?: ComparisonRecord[]; message?: string } {
  const exp = store.getExperiment(req.reportId);
  if (!exp) return { ok: false, message: `报告不存在：${req.reportId}` };
  assertTransit(exp.status, 'COMPARED');

  store.addTheoryRun({
    modelId: req.modelId, modelVersion: req.modelVersion, reportId: req.reportId,
    inputJson: req.inputJson,
    outputJson: { scalars: req.scalars ?? {}, curve: req.curve },
  }, req.actor);

  const results: ComparisonRecord[] = [];
  for (const c of exp.curves) {
    const suspect = exp.suspectQuantities.includes(c.quantity);
    let base;
    const modelCurve = req.curve && req.curve.quantity === c.quantity ? req.curve.points : undefined;
    if (modelCurve && c.points.length >= 2) {
      base = compareCurve(c.kind, modelCurve, c.points);
    } else {
      const modelValue = req.scalars?.[c.quantity];
      if (modelValue === undefined) continue;
      const testValue = c.points.reduce((a, p) => a + p.y, 0) / c.points.length;
      base = compareScalar(c.kind, modelValue, testValue, c.uncertaintyU95);
    }
    const v = finalVerdict(suspect, base);
    results.push(store.addComparison({
      reportId: req.reportId, modelId: req.modelId, quantity: c.quantity, kind: c.kind,
      metrics: v.metrics, verdict: v.verdict, reason: v.reason,
    }, req.actor));
  }
  store.transit(req.reportId, 'COMPARED', req.actor);
  return { ok: true, comparisons: results };
}

/** §8 分流：PASS → golden；FAIL → misfit（必须打根因标签）；SUSPECT → 退回补测 */
export function triage(
  store: LabStore,
  reportId: string,
  actor: string,
  opts: { applicableRange?: string; rootCause?: RootCause; note?: string } = {},
): { ok: boolean; status?: ReportStatus; message?: string } {
  const exp = store.getExperiment(reportId);
  if (!exp) return { ok: false, message: `报告不存在：${reportId}` };
  // MISFIT 允许补充根因后重回 COMPARED 再分流
  if (exp.status === 'MISFIT') store.transit(reportId, 'COMPARED', actor);
  if (exp.status !== 'COMPARED') return { ok: false, status: exp.status, message: `当前状态 ${exp.status} 不能分流（需先比较）` };
  const cmps = store.listComparisons(reportId);
  if (cmps.length === 0) return { ok: false, message: '尚无比较结果' };

  if (cmps.some((c) => c.verdict === 'SUSPECT')) {
    return { ok: false, status: exp.status, message: '存在 SUSPECT 量：退回补测，禁止进入校准集' };
  }
  if (cmps.every((c) => c.verdict === 'PASS')) {
    store.transit(reportId, 'GOLDEN', actor);
    store.addGolden({ reportId, modelId: cmps[0].modelId, applicableRange: opts.applicableRange ?? '' }, actor);
    return { ok: true, status: 'GOLDEN' };
  }
  if (!opts.rootCause) return { ok: false, message: 'FAIL 必须打根因标签（边界条件不符/测量误差/模型缺项/单位错误）' };
  store.transit(reportId, 'MISFIT', actor);
  store.addMisfit({ reportId, modelId: cmps[0].modelId, rootCause: opts.rootCause, note: opts.note ?? '' }, actor);
  return { ok: true, status: 'MISFIT' };
}

/** golden 人工审核 → REVIEWED → PUBLISHED */
export function reviewGolden(store: LabStore, caseId: string, reviewer: string): void {
  const c = store.approveGolden(caseId, reviewer);
  const exp = store.getExperiment(c.reportId);
  if (exp?.status === 'GOLDEN') store.transit(c.reportId, 'REVIEWED', reviewer);
}

export function publishGolden(store: LabStore, caseId: string, actor: string): void {
  const c = (store.listCases('golden') as GoldenCase[]).find((g) => g.caseId === caseId);
  if (!c) throw new Error(`案例不存在：${caseId}`);
  if (!c.approvedBy) throw new Error('未审核的案例不能发布');
  store.transit(c.reportId, 'PUBLISHED', actor);
}

/** GET /cases?type=golden|misfit */
export function listCases(store: LabStore, type: 'golden' | 'misfit'): (GoldenCase | MisfitCase)[] {
  return store.listCases(type);
}

/** POST /models/{id}/calibrate：触发判断 + 桩 */
export function requestCalibration(store: LabStore, productFamily: string, req: CalibrationRequest): CalibrationResult & { shouldCalibrate: boolean } {
  const t = calibrationTrigger(store, productFamily);
  if (!t.shouldCalibrate) return { ok: false, shouldCalibrate: false, message: t.reason };
  return { ...calibrateModel(req), shouldCalibrate: true };
}

/** 模型发布/回滚（§9.4：新模型不劣于旧版本才发布；保留旧版本可回滚） */
export function releaseModel(store: LabStore, entry: Omit<ModelRegistryEntry, 'createdAt' | 'status'>, actor: string): void {
  store.upsertModel({ ...entry, status: 'draft' }, actor);
  store.setModelStatus(entry.modelId, entry.version, 'released', actor);
}

export function rollbackModel(store: LabStore, modelId: string, fromVersion: string, toVersion: string, actor: string): void {
  store.setModelStatus(modelId, fromVersion, 'retired', actor);
  store.setModelStatus(modelId, toVersion, 'released', actor);
}

/** GET /audit */
export function listAudit(store: LabStore, entity?: string, entityId?: string) {
  return store.listAudit({ entity, entityId });
}

export type { Verdict };
