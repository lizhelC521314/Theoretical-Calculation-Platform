/**
 * 设计计算书生成（Word / PDF 共用数据模型）
 *
 * 内容格式参考汽车零部件大厂设计计算书：
 *   封面（公司 / 文档名称 / 项目与产品 / 编制·校对·审核·批准 / 日期）
 *   → 目录 → 每项计算一章（计算目的 → 理论公式 → 输入参数 → 计算结果 → 结论）
 *   → 附表（全部计算汇总：计算题目 / 输入参数 / 主结果）
 *
 * 公式渲染策略：所有 LaTeX 公式统一在渲染进程中先经 KaTeX → html2canvas 转成 PNG，
 * 然后 Word 用 ImageRun 嵌入、PDF 用 <img> 嵌入，彻底规避 Word/PDF 对 LaTeX/OMML/MathML 的支持问题。
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import katex from 'katex';
import html2canvas from 'html2canvas';
import type { CtrUser, HistoryEntry, Project } from '../api';
import { BRAND } from '../branding';
import { getFormula } from '../formula/registry';
import { autoUnit, formatNumber } from '../formula/units';

interface ParamRow {
  label: string;
  symbol: string;
  value: string;
  unit: string;
}

interface FormulaItem {
  label: string;
  tex: string;
  /** KaTeX 渲染后的完整 HTML 字符串（同步生成） */
  katexHtml: string;
  /** 截图后的 PNG base64（无 data: 前缀），图片宽高；由 preRenderFormulaImages 异步填充 */
  pngBase64?: string;
  pngW?: number;
  pngH?: number;
}

interface Chapter {
  no: number;
  title: string;
  domain: string;
  time: string;
  purpose: string;
  formulas: FormulaItem[];
  inputs: ParamRow[];
  outputs: (ParamRow & { primary: boolean })[];
  conclusion: string;
}

export interface ReportModel {
  /** 文档名（不含扩展名），同时用作封面标题 */
  docName: string;
  projectName: string | null;
  /** 产品版本号（如 V1.0），无版本号时为空串 */
  productVersion: string;
  product: string;
  company: string;
  compiler: string;
  dateCN: string;
  /** 附表信息行日期（YYYY/M/D） */
  dateShort: string;
  chapters: Chapter[];
}

interface RecordInputs {
  values?: Record<string, number>;
  units?: Record<string, string>;
}

function dateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 用 KaTeX 同步渲染单条 LaTeX 为完整 HTML（throwOnError=false 保证容错） */
function renderLatex(tex: string): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: true });
  } catch {
    return `<span style="font-family:monospace;color:#c0392b;">${tex}</span>`;
  }
}

/** 导出文件名（不含扩展名）：项目 → 项目名称+产品设计计算书；无项目 → 日期+临时计算书 */
export function reportFileName(project: Project | null): string {
  return project ? `${project.name}产品设计计算书` : `${dateStr(new Date())}临时计算书`;
}

/** 由计算记录 + 公式元数据构建报告模型（按时间正序排章节） */
export function buildReportModel(
  records: HistoryEntry[],
  project: Project | null,
  user: CtrUser,
): ReportModel {
  const sorted = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const chapters: Chapter[] = sorted.map((r, i) => {
    const f = getFormula(r.formulaId);
    const rec = (r.inputs ?? {}) as RecordInputs;
    const values = rec.values ?? {};
    const units = rec.units ?? {};

    const inputs: ParamRow[] = (f?.inputs ?? []).map((p) => {
      // 单位按输入 key 记录；兼容早期按 unitGroup 记录的历史数据
      const unitLabel = units[p.key] ?? (p.unitGroup ? units[p.unitGroup] : undefined) ?? p.unit;
      const v = values[p.key];
      return {
        label: p.label,
        symbol: p.symbol,
        value: typeof v === 'number' ? formatNumber(v, 6) : '—',
        unit: unitLabel,
      };
    });

    const outputs = (f?.outputs ?? []).map((o) => {
      const raw = (r.outputs as Record<string, number>)[o.key];
      const disp = o.unitGroup ? autoUnit(raw, o.unitGroup) : { value: raw, unit: o.unit };
      return {
        label: o.label,
        symbol: o.symbol,
        value: typeof disp.value === 'number' ? formatNumber(disp.value, o.digits ?? 3) : '—',
        unit: disp.unit,
        primary: !!o.primary,
      };
    });

    const conclusion = outputs
      .filter((o) => o.primary)
      .map((o) => `${o.label} ${o.symbol} = ${o.value} ${o.unit}`)
      .join('；');

    return {
      no: i + 1,
      title: r.formulaTitle,
      domain: r.domain,
      time: new Date(r.createdAt).toLocaleString('zh-CN'),
      purpose: f?.summary ?? '',
      formulas: (f?.latex ?? []).map((fx) => ({
        label: fx.label,
        tex: fx.tex,
        katexHtml: renderLatex(fx.tex),
      })),
      inputs,
      outputs,
      conclusion,
    };
  });

  const now = new Date();
  return {
    docName: reportFileName(project),
    projectName: project?.name ?? null,
    productVersion: project?.version ?? '',
    product: project?.product ?? '',
    company: BRAND.companyName,
    compiler: user.displayName || user.username,
    dateCN: `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`,
    dateShort: `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`,
    chapters,
  };
}

