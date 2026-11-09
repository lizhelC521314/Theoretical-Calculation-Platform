import { describe, expect, it } from 'vitest';
import {
  buildMaterialRecord,
  draftFromRecord,
  emptyDraft,
  fluidFileName,
  fluidSummary,
  materialFileName,
  materialCsvFileName,
  materialKey,
  materialRecordToCsv,
  materialTemplateCsv,
  parseCurveCsv,
  parseFluidCsv,
  parseMaterialCsv,
  parseMaterialFileName,
  parseMaterialRecord,
  porousFileName,
  serializeMaterialRecord,
  validateCurvePoints,
  validateMaterialDraft,
  type FluidPoint,
  type MaterialDraft,
} from '../src/report/material';

/** 一份通过基础校验的常规材料草稿 */
function conventionalDraft(patch: Partial<MaterialDraft> = {}): MaterialDraft {
  return {
    ...emptyDraft('conventional'),
    grade: 'SPCC',
    series: '冷轧钢板',
    supplier: '宝钢',
    temperature: '25',
    density: '7.85',
    poisson: '0.3',
    elasticModulus: '205000',
    tensileStrength: '370',
    failureStrain: '32',
    stressStrainCurve: {
      points: [
        { x: 0, y: 0 },
        { x: 0.1, y: 205 },
        { x: 0.2, y: 410 },
        { x: 0.5, y: 420 },
        { x: 1, y: 430 },
      ],
    },
    ...patch,
  };
}

describe('材料库：必填与数值校验', () => {
  it('仅牌号 / 系列号 / 温度为必填', () => {
    const res = validateMaterialDraft(emptyDraft('conventional'));
    expect(res.missing).toEqual(['牌号', '系列号', '温度']);
    expect(res.errors.map((e) => e.field)).toEqual(['grade', 'series', 'temperature']);
  });

  it('最小合法草稿只有曲线缺失警告，无错误', () => {
    const res = validateMaterialDraft({
      ...emptyDraft('conventional'),
      grade: 'SPCC',
      series: '冷轧钢板',
      temperature: '25',
    });
    expect(res.errors).toHaveLength(0);
    expect(res.warnings.map((w) => w.field)).toContain('stressStrainCurve');
    expect(res.warnings.map((w) => w.field)).toContain('fatigueCurve');
  });

  it('牌号不合法字符与系列号长度受限', () => {
    const res = validateMaterialDraft(
      conventionalDraft({ grade: 'A/B', series: '钢', temperature: '25' }),
    );
    expect(res.errors.some((e) => e.field === 'grade')).toBe(true);
    expect(res.errors.some((e) => e.field === 'series')).toBe(true);
  });

  it('温度超出 -60 ~ 400 报错；超弹性高温给出警告', () => {
    const hot = validateMaterialDraft(conventionalDraft({ temperature: '450' }));
    expect(hot.errors.some((e) => e.field === 'temperature')).toBe(true);

    const hyper = validateMaterialDraft({
      ...emptyDraft('hyperelastic'),
      grade: 'EPDM-70',
      series: '密封橡胶',
      temperature: '230',
      poisson: '0.48',
    });
    expect(hyper.errors.some((e) => e.field === 'temperature')).toBe(false);
    expect(hyper.warnings.some((e) => e.field === 'temperature')).toBe(true);
  });

  it('选填字段为空不校验，超范围才报错', () => {
    const ok = validateMaterialDraft(conventionalDraft({ density: '', poisson: '' }));
    expect(ok.errors).toHaveLength(0);

    const bad = validateMaterialDraft(
      conventionalDraft({ density: '49', poisson: '0.5', elasticModulus: '0' }),
    );
    expect(bad.errors.map((e) => e.field).sort()).toEqual(['density', 'elasticModulus', 'poisson']);
  });

  it('破坏应变不得小于应力应变曲线最大应变', () => {
    const res = validateMaterialDraft(conventionalDraft({ failureStrain: '0.5' }));
    expect(res.errors.some((e) => e.field === 'failureStrain')).toBe(true);
  });

  it('超弹性材料与常规材料使用同一套校验规则', () => {
    const res = validateMaterialDraft({
      ...emptyDraft('hyperelastic'),
      grade: 'FKM-80',
      series: '氟橡胶',
      temperature: '150',
      density: '999',
      tensileStrength: '9999',
    });
    expect(res.errors.some((e) => e.field === 'tensileStrength')).toBe(true);
  });
});

