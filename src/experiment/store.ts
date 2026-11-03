/**
 * 实验库内存存储（§3 八张表）+ 快照序列化。
 *
 * 桌面版由 Electron 主进程把快照持久化到 ctr-data.json；
 * 浏览器调试与单元测试直接使用本内存实现。
 */
import type {
  AuditEntry, ComparisonRecord, ExperimentRecord, GoldenCase,
  MisfitCase, ModelRegistryEntry, TheoryRun,
} from './types';
import { assertTransit } from './stateMachine';

export interface LabSnapshot {
  experiments: ExperimentRecord[];
  theoryRuns: TheoryRun[];
  comparisons: ComparisonRecord[];
  goldenCases: GoldenCase[];
  misfitCases: MisfitCase[];
  modelRegistry: ModelRegistryEntry[];
  auditLog: AuditEntry[];
}

export const emptySnapshot = (): LabSnapshot => ({
  experiments: [],
  theoryRuns: [],
  comparisons: [],
  goldenCases: [],
  misfitCases: [],
  modelRegistry: [],
  auditLog: [],
});

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++seq).toString(36)}`;

/** 内存仓库：所有写操作同步写 audit_log */
export class LabStore {
  private data: LabSnapshot;

  constructor(snapshot?: LabSnapshot) {
    this.data = snapshot ? { ...emptySnapshot(), ...snapshot } : emptySnapshot();
  }

  snapshot(): LabSnapshot {
    return JSON.parse(JSON.stringify(this.data)) as LabSnapshot;
  }

  audit(entity: string, entityId: string, action: string, before: unknown, after: unknown, actor: string): void {
    this.data.auditLog.push({
      id: nextId('aud'),
      entity, entityId, action,
      beforeJson: before ?? null,
      afterJson: after ?? null,
      actor,
      timestamp: new Date().toISOString(),
    });
  }

  // ---------- experiment ----------
  addExperiment(rec: Omit<ExperimentRecord, 'createdAt'>, actor: string): ExperimentRecord {
    if (this.data.experiments.some((e) => e.reportId === rec.reportId)) {
      throw new Error(`报告 ${rec.reportId} 已入库（同一 report_id 不允许重复）`);
    }
    const full: ExperimentRecord = { ...rec, createdAt: new Date().toISOString() };
    this.data.experiments.push(full);
    this.audit('experiment', full.reportId, 'UPLOADED', null, { status: full.status }, actor);
    return full;
  }

  getExperiment(reportId: string): ExperimentRecord | undefined {
    return this.data.experiments.find((e) => e.reportId === reportId);
  }

  listExperiments(): ExperimentRecord[] {
    return [...this.data.experiments];
  }

  /** 状态迁移（§4，写审计） */
  transit(reportId: string, to: ExperimentRecord['status'], actor: string): ExperimentRecord {
    const rec = this.getExperiment(reportId);
    if (!rec) throw new Error(`报告不存在：${reportId}`);
    const before = rec.status;
    assertTransit(before, to);
    rec.status = to;
    this.audit('experiment', reportId, `${before}→${to}`, { status: before }, { status: to }, actor);
    return rec;
  }

  // ---------- theory_run ----------
  addTheoryRun(run: Omit<TheoryRun, 'id' | 'computedAt'>, actor: string): TheoryRun {
    const full: TheoryRun = { ...run, id: nextId('run'), computedAt: new Date().toISOString() };
    this.data.theoryRuns.push(full);
    this.audit('theory_run', full.id, 'COMPUTE', null, { modelId: full.modelId, reportId: full.reportId }, actor);
    return full;
  }

  // ---------- comparison ----------
  addComparison(rec: Omit<ComparisonRecord, 'id' | 'createdAt' | 'reviewedBy' | 'reviewedAt'>, actor: string): ComparisonRecord {
    const full: ComparisonRecord = {
      ...rec, id: nextId('cmp'), reviewedBy: null, reviewedAt: null, createdAt: new Date().toISOString(),
    };
    this.data.comparisons.push(full);
    this.audit('comparison', full.id, 'COMPARE', null, { verdict: full.verdict, quantity: full.quantity }, actor);
    return full;
  }

  listComparisons(reportId?: string): ComparisonRecord[] {
    return this.data.comparisons.filter((c) => !reportId || c.reportId === reportId);
  }

  // ---------- case_golden / case_misfit ----------
  addGolden(rec: Omit<GoldenCase, 'caseId' | 'createdAt' | 'approvedBy' | 'approvedAt'>, actor: string): GoldenCase {
    const full: GoldenCase = { ...rec, caseId: nextId('gc'), approvedBy: null, approvedAt: null, createdAt: new Date().toISOString() };
    this.data.goldenCases.push(full);
    this.audit('case_golden', full.caseId, 'CREATE', null, { reportId: full.reportId }, actor);
    return full;
  }

  addMisfit(rec: Omit<MisfitCase, 'caseId' | 'createdAt'>, actor: string): MisfitCase {
    const full: MisfitCase = { ...rec, caseId: nextId('mc'), createdAt: new Date().toISOString() };
    this.data.misfitCases.push(full);
    this.audit('case_misfit', full.caseId, 'CREATE', null, { reportId: full.reportId, rootCause: full.rootCause }, actor);
    return full;
  }

  listCases(type: 'golden' | 'misfit'): (GoldenCase | MisfitCase)[] {
    return type === 'golden' ? [...this.data.goldenCases] : [...this.data.misfitCases];
  }

  /** §8：golden 须人工审核后才可作推荐值 */
  approveGolden(caseId: string, reviewer: string): GoldenCase {
    const c = this.data.goldenCases.find((g) => g.caseId === caseId);
    if (!c) throw new Error(`案例不存在：${caseId}`);
    if (c.approvedBy) throw new Error(`案例 ${caseId} 已审核`);
    c.approvedBy = reviewer;
    c.approvedAt = new Date().toISOString();
    this.audit('case_golden', caseId, 'APPROVE', { approvedBy: null }, { approvedBy: reviewer }, reviewer);
    return c;
  }

  // ---------- model_registry ----------
  upsertModel(entry: Omit<ModelRegistryEntry, 'createdAt'>, actor: string): ModelRegistryEntry {
    const idx = this.data.modelRegistry.findIndex((m) => m.modelId === entry.modelId && m.version === entry.version);
    if (idx >= 0) {
      const before = this.data.modelRegistry[idx];
      this.data.modelRegistry[idx] = { ...before, ...entry };
      this.audit('model_registry', entry.modelId, 'UPDATE', before, entry, actor);
      return this.data.modelRegistry[idx];
    }
    const full: ModelRegistryEntry = { ...entry, createdAt: new Date().toISOString() };
    this.data.modelRegistry.push(full);
    this.audit('model_registry', entry.modelId, 'CREATE', null, entry, actor);
    return full;
  }

  setModelStatus(modelId: string, version: string, status: ModelRegistryEntry['status'], actor: string): void {
    const m = this.data.modelRegistry.find((x) => x.modelId === modelId && x.version === version);
    if (!m) throw new Error(`模型版本不存在：${modelId}@${version}`);
    const before = m.status;
    m.status = status;
    this.audit('model_registry', `${modelId}@${version}`, `STATUS→${status}`, { status: before }, { status }, actor);
  }

  listModels(): ModelRegistryEntry[] {
    return [...this.data.modelRegistry];
  }

  // ---------- audit_log ----------
  listAudit(filter?: { entity?: string; entityId?: string }): AuditEntry[] {
    return this.data.auditLog.filter(
      (a) => (!filter?.entity || a.entity === filter.entity) && (!filter?.entityId || a.entityId === filter.entityId),
    );
  }
}