/** 汇总表列宽（%）：序号 / 计算题目 / 参数名称 / 参数值 / 结果名称 / 结果值 */
const SUM_WIDTHS = [7, 30, 19, 12, 19, 13];

/** 参数/结果名称带单位：「名称（单位）」 */
function withUnit(r: ParamRow): string {
  return r.unit ? `${r.label}（${r.unit}）` : r.label;
}

interface SummaryItem {
  no: number;
  title: string;
  params: { name: string; value: string }[];
  results: { name: string; value: string }[];
  /** 该计算块占用的行数（参数与主结果数量的较大值） */
  rows: number;
}

/**
 * 附表：全部计算汇总
 * 每项计算占一个纵向合并的块，左侧列出设计参数、右侧列出主结果（中间计算量不输出）
 */
export function summaryItems(m: ReportModel): SummaryItem[] {
  return m.chapters.map((c) => {
    const params = c.inputs.map((r) => ({ name: withUnit(r), value: r.value }));
    const results = c.outputs.filter((o) => o.primary).map((r) => ({ name: withUnit(r), value: r.value }));
    return { no: c.no, title: c.title, params, results, rows: Math.max(params.length, results.length, 1) };
  });
}

/* ==================== Excel（全部计算汇总，用于导出到设计数据库） ==================== */

/** ArrayBuffer / Uint8Array → base64（渲染进程保存 Excel 用） */
function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * 生成「全部计算汇总」Excel 工作簿并返回 base64。
 * 内容与计算书最后一页附表一致：信息行（项目/版本/日期）+ 双行表头 + 每项计算的合并块，
 * 序号与计算题目纵向合并，设计参数与计算结果各占两列，中间计算量不输出。
 */
