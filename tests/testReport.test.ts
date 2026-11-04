import { describe, expect, it } from 'vitest';
import { archivePdfFileName, parseArchiveName } from '../src/report/db';
import {
  DEFAULT_KEYWORDS,
  buildTestXlsxBase64,
  despaceOcrText,
  normalizeCustomer,
  parseHeaderCode,
  parseMetaOnly,
  parseOcrMeta,
  parseTestReport,
  testReportFileName,
} from '../src/report/testReport';

/**
 * 实验报告解析与 Excel 导出测试
 *
 * 用一段模拟的文字版报告正文验证：项目/产品/版本/日期识别、
 * 关键字抓取测试项、文件名规则与工作簿生成。
 */
const SAMPLE = `长安 CS75-2025 空气滤清器总成 实验报告
项目名称：长安 CS75-2025
产品名称：空气滤清器总成
版本号：V1.2
报告日期：2026年10月20日

3 测试结果
噪声测试：声压级 78.5 dB(A)，转速=1500 r/min，判定：合格
压降测试：压力降 1.25 kPa，流量=600 m³/h，判定：合格
传递损失 32.5 dB，判定=合格
备注：本报告仅用于内部评审
`;

describe('实验报告解析', () => {
  const parsed = parseTestReport(SAMPLE, 'report.pdf', DEFAULT_KEYWORDS);

  it('识别项目 / 产品 / 版本 / 日期', () => {
    expect(parsed.meta.project).toBe('长安 CS75-2025');
    expect(parsed.meta.product).toBe('空气滤清器总成');
    expect(parsed.meta.version).toBe('V1.2');
    expect(parsed.meta.date).toBe('2026-10-20');
  });

  it('按关键字识别测试项与实测值', () => {
    const byName = new Map(parsed.items.map((i) => [i.name, i]));
    expect(byName.get('声压级')?.resultText).toContain('实测值=78.5 dB(A)');
    expect(byName.get('声压级')?.conditionText).toContain('转速=1500 r/min');
    expect(byName.get('压力降')?.resultText).toContain('实测值=1.25 kPa');
    expect(byName.get('压力降')?.resultText).toContain('判定=合格');
    expect(byName.get('传递损失')?.resultText).toContain('实测值=32.5 dB');
    // 长关键字优先，不应同时出现「压降」重复行
    expect(byName.has('压降')).toBe(false);
  });

  it('文件名规则：项目+产品名+版本号+日期', () => {
    expect(testReportFileName(parsed.meta)).toBe('长安 CS75-2025+空气滤清器总成+V1.2+20261020.xlsx');
  });

  it('生成有效的 xlsx 工作簿（zip 头 + 非空）', async () => {
    const b64 = await buildTestXlsxBase64(parsed.meta, parsed.items);
    expect(b64.startsWith('UEsDB')).toBe(true); // PK\x03\x04
    expect(b64.length).toBeGreaterThan(4000);
  });
});

describe('页眉编号识别（SYZX-客户 年月日 流水）', () => {
  // 年份后两位按电脑当前年份的世纪补齐：26 → 20xx（与 parseHeaderCode 同规则计算期望值）
  const expectedYear = (() => {
    const now = new Date().getFullYear();
    let y = Math.floor(now / 100) * 100 + 26;
    if (y > now) y -= 100;
    return y;
  })();

  it('识别客户与日期，年份补齐前两位', () => {
    const r = parseHeaderCode('SYZX-BYD 26 07 01 01\n某实验报告正文');
    expect(r).not.toBeNull();
    expect(r!.customer).toBe('BYD');
    expect(r!.date).toBe(`${expectedYear}-07-01`);
  });

  it('页眉编号仅覆盖日期，客户始终取正文客户名称标签', () => {
    const meta = parseMetaOnly(
      'SYZX-BYD 26 07 01 01\n客户：其他客户\n报告日期：2020年1月2日',
      'x.pdf',
    );
    expect(meta.customer).toBe('其他客户');
    expect(meta.date).toBe(`${expectedYear}-07-01`);
  });

  it('无页眉编号时回退到原有标签识别', () => {
    const meta = parseMetaOnly(SAMPLE, 'x.pdf');
    expect(meta.customer).toBe('');
    expect(meta.date).toBe('2026-10-20');
  });

  it('非法月份/日期不识别', () => {
    expect(parseHeaderCode('SYZX-BYD 26 13 40 01')).toBeNull();
    expect(parseHeaderCode('SYZX-BYD 26 00 10 01')).toBeNull();
  });

  it('编号在正文深处（超过页眉前 10 行）不识别', () => {
    const body = Array.from({ length: 15 }, (_, i) => `第${i + 1}行内容`).join('\n');
    expect(parseHeaderCode(`报告标题\n${body}\nSYZX-BYD 26 07 01 01`)).toBeNull();
  });
});

