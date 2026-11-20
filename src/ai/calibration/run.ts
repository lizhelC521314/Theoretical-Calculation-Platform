/**
 * 标定编排器：有效频带 → 权重 → 稳健目标 → 多起点 Nelder-Mead →
 * 协方差/ bootstrap → 指标与验证 → CalibrationReport
 *
 * 依据《编织管传递损失模型参数标定算法说明》V1.0 第 4~9 章。
 */

import type {
  BandRecord,
  CalibParamSpec,
  CalibrationDataset,
  CalibrationReport,
  CalibrationStrategy,
  MetricCheck,
  Metrics,
  ModelEval,
  MultiStartSolution,
  ParamEstimate,
  SensitivityRow,
} from './types';
import {
  aggregateBand,
  BAND_EDGE,
  boundPenalty,
  fromU,
  huber,
  invert3,
  isAtBound,
  latinHypercube,
  mulberry32,
  nelderMead,
  nominalCenters,
  quantile,
  tQuantile975,
  toU,
  eigenvaluesSymmetric3,
} from './math';

export interface CalibrateOptions {
  strategy: CalibrationStrategy;
  dataset: CalibrationDataset;
  /** 独立验证集（按样件/工况分组留出）；缺省则仅声明"标定" */
  holdout?: CalibrationDataset;
  model: ModelEval;
  formulaVersion?: string;
  seed?: number;
  /** 关闭 bootstrap 与 f_p 敏感性（单元测试用） */
  fast?: boolean;
}

interface BandCalc {
  center: number;
  n: number;
  coverage: number;
  test: number;
  weight: number;
  included: boolean;
  reason?: string;
}

const METRIC_LIMITS = {
  rmse: 1.5,
  mae: 1.0,
  maxAbsBandErr: 3.0,
  peakFreqDevPct: 5.0,
  bandAvgDev: 1.5,
};

/* ---------------- 频带与权重 ---------------- */

function prepareBands(dataset: CalibrationDataset, strategy: CalibrationStrategy): BandCalc[] {
  const centers = nominalCenters(strategy.bands.minHz, strategy.bands.maxHz);
  const raw = centers.map((c) => aggregateBand(dataset.points, c));
  // 频带覆盖按"实测数据支撑范围"判定，避免因频率分辨率粗而被误判为未覆盖
  let dataMin = Infinity;
  let dataMax = -Infinity;
  for (const p of dataset.points) {
    if (Number.isFinite(p.f) && Number.isFinite(p.y)) {
      if (p.f < dataMin) dataMin = p.f;
      if (p.f > dataMax) dataMax = p.f;
    }
  }
  const out: BandCalc[] = [];
  for (const b of raw) {
    const lo = b.center / BAND_EDGE;
    const hi = b.center * BAND_EDGE;
    const overlap = Math.max(0, Math.min(hi, dataMax) - Math.max(lo, dataMin));
    const coverage = Math.min(1, overlap / (hi - lo));
    let included = true;
    let reason: string | undefined;
    if (b.n === 0) {
      included = false;
      reason = '带内无实测点（超出测试有效范围）';
    } else if (b.n < 3) {
      included = false;
      reason = `带内仅 ${b.n} 点，不足以取平均`;
    } else if (coverage < strategy.bands.minCoverage) {
      included = false;
      reason = `频带覆盖不足（${(coverage * 100).toFixed(0)}% < ${(strategy.bands.minCoverage * 100).toFixed(0)}%）`;
    }
    const weight = !included
      ? 0
      : b.center < strategy.bands.dropBelowHz
        ? strategy.bands.lowBandWeight
        : 1;
    out.push({
      center: b.center,
      n: b.n,
      coverage,
      test: b.mean,
      weight,
      included,
      reason,
    });
  }
  const sum = out.reduce((s, b) => s + b.weight, 0);
  if (sum > 0) for (const b of out) b.weight /= sum;
  return out;
}

/* ---------------- 峰值 ---------------- */

