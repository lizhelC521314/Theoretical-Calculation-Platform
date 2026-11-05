import ExcelJS from 'exceljs';

/**
 * 可信资产数据模块
 *
 * 服务器 UNC 路径：\\10.1.1.245\Product Database
 *   理论计算库 → Theoretical Calculation Library
 *   试验测试库 → Experimental Test Database
 *   可信资产库 → Trusted Data Asset Library
 *
 * 所有文件读写由 Electron 主进程执行（IPC：db:*），
 * 渲染进程只调用 api.db.* 封装。
 */

export const UNC_ROOT = '\\\\10.1.1.245\\Product Database';
export const UNC_CALC_LIB = `${UNC_ROOT}\\Theoretical Calculation Library`;
export const UNC_TEST_LIB = `${UNC_ROOT}\\Experimental Test Database`;
export const UNC_TRUSTED = `${UNC_ROOT}\\Trusted Data Asset Library`;
export const UNC_CAE_LIB = `${UNC_ROOT}\\Virtual Verification Library`;

/** 项目-产品-版本键：统一空格，避免因字符差异导致匹配失败 */
export function productKey(project: string, product: string, version: string): string {
  return [project, product, version].map((s) => (s || '').trim().replace(/\s+/g, ' ')).join(' | ');
}

/** 文件名清洗：去掉 Windows 非法字符 */
export function cleanFileName(s: string): string {
  return (s || '').replace(/[\\/:*?"<>|]/g, '').trim() || '未命名';
}

/** 生成归档 Excel 文件名：项目+产品+版本+日期.xlsx */
export function archiveFileName(project: string, product: string, version: string, date?: string): string {
  const d = (date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  return `${cleanFileName(project)}+${cleanFileName(product)}+${cleanFileName(version || 'V0')}+${d}.xlsx`;
}

/**
 * 流量段：370 + kg/h → 370kg-h（文件名不能含「/」）；m³/h → 370m3-h；
 * 多个流量 260/240 → 260,240kg-h
 */
function flowSegment(flow: string, unit: string): string {
  const values = (flow || '')
    .split(/[\/／、,，]+/)
    .map((s) => cleanFileName(s.trim()))
    .filter((s) => s && s !== '未命名');
  if (!values.length) return '';
  const v = values.join(',');
  const u = unit.trim().toLowerCase();
  if (/^m[³3]/.test(u)) return `${v}m3-h`;
  if (/^kg/.test(u)) return `${v}kg-h`;
  const cleaned = cleanFileName(u);
  return cleaned && cleaned !== '未命名' ? `${v}${cleaned}` : v;
}

/** 反解流量段（370kg-h / 370m3-h / 260,240kg-h） */
function parseFlowSegment(segment: string): { flow: string; flowUnit: string } {
  const m = segment.match(/^([\d.,]+)(m3-h|kg-h)?$/i);
  if (!m) return { flow: segment, flowUnit: '' };
  return {
    flow: m[1].replace(/,/g, '/'),
    flowUnit: m[2] ? (m[2].toLowerCase().startsWith('m') ? 'm³/h' : 'kg/h') : '',
  };
}

/**
 * PDF 归档文件名：客户+项目+试验项目+[流量]+产品+版本+日期.pdf（单一真源模板）
 * 流量段只在进气阻力等需要记录流量的报告中出现，其余报告保持原六段格式。
 */
export function archivePdfFileName(
  customer: string,
  project: string,
  testItem: string,
  product: string,
  version: string,
  date: string,
  flow = '',
  flowUnit = '',
): string {
  const d = (date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const flowSeg = flowSegment(flow, flowUnit);
  const parts = [customer, project, testItem, ...(flowSeg ? [flowSeg] : []), product, version || 'V0', d].map(
    (s) => cleanFileName(s),
  );
  return `${parts.join('+')}.pdf`;
}

/**
 * 从归档文件名反解元信息。兼容四种格式：
 *   新版 PDF（含流量）：客户+项目+试验项目+流量+产品+版本+日期（去掉日期后 6 段）
 *   新版 PDF：客户+项目+试验项目+产品+版本+日期（去掉日期后 5 段）
 *   旧版 PDF：客户+项目+产品+版本+日期（去掉日期后 4 段）
 *   xlsx：项目+产品+版本+日期（去掉日期后 3 段）
 */
export function parseArchiveName(name: string): {
  customer: string;
  project: string;
  testItem: string;
  flow: string;
  flowUnit: string;
  product: string;
  version: string;
  date: string;
} {
  const stem = name.replace(/\.(xlsx|pdf)$/i, '');
  const parts = stem.split('+').map((s) => s.trim()).filter(Boolean);
  // 倒推：最后一段若为 6-8 位数字则是日期
  let date = '';
  if (parts.length > 0 && /^\d{6,8}$/.test(parts[parts.length - 1])) {
    date = parts.pop()!;
  }
  // 含流量的新版 PDF：客户 / 项目 / 试验项目 / 流量 / 产品 / 版本
  if (parts.length >= 6) {
    const [customer, project, testItem, flowOnly, product, version] = parts;
    const flowInfo = parseFlowSegment(flowOnly);
    return {
      customer,
      project,
      testItem,
      flow: flowInfo.flow,
      flowUnit: flowInfo.flowUnit,
      product,
      version,
      date,
    };
  }
  // 新版 PDF：客户 / 项目 / 试验项目 / 产品 / 版本
  if (parts.length >= 5) {
    const [customer, project, testItem, product, version] = parts;
    return { customer, project, testItem, flow: '', flowUnit: '', product, version, date };
  }
  const version = parts.pop() || '';
  const product = parts.pop() || '';
  const project = parts.pop() || '';
  const customer = parts.pop() || '';
  return { customer, project, testItem: '', flow: '', flowUnit: '', product, version, date };
}

/** 可信资产文件名：项目-产品-版本.xlsx */
export function trustedFileName(project: string, product: string, version: string): string {
  return `${cleanFileName(project)}-${cleanFileName(product)}-${cleanFileName(version || 'V0')}.xlsx`;
}

/**
 * CAE 报告归档文件名：客户+项目+仿真项目+产品+版本+日期.pdf
 * 与试验报告命名规则一致，便于检索页统一解析展示。
 */
export function archiveCaeFileName(
  customer: string,
  project: string,
  caeItem: string,
  product: string,
  version: string,
  date: string,
): string {
  const d = (date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const parts = [customer, project, caeItem, product, version || 'V0', d].map((s) => cleanFileName(s));
  return `${parts.join('+')}.pdf`;
}

/** 从 CAE 归档文件名反解元信息：客户+项目+仿真项目+产品+版本+日期 */
export function parseCaeArchiveName(name: string): {
  customer: string;
  project: string;
  caeItem: string;
  product: string;
  version: string;
  date: string;
} {
  const stem = name.replace(/\.(xlsx|pdf)$/i, '');
  const parts = stem.split('+').map((s) => s.trim()).filter(Boolean);
  let date = '';
  if (parts.length > 0 && /^\d{6,8}$/.test(parts[parts.length - 1])) {
    date = parts.pop()!;
  }
  const [customer = '', project = '', caeItem = '', product = '', version = ''] = parts;
  return { customer, project, caeItem, product, version, date };
}

/**
 * 从计算书附表中抽出每条"计算题目 → 输入/结果"记录。
 * 这是可信资产 Excel 中的左半部分。
 */
export interface CalcAssetRow {
  title: string;
  params: string; // 输入参数，"name=value；name=value" 格式
  result: string; // 主结果，"name=value" 格式
  /** 关键字集合，用于与试验结果匹配 */
  keywords: string[];
}

/** 试验库归档下来的每行：测试项目 + 条件 + 结果 */
export interface TestAssetRow {
  name: string;
  conditionText: string;
  resultText: string;
  keywords: string[];
}

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

/** 把一个名字拆成关键字集合（含中文名、英文名、单位缩写） */
function extractKeywords(name: string, extra: string[] = []): string[] {
  const base = name
    .toLowerCase()
    .split(/[\s\-（）()·./:：,，、;；=＝]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 1);
  return Array.from(new Set([...base, ...extra.map((s) => s.toLowerCase())])).filter(Boolean);
}

/**
 * 生成可信资产 Excel（base64）：
 *  每行一条「计算题目 → 输入参数 → 理论计算结果 → 试验结果」。
 *  匹配规则：
 *    1. 同一项目-产品-版本下，计算书的每条计算题目 与 试验报告的每条测试项 做关键字重叠比；
 *    2. 重叠比 ≥ 50% 认为匹配；若多个试验项都命中，选重叠比最高的一条；
 *    3. 未匹配到试验结果的行，试验结果列留空，仍作为理论数据资产保留。
 */
export async function buildTrustedXlsxBase64(
  project: string,
  product: string,
  version: string,
  calcRows: CalcAssetRow[],
  testRows: TestAssetRow[],
): Promise<string> {
  const thin = { style: 'thin' as const, color: { argb: 'FF808080' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const center: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const fillHeader: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F4' } };

  const wb = new ExcelJS.Workbook();
  wb.creator = '理论计算平台';
  wb.created = new Date();

  const ws = wb.addWorksheet('可信数据资产', {
    views: [{ state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 6 }, { width: 24 }, { width: 36 }, { width: 28 }, { width: 28 }];

  const infoText = [project, product, version].filter(Boolean).join('　') || '—';
  ws.addRow(['项目-产品-版本：', infoText, '', '', '']).height = 22;
  ws.mergeCells('B1:E1');

  ws.addRow(['备注：按关键字匹配理论计算结果与试验测试结果。重叠比 ≥ 50% 视为匹配成功。', '', '', '', '']).height = 20;
  ws.mergeCells('A2:E2');
  ws.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

  const header = ws.addRow(['序号', '计算题目', '输入参数', '理论计算结果', '试验结果']);
  header.height = 24;
  header.font = { name: '宋体', size: 10, bold: true };
  for (let c = 1; c <= 5; c++) {
    const cell = header.getCell(c);
    cell.border = border;
    cell.alignment = center;
    cell.fill = fillHeader;
  }

  const total = calcRows.length;
  let matchedCount = 0;

  calcRows.forEach((cRow, i) => {
    // 找最佳试验匹配
    let bestIdx = -1;
    let bestScore = 0;
    for (let j = 0; j < testRows.length; j++) {
      const score = keywordOverlap(cRow.keywords, testRows[j].keywords);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }
    const matched = bestScore >= 0.5 ? testRows[bestIdx] : null;
    if (matched) matchedCount++;

    const row = ws.addRow([
      i + 1,
      cRow.title,
      cRow.params || '',
      cRow.result || '',
      matched ? `实测值=${splitPairs(matched.resultText).find((p) => p.name.startsWith('实测'))?.value || matched.resultText}` : '（未匹配）',
    ]);
    row.height = 24;
    for (let c = 1; c <= 5; c++) {
      const cell = row.getCell(c);
      cell.border = border;
      cell.alignment = center;
      cell.font = { name: '宋体', size: 10 };
    }
    if (!matched) {
      row.getCell(5).font = { name: '宋体', size: 10, color: { argb: 'FFB94A48' } };
    }
  });

  // 统计行
  const stat = ws.addRow([`共 ${total} 条计算数据，成功匹配试验结果 ${matchedCount} 条，未匹配 ${total - matchedCount} 条。`, '', '', '', '']);
  stat.height = 20;
  ws.mergeCells(`A${stat.number}:E${stat.number}`);
  ws.getCell(`A${stat.number}`).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  ws.getCell(`A${stat.number}`).font = { name: '宋体', size: 9, color: { argb: 'FF556375' } };

  const buf = await wb.xlsx.writeBuffer();
  let bin = '';
  const CHUNK = 0x8000;
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf as unknown as ArrayBuffer);
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** 两个关键字集合的"重叠比"（= 交集大小 / 较小集合大小），返回 0~1 */
export function keywordOverlap(a: string[], b: string[]): number {
  const A = new Set(a.map((s) => s.toLowerCase()));
  const B = new Set(b.map((s) => s.toLowerCase()));
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  A.forEach((x) => {
    if (B.has(x)) hit++;
  });
  return hit / Math.min(A.size, B.size);
}

export { splitPairs, extractKeywords };
