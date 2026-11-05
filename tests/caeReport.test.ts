import { describe, expect, it } from 'vitest';
import { archiveCaeFileName, parseCaeArchiveName } from '../src/report/db';
import {
  caeItemFromFileName,
  caeItemFromTitle,
  caeNeedsFlow,
  missingCaeMetaFields,
  parseCaeFileName,
  parseCaeFlow,
  parseCaeMeta,
  parseCaeOcrMeta,
  parseCaeTitle,
} from '../src/report/caeReport';

/**
 * CAE 报告元信息解析：
 * 封面标题为主——客户取标题开头的中文（遇到字母/数字/特殊符号结束），
 * 仿真项目取标题中命中的分析类型，产品取标题中「项目与仿真项目之间」的文字（去掉「的」）；
 * 项目维持原有解析（项目代号/零件名称拆分/文件名）；
 * 日期与版本只从封面下部「时间」「版本」右侧读取，不从标题或文件名兜底。
 */

describe('CAE 报告：文字版解析', () => {
  const TEXT = [
    'CAE 分析报告',
    '客户名称：长城汽车股份有限公司',
    '零件名称：B26-A 进气系统',
    '项目名称：进气阻力仿真分析',
    '产品名称：空气滤清器总成',
    '版本号：V1.0',
    '时   间：2026年10月20日',
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
    expect(meta.caeItem).toBe('流场分析');
  });

  it('零件名称只有中文时项目与产品同名', () => {
    const meta = parseCaeMeta('零件名称：空气滤清器总成\n客户名称：长城汽车股份有限公司', 'x.pdf');
    expect(meta.project).toBe('空气滤清器总成');
    expect(meta.product).toBe('空气滤清器总成');
  });

  it('缺失字段检查', () => {
    expect(
      missingCaeMetaFields({
        customer: '长城汽车',
        project: 'B26-A',
        caeItem: '',
        flow: '',
        flowUnit: '',
        product: '',
        version: 'V1.0',
        date: '',
      }),
    ).toEqual(['产品', '日期']);
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
    '时 间 ： 2026 - 08 - 19',
    '客 户 名 称 ： 长 城 汽 车 股 份 有 限 公 司',
  ].join('\n');

  it('封面 OCR：客户规范化为「长城汽车」，日期取封面「时间」右侧', () => {
    const meta = parseCaeOcrMeta(OCR, 'B26-A进气阻力.pdf');
    expect(meta.customer).toBe('长城汽车');
    expect(meta.project).toBe('B26-A');
    expect(meta.caeItem).toBe('进气阻力仿真分析');
    expect(meta.product).toBe('空气滤清器总成');
    expect(meta.version).toBe('V1.0');
    expect(meta.date).toBe('2026-08-19');
  });
});