export async function buildSummaryXlsxBase64(
  m: ReportModel,
  fmeaRecords?: unknown[],
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = m.compiler;
  wb.created = new Date();

  const ws = wb.addWorksheet('全部计算汇总', {
    views: [{ state: 'frozen', ySplit: 3 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  ws.columns = [{ width: 8 }, { width: 32 }, { width: 24 }, { width: 14 }, { width: 24 }, { width: 16 }];

  const thin = { style: 'thin' as const, color: { argb: 'FF808080' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const center: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const fillHeader: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F4' } };

  // 信息行：项目 / 版本 / 日期
  const projectText = m.projectName
    ? m.product
      ? `${m.projectName}　${m.product}`
      : m.projectName
    : '临时计算';
  ws.addRow(['项目：', projectText, '', '', '', '']).height = 22;
  ws.mergeCells('B1:F1');
  ws.addRow(['版本：', m.productVersion || '—', '', '', '日期：', m.dateShort]).height = 22;
  ws.mergeCells('B2:C2');
  ws.mergeCells('E2:F2');

  // 表头：设计参数、计算结果各跨两列
  ws.addRow(['序号', '计算题目', '设计参数', '', '计算结果', '']).height = 24;
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

  // 每项计算一个纵向合并块
  let rowNo = 4;
  for (const it of summaryItems(m)) {
    const start = rowNo;
    for (let i = 0; i < it.rows; i++) {
      const row = ws.getRow(start + i);
      row.height = 22;
      row.getCell(3).value = it.params[i]?.name ?? '';
      row.getCell(4).value = it.params[i]?.value ?? '';
      row.getCell(5).value = it.results[i]?.name ?? '';
      row.getCell(6).value = it.results[i]?.value ?? '';
      for (let c = 1; c <= 6; c++) {
        const cell = row.getCell(c);
        cell.border = border;
        cell.alignment = center;
        cell.font = { name: '宋体', size: 10 };
      }
    }
    ws.getCell(start, 1).value = it.no;
    ws.getCell(start, 2).value = it.title;
    if (it.rows > 1) {
      ws.mergeCells(start, 1, start + it.rows - 1, 1);
      ws.mergeCells(start, 2, start + it.rows - 1, 2);
    }
    rowNo += it.rows;
  }

  const note = ws.getRow(rowNo);
  note.getCell(1).value = '注：表中仅列出设计参数与主结果，中间计算量未列入；计算过程详见各章。';
  note.getCell(1).font = { name: '宋体', size: 9, color: { argb: 'FF556375' } };
  note.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

  // FMEA 点检表（项目引用过的 FMEA）
  if (Array.isArray(fmeaRecords) && fmeaRecords.length > 0) {
    const thin = { style: 'thin' as const, color: { argb: 'FF808080' } };
    const fBorder = { top: thin, left: thin, bottom: thin, right: thin };
    const fFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F4' } };
    const headers = [
      '编号', '系统', '产品大类', '产品小类', '部件名称', '材料',
      '失效编码', '失效模式', '失效起因', '原因编码',
      '失效后果', '风险等级', 'S', 'O', 'D',
      '建议措施', '措施类型', '验证状态',
      '一句话结论', '设计规避', '录入人', '记录时间',
    ];
    const fws = wb.addWorksheet('FMEA点检表', {
      views: [{ state: 'frozen', ySplit: 1 }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    fws.columns = [
      { width: 16 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 22 }, { width: 14 },
      { width: 10 }, { width: 32 }, { width: 28 }, { width: 10 },
      { width: 28 }, { width: 10 }, { width: 5 }, { width: 5 }, { width: 5 },
      { width: 32 }, { width: 10 }, { width: 10 },
      { width: 36 }, { width: 30 }, { width: 14 }, { width: 14 },
    ];

    const hRow = fws.addRow(headers);
    hRow.height = 26;
    for (let c = 1; c <= headers.length; c++) {
      const cell = hRow.getCell(c);
      cell.border = fBorder;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.font = { name: '宋体', size: 10, bold: true };
      cell.fill = fFill;
    }

    for (const rec of fmeaRecords) {
      const r = rec as Record<string, unknown>;
      const values = [
        r.id ?? '',
        r.system ?? '',
        r.productCategory ?? '',
        r.productSubCategory ?? '',
        r.part ?? '',
        r.material ?? '',
        r.failureCode ?? '',
        r.failureMode ?? '',
        r.failureCause ?? '',
        r.causeCode ?? '',
        r.failureEffect ?? '',
        r.riskLevel ?? '',
        r.severity ?? '',
        r.occurrence ?? '',
        r.detection ?? '',
        r.action ?? '',
        r.measureType ?? '',
        r.verificationStatus ?? '',
        r.conclusion ?? '',
        r.designGuide ?? '',
        r.createdByDisplay ?? r.createdBy ?? '',
        r.recordDate ?? '',
      ];
      const row = fws.addRow(values);
      row.height = 48;
      for (let c = 1; c <= headers.length; c++) {
        const cell = row.getCell(c);
        cell.border = fBorder;
        cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        cell.font = { name: '宋体', size: 10 };
      }
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return bufToBase64(buf as unknown as ArrayBuffer);
}

/* ==================== 公式图片预处理（渲染进程中执行） ==================== */

/**
 * 将模型中所有公式的 KaTeX HTML 渲染成 PNG base64，并存入 formula.pngBase64/pngW/pngH。
 * 必须在浏览器/DOM 环境下调用（依赖 html2canvas + 全局已加载的 katex.min.css）。
 */
export async function preRenderFormulaImages(model: ReportModel): Promise<void> {
  const allFormulas: FormulaItem[] = [];
  for (const c of model.chapters) for (const f of c.formulas) allFormulas.push(f);
  if (allFormulas.length === 0) return;

  // 创建离屏容器（绝对定位到可视区外，html2canvas 需 layout 完成）
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:720px;pointer-events:none;';
  document.body.appendChild(host);

  try {
    for (const fx of allFormulas) {
      if (!fx.katexHtml) continue;
      const box = document.createElement('div');
      box.style.cssText = 'padding:8px 16px;display:flex;align-items:center;justify-content:center;page-break-inside:avoid;';
      box.innerHTML = fx.katexHtml;
      host.appendChild(box);
      // 等下一帧确保布局
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      try {
        const canvas = await html2canvas(box, {
          useCORS: true,
          backgroundColor: null,
          scale: 2,
        });
        const w = canvas.width;
        const h = canvas.height;
        fx.pngBase64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
        fx.pngW = w;
        fx.pngH = h;
      } catch {
        // html2canvas 失败则降级：Word/PDF 显示源码
        fx.pngBase64 = undefined;
      }
      host.removeChild(box);
    }
  } finally {
    document.body.removeChild(host);
  }
}

/* ==================== Word（docx） ==================== */

const FONT_SONG = { ascii: 'Times New Roman', eastAsia: '宋体' } as const;
const FONT_HEI = { ascii: 'Arial', eastAsia: '黑体' } as const;

/** base64 字符串 → Uint8Array（浏览器与 Node 通用，docx ImageRun.data 接受） */
function b64ToUint8(b64: string): Uint8Array {
  // Node 环境
  if (typeof (globalThis as { Buffer?: typeof Buffer }).Buffer !== 'undefined') {
    return (globalThis as { Buffer: typeof Buffer }).Buffer.from(b64, 'base64') as unknown as Uint8Array;
  }
  // 浏览器环境
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function p(text: string, opts: { size?: number; bold?: boolean; center?: boolean; hei?: boolean; spacing?: number } = {}) {
  return new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : undefined,
    spacing: { after: opts.spacing ?? 120, line: 300 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        size: opts.size ?? 24, // 半磅：24 = 12pt 小四
        font: opts.hei ? FONT_HEI : FONT_SONG,
      }),
    ],
  });
}

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '808080' } as const;
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER };

function cell(text: string, opts: { bold?: boolean; header?: boolean; width?: number } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    borders: CELL_BORDERS,
    shading: opts.header ? { fill: 'DCE6F4' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment: opts.header ? AlignmentType.CENTER : undefined,
        children: [new TextRun({ text, bold: opts.bold ?? opts.header, size: 21, font: FONT_SONG })],
      }),
    ],
  });
}

function paramTable(headers: string[], rows: string[][], widths: number[]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { header: true, width: widths[i] })) }),
      ...rows.map(
        (r) => new TableRow({ children: r.map((c, i) => cell(c, { width: widths[i] })) }),
      ),
    ],
  });
}

