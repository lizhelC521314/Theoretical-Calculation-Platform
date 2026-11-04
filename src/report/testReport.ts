import ExcelJS from 'exceljs';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * 试验报告模块
 *
 * 功能：读取文字版 PDF 试验报告 → 按标题/字段识别项目、产品、版本、日期 →
 * 按关键字识别测试项目与实测结果 → 生成「试验测试表」Excel（格式参考计算书汇总表）。
 */

GlobalWorkerOptions.workerSrc = workerSrc;

/** 内置常见测试指标关键字（界面可增删） */
export const DEFAULT_KEYWORDS = [
  '传递损失',
  '插入损失',
  '压力降',
  '压降',
  '压差',
  '阻力',
  '初阻力',
  '终阻力',
  '流量',
  '过滤效率',
  '效率',
  '容尘量',
  '噪声',
  '声压级',
  '转速',
  '功率',
  '扭矩',
  '振动',
  '泄漏量',
  '密封性',
  '清洁度',
  '面速度',
  'TL',
  'ΔP',
];

export interface TestReportMeta {
  project: string;
  product: string;
  version: string;
  date: string;
}

/** PDF 归档元信息（含客户） */
export interface PdfReportMeta {
  customer: string;
  project: string;
  /** 试验项目：取自封面「项目名称」一栏，如「压力损失」 */
  testItem: string;
  product: string;
  version: string;
  date: string;
}

export interface TestItem {
  id: string;
  /** 测试项目（如「传递损失」） */
  name: string;
  /** 测试条件，多个用「；」分隔，形如「转速=1500 r/min」 */
  conditionText: string;
  /** 测试结果，多个用「；」分隔，形如「实测值=32.5 dB」 */
  resultText: string;
}

export interface TestReport {
  id: string;
  fileName: string;
  meta: TestReportMeta;
  items: TestItem[];
}

/** 浏览器调试模式：渲染进程用 pdf.js 直接解析文字层 */
async function extractInRenderer(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data });
  const doc = await task.promise;
  const pages: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const cells: { x: number; y: number; w: number; s: string }[] = [];
    for (const it of content.items) {
      const item = it as { str?: string; transform?: number[]; width?: number };
      if (!item.str || !item.str.trim() || !item.transform) continue;
      cells.push({ x: item.transform[4], y: item.transform[5], w: item.width ?? 0, s: item.str });
    }
    // 按 y 坐标分行（3pt 容差），行内按 x 排序，列间距大于 8pt 时补空格
    cells.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: typeof cells[] = [];
    for (const c of cells) {
      const row = rows.find((r) => Math.abs(r[0].y - c.y) <= 3);
      if (row) row.push(c);
      else rows.push([c]);
    }
    const lines: string[] = [];
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      let line = '';
      let prevEnd = Number.NEGATIVE_INFINITY;
      for (const c of row) {
        if (line && c.x - prevEnd > 8) line += '   ';
        line += c.s;
        prevEnd = c.x + c.w;
      }
      lines.push(line.trim());
    }
    pages.push(lines.join('\n'));
  }

  await task.destroy();
  return pages.join('\n');
}

/** 读取 PDF 文字层文本：桌面版由主进程解析（规避 file:// 下 worker 限制），浏览器调试走 pdf.js */
export async function extractPdfText(file: File): Promise<string> {
  // 动态引入，避免测试等无 window 环境下加载 api 模块
  const { api } = await import('../api');
  const filePath = api.file.getPath(file);
  if (filePath) {
    const res = await api.pdf.extractText(filePath);
    if (res.ok && typeof res.text === 'string') return res.text;
    throw new Error(res.message || 'PDF 文本提取失败');
  }
  return extractInRenderer(file);
}

/**
 * 扫描件兜底：主进程逐页提取内嵌扫描图并做系统 OCR（按词坐标还原版面行）。
 * 返回 { text, testItem }；testItem 由主进程按「试验项目」列坐标从表格中取，
 * 识别失败或无文字时为空串。
 */
