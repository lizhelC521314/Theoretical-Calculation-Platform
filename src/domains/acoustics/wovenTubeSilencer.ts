import type { CurvePoint, FormulaSpec } from '../../formula/types';
import { WOVEN_DIAGRAM } from './diagrams';

/**
 * 编织管消音（Woven-Tube Silencer）
 *
 * 按参考 PPT《编织管传递损失计算公式》（依据瞿熠卿等 2018）的
 * JCA（Johnson-Champoux-Allard）等效流体模型实现：
 *   等效密度   ρeq = α∞ρ0·[1 + σfφ/(jωρ0α∞)·√(1 + j·4α∞²ηρ0ω/(σf²Λ²φ²))]   (1)
 *   等效模量   Keq = γP0/[γ − (γ−1)A]，A = [1 + σfφ/(jNprωρ0α∞)·√(1 + j·4α∞²ηρ0ωNpr/(σf²Λ′²φ²))]⁻¹ (2)
 *   特性阻抗   Zc = √(ρeq·Keq)                                               (3)
 *   波数       kc = ω·√(ρeq/Keq)                                             (4)
 *   管壁阻抗   Zw = Zc·(ZL + jZc·tan(kc·t))/(Zc + jZL·tan(kc·t))，ZL = ρ0c0   (6)
 *   归一化     ζw = Zw/(ρ0c0) = Rw + jXw                                      (7)
 *   管内波数   kx² = k0²·[1 − j·(4/(D·k0))·(1/ζw)]，k0 = ω/c0                 (8)
 *   衰减系数   α(f) = (2/D)·Rw/(Rw² + Xw²)                                    (9)
 *   传递矩阵   Td = [cos(kxL), jZd·sin(kxL); j·sin(kxL)/Zd, cos(kxL)]，Zd = ρ0c0·k0/kx (10)(11)
 *   传递损失   TL = 20lg|2cos(kxL) + j·(k0/kx + kx/k0)·sin(kxL)| / 2           (12，已化简为无量纲形式)
 *   辅助式     ω = 2πf
 *
 * 说明：PPT 式(12) 原文 Z0 = ρ0c0/S（声阻抗）与 Zd（比阻抗）量纲不一致，
 * 本实现按量纲一致性化简为上述无量纲形式，刚性壁极限（kx → k0）回归 TL = 0 dB。
 *
 * 输出「总的传递损失」为频带平均值；同时绘制 TL - Frequency 曲线：
 * PPT 要求在 (f_min ~ f_max) 范围内均分 400 份分析（共 401 个采样点）。
 */

/** PPT 给定的频带均分段数（f_min ~ f_max 均分 400 份，共 401 个采样点） */
const SEGMENTS = 400;

/* ---------- 复数运算（[实部, 虚部]） ---------- */
type C = [number, number];
const cadd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const csub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const cabs = (a: C) => Math.hypot(a[0], a[1]);
const csqrt = (a: C): C => {
  const m = cabs(a);
  return [Math.sqrt((m + a[0]) / 2), Math.sign(a[1] || 1) * Math.sqrt(Math.max((m - a[0]) / 2, 0))];
};
const ctan = (a: C): C => {
  const d = Math.cos(2 * a[0]) + Math.cosh(2 * a[1]);
  return [Math.sin(2 * a[0]) / d, Math.sinh(2 * a[1]) / d];
};
const ccos = (a: C): C => [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])];
const csin = (a: C): C => [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])];

