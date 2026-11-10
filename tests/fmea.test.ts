import { describe, expect, it } from 'vitest';
import {
  buildFmeaRecord,
  emptyFmeaDraft,
  fmeaTemplateCsv,
  nextFmeaId,
  normalizeRecordDate,
  parseFmeaCsv,
  parseFmeaRecord,
  parseFmeaRows,
  serializeFmeaRecord,
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
    潜在的失效起因/机理: '根部壁厚不足',
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
});

describe('编号', () => {
  it('同年顺延，跨年重新从 001 开始', () => {
    expect(nextFmeaId([], 2026)).toBe('FM-2026-001');
    expect(nextFmeaId(['FM-2026-001.parquet', 'FM-2026-007.parquet', 'FM-2025-030.parquet'], 2026)).toBe(
      'FM-2026-008',
    );
    expect(nextFmeaId(['FM-2026-007.parquet'], 2027)).toBe('FM-2027-001');
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
});