describe('材料库：曲线校验', () => {
  it('应力应变曲线需 ≥5 点，负应变/负应力（压缩）允许，重复/回退点保留并给出警告', () => {
    const res = validateCurvePoints(
      [
        { x: 0, y: 0 },
        { x: 0.2, y: 10 },
        { x: 0.2, y: 20 },
        { x: -0.1, y: 30 },
      ],
      'stressStrainCurve',
    );
    expect(res.errors.some((m) => m.includes('至少 5'))).toBe(true);
    expect(res.warnings.some((m) => m.includes('重复或回退'))).toBe(true);
    expect(res.errors.some((m) => m.includes('不能为负'))).toBe(false);
  });

  it('疲劳曲线需 ≥4 点、寿命为正，回退点给出警告、应力上升给出警告', () => {
    const res = validateCurvePoints(
      [
        { x: 1e4, y: 300 },
        { x: 0, y: 250 },
        { x: 2e4, y: 260 },
      ],
      'fatigueCurve',
    );
    expect(res.errors.some((m) => m.includes('至少 4'))).toBe(true);
    expect(res.errors.some((m) => m.includes('寿命必须为正数'))).toBe(true);
    expect(res.warnings.some((m) => m.includes('重复或回退'))).toBe(true);
    expect(res.warnings.some((m) => m.includes('S-N'))).toBe(true);
  });
});

describe('材料库：唯一键与文件名', () => {
  it('唯一键忽略大小写与空格，温度统一 1 位小数', () => {
    const a = materialKey({ type: 'conventional', grade: ' PA 66 ', series: '尼龙 加玻纤', temperature: '25' });
    const b = materialKey({ type: 'conventional', grade: 'pa66', series: '尼龙加玻纤', temperature: 25.0 });
    expect(a).toBe(b);
    expect(materialKey({ type: 'conventional', grade: 'PA66', series: '尼龙', temperature: 120 })).not.toBe(
      materialKey({ type: 'conventional', grade: 'PA66', series: '尼龙', temperature: 25 }),
    );
  });

  it('文件名为「牌号+系列号+温度+供应商」并可反解', () => {
    const conv = materialFileName('SPCC', '冷轧钢板', 25);
    expect(conv).toBe('SPCC+冷轧钢板+25℃.parquet');
    expect(parseMaterialFileName(conv)).toEqual({
      type: 'conventional',
      grade: 'SPCC',
      series: '冷轧钢板',
      supplier: '',
      hardness: '',
      temperature: 25,
      state: 'wet',
    });

    const withSup = materialFileName('PA6-GF30', '尼龙加玻纤', 23.5, '杜邦');
    expect(withSup).toBe('PA6-GF30+尼龙加玻纤+23.5℃+杜邦.parquet');
    expect(parseMaterialFileName(withSup)).toEqual({
      type: 'conventional',
      grade: 'PA6-GF30',
      series: '尼龙加玻纤',
      supplier: '杜邦',
      hardness: '',
      temperature: 23.5,
      state: 'wet',
    });
  });

  it('超弹性文件名在供应商前包含硬度段并可反解', () => {
    const name = materialFileName('EPDM-70', '密封橡胶', 23, '某密封件厂', '60');
    expect(name).toBe('EPDM-70+密封橡胶+23℃+60+某密封件厂.parquet');
    expect(parseMaterialFileName(name)).toMatchObject({
      grade: 'EPDM-70',
      series: '密封橡胶',
      hardness: '60',
      supplier: '某密封件厂',
      temperature: 23,
    });
  });

  it('旧命名（类型前缀 + 干态后缀）仍可反解', () => {
    expect(parseMaterialFileName('超弹性+EPDM-70+密封橡胶+23.5℃.parquet')).toEqual({
      type: 'hyperelastic',
      grade: 'EPDM-70',
      series: '密封橡胶',
      supplier: '',
      hardness: '',
      temperature: 23.5,
      state: 'wet',
    });
    expect(parseMaterialFileName('常规材料+PA6-GF30+尼龙加玻纤+23℃+干态.parquet')).toEqual({
      type: 'conventional',
      grade: 'PA6-GF30',
      series: '尼龙加玻纤',
      supplier: '',
      hardness: '',
      temperature: 23,
      state: 'dry',
    });
  });

  it('无法识别的文件名温度返回 null', () => {
    expect(parseMaterialFileName('任意文件.json').temperature).toBeNull();
  });
});

