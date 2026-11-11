import type { CurvePoint, FormulaSpec } from '../../formula/types';
import { EXPANSION_DIAGRAM } from './diagrams';

/**
 * 膨胀腔消音器（Expansion Chamber Muffler）
 *
 * 主公式（与参考 PPT 严格一致）：
 *   传递损失  TL = 10·lg[ 1 + 0.25·(m − 1/m)² · ( sin(2πL/λ) / (cos(2πLa/λ)·cos(2πLb/λ)) )² ]
 *   扩张比    m = S₂/S₁ = D²/d²（圆管和扩张腔）
 *   辅助式    λ = c/f，c ≈ 331.3 + 0.606·t
 *
 * La = Lb = 0 时退化为经典单扩张腔公式 TL = 10lg[1 + 0.25(m−1/m)²·sin²(kL)]。
 * TL 曲线在频带 [fmin, fmax] 内均分 400 份采样，纵轴 TL（dB），横轴 Frequency（Hz）。
 */

/** PPT 给定的频带均分段数（fmin ~ fmax 均分 400 份，共 401 个采样点） */
const SEGMENTS = 400;

/** 由 SI 输入算出中间量：截面积（直径优先，置 0 时按面积输入）、扩张比、声速 */
function derive(v: Record<string, number>) {
  const { S1, d, S2, D, L, La, Lb, t, fmin, fmax } = v;
  if (!Number.isFinite(t)) return null;
  const s1 = d > 0 ? (Math.PI * d * d) / 4 : S1;
  const s2 = D > 0 ? (Math.PI * D * D) / 4 : S2;
  if (!(s1 > 0) || !(s2 > 0) || !(L > 0) || !(La >= 0) || !(Lb >= 0)) return null;
  const c = 331.3 + 0.606 * (t - 273.15);
  const m = s2 / s1;
  const dEq = 2 * Math.sqrt(s1 / Math.PI);
  const DEq = 2 * Math.sqrt(s2 / Math.PI);
  return { c, m, s1, s2, dEq, DEq, L, La, Lb, fmin, fmax };
}

/**
 * 单频点传递损失（dB）：
 *   TL = 10·lg[ 1 + 0.25·(m − 1/m)² · ( sin(2πL/λ) / (cos(2πLa/λ)·cos(2πLb/λ)) )² ]，λ = c/f
 */
function tlAtFreq(f: number, r: NonNullable<ReturnType<typeof derive>>): number {
  if (!(f > 0)) return 0; // f = 0 时 sin(2πL/λ) → 0，TL = 0
  const lambda = r.c / f;
  const num = Math.sin((2 * Math.PI * r.L) / lambda);
  const den =
    Math.cos((2 * Math.PI * r.La) / lambda) * Math.cos((2 * Math.PI * r.Lb) / lambda);
  const ratio = num / den;
  const term = 0.25 * (r.m - 1 / r.m) ** 2 * ratio * ratio;
  return 10 * Math.log10(1 + term);
}

/** 频带 [fmin, fmax] 均分 400 份采样 TL 曲线；插入管共振奇异点跳过 */
function sampleCurve(r: NonNullable<ReturnType<typeof derive>>): CurvePoint[] {
  const { fmin, fmax } = r;
  if (!(fmax > fmin) || !(fmin >= 0)) return [];
  const points: CurvePoint[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const f = fmin + (i * (fmax - fmin)) / SEGMENTS;
    const tl = tlAtFreq(f, r);
    if (!Number.isFinite(tl)) continue; // cos 项为 0 的理论奇异点
    points.push({ x: f, y: tl });
  }
  return points;
}

