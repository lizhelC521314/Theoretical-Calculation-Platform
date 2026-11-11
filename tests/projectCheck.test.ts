import { describe, expect, it } from 'vitest';
import {
  buildCheckPackage,
  checkPackageCsv,
  checkRecord,
  compareVersions,
  type CheckableRecord,
} from '../src/formula/projectCheck';
import { listFormulas } from '../src/formula/registry';
import { airFilterElement } from '../src/domains/structure/airFilterElement';
import { toSI } from '../src/formula/units';

/** 用默认输入 + 基准算例构造一条「计算记录」 */
function makeRecord(over: Partial<CheckableRecord> = {}): CheckableRecord {
  const f = airFilterElement;
  const si: Record<string, number> = {};
  for (const p of f.inputs) si[p.key] = toSI(p.default ?? 0, p.unitGroup, p.unit);
  Object.assign(si, f.benchmarks[0].input);
  const outputs = f.solve(si);
  return {
    id: 'r1',
    formulaId: f.id,
    formulaTitle: f.title,
    formulaVersion: f.version,
    formulaStatus: f.status,
    inputs: { inputsSI: si },
    outputs,
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    ...over,
  };
}

describe('项目校核包', () => {
  const formulas = listFormulas();

  it('版本号比较按段数值大小，非标准格式退化为字符串比较', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('beta', 'beta')).toBe(0);
  });

  it('记录与当前实现一致时结论为「复算一致」', () => {
    const it = checkRecord(makeRecord(), airFilterElement);
    expect(it.recomputed).toBe(true);
    expect(it.status).toBe('ok');
    expect(it.versionState).toBe('same');
    expect(it.maxRelDiff).toBeLessThan(1e-12);
    expect(it.compliance).toBe('undetermined');
    expect(it.diffs.length).toBeGreaterThan(0);
  });

  it('记录版本低于当前版本时标记「公式升版」', () => {
    const rec = makeRecord({ formulaVersion: '0.9.0' });
    const it = checkRecord(rec, airFilterElement);
    expect(it.versionState).toBe('updated');
    expect(it.status).toBe('stale');
    expect(it.messages.some((m) => m.includes('升版'))).toBe(true);
  });

  it('记录版本高于当前库时给出回退提示', () => {
    const it = checkRecord(makeRecord({ formulaVersion: '9.0.0' }), airFilterElement);
    expect(it.versionState).toBe('updated');
    expect(it.messages.some((m) => m.includes('回退'))).toBe(true);
  });

  it('输出与复算不符时标记「复算不符」并给出偏差', () => {
    const rec = makeRecord();
    const outputs = { ...(rec.outputs as Record<string, number>) };
    outputs.dp = outputs.dp * 1.2;
    const it = checkRecord({ ...rec, outputs }, airFilterElement);
    expect(it.status).toBe('changed');
    expect(it.maxRelDiff).toBeGreaterThan(0.1);
    const dp = it.diffs.find((d) => d.key === 'dp')!;
    expect(dp.rel).toBeCloseTo(0.2 / 1.2, 6);
  });

  it('容差放宽后同样的偏差不再判为不符', () => {
    const rec = makeRecord();
    const outputs = { ...(rec.outputs as Record<string, number>) };
    outputs.dp = outputs.dp * 1.0001;
    const strict = checkRecord({ ...rec, outputs }, airFilterElement, [], 1e-9);
    const loose = checkRecord({ ...rec, outputs }, airFilterElement, [], 0.01);
    expect(strict.status).toBe('changed');
    expect(loose.status).toBe('ok');
  });

  it('公式已移出公式库时无法复算', () => {
    const it = checkRecord(makeRecord(), undefined);
    expect(it.versionState).toBe('removed');
    expect(it.recomputed).toBe(false);
    expect(it.status).toBe('failed');
    expect(it.messages[0]).toContain('不在当前公式库');
  });

  it('缺少 SI 输入快照（旧数据）时无法复算', () => {
    const it = checkRecord(makeRecord({ inputs: { values: { a: 1 } } }), airFilterElement);
    expect(it.recomputed).toBe(false);
    expect(it.status).toBe('failed');
    expect(it.messages.some((m) => m.includes('SI 输入快照'))).toBe(true);
  });

  it('按准则判定合规：未满足时给出实际值与限值', () => {
    const rec = makeRecord();
    const dp = (rec.outputs as Record<string, number>).dp;
    const pass = checkRecord(rec, airFilterElement, [
      { formulaId: airFilterElement.id, output: 'dp', op: 'le', value: dp * 1.1 },
    ]);
    expect(pass.compliance).toBe('pass');
    expect(pass.violations.length).toBe(0);

    const fail = checkRecord(rec, airFilterElement, [
      { formulaId: airFilterElement.id, output: 'dp', op: 'le', value: dp * 0.9 },
    ]);
    expect(fail.compliance).toBe('fail');
    expect(fail.violations[0]).toContain('要求');
  });

  it('准则只对同一公式生效，其他公式的记录保持「未判定」', () => {
    const rec = makeRecord();
    const it = checkRecord(rec, airFilterElement, [
      { formulaId: 'structure.intakeHoseFull', output: 'dp', op: 'le', value: 1 },
    ]);
    expect(it.compliance).toBe('undetermined');
  });

  it('between 准则按上下限判定，且上下限顺序不影响结果', () => {
    const rec = makeRecord();
    const dp = (rec.outputs as Record<string, number>).dp;
    const ok = checkRecord(rec, airFilterElement, [
      { formulaId: airFilterElement.id, output: 'dp', op: 'between', value: dp * 1.1, value2: dp * 0.9 },
    ]);
    expect(ok.compliance).toBe('pass');
    const bad = checkRecord(rec, airFilterElement, [
      { formulaId: airFilterElement.id, output: 'dp', op: 'between', value: dp * 1.1, value2: dp * 1.2 },
    ]);
    expect(bad.compliance).toBe('fail');
  });

  it('批量校核汇总正确，可导出 CSV', () => {
    const good = makeRecord();
    const stale = makeRecord({ id: 'r2', formulaVersion: '0.1.0' });
    const broken = makeRecord({ id: 'r3', formulaId: 'not.exists' });
    const res = buildCheckPackage(
      [good, stale, broken],
      formulas,
      [{ formulaId: airFilterElement.id, output: 'dp', op: 'le', value: 1e9 }],
    );
    expect(res.summary.total).toBe(3);
    expect(res.summary.ok).toBe(1);
    expect(res.summary.stale).toBe(1);
    expect(res.summary.failed).toBe(1);
    expect(res.summary.pass).toBe(2);
    expect(res.summary.undetermined).toBe(1);

    const csv = checkPackageCsv(
      res,
      { projectName: '测试项目', user: '张三', time: '2026-01-01 10:00' },
      [{ formulaId: airFilterElement.id, output: 'dp', op: 'le', value: 1e9 }],
      formulas,
    );
    expect(csv).toContain('项目校核包,测试项目');
    expect(csv).toContain('判定准则');
    expect(csv).toContain('校核明细');
    // 每条记录一行（表头之外）
    const detail = csv.split('\n').slice(csv.split('\n').findIndex((l) => l === '校核明细') + 2);
    expect(detail.filter((l) => l.trim()).length).toBe(3);
  });
});
