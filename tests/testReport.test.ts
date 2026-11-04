import { describe, expect, it } from 'vitest';
import { archivePdfFileName, parseArchiveName } from '../src/report/db';
import {
  DEFAULT_KEYWORDS,
  buildTestXlsxBase64,
  despaceOcrText,
  normalizeCustomer,
  isFlowReport,
  parseFlow,
  parseHeaderCode,
  parseMetaOnly,
  parseOcrMeta,
  parseTestItemFromTable,
  parseTestReport,
  testReportFileName,
} from '../src/report/testReport';

/**
 * 试验报告解析与 Excel 导出测试
 *
 * 用一段模拟的文字版报告正文验证：项目/产品/版本/日期识别、
 * 关键字抓取测试项、文件名规则与工作簿生成。
 */
const SAMPLE = `长安 CS75-2025 空气滤清器总成 试验报告
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

describe('试验报告解析', () => {
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
    const r = parseHeaderCode('SYZX-BYD 26 07 01 01\n某试验报告正文');
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
      '某试验报告封面\n客户名称：长城汽车股份有限公司\n产品名称：空气滤清器',
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

describe('试验项目：按试验结果表的「试验项目」列读取', () => {
  // 截图中的真实版面：表头行 + 数据行（列间以多个空格分隔），
  // 旧逻辑会把右侧「试验地点」列的「成都万友」误当成试验项目
  const GRID_TABLE = [
    '试 验 结 果',
    '№   试 验 项 目   数量   样 件 编 号   试 验 地 点   判定   备注',
    '1   进 气 阻 力   1   SYSQ-20251105-09-1#   成 都 万 友 滤 机 有 限 公 司   合格',
  ].join('\n');

  it('网格表：数据行比表头多序号列 + 试验地点换行时不误取', () => {
    // CNH 报告的 OCR 实况：表头无序号列，数据行首列是「1」，
    // 试验地点单元格换行成「成都万友 / 滤机有限 / 公司」夹在表头与数据行之间
    const REAL = [
      '试 验 结 果',
      '试 验 项 目   数量   样 件 编 号   试 验 地 点   判定   备注',
      '成 都 万 友',
      '1   进 气 阻 力   SYSQ一20251105一09一1＃   滤 机 有 限   合格',
      '公司',
    ].join('\n');
    expect(parseOcrMeta(REAL, 'CNH+1.5L.pdf').testItem).toBe('进气阻力');
  });

  it('网格表：取「试验项目」列下方数据行，不取试验地点', () => {
    const meta = parseOcrMeta(GRID_TABLE, 'CNH+1.5L.pdf');
    expect(meta.testItem).toBe('进气阻力');
  });

  it('表单式：标签与值同行仍可识别（B26-A 压力损失）', () => {
    const meta = parseOcrMeta(
      '试 验 项 目   压 力 损 失   设备有效日期   2026/3/5一2027/3/4',
      'B26-A进气阻力.pdf',
    );
    expect(meta.testItem).toBe('压力损失');
  });

  it('主进程按列坐标取到的值优先于文本解析', () => {
    const meta = parseOcrMeta(GRID_TABLE, 'x.pdf', '进气阻力');
    expect(meta.testItem).toBe('进气阻力');
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
    // 试验项目 = 封面「项目名称」一栏
    expect(meta.testItem).toBe('压力损失');
    // 产品 = 零件名称中字母数字段之外的文字
    expect(meta.product).toBe('进气系统');
    expect(meta.version).toBe('');
  });

  it('多页 OCR：元字段取封面页，试验项目优先取试验结果表格', () => {
    // 真实第 3 页 OCR 行（B26-A进气阻力.pdf）：试验结果表里是「标签+值」同行
    const page3 = [
      '试验结果：',
      '试验项目   进气阻力   设备有效日期   2026/3/5一2027/3/4',
      '送样日期   2026/7/17   样品状态   外观良好',
    ].join('\n');
    const meta = parseOcrMeta(`${REAL_OCR_ROWS}\n\n${page3}`, 'B26-A进气阻力.pdf');
    expect(meta.customer).toBe('长城汽车');
    expect(meta.date).toBe(`${expectedYear}-08-19`);
    expect(meta.project).toBe('B26-A');
    expect(meta.testItem).toBe('进气阻力');
    expect(meta.version).toBe('');
  });
});

describe('零件名称仅中文时：项目与产品同名', () => {
  it('OCR 封面：零件名称只有中文，项目与产品都取该名称', () => {
    const rows = [
      '零 件 名 称 ：   空 气 滤 清 器 总 成',
      '项 目 名 称 ：   压 力 损 失',
      '产 品 名 称 ：   滤 清 器',
      '客 户 名 称 ：   长 城 汽 车 股 份 有 限 公 司',
    ].join('\n');
    const meta = parseOcrMeta(rows, 'x.pdf');
    expect(meta.project).toBe('空气滤清器总成');
    expect(meta.product).toBe('空气滤清器总成');
  });

  it('文字层 PDF：零件名称只有中文时同样取同名', () => {
    const text = [
      '零件名称：空气滤清器总成',
      '项目名称：压力损失',
      '客户名称：长城汽车股份有限公司',
    ].join('\n');
    const meta = parseMetaOnly(text, 'x.pdf');
    expect(meta.project).toBe('空气滤清器总成');
    expect(meta.product).toBe('空气滤清器总成');
  });

  it('零件名称含字母数字时仍按原规则拆分', () => {
    const meta = parseMetaOnly('零件名称：B26-A 进气系统\n客户名称：长城汽车股份有限公司', 'x.pdf');
    expect(meta.project).toBe('B26-A');
    expect(meta.product).toBe('进气系统');
  });
});

describe('归档文件名（客户+项目+试验项目+产品+版本+日期）', () => {
  it('生成并反解新版文件名', () => {
    const name = archivePdfFileName('长城汽车', 'B26-A', '压力损失', '进气系统', 'V1.0', '2026-08-19');
    expect(name).toBe('长城汽车+B26-A+压力损失+进气系统+V1.0+20260819.pdf');
    expect(parseArchiveName(name)).toEqual({
      customer: '长城汽车',
      project: 'B26-A',
      testItem: '压力损失',
      flow: '',
      flowUnit: '',
      product: '进气系统',
      version: 'V1.0',
      date: '20260819',
    });
  });

  it('进气阻力：文件名插入流量段并可反解', () => {
    const name = archivePdfFileName(
      '长城汽车',
      'B26-A',
      '进气阻力',
      '进气系统',
      'V1.0',
      '2026-08-19',
      '370',
      'kg/h',
    );
    expect(name).toBe('长城汽车+B26-A+进气阻力+370kg-h+进气系统+V1.0+20260819.pdf');
    expect(parseArchiveName(name)).toEqual({
      customer: '长城汽车',
      project: 'B26-A',
      testItem: '进气阻力',
      flow: '370',
      flowUnit: 'kg/h',
      product: '进气系统',
      version: 'V1.0',
      date: '20260819',
    });
  });

  it('流量单位 m³/h 在文件名中记为 m3-h', () => {
    const name = archivePdfFileName(
      '长城汽车',
      'B26-A',
      '进气阻力',
      '进气系统',
      'V1.0',
      '2026-08-19',
      '1200',
      'm³/h',
    );
    expect(name).toContain('+1200m3-h+');
    expect(parseArchiveName(name).flowUnit).toBe('m³/h');
  });

  it('多个流量在文件名中以逗号分隔并可反解', () => {
    const name = archivePdfFileName(
      '长城汽车',
      'B26-A',
      '进气阻力',
      '进气系统',
      'V1.0',
      '2026-08-19',
      '260/240',
      'kg/h',
    );
    expect(name).toContain('+260,240kg-h+');
    expect(parseArchiveName(name).flow).toBe('260/240');
    expect(parseArchiveName(name).flowUnit).toBe('kg/h');
  });

  it('兼容旧版 5 段 PDF 与 4 段 xlsx 文件名', () => {
    expect(parseArchiveName('长城汽车+B26-A+进气系统+V1.0+20260819.pdf')).toEqual({
      customer: '长城汽车',
      project: 'B26-A',
      testItem: '',
      flow: '',
      flowUnit: '',
      product: '进气系统',
      version: 'V1.0',
      date: '20260819',
    });
    expect(parseArchiveName('B26-A+进气系统+V1.0+20260819.xlsx')).toEqual({
      customer: '',
      project: 'B26-A',
      testItem: '',
      flow: '',
      flowUnit: '',
      product: '进气系统',
      version: 'V1.0',
      date: '20260819',
    });
  });
});

describe('进气阻力：读取流量与单位', () => {
  it('文字版：接受标准 3.5kPa@370kg/h → 370 kg/h', () => {
    const text = [
      '试验项目：进气阻力',
      '客户名称：长城汽车股份有限公司',
      '零件名称：B26-A 进气系统',
      '接受标准：进气系统阻力≤3.5kPa@370kg/h',
    ].join('\n');
    const meta = parseMetaOnly(text, 'x.pdf');
    expect(meta.testItem).toBe('进气阻力');
    expect(meta.flow).toBe('370');
    expect(meta.flowUnit).toBe('kg/h');
  });

  it('扫描件 OCR：字间空格与 m3 写法兼容', () => {
    const ocr = [
      '试 验 项 目 ： 进 气 阻 力',
      '接 受 标 准 ： 进 气 系 统 阻 力 ≤ 3 . 5kPa@ 370kg/h',
    ].join('\n');
    const meta = parseOcrMeta(ocr, 'x.pdf', '进气阻力');
    expect(meta.flow).toBe('370');
    expect(meta.flowUnit).toBe('kg/h');
    expect(parseFlow('接受标准\t风量　≤　1200m3／h')).toEqual({ flow: '1200', flowUnit: 'm³/h' });
  });

  it('接受标准句式：在额定空气体积流量下 260kg/h', () => {
    const text = [
      '试验项目\t进气阻力',
      '接受标准\t在额定空气体积流量下260kg/h，进气系统阻力≤3 kPa',
      '试验结论\t合格',
    ].join('\n');
    expect(parseFlow(text)).toEqual({ flow: '260', flowUnit: 'kg/h' });
    // 值单元格换行到下一行
    expect(
      parseFlow(['试验项目\t进气阻力', '接受标准\t在额定空气体积流量', '下260kg/h，进气系统阻力≤3kPa'].join('\n')),
    ).toEqual({ flow: '260', flowUnit: 'kg/h' });
  });

  it('多个流量（多个试验项目的接受标准）全部读取，用 / 分隔', () => {
    const text = [
      '试验项目\t进气阻力',
      '接受标准\t进气系统阻力≤3kPa@260kg/h',
      '试验结论\t合格',
      '试验项目\t进气阻力',
      '接受标准\t进气系统阻力≤2.5kPa@240kg/h',
      '试验结论\t合格',
    ].join('\n');
    expect(parseFlow(text)).toEqual({ flow: '260/240', flowUnit: 'kg/h' });
  });

  it('多个样品各自的进气流量（接受准则列）', () => {
    const text = [
      '接受准则\tSC6HAU进气流量380kg/h 阻力要求≤3.5±0.5kpa',
      '样品名称\tSC6HEU',
      '接受准则\tSC6HEU进气流量265kg/h 阻力要求≤2.5±0.5kpa',
    ].join('\n');
    expect(parseFlow(text)).toEqual({ flow: '380/265', flowUnit: 'kg/h' });
  });

  it('试验结果表格「试验要求」行的流量', () => {
    const text = [
      '试验项目\t进气阻力',
      '试验要求\t在额定空气体积流量下260kg/h，阻力≤3kPa',
      '试验结果\t3.1kPa',
      '试验项目\t进气阻力',
      '试验要求\t在额定空气体积流量下240kg/h，阻力≤2.5kPa',
      '试验结果\t2.3kPa',
    ].join('\n');
    expect(parseFlow(text)).toEqual({ flow: '260/240', flowUnit: 'kg/h' });
  });

  it('试验要求行的 m³/h 流量', () => {
    expect(parseFlow('试验要求\t进气流量1200m³/h')).toEqual({ flow: '1200', flowUnit: 'm³/h' });
  });

  it('接受标准以外的 kg/h（如图表坐标轴）不计入流量', () => {
    expect(parseFlow('流量kg/h 104 156 208 260 312')).toEqual({ flow: '', flowUnit: '' });
    expect(parseFlow('进气系统阻力≤3.5kPa@370kg/h')).toEqual({ flow: '', flowUnit: '' });
  });

  it('非进气阻力的报告不保留流量', () => {
    const meta = parseMetaOnly('项目名称：压力损失\n接受标准：≤3.5kPa@370kg/h', 'x.pdf');
    expect(meta.testItem).toBe('压力损失');
    expect(meta.flow).toBe('');
    expect(meta.flowUnit).toBe('');
  });

  it('文件名含进气阻力时即使试验项目读成压力损失也读取流量', () => {
    const text = [
      '项目名称：压力损失',
      '零件名称：B26-A 进气系统',
      '接受标准：进气系统阻力≤3.5kPa@370kg/h',
    ].join('\n');
    const meta = parseMetaOnly(text, 'B26-A进气阻力.pdf');
    expect(meta.testItem).toBe('压力损失');
    expect(meta.flow).toBe('370');
    expect(meta.flowUnit).toBe('kg/h');
    expect(isFlowReport(meta.testItem, 'B26-A进气阻力.pdf')).toBe(true);
  });
});

describe('试验项目优先取试验结果表格', () => {
  // 文字层提取：列间距以 3 个空格体现，行为「标签 + 值 + 设备 + 日期」
  const ROW_STYLE = [
    '试验结果',
    '样品名称   B26-A 进气系统   试验设备/型号   滤清器颗粒计数法综合性能测试台',
    '试验项目   压力损失   设备有效日期   2026/3/5−2027/3/4',
  ].join('\n');

  // 表头列样式：表头行含「试验项目」，值在下一行同列
  const HEADER_STYLE = [
    'No.   试验项目   数量   样件编号   试验地点   判定   备注',
    '1   进气阻力   1   SYQ-20251105-09-1#   成都万友滤机有限公司   合格',
  ].join('\n');

  // OCR 形态：中文字符间额外插空格，列间距仍为 3 个空格
  const OCR_ROWS = [
    '试 验 项 目    压 力 损 失    设 备 有 效 日 期    2026/3/5−2027/3/4',
  ].join('\n');

  it('标签+值同行：取「压力损失」', () => {
    expect(parseTestItemFromTable(ROW_STYLE)).toBe('压力损失');
  });

  it('表头列样式：取下一行同列「进气阻力」', () => {
    expect(parseTestItemFromTable(HEADER_STYLE)).toBe('进气阻力');
  });

  it('OCR 字间带空格：仍能取到「压力损失」', () => {
    expect(parseTestItemFromTable(OCR_ROWS)).toBe('压力损失');
  });

  it('优先于封面「项目名称」标签（文字版与 OCR 两条入口）', () => {
    const text = '项目名称：其他项目\n试验项目   压力损失   设备有效日期   2026/3/5';
    expect(parseMetaOnly(text, 'x.pdf').testItem).toBe('压力损失');
    expect(parseOcrMeta('项 目 名 称 ：   其 他 项 目\n试 验 项 目    压 力 损 失', 'x.pdf').testItem).toBe(
      '压力损失',
    );
  });

  it('没有试验结果表格时回退封面「项目名称」', () => {
    expect(parseTestItemFromTable('项目名称：压力损失')).toBe('');
    expect(parseMetaOnly('项目名称：压力损失', 'x.pdf').testItem).toBe('压力损失');
  });

  it('表格里的编号 / 日期 / 表头词不会被误取', () => {
    expect(parseTestItemFromTable('试验项目   1   合格')).toBe('');
    expect(parseTestItemFromTable('试验项目   数量   样件编号')).toBe('');
  });
});
