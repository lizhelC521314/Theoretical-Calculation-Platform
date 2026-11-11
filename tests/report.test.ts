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

  it('PDF 计算书包含计算依据、SI 值、材料来源与假设小节', () => {
    const html = buildPdfHtml(model);
    expect(html).toContain('计算依据');
    expect(html).toContain('标准依据');
    expect(html).toContain('ISO 5011');
    expect(html).toContain('SI 值');
    expect(html).toContain('材料来源');
    expect(html).toContain('适用条件与假设');
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
