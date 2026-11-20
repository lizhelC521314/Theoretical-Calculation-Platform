/**
 * 标量标定引擎：对标单一输出量（如赫姆霍兹中心频率 f0）。
 *
 * 与 run.ts（1/3 倍频带 TL 曲线拟合）并列，适用于"只有标量目标值"的场景：
 *   J = wf · Σ w_i · [(model_i − target_i)/target_i]^2 + λ·Σ[(θj−θj0)/sj]^2 + 边界罚
 *
 * 依据《赫姆霍兹消音器中心频率公式自动优化实施方案》第 5 章：
 *   H1 只放开 δ_total，目标仅中心频率相对误差；单样本只能"标定"不能"验证"。
 * 复用 math.ts 的多起点 Nelder-Mead、参数归一化、JᵀJ 协方差与 bootstrap。
 */

import type {
  BandRecord,
  CalibParamSpec,
  CalibrationReport,
  CalibrationStrategy,
  MetricCheck,
  Metrics,
  MultiStartSolution,
  ParamEstimate,
} from './types';
import {
  boundPenalty,
  fromU,
  isAtBound,
  latinHypercube,
  mulberry32,
  nelderMead,
  quantile,
  toU,
  tQuantile975,
  invertN,
  eigenvaluesSymmetricN,
} from './math';

/** 标量目标：一个工况的公式输入 + 目标值（如实测/CAE 中心频率） */
export interface ScalarSample {
  inputs: Record<string, number>;
  /** 目标值（与 model 返回同单位） */
  target: number;
  /** 样件/工况分组键，验证时按组划分 */
  groupId?: string;
}

/** 标量模型：输入（SI）+ 参数 → 单个输出量（如 f0） */
export type ScalarModel = (inputs: Record<string, number>, params: Record<string, number>) => number;

export interface CalibrateScalarOptions {
  strategy: CalibrationStrategy;
  /** 标定样本（每个 = 一个工况的几何 + 目标标量） */
  samples: ScalarSample[];
  /** 独立验证集；缺省仅声明"标定" */
  holdout?: ScalarSample[];
  model: ScalarModel;
  formulaVersion?: string;
  seed?: number;
  /** 关闭 bootstrap（快速模式/调试） */
  fast?: boolean;
  /** 目标量标签，写入报告（如 '中心频率 f0'） */
  targetLabel?: string;
  /** 目标单位（如 'Hz'） */
  targetUnit?: string;
}

interface SampleCalc {
  target: number;
  weight: number;
  model: number;
  residual: number;
  relErr: number;
  included: boolean;
  groupId?: string;
  inputs: Record<string, number>;
}

/* ---------------- 主流程 ---------------- */