describe('材料库：记录构建与序列化', () => {
  it('首次入库 revision=1，覆盖时保留 createdAt 且 revision+1', () => {
    const now = new Date('2026-11-05T01:00:00.000Z');
    const rec = buildMaterialRecord(conventionalDraft(), {
      username: 'u1',
      displayName: '张三',
      now,
    });
    expect(rec.schema).toBe('ctr-material-v1');
    expect(rec.revision).toBe(1);
    expect(rec.createdAt).toBe(now.toISOString());
    expect(rec.createdByDisplay).toBe('张三');
    expect(rec.temperature).toBe(25);
    expect(rec.fatigueCurve).toBeNull();

    const next = buildMaterialRecord(conventionalDraft({ supplier: '新供应商' }), {
      username: 'u2',
      previous: rec,
      now: new Date('2026-11-06T01:00:00.000Z'),
    });
    expect(next.createdAt).toBe(rec.createdAt);
    expect(next.createdBy).toBe('u1');
    expect(next.updatedBy).toBe('u2');
    expect(next.revision).toBe(2);
    expect(next.supplier).toBe('新供应商');
  });

  it('JSON 序列化后可反解，非法内容返回 null', () => {
    const rec = buildMaterialRecord(conventionalDraft(), { username: 'u1' });
    const parsed = parseMaterialRecord(serializeMaterialRecord(rec));
    expect(parsed).not.toBeNull();
    expect(parsed!.grade).toBe('SPCC');
    expect(parsed!.state).toBe('wet');
    expect(parsed!.stressStrainCurve?.points).toHaveLength(5);

    expect(parseMaterialRecord('not json')).toBeNull();
    expect(parseMaterialRecord(JSON.stringify({ ...rec, schema: 'other' }))).toBeNull();
    expect(parseMaterialRecord(JSON.stringify({ ...rec, temperature: 'abc' }))).toBeNull();
  });

  it('比热容 / 热导率 / 膨胀系数可入库、反解并回填草稿', () => {
    const rec = buildMaterialRecord(
      conventionalDraft({
        specificHeat: '1350',
        thermalConductivity: '0.28',
        expansionCoefficient: '2.3e-5',
      }),
      { username: 'u1' },
    );
    expect(rec.specificHeat).toBe(1350);
    expect(rec.thermalConductivity).toBe(0.28);
    expect(rec.expansionCoefficient).toBeCloseTo(0.000023, 9);

    const parsed = parseMaterialRecord(serializeMaterialRecord(rec))!;
    expect(parsed.specificHeat).toBe(1350);
    expect(parsed.thermalConductivity).toBe(0.28);
    expect(parsed.expansionCoefficient).toBeCloseTo(0.000023, 9);

    const draft = draftFromRecord(parsed);
    expect(draft.specificHeat).toBe('1350');
    expect(draft.thermalConductivity).toBe('0.28');
    expect(draft.expansionCoefficient).toBe('0.000023');
  });

  it('比热容 / 热导率 / 膨胀系数超出合理范围时报错', () => {
    const res = validateMaterialDraft(
      conventionalDraft({ specificHeat: '10', thermalConductivity: '5000', expansionCoefficient: '0.5' }),
    );
    expect(res.errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['specificHeat', 'thermalConductivity', 'expansionCoefficient']),
    );
  });

  it('干态记录可往返；旧记录缺状态字段时默认湿态', () => {
    const rec = buildMaterialRecord(conventionalDraft({ state: 'dry' }), { username: 'u1' });
    expect(rec.state).toBe('dry');
    expect(parseMaterialRecord(JSON.stringify(rec))!.state).toBe('dry');

    const legacy = { ...rec } as Record<string, unknown>;
    delete legacy.state;
    expect(parseMaterialRecord(JSON.stringify(legacy))!.state).toBe('wet');
  });
});

