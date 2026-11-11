import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { attachCalcRef, buildCalcParams, buildCalcRef, modelOptions } from '../src/product/calcRef';
import type { HistoryEntry } from '../src/api';
import type { OutputSpec } from '../src/formula/types';
import { runGate } from '../src/product/gate';
import { analyzeImpact } from '../src/product/impact';
import { findSimilarModels, similarity } from '../src/product/similar';
import { createBlankTemplate, modelFromTemplate, templateFromModel, templateIssues } from '../src/product/template';
import { createVariant } from '../src/product/variant';
import { designArchiveFileName } from '../src/report/db';
import { buildDesignArchiveBase64 } from '../src/product/archiveWorkbook';
import {
  createFamily,
  createModel,
  createParam,
  createRequirement,
  meetsRequirement,
  paramInRange,
  requirementMargin,
  type Baseline,
  type ProductModel,
} from '../src/product/types';

function fullModel(overrides: Partial<ProductModel> = {}): ProductModel {
  return createModel('fam-1', {
    id: 'AF-2026-001',
    name: '空气滤清器总成',
    customer: '长安',
    owner: '张工',
    standards: ['QC/T 32-2017'],
    requirements: [
      createRequirement({ name: '初始压降', target: 0.5, unit: 'kPa', direction: 'max', source: 'QC/T 32', verify: 'calc' }),
    ],
    params: [createParam({ key: 'D', label: '滤芯外径', value: 200, unit: 'mm', source: 'calc', basis: '空滤公式 v1.0.0' })],
    calcRefs: [
      {
        id: 'c1',
        historyId: 'h1',
        formulaId: 'structure.airFilter.element',
        formulaTitle: '空气滤清器滤芯设计',
        formulaVersion: '1.0.0',
        createdAt: new Date().toISOString(),
        outputs: { dp: 410 },
        conclusion: 'pass',
        note: '',
      },
    ],
    ...overrides,
  });
}

describe('产品定义库·发布门禁', () => {
  it('空白型号无法发布，命中需求/参数/标准三类错误', () => {
    const gate = runGate(createModel('fam-1'));
    expect(gate.ok).toBe(false);
    const scopes = new Set(gate.issues.filter((i) => i.level === 'error').map((i) => i.scope));
    expect(scopes.has('requirement')).toBe(true);
    expect(scopes.has('param')).toBe(true);
    expect(scopes.has('standard')).toBe(true);
  });

  it('完整型号门禁通过', () => {
    const gate = runGate(fullModel());
    expect(gate.errors).toBe(0);
    expect(gate.ok).toBe(true);
  });

  it('参数越界与计算不满足都会拦截发布', () => {
    const gate = runGate(
      fullModel({
        params: [createParam({ key: 'p', label: '褶距', value: 12, unit: 'mm', min: 3, max: 8, source: 'calc' })],
        calcRefs: [
          {
            id: 'c2',
            historyId: 'h2',
            formulaId: 'structure.airFilter.element',
            formulaTitle: '空气滤清器滤芯设计',
            formulaVersion: '1.0.0',
            createdAt: new Date().toISOString(),
            outputs: { dp: 900 },
            conclusion: 'fail',
            note: '',
          },
        ],
      }),
    );
    expect(gate.ok).toBe(false);
    expect(gate.issues.some((i) => i.message.includes('超出允许范围'))).toBe(true);
    expect(gate.issues.some((i) => i.message.includes('不满足'))).toBe(true);
  });

  it('已停产型号不可发布', () => {
    const gate = runGate(fullModel({ status: 'obsolete' }));
    expect(gate.ok).toBe(false);
  });

  it('缺少计算记录时，计算类需求报错', () => {
    const gate = runGate(fullModel({ calcRefs: [] }));
    expect(gate.ok).toBe(false);
    expect(gate.issues.some((i) => i.message.includes('尚未关联任何计算记录'))).toBe(true);
  });
});

