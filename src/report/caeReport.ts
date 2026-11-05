import {
  bufToBase64,
  despaceOcrText,
  extractPdfText,
  normalizeCustomer,
  normalizeDate,
  ocrPdfFirstPage,
  splitPartName,
} from './testReport';

/**
 * CAE 报告模块（虚拟验证）
 *
 * 与试验报告模块保持同一套流程与字段风格：
 *   PDF → 文字层提取（扫描件走系统 OCR）→ 识别客户/项目/仿真项目/产品/版本/日期
 *   → CFD / 流阻报告再从正文第一页识别流量 → 人工校对
 *   → 以「客户+项目+仿真项目+[流量]+产品+版本+日期.pdf」归档到 CAE 仿真库。
 */

/** CAE 报告归档元信息 */
export interface CaeReportMeta {
  customer: string;
  project: string;
  /** 仿真项目：如「进气阻力仿真分析」「结构强度校核」「流场分析」 */
  caeItem: string;
  /** 流量（仅 CFD / 流阻报告）：正文第一页的数值，多个用「/」分隔 */
  flow: string;
  /** 流量单位，如 kg/h、m³/h、L/min */
  flowUnit: string;
  product: string;
  version: string;
  date: string;
}

/** 只有 CFD / 流阻报告需要记录流量（与试验报告中进气阻力报告的处理一致） */
export function caeNeedsFlow(caeItem: string): boolean {
  return /CFD|流阻/i.test(caeItem || '');
}

/** 流量单位归一：m3/h → m³/h、l/min → L/min，保留 kg/h 等常用写法 */
export function normalizeFlowUnit(raw: string): string {
  const u = (raw || '').replace(/\s+/g, '').replace(/³/g, '3').toLowerCase();
  const m = u.match(/^(kg|m3|l|ml)\/(h|min|s)$/);
  if (!m) return (raw || '').trim();
  const [vol, time] = [m[1], m[2]];
  if (vol === 'm3') return `m³/${time}`;
  if (vol === 'l') return `L/${time}`;
  if (vol === 'ml') return `mL/${time}`;
  return `kg/${time}`;
}

/** 文字中的流量：数字 + 流量单位，如 10L/min、10kg/h、10m³/h */
const FLOW_IN_TEXT = /(\d+(?:[.,]\d+)?)\s*(kg|m[³3]|l|ml)\s*[\/／|丨]\s*(h|min|s)(?![a-z])/gi;
/** 仅单位单元格，如「(kg/h)」 */
const FLOW_UNIT_CELL = /^[（(]?\s*(kg|m[³3]|l|ml)\s*[\/／|丨]\s*(h|min|s)\s*[）)]?$/i;

