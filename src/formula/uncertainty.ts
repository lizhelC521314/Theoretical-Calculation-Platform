/**
 * 不确定性分析：蒙特卡洛抽样 + 极值组合区间传播
 *
 * 工程意义：输入（材料物性、台架工况、设计尺寸）都有公差或测量误差，
 * 单点计算只能给出一个数，无法回答「结果可能落在什么范围、哪个输入影响最大」。
 * 本模块在 SI 输入空间扰动参数，统计输出的均值/标准差/分位数，并用输入全组合极值
 * 给出包络区间（参数数 ≤ 8 时精确枚举 2^k 个角点）。
 *
 * 全部使用固定种子的伪随机数，保证同一输入与配置下结果可复现（便于写测试与复核）。
 */
import { showIfMatches, type FormulaSpec, type ParamSpec } from './types';

/** 分布假设：normal 把 ±rel 视为 3σ；uniform 在 ±rel 内均匀取值 */
export type UncertaintyDist = 'normal' | 'uniform';

export interface UncertaintySpec {
  /** 输入参数 key */
  key: string;
  /** 相对不确定度（±比例），0.05 表示 ±5% */
  rel: number;
  dist: UncertaintyDist;
}

export interface UncertaintyOptions {
  /** 抽样次数，默认 2000，范围 100~5000 */
  samples?: number;
  seed?: number;
}

export interface InfluenceItem {
  key: string;
  label: string;
  /** 秩相关系数绝对值，0~1，越大影响越强 */
  score: number;
}

export interface OutputUncertainty {
  key: string;
  label: string;
  unit: string;
  unitGroup?: string;
  mean: number;
  std: number;
  /** 变异系数 = 标准差 / |均值| */
  cov: number;
  p5: number;
  p50: number;
  p95: number;
  /** 区间包络下限 / 上限 */
  low: number;
  high: number;
  /** corners = 输入极值全组合；samples = 样本包络（参数过多或角点求解失败时） */
  envelope: 'corners' | 'samples';
  influence: InfluenceItem[];
}

export interface UncertaintyResult {
  samples: number;
  seed: number;
  /** solve 抛错的样本数 */
  failed: number;
  /** 实际参与扰动的输入 */
  active: Array<{ key: string; label: string; rel: number; dist: UncertaintyDist }>;
  outputs: OutputUncertainty[];
}

/** mulberry32：小而稳定的可复现随机数发生器 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller 标准正态 */
function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 线性插值分位数，arr 必须已升序 */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 秩（并列取平均秩），用于秩相关，避免非线性映射被 Pearson 低估 */
function ranks(arr: number[]): number[] {
  const idx = arr.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
  const out = new Array<number>(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k].i] = r;
    i = j + 1;
  }
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return NaN;
  return cov / Math.sqrt(va * vb);
}

/** 输入极值全组合的包络（2^k 次求解） */
function cornerEnvelope(
  formula: FormulaSpec,
  base: Record<string, number>,
  active: Array<{ key: string; rel: number }>,
  outputKeys: string[],
): { low: Record<string, number>; high: Record<string, number> } {
  const low: Record<string, number> = {};
  const high: Record<string, number> = {};
  for (const k of outputKeys) {
    low[k] = Infinity;
    high[k] = -Infinity;
  }
  const n = active.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const s: Record<string, number> = { ...base };
    for (let j = 0; j < n; j++) {
      const a = active[j];
      const b = base[a.key];
      const d = Math.abs(b) * a.rel;
      s[a.key] = (mask >> j) & 1 ? b + d : b - d;
    }
    let out: Record<string, number>;
    try {
      out = formula.solve(s);
    } catch {
      continue;
    }
    for (const k of outputKeys) {
      const v = out[k];
      if (!Number.isFinite(v)) continue;
      if (v < low[k]) low[k] = v;
      if (v > high[k]) high[k] = v;
    }
  }
  return { low, high };
}