/** 单频点中间量：ω、Rw、Xw、α、kx、TL（SI 输入，f ≤ 0 视为直流，TL 记 0） */
function at(v: Record<string, number>, f: number) {
  const { L, D, t, sigmaf, phi, ainf, Lam, Lamp, rho0, c0, gam, P0, eta, Npr } = v;
  if (!(L > 0) || !(D > 0) || !(t > 0) || !(sigmaf > 0) || !(phi > 0) || !(ainf > 0) ||
      !(Lam > 0) || !(Lamp > 0) || !(rho0 > 0) || !(c0 > 0) || !(gam > 1) || !(P0 > 0) ||
      !(eta > 0) || !(Npr > 0))
    return null;
  if (!(f > 0)) return { omega: 0, Rw: 0, Xw: 0, alpha: 0, kxRe: 0, kxIm: 0, TL: 0 };

  const omega = 2 * Math.PI * f;
  const k0 = omega / c0;
  const rho0c0 = rho0 * c0;

  // (1) 等效密度 ρeq
  const s1 = csqrt([1, (4 * ainf * ainf * eta * rho0 * omega) / (sigmaf * sigmaf * Lam * Lam * phi * phi)]);
  const t1 = cdiv([sigmaf * phi, 0], [0, omega * rho0 * ainf]);
  const rhoeq = cmul([ainf * rho0, 0], cadd([1, 0], cmul(t1, s1)));

  // (2) 等效体积模量 Keq
  const s2 = csqrt([1, (4 * ainf * ainf * eta * rho0 * omega * Npr) / (sigmaf * sigmaf * Lamp * Lamp * phi * phi)]);
  const t2 = cdiv([sigmaf * phi, 0], [0, Npr * omega * rho0 * ainf]);
  const A = cdiv([1, 0], cadd([1, 0], cmul(t2, s2)));
  const Keq = cdiv([gam * P0, 0], csub([gam, 0], cmul([gam - 1, 0], A)));

  // (3)(4) 特性阻抗 Zc 与波数 kc
  const Zc = csqrt(cmul(rhoeq, Keq));
  const kc = cmul([omega, 0], csqrt(cdiv(rhoeq, Keq)));

  // (6) 管壁输入阻抗 Zw（外层 ZL = ρ0c0）
  const ZL: C = [rho0c0, 0];
  const th = ctan(cmul(kc, [t, 0]));
  const Zw = cdiv(
    cmul(Zc, cadd(ZL, cmul([0, 1], cmul(Zc, th)))),
    cadd(Zc, cmul([0, 1], cmul(ZL, th))),
  );

  // (7) 归一化阻抗 ζw = Rw + jXw
  const zeta = cdiv(Zw, [rho0c0, 0]);
  const Rw = zeta[0];
  const Xw = zeta[1];

  // (8) 管内复数波数 kx
  const kx2 = cmul([k0 * k0, 0], csub([1, 0], cmul([0, 1], cmul([4 / (D * k0), 0], cdiv([1, 0], zeta)))));
  const kx = csqrt(kx2);

  // (9) 衰减系数 α
  const den = Rw * Rw + Xw * Xw;
  const alpha = den > 1e-30 ? (2 / D) * (Rw / den) : NaN;

  // (10)(11)(12) 传递矩阵法 TL（化简为无量纲形式）
  const kxL = cmul(kx, [L, 0]);
  const r1 = cdiv([k0, 0], kx);
  const r2 = cdiv(kx, [k0, 0]);
  const sum = cadd(cmul([2, 0], ccos(kxL)), cmul(cmul([0, 1], cadd(r1, r2)), csin(kxL)));
  const TL = 20 * Math.log10(cabs(sum) / 2);

  if (!Number.isFinite(TL)) return null;
  return { omega, Rw, Xw, alpha, kxRe: kx[0], kxIm: kx[1], TL };
}

