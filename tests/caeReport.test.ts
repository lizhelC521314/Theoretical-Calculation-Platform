import { describe, expect, it } from 'vitest';
import { archiveCaeFileName, parseCaeArchiveName } from '../src/report/db';
import {
  caeItemFromFileName,
  missingCaeMetaFields,
  parseCaeMeta,
  parseCaeOcrMeta,
} from '../src/report/caeReport';

/**
 * CAE 报告元信息解析：
 * 与试验报告保持一致——客户取「客户名称」并截到「XX汽车」，
 * 项目/产品按零件名称拆分，仿真项目优先显式标签、其次封面「项目名称」、最后文件名关键字。
 */

describe('CAE 报告：文字版解析', () => {
  const TEXT = [
    'CAE 分析报告',
    '客户名称：长城汽车股份有限公司',
    '零件名称：B26-A 进气系统',
    '项目名称：进气阻力仿真分析',
    '产品名称：空气滤清器总成',
    '版本号：V1.0',
    '报告日期：2026年10月20日',
  ].join('\n');

  it('识别客户 / 项目 / 产品 / 版本 / 日期', () => {
    const meta = parseCaeMeta(TEXT, 'B26-A 进气系统 CAE 报告.pdf');
    expect(meta.customer).toBe('长城汽车');
    expect(meta.project).toBe('B26-A');
    expect(meta.product).toBe('空气滤清器总成');
    expect(meta.version).toBe('V1.0');
    expect(meta.date).toBe('2026-10-20');
  });

  it('仿真项目取封面「项目名称」一栏', () => {
    const meta = parseCaeMeta(TEXT, 'x.pdf');
    expect(meta.caeItem).toBe('进气阻力仿真分析');
  });

  it('显式「仿真项目」标签优先于「项目名称」', () => {
    const meta = parseCaeMeta(
      ['仿真项目：结构强度校核', '项目名称：进气阻力仿真分析', '客户名称：重庆长安汽车股份有限公司'].join('\n'),
      'x.pdf',
    );
    expect(meta.caeItem).toBe('结构强度校核');
    expect(meta.customer).toBe('重庆长安汽车');
  });

  it('「项目名称」是项目代号时不当作仿真项目，而作为项目', () => {
    const meta = parseCaeMeta('项目名称：CS75-2025\n客户名称：长安汽车', 'x.pdf');
    expect(meta.caeItem).toBe('');
    expect(meta.project).toBe('CS75-2025');
  });

  it('仿真项目缺失时按文件名关键字兜底', () => {
    const meta = parseCaeMeta('客户名称：长城汽车股份有限公司\n版本号：V1.0', 'B26-A进气系统流场分析.pdf');
    expect(meta.caeItem).toBe('流场');
  });

  it('零件名称只有中文时项目与产品同名', () => {
    const meta = parseCaeMeta('零件名称：空气滤清器总成\n客户名称：长城汽车股份有限公司', 'x.pdf');
    expect(meta.project).toBe('空气滤清器总成');
    expect(meta.product).toBe('空气滤清器总成');
  });

  it('缺失字段检查', () => {
    expect(missingCaeMetaFields({ customer: '长城汽车', project: 'B26-A', caeItem: '', product: '', version: 'V1.0', date: '' })).toEqual(['产品', '日期']);
  });

  it('常见分析项关键字识别', () => {
    expect(caeItemFromFileName('SC6HAU进气系统阻力报告.pdf')).toBe('进气系统阻力');
    expect(caeItemFromFileName('某项目CAE分析.pdf')).toBe('CAE分析');
  });
});

describe('CAE 报告：扫描件 OCR 解析', () => {
  const OCR = [
    '编 号 No ： SYZ GW · 26 一 081901',
    '零 件 名 称 ： B26-A 进 气 系 统',
    '项 目 名 称 ： 进 气 阻 力 仿 真 分 析',
    '产 品 名 称 ： 空 气 滤 清 器 总 成',
    '版 本 号 ： V1.0',
    '客 户 名 称 ： 长 城 汽 车 股 份 有 限 公 司',
  ].join('\n');

  it('封面 OCR：客户规范化为「长城汽车」，日期取页眉编号', () => {
    const meta = parseCaeOcrMeta(OCR, 'B26-A进气阻力.pdf');
    expect(meta.customer).toBe('长城汽车');
    expect(meta.project).toBe('B26-A');
    expect(meta.caeItem).toBe('进气阻力仿真分析');
    expect(meta.product).toBe('空气滤清器总成');
    expect(meta.version).toBe('V1.0');
    expect(meta.date).toMatch(/\d{4}-08-19/);
  });
});

describe('CAE 归档文件名', () => {
  it('生成「客户+项目+仿真项目+产品+版本+日期.pdf」', () => {
    expect(
      archiveCaeFileName('长城汽车', 'B26-A', '进气阻力仿真分析', '进气系统', 'V1.0', '2026-10-20'),
    ).toBe('长城汽车+B26-A+进气阻力仿真分析+进气系统+V1.0+20261020.pdf');
  });

  it('文件名反解元信息', () => {
    const p = parseCaeArchiveName('长城汽车+B26-A+进气阻力仿真分析+进气系统+V1.0+20261020.pdf');
    expect(p).toEqual({
      customer: '长城汽车',
      project: 'B26-A',
      caeItem: '进气阻力仿真分析',
      product: '进气系统',
      version: 'V1.0',
      date: '20261020',
    });
  });
});
