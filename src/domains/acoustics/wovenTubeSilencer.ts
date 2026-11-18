import type { CurvePoint, FormulaSpec } from '../../formula/types';
import { WOVEN_DIAGRAM } from './diagrams';

/**
 * 编织管消音（Woven-Tube Silencer）—— v3 孔隙度壁面模型 + 并联泄漏项
 *
 * 依据：
 *   ① 参考 PPT《编织管传递损失计算公式》（瞿熠卿等 2018）的传递矩阵链路；
 *   ② 新增孔隙度定义式（4.1）；
 *   ③ 实测数据 test1.xlsx（内径 50 mm、长度 300 mm、壁厚 2.7 mm、孔隙度 f_p = 1400 Hz）。
 *
 * 式(4.1) 孔隙度
 *   f_p = γP0/(2π V Z) = γP0/(2π) · 1/(2π r_i² L · ΔP/Q)
 *   γ 比热比、P0 环境压力、V 管内体积、L 管长、r_i 管内半径、
 *   ΔP 编织管入口相对环境压力的有效压降、Q 透过管壁的体积流量。
 *   由该式反解壁面静流阻 Z = γP0/(2π V f_p)，再折算为单位管壁面积的声阻：
 *     R_a = Z·2πr_iL = γP0/(2π r_i f_p)          [Pa·s/m]
 *
 * 壁面归一化阻抗（阻性 + 声质量）
 *   ζw = Zw/(ρ0c0) = R_w·(1 + j·f/f_c)，f_c = f_p
 *   R_w = C_R·γP0/(2π r_i f_p ρ0c0)
 *   C_R 为按实测样件标定的无量纲系数（见 assumptions）。
 *   f_c 直接取孔隙度 f_p：孔隙度即壁面声抗与声阻相等的特征频率，
 *   ζw = R_w(1 + j·f/f_p) 无需额外频率系数。
 *
 * 管内复数波数、衰减系数与壁面路径传递损失（PPT 式 8~12）
 *   kx² = k0²[1 − j·4/(D·k0)·(1/ζw)]，k0 = ω/c0
 *   α(f) = (2/D)·R_w/(R_w² + X_w²)
 *   TL_w = 20lg|2cos(kxL) + j(k0/kx + kx/k0)sin(kxL)|/2
 *
 * 并联泄漏路径（v3 新增，经验项）
 *   TL_L(f) = A_L + B_L·lg(f/1000)                （A_L = 30.495 dB，B_L = −26.365 dB/decade）
 *   TL = −10lg( 10^(−TL_w/10) + 10^(−TL_L/10) )
 *   壁面路径之外还存在非壁面传声通道（测试系统侧向传声、管端辐射、夹具泄漏等），
 *   其等效传递损失随频率下降；两路并联后总传递损失由较小者主导。
 *   该项为按实测标定的经验修正，不代表编织管本体吸声机理。
 *
 * 等效能流阻率（对照用）
 *   σ_f = γP0/(2π r_i t f_p)
 *   f_p = 1400 Hz、D = 50 mm、t = 2.7 mm 时 σ_f ≈ 2.39×10⁵ Pa·s/m²，
 *   与 PPT/论文标定值 2.4×10⁵ Pa·s/m² 一致。
 *
 * 输出「总的传递损失」为频带平均值（f_min ~ f_max 均分 400 份，共 401 个采样点）。
 */

/** 频带均分段数（f_min ~ f_max 均分 400 份，共 401 个采样点） */
const SEGMENTS = 400;

