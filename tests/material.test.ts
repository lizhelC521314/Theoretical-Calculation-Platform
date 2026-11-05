import { describe, expect, it } from 'vitest';
import {
  buildMaterialRecord,
  emptyDraft,
  materialFileName,
  materialCsvFileName,
  materialKey,
  materialRecordToCsv,
  materialTemplateCsv,
  parseCurveCsv,
  parseMaterialCsv,
  parseMaterialFileName,
  parseMaterialRecord,
  serializeMaterialRecord,
  validateCurvePoints,
  validateMaterialDraft,
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

  it('超弹性材料不校验常规材料字段', () => {
    const res = validateMaterialDraft({
      ...emptyDraft('hyperelastic'),
      grade: 'FKM-80',
      series: '氟橡胶',
      temperature: '150',
      density: '999',
      tensileStrength: '9999',
    });
    expect(res.errors).toHaveLength(0);
  });
});

describe('材料库：曲线校验', () => {
  it('应力应变曲线需 ≥5 点且应变严格递增、非负', () => {
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
    expect(res.errors.some((m) => m.includes('严格递增'))).toBe(true);
    expect(res.errors.some((m) => m.includes('应变不能为负'))).toBe(true);
  });

  it('疲劳曲线需 ≥4 点、寿命为正且递增，应力上升给出警告', () => {
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

  it('文件名生成与反解可往返（两类材料）', () => {
    const conv = materialFileName('conventional', 'SPCC', '冷轧钢板', 25);
    expect(conv).toBe('常规材料+SPCC+冷轧钢板+25℃.parquet');
    expect(parseMaterialFileName(conv)).toEqual({
      type: 'conventional',
      grade: 'SPCC',
      series: '冷轧钢板',
      temperature: 25,
    });

    const hyper = materialFileName('hyperelastic', 'EPDM-70', '密封橡胶', 23.5);
    expect(hyper).toBe('超弹性+EPDM-70+密封橡胶+23.5℃.parquet');
    expect(parseMaterialFileName(hyper)).toEqual({
      type: 'hyperelastic',
      grade: 'EPDM-70',
      series: '密封橡胶',
      temperature: 23.5,
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
    expect(parsed!.stressStrainCurve?.points).toHaveLength(5);

    expect(parseMaterialRecord('not json')).toBeNull();
    expect(parseMaterialRecord(JSON.stringify({ ...rec, schema: 'other' }))).toBeNull();
    expect(parseMaterialRecord(JSON.stringify({ ...rec, temperature: 'abc' }))).toBeNull();
  });
});

describe('材料库：CSV 导出', () => {
  it('文件名与 Parquet 同名，仅扩展名改为 .csv', () => {
    const rec = buildMaterialRecord(conventionalDraft(), { username: 'u1' });
    expect(materialCsvFileName(rec)).toBe('常规材料+SPCC+冷轧钢板+25℃.csv');
  });

  it('单行记录、20 列表头，曲线按 x:y 分号连接并带 BOM', () => {
    const rec = buildMaterialRecord(conventionalDraft(), {
      username: 'u1',
      displayName: '张三',
      now: new Date('2026-11-05T01:00:00.000Z'),
    });
    const csv = materialRecordToCsv(rec);
    expect(csv.startsWith('\ufeff')).toBe(true);

    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(2);
    const headers = lines[0].split(',');
    expect(headers).toHaveLength(22);
    expect(headers[0]).toBe('"记录格式"');
    expect(headers[13]).toBe('"应力应变曲线来源"');
    expect(headers[14]).toBe('"应力应变曲线(应变%:应力MPa)"');

    const cells = lines[1].split(',');
    expect(cells).toHaveLength(22);
    expect(cells[0]).toBe('"ctr-material-v1"');
    expect(cells[2]).toBe('"SPCC"');
    expect(cells[5]).toBe('"25"');
    expect(cells[12]).toBe('"32"');
    expect(cells[13]).toBe('""');
    expect(cells[14]).toBe('"0:0;0.1:205;0.2:410;0.5:420;1:430"');
    expect(cells[15]).toBe('""');
    expect(cells[19]).toBe('"张三"');
    expect(cells[20]).toBe('"u1"');
    expect(cells[21]).toBe('"1"');
  });

  it('曲线为空时导出空字符串，含逗号的字段整体加引号', () => {
    const rec = buildMaterialRecord(
      conventionalDraft({ fatigueCurve: null, supplier: '宝钢, 上海' }),
      { username: 'u1' },
    );
    const csv = materialRecordToCsv(rec);
    expect(csv).toContain('"宝钢, 上海"');
    expect(csv.split('\r\n')[1]).toContain('"","","');
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

  it('曲线 CSV 行内非数值时返回错误并保留已解析点', () => {
    const res = parseCurveCsv('0,0\n0.2,10\nabc,20');
    expect(res.points).toHaveLength(2);
    expect(res.error).toContain('第 3 行');
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

  it('模板 CSV 可被自身解析器识别表头', () => {
    const res = parseMaterialCsv(materialTemplateCsv('conventional'), 'conventional');
    expect(res.error).toBe('');
    expect(res.drafts).toHaveLength(2);
    expect(res.ignoredCurves).toBe(true);
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

  it('固定坐标布局：曲线点应变回退时自动过滤重复/递减点', () => {
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
    expect(pts!.map((p) => p.x)).toEqual([0, 2, 5]);
    expect(pts![1].y).toBe(250);
  });
});
