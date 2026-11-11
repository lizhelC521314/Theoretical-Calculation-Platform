import { describe, expect, it } from 'vitest';
import {
  analyzeImportedRecords,
  allowedNextStatuses,
  applyMasterVocabulary,
  buildFmeaRecord,
  bumpVersion,
  classifyProduct,
  deriveCauseCode,
  deriveConclusion,
  deriveDesignGuide,
  deriveFailureCategory,
  deriveFailureCode,
  deriveRiskLevel,
  emptyFmeaDraft,
  expandFmeaTerms,
  fillMissingStructured,
  fmeaDedupeKey,
  fmeaTemplateCsv,
  formatFmeaIdV1,
  formatFmeaIdV2,
  isPlaceholderDraft,
  nextFmeaIdV1,
  nextFmeaIdV2,
  normalizeRecordDate,
  parseFmeaCsv,
  parseFmeaId,
  parseFmeaRecord,
  parseFmeaRows,
  productCodes,
  productMajorOf,
  productMinorOf,
  recordYearForId,
  scoreFmeaRecord,
  serializeFmeaRecord,
  similarFmeaRecords,
  tryTransitStatus,
  validateFmeaDraft,
  yearFromDate,
} from '../src/report/fmea';

const HEADER = [
  '序号',
  '机种名称',
  '部件名称',
  '本体使用材料',
  '潜在的失效模式',
  '潜在的失效模式图片',
  '潜在的失效后果',
  '潜在的失效起因/机理',
  '建议的措施',
  '措施对策图片（或示例）',
  '备注',
  '责任人',
  '记录时间',
];

function row(overrides: Partial<Record<string, string>> = {}): string[] {
  const base: Record<string, string> = {
    机种名称: '车型A',
    部件名称: '空气滤清器壳体',
    本体使用材料: 'PP-T20',
    潜在的失效模式: '卡扣根部断裂',
    潜在的失效模式图片: '=DISPIMG("ID_1234",1)',
    潜在的失效后果: '密封失效',
    '潜在的失效起因/机理': '根部壁厚不足',
    建议的措施: '壁厚 1.5→2.0 mm',
    '措施对策图片（或示例）': '',
    备注: '',
    责任人: '张三',
    记录时间: '2026.3.5',
  };
  return [
    '1',
    overrides['机种名称'] ?? base['机种名称'],
    overrides['部件名称'] ?? base['部件名称'],
    overrides['本体使用材料'] ?? base['本体使用材料'],
    overrides['潜在的失效模式'] ?? base['潜在的失效模式'],
    overrides['潜在的失效模式图片'] ?? base['潜在的失效模式图片'],
    overrides['潜在的失效后果'] ?? base['潜在的失效后果'],
    overrides['潜在的失效起因/机理'] ?? base['潜在的失效起因/机理'],
    overrides['建议的措施'] ?? base['建议的措施'],
    overrides['措施对策图片（或示例）'] ?? base['措施对策图片（或示例）'],
    overrides['备注'] ?? base['备注'],
    overrides['责任人'] ?? base['责任人'],
    overrides['记录时间'] ?? base['记录时间'],
  ];
}

