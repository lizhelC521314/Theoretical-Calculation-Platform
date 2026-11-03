/**
 * 报告解析：把 JSON（§12）/ Excel / Word 报告统一解析为元数据 + 曲线组。
 *
 * Excel 模板约定：
 *   工作表「元数据」：A 列字段名、B 列值（字段名见 META_KEY_MAP）
 *   工作表「曲线」：表头行 [测量量, 单位, x, 第1次, 第2次, 第3次, ...]
 *     ——「第n次」列为重复测量值；主值取重复列均值；U95 可用表尾「U95」列给出
 * Word 约定：元数据按「字段名：值」逐行书写（docx 经 mammoth 提取纯文本）。
 */
import type { ExperimentMeta, MeasurementCurve, QuantityKind } from './types';

/** 中文字段名 → meta 键 */
const META_KEY_MAP: Record<string, keyof ExperimentMeta> = {
  报告编号: 'reportId',
  产品族: 'productFamily',
  产品型号: 'productModel',
  报告版本: 'reportVersion',
  试验标准: 'testStandard',
  测试标准: 'testStandard',
  试验日期: 'testDate',
  测试日期: 'testDate',
  试验员: 'operator',
  测试员: 'operator',
  实验室: 'lab',
  传感器编号: 'sensorIds',
  传感器: 'sensorIds',
  校准到期: 'calibrationDue',
  校准到期日: 'calibrationDue',
  温度: 'temperature',
  湿度: 'humidity',
  海拔: 'altitude',
  流量: 'flowRate',
  单位制: 'unitSystem',
};

const NUMERIC_KEYS: (keyof ExperimentMeta)[] = ['temperature', 'humidity', 'altitude', 'flowRate'];

function assignMeta(meta: Record<string, unknown>, rawKey: string, rawValue: string): void {
  const key = META_KEY_MAP[rawKey.trim()];
  if (!key) return;
  const value = rawValue.trim();
  if (key === 'sensorIds') {
    meta[key] = value.split(/[,，;；、\s]+/).filter(Boolean);
  } else if (NUMERIC_KEYS.includes(key)) {
    const n = Number(value.replace(/[^\d.\-]/g, ''));
    if (Number.isFinite(n)) meta[key] = n;
  } else {
    meta[key] = value;
  }
}

/** 按单位推断量类别：含 dB → 声学量，否则线性量 */
export function inferKind(unit: string): QuantityKind {
  return /db|分贝/i.test(unit) ? 'acoustic' : 'linear';
}

export interface ParsedReport {
  meta: Partial<ExperimentMeta>;
  curves: MeasurementCurve[];
}

/** §12 报告 JSON（字段名英文，结构与规范示例一致） */
export function parseReportJson(json: unknown): ParsedReport {
  const r = json as Record<string, unknown>;
  const product = (r.product ?? {}) as Record<string, string>;
  const test = (r.test ?? {}) as Record<string, unknown>;
  const sensors = (r.sensors ?? []) as { id?: string; calibration_due?: string }[];

  const meta: Partial<ExperimentMeta> = {
    reportId: String(r.report_id ?? ''),
    productFamily: String(product.family ?? ''),
    productModel: String(product.model ?? ''),
    reportVersion: String(product.version ?? ''),
    testStandard: String(test.standard ?? ''),
    testDate: String(test.date ?? ''),
    operator: String(test.operator ?? ''),
    lab: String(test.lab ?? ''),
    sensorIds: sensors.map((s) => String(s.id ?? '')).filter(Boolean),
    calibrationDue: sensors.map((s) => s.calibration_due ?? '').filter(Boolean).sort()[0] ?? '',
    temperature: Number(test.temperature ?? NaN),
    humidity: Number(test.humidity ?? NaN),
    altitude: Number(test.altitude ?? NaN),
    flowRate: Number(test.flow_rate ?? NaN),
    unitSystem: String(r.unit_system ?? 'SI'),
  };

  const curves: MeasurementCurve[] = ((r.curves ?? []) as Record<string, unknown>[]).map((c) => {
    const unit = String(c.unit ?? '');
    const pts = (c.points ?? []) as [number, number][];
    return {
      quantity: String(c.quantity ?? ''),
      kind: (c.kind as QuantityKind) ?? inferKind(unit),
      unit,
      points: pts.map(([x, y]) => ({ x: Number(x), y: Number(y) })),
      uncertaintyU95: c.u95 !== undefined ? Number(c.u95) : undefined,
      repeats: (c.repeats as number[][] | undefined)?.map((row) => row.map(Number)),
    };
  });

  return { meta, curves };
}