describe('产品定义库·计算记录关联', () => {
  const hist: HistoryEntry = {
    id: 'h-9',
    userId: 'u1',
    username: '张工',
    projectId: null,
    formulaId: 'structure.airFilter.element',
    formulaTitle: '空气滤清器滤芯设计',
    formulaVersion: '1.0.0',
    formulaStatus: 'published',
    domain: '结构',
    inputs: {},
    outputs: { dp: 410, Am: 1.2, note: '不计入' },
    note: '',
    createdAt: '2026-11-11T02:00:00.000Z',
  };

  it('快照只保留数值型输出并记录公式版本', () => {
    const ref = buildCalcRef(hist);
    expect(ref.outputs).toEqual({ dp: 410, Am: 1.2 });
    expect(ref.formulaVersion).toBe('1.0.0');
    expect(ref.conclusion).toBe('pending');
  });

  it('输出补成参数时跳过已存在的键，并按公式单位换算', () => {
    const ref = buildCalcRef(hist);
    const specs: OutputSpec[] = [
      { key: 'dp', label: '滤芯总压降', symbol: 'Δp', unit: 'Pa', unitGroup: 'pressure' },
      { key: 'Am', label: '滤材面积', symbol: 'Am', unit: 'm²' },
    ];
    const params = buildCalcParams(specs, ref, ['Am']);
    expect(params).toHaveLength(1);
    expect(params[0].key).toBe('dp');
    expect(params[0].source).toBe('calc');
    expect(params[0].unit).toBe('kPa');
    expect(params[0].value).toBeCloseTo(0.41, 6);
    expect(params[0].basis).toContain('v1.0.0');
  });

  it('关联后记录排在型号计算记录最前，参数追加在末尾', () => {
    const model = fullModel();
    const ref = buildCalcRef(hist);
    const params = buildCalcParams([], ref, []);
    const next = attachCalcRef(model, ref, params);
    expect(next.calcRefs[0].historyId).toBe('h-9');
    expect(next.calcRefs).toHaveLength(2);
    expect(next.params.length).toBe(model.params.length);
  });

  it('型号选择器带上产品族名称', () => {
    const store = {
      families: [{ ...createFamily({ name: '空气滤清器' }), id: 'fam-1' }],
      models: [createModel('fam-1', { id: 'AF-1', name: '圆柱式' })],
      templates: [],
    };
    const opts = modelOptions(store);
    expect(opts).toHaveLength(1);
    expect(opts[0].familyName).toBe('空气滤清器');
    expect(modelOptions(null)).toEqual([]);
  });
});

describe('产品定义库·需求校核', () => {
  it('不大于 / 不小于两种方向的达成判断', () => {
    const max = createRequirement({ target: 0.5, direction: 'max' });
    const min = createRequirement({ target: 99.5, direction: 'min' });
    expect(meetsRequirement(max, 0.41)).toBe('pass');
    expect(meetsRequirement(max, 0.52)).toBe('fail');
    expect(meetsRequirement(min, 99.7)).toBe('pass');
    expect(meetsRequirement(min, 99.1)).toBe('fail');
    expect(meetsRequirement(max, null)).toBe('unknown');
  });

  it('裕度为正表示有余量，为负表示超限', () => {
    const req = createRequirement({ target: 0.5, direction: 'max' });
    expect(requirementMargin(req, 0.41)!).toBeCloseTo(18, 5);
    expect(requirementMargin(req, 0.6)!).toBeCloseTo(-20, 5);
    expect(requirementMargin(req, null)).toBeNull();
  });

  it('参数上下限校验', () => {
    expect(paramInRange(createParam({ value: 5, min: 3, max: 8 }))).toBe(true);
    expect(paramInRange(createParam({ value: 2, min: 3, max: 8 }))).toBe(false);
    expect(paramInRange(createParam({ value: 9, min: 3, max: 8 }))).toBe(false);
    expect(paramInRange(createParam({ value: null, min: 3, max: 8 }))).toBe(true);
  });
});

