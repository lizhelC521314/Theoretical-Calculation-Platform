/**
 * 策略 jca-porous-calibration/v1.1
 *
 * 与《编织管传递损失模型参数标定算法说明》V1.0 表 10-1、附录 B 一致。
 */

import type { CalibrationStrategy } from '../types';

export const JCA_POROUS_V11: CalibrationStrategy = {
  id: 'jca-porous-calibration',
  version: 'v1.1',
  formulaId: 'acoustics.muffler.wovenTube',
  target: { output: 'TL', unit: 'dB', metric: 'weighted-huber-rmse' },
  bands: {
    minHz: 20,
    maxHz: 5000,
    dropBelowHz: 100,
    minCoverage: 0.8,
    lowBandWeight: 0.3,
  },
  objective: {
    huberDelta: 2.0,
    lambda: 1e-3,
    lambdaPeak: 0.1,
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
      min: 5,
      max: 70,
    },
    {
      key: 'B_L',
      label: '泄漏项斜率 B_L（dB/decade）',
      role: 'tunable',
      transform: 'scale',
      scale: 26.131,
      initial: -26.131,
      min: -80,
      max: 0,
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
