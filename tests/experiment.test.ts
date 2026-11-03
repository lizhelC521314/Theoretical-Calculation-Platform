/**
 * 《实验数据入库与模型校准规范》§11 MVP 验收用例 + §3~§10 单元测试
 */
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import {
  LabStore, ingestReport, runComparison, triage, reviewGolden, publishGolden,
  listCases, listAudit, reportStatus, requestCalibration, releaseModel, rollbackModel,
  parseReportJson, parseReportXlsx, parseReportDocx, missingMetadata, qcReport,
  compareScalar, compareCurve, canTransit,
} from '../src/experiment';
import type { ExperimentMeta, MeasurementCurve, ParsedReport } from '../src/experiment';

const ACTOR = 'tester';

/** 合法元数据（15 项必填齐全，校准到期设 2099 保证不随时间过期） */
function goodMeta(reportId: string) {
  return {
    reportId,
    productFamily: '进气系统',
    productModel: 'A01',
    reportVersion: 'V2',
    testStandard: 'ISO 5011',
    testDate: '2026-11-03',
    operator: '李华东',
    lab: 'NVH-Lab',
    sensorIds: ['MIC-01'],
    calibrationDue: '2099-01-01',
    temperature: 20,
    humidity: 45,
    altitude: 0,
    flowRate: 600,
    unitSystem: 'SI',
  };
}

/** TL 曲线：100~1000 Hz 共 12 点（12 点/十倍频程 ≥ 5），重复 3 次且极差 ≤5% */
function tlCurve(base: number[] = [12.1, 15.3, 18, 22, 26, 30.4, 28, 24, 20, 16.5, 13.2, 10.8]): MeasurementCurve {
  const xs = [100, 125, 160, 200, 250, 315, 400, 500, 630, 710, 800, 1000];
  return {
    quantity: 'TL', kind: 'acoustic', unit: 'dB',
    points: xs.map((x, i) => ({ x, y: base[i] })),
    uncertaintyU95: 0.8,
    repeats: xs.map((_, i) => [base[i], base[i] + 0.2, base[i] - 0.2]),
  };
}

function parsedOf(reportId: string, curves: MeasurementCurve[] = [tlCurve()]): ParsedReport {
  return { meta: goodMeta(reportId), curves };
}

function ingestOk(store: LabStore, reportId: string, curves?: MeasurementCurve[]) {
  const r = ingestReport(store, parsedOf(reportId, curves), { path: 'reports/a.docx', hash: 'sha256:x' }, ACTOR);
  expect(r.ok).toBe(true);
  return reportId;
}