export function calibrateScalar(opts: CalibrateScalarOptions): CalibrationReport {
  const { strategy, samples, holdout, model } = opts;
  const seed = opts.seed ?? 20261119;
  const rng = mulberry32(seed);
  const formulaVersion = opts.formulaVersion ?? 'unknown';
  const targetLabel = opts.targetLabel ?? strategy.target.output;
  const targetUnit = opts.targetUnit ?? strategy.target.unit;

  const tunable = strategy.params.filter((p) => p.role === 'tunable');
  if (tunable.length === 0) throw new Error('策略未声明可标定参数（H0 基线不参与优化）');
  const dim = tunable.length;

  // 样本过滤：目标值必须为正且有限
  const calc: SampleCalc[] = samples.map((s) => {
    const ok = Number.isFinite(s.target) && s.target > 0;
    return {
      target: s.target,
      weight: ok ? 1 : 0,
      model: Number.NaN,
      residual: Number.NaN,
      relErr: Number.NaN,
      included: ok,
      groupId: s.groupId,
      inputs: s.inputs,
    };
  });
  const includedIdx = calc.map((c, i) => (c.included ? i : -1)).filter((i) => i >= 0);
  if (includedIdx.length === 0) throw new Error('没有有效的目标标量样本');
  const sumW = includedIdx.reduce((s, i) => s + calc[i].weight, 0);
  if (sumW > 0) includedIdx.forEach((i) => (calc[i].weight /= sumW));

  const theta0 = tunable.map((p) => p.initial);
  const u0 = tunable.map((p, j) => toU(p, theta0[j]));
  const uRange = tunable.map((p, j) => {
    const lo = p.min !== undefined ? toU(p, p.min) : u0[j] - 0.5;
    const hi = p.max !== undefined ? toU(p, p.max) : u0[j] + 0.5;
    return [lo, hi] as [number, number];
  });
  const thetaOf = (u: number[]) => tunable.map((p, j) => fromU(p, u[j]));

  const paramsOf = (theta: number[]): Record<string, number> => {
    const out: Record<string, number> = {};
    tunable.forEach((p, j) => (out[p.key] = theta[j]));
    return out;
  };

  const evalSamples = (u: number[]): { vals: number[]; penalty: number } => {
    const theta = thetaOf(u);
    const params = paramsOf(theta);
    let penalty = 0;
    tunable.forEach((p, j) => (penalty += boundPenalty(p, theta[j])));
    const vals: number[] = includedIdx.map((i) => {
      const m = model(calc[i].inputs, params);
      return Number.isFinite(m) ? m : 1e9;
    });
    return { vals, penalty };
  };

  // 目标：相对误差平方 + 正则 + 边界罚（文档式12，H1 仅中心频率项）
  const objective = (u: number[]): number => {
    const { vals, penalty } = evalSamples(u);
    const theta = thetaOf(u);
    let J = 0;
    includedIdx.forEach((idx, k) => {
      const t = calc[idx].target;
      const e = (vals[k] - t) / t;
      J += calc[idx].weight * e * e;
    });
    let reg = 0;
    tunable.forEach((p, j) => {
      const s = Math.abs(p.scale) || 1;
      reg += Math.pow((theta[j] - p.initial) / s, 2);
    });
    J += strategy.objective.lambda * reg;
    return J + penalty;
  };

  /* ---- 多起点 ---- */
  const starts = Math.max(1, strategy.optimizer.starts);
  const lhs = latinHypercube(starts - 1, dim, rng);
  const seeds: number[][] = [u0.slice()];
  for (const row of lhs) {
    seeds.push(row.map((r, j) => uRange[j][0] + r * (uRange[j][1] - uRange[j][0])));
  }
  const solutions: MultiStartSolution[] = [];
  let evaluations = 0;
  let anyConverged = false;
  seeds.forEach((u, i) => {
    const r = nelderMead(objective, u, {
      step: 0.08,
      maxIter: strategy.optimizer.maxIter,
      tolF: strategy.optimizer.tolF,
      tolU: strategy.optimizer.tolU,
    });
    evaluations += r.evaluations;
    if (r.converged) anyConverged = true;
    solutions.push({ index: i, J: r.fx, params: paramsOf(thetaOf(r.x)), evaluations: r.evaluations });
  });
  solutions.sort((a, b) => a.J - b.J);
  const best = solutions[0];
  const bestU = tunable.map((p) => toU(p, best.params[p.key]));

  // 多解判定
  const top = solutions.slice(0, Math.min(3, solutions.length));
  let multiSolution = false;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      for (const p of tunable) {
        const a = top[i].params[p.key];
        const b = top[j].params[p.key];
        const s = Math.abs(p.scale) || Math.abs(a) || 1;
        if (Math.abs(a - b) / s > 0.05) multiSolution = true;
      }
    }
  }

  /* ---- 最优解逐样本记录 ---- */
  const { vals: bestVals } = evalSamples(bestU);
  includedIdx.forEach((idx, k) => {
    calc[idx].model = bestVals[k];
    calc[idx].residual = bestVals[k] - calc[idx].target;
    calc[idx].relErr = (bestVals[k] - calc[idx].target) / calc[idx].target;
  });
  // 合成 BandRecord：每个样本一条，center = 目标值，test = 目标，model = 模型
  const bandRecords: BandRecord[] = calc.map((c) => ({
    center: c.target,
    n: 1,
    coverage: c.included ? 1 : 0,
    test: c.target,
    model: c.model,
    residual: c.residual,
    weight: c.weight,
    included: c.included,
    reason: c.included ? undefined : '目标值无效（非有限或 ≤0）',
  }));

  /* ---- 指标（相对误差，单位 %） ---- */
  const relErrs = includedIdx.map((i) => calc[i].relErr);
  const n = relErrs.length;
  const rmseRel = Math.sqrt(relErrs.reduce((s, e) => s + e * e, 0) / n);
  const maeRel = relErrs.reduce((s, e) => s + Math.abs(e), 0) / n;
  const maxAbsRel = Math.max(...relErrs.map(Math.abs));
  const avgRel = relErrs.reduce((s, e) => s + e, 0) / n;
  const modelBest = includedIdx.map((i) => calc[i].model);
  const targetBest = includedIdx.map((i) => calc[i].target);
  const maxModel = Math.max(...modelBest);
  const minModel = Math.min(...modelBest);
  const peakFreqDevPct = Math.abs((maxModel - Math.max(...targetBest)) / Math.max(...targetBest)) * 100;
  void minModel;

  const relToPct = (x: number) => x * 100;
  const checks: MetricCheck[] = [
    { key: 'rmse', label: `RMSE（${targetUnit} 相对 %）`, value: relToPct(rmseRel), limit: 5.0, pass: relToPct(rmseRel) <= 5.0 },
    { key: 'mae', label: `MAE（${targetUnit} 相对 %）`, value: relToPct(maeRel), limit: 3.0, pass: relToPct(maeRel) <= 3.0 },
    { key: 'maxAbsBandErr', label: `最大相对误差（%）`, value: relToPct(maxAbsRel), limit: 8.0, pass: relToPct(maxAbsRel) <= 8.0 },
    { key: 'peakFreqDevPct', label: `峰值偏差（%）`, value: peakFreqDevPct, limit: 5.0, pass: peakFreqDevPct <= 5.0 },
    { key: 'bandAvgDev', label: `平均偏差（%）`, value: Math.abs(relToPct(avgRel)), limit: 3.0, pass: Math.abs(relToPct(avgRel)) <= 3.0 },
  ];
  const metrics: Metrics = {
    rmse: relToPct(rmseRel),
    mae: relToPct(maeRel),
    maxAbsBandErr: relToPct(maxAbsRel),
    peakFreqDevPct,
    bandAvgDev: relToPct(avgRel),
    checks,
  };

  /* ---- 不确定度（雅可比 ∂(相对残差)/∂θ） ---- */
  let covTheta: number[][] | null = null;
  let correlation: number[][] = [];
  let conditionNumber = Number.NaN;
  if (!opts.fast) {
    const jac = scalarJacobian(bestU, includedIdx.map((i) => calc[i]), tunable, model, thetaOf, paramsOf);
    if (jac) {
      const JtJ = new Array(dim).fill(0).map(() => new Array(dim).fill(0));
      for (let a = 0; a < dim; a++) {
        for (let b = 0; b < dim; b++) {
          let s = 0;
          for (let i = 0; i < n; i++) s += jac[i][a] * jac[i][b] * (calc[includedIdx[i]].weight || 0);
          JtJ[a][b] = s;
        }
      }
      const eig = eigenvaluesSymmetricN(JtJ).map((v) => Math.abs(v));
      const positive = eig.filter((v) => v > 1e-14);
      if (positive.length > 0) {
        conditionNumber = Math.sqrt(Math.max(...positive) / Math.min(...positive));
      }
      const sse = relErrs.reduce((s, e) => s + e * e, 0);
      const dof = Math.max(1, n - dim);
      const s2 = sse / dof;
      const inv = invertN(JtJ);
      if (inv) {
        const covU = inv.map((r) => r.map((v) => v * s2));
        const dTheta = tunable.map((p) => (p.transform === 'log' ? best.params[p.key] : Math.abs(p.scale) || 1));
        covTheta = new Array(dim).fill(0).map(() => new Array(dim).fill(0));
        for (let a = 0; a < dim; a++)
          for (let b = 0; b < dim; b++) covTheta[a][b] = dTheta[a] * covU[a][b] * dTheta[b];
        correlation = new Array(dim).fill(0).map(() => new Array(dim).fill(0));
        for (let a = 0; a < dim; a++)
          for (let b = 0; b < dim; b++) {
            const den = Math.sqrt(Math.abs(covTheta[a][a] * covTheta[b][b]));
            correlation[a][b] = den > 0 ? covTheta[a][b] / den : 0;
          }
      }
    }
  }
  const t = tQuantile975(Math.max(1, n - dim));
  let params: ParamEstimate[] = tunable.map((p, j) => {
    const se = covTheta ? Math.sqrt(Math.max(0, covTheta[j][j])) : Number.NaN;
    const theta = best.params[p.key];
    return {
      key: p.key,
      label: p.label,
      initial: p.initial,
      value: theta,
      stdErr: se,
      ci95: [theta - t * se, theta + t * se] as [number, number],
      atBound: isAtBound(p, theta),
      transform: p.transform,
    };
  });

  /* ---- bootstrap（按样本有放回重采样） ---- */
  if (!opts.fast && strategy.uncertainty.blockBootstrap && strategy.uncertainty.resamples > 0 && n > 1) {
    const boot = scalarBootstrap(bestU, includedIdx.map((i) => calc[i]), tunable, model, thetaOf, paramsOf,
      strategy.uncertainty.resamples, strategy.optimizer.maxIter, strategy.objective.lambda, rng);
    params = params.map((p, j) => ({
      ...p,
      ciBootstrap: [
        quantile(boot[j].slice().sort((a, b) => a - b), 0.025),
        quantile(boot[j].slice().sort((a, b) => a - b), 0.975),
      ] as [number, number],
    }));
  }

  /* ---- 独立验证 ---- */
  let validation: CalibrationReport['validation'] = {
    method: strategy.validation.method,
    status: n > 1 ? 'calibrated-only' : 'calibrated-only',
    note: n > 1
      ? `训练样本 ${n} 个，按说明只声明"标定"，需独立验证集才能声明"验证"`
      : '仅 1 个样本，按说明第 9 节只能"标定"，不能声明"验证"（CAE 单点仅作相关性初值）',
  };
  if (holdout && holdout.length > 0) {
    const hp = paramsOf(thetaOf(bestU));
    let hrSq = 0;
    let hcnt = 0;
    for (const s of holdout) {
      if (!(Number.isFinite(s.target) && s.target > 0)) continue;
      const m = model(s.inputs, hp);
      if (!Number.isFinite(m)) continue;
      const e = (m - s.target) / s.target;
      hrSq += e * e;
      hcnt++;
    }
    const hrmse = hcnt > 0 ? Math.sqrt(hrSq / hcnt) * 100 : Number.NaN;
    validation = {
      method: 'group-holdout',
      status: hcnt > 0 ? 'validated' : 'calibrated-only',
      note: `留出验证样本 ${hcnt} 个`,
      trainRmse: metrics.rmse,
      holdoutRmse: hrmse,
    };
  }

  /* ---- 告警 ---- */
  const warnings: string[] = [];
  if (n === 1) warnings.push('仅 1 个样本：单点只能标定一个参数，不能验证模型（按实施方案 §9）');
  if (n < tunable.length + 1) warnings.push(`样本数 ${n} ≤ 可调参数 ${tunable.length}，参数不可辨识，请勿发布`);
  if (multiSolution) warnings.push('前 3 个起点解的参数差异超过 5%，可能存在多解，不建议发布');
  if (Number.isFinite(conditionNumber) && conditionNumber > 1e8)
    warnings.push(`JᵀJ 条件数 ${conditionNumber.toExponential(2)} > 1e8，参数不可辨识`);
  const active = params.filter((p) => p.atBound).map((p) => p.key);
  if (active.length > 0) warnings.push(`参数贴边（active constraint）：${active.join('、')}，不宜直接报告对称置信区间`);
  const strong = correlation.some((row, a) => row.some((v, b) => a !== b && Math.abs(v) > 0.9));
  if (strong) warnings.push('存在相关系数绝对值 > 0.9 的参数，建议固定其一或补充 DOE 解耦');
  if (!anyConverged) warnings.push('所有起点均未达到收敛判据');

  return {
    strategy: { id: strategy.id, version: strategy.version, algorithm: 'multi-start nelder-mead (scalar)' },
    formula: { id: strategy.formulaId, version: formulaVersion },
    dataset: {
      id: `scalar-${samples.length}`,
      hash: `${samples.length}:${includedIdx.length}`,
      quantity: targetLabel,
      unit: targetUnit,
      points: samples.length,
      groupId: samples[0]?.groupId ?? 'scalar',
      inputs: samples[0]?.inputs ?? {},
    },
    bands: bandRecords,
    excludedBands: bandRecords.filter((b) => !b.included).map((b) => ({ center: b.center, reason: b.reason ?? '' })),
    objective: {
      J: best.J,
      huberDelta: strategy.objective.huberDelta,
      lambda: strategy.objective.lambda,
      lambdaPeak: 0,
      peakPenaltyEnabled: false,
    },
    optimizer: {
      engine: strategy.optimizer.engine,
      starts,
      evaluations,
      converged: anyConverged,
      solutions: top,
      multiSolution,
    },
    params,
    diagnostics: { correlation, conditionNumber, activeConstraints: active },
    metrics,
    validation,
    sensitivity: [],
    warnings,
    createdAt: new Date().toISOString(),
  };
}

