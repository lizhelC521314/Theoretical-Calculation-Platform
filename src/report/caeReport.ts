import {
  bufToBase64,
  cleanOcrVersion,
  despaceOcrText,
  extractPdfText,
  normalizeCustomer,
  normalizeDate,
  ocrPdfFirstPage,
  parseHeaderCode,
  parseOcrHeaderCode,
  splitPartName,
} from './testReport';

/**
 * CAE 报告模块（虚拟验证）
 *
 * 与试验报告模块保持同一套流程与字段风格：
 *   PDF → 文字层提取（扫描件走系统 OCR）→ 识别客户/项目/仿真项目/产品/版本/日期
 *   → 人工校对 → 以「客户+项目+仿真项目+产品+版本+日期.pdf」归档到 CAE 仿真库。
 */

/** CAE 报告归档元信息 */
export interface CaeReportMeta {
  customer: string;
  project: string;
  /** 仿真项目：如「进气阻力仿真分析」「结构强度校核」「流场分析」 */
  caeItem: string;
  product: string;
  version: string;
  date: string;
}

/** 仿真项目常见写法（封面/信息表中的字段名） */
const CAE_ITEM_LABEL =
  '(?:仿真项目|分析项目|CAE项目|CAE分析项目|计算项目|校核项目|仿真类型|分析类型|仿真内容|分析内容|仿真工况|分析工况)';

/** 字段截止用的已知标签集合（避免把下一个字段读进当前值） */
const KNOWN_LABELS =
  '(?:客户名称|客户|委托单位|委托方|甲方|送样单位|项目名称|项目代号|产品名称|产品型号|零件名称|零部件号|样件名称|仿真项目|分析项目|CAE项目|CAE分析项目|计算项目|校核项目|仿真类型|分析类型|仿真内容|分析内容|仿真工况|分析工况|仿真软件|分析软件|求解器|软件版本|版本号|报告编号|报告日期|分析日期|仿真日期|编制|审核|批准|备注|结论|摘要|目录)';

/** CAE 常见分析项关键字（长词优先，文件名/标题兜底用） */
const CAE_KEYWORDS = [
  '进气系统阻力',
  '进气阻力',
  '压力损失',
  '流场分析',
  '流场',
  '流阻',
  '气动分析',
  '气动',
  'CAE分析',
  'CFD',
  '结构强度分析',
  '结构强度',
  '强度分析',
  '强度校核',
  '动刚度分析',
  '刚度分析',
  '刚度',
  '模态分析',
  '模态',
  '疲劳分析',
  '疲劳',
  '热分析',
  '传热分析',
  '传热',
  'NVH分析',
  'NVH',
  '声学分析',
  '声学',
  '传递损失',
  '插入损失',
  '噪声分析',
  '噪声',
  '振动分析',
  '振动',
  '密封分析',
  '密封',
  '变形分析',
  '变形',
  '应力分析',
  '应力',
];

/** 常见主机厂简称：PPT 报告文件名通常以「客户 + 项目代号」开头 */
const OEM_NAMES = [
  '上汽',
  '一汽',
  '广汽',
  '北汽',
  '东风',
  '长安',
  '长城',
  '比亚迪',
  '吉利',
  '奇瑞',
  '江淮',
  '五菱',
  '重汽',
  '陕汽',
  '福田',
  '江铃',
  '蔚来',
  '理想',
  '小鹏',
  '哪吒',
  '零跑',
  '赛力斯',
  '华为',
  '小米',
];

/** 判断候选值是否像仿真项目名称（排除编号、日期、状态词与纯代码） */
function isLikelyCaeItem(value: string): boolean {
  const compact = value.replace(/[ \t]/g, '').trim();
  if (!compact) return false;
  if (/^(稳态|瞬态|静态|动态|线性|非线性|一维|二维|三维|是|否|无)$/.test(compact)) return false;
  if (/^\d/.test(compact)) return false; // 编号 / 日期
  if (/^[A-Za-z0-9\-_.]+$/.test(compact) && !/^(CFD|NVH|CAE)$/i.test(compact)) return false; // 纯项目代号
  if (!/^[一-鿿A-Za-z0-9·\-—（）()+/ ]{2,32}$/.test(value.trim())) return false;
  if ((compact.match(/[一-鿿]/g) || []).length === 0 && compact.length < 2) return false;
  return true;
}