describe('CAE 报告：PPT 转文字版 PDF 的实际版面', () => {
  // 上汽 AS5PM 报告由 PowerPoint 导出 PDF 后，首页文字层实况：
  // 标签被拉开成「版   本」「时   间」，没有「客户名称 / 产品名称」字段，
  // 客户、产品、仿真项目需要从文件名补齐
  const PPT_TEXT = [
    '上汽 AS5PM 出气谐振器支架强度分析报告',
    '项目代号：   AS5PM',
    '分析人员：   叶云江',
    '设计人员：   邱劲超',
    '审   核：   谢崇磊',
    '时   间：   2026-10-29',
    '版   本：   AS5PM-V1',
  ].join('\n');

  it('从 PPT 导出 PDF 的文字识别全部字段：标题优先', () => {
    const meta = parseCaeMeta(PPT_TEXT, '上汽 AS5PM 出气谐振器强度分析报告-V1-20261029.pptx');
    expect(meta.customer).toBe('上汽');
    expect(meta.project).toBe('AS5PM');
    // 产品取标题中「项目 AS5PM」与「分析类型 强度」之间的文字
    expect(meta.product).toBe('出气谐振器支架');
    expect(meta.caeItem).toBe('强度');
    expect(meta.version).toBe('V1');
    expect(meta.date).toBe('2026-10-29');
  });

  it('PPT 版面：标签与值分行时，日期取「时间」下方内容', () => {
    const text = [
      '东安动力DHR50T油滤器CFD分析报告',
      '项目代号：',
      'DHR50T',
      '分析人员：',
      '黄悦',
      '设计人员：',
      '徐海涛',
      '审       核：',
      '谢崇磊',
      '时       间：',
      '2026-10-29',
      '版       本：',
      'DHR50T-V1',
    ].join('\n');
    const meta = parseCaeMeta(text, '东安动力 DHR50T 油滤器CFD分析报告-V1-20261029.pptx');
    expect(meta.customer).toBe('东安动力');
    expect(meta.project).toBe('DHR50T');
    expect(meta.caeItem).toBe('CFD');
    expect(meta.product).toBe('油滤器');
    expect(meta.date).toBe('2026-10-29');
    expect(meta.version).toBe('V1');
  });

  it('截图 R05DE 报告：产品取项目与自由模态之间，版本 R05DE-V2 → V2', () => {
    const text = [
      '东安动力 R05DE 油滤器自由模态分析报告',
      '项目代号：',
      'R05DE',
      '时       间：',
      '2026-10-27',
      '版       本：',
      'R05DE-V2',
    ].join('\n');
    const meta = parseCaeMeta(text, '东安动力 R05DE 油滤器自由模态分析报告-V2-20261027.pptx');
    expect(meta.customer).toBe('东安动力');
    expect(meta.project).toBe('R05DE');
    expect(meta.caeItem).toBe('自由模态');
    expect(meta.product).toBe('油滤器');
    expect(meta.date).toBe('2026-10-27');
    expect(meta.version).toBe('V2');
  });

  it('parseCaeFileName：客户 + 项目代号 + 产品 + 分析项 + 版本 + 日期', () => {
    expect(parseCaeFileName('上汽 S61D-PHEV 空滤器安装点动刚度分析报告-V1-20261103.pptx')).toEqual({
      customer: '上汽',
      project: 'S61D-PHEV',
      product: '空滤器安装点',
      caeItem: '动刚度分析',
      version: 'V1',
      date: '2026-11-03',
    });
    expect(parseCaeFileName('上汽 S61D-PHEV 空滤器模态分析报告-V4-20261030.pptx')).toEqual({
      customer: '上汽',
      project: 'S61D-PHEV',
      product: '空滤器',
      caeItem: '模态分析',
      version: 'V4',
      date: '2026-10-30',
    });
  });
});

