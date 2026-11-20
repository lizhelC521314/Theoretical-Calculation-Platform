/**
 * 赫姆霍兹消音器中心频率公式优化策略 —— H0 ~ H4
 *
 * 依据《赫姆霍兹消音器中心频率公式自动优化实施方案》第 3、4 章：
 *   H0 基准      端部修正 δout=ψd（ψ 默认 0.75），不标定，仅对照基线（不可运行优化）
 *   H1 标定      放开 δ_total ∈ [0, 1.2d]，初值 0.75d，单参数有界 Brent/NM
 *   H2 偏心/开口 放开 C0、ke、kh、kA，分阶段（先 C0、ke 再 kh、kA）
 *   H3 模态耦合  腔体/壳体阻抗 Zin=0（限域，需 FEM/试验模态参数）
 *   H4 GP 残差   仅限域内插，需 ≥10 个独立样件（研究，默认关闭）
 *
 * 标量目标：中心频率 f0 相对误差（见 runScalar.ts）。
 */

import type { CalibrationStrategy } from '../types';

const BASE: Omit<CalibrationStrategy, 'id' | 'params' | 'target'> = {
  version: 'v1',
  formulaId: 'acoustics.muffler.helmholtz',
  bands: {
    minHz: 0,
    maxHz: 0,
    dropBelowHz: 0,
    minCoverage: 0,
    lowBandWeight: 1,
  },
  objective: {
    huberDelta: 2.0,
    lambda: 1e-3,
    lambdaPeak: 0,
    peakProminence: 0,
  },
  optimizer: {
    engine: 'nelder-mead',
    starts: 12,
    maxIter: 2000,
    tolF: 1e-6,
    tolU: 1e-4,
  },
  uncertainty: {
    jacobian: true,
    blockBootstrap: true,
    resamples: 1000,
    blockSize: 1,
  },
  validation: { method: 'group-holdout', trainRatio: 0.7 },
};

/** H0：基准模型，δout=ψd（ψ=0.75），不标定（role 全 fixed，引擎会拒绝运行 → 页面走基线计算） */
export const HELMHOLTZ_H0_V1: CalibrationStrategy = {
  ...BASE,
  id: 'helmholtz-baseline',
  target: { output: 'f0', unit: 'Hz', metric: 'relative-error' },
  params: [
    {
      key: 'delta_total',
      label: '端部修正 δ_total（m，H0 为 ψd，ψ=0.75）',
      role: 'fixed',
      transform: 'scale',
      scale: 0.012,
      initial: 0.012,
    },
  ],
};

/** H1：总端部修正标定，单参数 δ_total ∈ [0, 0.030]，初值 0.75d 近似 */
export const HELMHOLTZ_H1_V1: CalibrationStrategy = {
  ...BASE,
  id: 'helmholtz-effective-length',
  target: { output: 'f0', unit: 'Hz', metric: 'relative-error' },
  params: [
    {
      key: 'delta_total',
      label: '总端部修正 δ_total（m）',
      role: 'tunable',
      transform: 'scale',
      scale: 0.012,
      initial: 0.012, // ≈ 0.75 × 16 mm；页面会用当前几何的 0.75d 覆盖初值
      min: 0,
      max: 0.030, // 1.2 × 25 mm，覆盖常见喉管直径
    },
  ],
};

/**
 * H2：偏心/开口/插入修正
 *   δ/d = C0 + ke·(e/R) + kh·(h/Lt) + kA·ln(Am/Sc)
 * 分阶段放开：当前默认全部可放开；样本不足时页面提示先固定 kh、kA。
 */
export const HELMHOLTZ_H2_V1: CalibrationStrategy = {
  ...BASE,
  id: 'helmholtz-eccentric-opening',
  target: { output: 'f0', unit: 'Hz', metric: 'relative-error' },
  params: [
    {
      key: 'C0',
      label: '基准端部修正系数 C0',
      role: 'tunable',
      transform: 'scale',
      scale: 0.75,
      initial: 0.75,
      min: 0,
      max: 1.2,
    },
    {
      key: 'ke',
      label: '偏心修正系数 ke',
      role: 'tunable',
      transform: 'scale',
      scale: 0.5,
      initial: 0,
      min: -0.5,
      max: 0.5,
    },
    {
      key: 'kh',
      label: '插入深度修正系数 kh',
      role: 'tunable',
      transform: 'scale',
      scale: 0.5,
      initial: 0,
      min: -0.5,
      max: 0.5,
    },
    {
      key: 'kA',
      label: '开口面积修正系数 kA',
      role: 'tunable',
      transform: 'scale',
      scale: 0.5,
      initial: 0,
      min: -0.5,
      max: 0.5,
    },
  ],
};