describe('parseFmeaRows', () => {
  it('自动跳过标题行，识别表头并按别名取列', () => {
    const res = parseFmeaRows([['2026年 技术中心FMEA案例收集'], HEADER, row()], '2026年');
    expect(res.rows).toHaveLength(1);
    const { draft, sourceSheet, rowNumber } = res.rows[0];
    expect(sourceSheet).toBe('2026年');
    expect(rowNumber).toBe(3);
    expect(draft.machine).toBe('车型A');
    expect(draft.part).toBe('空气滤清器壳体');
    expect(draft.material).toBe('PP-T20');
    expect(draft.failureMode).toBe('卡扣根部断裂');
    expect(draft.recordDate).toBe('2026-03-05');
  });

  it('区分两张图片列，DISPIMG 公式只保留「含图片」标记', () => {
    const res = parseFmeaRows([
      HEADER,
      row({ 潜在的失效模式图片: '=DISPIMG("ID_A",1)', '措施对策图片（或示例）': '=DISPIMG("ID_B",1)' }),
    ]);
    expect(res.rows[0].draft.failureModeImage).toBe('含图片');
    expect(res.rows[0].draft.actionImage).toBe('含图片');
  });

  it('跳过小节标题、填写示例与缺失效模式的行', () => {
    const res = parseFmeaRows([
      HEADER,
      ['2022年四季度新增待入库项目'],
      row(),
      ['填写示例', '', '', '', '示例失效模式', '', '', '', '示例措施'],
      ['2', '', '', '', '', '', '', '', ''],
    ], '2022年~2024年');
    expect(res.rows).toHaveLength(1);
    expect(res.skipped).toBe(3);
  });

  it('表头缺失效模式时给出明确提示', () => {
    const res = parseFmeaRows([['机种名称', '部件名称', '备注'], ['A', 'B', 'C']]);
    expect(res.rows).toHaveLength(0);
    expect(res.warnings[0]).toContain('失效模式');
  });

  it('识别产品大类/小类与编码列，不会把「失效模式编码」当成失效模式', () => {
    const res = parseFmeaRows([
      ['机种名称', '部件名称', '产品大类', '产品小类', '潜在的失效模式', '失效模式编码', '建议的措施', '原因编码'],
      ['车型A', '空滤器上壳体', 'A 空气滤清器总成', 'A01 上壳体', '卡扣根部断裂', 'F01 开裂/断裂', '根部加厚', 'D03 卡扣/锁止设计不当'],
    ]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].draft.failureMode).toBe('卡扣根部断裂');
    expect(res.rows[0].draft.failureCode).toBe('F01 开裂/断裂');
    expect(res.rows[0].draft.productCategory).toBe('A 空气滤清器总成');
    expect(res.rows[0].draft.productSubCategory).toBe('A01 上壳体');
    expect(res.rows[0].draft.causeCode).toBe('D03 卡扣/锁止设计不当');
  });
});

describe('parseFmeaCsv', () => {
  it('支持带逗号与引号转义的字段', () => {
    const csv = [
      '机种名称,部件名称,潜在的失效模式,建议的措施',
      '车型A,油气分离器,"膜片破裂, 窜气","更换膜片材料，增加厚度 0.1 mm"',
    ].join('\r\n');
    const res = parseFmeaCsv(csv);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].draft.failureMode).toBe('膜片破裂, 窜气');
    expect(res.rows[0].draft.action).toBe('更换膜片材料，增加厚度 0.1 mm');
  });

  it('模板中的示例行不会被导入', () => {
    const res = parseFmeaCsv(fmeaTemplateCsv());
    expect(res.rows).toHaveLength(0);
  });
});

describe('normalizeRecordDate / yearFromDate', () => {
  it('识别多种日期写法', () => {
    expect(normalizeRecordDate('2026.3.5')).toBe('2026-03-05');
    expect(normalizeRecordDate('2026/03/05')).toBe('2026-03-05');
    expect(normalizeRecordDate('2026年3月')).toBe('2026-03');
    expect(normalizeRecordDate('')).toBe('');
  });

  it('年份取记录时间，取不到用当前年', () => {
    expect(yearFromDate('2025-11-01')).toBe(2025);
    expect(yearFromDate('', new Date('2026-05-01T00:00:00Z'))).toBe(2026);
  });

  it('旧表无记录时间时按工作表名取编号年份', () => {
    expect(recordYearForId('2024-03-01', '2025年')).toBe(2024);
    expect(recordYearForId('', '2022年~2024年')).toBe(2022);
    expect(recordYearForId('', 'CSV', new Date('2026-05-01T00:00:00Z'))).toBe(2026);
  });
});

