import type { CurvePoint, FormulaSpec } from '../../formula/types';
import { WOVEN_DIAGRAM } from './diagrams';

/**
 * 编织管消音（Woven-Tube Silencer）
 *
 * 主公式（与参考 PPT 6.pptx 严格一致）：
 *   穿孔雷诺数  k    = d·√( ωρ / (4μ) )
 *   比声阻      R_w  = (32μt)/(σρcd²) · [ √(1 + k²/32) + (√2/32)·k·d/t ]
 *   比声抗      X_w  = (ω/(σc)) · [ t·(1 + 1/√(1 + k²/32)) + 1.7d ]
 *   复数波数    k_x² = k0²·[ 1 − j·(4/(D·k0))·(1/ζ_w) ]，ζ_w = R_w + jX_w，k0 = ω/c
 *   衰减系数    α(f) = (2/D) · R_w / (R_w² + X_w²)
 *   传递损失    TL(f)= 8.686 · α(f) · L
 *   辅助式      ω = 2πf
 *
 * 输出「总的传递损失」为频带平均值；同时绘制 TL - Frequency 曲线：
 * PPT 要求在 (f_min ~ f_max) 范围内均分 400 份分析（共 401 个采样点）。
 */

/** PPT 给定的频带均分段数（f_min ~ f_max 均分 400 份，共 401 个采样点） */
const SEGMENTS = 400;

/** Np → dB 换算系数（PPT 取 8.686） */
const DELTA_NP_DB = 8.686;

/** 单频点中间量：ω、k、R_w、X_w、α、TL（SI 输入，f = 0 视为直流，TL 记 0） */
function at(v: Record<string, number>, f: number) {
  const { D, mu, t, sigma, rho, c, d, L } = v;
  if (!(D > 0) || !(mu > 0) || !(t > 0) || !(sigma > 0) || !(rho > 0) || !(c > 0) || !(d > 0) || !(L > 0))
    return null;
  if (!(f > 0)) return { omega: 0, k: 0, Rw: 0, Xw: 0, alpha: 0, TL: 0 };

  const omega = 2 * Math.PI * f;

  // 穿孔雷诺数（无量纲）
  const k = d * Math.sqrt((omega * rho) / (4 * mu));
  const s = Math.sqrt(1 + (k * k) / 32);

  // 比声阻 R_w
  const Rw = ((32 * mu * t) / (sigma * rho * c * d * d)) * (s + (Math.SQRT2 / 32) * k * d / t);

  // 比声抗 X_w
  const Xw = (omega / (sigma * c)) * (t * (1 + 1 / s) + 1.7 * d);

  // 衰减系数 α = (2/D)·R_w/(R_w² + X_w²)
  const den = Rw * Rw + Xw * Xw;
  const alpha = den > 1e-30 ? (2 / D) * (Rw / den) : NaN;

  // 传递损失 TL = 8.686·α·L
  const TL = DELTA_NP_DB * alpha * L;
  if (!Number.isFinite(TL)) return null;
  return { omega, k, Rw, Xw, alpha, TL };
}

/** 频带 [f_min, f_max] 均分 400 份采样 TL 曲线（401 点，f = 0 处 TL 记 0） */
function sampleCurve(v: Record<string, number>): CurvePoint[] {
  const { fmin, fmax } = v;
  if (!(fmax > fmin) || !(fmin >= 0)) return [];
  const points: CurvePoint[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const f = fmin + (i * (fmax - fmin)) / SEGMENTS;
    const r = at(v, f);
    if (!r) continue;
    points.push({ x: f, y: r.TL });
  }
  return points;
}