/** 对数频率上的三点抛物线插值，取峰值频率 */
function peakOf(values: number[], centers: number[]): { f: number; v: number } {
  if (values.length === 0) return { f: Number.NaN, v: Number.NaN };
  let k = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[k]) k = i;
  if (k === 0 || k === values.length - 1) return { f: centers[k], v: values[k] };
  const x1 = Math.log(centers[k - 1]);
  const x2 = Math.log(centers[k]);
  const x3 = Math.log(centers[k + 1]);
  const y1 = values[k - 1];
  const y2 = values[k];
  const y3 = values[k + 1];
  const denom = (x1 - x2) * (x1 - x3) * (x2 - x3);
  if (Math.abs(denom) < 1e-12) return { f: centers[k], v: values[k] };
  const A = (x3 * (y2 - y1) + x2 * (y1 - y3) + x1 * (y3 - y2)) / denom;
  const Bq = (x3 * x3 * (y1 - y2) + x2 * x2 * (y3 - y1) + x1 * x1 * (y2 - y3)) / denom;
  if (Math.abs(A) < 1e-30) return { f: centers[k], v: values[k] };
  const xv = -Bq / (2 * A);
  const yv = A * xv * xv + Bq * xv + (y1 - A * x1 * x1 - Bq * x1);
  if (!Number.isFinite(xv) || xv <= x1 || xv >= x3) return { f: centers[k], v: values[k] };
  return { f: Math.exp(xv), v: yv };
}

/* ---------------- 主流程 ---------------- */

