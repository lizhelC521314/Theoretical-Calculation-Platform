import { describe, expect, it } from 'vitest';
import { buildDocxBase64, buildPdfHtml, buildReportModel } from '../src/report/buildReport';
import type { CtrUser, HistoryEntry, Project } from '../src/api';
import { airFilterElement } from '../src/domains/structure/airFilterElement';
import { toSI } from '../src/formula/units';

const user = { id: 'u1', username: 'zhangsan', displayName: '张三' } as CtrUser;
const project = {
  id: 'p1',
  name: '某车型进气系统',
  product: '空滤器总成',
  version: 'V1.0',
} as Project;

/** 构造一条带 P0/P1 结构化字段的计算记录 */
function makeEntry(): HistoryEntry {
  const f = airFilterElement;
  const si: Record<string, number> = {};
  const values: Record<string, number> = {};
  const units: Record<string, string> = {};
  for (const p of f.inputs) {
    values[p.key] = p.default ?? 0;
    units[p.key] = p.unit;
    si[p.key] = toSI(p.default ?? 0, p.unitGroup, p.unit);
  }
  Object.assign(si, f.benchmarks[0].input);

  return {
    id: 'h1',
    userId: 'u1',
    username: '张三',
    projectId: 'p1',
    formulaId: f.id,
    formulaTitle: f.title,
    formulaVersion: '1.0.0',
    formulaStatus: 'published',
    domain: '结构设计',
    inputs: {
      values,
      units,
      inputsSI: si,
      materialBindings: [{ key: 'K', fieldLabel: '渗透率', material: '滤纸 A · 批号 2026-01 · 25℃' }],
    },
    outputs: f.solve(si),
    note: '',
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  };
}

describe('计算书结构化输出', () => {
  const model = buildReportModel([makeEntry()], project, user);
  const chapter = model.chapters[0];

  it('章节携带公式编号、版本与状态（取记录快照）', () => {
    expect(chapter.formulaId).toBe(airFilterElement.id);
    expect(chapter.formulaVersion).toBe('1.0.0');
    expect(chapter.formulaStatusLabel).toBe('已发布');
  });

  it('章节携带标准依据与适用条件', () => {
    expect(chapter.standardRefs.some((s) => s.code.includes('ISO 5011'))).toBe(true);
    expect(chapter.assumptions.length).toBeGreaterThan(0);
  });

  it('输入/输出同时给出工程单位值与 SI 值', () => {
    const withSi = chapter.inputs.filter((r) => r.si !== '—');
    expect(withSi.length).toBeGreaterThan(0);
    // SI 列必须是可解析的数值（不允许出现 'NaN' 或空串）
    expect(withSi.every((r) => Number.isFinite(Number(r.si)))).toBe(true);
    expect(withSi.some((r) => Math.abs(Number(r.si)) > 0)).toBe(true);
    const out = chapter.outputs.find((o) => o.primary);
    expect(out).toBeDefined();
    expect(out!.si).not.toBe('—');
    expect(Number.isFinite(Number(out!.si))).toBe(true);
  });

  it('材料绑定映射为「参数 → 物性字段 → 材料」', () => {
    expect(chapter.materialBindings.length).toBe(1);
    expect(chapter.materialBindings[0].field).toBe('渗透率');
    expect(chapter.materialBindings[0].material).toContain('滤纸 A');
  });

  it('PDF 计算书包含计算依据、SI 值与材料来源，且不导出「适用条件与假设」', () => {
    const html = buildPdfHtml(model);
    expect(html).toContain('计算依据');
    expect(html).toContain('标准依据');
    expect(html).toContain('ISO 5011');
    expect(html).toContain('SI 值');
    expect(html).toContain('材料来源');
    expect(html).not.toContain('适用条件与假设');
    expect(html).toContain('公式编号');
    expect(html).toContain('v1.0.0（已发布）');
  });

  it('小节序号连续无空号：无材料绑定时材料小节不出现且后续编号顺延', () => {
    const e = makeEntry();
    (e.inputs as Record<string, unknown>).materialBindings = [];
    const m2 = buildReportModel([e], project, user);
    const html = buildPdfHtml(m2);
    expect(html).not.toContain('材料来源');
    // 输入参数之后直接是计算结果，序号连续
    expect(html).toMatch(/4 输入参数/);
    expect(html).toMatch(/5 计算结果/);
  });

  it('旧记录无版本快照时回落到当前库版本，不产生 undefined', () => {
    const e = makeEntry();
    delete (e as { formulaVersion?: string }).formulaVersion;
    delete (e as { formulaStatus?: string }).formulaStatus;
    const m2 = buildReportModel([e], project, user);
    expect(m2.chapters[0].formulaVersion).toBe(airFilterElement.version);
    expect(m2.chapters[0].formulaStatusLabel).toBeDefined();
    expect(buildPdfHtml(m2)).not.toContain('undefined');
  });

  it('Word 计算书可生成（无公式截图时降级为 LaTeX 源码）', async () => {
    const b64 = await buildDocxBase64(model);
    expect(b64.length).toBeGreaterThan(1000);
    // docx 是 zip 容器，base64 解码后应以 PK 开头
    const head = Buffer.from(b64.slice(0, 8), 'base64').toString('latin1');
    expect(head.startsWith('PK')).toBe(true);
  });
});

describe('计算书只导出主公式 + 过滤空结果', () => {
  it('仅保留 label 含「主公式」的 latex；其余辅助式/曲线不导出', () => {
    const e = makeEntry();
    const m = buildReportModel([e], project, user);
    const fxs = m.chapters[0].formulas;
    expect(fxs.length).toBeGreaterThan(0);
    // 全部都应为主公式（如果该公式有主公式标注）
    const hasMain = (airFilterElement.latex ?? []).some((fx) => /主公式/.test(fx.label));
    if (hasMain) {
      expect(fxs.every((fx) => /主公式/.test(fx.label))).toBe(true);
    } else {
      // 回退：保留第一条 latex
      expect(fxs.length).toBe(1);
    }
  });

  it('空 value（"—"）的输出参数被过滤，不在结果表中导出', () => {
    const e = makeEntry();
    // 人为构造：solve 未产出某个 output（key 不在结果中）
    const f = airFilterElement;
    const missingKey = f.outputs[0].key;
    delete (e.outputs as Record<string, number>)[missingKey];
    const m = buildReportModel([e], project, user);
    const out = m.chapters[0].outputs;
    expect(out.some((o) => o.symbol === f.outputs[0].symbol && o.value === '—')).toBe(false);
    // 至少还保留一个有数值的输出（数据本身有值，没被全部过滤）
    expect(out.some((o) => o.value !== '—' && o.value !== '')).toBe(true);
  });

  it('PDF 中「理论公式」小节只出现主公式标签', () => {
    const e = makeEntry();
    const m = buildReportModel([e], project, user);
    const html = buildPdfHtml(m);
    // 不应出现「辅助式」「TL 曲线」等辅助公式标签
    expect(html).not.toMatch(/fx-label">辅助式/);
    expect(html).not.toMatch(/fx-label">TL 曲线/);
  });
});