/* ---------------- 数值雅可比（标量） ---------------- */

function scalarJacobian(
  u: number[],
  samples: SampleCalc[],
  tunable: CalibParamSpec[],
  model: ScalarModel,
  thetaOf: (u: number[]) => number[],
  paramsOf: (t: number[]) => Record<string, number>,
): number[][] | null {
  const p = u.length;
  if (p === 0) return null;
  const base: Record<string, number> = {};
  tunable.forEach((pp, j) => (base[pp.key] = thetaOf(u)[j]));
  const baseM = samples.map((s) => (Number.isFinite(model(s.inputs, base)) ? model(s.inputs, base) : 1e9));
  const out: number[][] = samples.map(() => new Array(p).fill(0));
  for (let j = 0; j < p; j++) {
    const h = Math.max(1e-7, Math.abs(u[j]) * 1e-4);
    const up = u.slice();
    up[j] += h;
    const pp = paramsOf(thetaOf(up));
    for (let i = 0; i < samples.length; i++) {
      const mp = Number.isFinite(model(samples[i].inputs, pp)) ? model(samples[i].inputs, pp) : 1e9;
      const t = samples[i].target;
      // ∂(relErr)/∂θj = (∂model/∂θj)/target
      out[i][j] = (mp - baseM[i]) / (h * t);
    }
  }
  return out;
}