export async function ocrPdfFirstPage(file: File): Promise<{ text: string; testItem: string }> {
  const { api } = await import('../api');
  const filePath = api.file.getPath(file);
  if (!filePath) return { text: '', testItem: '' };
  const res = await api.pdf.ocrFirstPage(filePath);
  if (!res.ok) return { text: '', testItem: '' };
  return {
    text: typeof res.text === 'string' ? res.text : '',
    testItem: typeof res.testItem === 'string' ? res.testItem : '',
  };
}

/**
 * OCR 文本会把字与字之间插入空格（如「客 户 名 称 ： 长 城 汽 车」），
 * 这里去掉中文字符/数字/字母/常见符号之间的空格，便于标签匹配。
 * 注意只去空格/制表符，保留换行——主进程已按词坐标还原了版面行结构。
 */
export function despaceOcrText(text: string): string {
  return text
    .replace(/(?<=[一-鿿0-9A-Za-z：:.．·•/\-+()（）])[ \t]+(?=[一-鿿0-9A-Za-z：:.．·•/\-+()（）])/g, '')
    .trim();
}

/** 表格里的「试验项目」标签（OCR 可能在字间插空格） */
const TEST_ITEM_LABEL = /[试实]\s*验\s*项\s*目/;

/** 表格中常见的表头关键字：用于区分「表头行」与「标签+值」行 */
const TABLE_HEADER_HINTS =
 /(数量|样件编号|样品编号|试验地点|试验日期|试验人员|判定|备注|试验设备|设备有效日期|试验标准|样品名称|规格型号)/;

/** 单元格内容归一：去掉字间空格（「压 力 损 失」→「压力损失」），保留必要单空格 */
function squeezeCell(raw: string): string {
  return despaceOcrText(raw).replace(/[ \t]{2,}/g, ' ').trim();
}

/** 判断候选值是否像「试验项目」名称（排除编号、日期、地点/结论、表头词与纯数字） */
function isLikelyTestItem(value: string): boolean {
  const compact = value.replace(/[ \t]/g, '');
  if (!compact) return false;
  if (TEST_ITEM_LABEL.test(compact)) return false;
  if (TABLE_HEADER_HINTS.test(compact)) return false;
  if (/(公司|工厂|有限公司|地点|合格|不合格|结论)/.test(compact)) return false;
  if (!/^[一-鿿A-Za-z0-9·\-—（）()]{2,24}$/.test(compact)) return false;
  if (/\d{3,}/.test(compact)) return false; // 排除编号 / 年份 / 日期串
  if ((compact.match(/[一-鿿]/g) || []).length < 2) return false; // 至少两个汉字
  return true;
}

/**
 * 从「试验结果」表格的「试验项目」列提取值（优先级高于封面「项目名称」）：
 *  1) 网格表：表头行含「试验项目」及多个表头关键字（数量/样件编号/试验地点…），
 *     取下方数据行同一列的单元格；
 *  2) 表单式：标签与值同行且该行不含其他表头关键字，取标签右侧的单元格。
 * 找不到返回空串。
 */
export function parseTestItemFromTable(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim());
  const splitCells = (line: string) =>
    line
      .split(/\t|[ \t]{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);
  const headerHits = (cells: string[]) =>
    cells.filter((c) => TABLE_HEADER_HINTS.test(c.replace(/[ \t]+/g, ''))).length;

  // 1) 网格表：表头行 → 下方同列
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCells(lines[i]);
    if (cells.length < 3) continue;
    const col = cells.findIndex((c) => TEST_ITEM_LABEL.test(c.replace(/[ \t]+/g, '')));
    if (col < 0) continue;
    if (headerHits(cells) < 2) continue; // 不是表头行
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const row = splitCells(lines[j]);
      if (col >= row.length) continue;
      const v = squeezeCell(row[col]);
      if (isLikelyTestItem(v)) return v;
    }
  }

  // 2) 表单式：标签与值同行（该行没有其他表头列）
  for (const line of lines) {
    const cells = splitCells(line);
    const col = cells.findIndex((c) => TEST_ITEM_LABEL.test(c.replace(/[ \t]+/g, '')));
    if (col < 0 || headerHits(cells) >= 2) continue;
    const inline = squeezeCell(
      cells[col].replace(TEST_ITEM_LABEL, '').replace(/^[：:]\s*/, ''),
    );
    if (isLikelyTestItem(inline)) return inline;
    const right = cells[col + 1] ? squeezeCell(cells[col + 1]) : '';
    if (isLikelyTestItem(right)) return right;
  }
  return '';
}