/**
 * 实测标定系数（test1.xlsx：D = 50 mm、L = 300 mm、t = 2.7 mm、f_p = 1400 Hz，20~5000 Hz）：
 *   C_R   = 0.4210012 —— 壁面声阻标定（理论值 R_w0 = γP0/(2π r_i f_p ρ0c0) = 1.5607 → 标定后 0.6571）
 *   f_c   = f_p       —— 壁面特征频率直接取孔隙度（C_F = 1）
 *   A_LEAK = 30.4643 dB @ 1 kHz、B_LEAK = −26.131 dB/decade —— 并联泄漏路径
 * 标定后逐点（1.5625 Hz）20~5000 Hz：RMSE = 2.29 dB、MAE = 1.77 dB、平均偏差 −0.68 dB；
 * 其中 20~1400 Hz RMSE 2.56 dB、1400~5000 Hz RMSE 2.18 dB；1/3 倍频程 24 个频带 RMSE 2.27 dB。
 */
const CAL_R = 0.4210012;
const LEAK_A = 30.4643;
const LEAK_B = -26.131;
const LEAK_REF = 1000;

/** 可注入的标定系数（供 AI 公式优化模块辨识，缺省用上式标定值） */
export interface WovenTubeCalib {
  /** 壁面声阻系数 C_R */
  CR: number;
  /** 并联泄漏项基准 A_L（dB@1kHz） */
  AL: number;
  /** 并联泄漏项斜率 B_L（dB/decade） */
  BL: number;
  /** M1：有效长度修正 ε_L（无量纲）。缺省 0 表示与原始样件一致 */
  epsilonL?: number;
  /** M2：高频泄漏饱和补偿上限 a_HF（dB）。缺省 0 表示不启用饱和修正 */
  aHF?: number;
  /** M2：高频饱和特征频率 f_s（Hz）。缺省 0 表示不启用饱和修正 */
  fS?: number;
}

export const WOVEN_TUBE_DEFAULT_CALIB: WovenTubeCalib = {
  CR: CAL_R, AL: LEAK_A, BL: LEAK_B, epsilonL: 0, aHF: 0, fS: 0,
};

/** 已发布的标定系数（AI 公式优化「发布」后注入；null 表示沿用内置默认值） */
let activeCalib: WovenTubeCalib | null = null;

export function setActiveWovenTubeCalib(calib: WovenTubeCalib | null): void {
  activeCalib = calib;
}

export function getActiveWovenTubeCalib(): WovenTubeCalib {
  return activeCalib ?? WOVEN_TUBE_DEFAULT_CALIB;
}

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
const ccos = (a: C): C => [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])];
const csin = (a: C): C => [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])];