/**
 * 附表汇总表格（Word）：单张表承载「项目/版本/日期」信息行 + 双行表头 + 每项计算的合并块
 * 序号与计算题目纵向合并，设计参数与计算结果各占「名称 + 数值」两列
 */
/** FMEA 点检表列（与 Excel buildSummaryXlsxBase64 / PDF 保持一致，单一来源） */
const FMEA_HEADERS = [
  '编号', '系统', '产品大类', '产品小类', '部件名称', '材料',
  '失效编码', '失效模式', '失效起因', '原因编码',
  '失效后果', '风险等级', 'S', 'O', 'D',
  '建议措施', '措施类型', '验证状态',
  '一句话结论', '设计规避', '录入人', '记录时间',
] as const;

/** 把一条 FMEA 记录展平为 FMEA_HEADERS 对齐的行 */
function fmeaRowValues(rec: unknown): string[] {
  const r = rec as Record<string, unknown>;
  // designGuide 在 fmea.ts 里是 deriveDesignGuide(record) 动态生成，Excel 直接用字段 r.designGuide
  // 但 main.cjs 从 Parquet 读出的就是原始字段，没有 designGuide —— 这里做兼容：如果有就用，没有留空
  return [
    String(r.id ?? ''),
    String(r.system ?? ''),
    String(r.productCategory ?? ''),
    String(r.productSubCategory ?? ''),
    String(r.part ?? ''),
    String(r.material ?? ''),
    String(r.failureCode ?? ''),
    String(r.failureMode ?? ''),
    String(r.failureCause ?? ''),
    String(r.causeCode ?? ''),
    String(r.failureEffect ?? ''),
    String(r.riskLevel ?? ''),
    String(r.severity ?? ''),
    String(r.occurrence ?? ''),
    String(r.detection ?? ''),
    String(r.action ?? ''),
    String(r.measureType ?? ''),
    String(r.verificationStatus ?? ''),
    String(r.conclusion ?? ''),
    String(r.designGuide ?? ''),
    String((r.createdByDisplay ?? r.createdBy) ?? ''),
    String(r.recordDate ?? ''),
  ];
}

/** Word：FMEA 点检表 —— 22 列，横向排列，短列用较窄百分比、长列用较宽百分比 */
function fmeaDocxTable(records: unknown[]): Table {
  // 22 列宽度百分比总和 = 100；长文本列（失效模式/起因/后果/建议措施/设计规避）给 7~8%，短列 2~3%
  const widths = [
    4, 3, 3, 3, 5, 3,       // 编号/系统/大类/小类/部件/材料
    3, 7, 7, 3,              // 失效编码/模式/起因/原因编码
    6, 3, 1.5, 1.5, 1.5,     // 后果/风险/S/O/D
    6, 3, 3,                 // 建议措施/措施类型/验证
    7, 7, 3, 3,              // 一句话结论/设计规避/录入人/记录时间
  ];
  const total = widths.reduce((a, b) => a + b, 0);

  const mkCell = (text: string, percent: number, opts: { head?: boolean } = {}) =>
    new TableCell({
      borders: CELL_BORDERS,
      width: { size: percent, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 40, after: 40 },
          children: [
            new TextRun({
              text: (text ?? '').slice(0, 80),
              size: 18,
              font: FONT_SONG,
              bold: opts.head,
            }),
          ],
        }),
      ],
    });

  const rows: TableRow[] = [];
  // 表头行
  rows.push(
    new TableRow({
      tableHeader: true,
      children: FMEA_HEADERS.map((h, i) => mkCell(h, (widths[i] / total) * 100, { head: true })),
    }),
  );
  // 数据行
  for (const rec of records) {
    const values = fmeaRowValues(rec);
    rows.push(
      new TableRow({
        children: values.map((v, i) => mkCell(v, (widths[i] / total) * 100)),
      }),
    );
  }

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function summaryTable(m: ReportModel) {
  const widthOf = (col: number, span = 1) =>
    SUM_WIDTHS.slice(col, col + span).reduce((a, b) => a + b, 0);

  const mkCell = (
    text: string,
    opts: { col: number; span?: number; rowSpan?: number; head?: boolean } = { col: 0 },
  ) =>
    new TableCell({
      borders: CELL_BORDERS,
      width: { size: widthOf(opts.col, opts.span ?? 1), type: WidthType.PERCENTAGE },
      columnSpan: opts.span && opts.span > 1 ? opts.span : undefined,
      rowSpan: opts.rowSpan && opts.rowSpan > 1 ? opts.rowSpan : undefined,
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text, size: 21, font: FONT_SONG, bold: opts.head })],
        }),
      ],
    });

  const projectText = m.projectName
    ? m.product
      ? `${m.projectName}　${m.product}`
      : m.projectName
    : '临时计算';

  const rows: TableRow[] = [
    // 信息行：项目 / 版本 / 日期
    new TableRow({
      children: [
        mkCell('项目：', { col: 0 }),
        mkCell(projectText, { col: 1 }),
        mkCell('版本：', { col: 2 }),
        mkCell(m.productVersion || '—', { col: 3 }),
        mkCell('日期：', { col: 4 }),
        mkCell(m.dateShort, { col: 5 }),
      ],
    }),
    // 表头：设计参数、计算结果各跨两列
    new TableRow({
      tableHeader: true,
      children: [
        mkCell('序号', { col: 0, head: true }),
        mkCell('计算题目', { col: 1, head: true }),
        mkCell('设计参数', { col: 2, span: 2, head: true }),
        mkCell('计算结果', { col: 4, span: 2, head: true }),
      ],
    }),
  ];

  for (const it of summaryItems(m)) {
    for (let i = 0; i < it.rows; i++) {
      const children: TableCell[] = [];
      if (i === 0) {
        children.push(mkCell(String(it.no), { col: 0, rowSpan: it.rows }));
        children.push(mkCell(it.title, { col: 1, rowSpan: it.rows }));
      }
      children.push(mkCell(it.params[i]?.name ?? '', { col: 2 }));
      children.push(mkCell(it.params[i]?.value ?? '', { col: 3 }));
      children.push(mkCell(it.results[i]?.name ?? '', { col: 4 }));
      children.push(mkCell(it.results[i]?.value ?? '', { col: 5 }));
      rows.push(new TableRow({ children }));
    }
  }

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function h1(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 160 },
    children: [new TextRun({ text, size: 32, bold: true, font: FONT_HEI })],
  });
}

