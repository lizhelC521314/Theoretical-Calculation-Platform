/**
 * FMEA 案例库数据模型
 *
 * 存放目录：\\10.1.1.245\Knowledge & Experience Base\FMEA Library
 * 一条 FMEA 记录 = 一张知识卡片 = 一个 .parquet 文件，文件名即编号：FM-2026-001.parquet
 *
 * 字段沿用技术中心《FMEA 案例收集》表格：
 *   机种名称 / 部件名称 / 本体使用材料 / 潜在的失效模式 / 失效模式图片
 *   潜在的失效后果 / 潜在的失效起因·机理 / 建议的措施 / 措施对策图片 / 备注
 *   责任人 / 记录时间
 * 另加平台字段：编号、来源工作表、录入人、版本、复用次数，便于检索与追溯。
 */

import { cleanFileName } from './db';

export const FMEA_SCHEMA = 'ctr-fmea-v1';

/** 卡片内容（可编辑部分） */
export interface FmeaDraft {
  machine: string; // 机种名称
  part: string; // 部件名称
  material: string; // 本体使用材料
  failureMode: string; // 潜在的失效模式
  failureModeImage: string; // 失效模式图片（原表内嵌图片在此仅留标记）
  failureEffect: string; // 潜在的失效后果
  failureCause: string; // 潜在的失效起因 / 机理
  action: string; // 建议的措施
  actionImage: string; // 措施对策图片 / 示例（同上）
  remark: string; // 备注
  owner: string; // 责任人
  recordDate: string; // 记录时间（YYYY-MM-DD，识别不了时保留原文）
}

export interface FmeaRecord extends FmeaDraft {
  schema: typeof FMEA_SCHEMA;
  id: string; // FM-2026-001
  sourceSheet: string; // 来源工作表（导入时记录）
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByDisplay: string;
  updatedBy: string;
  revision: number;
  useCount: number; // 被取用次数（检索页点「取用」累加）
}

export type FmeaDraftKey = keyof FmeaDraft;

/** 表单 / 详情面板展示顺序 */
export const FMEA_FIELDS: Array<{ key: FmeaDraftKey; label: string; hint?: string; multiline?: boolean }> = [
  { key: 'machine', label: '机种名称', hint: '如 长安 CS75、通用 9AT' },
  { key: 'part', label: '部件名称', hint: '如 空气滤清器壳体、油气分离器' },
  { key: 'material', label: '本体使用材料', hint: '如 PP-T20、PA66-GF30、SPCC' },
  { key: 'failureMode', label: '潜在的失效模式', hint: '一句话说清「坏成什么样」', multiline: true },
  { key: 'failureEffect', label: '潜在的失效后果', hint: '对整车 / 客户的影响', multiline: true },
  { key: 'failureCause', label: '潜在的失效起因 / 机理', hint: '设计、材料、工艺根因', multiline: true },
  { key: 'action', label: '建议的措施', hint: '可直接照做的对策', multiline: true },
  { key: 'remark', label: '备注', multiline: true },
  { key: 'owner', label: '责任人' },
  { key: 'recordDate', label: '记录时间', hint: 'YYYY-MM-DD' },
];

/** 图片列（原 Excel 用 WPS 内嵌图片，无法直接取二进制，只保留「含图片」标记） */
export const FMEA_IMAGE_FIELDS: Array<{ key: FmeaDraftKey; label: string }> = [
  { key: 'failureModeImage', label: '失效模式图片' },
  { key: 'actionImage', label: '措施对策图片' },
];

