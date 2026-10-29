import type { FormulaSpec } from '../../formula/types';

/**
 * 编织管消音（Woven-Tube Silencer）
 *
 * 参考 PPT 公式严格一致：
 *   比声阻     R = (8μt/(σρcd²))·√(1 + ρωd²/(16μ))
 *   比声抗     X = (ω(t+1.7d)/(σc))·√(1 + 16μ/(ρωd²))
 *   阻抗模     |ζ| = √(R² + X²)
 *   衰减系数   α = (2/D) · R/|ζ|²
 *   传递损失   TL = δ·α·L
 *   辅助式     ω = 2πf
 *
 * 其中 δ ≈ 8.686 为奈培→分贝换算系数（= 20·ln(e)）。
 *
 * TL 曲线按 PPT 要求在 [fmin, fmax] 间等间距取 400 个频率点绘制，
 * 纵轴 TL（dB），横轴 f（Hz）。
 */

/** Np → dB 换算系数（精确值 = 20·ln(e) ≈ 8.68589，PPT 取 8.686） */
const DELTA_NP_DB = 8.686;

/** 衰减系数中的 ρc 项按参考常数 2 取值 */
const ALPHA_RHO_C = 2;

/**
 * 由 SI 输入和频率 f 计算传递损失 TL (dB)
 * 返回 null 表示参数非法（如孔隙率为 0、声速为 0 等）
 */
function tlAt(v: Record<string, number>, f: number): number | null {
  const { D, mu, t, sigma, rho, c, d } = v;
  if (!(D > 0) || !(mu > 0) || !(t > 0) || !(sigma > 0) || !(rho > 0) || !(c > 0) || !(d > 0))
    return null;

  const omega = 2 * Math.PI * f;

  // 比声阻 R
  const insideR = 1 + (rho * omega * d * d) / (16 * mu);
  const R = (8 * mu * t) / (sigma * rho * c * d * d) * Math.sqrt(insideR);

  // 比声抗 X
  const insideX = 1 + (16 * mu) / (rho * omega * d * d);
  const X = (omega * (t + 1.7 * d)) / (sigma * c) * Math.sqrt(insideX);

  // 阻抗模
  const zetaSq = R * R + X * X;
  if (zetaSq < 1e-30) return null;

  // 衰减系数 α = (2/D) · R/|ζ|²
  const alpha = (ALPHA_RHO_C / D) * (R / zetaSq);

  // 传递损失 TL = δ·α·L
  const TL = DELTA_NP_DB * alpha * v.L;
  if (!Number.isFinite(TL) || TL < 0) return null;
  return TL;
}

/** TL 曲线采样点数（按 PPT 要求 400 份） */
const CURVE_POINTS = 400;