/** 文字版：按「标签：值」读取（冒号必需，截止到行尾） */
function lineField(text: string, label: string): string {
  const re = new RegExp(`(?:${label})\\s*[：:]\\s*([^\\n]{1,60})`);
  const m = text.match(re);
  return m && m[1] ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/**
 * 标签取值：原文本取不到时，再去掉字间空格后重试
 * （PPT 导出的 PDF 里标签常被拉开成「版   本」「时   间」）
 */
function fieldText(text: string, label: string): string {
  const v = lineField(text, label);
  if (v) return v;
  return lineField(despaceOcrText(text), label);
}

/** 表格型：标签所在单元格右侧的单元格 */
function tableField(text: string, labelRe: RegExp): string {
  for (const line of text.split(/\r?\n/)) {
    const cells = line
      .split(/\t|[ ]{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const idx = cells.findIndex((c) => labelRe.test(c.replace(/[ \t]+/g, '') || ''));
    if (idx >= 0 && idx + 1 < cells.length) return cells[idx + 1];
  }
  return '';
}

/** OCR 文本：去掉字间空格后，按标签读取到下一个已知标签为止 */
function ocrField(text: string, label: string): string {
  const re = new RegExp(
    `(?:${label})\\s*[：:.．]?\\s*(.+?)(?=(?:${KNOWN_LABELS}\\s*[：:.．]?|\\s|$))`,
  );
  const m = text.match(re);
  if (!m || !m[1]) return '';
  return m[1].replace(/^[：:.．\s]+/, '').trim();
}

/** 从文件名兜底识别仿真项目（如「SC6HAU进气系统阻力报告.pdf」→ 进气阻力） */
export function caeItemFromFileName(fileName: string): string {
  const name = fileName.toLowerCase();
  for (const k of CAE_KEYWORDS) {
    if (name.includes(k.toLowerCase())) return k;
  }
  return '';
}

/**
 * 从文件名反推元信息（CAE 的 PPT 报告通常以「客户 项目代号 产品+分析项报告-V1-日期」命名，
 * 如「上汽 AS5PM 出气谐振器强度分析报告-V1-20261029.pptx」）。
 */
export function parseCaeFileName(fileName: string): {
  customer: string;
  project: string;
  product: string;
  caeItem: string;
  version: string;
  date: string;
} {
  const stem = fileName.replace(/\.(pptx?|ppsx?|pdf)$/i, '').trim();
  if (!stem) return { customer: '', project: '', product: '', caeItem: '', version: '', date: '' };

  // 日期：优先 8 位连写（20261029），其次 2026-10-29 / 2026.10.29
  const date8 = stem.match(/(20\d{2})(\d{2})(\d{2})/);
  const date = date8
    ? `${date8[1]}-${date8[2]}-${date8[3]}`
    : normalizeDate(stem);

  // 版本：V1 / V1.0 / AS5PM-V1
  const vm = stem.match(/[-_ ](V\d+(?:\.\d+)*)(?=[-_ ]|$)/i) || stem.match(/(V\d+(?:\.\d+)*)/i);
  const version = vm ? vm[1].toUpperCase() : '';

  // 去掉版本与日期段，剩下的按空格切分：客户 / 项目代号 / 产品与分析项
  const body = stem
    .replace(/[-_ ]?V\d+(?:\.\d+)*/gi, ' ')
    .replace(/(20\d{2})(\d{2})(\d{2})/g, ' ')
    .replace(/[-_ ]20\d{2}[-_.]\d{2}[-_.]\d{2}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = body.split(/[\s　]+/).filter(Boolean);
  let customer = '';
  let project = '';
  let rest = body;

  const oem = OEM_NAMES.find((n) => tokens[0] === n || tokens[0]?.startsWith(n));
  if (oem) {
    customer = oem;
    rest = rest.replace(new RegExp(`^${oem}\\s*`), '').trim();
  }

  const codeRe = /^[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*$/;
  const first = rest.split(/[\s　]+/)[0] || '';
  if (codeRe.test(first)) {
    project = first;
    rest = rest.slice(first.length).trim();
  }

  const kw = CAE_KEYWORDS.find((k) => rest.toLowerCase().includes(k.toLowerCase()));
  let product = kw ? rest.slice(0, rest.toLowerCase().indexOf(kw.toLowerCase())) : rest;
  product = product
    .replace(/[（(].*?[）)]/g, ' ')
    .replace(/[（(]/g, '')
    .replace(/报告$/g, '')
    .replace(/\s+/g, '')
    .trim();

  return { customer, project, product, caeItem: kw || caeItemFromFileName(stem), version, date };
}

/** 版本号清洗：显式标签 → 正文 V 号 → 文件名兜底 */
function pickVersion(labelValue: string, text: string, fileName: string): string {
  let version = cleanOcrVersion(labelValue);
  // 「版本：AS5PM-V1」这类带前缀的值，取其中的 V 号
  if (!version) {
    const m = labelValue.match(/V\d+(?:\.\d+)*/i);
    if (m) version = m[0].toUpperCase();
  }
  if (!version) {
    const m = text.match(/(?:^|[\s（(])(V\d+(?:\.\d+)*)/);
    if (m) version = m[1].toUpperCase();
  }
  if (!version) version = parseCaeFileName(fileName).version;
  return version;
}

/**
 * 项目/产品拆分（与试验报告一致）：
 * 零件名称只有中文时项目与产品同名；含字母数字段时字母数字段为项目、其余为产品。
 * 项目兜底顺序：零件名称拆分 → 「项目名称」标签（非仿真项时）→ 文件名项目代号 → 仿真项目。
 */
function projectAndProduct(
  partName: string,
  productLabel: string,
  projectLabel: string,
  caeItem: string,
  fileMeta: ReturnType<typeof parseCaeFileName>,
) {
  const split = splitPartName(partName);
  if (split.onlyChinese) {
    return { project: split.project || fileMeta.project, product: split.product || fileMeta.product };
  }
  const project =
    split.project ||
    (projectLabel && !isLikelyCaeItem(projectLabel) ? projectLabel : '') ||
    fileMeta.project ||
    caeItem;
  const product = productLabel || split.product || fileMeta.product;
  return { project, product };
}

/**
 * 解析文字版 CAE 报告：客户/项目/仿真项目/产品/版本/日期。
 * 识别不出的字段留空，由界面人工补全。
 */
export function parseCaeMeta(text: string, fileName: string): CaeReportMeta {
  const fileMeta = parseCaeFileName(fileName);
  const header = parseHeaderCode(text);
  const customer =
    normalizeCustomer(fieldText(text, '客户(?:名称)?|委托方|委托单位|甲方|送样单位') || '') ||
    fileMeta.customer;

  // 仿真项目：显式标签 → 表格单元格 → 封面「项目名称」（该模板下项目名称即仿真项）→ 文件名关键字
  const itemLabel =
    fieldText(text, CAE_ITEM_LABEL) ||
    tableField(
      text,
      /^(仿真项目|分析项目|CAE项目|CAE分析项目|计算项目|校核项目|仿真类型|分析类型|仿真内容|分析内容|仿真工况|分析工况)$/,
    ) ||
    '';
  const projectLabel = fieldText(text, '项目(?:名称|代号)?');
  const candidate = [itemLabel, projectLabel].find((v) => v && isLikelyCaeItem(v)) || '';
  const caeItem = candidate || fileMeta.caeItem;

  const partName = fieldText(text, '零件(?:名称)?') || fieldText(text, '样件(?:名称)?') || '';
  const { project, product } = projectAndProduct(
    partName,
    fieldText(text, '产品(?:名称|型号)?'),
    projectLabel,
    caeItem,
    fileMeta,
  );

  const version = pickVersion(fieldText(text, '版本(?:号)?'), text, fileName);
  const date = header?.date || normalizeDate(text) || fileMeta.date;

  return { customer, project, caeItem, product, version, date };
}

/** 解析扫描件 OCR 文本：封面页取客户/项目/产品/版本/日期，仿真项目可在后续页面查找 */
export function parseCaeOcrMeta(rawText: string, fileName: string): CaeReportMeta {
  const fileMeta = parseCaeFileName(fileName);
  const firstPage = rawText.split(/\n{2,}/)[0] || rawText;
  const header = parseHeaderCode(firstPage) || parseOcrHeaderCode(firstPage);
  const cover = despaceOcrText(firstPage);
  const full = despaceOcrText(rawText);

  const customer =
    normalizeCustomer(ocrField(cover, '客户(?:名称)?|委托方|委托单位|甲方|送样单位')) || fileMeta.customer;

  // 仿真项目：全文按标签查找 → 封面「项目名称」→ 文件名关键字
  const itemLabel = ocrField(full, CAE_ITEM_LABEL);
  const projectLabel = ocrField(cover, '项目(?:名称|代号)?');
  const candidate = [itemLabel, projectLabel].find((v) => v && isLikelyCaeItem(v)) || '';
  const caeItem = candidate || fileMeta.caeItem;

  const partName = ocrField(cover, '零件(?:名称)?') || ocrField(cover, '样件(?:名称)?');
  const { project, product } = projectAndProduct(
    partName,
    ocrField(cover, '产品(?:名称|型号)?'),
    projectLabel,
    caeItem,
    fileMeta,
  );

  const version = pickVersion(ocrField(cover, '版本(?:号)?'), cover, fileName);
  const date = header?.date || normalizeDate(cover) || fileMeta.date;

  return { customer, project, caeItem, product, version, date };
}

/** 用 secondary 中的非空字段补齐 primary 的空字段（文字版与 OCR 两种解析互相兜底） */
export function fillCaeMetaMissing(primary: CaeReportMeta, secondary: CaeReportMeta): CaeReportMeta {
  const out = { ...primary };
  (Object.keys(out) as (keyof CaeReportMeta)[]).forEach((k) => {
    if (!out[k] && secondary[k]) out[k] = secondary[k];
  });
  return out;
}

/** 检查必填元字段是否齐全，返回缺失字段名数组 */
export function missingCaeMetaFields(meta: CaeReportMeta): string[] {
  const missing: string[] = [];
  if (!meta.customer) missing.push('客户');
  if (!meta.project) missing.push('项目');
  if (!meta.product) missing.push('产品');
  if (!meta.version) missing.push('版本号');
  if (!meta.date) missing.push('日期');
  return missing;
}

export { bufToBase64, extractPdfText, ocrPdfFirstPage };