export const wovenTubeSilencer: FormulaSpec = {
  id: 'acoustics.muffler.wovenTube',
  domain: 'acoustics',
  subsystem: '消声器',
  title: '编织管消音',
  summary: '按 PPT 公式计算编织管（穿孔微孔管）的穿孔雷诺数 k、比声阻 R_w、比声抗 X_w 与衰减系数 α，给出总的传递损失并绘制 TL - Frequency 曲线。',
  tags: ['编织管', '穿孔管', '微穿孔', '消音器', '消声器', '传递损失', 'TL', 'NVH', '进气系统', '排气系统'],
  description:
    '编织管消音器由管壁微孔的粘性耗散与质量惯性共同决定其声学性能。本公式按参考 PPT 严格一致：穿孔雷诺数 k = d√(ωρ/(4μ))，比声阻 R_w = (32μt/(σρcd²))·[√(1+k²/32) + (√2/32)·k·d/t]，比声抗 X_w = (ω/(σc))·[t·(1+1/√(1+k²/32)) + 1.7d]，衰减系数 α(f) = (2/D)·R_w/(R_w²+X_w²)，单频传递损失 TL(f) = 8.686·α(f)·L。结果区输出频带内总的传递损失（400 份平均）与 TL 峰值，并绘制 TL - Frequency 曲线（横轴 Frequency/Hz，纵轴 TL/dB，频带内均分 400 份）。',
  inputs: [
    { key: 'mu', label: '空气动力粘度', symbol: 'μ', unit: 'Pa·s', unitGroup: 'dynamicViscosity', default: 1.809e-5, min: 0, required: true, description: '空气的动力粘度，20℃ 约 1.809e-5 Pa·s' },
    { key: 't', label: '编织管厚度', symbol: 't', unit: 'm', default: 0.002, min: 0, required: true, description: '管壁（含微孔）的厚度，PPT 默认 0.002 m' },
    { key: 'sigma', label: '管壁孔隙率', symbol: 'σ', unit: '-', default: 0.1, min: 0.02, max: 0.2, required: true, description: '微孔面积占管壁总面积的比例，PPT 取值范围 0.02 ~ 0.2，默认 0.1' },
    { key: 'D', label: '编织管内径', symbol: 'D', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, required: true, description: '编织管圆筒内径，PPT 默认 60 mm' },
    { key: 'L', label: '编织管长度', symbol: 'L', unit: 'mm', unitGroup: 'length', default: 200, min: 0, required: true, description: '编织管有效长度，PPT 默认 200 mm，决定衰减量' },
    { key: 'rho', label: '空气密度', symbol: 'ρ', unit: 'kg/m³', unitGroup: 'density', default: 1.205, min: 0, required: true, description: '常温常压下空气密度，默认 1.205 kg/m³' },
    { key: 'c', label: '空气声速', symbol: 'c', unit: 'm/s', default: 343, min: 0, required: true, description: '常温常压下空气中声速，默认 343 m/s' },
    { key: 'd', label: '微孔等效直径', symbol: 'd', unit: 'm', default: 1e-4, min: 1e-4, max: 5e-4, required: true, description: '管壁微孔的等效孔径，PPT 取值范围 0.0001 ~ 0.0005 m，默认 1e-4 m' },
    { key: 'fmin', label: '频率最小值', symbol: 'f_min', unit: 'Hz', default: 0, min: 0, required: true, description: 'TL 曲线扫描下限，PPT 默认 0 Hz' },
    { key: 'fmax', label: '频率最大值', symbol: 'f_max', unit: 'Hz', default: 3000, min: 0, required: true, description: 'TL 曲线扫描上限，PPT 默认 3000 Hz，频带内均分 400 份' },
  ],
  outputs: [
    { key: 'tl_avg', label: '总的传递损失', symbol: 'TL_avg', unit: 'dB', primary: true, group: '声学特性', description: '频带 [f_min, f_max] 内 TL 曲线的平均值（均分 400 份采样分析）' },
    { key: 'tl_max', label: '最大传递损失', symbol: 'TL_max', unit: 'dB', primary: true, group: '声学特性', description: '频带内 TL 曲线的最大值（400 均分采样）' },
    { key: 'f_peak', label: '峰值频率', symbol: 'f_p', unit: 'Hz', group: '声学特性', description: 'TL 峰值对应的频率' },
    { key: 'k', label: '穿孔雷诺数（示例）', symbol: 'k', unit: '-', group: '中间量', description: 'k = d√(ωρ/(4μ))，取示例频率 f = √(f_min·f_max)（f_min = 0 时按 1 Hz 处理）处的值' },
    { key: 'Rw', label: '比声阻', symbol: 'R_w', unit: '-', group: '中间量', description: 'R_w = (32μt/(σρcd²))·[√(1+k²/32) + (√2/32)·k·d/t]，取示例频率处的值' },
    { key: 'Xw', label: '比声抗', symbol: 'X_w', unit: '-', group: '中间量', description: 'X_w = (ω/(σc))·[t·(1+1/√(1+k²/32)) + 1.7d]，取示例频率处的值' },
    { key: 'alpha', label: '衰减系数', symbol: 'α', unit: 'm⁻¹', group: '中间量', description: 'α = (2/D)·R_w/(R_w²+X_w²)，取示例频率处的值' },
    { key: 'omega', label: '角频率（示例）', symbol: 'ω', unit: 'rad/s', group: '中间量', description: 'ω = 2πf，取示例频率处的值' },
  ],
  latex: [
    {
      label: '穿孔雷诺数',
      tex: 'k = d\\sqrt{\\frac{\\omega\\rho}{4\\mu}}',
    },
    {
      label: '比声阻（主公式）',
      tex: 'R_w = \\frac{32\\mu t}{\\sigma\\rho c d^{2}}\\left[\\sqrt{1 + \\frac{k^{2}}{32}} + \\frac{\\sqrt{2}}{32}\\cdot\\frac{k\\,d}{t}\\right]',
    },
    {
      label: '比声抗（主公式）',
      tex: 'X_w = \\frac{\\omega}{\\sigma c}\\left[t\\left(1 + \\frac{1}{\\sqrt{1 + k^{2}/32}}\\right) + 1.7\\,d\\right]',
    },
    {
      label: '复数波数（参考式）',
      tex: 'k_x^{2} = k_0^{2}\\left[1 - j\\,\\frac{4}{D k_0}\\cdot\\frac{1}{\\zeta_w}\\right],\\qquad \\zeta_w = R_w + jX_w,\\qquad k_0 = \\frac{\\omega}{c}',
    },
    {
      label: '衰减系数与传递损失',
      tex: '\\alpha(f) = \\frac{2}{D}\\cdot\\frac{R_w}{R_w^{2} + X_w^{2}},\\qquad TL(f) = 8.686\\,\\alpha(f)\\,L',
    },
    {
      label: '辅助式',
      tex: '\\omega = 2\\pi f,\\qquad f \\in \\left[f_{\\min},\\,f_{\\max}\\right]\\;\\text{均分 400 份}',
    },
  ],
  diagram: WOVEN_DIAGRAM,
  sensitivity: true,
  assumptions: [
    '公式与参考 PPT 严格一致：k = d√(ωρ/(4μ))，R_w = (32μt/(σρcd²))·[√(1+k²/32) + (√2/32)·k·d/t]，X_w = (ω/(σc))·[t·(1+1/√(1+k²/32)) + 1.7d]',
    '衰减系数 α(f) = (2/D)·R_w/(R_w²+X_w²)，传递损失 TL(f) = 8.686·α(f)·L（8.686 为 Np→dB 换算系数）',
    '「总的传递损失」按 PPT 要求：在 f_min ~ f_max 范围内均分 400 份（401 个采样点）后取平均分析值',
    'PPT 参考式中的复数波数 k_x² = k0²[1 − j(4/(D·k0))(1/ζ_w)] 用于描述管内复数传播，TL 计算只用到 R_w 与 X_w',
    '管壁孔隙率 σ 取值范围 0.02 ~ 0.2（默认 0.1）；微孔等效直径 d 取值范围 0.0001 ~ 0.0005 m（默认 1e-4 m）',
    '内径 D 与长度 L 按 PPT 以 mm 输入，求解时统一换算为 SI（m）；厚度 t 与孔径 d 以 m 输入',
    'f = 0 视为直流工况，该频点 TL 记 0（不参与「总的传递损失」平均）',
    '介质参数（μ、ρ、c）默认取常温常压空气值，极端工况需按实际条件修正',
  ],
  solve(v) {
    const empty = {
      tl_avg: NaN, tl_max: NaN, f_peak: NaN, k: NaN, Rw: NaN, Xw: NaN, alpha: NaN, omega: NaN,
    };
    if (!(v.D > 0) || !(v.mu > 0) || !(v.t > 0) || !(v.sigma > 0) || !(v.rho > 0) || !(v.c > 0) || !(v.d > 0) || !(v.L > 0))
      return empty;

    // 频带采样（与曲线共用，保证峰值/均值与曲线一致）
    const pts = sampleCurve(v).filter((p) => p.x > 0 && Number.isFinite(p.y));
    let tl_max = NaN;
    let tl_avg = NaN;
    let f_peak = NaN;
    if (pts.length > 0) {
      let best = pts[0];
      let sum = 0;
      for (const p of pts) {
        sum += p.y;
        if (p.y > best.y) best = p;
      }
      tl_max = best.y;
      f_peak = best.x;
      tl_avg = sum / pts.length;
    }

    // 示例频率处的中间量（几何均值；f_min = 0 时按 1 Hz 处理）
    const fSample = Math.sqrt(Math.max(v.fmin, 1) * Math.max(v.fmax, 1));
    const r = at(v, fSample);
    return {
      tl_avg,
      tl_max,
      f_peak,
      k: r ? r.k : NaN,
      Rw: r ? r.Rw : NaN,
      Xw: r ? r.Xw : NaN,
      alpha: r ? r.alpha : NaN,
      omega: r ? r.omega : NaN,
    };
  },
  curve: {
    label: '传递损失 TL 曲线',
    xLabel: 'Frequency (Hz)',
    yLabel: 'TL (dB)',
    compute(v) {
      return sampleCurve(v);
    },
  },
  benchmarks: [
    {
      name: '默认工况（PPT 默认值：μ=1.809e-5, t=0.002m, σ=0.1, D=60mm, L=200mm, ρ=1.205, c=343, d=1e-4m, f∈[0,3000]）',
      input: {
        mu: 1.809e-5, t: 0.002, sigma: 0.1, D: 0.06, L: 0.2,
        rho: 1.205, c: 343, d: 1e-4, fmin: 0, fmax: 3000,
      },
      expect: {
        tl_avg: 17.1445,
        tl_max: 20.6657,
        f_peak: 7.5,
        omega: 344.1442,
        k: 0.239395,
        Rw: 2.805146,
        Xw: 0.0418212,
        alpha: 11.88028,
      },
      tolerance: 2e-3,
      source: '按 PPT 公式逐项核算：f = √(1×3000) = 54.77 Hz 处 k = 0.23939，R_w = 2.80515，X_w = 0.041821，α = 11.88028 1/m；频带 401 点采样 TL 均值 17.1445 dB、峰值 20.6657 dB 出现在 7.5 Hz',
    },
    {
      name: '变工况（σ=0.05, D=80mm, L=150mm, t=3mm, d=0.2mm, f∈[0,2000]）',
      input: {
        mu: 1.809e-5, t: 0.003, sigma: 0.05, D: 0.08, L: 0.15,
        rho: 1.205, c: 343, d: 2e-4, fmin: 0, fmax: 2000,
      },
      expect: {
        tl_avg: 8.1897,
        tl_max: 15.4922,
        f_peak: 5,
        omega: 280.9926,
        k: 0.432635,
        Rw: 2.109680,
        Xw: 0.103734,
        alpha: 11.821554,
      },
      tolerance: 2e-3,
      source: '按 PPT 公式核算：f = √(1×2000) = 44.72 Hz 处 k = 0.432635，R_w = 2.109680，X_w = 0.103734，α = 11.821554 1/m；频带 401 点采样 TL 均值 8.1897 dB、峰值 15.4922 dB 出现在 5 Hz',
    },
  ],
};