/** 表格行按两个以上空格 / 制表符拆列（主进程提取文本时列间距至少补 3 个空格） */
function splitFlowCells(line: string): string[] {
  return line
    .split(/\t|[ ]{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** 从一行文字里取流量单位（优先取表格「流量(kg/h)」中的单位） */
function flowUnitInLine(line: string): string {
  const m = line.match(/(kg|m[³3]|l|ml)\s*[\/／|丨]\s*(h|min|s)/i);
  return m ? normalizeFlowUnit(m[0]) : '';
}

/**
 * 解析正文第一页的流量（仅 CFD / 流阻使用），与试验报告规则一致：
 *   1) 正文中「数字 + 流量单位」，如 10L/min、10kg/h、10m³/h；
 *   2) 表格中「流量」列下一行的数值，如「流量(kg/h)」列下方为 330。
 * 多个流量按出现顺序用「/」连接；找不到返回空串。
 */
export function parseCaeFlow(text: string): { flow: string; flowUnit: string } {
  if (!text) return { flow: '', flowUnit: '' };

  // 情况一：正文里的「数字 + 流量单位」
  const values: string[] = [];
  let unit = '';
  for (const m of text.matchAll(FLOW_IN_TEXT)) {
    const v = m[1].replace(',', '.');
    if (!values.includes(v)) values.push(v);
    unit = normalizeFlowUnit(m[0].replace(m[1], ''));
  }
  if (values.length) return { flow: values.join('/'), flowUnit: unit };

  // 情况二：表格「流量」列下方一行的数值
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const header = splitFlowCells(lines[i]);
    const rawIdx = header.findIndex((c) => /流量/.test(c));
    if (rawIdx < 0) continue;

    const unitFromHeader = flowUnitInLine(lines[i]);
    // 排除单独的单位单元格后再计算「流量」是第几列，避免表头多一个单位格导致错位
    const effective = header.filter((c) => !FLOW_UNIT_CELL.test(c.replace(/[ \t]/g, '')));
    const flowOrdinal = effective.findIndex((c) => /流量/.test(c));
    if (flowOrdinal < 0) continue;

    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const data = splitFlowCells(lines[j]);
      if (data.length < 2) continue;

      const start = Math.max(0, flowOrdinal - 1);
      const textAt = data.findIndex((c, k) => k >= start && /[一-鿿]/.test(c));
      const region = data.slice(start, textAt >= 0 ? textAt : data.length);
      const numericInRegion = region.filter((c) => /^\d+(?:[.,]\d+)?(?:[\/／,，]\d+(?:[.,]\d+)?)*$/.test(c));
      if (numericInRegion.length) {
        const value = numericInRegion[numericInRegion.length - 1]
          .replace(/[，,]/g, '/')
          .replace(/[／]/g, '/');
        return { flow: value, flowUnit: unitFromHeader || flowUnitInLine(lines[j]) };
      }

      // 行内数值列较少时，按列序号兜底
      for (const k of [flowOrdinal, rawIdx, flowOrdinal + 1]) {
        const token = data[k];
        if (token && /^\d+(?:[.,]\d+)?$/.test(token)) {
          return {
            flow: token.replace(',', '.'),
            flowUnit: unitFromHeader || flowUnitInLine(lines[j]),
          };
        }
      }
    }
  }

  return { flow: '', flowUnit: '' };
}

/** 仿真项目常见写法（封面/信息表中的字段名） */
const CAE_ITEM_LABEL =
  '(?:仿真项目|分析项目|CAE项目|CAE分析项目|计算项目|校核项目|仿真类型|分析类型|仿真内容|分析内容|仿真工况|分析工况)';

/** 字段截止用的已知标签集合（避免把下一个字段读进当前值） */
const KNOWN_LABELS =
  '(?:客户名称|客户|委托单位|委托方|甲方|送样单位|项目名称|项目代号|产品名称|产品型号|零件名称|零部件号|样件名称|仿真项目|分析项目|CAE项目|CAE分析项目|计算项目|校核项目|仿真类型|分析类型|仿真内容|分析内容|仿真工况|分析工况|仿真软件|分析软件|求解器|软件版本|版本号|报告编号|报告日期|分析日期|仿真日期|编制|审核|批准|备注|结论|摘要|目录)';

/** 封面标题中用于判定仿真项目的分析类型（长词优先） */
export const CAE_ANALYSIS_TYPES = [
  '进气口噪音',
  '随机振动',
  '传递损失',
  '约束模态',
  '自由模态',
  '按压刚度',
  '动刚度',
  '动响应',
  '流阻',
  '模态',
  '强度',
  '疲劳',
  '塌陷',
  '爆破',
  '耐久',
  'CFD',
  'TL',
];

/** 标题中查找分析类型：取最早出现的一项，位置相同时取较长的词（如「约束模态」优先于「模态」） */
function findAnalysisType(title: string): { item: string; index: number } | null {
  const lower = title.toLowerCase();
  let best: { item: string; index: number } | null = null;
  for (const type of CAE_ANALYSIS_TYPES) {
    const index = lower.indexOf(type.toLowerCase());
    if (index < 0) continue;
    if (!best || index < best.index || (index === best.index && type.length > best.item.length)) {
      best = { item: type, index };
    }
  }
  return best;
}

/**
 * 标题行归一：OCR 逐字加空格时去掉全部空格（「上 汽 空 滤 器」→「上汽空滤器」），
 * 文字层标题保留单空格（作为客户与产品之间的分隔）。
 */
function normalizeTitleLine(line: string): string {
  const han = (line.match(/[一-鿿]/g) || []).length;
  const spaces = (line.match(/[ \t\u3000]+/g) || []).length;
  if (han >= 2 && spaces >= han * 0.6) return line.replace(/[\s\u3000]+/g, '');
  return line.replace(/[ \t\u3000]{2,}/g, ' ').trim();
}

/** 封面标题 → 仿真项目（命中的分析类型），未命中返回空串 */
export function caeItemFromTitle(title: string): string {
  return findAnalysisType(normalizeTitleLine(title || ''))?.item ?? '';
}

/**
 * 从封面标题反推客户 / 仿真项目 / 产品：
 *   客户：标题开头的中文，遇到字母、数字或特殊符号即结束（再规范化为「XX汽车」）；
 *   仿真项目：标题中命中的分析类型；
 *   产品：标题中「项目」与「仿真项目」之间的文字，去掉「的」。
 *   （project 由调用方按原有项目规则解析后传入；标题中找不到时不取产品）
 */
export function parseCaeTitle(
  title: string,
  project = '',
): { customer: string; caeItem: string; product: string } {
  const t = normalizeTitleLine(title || '');
  const customerMatch = t.match(/^[一-鿿]+/);
  const rawCustomer = customerMatch ? customerMatch[0] : '';
  const hit = findAnalysisType(t);

  let product = '';
  if (project && hit) {
    const projectIndex = t.toLowerCase().indexOf(project.toLowerCase());
    if (projectIndex >= 0 && projectIndex + project.length <= hit.index) {
      product = t
        .slice(projectIndex + project.length, hit.index)
        .replace(/的/g, '')
        .replace(/[\s\u3000]/g, '')
        .replace(/^[+＋|｜、，,·\-—–_.]+|[+＋|｜、，,·\-—–_.]+$/g, '');
    }
  }

  return {
    customer: rawCustomer ? normalizeCustomer(rawCustomer) : '',
    caeItem: hit?.item ?? '',
    product,
  };
}

/** 封面字段行开头（这些行不是标题） */
const COVER_LABEL_HEAD =
  /^(?:客户|委托|项目|产品|零件|样件|版本|时间|日期|编号|报告|审核|批准|设计|分析人员|编制|仿真|校核|计算)/;

/**
 * 取封面标题行：前 12 个非空行中，第一行不含字段冒号、且不以字段标签开头的文字。
 * 文字层与 OCR 共用（OCR 的字间空格在匹配前会去掉）。
 */
function coverTitle(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
  for (const line of lines) {
    if (/[：:]/.test(line)) continue;
    const compact = normalizeTitleLine(line);
    if (compact.length < 4) continue;
    if (COVER_LABEL_HEAD.test(compact)) continue;
    return compact;
  }
  return '';
}

/** CAE 常见分析项关键字（长词优先，文件名兜底用） */
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

/** 封面版本号：取「版本」右侧内容，去掉「项目」与「-」 */
function cleanCoverVersion(raw: string): string {
  if (!raw) return '';
  const v = raw
    .replace(/项目/g, '')
    .replace(/[-－—–]/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!v) return '';
  const m = v.match(/V\d+(?:\.\d+)*/i);
  return m ? m[0].toUpperCase() : v;
}

/** 封面下部字段标签：只取「时间」「版本」本身，避免误匹配「试验时间」「软件版本」 */
const COVER_TIME_LABEL = '(?<![一-鿿])时间';
const COVER_VERSION_LABEL = '(?<![一-鿿])版本(?:号)?';

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
 * flowText 传入正文第一页文本，仅 CFD / 流阻报告会从中识别流量。
 * 识别不出的字段留空，由界面人工补全。
 */
export function parseCaeMeta(text: string, fileName: string, flowText = ''): CaeReportMeta {
  const fileMeta = parseCaeFileName(fileName);
  const title = coverTitle(text);
  const titleHead = parseCaeTitle(title);

  // 客户：标题开头的中文 → 封面「客户名称」等标签 → 文件名
  const customer =
    titleHead.customer ||
    normalizeCustomer(fieldText(text, '客户(?:名称)?|委托方|委托单位|甲方|送样单位') || '') ||
    fileMeta.customer;

  // 仿真项目：标题中命中的分析类型 → 显式标签 → 表格单元格 →
  // 封面「项目名称」（该模板下项目名称即仿真项）→ 文件名关键字
  const itemLabel =
    fieldText(text, CAE_ITEM_LABEL) ||
    tableField(
      text,
      /^(仿真项目|分析项目|CAE项目|CAE分析项目|计算项目|校核项目|仿真类型|分析类型|仿真内容|分析内容|仿真工况|分析工况)$/,
    ) ||
    '';
  const projectLabel = fieldText(text, '项目(?:名称|代号)?');
  const candidate = [itemLabel, projectLabel].find((v) => v && isLikelyCaeItem(v)) || '';
  const caeItem = titleHead.caeItem || candidate || fileMeta.caeItem;

  // 项目维持原有解析；产品取标题中「项目与仿真项目之间」的文字
  const partName = fieldText(text, '零件(?:名称)?') || fieldText(text, '样件(?:名称)?') || '';
  const { project, product: fallbackProduct } = projectAndProduct(
    partName,
    fieldText(text, '产品(?:名称|型号)?'),
    projectLabel,
    caeItem,
    fileMeta,
  );
  const product = parseCaeTitle(title, project).product || fallbackProduct;

  // 日期与版本只从封面下部「时间」「版本」右侧读取，不再回退标题或文件名
  const version = cleanCoverVersion(fieldText(text, COVER_VERSION_LABEL));
  const date = normalizeDate(fieldText(text, COVER_TIME_LABEL));

  // 流量：仅 CFD / 流阻报告，从正文第一页读取
  const flow = caeNeedsFlow(caeItem) && flowText ? parseCaeFlow(flowText) : { flow: '', flowUnit: '' };

  return { customer, project, caeItem, flow: flow.flow, flowUnit: flow.flowUnit, product, version, date };
}

/**
 * 解析扫描件 OCR 文本：封面页取客户/项目/产品/版本/日期，仿真项目可在后续页面查找。
 * flowText 传入正文第一页 OCR 文本，仅 CFD / 流阻报告会从中识别流量。
 */
export function parseCaeOcrMeta(rawText: string, fileName: string, flowText = ''): CaeReportMeta {
  const fileMeta = parseCaeFileName(fileName);
  const firstPage = rawText.split(/\n{2,}/)[0] || rawText;
  const cover = despaceOcrText(firstPage);
  const full = despaceOcrText(rawText);
  const title = coverTitle(firstPage);
  const titleHead = parseCaeTitle(title);

  // 客户：标题开头的中文 → 封面「客户名称」等标签 → 文件名
  const customer =
    titleHead.customer ||
    normalizeCustomer(ocrField(cover, '客户(?:名称)?|委托方|委托单位|甲方|送样单位')) ||
    fileMeta.customer;

  // 仿真项目：标题中命中的分析类型 → 全文按标签查找 → 封面「项目名称」→ 文件名关键字
  const itemLabel = ocrField(full, CAE_ITEM_LABEL);
  const projectLabel = ocrField(cover, '项目(?:名称|代号)?');
  const candidate = [itemLabel, projectLabel].find((v) => v && isLikelyCaeItem(v)) || '';
  const caeItem = titleHead.caeItem || candidate || fileMeta.caeItem;

  // 项目维持原有解析；产品取标题中「项目与仿真项目之间」的文字
  const partName = ocrField(cover, '零件(?:名称)?') || ocrField(cover, '样件(?:名称)?');
  const { project, product: fallbackProduct } = projectAndProduct(
    partName,
    ocrField(cover, '产品(?:名称|型号)?'),
    projectLabel,
    caeItem,
    fileMeta,
  );
  const product = parseCaeTitle(title, project).product || fallbackProduct;

  // 日期与版本只从封面下部「时间」「版本」右侧读取，不再回退标题或文件名
  const version = cleanCoverVersion(ocrField(cover, COVER_VERSION_LABEL));
  const date = normalizeDate(ocrField(cover, COVER_TIME_LABEL));

  // 流量：仅 CFD / 流阻报告，从正文第一页读取
  const flow = caeNeedsFlow(caeItem) && flowText ? parseCaeFlow(flowText) : { flow: '', flowUnit: '' };

  return { customer, project, caeItem, flow: flow.flow, flowUnit: flow.flowUnit, product, version, date };
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