// ============================================================
// §11.1 能导入 Excel/Word 报告，解析 ≥10 个元数据字段
// ============================================================
describe('§11.1 报告导入解析（Excel / Word / JSON）', () => {
  const META_ROWS: [string, string][] = [
    ['报告编号', 'EXP-2026-0001'], ['产品族', '进气系统'], ['产品型号', 'A01'], ['报告版本', 'V2'],
    ['试验标准', 'ISO 5011'], ['试验日期', '2026-11-03'], ['试验员', '李华东'], ['实验室', 'NVH-Lab'],
    ['传感器编号', 'MIC-01'], ['校准到期', '2099-01-01'], ['温度', '20'], ['湿度', '45'],
    ['海拔', '0'], ['流量', '600'], ['单位制', 'SI'],
  ];

  it('Excel：元数据表 + 曲线表解析，必填字段 ≥10', async () => {
    const wb = new ExcelJS.Workbook();
    const wsM = wb.addWorksheet('元数据');
    META_ROWS.forEach((r) => wsM.addRow(r));
    const wsC = wb.addWorksheet('曲线');
    wsC.addRow(['测量量', '单位', 'x', '第1次', '第2次', '第3次', 'U95']);
    const c = tlCurve();
    c.points.forEach((p, i) => wsC.addRow(['TL', 'dB', p.x, c.repeats![i][0], c.repeats![i][1], c.repeats![i][2], 0.8]));

    const parsed = await parseReportXlsx(wb);
    expect(missingMetadata(parsed.meta)).toEqual([]);
    expect(Object.keys(parsed.meta).length).toBeGreaterThanOrEqual(10);
    expect(parsed.meta.reportId).toBe('EXP-2026-0001');
    expect(parsed.meta.sensorIds).toEqual(['MIC-01']);
    expect(parsed.curves).toHaveLength(1);
    expect(parsed.curves[0].kind).toBe('acoustic'); // dB 自动判为声学量
    expect(parsed.curves[0].points).toHaveLength(12);
    expect(parsed.curves[0].uncertaintyU95).toBe(0.8);
    expect(parsed.curves[0].repeats![0]).toHaveLength(3);
  });

  it('Word：「字段名：值」逐行解析，必填字段 ≥10', async () => {
    const doc = new Document({
      sections: [{ children: META_ROWS.map(([k, v]) => new Paragraph({ children: [new TextRun(`${k}：${v}`)] })) }],
    });
    const buf = await Packer.toBuffer(doc);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const parsed = await parseReportDocx(ab as ArrayBuffer);
    expect(Object.keys(parsed.meta).filter((k) => (parsed.meta as Record<string, unknown>)[k] !== '').length)
      .toBeGreaterThanOrEqual(10);
    expect(parsed.meta.reportId).toBe('EXP-2026-0001');
    expect(parsed.meta.flowRate).toBe(600);
    expect(missingMetadata(parsed.meta)).toEqual([]);
  });

  it('JSON（§12 格式）解析', () => {
    const json = {
      report_id: 'EXP-2026-0001',
      product: { family: '进气系统', model: 'A01', version: 'V2' },
      test: { standard: 'ISO 5011', date: '2026-11-03', lab: 'NVH-Lab', operator: '李华东', temperature: 20, humidity: 45, altitude: 0, flow_rate: 600 },
      sensors: [{ id: 'MIC-01', calibration_due: '2099-01-01' }],
      curves: [{ quantity: 'TL', unit: 'dB', points: [[100, 12.1], [200, 15.3]], u95: 0.8 }],
      unit_system: 'SI',
    };
    const parsed = parseReportJson(json);
    expect(missingMetadata(parsed.meta)).toEqual([]);
    expect(parsed.curves[0].points).toEqual([{ x: 100, y: 12.1 }, { x: 200, y: 15.3 }]);
    expect(parsed.curves[0].kind).toBe('acoustic');
  });
});

// ============================================================
// §5/§6 元数据校验与 QC
// ============================================================
describe('§5/§6 元数据与 QC 规则', () => {
  it('缺任一元数据 → QC_FAILED 并登记审计', () => {
    const store = new LabStore();
    const meta = { ...goodMeta('EXP-Q1') } as Partial<ExperimentMeta>;
    delete meta.operator;
    const r = ingestReport(store, { meta, curves: [tlCurve()] }, { path: 'a', hash: 'h' }, ACTOR);
    expect(r.ok).toBe(false);
    expect(r.status).toBe('QC_FAILED');
    expect(r.message).toContain('试验员');
    expect(store.getExperiment('EXP-Q1')?.status).toBe('QC_FAILED');
  });

  it('重复性 极差/均值 >5% → FAIL（线性量）', () => {
    const c: MeasurementCurve = {
      quantity: '阻力', kind: 'linear', unit: 'Pa',
      points: [{ x: 100, y: 106.7 }, { x: 200, y: 100 }],
      repeats: [[100, 100, 120], [100, 101, 99]],
    };
    const r = qcReport(goodMeta('X'), [c]);
    expect(r.passed).toBe(false);
    expect(r.issues.some((i) => i.rule === '§6.2' && i.level === 'FAIL')).toBe(true);
  });

  it('传感器校准过期 → FAIL', () => {
    const r = qcReport({ ...goodMeta('X'), calibrationDue: '2020-01-01' }, [tlCurve()]);
    expect(r.passed).toBe(false);
    expect(r.issues.some((i) => i.rule === '§6.4')).toBe(true);
  });

  it('3σ 异常点 → SUSPECT（不删除）；曲线密度 <5 点/十倍频程 → SUSPECT', () => {
    const outlier: MeasurementCurve = {
      quantity: 'TL', kind: 'acoustic', unit: 'dB',
      points: [{ x: 500, y: 1 }],
      repeats: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]],
    };
    const sparse: MeasurementCurve = {
      quantity: '阻力', kind: 'linear', unit: 'Pa',
      points: [{ x: 100, y: 10 }, { x: 500, y: 20 }, { x: 1000, y: 30 }],
    };
    const r = qcReport(goodMeta('X'), [outlier, sparse]);
    expect(r.passed).toBe(true); // SUSPECT 不阻断 QC
    expect(r.suspectQuantities).toContain('TL');
    expect(r.suspectQuantities).toContain('阻力');
  });

  it('单位制非 SI → FAIL', () => {
    const r = qcReport({ ...goodMeta('X'), unitSystem: '工程单位' }, [tlCurve()]);
    expect(r.passed).toBe(false);
  });
});

