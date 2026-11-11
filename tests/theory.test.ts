import { describe, expect, it } from 'vitest';
import {
  guessTheoryCategory,
  normalizeTheoryDate,
  parseTheoryFileName,
  THEORY_CATEGORIES,
} from '../src/report/theory';

describe('知识理论文件名识别', () => {
  it('识别「日期_作者_资料名」', () => {
    const r = parseTheoryFileName('2026-05-12_张三_空滤器流阻分析.pptx');
    expect(r.publishedAt).toBe('2026-05-12');
    expect(r.author).toBe('张三');
    expect(r.title).toBe('空滤器流阻分析');
  });

  it('识别紧凑日期与资料名在前的写法', () => {
    const r = parseTheoryFileName('进气系统噪声控制_李四_20260512.docx');
    expect(r.publishedAt).toBe('2026-05-12');
    expect(r.author).toBe('李四');
    expect(r.title).toBe('进气系统噪声控制');
  });

  it('没有日期时仍能区分作者与资料名', () => {
    const r = parseTheoryFileName('王五_多腔消音器理论.pdf');
    expect(r.publishedAt).toBe('');
    expect(r.author).toBe('王五');
    expect(r.title).toBe('多腔消音器理论');
  });

  it('只有资料名时不误判为作者', () => {
    const r = parseTheoryFileName('CAE 分析基础.pdf');
    expect(r.author).toBe('');
    expect(r.title).toBe('CAE 分析基础');
  });

  it('日期规范化拒绝非法月份', () => {
    expect(normalizeTheoryDate('2026-13-01')).toBe('');
    expect(normalizeTheoryDate('2026年5月2日')).toBe('2026-05-02');
  });
});

describe('知识理论类别', () => {
  it('类别字典固定为五类', () => {
    expect(THEORY_CATEGORIES).toEqual(['结构', '流体', 'NVH', '热力学', '通用理论']);
  });

  it('按关键词猜测类别', () => {
    expect(guessTheoryCategory('热管理系统散热分析')).toBe('热力学');
    expect(guessTheoryCategory('进气噪声控制')).toBe('NVH');
    expect(guessTheoryCategory('流阻与压降计算')).toBe('流体');
    expect(guessTheoryCategory('支架强度与模态')).toBe('结构');
    expect(guessTheoryCategory('理论综述')).toBe('通用理论');
    expect(guessTheoryCategory('未命名资料')).toBe('');
  });

  it('文件名识别时顺带给出类别', () => {
    expect(parseTheoryFileName('2026-05-12_张三_热管理散热分析.pptx').category).toBe('热力学');
  });
});