describe('材料库：CSV 导出', () => {
  it('文件名与 Parquet 同名，仅扩展名改为 .csv', () => {
    const rec = buildMaterialRecord(conventionalDraft(), { username: 'u1' });
    expect(materialCsvFileName(rec)).toBe('SPCC+冷轧钢板+25℃+宝钢.csv');
  });

  it('28 列表头，曲线按应变/应力两列逐行导出并带 BOM', () => {
    const rec = buildMaterialRecord(conventionalDraft(), {
      username: 'u1',
      displayName: '张三',
      now: new Date('2026-11-05T01:00:00.000Z'),
    });
    const csv = materialRecordToCsv(rec);
    expect(csv.startsWith('\ufeff')).toBe(true);

    const lines = csv.slice(1).split('\r\n');
    // 表头 + 5 个应力应变点（疲劳曲线为空，行数取较大值 5）
    expect(lines).toHaveLength(6);
    const headers = lines[0].split(',');
    expect(headers).toHaveLength(28);
    expect(headers[0]).toBe('"记录格式"');
    expect(headers[5]).toBe('"状态"');
    expect(headers[17]).toBe('"应力应变曲线来源"');
    expect(headers[18]).toBe('"应变(%)"');
    expect(headers[19]).toBe('"应力(MPa)"');
    expect(headers[20]).toBe('"疲劳曲线来源"');
    expect(headers[21]).toBe('"寿命(cycles)"');
    expect(headers[22]).toBe('"应力幅(MPa)"');

    // 每行一个数据点，应变与应力同行一一对应
    const rows = lines.slice(1).map((l) => l.split(','));
    expect(rows.map((r) => r[18])).toEqual(['"0"', '"0.1"', '"0.2"', '"0.5"', '"1"']);
    expect(rows.map((r) => r[19])).toEqual(['"0"', '"205"', '"410"', '"420"', '"430"']);
    // 基础信息逐行重复，便于筛选
    expect(rows[0][2]).toBe('"SPCC"');
    expect(rows[4][2]).toBe('"SPCC"');
    expect(rows[0][25]).toBe('"张三"');
    expect(rows[0][27]).toBe('"1"');
    // 疲劳曲线为空则留空
    expect(rows.every((r) => r[21] === '""' && r[22] === '""')).toBe(true);
  });

  it('疲劳曲线同样逐行导出；两条曲线行数不同时缺项留空', () => {
    const rec = buildMaterialRecord(
      conventionalDraft({
        supplier: '宝钢',
        fatigueCurve: {
          points: [
            { x: 1e4, y: 300 },
            { x: 1e5, y: 250 },
          ],
        },
      }),
      { username: 'u1' },
    );
    const csv = materialRecordToCsv(rec);
    const rows = csv.slice(1).split('\r\n').slice(1).map((l) => l.split(','));
    expect(rows).toHaveLength(5);
    expect(rows[0][21]).toBe('"10000"');
    expect(rows[0][22]).toBe('"300"');
    expect(rows[1][21]).toBe('"100000"');
    expect(rows[1][22]).toBe('"250"');
    expect(rows[2][21]).toBe('""');
    expect(rows[2][22]).toBe('""');
  });

  it('曲线为空时导出空字符串，含逗号的字段整体加引号', () => {
    const rec = buildMaterialRecord(
      conventionalDraft({ stressStrainCurve: null, fatigueCurve: null, supplier: '宝钢, 上海' }),
      { username: 'u1' },
    );
    const csv = materialRecordToCsv(rec);
    expect(csv).toContain('"宝钢, 上海"');
    const rows = csv.slice(1).split('\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('"","","","","",""');
  });
});

describe('材料库：CSV 导入', () => {
  it('曲线 CSV 支持表头与中文分隔符', () => {
    const res = parseCurveCsv('应变，应力\n0，0\n0.2，10\n0.4，20');
    expect(res.error).toBe('');
    expect(res.points).toEqual([
      { x: 0, y: 0 },
      { x: 0.2, y: 10 },
      { x: 0.4, y: 20 },
    ]);
  });

  it('曲线 CSV 从上到下顺序读取，遇到非数值行即停止', () => {
    const res = parseCurveCsv('0,0\n0.2,10\nabc,20\n0.4,30');
    expect(res.error).toBe('');
    expect(res.points).toEqual([
      { x: 0, y: 0 },
      { x: 0.2, y: 10 },
    ]);
  });

  it('批量导入按表头映射字段，缺必填列时拒绝', () => {
    const text = [
      '牌号,系列号,温度(°C),密度(g/cm³),泊松比',
      'SPCC,冷轧钢板,25,7.85,0.3',
      'PA66-GF30,尼龙加玻纤,120,,0.34',
    ].join('\n');
    const res = parseMaterialCsv(text, 'conventional');
    expect(res.error).toBe('');
    expect(res.drafts).toHaveLength(2);
    expect(res.drafts[1].grade).toBe('PA66-GF30');
    expect(res.drafts[1].density).toBe('');
    expect(res.drafts[1].poisson).toBe('0.34');

    const bad = parseMaterialCsv('名称,系列\nA,B', 'conventional');
    expect(bad.error).toContain('表头缺少必填列');
    expect(bad.drafts).toHaveLength(0);
  });

  it('批量导入识别状态列，未写状态默认湿态', () => {
    const text = ['牌号,系列号,状态,温度', 'PA6-GF30,尼龙加玻纤,干态,23', 'SPCC,冷轧钢板,,25'].join(
      '\n',
    );
    const res = parseMaterialCsv(text, 'conventional');
    expect(res.error).toBe('');
    expect(res.drafts[0].state).toBe('dry');
    expect(res.drafts[1].state).toBe('wet');
  });

  it('批量导入识别比热容 / 热导率 / 膨胀系数列', () => {
    const text = [
      '牌号,系列号,温度(°C),比热容 Cp(J/(kg·℃)),热导率 K(W/(m·℃)),膨胀系数(mm/(mm·K))',
      'PA6-GF30,尼龙加玻纤,23,1350,0.28,2.3e-5',
    ].join('\n');
    const res = parseMaterialCsv(text, 'conventional');
    expect(res.error).toBe('');
    expect(res.drafts[0].specificHeat).toBe('1350');
    expect(res.drafts[0].thermalConductivity).toBe('0.28');
    expect(res.drafts[0].expansionCoefficient).toBe('2.3e-5');
  });

  it('模板 CSV 可被自身解析器识别表头', () => {
    const res = parseMaterialCsv(materialTemplateCsv('conventional'), 'conventional');
    expect(res.error).toBe('');
    expect(res.drafts).toHaveLength(2);
    expect(res.ignoredCurves).toBe(true);
  });

  it('超弹性材料模板与常规材料列规则一致', () => {
    const res = parseMaterialCsv(materialTemplateCsv('hyperelastic'), 'hyperelastic');
    expect(res.error).toBe('');
    expect(res.drafts).toHaveLength(2);
    expect(res.drafts[0]).toMatchObject({
      type: 'hyperelastic',
      grade: 'EPDM-70',
      series: '密封橡胶',
      supplier: '某密封件厂',
      state: 'wet',
      density: '1100',
      poisson: '0.48',
      elasticModulus: '10',
      hardness: '60',
      tensileStrength: '15',
      failureStrain: '300',
      specificHeat: '1800',
      thermalConductivity: '0.25',
      expansionCoefficient: '2.3e-4',
    });
  });

  it('固定坐标布局：表头无「牌号」时走固定值读取，并从 C/D 列自动构造应力应变曲线', () => {
    // 注：固定坐标布局要求第2列(索引1)按行号固定取：牌号在第2行、系列号在第4行、温度在第5行...
    // 表头 Row#/B列固定值/应变ε/应力σ 不含「牌号/系列」→ 识别为固定坐标
    const csv = [
      'Row#,B列固定值,应变ε,应力σ',
      '1,SPCC,0.00,0',
      '2,宝钢,0.01,205',
      '3,冷轧钢板,0.02,380',
      '4,25°C,0.05,420',
      '5,7850,0.10,430',
      '6,205000,0.20,430',
      '7,0,0.30,430',
      '8,,0.40,425',
      '9,180,0.50,410',
      '10,0.30,0.60,380',
      '分隔线,,,,',
      ',,,,',
    ].join('\n');
    const res = parseMaterialCsv(csv, 'conventional');
    expect(res.error).toBe('');
    expect(res.ignoredCurves).toBe(false);
    expect(res.drafts).toHaveLength(1);
    const d = res.drafts[0];
    expect(d.grade).toBe('SPCC');
    expect(d.supplier).toBe('宝钢');
    expect(d.series).toBe('冷轧钢板');
    expect(d.temperature).toBe('25');
    expect(d.density).toBe('7850');
    expect(d.elasticModulus).toBe('205000');
    expect(d.direction).toBe('0');
    expect(d.hardness).toBe('180');
    expect(d.poisson).toBe('0.30');
    expect(d.stressStrainCurve?.points).toHaveLength(10); // row 1..10 都有数值
    const pts = d.stressStrainCurve!.points;
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[1].x).toBeCloseTo(1, 4);  // row 2: 0.01 → 1%
    expect(pts[3].x).toBeCloseTo(5, 4);  // row 4: 0.05 → 5%
    expect(pts[9]).toEqual({ x: 60, y: 380 });
    expect(d.tensileStrength).toBe('430');
    expect(d.failureStrain).toBe('60');
  });

  it('固定坐标布局：曲线点全部保留（含重复与回退点）', () => {
    // 最小可用固定坐标布局：第2列的第2/4/5行必须非空
    const csv = [
      'Row#,B,C,D',
      '1,SPCC,0.00,0',
      '2,,0.02,200',
      '3,冷轧,0.02,250', // 系列号在第4行（行号=3 是第4行，索引3-1=2？ 不：parseFixedCoords 用 0-based row index 第4行=索引3）
      '4,25°C,0.01,100',
      '5,,0.05,420',
    ].join('\n');
    const res = parseMaterialCsv(csv, 'conventional');
    expect(res.error).toBe('');
    expect(res.drafts).toHaveLength(1);
    const pts = res.drafts[0].stressStrainCurve?.points;
    expect(pts).toBeDefined();
    expect(pts!.map((p) => p.x)).toEqual([0, 2, 2, 1, 5]);
    expect(pts!.map((p) => p.y)).toEqual([0, 200, 250, 100, 420]);
  });

  it('超弹性材料应变按小数换算成百分比（0.01 → 1%）', () => {
    const csv = [
      '类别,值_4,应变,应力（MPa）_4',
      '材料,FKM,0,0',
      '供应商,鼎玺,0.540944672,0.826103455',
      '牌号,-,0.740306778,0.969849707',
      '温度（℃）,20,0.931267929,1.116517467',
      '密度（kg/m³）,1300,1.112939606,1.277339746',
      '弹性模量（MPa）,-,1.285585632,1.441746417',
      '方向（°）,0,1.450778961,1.621670231',
      '抗拉强度（MPa）,13.7,1.609139557,1.813632112',
      '硬度_HA,70,1.761848907,2.015363623',
    ].join('\n');
    const res = parseMaterialCsv(csv, 'hyperelastic');
    expect(res.error).toBe('');
    const pts = res.drafts[0].stressStrainCurve!.points;
    expect(pts.map((p) => p.x)).toEqual([
      0, 54.0945, 74.0307, 93.1268, 111.294, 128.5586, 145.0779, 160.914, 176.1849,
    ]);
    expect(res.drafts[0].failureStrain).toBe('176.1849');
  });

  it('固定坐标布局：遇到空行即停止，不读取下方零散数字', () => {
    const csv = [
      'Row#,B,C,D',
      '1,SPCC,0,0',
      '2,,0.1,10',
      '3,冷轧,0.2,20',
      '4,25°C,0.3,30',
      '5,,0.4,40',
      '',
      '7,备注,0.9,999',
    ].join('\n');
    const res = parseMaterialCsv(csv, 'conventional');
    expect(res.error).toBe('');
    const pts = res.drafts[0].stressStrainCurve?.points;
    expect(pts).toHaveLength(5);
    expect(pts![pts!.length - 1]).toEqual({ x: 40, y: 40 });
  });

});