describe('产品定义库·相似型号检索', () => {
  const base = fullModel();

  it('同族且需求参数重合的型号排在前面，完全无关的型号被过滤', () => {
    const near = fullModel({ id: 'AF-2026-002', name: '同族改进型' });
    const unrelated = createModel('fam-9', {
      id: 'WP-001',
      name: '冷却水泵',
      standards: ['QC/T 1017'],
      requirements: [createRequirement({ name: '流量', target: 5, unit: 'L/min' })],
      params: [createParam({ key: 'Q', label: '流量', value: 5, unit: 'L/min' })],
    });
    const results = findSimilarModels([base, near, unrelated], base);
    expect(results[0].model.id).toBe('AF-2026-002');
    expect(results.some((r) => r.model.id === 'WP-001')).toBe(false);
  });

  it('同单位才给出目标值偏差，单位不同时留空', () => {
    const sameUnit = fullModel({
      id: 'AF-2026-003',
      requirements: [createRequirement({ name: '初始压降', target: 0.6, unit: 'kPa', direction: 'max' })],
    });
    const otherUnit = fullModel({
      id: 'AF-2026-004',
      requirements: [createRequirement({ name: '初始压降', target: 600, unit: 'Pa', direction: 'max' })],
    });
    expect(similarity(base, sameUnit).requirements[0].deltaPct!).toBeCloseTo(20, 5);
    expect(similarity(base, otherUnit).requirements[0].deltaPct).toBeNull();
  });

  it('仅同族检索时排除跨族型号', () => {
    const other = createModel('fam-2', {
      id: 'AF-X',
      name: '异族型号',
      standards: ['QC/T 32-2017'],
      requirements: [createRequirement({ name: '初始压降', target: 0.5, unit: 'kPa', direction: 'max' })],
    });
    const all = findSimilarModels([base, other], base);
    const same = findSimilarModels([base, other], base, { sameFamilyOnly: true });
    expect(all).toHaveLength(1);
    expect(same).toHaveLength(0);
  });
});

describe('产品定义库·变型模板', () => {
  it('复制需求与参数并重新生成主键，状态回草稿并记录来源', () => {
    const src = fullModel();
    const v = createVariant(src, { id: 'AF-2026-002' });
    expect(v.id).toBe('AF-2026-002');
    expect(v.derivedFrom).toBe(src.id);
    expect(v.status).toBe('draft');
    expect(v.baselines).toHaveLength(0);
    expect(v.requirements).toHaveLength(src.requirements.length);
    expect(v.requirements[0].id).not.toBe(src.requirements[0].id);
    expect(v.params[0].id).not.toBe(src.params[0].id);
    expect(v.params[0].value).toBe(200);
    expect(v.standards).toEqual(src.standards);
  });

  it('清空取值且不复制标准与计算记录时对应为空', () => {
    const src = fullModel();
    const v = createVariant(src, {
      id: 'AF-2026-003',
      keepValues: false,
      copyStandards: false,
      copyCalcRefs: false,
    });
    expect(v.params[0].value).toBeNull();
    expect(v.standards).toEqual([]);
    expect(v.calcRefs).toEqual([]);
  });

  it('带上计算记录时保留输出快照但生成新的记录主键', () => {
    const src = fullModel();
    const v = createVariant(src, { id: 'AF-2026-004', copyCalcRefs: true });
    expect(v.calcRefs).toHaveLength(1);
    expect(v.calcRefs[0].id).not.toBe(src.calcRefs[0].id);
    expect(v.calcRefs[0].outputs).toEqual({ dp: 410 });
  });
});

describe('产品定义库·变更影响分析', () => {
  const base = fullModel();

  it('反查共用标准、同名需求与同参数键，并给出差异说明', () => {
    const cand = fullModel({
      id: 'AF-2026-002',
      requirements: [createRequirement({ name: '初始压降', target: 0.6, unit: 'kPa', direction: 'max' })],
      params: [createParam({ key: 'D', label: '滤芯外径', value: 220, unit: 'mm', source: 'calc' })],
    });
    const [item] = analyzeImpact([base, cand], base);
    expect(item.model.id).toBe('AF-2026-002');
    const kinds = item.hits.map((h) => h.kind);
    expect(kinds).toContain('standard');
    expect(kinds).toContain('requirement');
    expect(kinds).toContain('param');
    expect(item.hits.find((h) => h.kind === 'requirement')!.detail).toBe('目标 0.5kPa → 0.6kPa');
    expect(item.hits.find((h) => h.kind === 'param')!.detail).toBe('200mm → 220mm');
  });

  it('下游变型单独标记，命中更多的型号排在前面', () => {
    const variant = fullModel({
      id: 'AF-2026-003',
      standards: [],
      requirements: [],
      params: [],
      derivedFrom: 'AF-2026-001',
    });
    const heavy = fullModel({ id: 'AF-2026-004' });
    const items = analyzeImpact([base, variant, heavy], base);
    expect(items[0].model.id).toBe('AF-2026-004');
    const v = items.find((i) => i.model.id === 'AF-2026-003')!;
    expect(v.hits.map((h) => h.kind)).toEqual(['variant']);
  });

  it('无引用关系时返回空结果', () => {
    const other = createModel('fam-2', {
      id: 'WP-1',
      standards: ['QC/T 1017'],
      requirements: [createRequirement({ name: '流量' })],
      params: [createParam({ key: 'Q' })],
    });
    expect(analyzeImpact([base, other], base)).toEqual([]);
  });
});

