/**
 * 赫姆霍兹消音器模型的标定适配层：把公式物理计算接入标量标定引擎。
 * 复用 evalHelmholtzF0 / derive，保证标定与软件计算用同一套方程。
 *
 * 对应《自动优化实施方案》：
 *   H1：标量模型只返回中心频率 f0，目标 = 相对误差 [(f_model − f_target)/f_target]^2
 *   H2：参数 C0/ke/kh/kA 经 paramsToHelmholtzCalib 注入，f0 仍由同一 derive 计算
 */

import {
  evalHelmholtzF0,
  evalHelmholtzSummary,
  type HelmholtzCalib,
} from '../../../domains/acoustics/helmholtzMuffler';
import type { ModelEval } from '../types';

/** 标定用公式输入的 SI 默认值（其余由几何构造） */
export const HELMHOLTZ_SI_DEFAULTS: Record<string, number> = {
  lengthKind: 0, // 0 = 总长（Lt，已含 h，不重复加）
  cavityGross: 0, // 0 = 净腔体（不重复扣 Sc·h）
  intersectKind: 0, // 0 = 垂直插入（无椭圆相贯口修正）
  deltaIn: 0, // 内端修正默认 0
};

/**
 * 把标定引擎的扁平参数映射为 HelmholtzCalib。
 *   H1：delta_total → deltaTotal
 *   H2：C0 / ke / kh / kA
 * 未出现的键缺省为 0 / undefined，derive 内部按"未设置则用 H0 基准"处理。
 */
export function paramsToHelmholtzCalib(params: Record<string, number>): HelmholtzCalib {
  const calib: HelmholtzCalib = {};
  if (Number.isFinite(params.delta_total)) calib.deltaTotal = params.delta_total;
  if (Number.isFinite(params.C0)) calib.C0 = params.C0;
  if (Number.isFinite(params.ke)) calib.ke = params.ke;
  if (Number.isFinite(params.kh)) calib.kh = params.kh;
  if (Number.isFinite(params.kA)) calib.kA = params.kA;
  return calib;
}

/**
 * 标量模型：输入（SI）+ 参数 → 中心频率 f0（Hz）。
 * 供 calibrateScalar 评估候选参数；不修改全局激活系数。
 */
export const helmholtzScalarModel = (
  inputs: Record<string, number>,
  params: Record<string, number>,
): number => {
  const calib = paramsToHelmholtzCalib(params);
  const v = { ...HELMHOLTZ_SI_DEFAULTS, ...inputs };
  return evalHelmholtzF0(v, calib);
};

/**
 * 曲线模型（兼容 ModelEval 签名）：返回各频率点的 TL，用于图形对比。
 * 若公式未提供 TL 曲线求值，则用中心频率位置生成一个示意峰（仅作图，不参与标定）。
 */
export const helmholtzCurveModel: ModelEval = (inputs, params, freqs) => {
  const calib = paramsToHelmholtzCalib(params);
  const v = { ...HELMHOLTZ_SI_DEFAULTS, ...inputs };
  const f0 = evalHelmholtzF0(v, calib);
  const d = v.d ?? 0.02;
  const Vc = v.V ?? 5e-4;
  const sc = (Math.PI * d * d) / 4;
  // 赫姆霍兹单峰 TL 近似：TL = 20·log10(1 + (ρc·Sc)/(2·Zc))·|...|，此处用洛伦兹峰示意
  return freqs.map((f) => {
    if (!Number.isFinite(f0) || f0 <= 0) return 0;
    const Q = 15;
    const peakTL = Math.min(60, 20 * Math.log10(1 + (1.205 * 343 * sc) / Math.max(1e-6, Vc) * 0.5));
    const r = f / f0;
    const denom = (1 - r * r) * (1 - r * r) + (r / Q) * (r / Q);
    return peakTL / Math.max(1e-6, denom);
  });
};

/**
 * 由毫米/升/摄氏度口径的几何参数构造 SI 输入（derive 的契约）。
 *   V 输入单位：升（L）→ ×1e-3 转 m³
 *   t 输入单位：摄氏度（℃）→ +273.15 转 K
 *   其余长度：毫米（mm）→ /1000 转 m
 *   am 输入单位：mm² → ×1e-6 转 m²
 */
export function helmholtzInputs(mm: {
  D: number; // mm
  d: number; // mm
  lc: number; // mm（喉管总长 Lt）
  h: number; // mm（插入深度）
  V: number; // L（净腔体体积）
  t: number; // ℃
  e?: number; // mm（偏心距，H2 用）
  am?: number; // mm²（相贯开口面积，H2 用）
}): Record<string, number> {
  const v: Record<string, number> = {
    ...HELMHOLTZ_SI_DEFAULTS,
    D: mm.D / 1000,
    d: mm.d / 1000,
    lc: mm.lc / 1000,
    h: mm.h / 1000,
    V: mm.V / 1000,
    t: mm.t + 273.15,
  };
  if (Number.isFinite(mm.e)) v.eccentricity = (mm.e as number) / 1000;
  if (Number.isFinite(mm.am) && (mm.am as number) > 0) v.am = (mm.am as number) * 1e-6;
  return v;
}

/** 取标定后的派生量（f0 / leff / sArea / Vc），供结果页图形对比 */
export function helmholtzDerived(
  mm: Record<string, number>,
  params: Record<string, number>,
): { f0: number; lEff: number; sArea: number; Vc: number } {
  const calib = paramsToHelmholtzCalib(params);
  const v = helmholtzInputs({
    D: mm.D, d: mm.d, lc: mm.lc, h: mm.h, V: mm.V, t: mm.t,
    e: mm.e, am: mm.am,
  });
  const r = evalHelmholtzSummary(v, calib);
  return { f0: r.f0, lEff: r.lEff, sArea: r.sArea, Vc: r.Vc };
}