/** OCR 版本号清洗：「VI·0」「V1。0」→「V1.0」 */
function cleanOcrVersion(raw: string): string {
  if (!raw) return '';
  let v = raw
    .replace(/[·•。]/g, '.')
    .replace(/\s+/g, '')
    .trim();
  // 常见误识：V1 被识别成 VI / Vl / V|
  v = v.replace(/^V[Il|]/i, 'V1');
  const m = v.match(/^(V\d+(?:\.\d+)*)/i);
  return m ? m[1].toUpperCase() : '';
}

/** OCR 文本专用元字段解析：封面页先 despace，按「下一已知标签」截止抓取。ocrTableItem 为主进程按列坐标取到的试验项目 */
export function parseOcrMeta(rawText: string, fileName: string, ocrTableItem = ''): PdfReportMeta {
  // 多页 OCR 时页与页之间以空行分隔：元字段只从封面页取，避免试验结果表里的
  // 日期/委托方等内容污染字段；试验项目则在全文中查找（表格通常在后面几页）
  const firstPage = rawText.split(/\n{2,}/)[0] || rawText;
  // 页眉编号在原始带空格文本上解析（正则本身兼容空格），避免 despace 后日期数字粘连；
  // 精确版失败时走 OCR 容错版（X 丢失、分隔符被误识为 ·/一 等）
  const header = parseHeaderCode(firstPage) || parseOcrHeaderCode(firstPage);
  const text = despaceOcrText(firstPage);

  const KNOWN_LABELS =
    '(?:客户名称|委托单位|送样单位|项目名称|项目代号|产品名称|产品型号|零件名称|零部件号|试验类型|报告编号|样品编号|样件编号|报告日期|试验日期|检测日期|版本号|客户|委托方|甲方|项目|产品|版本|日期|编号)';
  const NEXT_LABEL = `(?=(?:${KNOWN_LABELS}\\s*[：:.．]?|[一-鿿]{2,6}[：:]|\\s|$))`;

  const grab = (label: string): string => {
    const re = new RegExp(label + '\\s*[：:.．]?\\s*(.+?)' + NEXT_LABEL);
    const m = text.match(re);
    if (!m || !m[1]) return '';
    return m[1].replace(/^[：:.．\s]+/, '').trim();
  };

  // 客户：从封面「客户名称」标签读取，规范化到「XX汽车」为止；页眉编号不再覆盖客户
  const customer = normalizeCustomer(
    grab('客户(?:名称)?') || grab('(?:委托方|委托单位|甲方|送样单位)'),
  );

  // 试验项目：主进程按「试验项目」列坐标取到的表格值优先，其次按文本表格解析，
  // 最后回退封面「项目名称」一栏
  // 项目：零件名称中的字母数字段（如 B26-A、CS75-2025）
  // 产品：优先「产品名称」标签，否则取零件名称中字母数字段之外的文字部分
  const tableItem = ocrTableItem.trim() || parseTestItemFromTable(rawText);
  const testItem = tableItem || grab('项目(?:名称|代号)?');
  const partName = grab('零件名称');
  const split = splitPartName(partName);
  const project = split.project || testItem;
  const product = grab('产品(?:名称|型号)?') || split.product;

  let version = cleanOcrVersion(grab('版本(?:号)?'));
  if (!version) version = cleanOcrVersion(text.match(/(?:^|[\s（(])(V[0-9Il|][0-9·•.。]*)/)?.[1] ?? '');
  if (!version) {
    const m = fileName.match(/(V\d+(?:\.\d+)*)/i);
    if (m) version = m[1].toUpperCase();
  }

  let date = header?.date || normalizeDate(text);
  if (!date) date = normalizeDate(fileName);

  return { customer, project, testItem, product, version, date };
}

/** 从文本中提取「标签：值」字段 */
function findField(text: string, label: RegExp): string {
  const m = text.match(label);
  if (!m || !m[1]) return '';
  return m[1].replace(/\s+/g, ' ').trim();
}

/** 把 2026-10-29 / 2026年10月29日 / 2026.10.29 统一为 YYYY-MM-DD */
function normalizeDate(raw: string): string {
  const m = raw.match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/**
 * 从零件名称（如 "B26-A 进气系统" / "CS75-2025 空气滤清器"）中拆分：
 * 字母数字段 → 项目（project），其余文字 → 产品（product）。
 * 找不到字母数字段时 project 返回空串，product 取原值。
 */
function splitPartName(value: string): { project: string; product: string } {
  if (!value) return { project: '', product: '' };
  const m = value.match(/[A-Za-z0-9]+(?:[-_\.][A-Za-z0-9]+)*/g);
  if (!m || !m.length) return { project: '', product: value.trim() };
  const code = m.join('-').trim();
  // 从原值中去掉所有字母数字段（含连接符前后空格），剩下的就是产品名
  let rest = value;
  for (const seg of m) {
    rest = rest.replace(seg, ' ');
  }
  rest = rest.replace(/\s+/g, ' ').trim();
  return { project: code, product: rest };
}

/**
 * 解析报告顶端页眉编号：SYZX-客户 年月日[流水]，如「SYZX-BYD 26 07 01 01」。
 * 年份只给后两位，按电脑当前年份的世纪补齐前两位（26 → 2026）；
 * 若补齐后晚于当前年份则回退一个世纪（如 99 → 1999，报告不可能来自未来）。
 * 只在页眉区域（前 10 个非空行）匹配，避免正文误判。
 */
export function parseHeaderCode(text: string): { customer: string; date: string } | null {
  const head = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 10)
    .join('\n');
  const m = head.match(/SYZX[\s-]*([A-Za-z0-9]{2,8})[\s-]+(\d{2})[\s-]+(\d{1,2})[\s-]+(\d{1,2})(?=[\s-]|$)/);
  if (!m) return null;
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const now = new Date().getFullYear();
  let year = Math.floor(now / 100) * 100 + Number(m[2]);
  if (year > now) year -= 100;
  return {
    customer: m[1],
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/**
 * OCR 容错版页眉编号解析：扫描件 OCR 会把「SYZX-GW-26-081901」误识为
 * 「SYZ GW · 26 一 081901」（X 丢失、分隔符 - 被识成 ·/一 等）。
 * 先把常见误识分隔符归一化为 - 并去掉空白，再按 SYZ[X]-客户-年月日[流水] 匹配。
 * 只在页眉区域（前 10 个非空行）匹配，避免正文误判。
 */
function parseOcrHeaderCode(text: string): { customer: string; date: string } | null {
  const head = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 10)
    .join('\n');
  if (!/SYZ/i.test(head)) return null;
  const norm = head.replace(/[·•。一—–~«»]/g, '-').replace(/\s+/g, '');
  const m = norm.match(/SYZ-*X?-*([A-Za-z]{2,8})-*(\d{2})-*(\d{2})-*(\d{2})(?:-*(\d{2}))?/i);
  if (!m) return null;
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const now = new Date().getFullYear();
  let year = Math.floor(now / 100) * 100 + Number(m[2]);
  if (year > now) year -= 100;
  return {
    customer: m[1].toUpperCase(),
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/**
 * 客户名称规范化：读到「XX汽车」即可，去掉「股份有限公司」等公司后缀。
 * 如「长城汽车股份有限公司」→「长城汽车」；名称中不含「汽车」时保持原样。
 */
export function normalizeCustomer(name: string): string {
  const m = name.match(/^.+?汽车/);
  return m ? m[0] : name;
}

/**
 * 只从文本中提取元字段（客户/项目/产品/版本/日期），不识别测试项。
 * 用于 PDF 导入重命名场景。
 * 返回的字段可能为空，由调用方提示用户补全。
 */
export function parseMetaOnly(text: string, fileName: string): PdfReportMeta {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim());

  // ------- 客户：从封面「客户名称」标签读取，规范化到「XX汽车」为止；页眉编号只用于日期 -------
  const header = parseHeaderCode(text);
  const customer = normalizeCustomer(
    findField(text, /(?:客户|委托方|委托单位|甲方|送样单位)(?:名称)?\s*[：:]\s*([^\n]{1,60})/) || '',
  );

  // ------- 项目 / 产品 -------
  // 项目：零件名称中的字母数字段（如 B26-A、CS75-2025）
  // 产品：优先「产品名称」标签，否则取零件名称中字母数字段之外的文字部分
  const partName =
    findField(text, /零件(?:名称)?\s*[：:]\s*([^\n]{1,80})/) ||
    findField(text, /样件(?:名称|编号)?\s*[：:]\s*([^\n]{1,80})/) ||
    '';
  const split = splitPartName(partName);
  // 试验项目：优先取「试验结果」表格里的「试验项目」，否则回退封面「项目名称」一栏
  const testItem =
    parseTestItemFromTable(text) || findField(text, /项目(?:名称|代号)?\s*[：:]\s*([^\n]{1,60})/) || '';
  let project = split.project || testItem;
  let product = findField(text, /产品(?:名称|型号)?\s*[：:]\s*([^\n]{1,60})/) || split.product;

  // ------- 版本（显式标签 优先 → 正文 V 号兜底 → 文件名兜底） -------
  let version =
    findField(text, /版本(?:号)?\s*[：:]\s*([^\n]{1,20})/) ||
    (text.match(/(?:^|[\s（(])(V\d+(?:\.\d+)*)/)?.[1] ?? '');
  if (!version) {
    const m = fileName.match(/(V\d+(?:\.\d+)*)/i);
    if (m) version = m[1].toUpperCase();
  }

  // ------- 日期（页眉编号优先 → 文本兜底 → 文件名兜底） -------
  let date = header?.date || normalizeDate(text);
  if (!date) date = normalizeDate(fileName);

  // ------- 标题行兜底：首行若非字段行，按分隔符拆成 客户/项目/产品 -------
  const titleLine = lines.find((l) => !/[：:]/.test(l) && l.length >= 6) ?? '';
  if (titleLine && (!project || !product)) {
    const parts = titleLine
      .split(/\s*[+＋|｜]\s*|\s{2,}|[—–-]{1,2}/)
      .map((s) => s.trim())
      .filter(Boolean);
    // 如果有客户未识别，parts[0] 可能是客户
    if (!customer && parts.length >= 3) {
      // 保险起见：标题里的第一段通常是客户（如"长安"），然后是产品项目
      // 但也有可能第一段直接是项目。这里只在客户完全识别不出时尝试兜底
      // 不强行填充，避免误伤
    }
    if (!project) project = parts[0] ?? '';
    if (!product) product = parts[1] ?? '';
  }

  return { customer, project, testItem, product, version, date };
}

/** 检查必填元字段是否齐全，返回缺失字段名数组（空数组表示齐全） */
export function missingMetaFields(meta: PdfReportMeta): string[] {
  const missing: string[] = [];
  if (!meta.customer) missing.push('客户');
  if (!meta.project) missing.push('项目');
  if (!meta.product) missing.push('产品');
  if (!meta.version) missing.push('版本号');
  if (!meta.date) missing.push('日期');
  return missing;
}

/**
 * 解析试验报告文本：识别项目/产品/版本/日期，并按关键字抓取测试项。
 * 识别不出时保留空值，交由界面人工校对。
 */
export function parseTestReport(text: string, fileName: string, keywords: string[]): Omit<TestReport, 'id'> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim());

  // ------- 项目 / 产品 / 版本 / 日期 -------
  const project = findField(text, /项目(?:名称)?\s*[：:]\s*([^\n]{1,60})/) || '';
  const product = findField(text, /产品(?:名称)?\s*[：:]\s*([^\n]{1,60})/) || '';
  const version =
    findField(text, /版本(?:号)?\s*[：:]\s*([^\n]{1,20})/) || (text.match(/(?:^|[\s（(])(V\d+(?:\.\d+)*)/)?.[1] ?? '');
  const date = normalizeDate(text) || normalizeDate(fileName);

  // 标题兜底：首行若非字段行，按分隔符拆成项目/产品
  const titleLine = lines.find((l) => !/[：:]/.test(l) && l.length >= 6) ?? '';
  let metaProject = project;
  let metaProduct = product;
  if (!metaProject && !metaProduct && titleLine) {
    const parts = titleLine.split(/\s*[+＋|｜]\s*|\s{2,}|[—–-]{1,2}/).map((s) => s.trim()).filter(Boolean);
    metaProject = parts[0] ?? '';
    metaProduct = parts[1] ?? '';
  }

  // ------- 测试项：关键字 + 就近数值 -------
  const numRe = /(-?\d+(?:\.\d+)?)\s*(dB\(A\)|dB|dBA|Pa|kPa|MPa|m³\/h|m3\/h|m3\/min|L\/min|L\/s|r\/min|rpm|℃|°C|Hz|kHz|mm\/s|mm|m\/s|kg|g|mg\/m³|mg\/m3|%)?/;
  const condRe = /([\u4e00-\u9fa5A-Za-z]{2,8})\s*[=＝]\s*(-?\d+(?:\.\d+)?\s*(?:dB\(A\)|dB|Pa|kPa|MPa|m³\/h|m3\/h|L\/min|L\/s|r\/min|rpm|℃|°C|Hz|kHz|mm|m\/s|%))/g;
  const pairs: TestItem[] = [];
  const seen = new Set<string>();
  // 长关键字优先（如「压力降」先于「压降」），每行只取第一个命中的指标，避免重复行
  const sortedKeywords = [...keywords].sort((a, b) => b.length - a.length);

  for (const line of lines) {
    if (/[：:]/.test(line) && /(项目|产品|版本|日期|编号|委托|单位|地址|电话)/.test(line)) continue;
    const lower = line.toLowerCase();
    for (const kw of sortedKeywords) {
      const kwLower = kw.toLowerCase();
      const idx = lower.indexOf(kwLower);
      if (idx < 0) continue;
      const rest = line.slice(idx + kw.length);
      const num = rest.match(numRe);
      if (!num) continue;
      const value = `${num[1]}${num[2] ? ` ${num[2]}` : ''}`.trim();
      const key = `${kw}|${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // 条件：优先取显式「名=值」，否则按常见工况补默认标签
      const conds: string[] = [];
      for (const m of line.matchAll(condRe)) {
        if (m[1] === kw) continue;
        conds.push(`${m[1]}=${m[2].replace(/\s+/g, ' ')}`);
      }
      if (conds.length === 0) {
        const t = line.match(/(\d+(?:\.\d+)?)\s*(r\/min|rpm)/);
        if (t) conds.push(`转速=${t[1]} r/min`);
        const q = line.match(/(\d+(?:\.\d+)?)\s*(m³\/h|m3\/h|L\/min|L\/s)/);
        if (q) conds.push(`流量=${q[1]} ${q[2]}`);
      }

      const results = [`实测值=${value}`];
      const verdict = line.match(/(不合格|不通过|合格|通过|NG|OK)/);
      if (verdict) results.push(`判定=${verdict[1]}`);

      pairs.push({
        id: `${Date.now()}-${pairs.length}`,
        name: kw,
        conditionText: conds.join('；'),
        resultText: results.join('；'),
      });
      break;
    }
  }

  return {
    fileName,
    meta: { project: metaProject, product: metaProduct, version, date },
    items: pairs,
  };
}

/** 把「名=值；名=值」拆成 Excel 需要的参数/结果对 */
function splitPairs(text: string): { name: string; value: string }[] {
  return text
    .split(/[；;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf('=');
      return i >= 0 ? { name: s.slice(0, i).trim(), value: s.slice(i + 1).trim() } : { name: '备注', value: s };
    });
}

export function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Excel 文件名：项目+产品名+版本号+日期 */
export function testReportFileName(meta: TestReportMeta): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').trim();
  const date = (meta.date || '').replace(/-/g, '') || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${clean(meta.project) || '未识别项目'}+${clean(meta.product) || '未识别产品'}+${clean(meta.version) || 'V0'}+${date}.xlsx`;
}

/**
 * 生成「试验测试表」Excel（base64）。
 * 版式与计算书附表一致：信息行 + 双行表头 + 每项测试的纵向合并块，
 * 测试条件与测试结果各跨两列。
 */
export async function buildTestXlsxBase64(meta: TestReportMeta, items: TestItem[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '理论计算平台';
  wb.created = new Date();

  const ws = wb.addWorksheet('试验测试表', {
    views: [{ state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 8 }, { width: 30 }, { width: 22 }, { width: 16 }, { width: 22 }, { width: 16 }];

  const thin = { style: 'thin' as const, color: { argb: 'FF808080' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const center: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const fillHeader: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F4' } };

  const infoText = [meta.project, meta.product].filter(Boolean).join('　') || '—';
  ws.addRow(['项目/产品：', infoText, '', '', '', '']).height = 22;
  ws.mergeCells('B1:F1');
  ws.addRow(['版本：', meta.version || '—', '', '', '日期：', meta.date || '—']).height = 22;
  ws.mergeCells('B2:C2');
  ws.mergeCells('E2:F2');

  ws.addRow(['序号', '测试项目', '测试条件', '', '测试结果', '']).height = 24;
  ws.mergeCells('C3:D3');
  ws.mergeCells('E3:F3');

  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= 6; c++) {
      const cell = ws.getCell(r, c);
      cell.border = border;
      cell.alignment = center;
      cell.font = { name: '宋体', size: 10, bold: true };
    }
  }
  for (let c = 1; c <= 6; c++) ws.getCell(3, c).fill = fillHeader;

  let rowNo = 4;
  items.forEach((it, idx) => {
    const conds = splitPairs(it.conditionText);
    const results = splitPairs(it.resultText);
    const rows = Math.max(conds.length, results.length, 1);
    const start = rowNo;
    for (let i = 0; i < rows; i++) {
      const row = ws.getRow(start + i);
      row.height = 22;
      row.getCell(3).value = conds[i]?.name ?? '';
      row.getCell(4).value = conds[i]?.value ?? '';
      row.getCell(5).value = results[i]?.name ?? '';
      row.getCell(6).value = results[i]?.value ?? '';
      for (let c = 1; c <= 6; c++) {
        const cell = row.getCell(c);
        cell.border = border;
        cell.alignment = center;
        cell.font = { name: '宋体', size: 10 };
      }
    }
    ws.getCell(start, 1).value = idx + 1;
    ws.getCell(start, 2).value = it.name;
    if (rows > 1) {
      ws.mergeCells(start, 1, start + rows - 1, 1);
      ws.mergeCells(start, 2, start + rows - 1, 2);
    }
    rowNo += rows;
  });

  const note = ws.getRow(rowNo);
  note.getCell(1).value = '注：本表由试验报告自动识别并经人工校对生成，用于与理论计算结果对比。';
  note.getCell(1).font = { name: '宋体', size: 9, color: { argb: 'FF556375' } };
  note.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

  const buf = await wb.xlsx.writeBuffer();
  return bufToBase64(buf as unknown as ArrayBuffer);
}