// ============================================================
// §7 比较判据
// ============================================================
describe('§7 比较判据', () => {
  it('线性标量：限值取 5%·|test| 与 U95 的较大值', () => {
    // test=100, U95=10 → 限值 10；偏差 8 PASS，偏差 12 FAIL
    expect(compareScalar('linear', 108, 100, 10).verdict).toBe('PASS');
    expect(compareScalar('linear', 112, 100, 10).verdict).toBe('FAIL');
    // 无 U95 → 限值 5；偏差 4 PASS，偏差 6 FAIL
    expect(compareScalar('linear', 104, 100).verdict).toBe('PASS');
    expect(compareScalar('linear', 106, 100).verdict).toBe('FAIL');
  });

  it('声学标量：|ΔdB| ≤ max(1.5, U95)，不允许用 5%', () => {
    expect(compareScalar('acoustic', 21.2, 20, 0.8).verdict).toBe('PASS'); // 1.2 ≤ 1.5
    expect(compareScalar('acoustic', 21.8, 20, 2.0).verdict).toBe('PASS'); // 1.8 ≤ U95=2.0
    expect(compareScalar('acoustic', 22.1, 20, 2.0).verdict).toBe('FAIL');
  });

  it('曲线指标：PASS 需全部满足（MAPE/RMSE/峰值频率/带内平均）', () => {
    const test = tlCurve().points;
    const same = compareCurve('acoustic', test, test);
    expect(same.verdict).toBe('PASS');
    expect(same.metrics.rmse).toBeCloseTo(0, 10);
    expect(same.metrics.peakFreqDevPct).toBeCloseTo(0, 10);

    // 整体抬高 5 dB：RMSE=5>2、带内平均=5>1.5 → FAIL
    const shifted = compareCurve('acoustic', test.map((p) => ({ ...p, y: p.y + 5 })), test);
    expect(shifted.verdict).toBe('FAIL');
    expect(shifted.reason).toContain('RMSE');
    expect(shifted.reason).toContain('带内平均');

    // 峰值偏移 25%（315→400 处构造峰值），峰频偏差 (400-315)/315 ≈ 27% > 5% → FAIL
    const model = test.map((p) => ({ ...p }));
    model[5].y = 10; // 原峰值 315 Hz 压低
    model[6].y = 40; // 400 Hz 成新峰
    expect(compareCurve('acoustic', model, test).verdict).toBe('FAIL');
  });
});