function h2(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 160, after: 100 },
    children: [new TextRun({ text, size: 26, bold: true, font: FONT_HEI })],
  });
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

/**
 * 封面签字栏：编制 / 校对 / 审核 / 批准 四行
 * 用两列无框表格实现——左列右对齐标签（冒号严格对齐），右列下边框充当签字下划线
 */
function signTable(compiler: string) {
  const rows: [string, string][] = [
    ['编制', compiler],
    ['校对', ''],
    ['审核', ''],
    ['批准', ''],
  ];
  return new Table({
    alignment: AlignmentType.CENTER,
    width: { size: 62, type: WidthType.PERCENTAGE },
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          children: [
            new TableCell({
              borders: NO_BORDERS,
              width: { size: 38, type: WidthType.PERCENTAGE },
              margins: { top: 90, bottom: 90, left: 0, right: 80 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [new TextRun({ text: `${label}：`, size: 26, font: FONT_SONG })],
                }),
              ],
            }),
            new TableCell({
              borders: { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' } },
              width: { size: 62, type: WidthType.PERCENTAGE },
              margins: { top: 90, bottom: 40, left: 80, right: 40 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: value || ' ', size: 26, font: FONT_SONG })],
                }),
              ],
            }),
          ],
        }),
    ),
  });
}

/** 附表汇总表格（PDF）：信息行 + 双行表头 + 每项计算的 rowspan 合并块 */
function pdfSummaryTable(m: ReportModel): string {
  const projectText = m.projectName
    ? m.product
      ? `${m.projectName}　${m.product}`
      : m.projectName
    : '临时计算';

  let body = `<tr><td class="sum-k">项目：</td><td>${esc(projectText)}</td><td class="sum-k">版本：</td><td>${esc(
    m.productVersion || '—',
  )}</td><td class="sum-k">日期：</td><td>${esc(m.dateShort)}</td></tr>`;
  body += '<tr><td class="sum-k">序号</td><td class="sum-k">计算题目</td><td class="sum-k" colspan="2">设计参数</td><td class="sum-k" colspan="2">计算结果</td></tr>';

  for (const it of summaryItems(m)) {
    for (let i = 0; i < it.rows; i++) {
      body += '<tr>';
      if (i === 0) {
        body += `<td rowspan="${it.rows}">${it.no}</td><td rowspan="${it.rows}">${esc(it.title)}</td>`;
      }
      body += `<td>${esc(it.params[i]?.name ?? '')}</td><td>${esc(it.params[i]?.value ?? '')}</td>`;
      body += `<td>${esc(it.results[i]?.name ?? '')}</td><td>${esc(it.results[i]?.value ?? '')}</td>`;
      body += '</tr>';
    }
  }

  const cols = SUM_WIDTHS.map((w) => `<col style="width:${w}%">`).join('');
  return `<table class="sum-table"><colgroup>${cols}</colgroup><tbody>${body}</tbody></table>`;
}

/**
 * 封面项目信息栏：项目名称 / 产品名称 / 产品版本 三行
 * 用单列 55% 居中的无框表格，单元格文本左对齐——三行共用同一左边缘，整体在页面居中
 */