describe('产品定义库·型号模板库', () => {
  it('从型号提炼模板：保留需求目标与标准，清空参数取值', () => {
    const src = fullModel();
    const tpl = templateFromModel(src, { name: '空滤骨架', system: '进气系统' });
    expect(tpl.name).toBe('空滤骨架');
    expect(tpl.system).toBe('进气系统');
    expect(tpl.sourceModelId).toBe(src.id);
    expect(tpl.requirements[0].target).toBe(0.5);
    expect(tpl.requirements[0].id).not.toBe(src.requirements[0].id);
    expect(tpl.params[0].value).toBeNull();
    expect(tpl.standards).toEqual(src.standards);
  });

  it('套用模板生成草稿型号：新主键、取值留空、来源型号可追溯', () => {
    const src = fullModel();
    const tpl = templateFromModel(src, { name: '空滤骨架' });
    const made = modelFromTemplate(tpl, 'fam-2', { id: 'AF-2027-001', name: '空滤新号', owner: '李工' });
    expect(made.id).toBe('AF-2027-001');
    expect(made.familyId).toBe('fam-2');
    expect(made.status).toBe('draft');
    expect(made.derivedFrom).toBe(src.id);
    expect(made.params[0].value).toBeNull();
    expect(made.params[0].id).not.toBe(tpl.params[0].id);
    expect(made.requirements[0].target).toBe(0.5);
    expect(made.calcRefs).toEqual([]);
    expect(made.baselines).toEqual([]);
    expect(runGate(made).ok).toBe(false);
  });

  it('模板名称留空时按来源型号兜底', () => {
    const src = fullModel();
    const tpl = templateFromModel(src, { name: '   ' });
    expect(tpl.name).toBe('空气滤清器总成 模板');
  });

  it('空白模板可手工搭建，未填必填项时给出提示', () => {
    const tpl = createBlankTemplate();
    expect(tpl.requirements).toEqual([]);
    expect(tpl.sourceModelId).toBeNull();
    expect(templateIssues(tpl)).toEqual(['模板名称不能为空', '至少需要一条需求或一个关键参数']);

    tpl.name = '空滤骨架';
    tpl.requirements.push(createRequirement({ name: '初始压降', target: 0.5, unit: 'kPa' }));
    tpl.params.push(createParam({ key: 'D', label: '滤芯外径', unit: 'mm', min: 180, max: 240 }));
    expect(templateIssues(tpl)).toEqual([]);
  });

  it('参数键为空或重复时拦截保存', () => {
    const tpl = createBlankTemplate();
    tpl.name = '空滤骨架';
    tpl.params.push(createParam({ key: 'D', label: '外径' }), createParam({ key: 'D', label: '高度' }));
    expect(templateIssues(tpl)).toEqual(['参数键重复']);
    tpl.params[1].key = '  ';
    expect(templateIssues(tpl)).toEqual(['参数键不能为空']);
  });

  it('手工搭建的模板可直接套用生成型号', () => {
    const tpl = createBlankTemplate();
    tpl.name = '空滤骨架';
    tpl.standards = ['QC/T 32-2017'];
    tpl.requirements.push(createRequirement({ name: '初始压降', target: 0.5, unit: 'kPa' }));
    tpl.params.push(createParam({ key: 'D', label: '滤芯外径', unit: 'mm', min: 180, max: 240 }));
    const made = modelFromTemplate(tpl, 'fam-1', { id: 'AF-2028-001' });
    expect(made.requirements[0].target).toBe(0.5);
    expect(made.params[0].value).toBeNull();
    expect(made.params[0].min).toBe(180);
    expect(made.standards).toEqual(['QC/T 32-2017']);
    expect(made.derivedFrom).toBeNull();
  });
});