export function runUncertainty(
  formula: FormulaSpec,
  inputsSI: Record<string, number>,
  specs: UncertaintySpec[],
  options: UncertaintyOptions = {},
): UncertaintyResult {
  const samples = Math.min(5000, Math.max(100, Math.floor(options.samples ?? 2000)));
  const seed = options.seed ?? 20260101;

  // 只有当前可见的数值输入参与扰动；选择型与 showIf 隐藏的不参与
  const visible = formula.inputs.filter(
    (p): p is ParamSpec => showIfMatches(p.showIf, inputsSI) && p.kind !== 'select',
  );
  const active = specs
    .filter((s) => s.rel > 0)
    .map((s) => ({ spec: s, param: visible.find((p) => p.key === s.key) }))
    .filter((x): x is { spec: UncertaintySpec; param: ParamSpec } => !!x.param)
    .filter(({ param }) => {
      const v = inputsSI[param.key];
      return Number.isFinite(v) && v !== 0;
    })
    .map(({ spec, param }) => ({ key: param.key, label: param.label, rel: spec.rel, dist: spec.dist }));

  const visibleOutputs = formula.outputs.filter((o) => showIfMatches(o.showIf, inputsSI));

  // 没有可扰动输入：退化为基准结果（区间与均值都等于基准值）
  if (active.length === 0) {
    let base: Record<string, number> = {};
    try {
      base = formula.solve(inputsSI);
    } catch {
      base = {};
    }
    return {
      samples,
      seed,
      failed: 0,
      active,
      outputs: visibleOutputs
        .filter((o) => Number.isFinite(base[o.key]))
        .map((o) => {
          const v = base[o.key];
          return {
            key: o.key,
            label: o.label,
            unit: o.unit,
            unitGroup: o.unitGroup,
            mean: v,
            std: 0,
            cov: 0,
            p5: v,
            p50: v,
            p95: v,
            low: v,
            high: v,
            envelope: 'corners' as const,
            influence: [],
          };
        }),
    };
  }

  const rng = makeRng(seed);
  const drawn: Record<string, number[]> = {};
  for (const a of active) drawn[a.key] = [];
  const values: Record<string, number[]> = {};
  for (const o of visibleOutputs) values[o.key] = [];

  let failed = 0;
  for (let i = 0; i < samples; i++) {
    const sample: Record<string, number> = { ...inputsSI };
    for (const a of active) {
      const b = inputsSI[a.key];
      const spread = Math.abs(b) * a.rel;
      let x: number;
      if (a.dist === 'uniform') {
        x = b + (rng() * 2 - 1) * spread;
      } else {
        let z = gauss(rng);
        if (z > 3) z = 3;
        else if (z < -3) z = -3;
        x = b + (z / 3) * spread;
      }
      sample[a.key] = x;
      drawn[a.key].push(x);
    }
    let out: Record<string, number>;
    try {
      out = formula.solve(sample);
    } catch {
      failed++;
      continue;
    }
    for (const o of visibleOutputs) {
      const v = out[o.key];
      if (Number.isFinite(v)) values[o.key].push(v);
    }
  }

  // 参数 ≤ 8 时精确枚举极值角点，否则用样本包络
  const outputKeys = visibleOutputs.map((o) => o.key);
  const corner =
    active.length <= 8 ? cornerEnvelope(formula, inputsSI, active, outputKeys) : null;
  const drawnRanks: Record<string, number[]> = {};
  for (const a of active) drawnRanks[a.key] = ranks(drawn[a.key]);

  const outputs: OutputUncertainty[] = [];
  for (const o of visibleOutputs) {
    const arr = values[o.key];
    if (!arr.length) continue;
    const sorted = [...arr].sort((x, y) => x - y);
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const variance = arr.reduce((s, x) => s + (x - mean) * (x - mean), 0) / arr.length;
    const std = Math.sqrt(variance);
    const outRank = ranks(arr);
    const influence = active
      .map((a) => ({
        key: a.key,
        label: a.label,
        score: Math.abs(pearson(drawnRanks[a.key], outRank)),
      }))
      .filter((x) => Number.isFinite(x.score))
      .sort((x, y) => y.score - x.score)
      .slice(0, 3);

    const cLow = corner?.low[o.key] ?? NaN;
    const cHigh = corner?.high[o.key] ?? NaN;
    const useCorner = Number.isFinite(cLow) && Number.isFinite(cHigh);
    outputs.push({
      key: o.key,
      label: o.label,
      unit: o.unit,
      unitGroup: o.unitGroup,
      mean,
      std,
      cov: mean === 0 ? NaN : std / Math.abs(mean),
      p5: quantile(sorted, 0.05),
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      low: useCorner ? cLow : sorted[0],
      high: useCorner ? cHigh : sorted[sorted.length - 1],
      envelope: useCorner ? 'corners' : 'samples',
      influence,
    });
  }

  return { samples, seed, failed, active, outputs };
}