function infoTable(lines: string[]) {
  return new Table({
    alignment: AlignmentType.CENTER,
    width: { size: 55, type: WidthType.PERCENTAGE },
    rows: lines.map(
      (text) =>
        new TableRow({
          children: [
            new TableCell({
              borders: NO_BORDERS,
              margins: { top: 60, bottom: 60, left: 0, right: 0 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.LEFT,
                  children: [new TextRun({ text, size: 28, font: FONT_SONG })],
                }),
              ],
            }),
          ],
        }),
    ),
  });
}

/** 生成 Word 文档并打包为 base64（主进程负责保存）。可选传入 fmeaRecords，末尾加 FMEA 点检表章节 */
export async function buildDocxBase64(m: ReportModel, fmeaRecords?: unknown[]): Promise<string> {
  const infoLines = [`项目名称：${m.projectName ?? '（临时计算）'}`];
  if (m.product) infoLines.push(`产品名称：${m.product}`);
  if (m.productVersion) infoLines.push(`产品版本：${m.productVersion}`);

  const cover: (Paragraph | Table)[] = [
    p('', { spacing: 0 }),
    p(m.company, { size: 36, bold: true, center: true, hei: true, spacing: 480 }),
    p(m.docName, { size: 52, bold: true, center: true, hei: true, spacing: 720 }),
    infoTable(infoLines),
  ];
  cover.push(
    p('', { spacing: 480 }),
    signTable(m.compiler),
    p('', { spacing: 480 }),
    p(m.dateCN, { size: 26, center: true, spacing: 160 }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  const toc: Paragraph[] = [h1('目  录')];
  for (const c of m.chapters) {
    toc.push(p(`第 ${c.no} 章  ${c.title}（${c.domain}）`, { size: 24, spacing: 100 }));
  }
  toc.push(p('附表  全部计算汇总', { size: 24, spacing: 100 }));
  toc.push(new Paragraph({ children: [new PageBreak()] }));

  const body: (Paragraph | Table)[] = [];
  for (const c of m.chapters) {
    body.push(h1(`第 ${c.no} 章  ${c.title}`));
    body.push(p(`计算类别：${c.domain}    计算时间：${c.time}`, { size: 21, spacing: 160 }));

    if (c.purpose) {
      body.push(h2(`${c.no}.1 计算目的`));
      body.push(p(c.purpose));
    }

    if (c.formulas.length > 0) {
      body.push(h2(`${c.no}.2 理论公式`));
      for (const fx of c.formulas) {
        body.push(p(`${fx.label}：`, { size: 22, bold: true, spacing: 60 }));
        const children: (ImageRun | TextRun)[] = [];
        if (fx.pngBase64) {
          // Word 可打印区宽约 825px，图片宽度限制在 760px 内按比例缩放
          const maxW = 760;
          const ratio = fx.pngW && fx.pngW > maxW ? maxW / fx.pngW : 1;
          children.push(
            new ImageRun({
              type: 'png',
              data: b64ToUint8(fx.pngBase64),
              transformation: {
                width: Math.round((fx.pngW ?? 400) * ratio),
                height: Math.round((fx.pngH ?? 60) * ratio),
              },
            }),
          );
        } else {
          // 降级：无法截图时，以等宽字体输出 LaTeX 源码，避免完全空白
          children.push(new TextRun({ text: fx.tex, size: 20, font: { ascii: 'Consolas', eastAsia: '宋体' } }));
        }
        body.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children,
          }),
        );
      }
    }

    body.push(h2(`${c.no}.3 输入参数`));
    body.push(
      paramTable(
        ['参数名称', '符号', '数值', '单位'],
        c.inputs.map((r) => [r.label, r.symbol, r.value, r.unit]),
        [45, 15, 25, 15],
      ),
    );

    body.push(h2(`${c.no}.4 计算结果`));
    body.push(
      paramTable(
        ['结果名称', '符号', '数值', '单位'],
        c.outputs.map((r) => [r.label, r.symbol, r.value, r.unit]),
        [45, 15, 25, 15],
      ),
    );

    if (c.conclusion) {
      body.push(h2(`${c.no}.5 结论`));
      body.push(p(`经计算，${c.conclusion}。`, { size: 24 }));
    }
  }

  // 附表：全部计算汇总（最后一页）——便于不同参数方案的结果对比与设计库归档
  body.push(new Paragraph({ children: [new PageBreak()] }));
  body.push(h1('附表  全部计算汇总'));
  body.push(summaryTable(m));
  body.push(p('注：表中仅列出设计参数与主结果，中间计算量未列入；计算过程详见各章。', { size: 19, spacing: 100 }));

  /** FMEA 点检表如果有记录，单独开一个 section 用 A4 横向（22 列宽表不跨页） */
  const hasFmea = Array.isArray(fmeaRecords) && fmeaRecords.length > 0;

  // 横版 section 用窄边距：上下 10mm ≈ 576 twips，左右 8mm ≈ 457 twips
  const LANDSCAPE_PAGE = {
    margin: { top: 576, bottom: 576, left: 457, right: 457, header: 0, footer: 0 },
    size: { width: 16838, height: 11906, orientation: 'landscape' as const },
  };
  const PORTRAIT_PAGE = {
    margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
    size: { width: 11906, height: 16838 }, // A4 portrait
  };

  const defaultFooter = {
    default: new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ children: [`${m.company}  `, PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 18, font: FONT_SONG }),
          ],
        }),
      ],
    }),
  };

  const sections = [
    {
      properties: { page: PORTRAIT_PAGE },
      footers: defaultFooter,
      children: [...cover, ...toc, ...body],
    },
  ];

  if (hasFmea) {
    sections.push({
      properties: { page: LANDSCAPE_PAGE },
      footers: defaultFooter,
      children: [
        h1('附表  FMEA点检表'),
        fmeaDocxTable(fmeaRecords!),
        p(
          `注：共 ${fmeaRecords!.length} 条 FMEA 案例被本项目引用，表中内容来自 KBE_FMEA 库中 citation 指向本项目的记录。`,
          { size: 19, spacing: 100 },
        ),
      ],
    });
  }

  const doc = new Document({
    title: m.docName,
    creator: m.compiler,
    sections: sections,
  });
  return Packer.toBase64String(doc);
}