/** 单频点中间量：ω、Rw、Xw、α、kx、TL（SI 输入，f ≤ 0 视为直流，TL 记 0） */
function at(v: Record<string, number>, f: number, calib: WovenTubeCalib = getActiveWovenTubeCalib()) {
  const { L, D, t, fp, rho0, c0, gam, P0 } = v;
  if (!(L > 0) || !(D > 0) || !(t > 0) || !(fp > 0) || !(rho0 > 0) || !(c0 > 0) ||
      !(gam > 1) || !(P0 > 0))
    return null;

  // M1：有效长度修正 Leff = L·(1 + ε_L)；ε_L 缺省 0 即原始样件长度
  const eps = calib.epsilonL ?? 0;
  const Leff = L * (1 + eps);
  if (!(Leff > 0)) return null;

  const r = D / 2;
  const rho0c0 = rho0 * c0;
  // 式(4.1) → 壁面单位面积声阻（归一化），特征频率直接取孔隙度
  const rw0 = (gam * P0) / (2 * Math.PI * r * fp * rho0c0);
  const Rw = calib.CR * rw0;
  const fc = fp;
  // 对照量：等效流阻率
  const sigmaf = (gam * P0) / (2 * Math.PI * r * t * fp);

  if (!(f > 0)) {
    return { omega: 0, Rw, Xw: 0, alpha: 0, kxRe: 0, kxIm: 0, TL: 0, tlWall: 0, tlLeak: 0, sigmaf, fc };
  }

  const omega = 2 * Math.PI * f;
  const k0 = omega / c0;

  // 壁面归一化阻抗 ζw = Rw + jXw（阻性 + 声质量）
  const Xw = Rw * (f / fc);
  const zeta: C = [Rw, Xw];

  // (8) 管内复数波数 kx² = k0²[1 − j·4/(D·k0)·(1/ζw)]
  const kx2 = cmul([k0 * k0, 0], csub([1, 0], cmul([0, 1], cmul([4 / (D * k0), 0], cdiv([1, 0], zeta)))));
  const kx = csqrt(kx2);

  // (9) 衰减系数 α
  const den = Rw * Rw + Xw * Xw;
  const alpha = den > 1e-30 ? (2 / D) * (Rw / den) : NaN;

  // (10)(11)(12) 传递矩阵法：壁面路径传递损失（无量纲化简式）
  const kxL = cmul(kx, [Leff, 0]);
  const r1 = cdiv([k0, 0], kx);
  const r2 = cdiv(kx, [k0, 0]);
  const sum = cadd(cmul([2, 0], ccos(kxL)), cmul(cmul([0, 1], cadd(r1, r2)), csin(kxL)));
  const tlWall = 20 * Math.log10(cabs(sum) / 2);

  // 并联泄漏路径（经验项）与两路合成
  const tlLeak = calib.AL + calib.BL * Math.log10(f / LEAK_REF);
  // M2：高频泄漏饱和补偿 ΔTL_HF = a_HF·(f/f_s)² / [1+(f/f_s)²]，低频趋近 0、高频趋近 a_HF
  const aHF = calib.aHF ?? 0;
  const fS = calib.fS ?? 0;
  let dtlHF = 0;
  if (aHF > 0 && fS > 0 && f > 0) {
    const r = f / fS;
    dtlHF = (aHF * r * r) / (1 + r * r);
  }
  const TL_wall = -10 * Math.log10(Math.pow(10, -tlWall / 10) + Math.pow(10, -tlLeak / 10));
  const TL = TL_wall + dtlHF;

  if (!Number.isFinite(TL)) return null;
  return { omega, Rw, Xw, alpha, kxRe: kx[0], kxIm: kx[1], TL, tlWall, tlLeak, sigmaf, fc };
}

