/**
 * 标定图形输出（纯 SVG）
 *
 * 说明第 9.3 节要求报告附「实测/模型曲线」与「残差图」。此处用不依赖画布/浏览器的
 * 纯字符串 SVG 实现，命令行报告与「AI 公式优化」页面共用同一套生成逻辑。
 */

import type { CalibrationReport } from './types';

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartSeries {
  name: string;
  points: ChartPoint[];
  color: string;
  /** 虚线（用于对照曲线） */
  dashed?: boolean;
  /** 绘制数据点标记（频带均值等离散点） */
  markers?: boolean;
}

export interface LineChartOptions {
  title?: string;
  xLabel: string;
  yLabel: string;
  series: ChartSeries[];
  /** 横轴取对数（频率轴） */
  logX?: boolean;
  /** 纵轴范围包含 0（残差等） */
  includeZero?: boolean;
  width?: number;
  height?: number;
  /** 训练频带下限（Hz），低于此值的区域标灰色表示外推 */
  trainMinHz?: number;
  /** 训练频带上限（Hz），高于此值的区域标灰色表示外推 */
  trainMaxHz?: number;
}

const PAD = { l: 62, r: 22, t: 52, b: 48 };
const AXIS = '#cbd5e1';
const GRID = '#eef1f6';
const MUTED = '#64748b';
const FONT = "'Microsoft YaHei','PingFang SC',sans-serif";

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 刻度数值格式：整数直接显示，其余按量级取小数位 */
function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  if (!(raw > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return mult * mag;
}

function linearTicks(min: number, max: number, count = 5): number[] {
  const step = niceStep(max - min, count);
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = first; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** 对数轴刻度：1/2/5 × 10^n，过密时退化为整十倍频程 */
function logTicks(min: number, max: number): number[] {
  const out: number[] = [];
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  for (let d = lo; d <= hi; d++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, d);
      if (v >= min * 0.999 && v <= max * 1.001) out.push(v);
    }
  }
  if (out.length > 8) {
    const decades = out.filter((v) => Math.abs(Math.log10(v) % 1) < 1e-9);
    return decades.length >= 2 ? decades : out;
  }
  return out.length >= 2 ? out : [min, max];
}

/** 域外扩固定比例，避免曲线贴边 */
function padDomain(min: number, max: number, ratio: number, log: boolean): [number, number] {
  if (!(max > min)) {
    const c = Number.isFinite(min) ? min : 0;
    const d = Math.max(Math.abs(c) * 0.1, 1);
    return [c - d, c + d];
  }
  if (log) {
    const l0 = Math.log10(min);
    const l1 = Math.log10(max);
    const p = (l1 - l0) * ratio;
    return [Math.pow(10, l0 - p), Math.pow(10, l1 + p)];
  }
  const p = (max - min) * ratio;
  return [min - p, max + p];
}

function svgOpen(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${FONT}">`;
}

function emptySvg(width: number, height: number, text: string): string {
  return `${svgOpen(width, height)}<rect width="${width}" height="${height}" fill="#fff"/><text x="${
    width / 2
  }" y="${height / 2}" text-anchor="middle" font-size="12" fill="${MUTED}">${esc(text)}</text></svg>`;
}

