/**
 * 策略 braid-structure-correction/v1 — M1 端部修正 + M2 高频饱和
 *
 * 依据《编织管传递损失公式自动优化实施方案_M4》第 4.2、4.3、5.1～5.4、6.1 节：
 *   M1  L_eff = L·(1 + ε_L)，ε_L ∈ [-0.25, 0.25]
 *   M2  ΔTL_HF = a_HF·(f/f_s)² / [1 + (f/f_s)²]，a_HF ∈ [0,10] dB，f_s ∈ [1000,8000] Hz
 *   主优化频带 100~2000 Hz（14 个 1/3 倍频带）；<100 Hz 降权 0.3；
 *       2000~5000 Hz 只作外推检查不参与训练。
 *   目标函数、优化器、不确定度口径与 M0 一致，保证可比。
 */

import type { CalibrationStrategy } from '../types';

export const BRAID_STRUCTURE_V1: CalibrationStrategy = {
  id: 'braid-structure-correction',
  version: 'v1',
  formulaId: 'acoustics.muffler.wovenTube',
  target: { output: 'TL', unit: 'dB', metric: 'weighted-huber-rmse' },
  bands: {
    minHz: 100,
    maxHz: 2000,
    dropBelowHz: 100,
    minCoverage: 0.8,
    lowBandWeight: 0.3,
  },
  objective: {
    huberDelta: 2.0,
    lambda: 1e-3,
    lambdaPeak: 0.15,
    peakProminence: 2.0,
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
    blockSize: 3,
  },
  validation: { method: 'group-holdout', trainRatio: 0.7 },
  params: [
    {
      key: 'C_R',
      label: '壁面声阻系数 C_R',
      role: 'tunable',
      transform: 'log',
      scale: 0.4210012,
      initial: 0.4210012,
      min: 0.02,
      max: 5,
    },
    {
      key: 'A_L',
      label: '泄漏项基准 A_L（dB@1kHz）',
      role: 'tunable',
      transform: 'scale',
      scale: 30.4643,
      initial: 30.4643,
      min: 20,
      max: 40,
    },
    {
      key: 'B_L',
      label: '泄漏项斜率 B_L（dB/decade）',
      role: 'tunable',
      transform: 'scale',
      scale: 26.131,
      initial: -26.131,
      min: -40,
      max: -10,
    },
    {
      key: 'epsilon_L',
      label: '有效长度修正 ε_L',
      role: 'tunable',
      transform: 'scale',
      scale: 0.25,
      initial: 0,
      min: -0.25,
      max: 0.25,
    },
    {
      key: 'a_HF',
      label: '高频饱和补偿上限 a_HF（dB）',
      role: 'tunable',
      transform: 'scale',
      scale: 5,
      initial: 0,
      min: 0,
      max: 10,
    },
    {
      key: 'f_s',
      label: '高频饱和特征频率 f_s（Hz）',
      role: 'tunable',
      transform: 'scale',
      scale: 3000,
      initial: 2500,
      min: 1000,
      max: 8000,
    },
    {
      key: 'f_p',
      label: '孔隙度 f_p（Hz）',
      role: 'supplier',
      transform: 'scale',
      scale: 1400,
      initial: 1400,
    },
    {
      key: 'f_c',
      label: '壁面特征频率 f_c（Hz）',
      role: 'fixed',
      transform: 'scale',
      scale: 1400,
      initial: 1400,
    },
  ],
};

/** 仅 M0 参数（ε_L=a_HF=f_s 固定为 0）—— 分阶段拟合的 M0 阶段 */
export const BRAID_M0_V1: CalibrationStrategy = {
  ...BRAID_STRUCTURE_V1,
  id: 'braid-m0-calibration',
  version: 'v1',
  bands: { ...BRAID_STRUCTURE_V1.bands, minHz: 20, maxHz: 5000 },
  params: BRAID_STRUCTURE_V1.params.map((p) => {
    if (p.key === 'epsilon_L' || p.key === 'a_HF') return { ...p, role: 'fixed' as const, initial: 0 };
    if (p.key === 'f_s') return { ...p, role: 'fixed' as const, initial: 0 };
    return p;
  }),
};

/** 仅 M1 参数（ε_L 放开，a_HF=f_s 固定为 0）—— 分阶段拟合的 M1 阶段 */
export const BRAID_M1_V1: CalibrationStrategy = {
  ...BRAID_STRUCTURE_V1,
  id: 'braid-m1-end-correction',
  version: 'v1',
  params: BRAID_STRUCTURE_V1.params.map((p) => {
    if (p.key === 'a_HF' || p.key === 'f_s') return { ...p, role: 'fixed' as const, initial: 0 };
    return p;
  }),
};