describe('编号', () => {
  it('旧版：同年顺延，跨年重新从 001 开始', () => {
    expect(nextFmeaIdV1([], 2026)).toBe('FM-2026-001');
    expect(nextFmeaIdV1(['FM-2026-001.parquet', 'FM-2026-007.parquet', 'FM-2025-030.parquet'], 2026)).toBe(
      'FM-2026-008',
    );
    expect(nextFmeaIdV1(['FM-2026-007.parquet'], 2027)).toBe('FM-2027-001');
  });

  it('新版：同一产品族+部件桶内递增', () => {
    const used = [
      'FM-A-A03-001-v01.parquet',
      'FM-A-A03-002-v01.parquet',
      'FM-A-A01-001-v01.parquet',
      'FM-B-B01-005-v01.parquet',
    ];
    expect(nextFmeaIdV2(used, 'A', 'A03')).toBe('FM-A-A03-003-v01');
    expect(nextFmeaIdV2(used, 'A', 'A01')).toBe('FM-A-A01-002-v01');
    expect(nextFmeaIdV2(used, 'B', 'B01')).toBe('FM-B-B01-006-v01');
    expect(nextFmeaIdV2([], 'A', 'A03')).toBe('FM-A-A03-001-v01');
  });

  it('新版：未分类产品族归入 U/U 桶', () => {
    const used = ['FM-U-U-007-v01.parquet', 'FM-U-U-002-v01.parquet'];
    expect(nextFmeaIdV2(used, 'U', 'U')).toBe('FM-U-U-008-v01');
  });

  it('新版：升版保持序号不变只加版本', () => {
    expect(bumpVersion('FM-A-A03-001-v01')).toBe('FM-A-A03-001-v02');
    expect(bumpVersion('FM-A-A03-001-v03')).toBe('FM-A-A03-001-v04');
    // 旧格式升版保旧格式
    expect(bumpVersion('FM-2026-015')).toBe('FM-2026-015');
  });

  it('formatFmeaIdV2 / formatFmeaIdV1 按规则生成', () => {
    expect(formatFmeaIdV2('A', 'A03', 1)).toBe('FM-A-A03-001-v01');
    expect(formatFmeaIdV2('U', 'U', 7, 3)).toBe('FM-U-U-007-v03');
    expect(formatFmeaIdV1(2026, 15)).toBe('FM-2026-015');
  });

  it('parseFmeaId 区分新旧格式', () => {
    const v2 = parseFmeaId('FM-A-A03-001-v01');
    expect(v2.isV2).toBe(true);
    expect(v2.family).toBe('A');
    expect(v2.part).toBe('A03');
    expect(v2.seq).toBe(1);
    expect(v2.version).toBe(1);

    const v1 = parseFmeaId('FM-2026-015');
    expect(v1.isV2).toBe(false);
    expect(v1.year).toBe(2026);
    expect(v1.seq).toBe(15);
    expect(v1.legacy).toBe('FM-2026-015');
  });

  it('productCodes 从产品大类/小类文本取代码', () => {
    expect(productCodes('A 空气滤清器总成', 'A03 滤芯总成')).toEqual({ family: 'A', part: 'A03' });
    expect(productCodes('U 未分类', '')).toEqual({ family: 'U', part: 'U' });
    // 只有大类没有小类 → 用大类+XX 兜底
    expect(productCodes('B 进气管道系统', '')).toEqual({ family: 'B', part: 'BXX' });
  });
});

describe('校验与序列化', () => {
  it('失效模式、建议措施必填，其余缺项只提示', () => {
    const v = validateFmeaDraft(emptyFmeaDraft());
    expect(v.errors.map((i) => i.field).sort()).toEqual(['action', 'failureMode']);
    expect(v.warnings.length).toBeGreaterThan(0);
  });

  it('草稿与记录可往返，编号与版本保持不变', () => {
    const draft = {
      ...emptyFmeaDraft(),
      machine: '车型A',
      part: '壳体',
      failureMode: '断裂',
      action: '加厚',
      recordDate: '2026-03-05',
    };
    const rec = buildFmeaRecord(draft, { id: 'FM-2026-001', sourceSheet: '2026年', username: 'u1', displayName: '张三' });
    const back = parseFmeaRecord(serializeFmeaRecord(rec));
    expect(back).not.toBeNull();
    expect(back?.id).toBe('FM-2026-001');
    expect(back?.revision).toBe(1);
    expect(back?.part).toBe('壳体');
  });

  it('升版时保留创建信息并累加版本', () => {
    const draft = { ...emptyFmeaDraft(), failureMode: '断裂', action: '加厚' };
    const first = buildFmeaRecord(draft, { id: 'FM-2026-002', username: 'u1' });
    const next = buildFmeaRecord({ ...draft, action: '加厚并增加加强筋' }, {
      id: first.id,
      username: 'u2',
      previous: first,
    });
    expect(next.revision).toBe(2);
    expect(next.createdBy).toBe('u1');
    expect(next.updatedBy).toBe('u2');
    expect(next.useCount).toBe(0);
  });

  it('入库自动补齐分类、风险等级、结论与设计规避', () => {
    const rec = buildFmeaRecord(
      {
        ...emptyFmeaDraft(),
        machine: '车型A',
        part: '空滤器壳体',
        failureMode: '卡扣根部开裂',
        failureEffect: '密封失效，客户抱怨',
        failureCause: '注塑工艺导致熔接痕位于受力根部',
        action: '壁厚 1.5→2.0 mm；浇口移至非受力侧；增加圆角',
        severity: '8',
        occurrence: '5',
        detection: '3',
      },
      { id: 'FM-2026-003', username: 'u1' },
    );
    expect(rec.failureCategory).toBe('开裂');
    expect(rec.causeCategory).toBe('工艺');
    expect(rec.riskLevel).toBe('高'); // 8×5×3=120
    expect(rec.conclusion.length).toBeLessThanOrEqual(40);
    expect(rec.designGuide.split('\n')).toHaveLength(3);
  });
});