describe('CAE 报告：封面标题解析', () => {
  it('客户取标题开头中文，产品取项目与分析类型之间', () => {
    const t = parseCaeTitle('长城汽车B26-A进气系统流阻分析报告', 'B26-A');
    expect(t.customer).toBe('长城汽车');
    expect(t.caeItem).toBe('流阻');
    expect(t.product).toBe('进气系统');
  });

  it('客户规范化到「XX汽车」，产品去掉「的」', () => {
    const t = parseCaeTitle(
      '重庆长安汽车股份有限公司S61D-PHEV空滤器的安装点动刚度分析报告',
      'S61D-PHEV',
    );
    expect(t.customer).toBe('重庆长安汽车');
    expect(t.caeItem).toBe('动刚度');
    expect(t.product).toBe('空滤器安装点');
  });

  it('示例：东安动力 R05DE 油滤器自由模态', () => {
    const meta = parseCaeMeta(
      [
        '东安动力 R05DE 油滤器自由模态分析报告',
        '项目代号：R05DE',
        '时   间：2026-11-04',
        '版   本：项目-V1',
      ].join('\n'),
      '东安动力 R05DE 油滤器自由模态分析报告-V1-20261104.pptx',
    );
    expect(meta.customer).toBe('东安动力');
    expect(meta.project).toBe('R05DE');
    expect(meta.caeItem).toBe('自由模态');
    expect(meta.product).toBe('油滤器');
    expect(meta.version).toBe('V1');
    expect(meta.date).toBe('2026-11-04');
  });

  it('分析类型长词优先：约束模态 / 自由模态 不截成「模态」', () => {
    expect(caeItemFromTitle('上汽空滤器约束模态分析报告')).toBe('约束模态');
    expect(caeItemFromTitle('上汽空滤器自由模态分析报告')).toBe('自由模态');
    expect(caeItemFromTitle('上汽空滤器随机振动分析报告')).toBe('随机振动');
    expect(caeItemFromTitle('上汽空滤器传递损失分析报告')).toBe('传递损失');
  });

  it('英文分析类型不区分大小写', () => {
    expect(caeItemFromTitle('上汽空滤器cfd分析报告')).toBe('CFD');
    expect(caeItemFromTitle('上汽空滤器tl分析报告')).toBe('TL');
    expect(parseCaeTitle('上汽 S61D 空滤器TL分析报告', 'S61D').product).toBe('空滤器');
  });

  it('日期取封面「时间」右侧，版本取「版本」右侧并去掉「项目」与「-」', () => {
    const text = [
      '上汽S61D-PHEV空滤器耐久分析报告',
      '项目代号：S61D-PHEV',
      '时   间：   2026年11月3日',
      '版   本：   项目-V2.1',
    ].join('\n');
    // 文件名中的 V9 / 20250101 不应被采用
    const meta = parseCaeMeta(text, '上汽S61D-PHEV空滤器耐久分析报告-V9-20250101.pdf');
    expect(meta.date).toBe('2026-11-03');
    expect(meta.version).toBe('V2.1');
    expect(meta.customer).toBe('上汽');
    expect(meta.project).toBe('S61D-PHEV');
    expect(meta.caeItem).toBe('耐久');
    expect(meta.product).toBe('空滤器');
  });

  it('封面没有「时间」「版本」时不从文件名兜底', () => {
    const meta = parseCaeMeta(
      ['客户名称：长安汽车', '项目代号：CS75-2025'].join('\n'),
      '长安汽车CS75-2025进气系统强度分析报告-V3-20250101.pdf',
    );
    expect(meta.date).toBe('');
    expect(meta.version).toBe('');
  });

  it('标题未命中分析类型时回退到原有字段解析', () => {
    const meta = parseCaeMeta(
      ['CAE 分析报告', '客户名称：长城汽车股份有限公司', '项目名称：进气阻力仿真分析'].join('\n'),
      'x.pdf',
    );
    expect(meta.customer).toBe('长城汽车');
    expect(meta.caeItem).toBe('进气阻力仿真分析');
  });
});