/* ---------------- bootstrap ---------------- */

function scalarBootstrap(
  bestU: number[],
  samples: SampleCalc[],
  tunable: CalibParamSpec[],
  model: ScalarModel,
  thetaOf: (u: number[]) => number[],
  paramsOf: (t: number[]) => Record<string, number>,
  resamples: number,
  maxIter: number,
  lambda: number,
  rng: () => number,
): number[][] {
  const n = samples.length;
  const out: number[][] = bestU.map(() => []);
  const baseParams = paramsOf(thetaOf(bestU));
  for (let r = 0; r < resamples; r++) {
    // 有放回重采样
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(Math.floor(rng() * n));
    const sub = idx.map((k) => samples[k]);
    const objStar = (u: number[]): number => {
      const theta = thetaOf(u);
      const params = paramsOf(theta);
      let J = 0;
      for (const s of sub) {
        const m = Number.isFinite(model(s.inputs, params)) ? model(s.inputs, params) : 1e9;
        const e = (m - s.target) / s.target;
        J += e * e;
      }
      let reg = 0;
      tunable.forEach((p, j) => {
        const s = Math.abs(p.scale) || 1;
        reg += Math.pow((theta[j] - p.initial) / s, 2);
      });
      return J + lambda * reg;
    };
    const res = nelderMead(objStar, bestU, { step: 0.05, maxIter, tolF: 1e-7, tolU: 1e-5 });
    res.x.forEach((v, j) => out[j].push(fromU(tunable[j], v)));
  }
  void baseParams;
  return out;
}