export const expansionMuffler: FormulaSpec = {
  id: 'acoustics.muffler.expansion',
  version: '1.0.0',
  status: 'published',
  domain: 'acoustics',
  subsystem: '消声器',
  title: '膨胀腔消音器',
  summary: '由声音传入/传出管与膨胀腔截面、腔长及插入深度计算扩张比与传递损失 TL 曲线，用于扩张式消声器的选频降噪设计。',
  tags: ['膨胀腔', '扩张腔', '消音器', '消声器', '传递损失', 'TL', '扩张比', 'NVH', '排气系统'],
  description:
    '膨胀腔消音器利用管道截面的突然扩张与收缩形成阻抗失配，在特定频率产生传递损失峰值。本公式按参考 PPT 计算：TL = 10lg[1 + 0.25(m−1/m)²·(sin(2πL/λ)/(cos(2πLa/λ)·cos(2πLb/λ)))²]，扩张比 m = S₂/S₁ = D²/d²，波长 λ = c/f，声速 c ≈ 331.3 + 0.606t（t 为摄氏温度）。传入/传出管截面积与直径可二选一输入（直径优先，置 0 时按面积）。结果区输出频带内 TL 峰值与峰值频率，并绘制 TL - Frequency 曲线（频带均分 400 份，纵轴 TL/dB，横轴 Frequency/Hz）。',
  inputs: [
    { key: 'S1', label: '声音传入管截面积', symbol: 'S₁', unit: 'mm²', unitGroup: 'area', default: 3848, min: 0, required: true, description: '与直径 d 二选一：d = 0 时按本值计算；d > 0 时自动按 S₁ = πd²/4 取值' },
    { key: 'd', label: '声音传入管直径', symbol: 'd', unit: 'mm', unitGroup: 'diameter', default: 70, min: 0, required: true, description: '非零时优先按 d 计算 S₁；置 0 则直接采用上方输入的 S₁' },
    { key: 'S2', label: '膨胀腔截面积', symbol: 'S₂', unit: 'mm²', unitGroup: 'area', default: 31416, min: 0, required: true, description: '与直径 D 二选一：D = 0 时按本值计算；D > 0 时自动按 S₂ = πD²/4 取值' },
    { key: 'D', label: '膨胀腔直径', symbol: 'D', unit: 'mm', unitGroup: 'diameter', default: 200, min: 0, required: true, description: '非零时优先按 D 计算 S₂；置 0 则直接采用上方输入的 S₂' },
    { key: 'L', label: '膨胀腔长度', symbol: 'L', unit: 'mm', unitGroup: 'length', default: 200, min: 0, required: true, description: '膨胀腔有效长度，决定 TL 峰值频率（La=Lb=0 时首峰 f ≈ c/(4L)）' },
    { key: 'La', label: '声音传入管插入深度', symbol: 'La', unit: 'mm', unitGroup: 'length', default: 0, min: 0, required: true, description: '声音传入管伸入膨胀腔的深度，无插入时取 0' },
    { key: 'Lb', label: '声音传出管插入深度', symbol: 'Lb', unit: 'mm', unitGroup: 'length', default: 0, min: 0, required: true, description: '声音传出管伸入膨胀腔的深度，无插入时取 0' },
    { key: 't', label: '温度', symbol: 't', unit: '℃', unitGroup: 'temperature', default: 25, required: true, description: '介质温度，用于计算声速 c ≈ 331.3 + 0.606t' },
    { key: 'fmin', label: '起始频率', symbol: 'f_min', unit: 'Hz', default: 0, min: 0, required: true, description: 'TL 曲线频带下限' },
    { key: 'fmax', label: '终止频率', symbol: 'f_max', unit: 'Hz', default: 3000, min: 0, required: true, description: 'TL 曲线频带上限，频带均分 400 份采样' },
  ],
  outputs: [
    { key: 'tlMax', label: '传递损失峰值', symbol: 'TL_max', unit: 'dB', primary: true, group: '声学特性', description: '频带 [f_min, f_max] 内 TL 曲线的最大值（400 均分采样）。La=Lb=0 时理论峰值 10lg[1+0.25(m−1/m)²]' },
    { key: 'fPeak', label: '峰值频率', symbol: 'f_p', unit: 'Hz', primary: true, group: '声学特性', description: 'TL 峰值对应的频率；La=Lb=0 时首个峰值 f ≈ c/(4L)' },
    { key: 'c', label: '介质声速', symbol: 'c', unit: 'm/s', group: '声学特性', description: 'c ≈ 331.3 + 0.606·t（t 为摄氏温度）' },
    { key: 'm', label: '扩张比', symbol: 'm', unit: '—', group: '中间量', description: 'm = S₂/S₁ = D²/d²（圆管和扩张腔）' },
    { key: 's1', label: '声音传入管截面积', symbol: 'S₁', unit: 'mm²', unitGroup: 'area', group: '中间量', description: '直径输入时 S₁ = πd²/4；否则为输入值' },
    { key: 's2', label: '膨胀腔截面积', symbol: 'S₂', unit: 'mm²', unitGroup: 'area', group: '中间量', description: '直径输入时 S₂ = πD²/4；否则为输入值' },
    { key: 'dEq', label: '声音传入管当量直径', symbol: 'd', unit: 'mm', unitGroup: 'diameter', group: '中间量', description: '由截面积换算 d = 2√(S₁/π)' },
    { key: 'DEq', label: '膨胀腔当量直径', symbol: 'D', unit: 'mm', unitGroup: 'diameter', group: '中间量', description: '由截面积换算 D = 2√(S₂/π)' },
  ],
  latex: [
    {
      label: '传递损失（主公式）',
      tex: 'TL = 10\\,\\lg\\left[1 + 0.25\\left(m - \\frac{1}{m}\\right)^{2}\\left(\\frac{\\sin\\left(\\dfrac{2\\pi L}{\\lambda}\\right)}{\\cos\\left(\\dfrac{2\\pi L_{a}}{\\lambda}\\right)\\cos\\left(\\dfrac{2\\pi L_{b}}{\\lambda}\\right)}\\right)^{2}\\right]',
    },
    {
      label: '扩张比',
      tex: 'm = \\frac{S_{2}}{S_{1}} = \\frac{D^{2}}{d^{2}}\\quad(\\text{圆管和扩张腔})',
    },
    {
      label: '辅助式',
      tex: '\\lambda = \\frac{c}{f},\\qquad c \\approx 331.3 + 0.606\\,t,\\qquad S = \\frac{\\pi D^{2}}{4}',
    },
    {
      label: 'TL 曲线（频带均分 400 份）',
      tex: 'f \\in \\left[f_{\\min},\\,f_{\\max}\\right]\\;\\text{均分 400 份},\\qquad TL = TL(f)',
    },
  ],
  diagram: EXPANSION_DIAGRAM,
  sensitivity: true,
  assumptions: [
    '公式与参考 PPT 严格一致：TL = 10lg[1 + 0.25(m−1/m)²·(sin(2πL/λ)/(cos(2πLa/λ)·cos(2πLb/λ)))²]，λ = c/f',
    'La = Lb = 0 时退化为经典单扩张腔公式 TL = 10lg[1 + 0.25(m−1/m)²·sin²(2πL/λ)]，峰值 10lg[1+0.25(m−1/m)²] 出现于 f = (2n−1)·c/(4L)',
    '截面积与直径二选一：d > 0 时按 S₁ = πd²/4 计算，d = 0 时直接取用输入的 S₁；D 与 S₂ 同理',
    '声速按经验式 c ≈ 331.3 + 0.606t 计算（t 为摄氏温度），未计湿度与压力影响',
    '一维平面波理论：未计高阶模态（截面尺寸须远小于波长）、气流流速与粘热阻尼',
    'cos(2πLa/λ)·cos(2πLb/λ) 接近 0 时模型出现奇异（插入管共振），对应频点 TL 趋于无穷大，曲线中跳过该点',
    'TL 曲线与峰值均按频带 [f_min, f_max] 均分 400 份采样；f = 0 时 TL = 0',
  ],
  solve(v) {
    const empty = {
      tlMax: NaN, fPeak: NaN, c: NaN, m: NaN, s1: NaN, s2: NaN, dEq: NaN, DEq: NaN,
    };
    const r = derive(v);
    if (!r) return empty;
    // 频带内 TL 峰值（与曲线共用同一采样，保证峰值与曲线最大值严格一致）
    const pts = sampleCurve(r);
    let tlMax = NaN;
    let fPeak = NaN;
    if (pts.length > 0) {
      let best = pts[0];
      for (const p of pts) if (p.y > best.y) best = p;
      tlMax = best.y;
      fPeak = best.x;
    }
    return { tlMax, fPeak, c: r.c, m: r.m, s1: r.s1, s2: r.s2, dEq: r.dEq, DEq: r.DEq };
  },
  curve: {
    label: '传递损失 TL 曲线',
    xLabel: 'Frequency (Hz)',
    yLabel: 'TL (dB)',
    compute(v) {
      const r = derive(v);
      if (!r) return [];
      return sampleCurve(r);
    },
  },
  benchmarks: [
    {
      name: '默认工况（直径输入：d=70mm, D=200mm, L=200mm, La=Lb=0, t=25℃）',
      input: {
        S1: 3.848451000647496e-3, d: 0.07, S2: 3.141592653589793e-2, D: 0.2,
        L: 0.2, La: 0, Lb: 0, t: 298.15, fmin: 0, fmax: 3000,
      },
      expect: {
        c: 346.45,
        m: 8.163265306122449,
        s1: 3.848451000647496e-3,
        s2: 3.141592653589793e-2,
        dEq: 0.07,
        DEq: 0.2,
        tlMax: 12.3459,
        fPeak: 1297.5,
      },
      tolerance: 2e-3,
      source: '按 PPT 公式手工核算：m = 200²/70² = 8.1633，理论峰值 10lg[1+0.25(m−1/m)²] = 12.346 dB；峰值频率 f = (2n−1)·c/(4L) = (2n−1)·433.06 Hz，采样点中最接近峰值者为 1297.5 Hz（第 2 峰），TL ≈ 12.346 dB',
    },
    {
      name: '面积输入 + 0℃（S₁=π/4·50²mm², S₂=π/4·100²mm², L=300mm）',
      input: {
        S1: 1.963495408493621e-3, d: 0, S2: 7.853981633974483e-3, D: 0,
        L: 0.3, La: 0, Lb: 0, t: 273.15, fmin: 0, fmax: 2000,
      },
      expect: {
        c: 331.3,
        m: 4,
        s1: 1.963495408493621e-3,
        s2: 7.853981633974483e-3,
        dEq: 0.05,
        DEq: 0.1,
        tlMax: 6.5472,
        fPeak: 1380,
      },
      tolerance: 2e-3,
      source: '0℃ 时 c = 331.3 m/s；m = 4，理论峰值 10lg[1+0.25×3.75²] = 6.547 dB；峰值频率 f = (2n−1)·276.08 Hz，采样点中最接近者为 1380 Hz，TL ≈ 6.547 dB',
    },
  ],
};