/** 通用折线图（对数/线性横轴，自动刻度与图例） */
export function renderLineChartSvg(o: LineChartOptions): string {
  const width = o.width ?? 760;
  const height = o.height ?? 320;
  const plotW = width - PAD.l - PAD.r;
  const plotH = height - PAD.t - PAD.b;
  const logX = !!o.logX;

  const series = o.series.map((s) => ({
    ...s,
    points: s.points
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && (!logX || p.x > 0))
      .sort((a, b) => a.x - b.x),
  }));
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return emptySvg(width, height, '暂无数据');

  const [x0, x1] = padDomain(
    Math.min(...all.map((p) => p.x)),
    Math.max(...all.map((p) => p.x)),
    0.03,
    logX,
  );
  let yMin = Math.min(...all.map((p) => p.y));
  let yMax = Math.max(...all.map((p) => p.y));
  if (o.includeZero) {
    yMin = Math.min(0, yMin);
    yMax = Math.max(0, yMax);
  }
  const [y0, y1] = padDomain(yMin, yMax, o.includeZero ? 0.08 : 0.1, false);

  const xScale = (v: number) =>
    logX
      ? PAD.l + ((Math.log10(v) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0))) * plotW
      : PAD.l + ((v - x0) / (x1 - x0)) * plotW;
  const yScale = (v: number) => PAD.t + plotH - ((v - y0) / (y1 - y0)) * plotH;

  const parts: string[] = [svgOpen(width, height)];
  parts.push(`<rect width="${width}" height="${height}" fill="#fff"/>`);

  // 外推带（训练区外的频率范围，浅灰色半透明）
  const extrapColor = '#f1f5f9';
  if (o.trainMinHz !== undefined && o.trainMinHz > x0) {
    const xTr = xScale(Math.min(o.trainMinHz, x1));
    parts.push(
      `<rect x="${PAD.l.toFixed(2)}" y="${PAD.t.toFixed(2)}" width="${Math.max(0, xTr - PAD.l).toFixed(
        2,
      )}" height="${plotH.toFixed(2)}" fill="${extrapColor}" fill-opacity="0.7"/>`,
    );
  }
  if (o.trainMaxHz !== undefined && o.trainMaxHz < x1) {
    const xTl = xScale(Math.max(o.trainMaxHz, x0));
    parts.push(
      `<rect x="${xTl.toFixed(2)}" y="${PAD.t.toFixed(2)}" width="${Math.max(0, PAD.l + plotW - xTl).toFixed(
        2,
      )}" height="${plotH.toFixed(2)}" fill="${extrapColor}" fill-opacity="0.7"/>`,
    );
  }

  // 网格与刻度
  const yTicks = linearTicks(y0, y1, 5);
  for (const v of yTicks) {
    const y = yScale(v);
    if (y < PAD.t - 1 || y > PAD.t + plotH + 1) continue;
    parts.push(`<line x1="${PAD.l}" y1="${y.toFixed(2)}" x2="${PAD.l + plotW}" y2="${y.toFixed(2)}" stroke="${GRID}"/>`);
    parts.push(
      `<text x="${PAD.l - 7}" y="${(y + 3.5).toFixed(2)}" text-anchor="end" font-size="10.5" fill="${MUTED}">${fmt(v)}</text>`,
    );
  }
  const xTicks = logX ? logTicks(x0, x1) : linearTicks(x0, x1, 6);
  for (const v of xTicks) {
    const x = xScale(v);
    if (x < PAD.l - 1 || x > PAD.l + plotW + 1) continue;
    parts.push(`<line x1="${x.toFixed(2)}" y1="${PAD.t}" x2="${x.toFixed(2)}" y2="${PAD.t + plotH}" stroke="${GRID}"/>`);
    parts.push(
      `<text x="${x.toFixed(2)}" y="${PAD.t + plotH + 17}" text-anchor="middle" font-size="10.5" fill="${MUTED}">${fmt(v)}</text>`,
    );
  }

  // 坐标轴
  parts.push(`<line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${PAD.t + plotH}" stroke="${AXIS}"/>`);
  parts.push(
    `<line x1="${PAD.l}" y1="${PAD.t + plotH}" x2="${PAD.l + plotW}" y2="${PAD.t + plotH}" stroke="${AXIS}"/>`,
  );

  // 轴标签
  parts.push(
    `<text x="${PAD.l + plotW / 2}" y="${height - 10}" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(o.xLabel)}</text>`,
  );
  const yc = PAD.t + plotH / 2;
  parts.push(
    `<text x="15" y="${yc}" transform="rotate(-90 15 ${yc})" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(o.yLabel)}</text>`,
  );

  // 曲线
  for (const s of series) {
    if (s.points.length === 0) continue;
    const d = s.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.x).toFixed(2)},${yScale(p.y).toFixed(2)}`)
      .join(' ');
    parts.push(
      `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.dashed ? 1.5 : 1.8}"${
        s.dashed ? ' stroke-dasharray="5 4"' : ''
      } stroke-linejoin="round" stroke-linecap="round"/>`,
    );
    if (s.markers && s.points.length <= 80) {
      for (const p of s.points) {
        parts.push(
          `<circle cx="${xScale(p.x).toFixed(2)}" cy="${yScale(p.y).toFixed(2)}" r="2.6" fill="#fff" stroke="${
            s.color
          }" stroke-width="1.4"/>`,
        );
      }
    }
  }

  // 标题与图例
  if (o.title) {
    parts.push(`<text x="${PAD.l}" y="20" font-size="12.5" font-weight="600" fill="#0e2a47">${esc(o.title)}</text>`);
  }
  let lx = PAD.l;
  const ly = o.title ? 39 : 30;
  for (const s of series) {
    if (s.points.length === 0) continue;
    parts.push(`<line x1="${lx}" y1="${ly - 3.5}" x2="${lx + 16}" y2="${ly - 3.5}" stroke="${s.color}" stroke-width="2.2"/>`);
    parts.push(`<text x="${lx + 21}" y="${ly}" font-size="10.5" fill="#374151">${esc(s.name)}</text>`);
    const w = 21 + Array.from(s.name).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 11.5 : 6.5), 0) + 18;
    lx += w;
  }

  parts.push('</svg>');
  return parts.join('');
}