describe('风险分级与失效分类', () => {
  it('有 S/O/D 时按 RPN 分级', () => {
    const base = emptyFmeaDraft();
    expect(deriveRiskLevel({ ...base, severity: '8', occurrence: '5', detection: '3' })).toBe('高');
    expect(deriveRiskLevel({ ...base, severity: '5', occurrence: '3', detection: '3' })).toBe('中');
    expect(deriveRiskLevel({ ...base, severity: '2', occurrence: '2', detection: '2' })).toBe('低');
  });

  it('没有评分时按后果定性判定', () => {
    const base = emptyFmeaDraft();
    expect(deriveRiskLevel({ ...base, failureEffect: '存在安全隐患，可能召回' })).toBe('高');
    expect(deriveRiskLevel({ ...base, failureEffect: '客户抱怨异响' })).toBe('中');
    expect(deriveRiskLevel({ ...base, failureEffect: '外观喷霜' })).toBe('低');
  });

  it('按失效模式文字归类', () => {
    const base = emptyFmeaDraft();
    expect(deriveFailureCategory({ ...base, failureMode: '卡扣根部开裂' })).toBe('开裂');
    expect(deriveFailureCategory({ ...base, failureMode: '总成脱落' })).toBe('脱落');
    expect(deriveFailureCategory({ ...base, failureMode: '壳体漏气' })).toBe('泄漏');
    expect(deriveFailureCategory({ ...base, failureMode: '怠速异响' })).toBe('异响');
  });

  it('结论不超过 40 字，设计规避最多 3 条', () => {
    const draft = {
      ...emptyFmeaDraft(),
      failureMode: '卡扣根部断裂并伴随密封面变形导致整车密封失效',
      failureEffect: '客户抱怨漏水',
      action: '加厚；增加圆角；调整浇口；增加检测',
    };
    expect(deriveConclusion(draft).length).toBeLessThanOrEqual(40);
    expect(deriveDesignGuide(draft).split('\n')).toHaveLength(3);
  });
});

describe('同义词检索', () => {
  it('标准词与同义词互查', () => {
    expect(expandFmeaTerms('漏油')).toContain('泄漏');
    expect(expandFmeaTerms('裂纹')).toContain('开裂');
  });

  it('相关度评分：标准词命中的案例得分更高', () => {
    const rec = buildFmeaRecord(
      { ...emptyFmeaDraft(), failureMode: '壳体渗漏', action: '更换密封圈' },
      { id: 'FM-2026-010', username: 'u1' },
    );
    expect(scoreFmeaRecord(rec, '漏油').score).toBeGreaterThan(0);
    expect(scoreFmeaRecord(rec, '完全无关').score).toBe(0);
  });
});

describe('导入清洗', () => {
  it('占位行不入库', () => {
    const draft = { ...emptyFmeaDraft(), machine: '车型A', failureMode: '插入图片', action: '文字描述' };
    expect(isPlaceholderDraft(draft)).toBe(true);
  });

  it('同一批数据中相同案例只保留一条', () => {
    const res = parseFmeaRows([HEADER, row(), row()], '2026年');
    expect(res.rows).toHaveLength(1);
    expect(res.warnings.some((w) => w.includes('重复'))).toBe(true);
    expect(fmeaDedupeKey(res.rows[0].draft)).toContain('车型a');
  });

  it('占位行被跳过并计入 skipped', () => {
    const res = parseFmeaRows(
      [HEADER, row(), row({ 潜在的失效模式: '责任人填写', 建议的措施: '插入图片' })],
      '2026年',
    );
    expect(res.rows).toHaveLength(1);
    expect(res.skipped).toBe(1);
  });
});

