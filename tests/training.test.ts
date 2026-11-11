import { describe, expect, it } from 'vitest';
import { normalizeTrainingDate, parseTrainingCoverText, parseTrainingFileName } from '../src/report/training';

describe('培训资料文件名识别', () => {
  it('识别「培训时间_培训人_资料名」', () => {
    const r = parseTrainingFileName('2026-05-12_张三_空滤器设计规范.pptx');
    expect(r.trainedAt).toBe('2026-05-12');
    expect(r.trainer).toBe('张三');
    expect(r.title).toBe('空滤器设计规范');
  });

  it('识别紧凑日期与资料名在前的写法', () => {
    const r = parseTrainingFileName('进气系统阻力设计_李四_20260512.docx');
    expect(r.trainedAt).toBe('2026-05-12');
    expect(r.trainer).toBe('李四');
    expect(r.title).toBe('进气系统阻力设计');
  });

  it('没有日期时仍能区分培训人与资料名', () => {
    const r = parseTrainingFileName('王五_多腔消音器培训.pdf');
    expect(r.trainedAt).toBe('');
    expect(r.trainer).toBe('王五');
    expect(r.title).toBe('多腔消音器培训');
  });

  it('只有资料名时不误判为培训人', () => {
    const r = parseTrainingFileName('CAE 分析基础.pdf');
    expect(r.trainer).toBe('');
    expect(r.title).toBe('CAE 分析基础');
  });

  it('日期规范化拒绝非法月份', () => {
    expect(normalizeTrainingDate('2026-13-01')).toBe('');
    expect(normalizeTrainingDate('2026年5月2日')).toBe('2026-05-02');
  });
});

describe('培训资料封面识别', () => {
  it('识别带标签的培训人与培训时间', () => {
    const r = parseTrainingCoverText('空滤器设计规范\n培训人：张三\n培训时间：2026年5月12日');
    expect(r.trainer).toBe('张三');
    expect(r.trainedAt).toBe('2026-05-12');
  });

  it('支持讲师/主讲等标签与日期无标签的写法', () => {
    const r = parseTrainingCoverText('进气系统 NVH 培训\n讲师 李四\n2026.5.12');
    expect(r.trainer).toBe('李四');
    expect(r.trainedAt).toBe('2026-05-12');
  });

  it('标签与姓名分处两行时可识别', () => {
    const r = parseTrainingCoverText('多腔穿孔消音器\n培训人：\n王小明\n授课时间：2026-05-12');
    expect(r.trainer).toBe('王小明');
    expect(r.trainedAt).toBe('2026-05-12');
  });

  it('姓名后带职务时只取姓名', () => {
    const r = parseTrainingCoverText('培训人：赵六 高级工程师\n培训日期：2026/05/12');
    expect(r.trainer).toBe('赵六');
    expect(r.trainedAt).toBe('2026-05-12');
  });

  it('封面没有标签时只取第一个完整日期，不臆造培训人', () => {
    const r = parseTrainingCoverText('空滤器培训\n2026年5月12日\n技术中心');
    expect(r.trainer).toBe('');
    expect(r.trainedAt).toBe('2026-05-12');
  });
});