/** 一条合法流体属性表 */
const FLUID_POINTS: FluidPoint[] = [
  { temperature: 20, density: 998.2, dynamicViscosity: 1.002, thermalConductivity: 0.599, specificHeat: 4.182 },
  { temperature: 40, density: 992.2, dynamicViscosity: 0.653, thermalConductivity: 0.631, specificHeat: 4.179 },
  { temperature: 60, density: 983.2, dynamicViscosity: 0.467, thermalConductivity: 0.654, specificHeat: 4.185 },
];

function fluidDraft(patch: Partial<MaterialDraft> = {}): MaterialDraft {
  return {
    ...emptyDraft('fluid'),
    name: '水',
    grade: 'DW-40',
    fluidPoints: FLUID_POINTS.map((p) => ({ ...p })),
    ...patch,
  };
}

describe('流体材料：属性表解析', () => {
  it('从第 2 行起按列读取 5 列，温度列非数字即停止', () => {
    const csv = [
      '温度(℃),密度(kg/m³),动力粘度(mPa·s),导热系数(W/(m·K)),比热(kJ/(kg·K))',
      '20,998.2,1.002,0.599,4.182',
      '40,992.2,0.653,0.631,4.179',
      '备注,,,,,',
      '60,983.2,0.467,0.654,4.185',
    ].join('\n');
    const res = parseFluidCsv(csv);
    expect(res.error).toBe('');
    expect(res.points).toHaveLength(2); // 第 4 行温度列非数字 → 停止，不再读第 5 行
    expect(res.points[0]).toEqual(FLUID_POINTS[0]);
    expect(res.points[1]).toEqual(FLUID_POINTS[1]);
  });

  it('首行即为数据（无表头）时也能读取', () => {
    const res = parseFluidCsv('20,998.2,1.002,0.599,4.182\n40,992.2,0.653,0.631,4.179');
    expect(res.error).toBe('');
    expect(res.points).toHaveLength(2);
  });

  it('温度列为数字但其余列有非数值时跳过该行并告警', () => {
    const csv = [
      '温度,密度,粘度,导热,比热',
      '20,998.2,1.002,0.599,4.182',
      '30,abc,0.8,0.61,4.18',
      '40,992.2,0.653,0.631,4.179',
    ].join('\n');
    const res = parseFluidCsv(csv);
    expect(res.error).toBe('');
    expect(res.points.map((p) => p.temperature)).toEqual([20, 40]);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain('第 3 行');
  });

  it('读不到数据时报错', () => {
    const res = parseFluidCsv('温度,密度\n备注,无数据');
    expect(res.points).toHaveLength(0);
    expect(res.error).toContain('未从第 2 行起');
  });

  it('parseMaterialCsv 分流：流体返回一条草稿，属性表已填入', () => {
    const csv = [
      '温度(℃),密度(kg/m³),动力粘度(mPa·s),导热系数(W/(m·K)),比热(kJ/(kg·K))',
      '20,998.2,1.002,0.599,4.182',
    ].join('\n');
    const res = parseMaterialCsv(csv, 'fluid');
    expect(res.error).toBe('');
    expect(res.drafts).toHaveLength(1);
    expect(res.drafts[0].type).toBe('fluid');
    expect(res.drafts[0].fluidPoints).toHaveLength(1);
    expect(res.drafts[0].name).toBe(''); // 名称/牌号在预览面板中补填
  });

  it('流体模板可被自身解析', () => {
    const res = parseMaterialCsv(materialTemplateCsv('fluid'), 'fluid');
    expect(res.error).toBe('');
    expect(res.drafts[0].fluidPoints).toHaveLength(3);
  });
});