describe('引用记录与相似案例', () => {
  it('引用记录可随记录序列化往返', () => {
    const rec = buildFmeaRecord(
      { ...emptyFmeaDraft(), part: '壳体', failureMode: '开裂', action: '加厚' },
      { id: 'FM-2026-020', username: 'u1' },
    );
    const cited = {
      ...rec,
      citations: [
        { projectId: 'p1', projectName: '客户A 空滤器', username: 'u1', displayName: '张三', at: '2026-05-01T02:00:00.000Z' },
      ],
    };
    const back = parseFmeaRecord(serializeFmeaRecord(cited));
    expect(back?.citations).toHaveLength(1);
    expect(back?.citations[0].projectName).toBe('客户A 空滤器');
  });

  it('相似案例：同产品族 > 同失效编码 > 同 AP，同分时 AP 更紧急的排前', () => {
    const base = { ...emptyFmeaDraft(), failureMode: '开裂', severity: '8', occurrence: '6', detection: '9' };
    // A-A03 空滤器/滤芯 同产品族同部件
    const target = buildFmeaRecord({ ...base, part: '滤芯总成', productCategory: 'A 空气滤清器总成', productSubCategory: 'A03 滤芯总成', failureCode: 'F03 结构失效', apLevel: 'H' }, { id: 'FM-A-A03-001-v01', username: 'u1' });
    const sameFamilySamePart = buildFmeaRecord({ ...base, part: '滤芯总成', productCategory: 'A 空气滤清器总成', productSubCategory: 'A03 滤芯总成', failureCode: 'F03 结构失效', apLevel: 'M' }, { id: 'FM-A-A03-002-v01', username: 'u1' });
    const sameFamilyDiffPart = buildFmeaRecord({ ...base, part: '上壳体', productCategory: 'A 空气滤清器总成', productSubCategory: 'A01 上壳体', failureCode: 'F02 外观失效', apLevel: 'L' }, { id: 'FM-A-A01-001-v01', username: 'u1' });
    const diffFamily = buildFmeaRecord({ ...base, part: '谐振腔', productCategory: 'D 消声与谐振', productSubCategory: 'D01 Helmholtz 谐振腔', failureCode: 'F03 结构失效', apLevel: 'H' }, { id: 'FM-D-D01-001-v01', username: 'u1' });
    const list = similarFmeaRecords(target, [target, sameFamilySamePart, sameFamilyDiffPart, diffFamily], 3);
    // 同产品族+同部件+同失效编码 应该排在最前
    expect(list[0].record.id).toBe('FM-A-A03-002-v01');
    // 验证 hits 列表内容
    expect(list[0].hits).toEqual(expect.arrayContaining(['同产品族', '同失效模式编码', '同产品小类', '同部件名称', '同失效模式主词']));
    // diffFamily 虽然失效编码相同，但产品族不同，分数应该低于同产品族的
    const sameFamilyScore = list.find((r) => r.record.id === 'FM-A-A01-001-v01')?.score ?? 0;
    const diffFamilyScore = list.find((r) => r.record.id === 'FM-D-D01-001-v01')?.score ?? 0;
    expect(sameFamilyScore).toBeGreaterThan(diffFamilyScore);
  });
});

describe('三维分类（产品 / 失效模式 / 原因）', () => {
  it('按部件名称归类到大类与小类', () => {
    expect(classifyProduct('空滤器上壳体')).toEqual({ major: 'A 空气滤清器总成', minor: 'A01 上壳体' });
    expect(classifyProduct('进气波纹管')).toEqual({ major: 'B 进气管道系统', minor: 'B05 波纹管' });
    expect(classifyProduct('谐振腔')).toEqual({ major: 'D 消声与谐振', minor: 'D01 Helmholtz 谐振腔' });
    expect(classifyProduct('滤芯')).toEqual({ major: 'E 滤芯与过滤介质', minor: 'E06 滤芯总成' });
    expect(classifyProduct('O 形圈')).toEqual({ major: 'F 密封、连接与固定', minor: 'F01 O 形圈' });
  });

  it('识别不到小类时退回大类，完全无法识别归入未分类', () => {
    expect(classifyProduct('空滤器总成')).toEqual({ major: 'A 空气滤清器总成', minor: '' });
    expect(classifyProduct('') ).toEqual({ major: 'U 未分类', minor: '' });
  });

  it('旧记录没有编码时按部件即时推导产品分类', () => {
    const rec = buildFmeaRecord(
      { ...emptyFmeaDraft(), part: '进气波纹管', failureMode: '开裂', action: '加厚' },
      { id: 'FM-2026-030', username: 'u1' },
    );
    expect(productMajorOf(rec)).toBe('B 进气管道系统');
    expect(productMinorOf(rec)).toBe('B05 波纹管');
  });

  it('失效模式编码优先匹配更具体的现象', () => {
    const base = emptyFmeaDraft();
    expect(deriveFailureCode({ ...base, failureMode: '卡扣根部开裂' })).toBe('F01 开裂/断裂');
    expect(deriveFailureCode({ ...base, failureMode: '振动疲劳开裂' })).toBe('F12 振动疲劳');
    expect(deriveFailureCode({ ...base, failureMode: '管路结冰堵塞' })).toBe('F15 结冰/冷凝/吸水');
    expect(deriveFailureCode({ ...base, failureCause: 'MAF 传感器信号漂移' })).toBe('F17 电气/传感器失效');
  });

  it('原因编码按设计/材料/工艺/制造细分', () => {
    const base = emptyFmeaDraft();
    expect(deriveCauseCode({ ...base, failureCause: '卡扣根部圆角不足' })).toBe('D03 卡扣/锁止设计不当');
    expect(deriveCauseCode({ ...base, failureCause: '材料牌号耐温等级不足' })).toBe('M03 耐温/耐油/耐水解不足');
    expect(deriveCauseCode({ ...base, failureCause: '注塑工艺导致熔接痕位于受力根部' })).toBe('P01 注塑温度/压力/保压/冷却');
    expect(deriveCauseCode({ ...base, failureCause: '模具磨损导致尺寸波动' })).toBe('Mf02 模具磨损/维修');
    expect(deriveCauseCode({ ...base, failureCause: '进气口布置不合理，易吸入雨水' })).toBe('D12 进气口布置不合理');
  });

  it('入库自动补齐产品分类、失效模式编码与原因编码', () => {
    const rec = buildFmeaRecord(
      {
        ...emptyFmeaDraft(),
        part: '空滤器上壳体',
        failureMode: '卡扣根部断裂',
        failureCause: '卡扣根部壁厚不足',
        action: '壁厚 1.5→2.0 mm',
      },
      { id: 'FM-2026-031', username: 'u1' },
    );
    expect(rec.productCategory).toBe('A 空气滤清器总成');
    expect(rec.productSubCategory).toBe('A01 上壳体');
    expect(rec.failureCode).toBe('F01 开裂/断裂');
    expect(rec.causeCode.startsWith('D')).toBe(true);
  });
});