describe('客户名称规范化（读到 XX汽车 为止）', () => {
  const expectedYear = (() => {
    const now = new Date().getFullYear();
    let y = Math.floor(now / 100) * 100 + 26;
    if (y > now) y -= 100;
    return y;
  })();

  it('去掉「股份有限公司」等公司后缀', () => {
    expect(normalizeCustomer('长城汽车股份有限公司')).toBe('长城汽车');
    expect(normalizeCustomer('重庆长安汽车股份有限公司')).toBe('重庆长安汽车');
  });

  it('名称中不含「汽车」时保持原样', () => {
    expect(normalizeCustomer('比亚迪股份有限公司')).toBe('比亚迪股份有限公司');
    expect(normalizeCustomer('')).toBe('');
  });

  it('从封面「客户名称」标签提取并规范化', () => {
    const meta = parseMetaOnly(
      '某实验报告封面\n客户名称：长城汽车股份有限公司\n产品名称：空气滤清器',
      'x.pdf',
    );
    expect(meta.customer).toBe('长城汽车');
  });

  it('页眉编号客户优先，不受规范化影响', () => {
    const meta = parseMetaOnly('SYZX-BYD 26 07 01 01\n客户名称：长城汽车股份有限公司', 'x.pdf');
    expect(meta.customer).toBe('长城汽车');
    expect(meta.date).toBe(`${expectedYear}-07-01`);
  });
});

describe('扫描件 OCR 文本解析', () => {
  const expectedYear = (() => {
    const now = new Date().getFullYear();
    let y = Math.floor(now / 100) * 100 + 26;
    if (y > now) y -= 100;
    return y;
  })();

  // Windows 系统 OCR 的真实输出特征：字符间带空格、多行合并为一行、全角符号、V1.0 → VI·0
  const OCR_SAMPLE =
    '客 户 名 称 ： 长 城 汽 车 股 份 有 限 公 司 项 目 名 称 ． B26-A 进 气 系 统 阻 力 产 品 名 称 ： 空 气 滤 清 器 总 成 版 本 号 VI · 0 报 告 日 期 ： 2026 年 1 0 月 20 日 SYZX-BYD 26 07 01 01';

  it('despaceOcrText 去掉字符间空格', () => {
    expect(despaceOcrText('客 户 名 称 ： 长 城 汽 车')).toBe('客户名称：长城汽车');
  });

  it('有页眉编号：客户取自封面客户名称并规范化，日期取自页眉编号', () => {
    const meta = parseOcrMeta(OCR_SAMPLE, 'B26-A进气阻力.pdf');
    expect(meta.customer).toBe('长城汽车');
    expect(meta.date).toBe(`${expectedYear}-07-01`);
    expect(meta.project).toContain('B26-A');
    expect(meta.testItem).toContain('B26-A');
    expect(meta.product).toBe('空气滤清器总成');
    expect(meta.version).toBe('V1.0');
  });

  it('无页眉编号：客户规范化 + 日期从正文识别', () => {
    const noHeader = OCR_SAMPLE.replace(' SYZX-BYD 26 07 01 01', '');
    const meta = parseOcrMeta(noHeader, 'x.pdf');
    expect(meta.customer).toBe('长城汽车');
    expect(meta.date).toBe('2026-10-20');
    expect(meta.version).toBe('V1.0');
  });

  // 真实扫描件（B26-A进气阻力.pdf）封面 OCR 按词坐标还原后的行结构：
  // 页眉编号 X 丢失、- 被误识为 ·/一；封面只有「零件名称」没有「产品名称」，无版本号
  const REAL_OCR_ROWS = [
    '编 号 No ：   SYZ GW · 26 一 081901',
    '试 验 报 口',
    '零 件 名 称 ：   B26-A 进 气 系 统',
    '零 部 件 号 ：',
    '项 目 名 称 ：   压 力 损 失',
    '试 验 类 型 ：   委 托 检 测',
    '客 户 名 称 ：   长 城 汽 车 股 份 有 限 公 司',
    '成 都 万 友 滤 机 有 限 公 司',
    '机 密   授 权 使 用 ， 禁 止 私 自 拍 照 、 截 屏 、 夕 卜 发',
  ].join('\n');

  it('真实封面：页眉容错解析日期 + 客户取自封面客户名称并规范化 + 项目/产品从零件名称拆分', () => {
    const meta = parseOcrMeta(REAL_OCR_ROWS, 'B26-A进气阻力.pdf');
    expect(meta.customer).toBe('长城汽车');
    expect(meta.date).toBe(`${expectedYear}-08-19`);
    // 项目 = 零件名称字母数字段（优先于项目名称标签）
    expect(meta.project).toBe('B26-A');
    // 实验项目 = 封面「项目名称」一栏
    expect(meta.testItem).toBe('压力损失');
    // 产品 = 零件名称中字母数字段之外的文字
    expect(meta.product).toBe('进气系统');
    expect(meta.version).toBe('');
  });
});

describe('归档文件名（客户+项目+实验项目+产品+版本+日期）', () => {
  it('生成并反解新版文件名', () => {
    const name = archivePdfFileName('长城汽车', 'B26-A', '压力损失', '进气系统', 'V1.0', '2026-08-19');
    expect(name).toBe('长城汽车+B26-A+压力损失+进气系统+V1.0+20260819.pdf');
    expect(parseArchiveName(name)).toEqual({
      customer: '长城汽车',
      project: 'B26-A',
      testItem: '压力损失',
      product: '进气系统',
      version: 'V1.0',
      date: '20260819',
    });
  });

  it('兼容旧版 5 段 PDF 与 4 段 xlsx 文件名', () => {
    expect(parseArchiveName('长城汽车+B26-A+进气系统+V1.0+20260819.pdf')).toEqual({
      customer: '长城汽车',
      project: 'B26-A',
      testItem: '',
      product: '进气系统',
      version: 'V1.0',
      date: '20260819',
    });
    expect(parseArchiveName('B26-A+进气系统+V1.0+20260819.xlsx')).toEqual({
      customer: '',
      project: 'B26-A',
      testItem: '',
      product: '进气系统',
      version: 'V1.0',
      date: '20260819',
    });
  });
});
