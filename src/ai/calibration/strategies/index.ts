/**
 * 策略注册表：集中导出所有可用标定策略。
 *
 * 页面通过此模块枚举策略，避免硬编码 import；后续 M3/M4（GP/NN 残差模型）
 * 可在此追加 reserved 占位，满足触发条件（≥10 独立样件）后再放开。
 */

import type { CalibrationStrategy } from '../types';
import { JCA_POROUS_V11 } from './jcaPorousV11';
import { BRAID_M0_V1, BRAID_M1_V1, BRAID_STRUCTURE_V1 } from './braidStructureV1';

/** 编织管公式（acoustics.muffler.wovenTube）的所有可用策略 */
export const WOVEN_TUBE_STRATEGIES = {
  /** 基线标定（M4 前的原始做法，3 参数全放开，20~5000 Hz） */
  M0: BRAID_M0_V1,
  /** 端部修正（放开 ε_L，频带收敛到 100~2000 Hz） */
  M1: BRAID_M1_V1,
  /** 高频饱和（6 参数全放开，主优化频带 100~2000 Hz） */
  M2: BRAID_STRUCTURE_V1,
  /** 原始说明 V1.0 策略（兼容旧调用） */
  jcaV11: JCA_POROUS_V11,
} as const satisfies Record<string, CalibrationStrategy>;

/** 完整策略映射（含预留条目） */
export const STRATEGY_REGISTRY: Record<string, CalibrationStrategy> = {
  ...WOVEN_TUBE_STRATEGIES,
};

/** 按 (formulaId, modelVersion) 取策略，找不到回退 M0 */
export function getStrategy(
  formulaId: string,
  modelVersion: keyof typeof WOVEN_TUBE_STRATEGIES | string,
): CalibrationStrategy {
  if (formulaId !== 'acoustics.muffler.wovenTube') return JCA_POROUS_V11;
  return (
    WOVEN_TUBE_STRATEGIES[modelVersion as keyof typeof WOVEN_TUBE_STRATEGIES] ??
    BRAID_M0_V1
  );
}

export type ModelVersion = keyof typeof WOVEN_TUBE_STRATEGIES;