/** 拟合曲线：实测/模型（可叠加原始实测与逐点模型曲线） */
export function renderFitChartSvg(
  report: CalibrationReport,
  extra?: { measured?: ChartPoint[]; model?: ChartPoint[] },
): string {
  const bands = report.bands.filter(
    (b) => b.included && Number.isFinite(b.center) && Number.isFinite(b.test) && Number.isFinite(b.model),
  );
  // 训练频带范围（从 included 带推导）
  const includedCenters = report.bands
    .filter((b) => b.included && Number.isFinite(b.center))
    .map((b) => b.center);
  const trainMinHz = includedCenters.length > 0 ? Math.min(...includedCenters) : NaN;
  const trainMaxHz = includedCenters.length > 0 ? Math.max(...includedCenters) : NaN;

  const series: ChartSeries[] = [];
  if (extra?.measured && extra.measured.length > 0) {
    series.push({ name: '实测（原始）', color: '#94a3b8', points: extra.measured });
  }
  if (extra?.model && extra.model.length > 0) {
    series.push({
      name: '模型（最优参数）',
      color: '#1a5fb4',
      points: extra.model,
    });
  }
  series.push({
    name: '实测（1/3 倍频带均值）',
    color: '#c0392b',
    points: bands.map((b) => ({ x: b.center, y: b.test })),
    markers: true,
  });
  series.push({
    name: '模型（频带）',
    color: '#1a5fb4',
    points: bands.map((b) => ({ x: b.center, y: b.model })),
    markers: true,
    dashed: !!extra?.model?.length,
  });
  return renderLineChartSvg({
    title: '传递损失拟合曲线',
    xLabel: '频率 (Hz)',
    yLabel: 'TL (dB)',
    logX: true,
    series,
    trainMinHz: Number.isFinite(trainMinHz) ? trainMinHz : undefined,
    trainMaxHz: Number.isFinite(trainMaxHz) ? trainMaxHz : undefined,
  });
}