describe('流体材料：校验', () => {
  it('必填为名称、牌号与属性表', () => {
    const res = validateMaterialDraft(emptyDraft('fluid'));
    expect(res.missing).toEqual(['牌号', '名称', '流体属性表']);
    expect(res.errors.map((e) => e.field)).toEqual(['grade', 'name', 'fluidPoints']);
  });

  it('合法草稿无错误', () => {
    const res = validateMaterialDraft(fluidDraft());
    expect(res.errors).toHaveLength(0);
  });

  it('逐项范围越界时报错并带行号', () => {
    const res = validateMaterialDraft(
      fluidDraft({
        fluidPoints: [
          { temperature: -300, density: 0, dynamicViscosity: 0, thermalConductivity: 0, specificHeat: 0 },
        ],
      }),
    );
    expect(res.errors.length).toBe(5);
    expect(res.errors[0].message).toContain('第 1 行');
    expect(res.errors.map((e) => e.field)).toEqual([
      'fluidPoints',
      'fluidPoints',
      'fluidPoints',
      'fluidPoints',
      'fluidPoints',
    ]);
  });

  it('重复温度只给警告，不拦截归档', () => {
    const res = validateMaterialDraft(
      fluidDraft({
        fluidPoints: [FLUID_POINTS[0], { ...FLUID_POINTS[1], temperature: 20 }],
      }),
    );
    expect(res.errors).toHaveLength(0);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0].message).toContain('重复');
  });

  it('流体不校验常规材料的系列号 / 温度字段', () => {
    const res = validateMaterialDraft(fluidDraft({ series: '', temperature: '' }));
    expect(res.errors).toHaveLength(0);
  });
});