export function calibrate(opts: CalibrateOptions): CalibrationReport {
  const { strategy, dataset, holdout, model } = opts;
  const seed = opts.seed ?? 20261118;
  const rng = mulberry32(seed);
  const formulaVersion = opts.formulaVersion ?? 'unknown';

  const tunable = strategy.params.filter((p) => p.role === 'tunable');
  if (tunable.length === 0) throw new Error('策略未声明可标定参数');
  const dim = tunable.length;

  const bands = prepareBands(dataset, strategy);
  const includedIdx = bands.map((b, i) => (b.included ? i : -1)).filter((i) => i >= 0);
  const centers = includedIdx.map((i) => bands[i].center);
  const testVals = includedIdx.map((i) => bands[i].test);
  const weights = includedIdx.map((i) => bands[i].weight);

  const theta0 = tunable.map((p) => p.initial);
  const u0 = tunable.map((p, j) => toU(p, theta0[j]));

  // u 空间采样范围：优先用参数上下限；无界时取初值 ±50%
  const uRange = tunable.map((p, j) => {
    const lo = p.min !== undefined ? toU(p, p.min) : u0[j] - 0.5;
    const hi = p.max !== undefined ? toU(p, p.max) : u0[j] + 0.5;
    return [lo, hi] as [number, number];
  });

  const thetaOf = (u: number[]) => tunable.map((p, j) => fromU(p, u[j]));

  const bandModel = (u: number[]): number[] => {
    const theta = thetaOf(u);
    const params: Record<string, number> = {};
    tunable.forEach((p, j) => {
      params[p.key] = theta[j];
    });
    return model(dataset.inputs, params, centers);
  };

  const modelVals = (u: number[]) => {
    const vals = bandModel(u);
    let penalty = 0;
    tunable.forEach((p, j) => {
      penalty += boundPenalty(p, thetaOf(u)[j]);
    });
    return { vals, penalty };
  };

  // 峰值是否显著（决定是否启用 λ_p）
  const testPeak = peakOf(testVals, centers);
  const ends = [testVals[0], testVals[testVals.length - 1]];
  const prominence = testPeak.v - Math.max(...ends);
  const peakPenaltyEnabled = prominence >= strategy.objective.peakProminence;

  const objective = (u: number[]): number => {
    const { vals, penalty } = modelVals(u);
    const theta = thetaOf(u);
    let J = 0;
    for (let i = 0; i < vals.length; i++) {
      const v = Number.isFinite(vals[i]) ? vals[i] : 1e6;
      J += weights[i] * huber(v - testVals[i], strategy.objective.huberDelta);
    }
    if (peakPenaltyEnabled) {
      const mp = peakOf(vals, centers);
      J += strategy.objective.lambdaPeak * Math.pow((mp.f - testPeak.f) / testPeak.f, 2);
    }
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
    const theta = thetaOf(r.x);
    const params: Record<string, number> = {};
    tunable.forEach((p, j) => {
      params[p.key] = theta[j];
    });
    solutions.push({ index: i, J: r.fx, params, evaluations: r.evaluations });
  });
  solutions.sort((a, b) => a.J - b.J);
  const best = solutions[0];
  const bestU = tunable.map((p) => toU(p, best.params[p.key]));

  // 多解判定：前 3 个解任一参数相对差异 > 5%
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

  /* ---- 最优解下的频带记录 ---- */
  const { vals: bestVals } = modelVals(bestU);
  const bandRecords: BandRecord[] = bands.map((b, i) => {
    const k = includedIdx.indexOf(i);
    const mv = k >= 0 ? bestVals[k] : Number.NaN;
    return {
      center: b.center,
      n: b.n,
      coverage: b.coverage,
      test: b.test,
      model: mv,
      residual: k >= 0 ? mv - b.test : Number.NaN,
      weight: b.weight,
      included: b.included,
      reason: b.reason,
    };
  });

  /* ---- 指标 ---- */
  const residuals = bestVals.map((v, i) => v - testVals[i]);
  const n = residuals.length;
  const rmse = Math.sqrt(residuals.reduce((s, e) => s + e * e, 0) / n);
  const mae = residuals.reduce((s, e) => s + Math.abs(e), 0) / n;
  const maxAbsBandErr = Math.max(...residuals.map(Math.abs));
  const bandAvgDev = residuals.reduce((s, e) => s + e, 0) / n;
  const modelPeak = peakOf(bestVals, centers);
  const peakFreqDevPct = Math.abs((modelPeak.f - testPeak.f) / testPeak.f) * 100;

  const checks: MetricCheck[] = [
    { key: 'rmse', label: 'RMSE', value: rmse, limit: METRIC_LIMITS.rmse, pass: rmse <= METRIC_LIMITS.rmse },
    { key: 'mae', label: 'MAE', value: mae, limit: METRIC_LIMITS.mae, pass: mae <= METRIC_LIMITS.mae },
    { key: 'maxAbsBandErr', label: '最大单带误差', value: maxAbsBandErr, limit: METRIC_LIMITS.maxAbsBandErr, pass: maxAbsBandErr <= METRIC_LIMITS.maxAbsBandErr },
    { key: 'peakFreqDevPct', label: '峰值频率偏差(%)', value: peakFreqDevPct, limit: METRIC_LIMITS.peakFreqDevPct, pass: peakFreqDevPct <= METRIC_LIMITS.peakFreqDevPct },
    { key: 'bandAvgDev', label: '带内平均偏差', value: Math.abs(bandAvgDev), limit: METRIC_LIMITS.bandAvgDev, pass: Math.abs(bandAvgDev) <= METRIC_LIMITS.bandAvgDev },
  ];
  const metrics: Metrics = { rmse, mae, maxAbsBandErr, peakFreqDevPct, bandAvgDev, checks };

  /* ---- 不确定度 ---- */
  const jac = opts.fast ? null : jacobian(bestU, bestVals, testVals, weights, modelVals);
  let covTheta: number[][] | null = null;
  let correlation: number[][] = [];
  let conditionNumber = Number.NaN;
  if (jac) {
    const JtJ = new Array(dim).fill(0).map(() => new Array(dim).fill(0));
    for (let a = 0; a < dim; a++) {
      for (let b = 0; b < dim; b++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += jac[i][a] * jac[i][b];
        JtJ[a][b] = s;
      }
    }
    const eig = eigenvaluesSymmetric3(JtJ).map((v) => Math.abs(v));
    const positive = eig.filter((v) => v > 1e-12);
    if (positive.length > 0) {
      conditionNumber = Math.sqrt(Math.max(...positive) / Math.min(...positive));
    }
    const sse = residuals.reduce((s, e) => s + e * e, 0);
    const dof = Math.max(1, n - dim);
    const s2 = sse / dof;
    const inv = invert3(JtJ);
    if (inv) {
      const covU = inv.map((r) => r.map((v) => v * s2));
      const dTheta = tunable.map((p) => (p.transform === 'log' ? best.params[p.key] : Math.abs(p.scale) || 1));
      covTheta = new Array(dim).fill(0).map(() => new Array(dim).fill(0));
      for (let a = 0; a < dim; a++) {
        for (let b = 0; b < dim; b++) {
          covTheta[a][b] = dTheta[a] * covU[a][b] * dTheta[b];
        }
      }
      correlation = new Array(dim).fill(0).map(() => new Array(dim).fill(0));
      for (let a = 0; a < dim; a++) {
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

  /* ---- 分块 bootstrap ---- */
  if (!opts.fast && strategy.uncertainty.blockBootstrap && strategy.uncertainty.resamples > 0) {
    const boot = blockBootstrap(bestU, residuals, weights, tunable, modelVals,
      strategy.uncertainty.resamples, strategy.uncertainty.blockSize, strategy.optimizer.maxIter);
    params = params.map((p, j) => ({
      ...p,
      ciBootstrap: [quantile(boot[j].slice().sort((a, b) => a - b), 0.025), quantile(boot[j].slice().sort((a, b) => a - b), 0.975)] as [number, number],
    }));
  }

  /* ---- 独立验证 ---- */
  let validation: CalibrationReport['validation'] = {
    method: strategy.validation.method,
    status: 'calibrated-only',
    note: '仅一条工况曲线，按说明第 9.1 节只声明"标定"，不声明"验证"',
  };
  if (holdout) {
    const hb = prepareBands(holdout, strategy);
    const hidx = hb.map((b, i) => (b.included ? i : -1)).filter((i) => i >= 0);
    const hc = hidx.map((i) => hb[i].center);
    const ht = hidx.map((i) => hb[i].test);
    const hp: Record<string, number> = {};
    tunable.forEach((p) => {
      hp[p.key] = best.params[p.key];
    });
    for (const p of strategy.params) if (p.role !== 'tunable') hp[p.key] = p.initial;
    const hm = model(holdout.inputs, hp, hc);
    const he = hm.map((v, i) => v - ht[i]);
    const hrmse = Math.sqrt(he.reduce((s, e) => s + e * e, 0) / Math.max(1, he.length));
    validation = {
      method: 'group-holdout',
      status: 'validated',
      note: `按样件分组留出 ${holdout.groupId}，验证频带 ${hc.length} 个`,
      trainRmse: rmse,
      holdoutRmse: hrmse,
    };
  }

  /* ---- f_p ±10% 敏感性 ---- */
  const sensitivity: SensitivityRow[] = [];
  if (!opts.fast) {
    for (const scale of [0.9, 1.1]) {
      const alt: CalibrationDataset = {
        ...dataset,
        inputs: { ...dataset.inputs, fp: dataset.inputs.fp * scale },
      };
      const altBands = prepareBands(alt, strategy);
      const idx = altBands.map((b, i) => (b.included ? i : -1)).filter((i) => i >= 0);
      const ac = idx.map((i) => altBands[i].center);
      const at = idx.map((i) => altBands[i].test);
      const params2: Record<string, number> = {};
      tunable.forEach((p) => {
        params2[p.key] = best.params[p.key];
      });
      for (const p of strategy.params) if (p.role !== 'tunable') params2[p.key] = p.initial;
      const av = model(alt.inputs, params2, ac);
      const ae = av.map((v, i) => v - at[i]);
      sensitivity.push({
        fpScale: scale,
        fp: alt.inputs.fp,
        params: params2,
        rmse: Math.sqrt(ae.reduce((s, e) => s + e * e, 0) / Math.max(1, ae.length)),
      });
    }
  }

  /* ---- 告警 ---- */
  const warnings: string[] = [];
  if (includedIdx.length < 10) warnings.push(`有效频带仅 ${includedIdx.length} 个，标定稳健性不足`);
  if (!peakPenaltyEnabled) warnings.push(`峰值不显著（突出量 ${prominence.toFixed(1)} dB < ${strategy.objective.peakProminence} dB），未启用峰值惩罚`);
  if (multiSolution) warnings.push('前 3 个起点解的参数差异超过 5%，可能存在多解，不建议发布');
  if (Number.isFinite(conditionNumber) && conditionNumber > 1e8) warnings.push(`JᵀJ 条件数 ${conditionNumber.toExponential(2)} > 1e8，参数不可辨识`);
  const active = params.filter((p) => p.atBound).map((p) => p.key);
  if (active.length > 0) warnings.push(`参数贴边（active constraint）：${active.join('、')}，不宜直接报告对称置信区间`);
  const strong = correlation.some((row, a) => row.some((v, b) => a !== b && Math.abs(v) > 0.9));
  if (strong) warnings.push('存在相关系数绝对值 > 0.9 的参数，建议固定其一');
  for (const p of params) {
    if (p.ciBootstrap && Number.isFinite(p.stdErr) && p.stdErr > 0) {
      const half = (p.ciBootstrap[1] - p.ciBootstrap[0]) / 2;
      if (half > 1.5 * t * p.stdErr) warnings.push(`${p.key} 的 bootstrap 区间明显宽于解析区间，以 bootstrap 为准`);
    }
  }
  if (!anyConverged) warnings.push('所有起点均未达到收敛判据');

  return {
    strategy: { id: strategy.id, version: strategy.version, algorithm: 'multi-start nelder-mead' },
    formula: { id: dataset.formulaId, version: formulaVersion },
    dataset: {
      id: dataset.id,
      hash: dataset.hash,
      quantity: dataset.quantity,
      unit: dataset.unit,
      points: dataset.points.length,
      groupId: dataset.groupId,
      inputs: dataset.inputs,
    },
    bands: bandRecords,
    excludedBands: bandRecords.filter((b) => !b.included).map((b) => ({ center: b.center, reason: b.reason ?? '' })),
    objective: {
      J: best.J,
      huberDelta: strategy.objective.huberDelta,
      lambda: strategy.objective.lambda,
      lambdaPeak: peakPenaltyEnabled ? strategy.objective.lambdaPeak : 0,
      peakPenaltyEnabled,
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
    sensitivity,
    warnings,
    createdAt: new Date().toISOString(),
  };
}

/* ---------------- 数值雅可比 ---------------- */

function jacobian(
  u: number[],
  modelVals: number[],
  testVals: number[],
  weights: number[],
  evalModel: (u: number[]) => { vals: number[]; penalty: number },
): number[][] {
  const n = modelVals.length;
  const p = u.length;
  const out = new Array(n).fill(0).map(() => new Array(p).fill(0));
  for (let j = 0; j < p; j++) {
    const h = Math.max(1e-5, Math.abs(u[j]) * 1e-4);
    const up = u.slice();
    const um = u.slice();
    up[j] += h;
    um[j] -= h;
    const vp = evalModel(up).vals;
    const vm = evalModel(um).vals;
    for (let i = 0; i < n; i++) {
      const rp = Math.sqrt(weights[i]) * (vp[i] - testVals[i]);
      const rm = Math.sqrt(weights[i]) * (vm[i] - testVals[i]);
      out[i][j] = (rp - rm) / (2 * h);
    }
  }
  void modelVals;
  return out;
}

/* ---------------- 分块 bootstrap ---------------- */

function blockBootstrap(
  bestU: number[],
  residuals: number[],
  weights: number[],
  tunable: CalibParamSpec[],
  evalModel: (u: number[]) => { vals: number[]; penalty: number },
  resamples: number,
  blockSize: number,
  maxIter: number,
): number[][] {
  const n = residuals.length;
  const rng = mulberry32(424242);
  const blocks: number[][] = [];
  for (let i = 0; i < n; i += blockSize) blocks.push(residuals.slice(i, i + blockSize));
  const out: number[][] = bestU.map(() => []);
  const baseVals = evalModel(bestU).vals;
  for (let r = 0; r < resamples; r++) {
    const synth: number[] = [];
    while (synth.length < n) {
      const b = blocks[Math.floor(rng() * blocks.length)];
      for (const v of b) if (synth.length < n) synth.push(v);
    }
    // residuals = model − test，误差 e = test − model = −residual
    const testStar = baseVals.map((v, i) => v - synth[i]);
    const objStar = (u: number[]) => {
      const { vals, penalty } = evalModel(u);
      let J = 0;
      for (let i = 0; i < n; i++) J += weights[i] * huber(vals[i] - testStar[i], 2);
      return J + penalty;
    };
    const res = nelderMead(objStar, bestU, { step: 0.02, maxIter, tolF: 1e-6, tolU: 1e-4 });
    res.x.forEach((v, j) => out[j].push(fromU(tunable[j], v)));
  }
  return out;
}

/* ---------------- 联合标定：按数据源分别评估 ---------------- */

export interface SourceMetrics {
  /** 数据源标识（联合标定时用于区分各条试验数据） */
  id: string;
  /** 原始点数量 */
  points: number;
  /** 参与评估的有效频带数 */
  bands: number;
  rmse: number;
  mae: number;
  maxAbsBandErr: number;
  peakFreqDevPct: number;
}

/**
 * 在给定参数下单独评估一个数据源。
 * 联合标定只输出整体指标，无法看出某一条数据是否偏离；
 * 该函数用同一套参数与频带口径逐条复算，便于识别异常样件/工况。
 */
export function evaluateSourceMetrics(
  dataset: CalibrationDataset,
  strategy: CalibrationStrategy,
  params: Record<string, number>,
  model: ModelEval,
): SourceMetrics | null {
  const bands = prepareBands(dataset, strategy).filter((b) => b.included);
  if (bands.length === 0) return null;
  const centers = bands.map((b) => b.center);
  const testVals = bands.map((b) => b.test);
  const modelVals = model(dataset.inputs, params, centers);
  const residuals = modelVals.map((v, i) => v - testVals[i]);
  const n = residuals.length;
  const rmse = Math.sqrt(residuals.reduce((s, e) => s + e * e, 0) / n);
  const mae = residuals.reduce((s, e) => s + Math.abs(e), 0) / n;
  const maxAbsBandErr = Math.max(...residuals.map(Math.abs));
  const testPeak = peakOf(testVals, centers);
  const modelPeak = peakOf(modelVals, centers);
  const peakFreqDevPct =
    Number.isFinite(testPeak.f) && testPeak.f > 0
      ? Math.abs((modelPeak.f - testPeak.f) / testPeak.f) * 100
      : Number.NaN;
  return {
    id: dataset.id,
    points: dataset.points.length,
    bands: n,
    rmse,
    mae,
    maxAbsBandErr,
    peakFreqDevPct,
  };
}
