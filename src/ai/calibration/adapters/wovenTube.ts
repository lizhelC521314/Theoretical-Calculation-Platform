/**
 * 编织管模型的标定适配层：把 FormulaSpec 的物理计算接入标定引擎。
 * 复用 evalWovenTubeAt，保证标定与软件计算用的是同一套方程。
 */

import { evalWovenTubeAt, type WovenTubeCalib } from '../../../domains/acoustics/wovenTubeSilencer';
import type { ModelEval } from '../types';

/** 标定用的公式输入默认值（SI） */
export const WOVEN_TUBE_SI_DEFAULTS: Record<string, number> = {
  rho0: 1.205,
  c0: 343,
  gam: 1.4,
  P0: 101325,
};

export const wovenTubeModel: ModelEval = (inputs, params, freqs) => {
  const calib: WovenTubeCalib = {
    CR: params.C_R,
    AL: params.A_L,
    BL: params.B_L,
    epsilonL: Number.isFinite(params.epsilon_L) ? params.epsilon_L : 0,
    aHF: Number.isFinite(params.a_HF) ? params.a_HF : 0,
    fS: Number.isFinite(params.f_s) ? params.f_s : 0,
  };
  const v: Record<string, number> = {
    ...WOVEN_TUBE_SI_DEFAULTS,
    ...inputs,
  };
  return freqs.map((f) => {
    const r = evalWovenTubeAt(v, f, calib);
    return r ? r.TL : Number.NaN;
  });
};

/** 由毫米口径的几何参数构造 SI 输入 */
export function wovenTubeInputs(mm: {
  D: number;
  L: number;
  t: number;
  fp: number;
}): Record<string, number> {
  return {
    ...WOVEN_TUBE_SI_DEFAULTS,
    D: mm.D / 1000,
    L: mm.L / 1000,
    t: mm.t / 1000,
    fp: mm.fp,
  };
}