/** 供标定引擎调用的公开求值入口（可注入 C_R / A_L / B_L） */
export function evalWovenTubeAt(
  inputs: Record<string, number>,
  f: number,
  calib?: WovenTubeCalib,
) {
  return at(inputs, f, calib);
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
  version: '3.0.0',
  status: 'published',
  domain: 'acoustics',
  subsystem: '消声器',
  title: '★编织管消音器',
  summary: '按孔隙度 f_p（式4.1）确定编织管壁的声阻与特征频率，计算壁面路径传递损失并绘制 TL - Frequency 曲线；v3 增加并联泄漏路径，标定频带扩展到 20~5000 Hz（L=300 mm 样件，逐点 RMSE 2.29 dB）。',
  tags: ['编织管', '孔隙度', '壁面阻抗', '声质量', '并联泄漏', '消音器', '消声器', '传递损失', 'TL', 'NVH', '进气系统', '排气系统'],
  description:
    'v3 以孔隙度 f_p（单位 Hz）作为编织壁的综合物理特性参数：由式(4.1) f_p = γP0/(2π V Z) 反解壁面静流阻，折算为归一化壁面声阻 R_w，特征频率取 f_c = f_p，得 ζw = R_w(1 + j·f/f_p)。管内复数波数按 kx² = k0²[1 − j·4/(D k0)·(1/ζw)] 计算，衰减系数 α = (2/D)·R_w/(R_w²+X_w²)，由传递矩阵法化简式求壁面路径传递损失 TL_w = 20lg|2cos(kxL) + j(k0/kx + kx/k0)sin(kxL)|/2；再与并联泄漏路径 TL_L = A_L + B_L·lg(f/1000) 按功率叠加得总传递损失 TL = −10lg(10^(−TL_w/10) + 10^(−TL_L/10))。C_R、A_L、B_L 由实测样件（内径 50 mm、长度 300 mm、壁厚 2.7 mm、孔隙度 1400 Hz）在 20~5000 Hz 的传递损失曲线标定。结果区输出频带内总的传递损失（401 点平均）、峰值、壁面/泄漏两路分项与等效流阻率 σ_f，并绘制 TL - Frequency 曲线。',
  inputs: [
    { key: 'L', label: '编织管长度', symbol: 'L', unit: 'mm', unitGroup: 'length', default: 300, min: 0, required: true, description: '编织管有效长度，决定衰减量与管长四分之一波长共振频率（实测样件 300 mm）' },
    { key: 'D', label: '编织管内径', symbol: 'D', unit: 'mm', unitGroup: 'diameter', default: 50, min: 0, required: true, description: '编织管圆筒内径（实测样件 50 mm）' },
    { key: 't', label: '编织管壁厚', symbol: 't', unit: 'm', default: 0.0027, min: 0, required: true, description: '编织丝网管壁厚度，仅用于折算等效流阻率 σ_f 对照值（实测样件 0.0027 m）' },
    { key: 'fp', label: '孔隙度', symbol: 'f_p', unit: 'Hz', default: 1400, min: 0, required: true, description: '按式(4.1) 由静态压降-流量（ΔP/Q）确定的壁面综合特性频率 f_p = γP0/(2πVZ)，实测样件 1400 Hz' },
    { key: 'rho0', label: '空气密度', symbol: 'ρ0', unit: 'kg/m³', unitGroup: 'density', default: 1.205, min: 0, required: true, description: '常温常压下空气密度，建议取值 1.205 kg/m³' },
    { key: 'c0', label: '空气声速', symbol: 'c0', unit: 'm/s', default: 343, min: 0, required: true, description: '常温常压下空气中声速，建议取值 343 m/s' },
    { key: 'gam', label: '比热比', symbol: 'γ', unit: '-', default: 1.4, min: 1, required: true, description: '空气定压定容比热比，建议取值 1.4' },
    { key: 'P0', label: '大气静压', symbol: 'P0', unit: 'Pa', unitGroup: 'pressure', default: 101325, min: 0, required: true, description: '环境静压，建议取值 101325 Pa' },
    { key: 'fmin', label: '频率最小值', symbol: 'f_min', unit: 'Hz', default: 20, min: 0, required: true, description: 'TL 曲线扫描下限，建议取值 20 Hz' },
    { key: 'fmax', label: '频率最大值', symbol: 'f_max', unit: 'Hz', default: 5000, min: 0, required: true, description: 'TL 曲线扫描上限，默认 5000 Hz（实测标定频带 20~5000 Hz）' },
  ],
  outputs: [
    { key: 'tl_avg', label: '总的传递损失', symbol: 'TL_avg', unit: 'dB', primary: true, group: '声学特性', description: '频带 [f_min, f_max] 内 TL 曲线的平均值（均分 400 份采样）' },
    { key: 'tl_max', label: '最大传递损失', symbol: 'TL_max', unit: 'dB', primary: true, group: '声学特性', description: '频带内 TL 曲线的最大值（400 均分采样）' },
    { key: 'f_peak', label: '峰值频率', symbol: 'f_pk', unit: 'Hz', group: '声学特性', description: 'TL 峰值对应的频率，通常位于管长四分之一波长 c0/(4L) 附近' },
    { key: 'sigmaf', label: '等效流阻率', symbol: 'σ_f', unit: 'Pa·s/m²', group: '壁面参数', description: '由孔隙度折算的等效流阻率 σ_f = γP0/(2π r_i t f_p)，用于与 JCA/论文标定值（2.4×10⁵ Pa·s/m²）对照' },
    { key: 'fc', label: '壁面特征频率', symbol: 'f_c', unit: 'Hz', group: '壁面参数', description: '壁面声抗与声阻相等处的频率，f_c = f_p（即输入的孔隙度）' },
    { key: 'Rw', label: '归一化声阻', symbol: 'R_w', unit: '-', group: '中间量', description: 'R_w = C_R·γP0/(2π r_i f_p ρ0c0)，取示例频率处的值' },
    { key: 'Xw', label: '归一化声抗', symbol: 'X_w', unit: '-', group: '中间量', description: 'X_w = R_w·f/f_c（声质量项），取示例频率处的值' },
    { key: 'alpha', label: '衰减系数', symbol: 'α', unit: 'm⁻¹', group: '中间量', description: 'α = (2/D)·R_w/(R_w²+X_w²)，取示例频率处的值' },
    { key: 'tlWall', label: '壁面路径传递损失', symbol: 'TL_w', unit: 'dB', group: '中间量', description: '仅由编织壁阻抗经传递矩阵法得到的传递损失，取示例频率处的值' },
    { key: 'tlLeak', label: '泄漏路径传递损失', symbol: 'TL_L', unit: 'dB', group: '中间量', description: '并联泄漏路径等效传递损失 TL_L = A_L + B_L·lg(f/1000)，取示例频率处的值' },
    { key: 'kxRe', label: '管内波数实部', symbol: 'Re(k_x)', unit: 'rad/m', group: '中间量', description: '式(8) 复数波数 kx 的实部（相位常数），取示例频率处的值' },
    { key: 'kxIm', label: '管内波数虚部', symbol: 'Im(k_x)', unit: 'rad/m', group: '中间量', description: '式(8) 复数波数 kx 的虚部（衰减常数），取示例频率处的值' },
    { key: 'omega', label: '角频率（示例）', symbol: 'ω', unit: 'rad/s', group: '中间量', description: 'ω = 2πf，取示例频率 f = √(f_min·f_max)（f_min = 0 时按 1 Hz 处理）处的值' },
  ],
  latex: [
    {
      label: '孔隙度定义（式4.1）',
      tex: 'f_p = \\frac{\\gamma P_0}{2\\pi V}\\,\\frac{1}{Z} = \\frac{\\gamma P_0}{2\\pi}\\cdot\\frac{1}{2\\pi r_i^{2}L\\,\\Delta P/Q}',
    },
    {
      label: '壁面归一化阻抗（阻性 + 声质量）',
      tex: '\\zeta_w = \\frac{Z_w}{\\rho_0 c_0} = R_w + jX_w,\\qquad R_w = C_R\\frac{\\gamma P_0}{2\\pi r_i f_p\\,\\rho_0 c_0},\\qquad X_w = R_w\\frac{f}{f_c},\\qquad f_c = f_p',
    },
    {
      label: '等效流阻率（对照量）',
      tex: '\\sigma_f = \\frac{\\gamma P_0}{2\\pi r_i t f_p}',
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
      label: '壁面路径传递损失（式10~12，化简式）',
      tex: 'TL_w = 20\\lg\\frac{\\left|\\,2\\cos(k_x L) + j\\left(\\dfrac{k_0}{k_x} + \\dfrac{k_x}{k_0}\\right)\\sin(k_x L)\\,\\right|}{2}',
    },
    {
      label: '并联泄漏路径（经验项）',
      tex: 'TL_L(f) = A_L + B_L\\lg\\frac{f}{1000}',
    },
    {
      label: '两路并联合成',
      tex: 'TL = -10\\lg\\left(10^{-TL_w/10} + 10^{-TL_L/10}\\right)',
    },
    {
      label: '辅助式',
      tex: '\\omega = 2\\pi f,\\qquad f \\in \\left[f_{\\min},\\,f_{\\max}\\right]\\;\\text{均分 400 份}',
    },
  ],
  diagram: WOVEN_DIAGRAM,
  sensitivity: true,
  assumptions: [
    '★ v3.0.0 采用「孔隙度壁面模型 + 并联泄漏路径」，不使用 JCA 五参数（σ_f、φ、α∞、Λ、Λ′）。原因：按实测工况（D=50 mm、L=300 mm、t=2.7 mm）核算，JCA 链路只能给出单调上升的 TL（20 Hz 18 dB → 1400 Hz 48 dB），即使五参数全放开拟合，1/3 倍频程 RMSE 仍约 10 dB，且峰值与高频下降形态与实测相反',
    '标定依据：实测 test1.xlsx（内径 50 mm、长度 300 mm、壁厚 2.7 mm、孔隙度 f_p = 1400 Hz），频带 20~5000 Hz。逐点（1.5625 Hz）RMSE = 2.29 dB、MAE = 1.77 dB、平均偏差 −0.68 dB；20~1400 Hz RMSE 2.56 dB、1400~5000 Hz RMSE 2.18 dB、2000~5000 Hz RMSE 2.30 dB；20~400 Hz 平均偏差 +0.04 dB；1/3 倍频程 24 个频带 RMSE 2.27 dB',
    '标定系数：C_R = 0.4210012、f_c = f_p、A_L = 30.4643 dB、B_L = −26.131 dB/decade。理论壁面声阻 R_w0 = γP0/(2π r_i f_p ρ0c0) 在样件上为 1.5607，标定后 R_w = 0.6571；孔隙度 f_p 直接作为壁面声抗与声阻相等的特征频率',
    '并联泄漏项为经验修正：TL_L(f) = A_L + B_L·lg(f/1000)，代表壁面路径之外的非壁面传声通道（测试系统侧向传声、管端辐射、夹具泄漏等）。约 500 Hz 以上 TL_L 小于壁面路径 TL_w，总传递损失由泄漏项主导；该项与管长、内径无关，属该测试条件下的标定结果，不代表编织管本体吸声机理，更换台架或测试方式需重新标定',
    '已知偏差：20~50 Hz 模型比实测低约 2~4 dB（实测低频段为约 31 dB 的平台，判断受测试系统低频信噪比/端部条件限制）；100 Hz 附近的窄带尖峰（实测 50.7 dB）模型未复现，属测试系统共振/干扰；峰值位置模型约 244 Hz、实测约 352 Hz（对应有效声学长度约 245 mm，端部修正未建模），幅值差约 0.7 dB，1/3 倍频程内可接受',
    '适用频带 20~5000 Hz（已在该范围内标定）；超出 5000 Hz 为外推，泄漏项 B_L 的幂律关系未必成立',
    '孔隙度 f_p 为按式(4.1) 由静态压降与透过管壁体积流量确定的壁面综合特性频率：f_p = γP0/(2πVZ) = γP0/(2π)·1/(2π r_i²L·ΔP/Q)，V 按 2π r_i²L 取（与所给公式一致）',
    '壁面声阻由孔隙度直接确定，与壁厚 t 无关；t 仅用于折算等效流阻率 σ_f = γP0/(2π r_i t f_p) 作对照（f_p = 1400 Hz、D = 50 mm、t = 2.7 mm 时 σ_f ≈ 2.39×10⁵ Pa·s/m²，与 PPT/论文 2.4×10⁵ Pa·s/m² 一致）',
    '模型链路：孔隙度 → 壁面归一化阻抗 ζw → 管内复数波数 kx（式8）→ 衰减系数 α（式9）→ 传递矩阵法 TL（式10~12 化简式）；传递矩阵与 PPT 保持同一链路，式(12) 原文 Z0 = ρ0c0/S 与 Zd 量纲不一致，按量纲一致性保留无量纲化简式，刚性壁极限（kx → k0）回归 TL = 0 dB',
    'PPT 参数表中的温度 T 与马赫数 M 未进入本公式；介质参数（ρ0、c0、γ、P0）默认取常温常压空气值，极端工况需按实际条件修正',
    '「总的传递损失」按 401 个采样点（f_min ~ f_max 均分 400 份）平均，f ≤ 0 的直流点 TL 记 0 且不参与平均',
    '长度 L 与内径 D 以 mm 输入、壁厚 t 以 m 输入、孔隙度 f_p 以 Hz 输入，求解时统一换算为 SI',
  ],
  solve(v) {
    const empty = {
      tl_avg: NaN, tl_max: NaN, f_peak: NaN, sigmaf: NaN, fc: NaN, Rw: NaN, Xw: NaN,
      alpha: NaN, tlWall: NaN, tlLeak: NaN, kxRe: NaN, kxIm: NaN, omega: NaN,
    };
    if (!(v.L > 0) || !(v.D > 0) || !(v.t > 0) || !(v.fp > 0) ||
        !(v.rho0 > 0) || !(v.c0 > 0) || !(v.gam > 1) || !(v.P0 > 0))
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
      tlWall: r ? r.tlWall : NaN,
      tlLeak: r ? r.tlLeak : NaN,
      kxRe: r ? r.kxRe : NaN,
      kxIm: r ? r.kxIm : NaN,
      omega: r ? r.omega : NaN,
      sigmaf: r ? r.sigmaf : NaN,
      fc: r ? r.fc : NaN,
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
      name: '实测标定工况（D=50 mm、L=300 mm、t=2.7 mm、孔隙度 f_p=1400 Hz，20~5000 Hz）',
      input: {
        L: 0.3, D: 0.05, t: 0.0027, fp: 1400, rho0: 1.205, c0: 343, gam: 1.4,
        P0: 101325, fmin: 20, fmax: 5000,
      },
      expect: {
        tl_avg: 22.229143,
        tl_max: 44.805673,
        f_peak: 244.1,
        sigmaf: 238909.253464,
        fc: 1400,
        Rw: 0.657051,
        Xw: 0.148413,
        alpha: 57.922854,
        tlWall: 55.637452,
        tlLeak: 43.52983,
        kxRe: 16.783083,
        kxIm: -19.992356,
        omega: 1986.917653,
      },
      tolerance: 2e-3,
      source: '实测 test1.xlsx（编织管 D=50 mm、L=300 mm、t=2.7 mm、孔隙度 1400 Hz）标定：20~5000 Hz 逐点 RMSE 2.29 dB、MAE 1.77 dB；1/3 倍频程 24 个频带 RMSE 2.27 dB；峰值模型 44.8 dB @ 244 Hz（实测 45.5 dB @ 352 Hz）；示例频率 f = √(20×5000) = 316.23 Hz 处 R_w = 0.6571、X_w = 0.1484、α = 57.92 1/m、TL_w = 55.64 dB、TL_L = 43.53 dB',
    },
    {
      name: '变工况（D=60 mm、L=200 mm、t=3 mm、孔隙度 f_p=1800 Hz，0~3000 Hz）',
      input: {
        L: 0.2, D: 0.06, t: 0.003, fp: 1800, rho0: 1.205, c0: 343, gam: 1.4,
        P0: 101325, fmin: 0, fmax: 3000,
      },
      expect: {
        tl_avg: 26.984435,
        tl_max: 40.590912,
        f_peak: 337.5,
        sigmaf: 139363.731187,
        fc: 1800,
        Rw: 0.425866,
        Xw: 0.012959,
        alpha: 78.199436,
        tlWall: 26.591773,
        tlLeak: 63.426972,
        kxRe: 8.752074,
        kxIm: -8.964767,
        omega: 344.144233,
      },
      tolerance: 2e-3,
      source: '回归算例：按 v3 模型式(4.1)~(18) 及式(19)(20) 并联合成式逐项核算，示例频率 f = √(1×3000) = 54.77 Hz 处 R_w = 0.4259、X_w = 0.0130、α = 78.20 1/m、TL_w = 26.59 dB、TL_L = 63.43 dB；401 点采样（f = 0 点 TL 记 0 不参与平均）TL 均值 26.984 dB、峰值 40.591 dB @ 337.5 Hz',
    },
  ],
};