describe('流体材料：命名 / 序列化 / CSV', () => {
  it('归档文件名为 名称+牌号.parquet', () => {
    expect(fluidFileName('水', 'DW-40')).toBe('水+DW-40.parquet');
    expect(fluidFileName('乙二醇 50%', 'EG-50')).toBe('乙二醇 50%+EG-50.parquet');
  });

  it('buildMaterialRecord 流体：temperature 为 null，属性表保留', () => {
    const rec = buildMaterialRecord(fluidDraft(), { username: 'u1', displayName: '张三' });
    expect(rec.type).toBe('fluid');
    expect(rec.name).toBe('水');
    expect(rec.temperature).toBeNull();
    expect(rec.fluidPoints).toHaveLength(3);
    expect(rec.stressStrainCurve).toBeNull();
  });

  it('记录 JSON 往返不丢字段', () => {
    const rec = buildMaterialRecord(fluidDraft(), { username: 'u1', displayName: '张三' });
    const json = serializeMaterialRecord(rec);
    const parsed = parseMaterialRecord(json);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('fluid');
    expect(parsed!.name).toBe('水');
    expect(parsed!.temperature).toBeNull();
    expect(parsed!.fluidPoints).toEqual(rec.fluidPoints);
  });

  it('CSV 导出：流体用属性表列', () => {
    const rec = buildMaterialRecord(fluidDraft(), { username: 'u1', displayName: '张三' });
    const csv = materialRecordToCsv(rec);
    expect(csv).toContain('流体');
    expect(csv).toContain('流体属性表');
    expect(csv).toContain('20:998.2:1.002:0.599:4.182;40:992.2:0.653:0.631:4.179');
    // CSV 文件名与归档同名
    expect(materialCsvFileName(rec)).toBe('水+DW-40.csv');
  });

  it('draftFromRecord 流体：可还原为草稿继续编辑', () => {
    const rec = buildMaterialRecord(fluidDraft(), { username: 'u1', displayName: '张三' });
    const d = draftFromRecord(rec);
    expect(d.type).toBe('fluid');
    expect(d.name).toBe('水');
    expect(d.grade).toBe('DW-40');
    expect(d.temperature).toBe('');
    expect(d.fluidPoints).toEqual(rec.fluidPoints);
  });

  it('fluidSummary 给出行数与温度范围', () => {
    expect(fluidSummary(FLUID_POINTS)).toBe('3 行 · 温度 20–60 ℃');
    expect(fluidSummary(null)).toBe('');
  });
});

/* ---------------- 多孔介质（滤纸输入列表） ---------------- */

const POROUS_CSV = [
  '序号,牌号,孔径（um）,粘性阻力系数（m-2）,惯性阻力系数（m-1),粘性阻力系数(kg/m^3-s),惯性阻力系数(kg/m^4),备注',
  '1,XH34720,74.6,4.874E+07,2.121E+03,9.066E+02,1.278E+03,',
  '2,AK55/66CN1,51,1.043E+08,3.103E+03,1.940E+03,1.870E+03,常用数据',
].join('\n');