/** 频带 [f_min, f_max] 均分 400 份采样 TL 曲线（401 点，f ≤ 0 处 TL 记 0） */
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
  version: '1.0.0',
  status: 'published',
  domain: 'acoustics',
  subsystem: '消声器',
  title: '★编织管消音器',
  summary: '按 PPT 的 JCA 等效流体模型计算编织管的等效密度/模量、管壁阻抗 ζw = Rw + jXw、管内复数波数 kx 与衰减系数 α，由传递矩阵法给出传递损失并绘制 TL - Frequency 曲线。★ 公式验证不充分，结果仅供参考。',
  tags: ['编织管', 'JCA', '等效流体', '消音器', '消声器', '传递损失', 'TL', 'NVH', '进气系统', '排气系统'],
  description:
    '编织管消音器将编织丝网管壁等效为 JCA（Johnson-Champoux-Allard）流体层：先由式(1)(2)求等效密度 ρeq 与等效体积模量 Keq，再由式(3)(4)得特性阻抗 Zc 与波数 kc；管壁输入阻抗 Zw 由式(6)（外层空气负载 ZL = ρ0c0）给出，归一化得 ζw = Rw + jXw；管内复数波数 kx 由式(8)给出，最终由传递矩阵法式(12)化简式 TL = 20lg|2cos(kxL) + j(k0/kx + kx/k0)sin(kxL)|/2 求单频传递损失。结果区输出频带内总的传递损失（400 份平均）与 TL 峰值，并绘制 TL - Frequency 曲线（横轴 Frequency/Hz，纵轴 TL/dB，频带内均分 400 份）。',
  inputs: [
    { key: 'L', label: '编织管长度', symbol: 'L', unit: 'mm', unitGroup: 'length', default: 145, min: 0, required: true, description: '编织管有效长度，建议取值 145 mm，决定衰减量与管长共振频率' },
    { key: 'D', label: '编织管内径', symbol: 'D', unit: 'mm', unitGroup: 'diameter', default: 49.36, min: 0, required: true, description: '编织管圆筒内径，建议取值 49.36 mm' },
    { key: 't', label: '编织管壁厚', symbol: 't', unit: 'm', default: 0.0027, min: 0, required: true, description: '编织丝网管壁（等效流体层）的厚度，建议取值 0.0027 m' },
    { key: 'sigmaf', label: '流阻率', symbol: 'σf', unit: 'Pa·s/m²', default: 2.4e5, min: 0, required: true, description: '编织管壁的静态流阻率，建议取值 2.4×10⁵ Pa·s/m²' },
    { key: 'phi', label: '孔隙率', symbol: 'φ', unit: '-', default: 0.35, min: 0, max: 1, required: true, description: '管壁开孔体积占比，建议取值 0.35' },
    { key: 'ainf', label: '曲折度', symbol: 'α∞', unit: '-', default: 2.5, min: 1, required: true, description: '高频极限下的曲折度（结构因子），建议取值 2.5' },
    { key: 'Lam', label: '粘性特征长度', symbol: 'Λ', unit: 'm', default: 2.7e-5, min: 0, required: true, description: 'JCA 模型粘性特征长度，建议取值 2.7×10⁻⁵ m' },
    { key: 'Lamp', label: '热特征长度', symbol: "Λ'", unit: 'm', default: 5.4e-5, min: 0, required: true, description: 'JCA 模型热特征长度，建议取值 5.4×10⁻⁵ m' },
    { key: 'rho0', label: '空气密度', symbol: 'ρ0', unit: 'kg/m³', unitGroup: 'density', default: 1.205, min: 0, required: true, description: '常温常压下空气密度，建议取值 1.205 kg/m³' },
    { key: 'c0', label: '空气声速', symbol: 'c0', unit: 'm/s', default: 343, min: 0, required: true, description: '常温常压下空气中声速，建议取值 343 m/s' },
    { key: 'gam', label: '比热比', symbol: 'γ', unit: '-', default: 1.4, min: 1, required: true, description: '空气定压定容比热比，建议取值 1.4' },
    { key: 'P0', label: '大气静压', symbol: 'P0', unit: 'Pa', unitGroup: 'pressure', default: 101325, min: 0, required: true, description: '环境静压，建议取值 101325 Pa' },
    { key: 'eta', label: '空气动力粘度', symbol: 'η', unit: 'Pa·s', unitGroup: 'dynamicViscosity', default: 1.809e-5, min: 0, required: true, description: '空气的动力粘度，20℃ 约 1.809e-5 Pa·s' },
    { key: 'Npr', label: '普朗特数', symbol: 'Npr', unit: '-', default: 0.71, min: 0, required: true, description: '空气普朗特数，建议取值 0.71' },
    { key: 'fmin', label: '频率最小值', symbol: 'f_min', unit: 'Hz', default: 20, min: 0, required: true, description: 'TL 曲线扫描下限，建议取值 20 Hz' },
    { key: 'fmax', label: '频率最大值', symbol: 'f_max', unit: 'Hz', default: 2000, min: 0, required: true, description: 'TL 曲线扫描上限，建议取值 2000 Hz，频带内均分 400 份' },
  ],
  outputs: [
    { key: 'tl_avg', label: '总的传递损失', symbol: 'TL_avg', unit: 'dB', primary: true, group: '声学特性', description: '频带 [f_min, f_max] 内 TL 曲线的平均值（均分 400 份采样分析）' },
    { key: 'tl_max', label: '最大传递损失', symbol: 'TL_max', unit: 'dB', primary: true, group: '声学特性', description: '频带内 TL 曲线的最大值（400 均分采样）' },
    { key: 'f_peak', label: '峰值频率', symbol: 'f_p', unit: 'Hz', group: '声学特性', description: 'TL 峰值对应的频率' },
    { key: 'Rw', label: '归一化声阻', symbol: 'R_w', unit: '-', group: '中间量', description: 'ζw 实部，由式(1)~(7) JCA 等效流体模型与管壁输入阻抗求得，取示例频率处的值' },
    { key: 'Xw', label: '归一化声抗', symbol: 'X_w', unit: '-', group: '中间量', description: 'ζw 虚部，取示例频率处的值' },
    { key: 'alpha', label: '衰减系数', symbol: 'α', unit: 'm⁻¹', group: '中间量', description: 'α = (2/D)·Rw/(Rw²+Xw²)，取示例频率处的值' },
    { key: 'kxRe', label: '管内波数实部', symbol: 'Re(k_x)', unit: 'rad/m', group: '中间量', description: '式(8) 复数波数 kx 的实部（相位常数），取示例频率处的值' },
    { key: 'kxIm', label: '管内波数虚部', symbol: 'Im(k_x)', unit: 'rad/m', group: '中间量', description: '式(8) 复数波数 kx 的虚部（衰减常数），取示例频率处的值' },
    { key: 'omega', label: '角频率（示例）', symbol: 'ω', unit: 'rad/s', group: '中间量', description: 'ω = 2πf，取示例频率 f = √(f_min·f_max)（f_min = 0 时按 1 Hz 处理）处的值' },
  ],
  latex: [
    {
      label: '等效密度（式1）',
      tex: '\\rho_{eq} = \\alpha_\\infty\\rho_0\\left[1 + \\frac{\\sigma_f\\phi}{j\\omega\\rho_0\\alpha_\\infty}\\sqrt{1 + j\\,\\frac{4\\alpha_\\infty^{2}\\eta\\rho_0\\omega}{\\sigma_f^{2}\\Lambda^{2}\\phi^{2}}}\\right]',
    },
    {
      label: '等效体积模量（式2）',
      tex: 'K_{eq} = \\frac{\\gamma P_0}{\\gamma - (\\gamma-1)A},\\quad A = \\left[1 + \\frac{\\sigma_f\\phi}{jN_{pr}\\omega\\rho_0\\alpha_\\infty}\\sqrt{1 + j\\,\\frac{4\\alpha_\\infty^{2}\\eta\\rho_0\\omega N_{pr}}{\\sigma_f^{2}\\Lambda\'^{2}\\phi^{2}}}\\right]^{-1}',
    },
    {
      label: '特性阻抗与波数（式3、4）',
      tex: 'Z_c = \\sqrt{\\rho_{eq} K_{eq}},\\qquad k_c = \\omega\\sqrt{\\frac{\\rho_{eq}}{K_{eq}}}',
    },
    {
      label: '管壁输入阻抗（式6、7）',
      tex: 'Z_w = Z_c\\,\\frac{Z_L + jZ_c\\tan(k_c t)}{Z_c + jZ_L\\tan(k_c t)},\\qquad \\zeta_w = \\frac{Z_w}{\\rho_0 c_0} = R_w + jX_w,\\qquad Z_L = \\rho_0 c_0',
    },
    {
      label: '管内复数波数（式8）',
      tex: 'k_x^{2} = k_0^{2}\\left[1 - j\\,\\frac{4}{D k_0}\\cdot\\frac{1}{\\zeta_w}\\right],\\qquad k_0 = \\frac{\\omega}{c_0}',
    },
    {
      label: '衰减系数（式9）',
      tex: '\\alpha(f) = \\frac{2}{D}\\cdot\\frac{R_w}{R_w^{2} + X_w^{2}}',
    },
    {
      label: '传递损失（式10~12，化简式）',
      tex: 'TL = 20\\lg\\frac{\\left|\\,2\\cos(k_x L) + j\\left(\\dfrac{k_0}{k_x} + \\dfrac{k_x}{k_0}\\right)\\sin(k_x L)\\,\\right|}{2}',
    },
    {
      label: '辅助式',
      tex: '\\omega = 2\\pi f,\\qquad f \\in \\left[f_{\\min},\\,f_{\\max}\\right]\\;\\text{均分 400 份}',
    },
  ],
  diagram: WOVEN_DIAGRAM,
  sensitivity: true,
  assumptions: [
    '★ 标记说明：该公式验证不充分——按参考 PPT（依据瞿熠卿等 2018）的 JCA 等效流体模型实现，默认取值下 580 Hz 附近 TL ≈ 19.8 dB 与论文 20 dB 吻合，但频带平均 TL（约 22.3 dB）高于论文给出的 16.4 dB，且未复现论文 580 Hz 局部峰形态，计算结果仅供参考，工程应用前须结合实际测试数据验证',
    '模型链路与 PPT 式(1)~(12) 严格一致：JCA 等效密度/模量 → 特性阻抗 Zc 与波数 kc → 管壁输入阻抗 Zw（外层空气负载 ZL = ρ0c0）→ 归一化阻抗 ζw = Rw + jXw → 管内复数波数 kx → 传递矩阵法 TL',
    'PPT 式(12) 原文 Z0 = ρ0c0/S（声阻抗）与传递矩阵元 Zd = ρ0c0·k0/kx（比阻抗）量纲不一致，本实现按量纲一致性化简为无量纲形式 TL = 20lg|2cos(kxL) + j(k0/kx + kx/k0)sin(kxL)|/2，刚性壁极限（kx → k0）回归 TL = 0 dB',
    'PPT 式(13) TL ≈ 8.686·α·L 为消声端近似式，本实现未采用（近似式在全频带显著高估 TL），仅列出式(9) 衰减系数 α 供参考',
    '「总的传递损失」按 PPT 要求：在 f_min ~ f_max 范围内均分 400 份（401 个采样点）后取平均分析值',
    'PPT 参数表中的温度 T 与马赫数 M 未在所给公式中出现，本实现不包含该两项输入；介质参数（ρ0、c0、γ、P0、η、Npr）默认取常温常压空气值，极端工况需按实际条件修正',
    '输入默认值建议取值：L = 145 mm、D = 49.36 mm、t = 0.0027 m、σf = 2.4×10⁵ Pa·s/m²、φ = 0.35、α∞ = 2.5、Λ = 2.7×10⁻⁵ m、Λ′ = 5.4×10⁻⁵ m，频带默认 20 ~ 2000 Hz',
    '长度 L 与内径 D 以 mm 输入，求解时统一换算为 SI（m）；壁厚 t、特征长度 Λ/Λ′ 以 m 输入',
    'f ≤ 0 视为直流工况，该频点 TL 记 0（不参与「总的传递损失」平均）',
  ],
  solve(v) {
    const empty = {
      tl_avg: NaN, tl_max: NaN, f_peak: NaN, Rw: NaN, Xw: NaN, alpha: NaN, kxRe: NaN, kxIm: NaN, omega: NaN,
    };
    if (!(v.L > 0) || !(v.D > 0) || !(v.t > 0) || !(v.sigmaf > 0) || !(v.phi > 0) || !(v.ainf > 0) ||
        !(v.Lam > 0) || !(v.Lamp > 0) || !(v.rho0 > 0) || !(v.c0 > 0) || !(v.gam > 1) || !(v.P0 > 0) ||
        !(v.eta > 0) || !(v.Npr > 0))
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
      Rw: r ? r.Rw : NaN,
      Xw: r ? r.Xw : NaN,
      alpha: r ? r.alpha : NaN,
      kxRe: r ? r.kxRe : NaN,
      kxIm: r ? r.kxIm : NaN,
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
      name: '默认工况（建议取值：L=145mm, D=49.36mm, t=0.0027m, σf=2.4e5, φ=0.35, α∞=2.5, Λ=2.7e-5m, Λ′=5.4e-5m, f∈[20,2000]）',
      input: {
        L: 0.145, D: 0.04936, t: 0.0027, sigmaf: 2.4e5, phi: 0.35, ainf: 2.5,
        Lam: 2.7e-5, Lamp: 5.4e-5, rho0: 1.205, c0: 343, gam: 1.4, P0: 101325,
        eta: 1.809e-5, Npr: 0.71, fmin: 20, fmax: 2000,
      },
      expect: {
        tl_avg: 22.324646,
        tl_max: 27.161640,
        f_peak: 2000,
        omega: 1256.637061,
        Rw: 1.550517,
        Xw: 0.038334,
        alpha: 26.116380,
        kxRe: 10.006296,
        kxIm: -9.562146,
      },
      tolerance: 2e-3,
      source: '按 PPT 式(1)~(12) 逐项核算：示例频率 f = √(20×2000) = 200 Hz 处 Rw = 1.55052，Xw = 0.038334，α = 26.11638 1/m，kx = 10.0063 − j9.5621 rad/m；频带 401 点采样 TL 均值 22.3246 dB、峰值 27.1616 dB 出现在 2000 Hz（580 Hz 附近 TL ≈ 19.8 dB，与论文 20 dB 吻合；频带均值高于论文给出的 16.4 dB，见假设说明）',
    },
    {
      name: '变工况（L=200mm, D=60mm, t=3mm, σf=1.5e5, φ=0.45, α∞=2.0, Λ=3.5e-5m, Λ′=7e-5m, f∈[0,3000]）',
      input: {
        L: 0.2, D: 0.06, t: 0.003, sigmaf: 1.5e5, phi: 0.45, ainf: 2.0,
        Lam: 3.5e-5, Lamp: 7e-5, rho0: 1.205, c0: 343, gam: 1.4, P0: 101325,
        eta: 1.809e-5, Npr: 0.71, fmin: 0, fmax: 3000,
      },
      expect: {
        tl_avg: 29.729336,
        tl_max: 34.839319,
        f_peak: 2880,
        omega: 344.144233,
        Rw: 1.489984,
        Xw: 0.004676,
        alpha: 22.371391,
        kxRe: 4.783628,
        kxIm: -4.692259,
      },
      tolerance: 2e-3,
      source: '按 PPT 式(1)~(12) 核算：示例频率 f = √(1×3000) = 54.77 Hz 处 Rw = 1.48998，Xw = 0.004676，α = 22.37139 1/m，kx = 4.78363 − j4.69226 rad/m；频带 401 点采样（f = 0 点 TL 记 0 不参与平均）TL 均值 29.7293 dB、峰值 34.8393 dB 出现在 2880 Hz',
    },
  ],
};