// ============================================================
// §4 状态机 + §8 分流 + 审核发布
// ============================================================
describe('§4 状态机与 §8 分流', () => {
  it('完整流水线：UPLOADED→PARSED→QC_PASSED→COMPARED→GOLDEN→REVIEWED→PUBLISHED', () => {
    const store = new LabStore();
    const id = ingestOk(store, 'EXP-P1');
    expect(reportStatus(store, id)).toBe('QC_PASSED');

    const cmp = runComparison(store, {
      reportId: id, modelId: 'intakeTL', modelVersion: '0.1.0',
      inputJson: { D: 0.06 }, curve: { quantity: 'TL', points: tlCurve().points }, actor: ACTOR,
    });
    expect(cmp.ok).toBe(true);
    expect(cmp.comparisons![0].verdict).toBe('PASS');
    expect(reportStatus(store, id)).toBe('COMPARED');

    const t = triage(store, id, ACTOR, { applicableRange: 'Q ≤ 800 m³/h' });
    expect(t.status).toBe('GOLDEN');
    const golden = listCases(store, 'golden')[0] as { caseId: string; approvedBy: string | null };
    expect(golden.approvedBy).toBeNull();

    // 未审核不能发布
    expect(() => publishGolden(store, golden.caseId, ACTOR)).toThrow();
    reviewGolden(store, golden.caseId, 'reviewer');
    expect(reportStatus(store, id)).toBe('REVIEWED');
    publishGolden(store, golden.caseId, ACTOR);
    expect(reportStatus(store, id)).toBe('PUBLISHED');
  });

  it('FAIL → misfit 必须打根因标签', () => {
    const store = new LabStore();
    const id = ingestOk(store, 'EXP-F1');
    const badCurve = tlCurve().points.map((p) => ({ ...p, y: p.y + 10 })); // RMSE=10 dB
    runComparison(store, {
      reportId: id, modelId: 'intakeTL', modelVersion: '0.1.0',
      inputJson: {}, curve: { quantity: 'TL', points: badCurve }, actor: ACTOR,
    });
    expect(triage(store, id, ACTOR).ok).toBe(false); // 未给根因
    const t = triage(store, id, ACTOR, { rootCause: 'model_missing', note: '未考虑穿孔率' });
    expect(t.status).toBe('MISFIT');
    const misfit = listCases(store, 'misfit')[0] as { rootCause: string };
    expect(misfit.rootCause).toBe('model_missing');
  });

  it('SUSPECT → 退回补测，不进案例库', () => {
    const store = new LabStore();
    const suspectCurve: MeasurementCurve = {
      quantity: 'TL', kind: 'acoustic', unit: 'dB',
      points: [{ x: 100, y: 10 }, { x: 200, y: 15 }],
      repeats: [[10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 20], [15, 15, 15]],
    };
    const r = ingestReport(store, parsedOf('EXP-S1', [suspectCurve]), { path: 'a', hash: 'h' }, ACTOR);
    expect(r.ok).toBe(true);
    expect(r.qcIssues!.some((i) => i.level === 'SUSPECT')).toBe(true);

    runComparison(store, {
      reportId: 'EXP-S1', modelId: 'intakeTL', modelVersion: '0.1.0',
      inputJson: {}, scalars: { TL: 12 }, actor: ACTOR,
    });
    const cmp = store.listComparisons('EXP-S1')[0];
    expect(cmp.verdict).toBe('SUSPECT');
    const t = triage(store, 'EXP-S1', ACTOR);
    expect(t.ok).toBe(false);
    expect(t.message).toContain('退回补测');
    expect(listCases(store, 'golden')).toHaveLength(0);
    expect(listCases(store, 'misfit')).toHaveLength(0);
  });

  it('非法迁移被拒绝；QC_FAILED 可退回 UPLOADED 重新上传', () => {
    const store = new LabStore();
    const id = ingestOk(store, 'EXP-T1');
    expect(() => store.transit(id, 'GOLDEN', ACTOR)).toThrow('非法状态迁移');
    expect(canTransit('QC_FAILED', 'UPLOADED')).toBe(true);
    expect(canTransit('PUBLISHED', 'UPLOADED')).toBe(false);
  });
});

// ============================================================
// §11.3 分流抽检 20 条：10 PASS + 10 FAIL，全部正确
// ============================================================
describe('§11.3 golden/misfit 分流抽检 20 条', () => {
  it('10 条 PASS → golden、10 条 FAIL → misfit，正确率 100%', () => {
    const store = new LabStore();
    const lin: MeasurementCurve = { quantity: '阻力', kind: 'linear', unit: 'Pa', points: [{ x: 1, y: 1000 }] };
    let correct = 0;
    for (let i = 0; i < 20; i++) {
      const pass = i % 2 === 0;
      const id = `EXP-M${i}`;
      ingestOk(store, id, [lin]);
      runComparison(store, {
        reportId: id, modelId: 'intakeResistance', modelVersion: '0.1.0',
        inputJson: {}, scalars: { 阻力: pass ? 1020 : 1300 }, actor: ACTOR,
      });
      const t = triage(store, id, ACTOR, pass ? {} : { rootCause: 'unit', note: 'kPa 误作 Pa' });
      const expected = pass ? 'GOLDEN' : 'MISFIT';
      if (t.status === expected) correct++;
    }
    expect(correct).toBe(20);
    expect(listCases(store, 'golden')).toHaveLength(10);
    expect(listCases(store, 'misfit')).toHaveLength(10);
  });
});