describe('导入质量清单 analyzeImportedRecords', () => {
  type FmeaDraftLocal = ReturnType<typeof emptyFmeaDraft>;
  const row = (overrides: { draft: Record<string, unknown>; sourceSheet?: string; rowNumber?: number }) => {
    const base = emptyFmeaDraft();
    const merged = { ...base, ...overrides.draft } as FmeaDraftLocal;
    return {
      draft: merged,
      sourceSheet: overrides.sourceSheet || 'Sheet1',
      rowNumber: overrides.rowNumber ?? 1,
    };
  };

  it('完整数据 → 零问题 + 产品族分布', () => {
    const rows = [
      row({
        rowNumber: 2,
        sourceSheet: '空滤器',
        draft: {
          part: '滤芯总成',
          machine: 'CT110',
          failureMode: '高压下开裂',
          failureCause: '壁厚不足',
          failureEffect: '过滤效率下降',
          severity: '8',
          occurrence: '5',
          detection: '6',
          riskLevel: '高',
          action: '加厚 0.5mm',
          owner: '张三',
          recordDate: '2026-05-01',
          failureModeMaster: '开裂',
          failureCauseMaster: '壁厚不足',
          failureEffectMaster: '过滤性能下降',
        },
      }),
      row({
        rowNumber: 5,
        sourceSheet: '消声器',
        draft: {
          part: '消声器',
          machine: 'CT120',
          failureMode: '内部异响',
          failureCause: '焊接缺陷',
          failureEffect: 'NVH 抱怨',
          severity: '7',
          occurrence: '4',
          detection: '5',
          riskLevel: '中',
          action: '补焊',
          owner: '李四',
          recordDate: '2026-05-02',
          failureModeMaster: '异响',
          failureCauseMaster: '焊接缺陷',
          failureEffectMaster: '抱怨',
        },
      }),
    ];
    const a = analyzeImportedRecords(rows);
    expect(a.totalRows).toBe(2);
    expect(a.missingRatings).toBe(0);
    expect(a.unclassifiedFamily).toBe(0);
    expect(a.unclassifiedMinor).toBe(0);
    expect(a.missingAction).toBe(0);
    expect(a.issues).toEqual([]);
    // 产品族分布：滤芯总成归入 A，消声器归入 D
    const famMajors = a.familyBreakdown.map((fb) => fb.major);
    expect(famMajors).toContain('A 空气滤清器总成');
    expect(famMajors).toContain('D 消声与谐振');
  });

  it('缺 S/O/D + 产品族未匹配 + 缺措施 → 正确计数 + 明细', () => {
    const rows = [
      row({
        rowNumber: 12,
        sourceSheet: '杂项',
        draft: {
          part: '奇怪部件', // 无法匹配 → 归入 U
          failureMode: '有问题',
          failureCause: '不知道为什么',
          failureEffect: '会坏',
          action: '', // 缺建议措施
        },
      }),
    ];
    const a = analyzeImportedRecords(rows);
    expect(a.totalRows).toBe(1);
    expect(a.missingRatings).toBe(1);
    expect(a.unclassifiedFamily).toBe(1);
    expect(a.missingAction).toBe(1);
    expect(a.familyBreakdown.find((fb) => fb.major.startsWith('U'))?.count).toBe(1);
    // 明细
    expect(a.issues.length).toBe(1);
    expect(a.issues[0].rowNumber).toBe(12);
    expect(a.issues[0].sourceSheet).toBe('杂项');
    expect(a.issues[0].issues).toEqual(
      expect.arrayContaining([
        '产品族未匹配',
        '缺 S/O/D 评分',
        '缺建议措施',
      ]),
    );
  });

  it('超过 20 条问题行 → issues 截断到前 20', () => {
    const many: ReturnType<typeof row>[] = [];
    for (let i = 0; i < 30; i++) {
      many.push(row({
        rowNumber: i + 1,
        sourceSheet: '杂项',
        draft: { part: '奇怪', failureMode: `模式${i}` },
      }));
    }
    const a = analyzeImportedRecords(many);
    expect(a.totalRows).toBe(30);
    expect(a.issues.length).toBe(20); // 截断
  });
});