/**
 * H3：模态/壳体耦合（占位，限域）
 * 需要腔体/壳体模态频率与损耗因子（FEM/试验输入），不在集总公式内自动标定。
 * 页面显示"需 FEM/试验模态参数"，状态 limited。
 */
export const HELMHOLTZ_H3_V1: CalibrationStrategy = {
  ...BASE,
  id: 'helmholtz-impedance',
  target: { output: 'f0', unit: 'Hz', metric: 'relative-error' },
  params: [
    { key: 'f_cav', label: '腔体模态频率 f_cav（Hz）', role: 'fixed', transform: 'scale', scale: 200, initial: 200 },
    { key: 'eta_cav', label: '腔体损耗因子 η_cav', role: 'fixed', transform: 'scale', scale: 0.01, initial: 0.01 },
    { key: 'f_shell', label: '壳体模态频率 f_shell（Hz）', role: 'fixed', transform: 'scale', scale: 300, initial: 300 },
    { key: 'eta_shell', label: '壳体损耗因子 η_shell', role: 'fixed', transform: 'scale', scale: 0.01, initial: 0.01 },
  ],
};

/**
 * H4：GP 残差（占位，研究）
 * 仅在 H2 独立验证后仍有系统残差、且 ≥10 个独立样件时启用。
 * 页面状态 research，默认关闭。
 */
export const HELMHOLTZ_H4_V1: CalibrationStrategy = {
  ...BASE,
  id: 'helmholtz-residual-gp',
  target: { output: 'f0', unit: 'Hz', metric: 'relative-error' },
  params: [
    { key: 'gp_length', label: 'GP 相关长度', role: 'fixed', transform: 'scale', scale: 1, initial: 1 },
    { key: 'gp_sigma', label: 'GP 先验标准差', role: 'fixed', transform: 'scale', scale: 1, initial: 1 },
  ],
};

/** 模型版本 → 策略映射（供页面与注册表使用） */
export const HELMHOLTZ_STRATEGIES: Record<string, CalibrationStrategy> = {
  H0: HELMHOLTZ_H0_V1,
  H1: HELMHOLTZ_H1_V1,
  H2: HELMHOLTZ_H2_V1,
  H3: HELMHOLTZ_H3_V1,
  H4: HELMHOLTZ_H4_V1,
};

export interface HelmholtzModelOption {
  key: string; // H0..H4
  label: string;
  strategy: CalibrationStrategy;
  /** 是否可运行标量标定（H0/H3/H4 为占位，仅计算或展示） */
  runnable: boolean;
  status: 'baseline' | 'review' | 'limited' | 'research';
  note: string;
}

export const HELMHOLTZ_MODEL_OPTIONS: HelmholtzModelOption[] = [
  {
    key: 'H0',
    label: 'H0 基准（δout=ψd，ψ=0.75，不标定）',
    strategy: HELMHOLTZ_H0_V1,
    runnable: false,
    status: 'baseline',
    note: '对照基线，不参与优化；用于确认口径与 H0 频率（当前工况约 109.3 Hz，ψ=0.75）。',
  },
  {
    key: 'H1',
    label: 'H1 有效长度标定（δ_total）',
    strategy: HELMHOLTZ_H1_V1,
    runnable: true,
    status: 'review',
    note: '单参数标定；单点只能"标定/待验证"，不能发布为默认（实施方案 §9）。',
  },
  {
    key: 'H2',
    label: 'H2 偏心/开口/插入修正（C0,ke,kh,kA）',
    strategy: HELMHOLTZ_H2_V1,
    runnable: true,
    status: 'review',
    note: '需 ≥6 个独立工况；样本不足时先固定 kh、kA，只拟合 C0、ke。',
  },
  {
    key: 'H3',
    label: 'H3 模态/壳体耦合（占位）',
    strategy: HELMHOLTZ_H3_V1,
    runnable: false,
    status: 'limited',
    note: '需 FEM/试验模态参数；多峰/反共振时使用，不用阻抗模型硬拟合单峰。',
  },
  {
    key: 'H4',
    label: 'H4 GP 残差（占位，研究）',
    strategy: HELMHOLTZ_H4_V1,
    runnable: false,
    status: 'research',
    note: '需 ≥10 个独立样件；仅限域内插，默认关闭，H2 改善 <10% 不采用。',
  },
];