// ============================================================
// §11.4 audit_log 可查、可回放
// ============================================================
describe('§11.4 审计日志', () => {
  it('每次状态迁移写 audit_log，可按序回放重建状态', () => {
    const store = new LabStore();
    const id = ingestOk(store, 'EXP-A1');
    runComparison(store, {
      reportId: id, modelId: 'intakeTL', modelVersion: '0.1.0',
      inputJson: {}, curve: { quantity: 'TL', points: tlCurve().points }, actor: ACTOR,
    });
    triage(store, id, ACTOR, {});
    const logs = listAudit(store, 'experiment', id);
    // 回放：从迁移日志重建状态序列
    const transitions = logs.filter((l) => String(afterOf(l)).includes('→'));
    const replayed = transitions.map((l) => String((l.afterJson as { status: string }).status));
    expect(replayed).toEqual(['PARSED', 'QC_PASSED', 'COMPARED', 'GOLDEN']);
    expect(logs.every((l) => l.actor === ACTOR && l.timestamp)).toBe(true);
  });
});

function afterOf(l: { action: string }): string {
  return l.action;
}

// ============================================================
// §11.5 模型发布/回滚 + §9 校准触发（接口桩）
// ============================================================
describe('§11.5 模型发布/回滚与 §9 校准接口', () => {
  it('发布 released → 回滚 retired 旧版/恢复新版', () => {
    const store = new LabStore();
    releaseModel(store, { modelId: 'intakeTL', version: '0.1.0', coefficientsJson: { ke: 0.9 }, calibrationDataIds: [], metricsJson: {} }, ACTOR);
    releaseModel(store, { modelId: 'intakeTL', version: '0.2.0', coefficientsJson: { ke: 0.92 }, calibrationDataIds: ['EXP-P1'], metricsJson: {} }, ACTOR);
    let models = store.listModels();
    expect(models.find((m) => m.version === '0.2.0')?.status).toBe('released');

    rollbackModel(store, 'intakeTL', '0.2.0', '0.1.0', ACTOR);
    models = store.listModels();
    expect(models.find((m) => m.version === '0.2.0')?.status).toBe('retired');
    expect(models.find((m) => m.version === '0.1.0')?.status).toBe('released');
    expect(listAudit(store, 'model_registry').length).toBeGreaterThanOrEqual(4);
  });

  it('校准触发：misfit ≥30 条触发；未达条件返回原因', () => {
    const store = new LabStore();
    const lin: MeasurementCurve = { quantity: '阻力', kind: 'linear', unit: 'Pa', points: [{ x: 1, y: 1000 }] };
    for (let i = 0; i < 30; i++) {
      const id = `EXP-C${i}`;
      ingestOk(store, id, [lin]);
      runComparison(store, { reportId: id, modelId: 'm', modelVersion: '1', inputJson: {}, scalars: { 阻力: 2000 }, actor: ACTOR });
      triage(store, id, ACTOR, { rootCause: 'boundary' });
    }
    const r = requestCalibration(store, '进气系统', { modelId: 'm', whitelist: [{ key: 'ke', min: 0.85, max: 0.95 }], folds: 5 });
    expect(r.shouldCalibrate).toBe(true);
    expect(r.ok).toBe(false); // 算法桩
    expect(r.message).toContain('待实现');

    const empty = new LabStore();
    expect(requestCalibration(empty, '进气系统', { modelId: 'm', whitelist: [], folds: 5 }).shouldCalibrate).toBe(true); // golden 覆盖 <3 也触发
  });
});