/** 逐带残差图：残差 = 模型 − 实测（dB），虚线为 ±RMSE */
export function renderResidualChartSvg(report: CalibrationReport, width = 760, height = 300): string {
  const bands = report.bands.filter(
    (b) => b.included && Number.isFinite(b.center) && b.center > 0 && Number.isFinite(b.residual),
  );
  if (bands.length === 0) return emptySvg(width, height, '暂无残差数据');

  // 训练频带范围
  const includedCenters = report.bands
    .filter((b) => b.included && Number.isFinite(b.center))
    .map((b) => b.center);
  const trainMinHz = includedCenters.length > 0 ? Math.min(...includedCenters) : NaN;
  const trainMaxHz = includedCenters.length > 0 ? Math.max(...includedCenters) : NaN;

  const plotW = width - PAD.l - PAD.r;
  const plotH = height - PAD.t - PAD.b;
  const [x0, x1] = padDomain(
    Math.min(...bands.map((b) => b.center)),
    Math.max(...bands.map((b) => b.center)),
    0.03,
    true,
  );
  const maxAbs = Math.max(report.metrics.rmse, ...bands.map((b) => Math.abs(b.residual)), 0.5);
  const step = niceStep(maxAbs * 2, 4);
  const lim = Math.max(step, Math.ceil((maxAbs * 1.15) / step) * step);
  const yScale = (v: number) => PAD.t + plotH - ((v + lim) / (2 * lim)) * plotH;
  const xScale = (v: number) =>
    PAD.l + ((Math.log10(v) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0))) * plotW;

  const parts: string[] = [svgOpen(width, height)];
  parts.push(`<rect width="${width}" height="${height}" fill="#fff"/>`);

  // 外推带
  const extrapColor = '#f1f5f9';
  if (Number.isFinite(trainMinHz) && trainMinHz > x0) {
    const xTr = xScale(Math.min(trainMinHz, x1));
    parts.push(
      `<rect x="${PAD.l.toFixed(2)}" y="${PAD.t.toFixed(2)}" width="${Math.max(0, xTr - PAD.l).toFixed(2)}" height="${plotH.toFixed(2)}" fill="${extrapColor}" fill-opacity="0.7"/>`,
    );
  }
  if (Number.isFinite(trainMaxHz) && trainMaxHz < x1) {
    const xTl = xScale(Math.max(trainMaxHz, x0));
    parts.push(
      `<rect x="${xTl.toFixed(2)}" y="${PAD.t.toFixed(2)}" width="${Math.max(0, PAD.l + plotW - xTl).toFixed(2)}" height="${plotH.toFixed(2)}" fill="${extrapColor}" fill-opacity="0.7"/>`,
    );
  }

  // 水平网格 + 刻度
  const ticks: number[] = [];
  for (let v = -Math.floor(lim / step) * step; v <= lim + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  for (const v of ticks) {
    const y = yScale(v);
    parts.push(`<line x1="${PAD.l}" y1="${y.toFixed(2)}" x2="${PAD.l + plotW}" y2="${y.toFixed(2)}" stroke="${GRID}"/>`);
    parts.push(
      `<text x="${PAD.l - 7}" y="${(y + 3.5).toFixed(2)}" text-anchor="end" font-size="10.5" fill="${MUTED}">${fmt(v)}</text>`,
    );
  }
  for (const v of logTicks(x0, x1)) {
    const x = xScale(v);
    if (x < PAD.l - 1 || x > PAD.l + plotW + 1) continue;
    parts.push(`<line x1="${x.toFixed(2)}" y1="${PAD.t}" x2="${x.toFixed(2)}" y2="${PAD.t + plotH}" stroke="${GRID}"/>`);
    parts.push(
      `<text x="${x.toFixed(2)}" y="${PAD.t + plotH + 17}" text-anchor="middle" font-size="10.5" fill="${MUTED}">${fmt(v)}</text>`,
    );
  }

  // ±RMSE 参考线
  const rmse = report.metrics.rmse;
  for (const v of [rmse, -rmse]) {
    if (Math.abs(v) > lim) continue;
    const y = yScale(v);
    parts.push(
      `<line x1="${PAD.l}" y1="${y.toFixed(2)}" x2="${PAD.l + plotW}" y2="${y.toFixed(2)}" stroke="#94a3b8" stroke-dasharray="4 4"/>`,
    );
    parts.push(
      `<text x="${PAD.l + plotW - 2}" y="${(y - 4).toFixed(2)}" text-anchor="end" font-size="10" fill="#94a3b8">${
        v > 0 ? '+' : '−'
      }RMSE ${rmse.toFixed(2)}</text>`,
    );
  }

  // 残差柱
  const positions = bands.map((b) => xScale(b.center)).sort((a, b) => a - b);
  let spacing = plotW;
  for (let i = 1; i < positions.length; i++) spacing = Math.min(spacing, positions[i] - positions[i - 1]);
  const barW = Math.max(3, Math.min(16, spacing * 0.6));
  const zeroY = yScale(0);
  for (const b of bands) {
    const x = xScale(b.center);
    const y = yScale(b.residual);
    const top = Math.min(y, zeroY);
    const h = Math.max(1, Math.abs(y - zeroY));
    const color = Math.abs(b.residual) > 2 * rmse ? '#c0392b' : '#3b82f6';
    parts.push(
      `<rect x="${(x - barW / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(
        2,
      )}" fill="${color}" fill-opacity="0.85"/>`,
    );
  }

  // 零线与坐标轴
  parts.push(
    `<line x1="${PAD.l}" y1="${zeroY.toFixed(2)}" x2="${PAD.l + plotW}" y2="${zeroY.toFixed(
      2,
    )}" stroke="#94a3b8" stroke-width="1.2"/>`,
  );
  parts.push(`<line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${PAD.t + plotH}" stroke="${AXIS}"/>`);
  parts.push(
    `<line x1="${PAD.l}" y1="${PAD.t + plotH}" x2="${PAD.l + plotW}" y2="${PAD.t + plotH}" stroke="${AXIS}"/>`,
  );
  parts.push(
    `<text x="${PAD.l + plotW / 2}" y="${height - 10}" text-anchor="middle" font-size="11" fill="${MUTED}">频率 (Hz)</text>`,
  );
  const yc = PAD.t + plotH / 2;
  parts.push(
    `<text x="15" y="${yc}" transform="rotate(-90 15 ${yc})" text-anchor="middle" font-size="11" fill="${MUTED}">残差 (dB)</text>`,
  );
  parts.push(
    `<text x="${PAD.l}" y="20" font-size="12.5" font-weight="600" fill="#0e2a47">逐带残差（模型 − 实测）</text>`,
  );
  parts.push(
    `<text x="${PAD.l}" y="38" font-size="10.5" fill="${MUTED}">共 ${bands.length} 个有效 1/3 倍频带；超出 ±2×RMSE 的频带标红</text>`,
  );

  parts.push('</svg>');
  return parts.join('');
}