/* ==================== PDF（自包含 HTML，主进程 printToPDF） ==================== */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pdfTable(headers: string[], rows: string[][], widths?: number[]): string {
  const col = (i: number) => (widths ? ` style="width:${widths[i]}%"` : '');
  const th = headers.map((h, i) => `<th${col(i)}>${esc(h)}</th>`).join('');
  const trs = rows.map((r) => `<tr>${r.map((c, i) => `<td${col(i)}>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/** PDF：FMEA 点检表 section 字符串，列对齐与 FMEA_HEADERS 一致 */
function fmeaPdfSection(records?: unknown[]): string {
  if (!Array.isArray(records) || records.length === 0) return '';
  const rows = records.map((r) => fmeaRowValues(r));
  // PDF 表格用百分比宽度：短列窄、长列宽
  const widths = [
    4, 3, 3, 3, 5, 3,
    3, 7, 7, 3,
    6, 3, 1.5, 1.5, 1.5,
    6, 3, 3,
    7, 7, 3, 3,
  ];
  const header = FMEA_HEADERS.map((h, i) => `<th style="width:${widths[i]}%">${esc(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${r.map((c, i) => `<td style="width:${widths[i]}%">${esc(c)}</td>`).join('')}</tr>`)
    .join('');
  return `
<section class="chapter summary fmea-landscape">
  <h1>附表　FMEA点检表</h1>
  <table class="fmea-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
  <p class="note">注：共 ${records.length} 条 FMEA 案例被本项目引用，表中内容来自 KBE_FMEA 库中 citation 指向本项目的记录。</p>
</section>`;
}

/** 生成自包含 A4 HTML（内联样式，离线排版），主进程隐藏窗口加载后 printToPDF。可选传入 fmeaRecords，末尾加 FMEA 点检表 section */
export function buildPdfHtml(m: ReportModel, fmeaRecords?: unknown[]): string {
  const tocFmea = Array.isArray(fmeaRecords) && fmeaRecords.length > 0 ? '<div class="toc-item">附表　FMEA点检表</div>' : '';
  const tocItems = m.chapters
    .map((c) => `<div class="toc-item">第 ${c.no} 章　${esc(c.title)}（${esc(c.domain)}）</div>`)
    .join('') + '<div class="toc-item">附表　全部计算汇总</div>' + tocFmea;

  const chapters = m.chapters
    .map((c) => {
      const formulas = c.formulas
        .map((fx) => {
          if (fx.pngBase64) {
            const maxW = 700;
            const ratio = fx.pngW && fx.pngW > maxW ? maxW / fx.pngW : 1;
            const w = Math.round((fx.pngW ?? 400) * ratio);
            const h = Math.round((fx.pngH ?? 60) * ratio);
            return `<div class="fx"><div class="fx-label">${esc(fx.label)}：</div><div class="fx-img-wrap"><img class="fx-img" width="${w}" height="${h}" src="data:image/png;base64,${fx.pngBase64}" alt="公式"/></div></div>`;
          }
          // 降级：无图片时显示源码
          return `<div class="fx"><div class="fx-label">${esc(fx.label)}：</div><div class="fx-tex">${esc(fx.tex)}</div></div>`;
        })
        .join('');
      return `
<section class="chapter">
  <h1>第 ${c.no} 章　${esc(c.title)}</h1>
  <div class="meta">计算类别：${esc(c.domain)}　　计算时间：${esc(c.time)}</div>
  ${c.purpose ? `<h2>${c.no}.1 计算目的</h2><p>${esc(c.purpose)}</p>` : ''}
  ${c.formulas.length ? `<h2>${c.no}.2 理论公式</h2>${formulas}` : ''}
  <h2>${c.no}.3 输入参数</h2>
  ${pdfTable(['参数名称', '符号', '数值', '单位'], c.inputs.map((r) => [r.label, r.symbol, r.value, r.unit]))}
  <h2>${c.no}.4 计算结果</h2>
  ${pdfTable(['结果名称', '符号', '数值', '单位'], c.outputs.map((r) => [r.label, r.symbol, r.value, r.unit]))}
  ${c.conclusion ? `<h2>${c.no}.5 结论</h2><p>经计算，${esc(c.conclusion)}。</p>` : ''}
</section>`;
    })
    .join('');

  const summary = `
<section class="chapter summary">
  <h1>附表　全部计算汇总</h1>
  ${pdfSummaryTable(m)}
  <p class="note">注：表中仅列出设计参数与主结果，中间计算量未列入；计算过程详见各章。</p>
</section>`;

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(m.docName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'SimSun', '宋体', serif; color: #1a2430; font-size: 12pt; line-height: 1.75; margin: 0; }
  .cover { height: 1000px; display: flex; flex-direction: column; align-items: center; text-align: center; page-break-after: always; padding-top: 90px; }
  .cover .company { font-family: 'SimHei', '黑体', sans-serif; font-size: 20pt; font-weight: 700; margin-bottom: 60px; }
  .cover .docname { font-family: 'SimHei', '黑体', sans-serif; font-size: 30pt; font-weight: 700; margin-bottom: 70px; line-height: 1.5; }
  .cover .info { display: inline-block; text-align: left; font-size: 15pt; line-height: 2; margin-bottom: 6px; }
  .cover .sign-table { width: 60%; margin: 70px auto 0; border-collapse: collapse; }
  .cover .sign-table td { border: none; padding: 8px 0; font-size: 14pt; }
  .cover .sign-table td.s-label { width: 38%; text-align: right; padding-right: 6px; white-space: nowrap; }
  .cover .sign-table td.s-line { width: 62%; height: 30px; border-bottom: 1px solid #1a2430; }
  .cover .date { margin-top: 60px; font-size: 14pt; }
  .toc { page-break-after: always; }
  .toc h1 { font-family: 'SimHei', '黑体', sans-serif; font-size: 18pt; text-align: center; margin-bottom: 28px; }
  .toc-item { font-size: 12pt; padding: 6px 0; border-bottom: 1px dotted #bbb; }
  .chapter h1 { font-family: 'SimHei', '黑体', sans-serif; font-size: 16pt; border-bottom: 2px solid #1a5fb4; padding-bottom: 6px; margin: 26px 0 10px; page-break-before: always; }
  .chapter .meta { color: #556375; font-size: 10.5pt; margin-bottom: 12px; }
  .chapter h2 { font-family: 'SimHei', '黑体', sans-serif; font-size: 13pt; margin: 18px 0 8px; }
  .chapter p { margin: 6px 0; text-align: justify; }
  .fx { margin: 6px 0 12px; }
  .fx-label { font-weight: 700; font-size: 11pt; }
  .fx-img-wrap { text-align: center; padding: 10px 0; margin-top: 4px; }
  .fx-img { display: inline-block; vertical-align: middle; image-rendering: -webkit-optimize-contrast; }
  .fx-tex { font-family: 'Cambria Math', 'Times New Roman', serif; font-style: italic; text-align: center; padding: 8px 12px; background: #f5f8fc; border: 1px solid #e2e8f0; border-radius: 4px; margin-top: 4px; font-size: 11pt; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 10.5pt; page-break-inside: auto; }
  th { background: #dce6f4; }
  th, td { border: 1px solid #8a97a8; padding: 5px 8px; text-align: left; }
  ul { margin: 6px 0; padding-left: 22px; }
  li { margin: 3px 0; font-size: 11pt; }
  .summary td { vertical-align: top; font-size: 10pt; }
  .fmea-table th, .fmea-table td { font-size: 9pt; vertical-align: top; word-break: break-word; }
  .fmea-table th { font-weight: 700; text-align: center; }
  .summary .note { color: #556375; font-size: 9.5pt; margin-top: 6px; }
  .fmea-landscape { page: fmea; page-break-before: always; }
  @page fmea { size: A4 landscape; margin: 8mm; }
  .sum-table { table-layout: fixed; }
  .sum-table td { text-align: center; vertical-align: middle; padding: 4px 6px; font-size: 9.5pt; }
  .sum-table td.sum-k { font-weight: 700; }
</style></head>
<body>
  <div class="cover">
    <div class="company">${esc(m.company)}</div>
    <div class="docname">${esc(m.docName)}</div>
    <div class="info">
      <div>项目名称：${esc(m.projectName ?? '（临时计算）')}</div>
      ${m.product ? `<div>产品名称：${esc(m.product)}</div>` : ''}
      ${m.productVersion ? `<div>产品版本：${esc(m.productVersion)}</div>` : ''}
    </div>
    <table class="sign-table">
      <tr><td class="s-label">编制：</td><td class="s-line">${esc(m.compiler)}</td></tr>
      <tr><td class="s-label">校对：</td><td class="s-line"></td></tr>
      <tr><td class="s-label">审核：</td><td class="s-line"></td></tr>
      <tr><td class="s-label">批准：</td><td class="s-line"></td></tr>
    </table>
    <div class="date">${esc(m.dateCN)}</div>
  </div>
  <div class="toc"><h1>目　录</h1>${tocItems}</div>
  ${chapters}
  ${summary}
  ${fmeaPdfSection(fmeaRecords)}
</body></html>`;
}