/** 表头别名：按顺序匹配，图片列必须排在文字列之前 */
const HEADER_ALIASES: Array<{ key: FmeaDraftKey; re: RegExp }> = [
  { key: 'actionImage', re: /措施.*图片|对策.*图片|整改.*图|示例图|示例/ },
  { key: 'failureModeImage', re: /失效模式.*图片|模式图|图片|照片/ },
  { key: 'machine', re: /机种|机型|车型|产品名称|项目名称|产品/ },
  { key: 'part', re: /部件|零件|零部件|组件|总成/ },
  { key: 'material', re: /材料|材质/ },
  { key: 'failureMode', re: /失效模式|故障模式|失效现象|失效表现/ },
  { key: 'failureEffect', re: /失效后果|后果|影响/ },
  { key: 'failureCause', re: /失效起因|起因|机理|原因|根因/ },
  { key: 'action', re: /建议的措施|建议措施|措施|对策|整改/ },
  { key: 'remark', re: /备注|说明/ },
  { key: 'owner', re: /责任人|负责人|责任/ },
  { key: 'recordDate', re: /记录时间|日期|时间/ },
];

/** 空卡片 */
export function emptyFmeaDraft(): FmeaDraft {
  return {
    machine: '',
    part: '',
    material: '',
    failureMode: '',
    failureModeImage: '',
    failureEffect: '',
    failureCause: '',
    action: '',
    actionImage: '',
    remark: '',
    owner: '',
    recordDate: '',
  };
}

/** WPS 内嵌图片公式 =DISPIMG("ID_xxx",1) → 统一标记，其余单元格保留原文 */
export function normalizeImageCell(value: string): string {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/DISPIMG|_xlfn\.DISPIMG/i.test(s)) return '含图片';
  return s;
}

/** 清洗单元格：去首尾空白，压缩连续空格（保留换行，便于阅读长文本） */
function cleanCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim();
}

/** Excel 序列号日期 → YYYY-MM-DD（1900 日期系统） */
function excelSerialToDate(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0 || n > 60000) return null;
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 规范化记录时间：支持 2026-3-5 / 2026.3.5 / 2026/3/5 / 2026年3月 / Excel 序列号 */
export function normalizeRecordDate(value: string | number): string {
  if (typeof value === 'number') return excelSerialToDate(value) || '';
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^\d{5}$/.test(s)) {
    const d = excelSerialToDate(Number(s));
    if (d) return d;
  }
  const m = s.match(/(\d{4})\s*[年./\-]\s*(\d{1,2})(?:\s*[月./\-]\s*(\d{1,2}))?/);
  if (m) {
    const y = m[1];
    const mo = String(Number(m[2])).padStart(2, '0');
    const day = m[3] ? String(Number(m[3])).padStart(2, '0') : '';
    return day ? `${y}-${mo}-${day}` : `${y}-${mo}`;
  }
  return s;
}

/** 从记录时间取年份（取不到用当前年） */
export function yearFromDate(text: string, now = new Date()): number {
  const m = String(text || '').match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : now.getFullYear();
}

/** 判定表头行：至少命中 3 个已知列名，且包含「失效模式」相关列 */
function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 12);
  for (let r = 0; r < limit; r++) {
    const cells = rows[r] || [];
    let hit = 0;
    let hasMode = false;
    for (const cell of cells) {
      if (!cell) continue;
      const matched = HEADER_ALIASES.find((a) => a.re.test(cell));
      if (matched) {
        hit++;
        if (matched.key === 'failureMode') hasMode = true;
      }
    }
    if (hit >= 3 && hasMode) return r;
  }
  return -1;
}

export interface FmeaParsedRow {
  draft: FmeaDraft;
  sourceSheet: string;
  rowNumber: number;
}

export interface FmeaParseResult {
  rows: FmeaParsedRow[];
  warnings: string[];
  skipped: number;
}

/** 小节标题 / 填写示例行：只占一个单元格，或以「示例」开头 */
function isNonDataRow(cells: string[]): boolean {
  const filled = cells.filter(Boolean);
  if (!filled.length) return true;
  if (filled.length === 1) return true;
  const joined = filled.join(' ');
  if (/填写示例|请删除本行|^示例[：:]|^注[：:]/.test(joined)) return true;
  if (/^(年|季度|月份)/.test(filled[0]) && filled.length <= 2) return true;
  return false;
}