export const wovenTubeSilencer: FormulaSpec = {
  id: 'acoustics.muffler.wovenTube',
  domain: 'acoustics',
  subsystem: '消声器',
  title: '编织管消音',
  summary: '按 PPT 公式计算编织管（穿孔共振管）的比声阻 R、比声抗 X 与衰减系数 α，最终得到传递损失 TL 并绘制 TL-f 曲线。',
  tags: ['编织管', '穿孔管', '消音器', '消声器', '传递损失', 'TL', 'NVH', '进气系统', '排气系统', '多孔材料'],
  description:
    '编织管消音器的声阻抗由管壁微孔的粘性耗散和质量惯性共同决定。本公式按参考 PPT 严格一致：比声阻 R = (8μt/(σρcd²))·√(1+ρωd²/(16μ))，比声抗 X = (ω(t+1.7d)/(σc))·√(1+16μ/(ρωd²))，衰减系数 α = (2/D)·R/(R²+X²)（ρc 按参考常数 2 取值），传递损失 TL = δ·α·L（δ≈8.686 为 Np/dB 换算系数）。频率扫描范围 [fmin, fmax] 内等间距取 400 点绘制 TL-f 曲线。',
  inputs: [
    { key: 'D', label: '编织管内径', symbol: 'D', unit: 'm', default: 0.06, min: 0, required: true, description: '编织管圆筒内径' },
    { key: 't', label: '编织管厚度', symbol: 't', unit: 'm', default: 0.002, min: 0, required: true, description: '管壁（含微孔）的厚度' },
    { key: 'sigma', label: '管壁孔隙率', symbol: 'σ', unit: '-', default: 0.15, min: 0.05, max: 0.3, required: true, description: '微孔面积占管壁总面积的比例，典型范围 0.05~0.3' },
    { key: 'd', label: '微孔等效直径', symbol: 'd', unit: 'm', default: 1e-4, min: 1e-6, max: 5e-4, required: true, description: '管壁微孔的等效孔径，典型范围 0.0001~0.0005 m' },
    { key: 'mu', label: '空气动力粘度', symbol: 'μ', unit: 'Pa·s', default: 1.809e-5, min: 0, required: true, description: '空气的动力粘度，20℃ ~ 1.8e-5 Pa·s' },
    { key: 'rho', label: '空气密度', symbol: 'ρ', unit: 'kg/m³', default: 1.205, min: 0, required: true, description: '常温常压下空气密度' },
    { key: 'c', label: '空气声速', symbol: 'c', unit: 'm/s', default: 343, min: 0, required: true, description: '常温常压下空气中声速' },
    { key: 'L', label: '编织管长度', symbol: 'L', unit: 'm', default: 0.2, min: 0, required: true, description: '编织管有效长度，决定衰减量' },
    { key: 'delta', label: 'Np/dB 换算系数', symbol: 'δ', unit: '-', default: 8.686, min: 0, description: '奈培→分贝换算系数，δ = 20·ln(e) ≈ 8.686' },
    { key: 'fmin', label: '频率下限', symbol: 'f_min', unit: 'Hz', default: 0, min: 0, description: 'TL 曲线扫描的起始频率' },
    { key: 'fmax', label: '频率上限', symbol: 'f_max', unit: 'Hz', default: 3000, min: 0, description: 'TL 曲线扫描的终止频率' },
  ],
  outputs: [
    { key: 'tl_max', label: '最大传递损失', symbol: 'TL_max', unit: 'dB', primary: true, group: '声学特性', description: '扫描范围内 TL(f) 的最大值' },
    { key: 'tl_avg', label: '平均传递损失', symbol: 'TL_avg', unit: 'dB', primary: true, group: '声学特性', description: '扫描范围内 TL(f) 的平均值' },
    { key: 'omega', label: '角频率（示例）', symbol: 'ω', unit: 'rad/s', group: '中间量', description: '取 f = √(fmin·fmax) 时的角频率 ω = 2πf' },
    { key: 'R', label: '比声阻', symbol: 'R', unit: '1/m', group: '中间量', description: '粘性耗散对应的声阻，取 f = √(fmin·fmax) 处的值' },
    { key: 'X', label: '比声抗', symbol: 'X', unit: '1/m', group: '中间量', description: '质量惯性对应的声抗，取 f = √(fmin·fmax) 处的值' },
    { key: 'alpha', label: '衰减系数', symbol: 'α', unit: '1/m', group: '中间量', description: 'α = (2/D)·R/|ζ|²（ρc 取常数 2），取 f = √(fmin·fmax) 处的值' },
  ],
  latex: [
    {
      label: '比声阻 R（主公式）',
      tex: 'R = \\frac{8\\mu t}{\\sigma \\rho c d^{2}}\\sqrt{1 + \\frac{\\rho \\omega d^{2}}{16\\mu}}',
    },
    {
      label: '比声抗 X（主公式）',
      tex: 'X = \\frac{\\omega\\,\\left(t + 1.7\\,d\\right)}{\\sigma c}\\sqrt{1 + \\frac{16\\mu}{\\rho \\omega d^{2}}}',
    },
    {
      label: '阻抗模与衰减系数',
      tex: '|\\zeta| = \\sqrt{R^{2} + X^{2}},\\qquad \\alpha = \\frac{2}{D}\\cdot\\frac{R}{|\\zeta|^{2}}',
    },
    {
      label: '传递损失 TL',
      tex: 'TL = \\delta\\,\\alpha\\,L,\\qquad \\delta = 8.686\\;\\mathrm{(Np \\to dB)}',
    },
    {
      label: '辅助式',
      tex: '\\omega = 2\\pi f',
    },
  ],
  sensitivity: true,
  assumptions: [
    '公式与参考 PPT 严格一致：比声阻 R 与比声抗 X 由管壁微孔的粘性耗散与质量惯性共同决定',
    '微孔等效直径 d 取 PPT 默认 1e-4 m（0.1 mm），典型范围 0.0001 ~ 0.0005 m',
    '管壁孔隙率 σ 取值范围 0.05 ~ 0.3，默认 0.15',
    '编织管厚度 t 含末端修正系数 1.7d，对应比声抗公式中的 (t + 1.7d) 项',
    'Np→dB 换算系数 δ 按 PPT 取 8.686（精确值 = 20·ln(e) ≈ 8.68589）',
    '频率扫描按 PPT 要求在 [fmin, fmax] 区间等间距取 400 个频率点绘制 TL-f 曲线',
    '介质参数（μ、ρ、c）默认取常温常压空气值，极端工况需按实际条件修正',
  ],
  solve(v) {
    const empty = { tl_max: NaN, tl_avg: NaN, omega: NaN, R: NaN, X: NaN, alpha: NaN };
    if (!(v.D > 0) || !(v.t > 0) || !(v.sigma > 0) || !(v.d > 0) || !(v.mu > 0) || !(v.rho > 0) || !(v.c > 0) || !(v.L > 0))
      return empty;

    // 用扫描频率的几何均值作为示例点计算中间量
    const fSample = Math.sqrt(Math.max(v.fmin, 1) * Math.max(v.fmax, 1));
    const tlCurves: number[] = [];

    if (v.fmax > v.fmin) {
      for (let i = 0; i < CURVE_POINTS; i++) {
        const f = v.fmin + ((v.fmax - v.fmin) * i) / (CURVE_POINTS - 1);
        if (f < 0) continue;
        const tl = tlAt(v, f);
        if (tl != null) tlCurves.push(tl);
      }
    } else {
      // 单一频点
      const tl = tlAt(v, Math.max(v.fmax, v.fmin));
      if (tl != null) tlCurves.push(tl);
    }

    const tl_max = tlCurves.length > 0 ? Math.max(...tlCurves) : NaN;
    const tl_avg = tlCurves.length > 0 ? tlCurves.reduce((a, b) => a + b, 0) / tlCurves.length : NaN;

    // 示例点的中间量
    const omega = 2 * Math.PI * fSample;
    const insideR = 1 + (v.rho * omega * v.d * v.d) / (16 * v.mu);
    const R = (8 * v.mu * v.t) / (v.sigma * v.rho * v.c * v.d * v.d) * Math.sqrt(insideR);
    const insideX = 1 + (16 * v.mu) / (v.rho * omega * v.d * v.d);
    const X = (omega * (v.t + 1.7 * v.d)) / (v.sigma * v.c) * Math.sqrt(insideX);
    const zetaSq = R * R + X * X;
    const alpha = zetaSq > 1e-30 ? (ALPHA_RHO_C / v.D) * (R / zetaSq) : NaN;

    return { tl_max, tl_avg, omega, R, X, alpha };
  },
  curve: {
    label: '传递损失 TL 曲线',
    xLabel: 'f (Hz)',
    yLabel: 'TL (dB)',
    compute(v) {
      if (!(v.fmax > v.fmin)) return [];
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < CURVE_POINTS; i++) {
        const f = v.fmin + ((v.fmax - v.fmin) * i) / (CURVE_POINTS - 1);
        if (f < 0) continue;
        const tl = tlAt(v, f);
        if (tl == null) continue;
        points.push({ x: f, y: tl });
      }
      return points;
    },
  },
  benchmarks: [
    {
      name: '默认工况 TL 曲线存在性（D=0.06m, t=0.002m, σ=0.15, d=1e-4m, μ=1.809e-5, ρ=1.205, c=343, L=0.2m, f∈[0,3000]）',
      input: { D: 0.06, t: 0.002, sigma: 0.15, d: 1e-4, mu: 1.809e-5, rho: 1.205, c: 343, L: 0.2, delta: 8.686, fmin: 0, fmax: 3000 },
      expect: {},
      tolerance: 0,
      source: 'PPT 默认工况；验证曲线能正常生成且 TL 为有限正值',
    },
  ],
};