describe('一键补全 fillMissingStructured', () => {
  type LD = ReturnType<typeof emptyFmeaDraft>;
  const make = (overrides: Partial<LD>) => ({ ...emptyFmeaDraft(), ...overrides });

  it('有 AP H → 风险等级自动变"高"（AP 优先于 RPN）', () => {
    const draft = make({
      failureMode: '开裂',
      failureEffect: '影响功能',
      severity: '4', occurrence: '4', detection: '4',
      apLevel: 'H' as LD['apLevel'],
    });
    const patched = fillMissingStructured(draft);
    expect(patched.riskLevel).toBe('高');
    expect(patched.conclusion).toBeTruthy();
  });

  it('有 S/O/D 但没 AP → 自动算 AP 再推风险等级', () => {
    const draft = make({
      failureMode: '断裂',
      failureEffect: '安全风险',
      severity: '10', occurrence: '9', detection: '8',
    });
    const patched = fillMissingStructured(draft);
    expect(patched.apLevel).toBe('H');
    expect(patched.riskLevel).toBe('高');
  });

  it('无 S/O/D 但有 RPN → 降级用 RPN 推（RPN>=100 高）', () => {
    const draft = make({
      failureMode: '开裂',
      failureEffect: '影响外观',
      severity: '8', occurrence: '8', detection: '2',
    });
    const patched = fillMissingStructured(draft);
    expect(patched.riskLevel).toBe('高');
  });

  it('无 S/O/D 无 AP 但后果有"返修/抱怨" → 关键词推"中"', () => {
    const draft = make({
      failureMode: '异响',
      failureEffect: '用户抱怨返修',
    });
    const patched = fillMissingStructured(draft);
    expect(patched.riskLevel).toBe('中');
  });

  it('不覆写用户已填字段', () => {
    const draft = make({
      failureMode: '开裂',
      severity: '10', occurrence: '10', detection: '10',
      riskLevel: '低' as LD['riskLevel'],
      conclusion: '用户自己填的结论',
    });
    const patched = fillMissingStructured(draft);
    expect(patched.riskLevel).toBe('低');
    expect(patched.conclusion).toBe('用户自己填的结论');
  });

  it('全空条目 → 风险等级兜底"中"，其他字段填空', () => {
    const draft = make({});
    const patched = fillMissingStructured(draft);
    expect(patched.riskLevel).toBe('中');
    expect(patched.apLevel).toBe('');
    expect(patched.conclusion).toBe('');
    expect(patched.designGuide).toBe('');
  });
});