/**
 * 解析二维数组（CSV / Excel 共用）。
 * 自动定位表头行，跳过小节标题、填写示例与空行。
 */
export function parseFmeaRows(rows: string[][], sourceSheet = ''): FmeaParseResult {
  const clean = (rows || []).map((r) => (r || []).map(cleanCell));
  const headerIdx = findHeaderRow(clean);
  if (headerIdx < 0) {
    return { rows: [], warnings: ['未找到表头行（需包含「机种名称、部件名称、失效模式」等列）'], skipped: 0 };
  }
  const header = clean[headerIdx];
  const map: Partial<Record<FmeaDraftKey, number>> = {};
  header.forEach((h, i) => {
    if (!h) return;
    for (const a of HEADER_ALIASES) {
      if (map[a.key] == null && a.re.test(h)) {
        map[a.key] = i;
        break;
      }
    }
  });
  if (map.failureMode == null) {
    return { rows: [], warnings: ['表头缺少「潜在的失效模式」列'], skipped: 0 };
  }

  const out: FmeaParsedRow[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  for (let r = headerIdx + 1; r < clean.length; r++) {
    const cells = clean[r];
    if (isNonDataRow(cells)) {
      skipped++;
      continue;
    }
    const get = (k: FmeaDraftKey): string => {
      const idx = map[k];
      return idx == null ? '' : cells[idx] || '';
    };
    const draft: FmeaDraft = {
      machine: get('machine'),
      part: get('part'),
      material: get('material'),
      failureMode: get('failureMode'),
      failureModeImage: normalizeImageCell(get('failureModeImage')),
      failureEffect: get('failureEffect'),
      failureCause: get('failureCause'),
      action: get('action'),
      actionImage: normalizeImageCell(get('actionImage')),
      remark: get('remark'),
      owner: get('owner'),
      recordDate: normalizeRecordDate(get('recordDate')),
    };
    if (!draft.failureMode) {
      skipped++;
      continue;
    }
    out.push({ draft, sourceSheet, rowNumber: r + 1 });
  }
  return { rows: out, warnings, skipped };
}

/** 拆分一行 CSV：支持双引号包裹与 "" 转义 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',' || ch === '\t') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/** 解析 CSV（表头映射，一行一张卡片） */
export function parseFmeaCsv(text: string): FmeaParseResult {
  const rows = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(splitCsvLine);
  return parseFmeaRows(rows, 'CSV');
}

/** 解析 Excel：合并所有工作表（跳过 WPS 图片索引表） */
export async function parseFmeaXlsx(file: File | ArrayBuffer): Promise<FmeaParseResult> {
  const data = file instanceof File ? await file.arrayBuffer() : file;
  const XLSX = await import('xlsx');
  const wb = XLSX.read(data, { type: 'array' });
  const merged: FmeaParsedRow[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  for (const name of wb.SheetNames) {
    if (/CellImg|Reserved|图片索引/i.test(name)) continue;
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
    const rows = raw.map((r) => (r || []).map((c) => cleanCell(c)));
    const res = parseFmeaRows(rows, name);
    if (res.warnings.length) warnings.push(`${name}：${res.warnings[0]}`);
    merged.push(...res.rows);
    skipped += res.skipped;
  }
  return { rows: merged, warnings, skipped };
}

export interface FmeaIssue {
  field: string;
  level: 'error' | 'warning';
  message: string;
}

export interface FmeaValidation {
  issues: FmeaIssue[];
  errors: FmeaIssue[];
  warnings: FmeaIssue[];
}

/** 校验：失效模式与建议措施必填，其余缺项只提示 */
export function validateFmeaDraft(draft: FmeaDraft): FmeaValidation {
  const issues: FmeaIssue[] = [];
  const req = (key: FmeaDraftKey, label: string) => {
    if (!String(draft[key] || '').trim()) issues.push({ field: key, level: 'error', message: `${label}不能为空` });
  };
  req('failureMode', '潜在的失效模式');
  req('action', '建议的措施');

  const warn = (key: FmeaDraftKey, label: string) => {
    if (!String(draft[key] || '').trim()) issues.push({ field: key, level: 'warning', message: `${label}为空，检索时不易被找到` });
  };
  warn('machine', '机种名称');
  warn('part', '部件名称');
  warn('failureEffect', '失效后果');
  warn('failureCause', '失效起因/机理');
  if (draft.recordDate && !/^\d{4}(-\d{2})?(-\d{2})?$/.test(draft.recordDate)) {
    issues.push({ field: 'recordDate', level: 'warning', message: '记录时间格式建议为 YYYY-MM-DD' });
  }
  return {
    issues,
    errors: issues.filter((i) => i.level === 'error'),
    warnings: issues.filter((i) => i.level === 'warning'),
  };
}

/** 编号：FM-年份-三位序号 */
export function formatFmeaId(year: number, seq: number): string {
  return `FM-${year}-${String(seq).padStart(3, '0')}`;
}

/** 从已有文件名中取该年份已用的最大序号 */
export function nextFmeaId(fileNames: string[], year: number): string {
  let max = 0;
  for (const name of fileNames) {
    const m = String(name || '').match(/FM-(\d{4})-(\d{3,})/i);
    if (!m) continue;
    if (Number(m[1]) !== year) continue;
    max = Math.max(max, Number(m[2]));
  }
  return formatFmeaId(year, max + 1);
}

/** 归档文件名即编号 */
export function fmeaFileName(id: string): string {
  return `${cleanFileName(id)}.parquet`;
}

/** 从归档文件名取编号 */
export function parseFmeaFileName(name: string): string {
  const stem = String(name || '').replace(/\.(parquet|json|csv)$/i, '');
  const m = stem.match(/FM-\d{4}-\d{3,}/i);
  return m ? m[0].toUpperCase() : stem;
}

/** 反序列化记录 */
export function parseFmeaRecord(text: string): FmeaRecord | null {
  try {
    const raw = JSON.parse(text) as Partial<FmeaRecord>;
    if (!raw || raw.schema !== FMEA_SCHEMA) return null;
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!id) return null;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    return {
      schema: FMEA_SCHEMA,
      id,
      machine: str(raw.machine),
      part: str(raw.part),
      material: str(raw.material),
      failureMode: str(raw.failureMode),
      failureModeImage: str(raw.failureModeImage),
      failureEffect: str(raw.failureEffect),
      failureCause: str(raw.failureCause),
      action: str(raw.action),
      actionImage: str(raw.actionImage),
      remark: str(raw.remark),
      owner: str(raw.owner),
      recordDate: str(raw.recordDate),
      sourceSheet: str(raw.sourceSheet),
      createdAt: str(raw.createdAt),
      updatedAt: str(raw.updatedAt),
      createdBy: str(raw.createdBy),
      createdByDisplay: str(raw.createdByDisplay),
      updatedBy: str(raw.updatedBy),
      revision: Number(raw.revision) > 0 ? Number(raw.revision) : 1,
      useCount: Number(raw.useCount) > 0 ? Number(raw.useCount) : 0,
    };
  } catch {
    return null;
  }
}

/** 序列化（浏览器调试 / 测试用；正式入库写 Parquet） */
export function serializeFmeaRecord(rec: FmeaRecord): string {
  return JSON.stringify(rec, null, 2);
}

/** 记录 → 草稿（编辑回填） */
export function draftFromRecord(rec: FmeaRecord): FmeaDraft {
  return {
    machine: rec.machine,
    part: rec.part,
    material: rec.material,
    failureMode: rec.failureMode,
    failureModeImage: rec.failureModeImage,
    failureEffect: rec.failureEffect,
    failureCause: rec.failureCause,
    action: rec.action,
    actionImage: rec.actionImage,
    remark: rec.remark,
    owner: rec.owner,
    recordDate: rec.recordDate,
  };
}

/** 草稿 → 记录（新建或升版） */
export function buildFmeaRecord(
  draft: FmeaDraft,
  meta: {
    id: string;
    sourceSheet?: string;
    username: string;
    displayName?: string;
    previous?: FmeaRecord | null;
  },
): FmeaRecord {
  const now = new Date().toISOString();
  return {
    schema: FMEA_SCHEMA,
    id: meta.id,
    ...draft,
    sourceSheet: meta.sourceSheet ?? meta.previous?.sourceSheet ?? '',
    createdAt: meta.previous?.createdAt || now,
    updatedAt: now,
    createdBy: meta.previous?.createdBy || meta.username,
    createdByDisplay: meta.previous?.createdByDisplay || meta.displayName || meta.username,
    updatedBy: meta.username,
    revision: meta.previous ? meta.previous.revision + 1 : 1,
    useCount: meta.previous?.useCount ?? 0,
  };
}

const CSV_HEADER = [
  '编号',
  '机种名称',
  '部件名称',
  '本体使用材料',
  '潜在的失效模式',
  '潜在的失效后果',
  '潜在的失效起因/机理',
  '建议的措施',
  '备注',
  '责任人',
  '记录时间',
  '复用次数',
];

function csvCell(v: string | number): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

/** 单张卡片导出为 CSV（Excel 可直接打开） */
export function fmeaRecordToCsv(rec: FmeaRecord): string {
  return [
    '\uFEFF' + CSV_HEADER.join(','),
    [
      rec.id,
      rec.machine,
      rec.part,
      rec.material,
      rec.failureMode,
      rec.failureEffect,
      rec.failureCause,
      rec.action,
      rec.remark,
      rec.owner,
      rec.recordDate,
      rec.useCount,
    ]
      .map(csvCell)
      .join(','),
  ].join('\r\n');
}

export function fmeaCsvFileName(rec: FmeaRecord): string {
  return `${rec.id}.csv`;
}

/** 复制到剪贴板的卡片文本 */
export function fmeaCardText(rec: FmeaRecord): string {
  const line = (label: string, value: string) => (value ? `${label}：${value}\n` : '');
  return (
    `【FMEA 知识卡片】${rec.id}\n` +
    line('机种名称', rec.machine) +
    line('部件名称', rec.part) +
    line('本体材料', rec.material) +
    line('失效模式', rec.failureMode) +
    line('失效后果', rec.failureEffect) +
    line('失效起因/机理', rec.failureCause) +
    line('建议措施', rec.action) +
    line('备注', rec.remark) +
    line('责任人', rec.owner) +
    line('记录时间', rec.recordDate)
  ).trim();
}

/** 检索用全文（小写、去多余空白） */
export function fmeaSearchText(rec: FmeaRecord): string {
  return [
    rec.id,
    rec.machine,
    rec.part,
    rec.material,
    rec.failureMode,
    rec.failureEffect,
    rec.failureCause,
    rec.action,
    rec.remark,
    rec.owner,
    rec.recordDate,
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** CSV 模板：表头 + 一行明确标注「请删除本行」的示例，避免误入库 */
export function fmeaTemplateCsv(): string {
  const header = [
    '机种名称',
    '部件名称',
    '本体使用材料',
    '潜在的失效模式',
    '潜在的失效后果',
    '潜在的失效起因/机理',
    '建议的措施',
    '备注',
    '责任人',
    '记录时间',
  ];
  const example = [
    '示例-车型A（请删除本行）',
    '空气滤清器壳体',
    'PP-T20',
    '壳体卡扣根部断裂',
    '装配后松脱、密封失效',
    '卡扣根部壁厚不足且位于熔接痕处',
    '根部壁厚 1.5→2.0 mm，浇口移至非受力侧',
    '示例行，导入前请删除',
    '张三',
    '2026-01-15',
  ];
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header.map(quote).join(','), example.map(quote).join(',')].join('\r\n');
}