describe('CAE 报告：CFD / 流阻流量', () => {
  it('仅 CFD / 流阻需要流量', () => {
    expect(caeNeedsFlow('CFD')).toBe(true);
    expect(caeNeedsFlow('CFD分析')).toBe(true);
    expect(caeNeedsFlow('流阻')).toBe(true);
    expect(caeNeedsFlow('自由模态')).toBe(false);
    expect(caeNeedsFlow('强度')).toBe(false);
  });

  it('正文「数字 + 流量单位」：L/min、kg/h、m³/h', () => {
    expect(parseCaeFlow('要求进口流量为 10L/min。')).toEqual({ flow: '10', flowUnit: 'L/min' });
    expect(parseCaeFlow('额定流量 10kg/h')).toEqual({ flow: '10', flowUnit: 'kg/h' });
    expect(parseCaeFlow('体积流量 10m³/h')).toEqual({ flow: '10', flowUnit: 'm³/h' });
    expect(parseCaeFlow('分别为 10L/min 与 20L/min')).toEqual({ flow: '10/20', flowUnit: 'L/min' });
    // 取自 DHR50T 报告正文第一页
    expect(parseCaeFlow('分析-18℃流量10L/min和80℃流量50L/min两种情况下，油滤器内部流动阻力大小。')).toEqual({
      flow: '10/50',
      flowUnit: 'L/min',
    });
  });

  it('表格「流量」列下一行取数', () => {
    const body = [
      '方案   输入   分析要求',
      '温度(℃)   环境气压(KPa)   流量(kg/h)   输出项   标准',
      'V3   20   101.325   330   进气系统总压降   ≤4.2kPa',
    ].join('\n');
    expect(parseCaeFlow(body)).toEqual({ flow: '330', flowUnit: 'kg/h' });
  });

  it('CFD 报告从正文第一页取流量', () => {
    const cover = [
      '东安动力 DHR50T 油滤器CFD分析报告',
      '项目代号：',
      'DHR50T',
      '时       间：',
      '2026-10-29',
      '版       本：',
      'DHR50T-V1',
    ].join('\n');
    const body = ['温度(℃)   环境气压(KPa)   流量(kg/h)', '20   101.325   330'].join('\n');
    const meta = parseCaeMeta(cover, '东安动力 DHR50T 油滤器CFD分析报告-V1-20261029.pptx', body);
    expect(meta.caeItem).toBe('CFD');
    expect(meta.flow).toBe('330');
    expect(meta.flowUnit).toBe('kg/h');
  });

  it('DHR50T 实际正文第一页：10L/min 与 50L/min → 10/50 L/min', () => {
    const cover = [
      '东安动力DHR50T油滤器CFD分析报告',
      '项目代号：',
      'DHR50T',
      '时       间：',
      '2026-10-29',
      '版       本：',
      'DHR50T-V1',
    ].join('\n');
    const body =
      '分析目标\n分析-18℃流量10L/min和80℃流量50L/min两种情况下，油滤器内部流动阻力大小。\n' +
      '材料参数\n材料   温度(℃)   密度（kg/m   3   )   运动粘度（mm   2   /s）';
    const meta = parseCaeMeta(cover, '东安动力 DHR50T 油滤器CFD分析报告-V1-20261029.pptx', body);
    expect(meta.flow).toBe('10/50');
    expect(meta.flowUnit).toBe('L/min');
  });

  it('非 CFD / 流阻报告不取流量', () => {
    const text = ['东安动力 R05DE 油滤器自由模态分析报告', '时       间：', '2026-10-27'].join('\n');
    const meta = parseCaeMeta(text, 'x.pptx', '正文写了 10L/min');
    expect(meta.caeItem).toBe('自由模态');
    expect(meta.flow).toBe('');
    expect(meta.flowUnit).toBe('');
  });
});

describe('CAE 归档文件名', () => {
  it('生成「客户+项目+仿真项目+产品+版本+日期.pdf」', () => {
    expect(
      archiveCaeFileName('长城汽车', 'B26-A', '进气阻力仿真分析', '进气系统', 'V1.0', '2026-10-20'),
    ).toBe('长城汽车+B26-A+进气阻力仿真分析+进气系统+V1.0+20261020.pdf');
  });

  it('CFD / 流阻文件名含流量段，并可反解', () => {
    expect(
      archiveCaeFileName(
        '东安动力',
        'DHR50T',
        'CFD',
        '油滤器',
        'V1',
        '2026-10-29',
        '330',
        'kg/h',
      ),
    ).toBe('东安动力+DHR50T+CFD+330kg-h+油滤器+V1+20261029.pdf');

    const p = parseCaeArchiveName('东安动力+DHR50T+CFD+330kg-h+油滤器+V1+20261029.pdf');
    expect(p.flow).toBe('330');
    expect(p.flowUnit).toBe('kg/h');
    expect(p.product).toBe('油滤器');
  });

  it('文件名反解元信息', () => {
    const p = parseCaeArchiveName('长城汽车+B26-A+进气阻力仿真分析+进气系统+V1.0+20261020.pdf');
    expect(p).toEqual({
      customer: '长城汽车',
      project: 'B26-A',
      caeItem: '进气阻力仿真分析',
      flow: '',
      flowUnit: '',
      product: '进气系统',
      version: 'V1.0',
      date: '20261020',
    });
  });
});