/** Excel：exceljs 工作簿对象（由调用方负责读取文件） */
export async function parseReportXlsx(workbook: import('exceljs').Workbook): Promise<ParsedReport> {
  const meta: Record<string, unknown> = {};
  const wsMeta = workbook.getWorksheet('元数据') ?? workbook.worksheets[0];
  wsMeta?.eachRow((row) => {
    const k = String(row.getCell(1).value ?? '').trim();
    const v = row.getCell(2).value;
    if (k) assignMeta(meta, k, v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ''));
  });

  const curves: MeasurementCurve[] = [];
  const wsCurve = workbook.getWorksheet('曲线');
  if (wsCurve) {
    const header: string[] = [];
    wsCurve.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      header[col] = String(cell.value ?? '').trim();
    });
    // 表头：测量量 | 单位 | x | 第1次…第n次 | U95(可选)
    const repCols: number[] = [];
    let u95Col = -1;
    header.forEach((h, col) => {
      if (/^第\d+次$/.test(h)) repCols.push(col);
      if (/^u95$/i.test(h)) u95Col = col;
    });
    const groups = new Map<string, MeasurementCurve & { repRows: number[][]; xs: number[] }>();
    wsCurve.eachRow((row, rowNo) => {
      if (rowNo === 1) return;
      const quantity = String(row.getCell(1).value ?? '').trim();
      const unit = String(row.getCell(2).value ?? '').trim();
      const x = Number(row.getCell(3).value);
      if (!quantity || !Number.isFinite(x)) return;
      let c = groups.get(quantity);
      if (!c) {
        c = { quantity, kind: inferKind(unit), unit, points: [], repRows: [], xs: [], uncertaintyU95: undefined };
        groups.set(quantity, c);
      }
      const reps = repCols.map((col) => Number(row.getCell(col).value)).filter((v) => Number.isFinite(v));
      const y = reps.length > 0 ? reps.reduce((a, b) => a + b, 0) / reps.length : NaN;
      if (Number.isFinite(y)) {
        c.points.push({ x, y });
        c.repRows.push(reps);
        c.xs.push(x);
      }
      if (u95Col > 0) {
        const u = Number(row.getCell(u95Col).value);
        if (Number.isFinite(u)) c.uncertaintyU95 = u;
      }
    });
    for (const c of groups.values()) {
      c.points.sort((a, b) => a.x - b.x);
      const order = c.xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
      const reps = order.map(([, i]) => c.repRows[i]);
      curves.push({
        quantity: c.quantity, kind: c.kind, unit: c.unit, points: c.points,
        uncertaintyU95: c.uncertaintyU95,
        repeats: reps.some((r) => r.length > 0) ? reps : undefined,
      });
    }
  }
  return { meta: meta as Partial<ExperimentMeta>, curves };
}

/** Word：mammoth 提取纯文本，按「字段名：值」行解析元数据 */
export async function parseReportDocx(buffer: ArrayBuffer): Promise<ParsedReport> {
  const mammoth = await import('mammoth');
  // node 端用 { buffer }，浏览器端用 { arrayBuffer }
  const input = typeof Buffer !== 'undefined'
    ? { buffer: Buffer.from(buffer) }
    : { arrayBuffer: buffer };
  const { value } = await mammoth.extractRawText(input as { arrayBuffer: ArrayBuffer });
  const meta: Record<string, unknown> = {};
  for (const line of value.split(/\r?\n/)) {
    const m = line.match(/^\s*([一-龥A-Za-z_]+)\s*[:：]\s*(.+?)\s*$/);
    if (m) assignMeta(meta, m[1], m[2]);
  }
  return { meta: meta as Partial<ExperimentMeta>, curves: [] };
}

/** 从原始字节计算 SHA256（浏览器 WebCrypto / Node crypto 自适应） */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes as BufferSource);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}