describe('多孔介质：解析', () => {
  it('按滤纸列表表头映射，每行一条，序号列忽略', () => {
    const res = parseMaterialCsv(POROUS_CSV, 'porous');
    expect(res.error).toBe('');
    expect(res.drafts).toHaveLength(2);
    const a = res.drafts[0];
    expect(a.type).toBe('porous');
    expect(a.grade).toBe('XH34720');
    expect(a.poreSize).toBe('74.6');
    expect(a.viscousResistance).toBe('4.874E+07');
    expect(a.inertialResistance).toBe('2.121E+03');
    expect(a.viscousCoefficient).toBe('9.066E+02');
    expect(a.inertialCoefficient).toBe('1.278E+03');
    const b = res.drafts[1];
    expect(b.grade).toBe('AK55/66CN1');
    expect(b.remark).toBe('常用数据');
  });

  it('表头缺少牌号列时报错', () => {
    const res = parseMaterialCsv('孔径（um）,备注\n74.6,x', 'porous');
    expect(res.error).toContain('牌号');
  });

  it('牌号为空的行跳过并告警', () => {
    const csv = POROUS_CSV + '\n3,,,,,,,';
    const res = parseMaterialCsv(csv, 'porous');
    expect(res.drafts).toHaveLength(2);
    expect(res.warnings?.some((w) => w.includes('牌号为空'))).toBe(true);
  });
});

describe('多孔介质：校验与命名', () => {
  it('空草稿仅缺牌号，牌号允许 / 字符', () => {
    const empty = validateMaterialDraft(emptyDraft('porous'));
    expect(empty.missing).toEqual(['牌号']);
    expect(empty.errors).toHaveLength(1);

    const d = { ...emptyDraft('porous'), grade: 'AK55/66CN1' };
    expect(validateMaterialDraft(d).errors).toHaveLength(0);
  });

  it('参数选填但限范围：非数值与越界报错', () => {
    const d = { ...emptyDraft('porous'), grade: 'XH34720', poreSize: '0' };
    expect(validateMaterialDraft(d).errors.some((e) => e.field === 'poreSize')).toBe(true);
    const d2 = { ...emptyDraft('porous'), grade: 'XH34720', viscousResistance: 'abc' };
    expect(validateMaterialDraft(d2).errors.some((e) => e.field === 'viscousResistance')).toBe(true);
  });

  it('porousFileName 用牌号，非法字符被清理', () => {
    expect(porousFileName('XH34720')).toBe('XH34720.parquet');
    expect(porousFileName('AK55/66CN1')).not.toContain('/');
  });

  it('模板可被自身解析', () => {
    const res = parseMaterialCsv(materialTemplateCsv('porous'), 'porous');
    expect(res.error).toBe('');
    expect(res.drafts).toHaveLength(2);
    expect(res.drafts[1].grade).toBe('AK55/66CN1');
  });
});

describe('多孔介质：记录往返', () => {
  it('buildMaterialRecord → JSON 往返保留多孔参数，温度为空', () => {
    const d = emptyDraft('porous');
    d.grade = 'XH34720';
    d.poreSize = '74.6';
    d.viscousResistance = '4.874E+07';
    d.inertialResistance = '2.121E+03';
    d.viscousCoefficient = '9.066E+02';
    d.inertialCoefficient = '1.278E+03';
    d.remark = '常用数据';
    const rec = buildMaterialRecord(d, { username: 'tester', displayName: '测试员' });
    expect(rec.temperature).toBeNull();
    expect(rec.porousProps?.poreSize).toBeCloseTo(74.6);
    expect(rec.porousProps?.viscousResistance).toBeCloseTo(4.874e7);

    const parsed = parseMaterialRecord(serializeMaterialRecord(rec));
    expect(parsed).not.toBeNull();
    expect(parsed!.porousProps).toEqual(rec.porousProps);

    const back = draftFromRecord(parsed!);
    expect(back.grade).toBe('XH34720');
    expect(back.remark).toBe('常用数据');
  });

  it('materialRecordToCsv 输出多孔列，文件名与归档同名', () => {
    const d = emptyDraft('porous');
    d.grade = 'XH34720';
    d.poreSize = '74.6';
    const rec = buildMaterialRecord(d, { username: 'tester' });
    const csv = materialRecordToCsv(rec);
    expect(csv).toContain('多孔介质');
    expect(csv).toContain('孔径(μm)');
    expect(csv).toContain('74.6');
    expect(materialCsvFileName(rec)).toBe('XH34720.csv');
  });
});