describe('标准词表归并 applyMasterVocabulary', () => {
  const draft = () => ({
    ...emptyFmeaDraft(),
    failureMode: '开裂',
    failureCause: '壁厚不足',
    failureEffect: '功能失效',
  });
  const makeRec = () => buildFmeaRecord(draft(), { id: 'FM-A-A03-001-v01', username: 'u1' });
  /** 模拟历史数据：原文有值但主词为空 */
  const legacyRec = () => {
    const base = makeRec();
    return {
      ...base,
      failureModeMaster: '' as typeof base.failureModeMaster,
      failureCauseMaster: '' as typeof base.failureCauseMaster,
      failureEffectMaster: '' as typeof base.failureEffectMaster,
    };
  };

  it('从原文归并出主词，且原文保持不变', () => {
    const rec = legacyRec();
    const { record, changedFields } = applyMasterVocabulary(rec);
    expect(changedFields).toContain('failureModeMaster');
    expect(record.failureModeMaster).toBe('破裂'); // 开裂 → 破裂
    expect(record.failureMode).toBe('开裂'); // 原文不被覆写
  });

  it('匹配不到标准词时保留原主词，不产生变更', () => {
    const baseRec = makeRec();
    const rec = {
      ...baseRec,
      failureMode: '一种完全无法识别的奇怪描述XYZ',
      failureModeMaster: '破裂' as typeof baseRec.failureModeMaster,
    };
    const { record, changedFields } = applyMasterVocabulary(rec);
    expect(changedFields).not.toContain('failureModeMaster');
    expect(record.failureModeMaster).toBe('破裂');
  });

  it('重复执行幂等：第二次不再产生变更', () => {
    const first = applyMasterVocabulary(legacyRec()).record;
    const second = applyMasterVocabulary(first);
    expect(second.changedFields).toHaveLength(0);
    expect(second.record.failureModeMaster).toBe(first.failureModeMaster);
  });
});

describe('状态机 FmeaStatus', () => {
  it('draft 可以去 review 或 archived', () => {
    expect(allowedNextStatuses('draft').sort()).toEqual(['archived', 'review'].sort());
  });
  it('review 可以去 published / draft / archived', () => {
    expect(allowedNextStatuses('review').sort()).toEqual(['archived', 'draft', 'published'].sort());
  });
  it('published 可以去 archived / review', () => {
    expect(allowedNextStatuses('published').sort()).toEqual(['archived', 'review'].sort());
  });
  it('archived 只能去 review（重新发起评审）', () => {
    expect(allowedNextStatuses('archived')).toEqual(['review']);
  });

  it('tryTransitStatus 成功返回 ok:true + entry', () => {
    const r = tryTransitStatus('draft', 'review', '张三', '准备评审');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.newStatus).toBe('review');
      expect(r.entry.from).toBe('draft');
      expect(r.entry.to).toBe('review');
      expect(r.entry.by).toBe('张三');
      expect(r.entry.note).toBe('准备评审');
      expect(r.entry.at).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO 时间格式
    }
  });

  it('tryTransitStatus 不允许的跳转返回 ok:false + reason', () => {
    const r = tryTransitStatus('draft', 'published', '张三');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不允许');
  });

  it('tryTransitStatus 同状态返回失败', () => {
    const r = tryTransitStatus('draft', 'draft', '张三');
    expect(r.ok).toBe(false);
  });

  it('buildFmeaRecord 默认 status = draft，statusHistory 为空', () => {
    const rec = buildFmeaRecord({ ...emptyFmeaDraft(), failureMode: 'X', action: 'Y' }, {
      id: 'FM-TEST-001',
      username: 'u1',
    });
    expect(rec.status).toBe('draft');
    expect(rec.statusHistory).toEqual([]);
  });

  it('状态转换后追加历史记录，时间倒序查看最新操作', () => {
    const rec = buildFmeaRecord({ ...emptyFmeaDraft(), failureMode: 'X', action: 'Y' }, {
      id: 'FM-TEST-002',
      username: 'u1',
    });
    const step1 = tryTransitStatus('draft', 'review', '张三', '提交评审');
    expect(step1.ok).toBe(true);
    let updated: typeof rec = {
      ...rec,
      status: (step1.ok ? step1.newStatus : rec.status),
      statusHistory: [...rec.statusHistory, ...(step1.ok ? [step1.entry] : [])],
    };
    const step2 = tryTransitStatus('review', 'published', '李质量', '评审通过');
    expect(step2.ok).toBe(true);
    updated = {
      ...updated,
      status: (step2.ok ? step2.newStatus : updated.status),
      statusHistory: [...updated.statusHistory, ...(step2.ok ? [step2.entry] : [])],
    };
    expect(updated.status).toBe('published');
    expect(updated.statusHistory).toHaveLength(2);
    expect(updated.statusHistory[0].to).toBe('review');
    expect(updated.statusHistory[1].to).toBe('published');
    expect(updated.statusHistory[1].note).toBe('评审通过');
  });
});