describe('产品定义库·设计档案归档命名', () => {
  it('按「产品族+型号P/N+版本+日期」生成文件名', () => {
    const name = designArchiveFileName('空气滤清器', 'AF-2026-001', 'V2.0', '2026-11-11');
    expect(name).toBe('空气滤清器+AF-2026-001+V2.0+20261111.xlsx');
  });

  it('非法字符与空值兜底，保证可写入共享目录', () => {
    const name = designArchiveFileName('', 'AF/2026:001', '');
    expect(name.startsWith('未归类+AF2026001+V0+')).toBe(true);
    expect(/[\\/:*?"<>|]/.test(name)).toBe(false);
  });
});

describe('产品定义库·设计档案导出', () => {
  const buildSample = () => {
    const fam = createFamily({ code: 'AF', name: '空气滤清器' });
    const model = createModel(fam.id, {
      id: 'AF-2026-001',
      name: '空气滤清器总成',
      customer: 'A 客户',
      owner: '张三',
      status: 'released',
      standards: ['QC/T 970'],
    });
    model.requirements = [
      createRequirement({
        name: '进气阻力',
        target: 0.8,
        unit: 'kPa',
        direction: 'max',
        priority: 'CC',
        source: '客户要求',
        verify: 'calc',
      }),
    ];
    model.params = [
      createParam({
        key: 'dP',
        label: '进气阻力',
        value: 0.6,
        unit: 'kPa',
        min: 0,
        max: 0.8,
        source: 'calc',
        basis: '进气阻力计算 v1.0',
      }),
    ];
    model.calcRefs = [
      {
        id: 'calc-1',
        historyId: 'hist-1',
        formulaId: 'airflow-resistance',
        formulaTitle: '进气阻力计算',
        formulaVersion: '1.0',
        createdAt: '2026-11-11 10:00',
        outputs: { dP: 600 },
        conclusion: 'pass',
        note: '',
      },
    ];
    const baseline: Baseline = {
      id: 'bl-1',
      label: 'V1.0',
      createdAt: '2026-11-11 10:00',
      createdBy: '张三',
      note: '首版发布',
      params: model.params.map((p) => ({ key: p.key, label: p.label, value: p.value, unit: p.unit })),
      calcRefIds: ['calc-1'],
      requirementCount: 1,
      errorCount: 0,
      warnCount: 0,
    };
    model.baselines = [baseline];
    return { fam, model, baseline };
  };

  it('生成的工作簿含五个工作表，且可被 Excel 解析', async () => {
    const { fam, model, baseline } = buildSample();
    const base64 = await buildDesignArchiveBase64(model, fam, baseline);
    expect(base64.length).toBeGreaterThan(1000);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(base64, 'base64') as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      '型号概况',
      '需求清单',
      '关键参数',
      '计算与校核',
      '版本基线',
    ]);
  });

  it('档案内容与型号数据一致（概况/需求/参数/校核/基线）', async () => {
    const { fam, model, baseline } = buildSample();
    const base64 = await buildDesignArchiveBase64(model, fam, baseline);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(base64, 'base64') as unknown as ArrayBuffer);

    const ov = wb.getWorksheet('型号概况')!;
    const kv = new Map<string, string>();
    ov.eachRow((row) => {
      const k = row.getCell(1).value;
      const v = row.getCell(2).value;
      if (typeof k === 'string' && v != null) kv.set(k, String(v));
    });
    expect(kv.get('型号 P/N')).toBe('AF-2026-001');
    expect(kv.get('版本基线')).toBe('V1.0');
    expect(kv.get('门禁结论')).toBe('通过（错误 0 / 警告 0）');

    const rq = wb.getWorksheet('需求清单')!;
    expect(rq.getRow(2).getCell(1).value).toBe('进气阻力');
    expect(rq.getRow(2).getCell(2).value).toBe('0.8');
    expect(rq.getRow(2).getCell(4).value).toBe('不大于');

    const pm = wb.getWorksheet('关键参数')!;
    expect(pm.getRow(2).getCell(2).value).toBe('dP');
    expect(pm.getRow(2).getCell(3).value).toBe('0.6');
    expect(pm.getRow(2).getCell(9).value).toBe('在范围内');

    const cr = wb.getWorksheet('计算与校核')!;
    expect(cr.getRow(2).getCell(1).value).toBe('hist-1');
    expect(cr.getRow(2).getCell(4).value).toBe('满足');
    expect(String(cr.getRow(2).getCell(6).value)).toContain('dP=600');

    const bl = wb.getWorksheet('版本基线')!;
    expect(bl.getRow(2).getCell(1).value).toBe('V1.0');
    expect(bl.getRow(2).getCell(4).value).toBe(1);
  });
});
