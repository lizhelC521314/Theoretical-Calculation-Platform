/**
 * 标定引擎数学工具：1/3 倍频带、Huber 损失、参数变换、LHS、Nelder-Mead、
 * t 分位、对称矩阵特征值（条件数用）。
 */

import type { CalibParamSpec, DatasetPoint, ParamTransform } from './types';

/* ---------------- 1/3 倍频带 ---------------- */

/** GB/ISO 标称 1/3 倍频带中心频率（Hz） */
const NOMINAL_CENTERS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
];

/** 频带上下边界系数 fc·2^(±1/6) */
export const BAND_EDGE = Math.pow(2, 1 / 6);

export function nominalCenters(minHz: number, maxHz: number): number[] {
  return NOMINAL_CENTERS.filter((c) => c >= minHz && c <= maxHz);
}

export interface RawBand {
  center: number;
  n: number;
  coverage: number;
  mean: number;
}

/** 按中心频率聚合实测点；coverage = 带内实测频率跨度 / 频带宽度 */
export function aggregateBand(points: DatasetPoint[], center: number): RawBand {
  const lo = center / BAND_EDGE;
  const hi = center * BAND_EDGE;
  let n = 0;
  let sum = 0;
  let fmin = Infinity;
  let fmax = -Infinity;
  for (const p of points) {
    if (p.f >= lo && p.f < hi && Number.isFinite(p.y)) {
      n += 1;
      sum += p.y;
      if (p.f < fmin) fmin = p.f;
      if (p.f > fmax) fmax = p.f;
    }
  }
  const width = hi - lo;
  const coverage = n > 0 ? Math.min(1, (fmax - fmin) / width) : 0;
  return { center, n, coverage, mean: n > 0 ? sum / n : NaN };
}

/* ---------------- Huber 稳健损失 ---------------- */

/** ρδ(e)：|e| ≤ δ 用平方，否则线性（式 3） */
export function huber(e: number, delta: number): number {
  const a = Math.abs(e);
  return a <= delta ? 0.5 * e * e : delta * (a - delta / 2);
}

/* ---------------- 参数变换 ---------------- */

/** θ → u（式 7）：C_R 取 ln，A_L/B_L 按初值缩放 */
export function toU(spec: CalibParamSpec, theta: number): number {
  return spec.transform === 'log' ? Math.log(theta) : theta / spec.scale;
}

/** u → θ */
export function fromU(spec: CalibParamSpec, u: number): number {
  return spec.transform === 'log' ? Math.exp(u) : u * spec.scale;
}

/** 边界罚函数（不用反射边界，式 6.3）：越界量按尺度平方惩罚 */
export function boundPenalty(spec: CalibParamSpec, theta: number, weight = 1e3): number {
  let p = 0;
  const s = spec.scale !== 0 ? Math.abs(spec.scale) : 1;
  if (spec.min !== undefined && theta < spec.min) p += Math.pow((spec.min - theta) / s, 2);
  if (spec.max !== undefined && theta > spec.max) p += Math.pow((theta - spec.max) / s, 2);
  return weight * p;
}

/** 最优解是否贴边（相对容差 1e-3） */
export function isAtBound(spec: CalibParamSpec, theta: number): boolean {
  const s = spec.scale !== 0 ? Math.abs(spec.scale) : 1;
  const tol = 1e-3 * s;
  if (spec.min !== undefined && Math.abs(theta - spec.min) <= tol) return true;
  if (spec.max !== undefined && Math.abs(theta - spec.max) <= tol) return true;
  return false;
}

/* ---------------- 随机数与 LHS ---------------- */

/** mulberry32：同一种子可复现 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Latin 超立方采样：n 个样本、d 维，返回 [0,1)^d */
export function latinHypercube(n: number, d: number, rng: () => number): number[][] {
  const out: number[][] = [];
  const perms: number[][] = [];
  for (let j = 0; j < d; j++) {
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const k = Math.floor(rng() * (i + 1));
      [idx[i], idx[k]] = [idx[k], idx[i]];
    }
    perms.push(idx);
  }
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < d; j++) row.push((perms[j][i] + rng()) / n);
    out.push(row);
  }
  return out;
}

/* ---------------- Nelder-Mead ---------------- */

export interface NmOptions {
  step?: number;
  maxIter?: number;
  tolF?: number;
  tolU?: number;
}

export interface NmResult {
  x: number[];
  fx: number;
  evaluations: number;
  converged: boolean;
}

/**
 * 单纯形法（无导数）。收敛判据按说明 7.2：
 * |J_k − J_{k−1}| / max(1,|J_k|) < tolF 且 max|Δu| < tolU。
 */
export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  opts: NmOptions = {},
): NmResult {
  const step = opts.step ?? 0.08;
  const maxIter = opts.maxIter ?? 2000;
  const tolF = opts.tolF ?? 1e-6;
  const tolU = opts.tolU ?? 1e-4;
  const d = x0.length;
  let evals = 0;
  const evalF = (x: number[]) => {
    evals += 1;
    const v = f(x);
    return Number.isFinite(v) ? v : 1e30;
  };

  const pts: number[][] = [x0.slice()];
  for (let i = 0; i < d; i++) {
    const p = x0.slice();
    p[i] += step;
    pts.push(p);
  }
  const vals = pts.map(evalF);

  let prevBest = Infinity;
  let converged = false;
  for (let it = 0; it < maxIter; it++) {
    const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
    const sortedPts = order.map((i) => pts[i]);
    const sortedVals = order.map((i) => vals[i]);
    for (let i = 0; i < d + 1; i++) {
      pts[i] = sortedPts[i];
      vals[i] = sortedVals[i];
    }

    const best = vals[0];
    const worst = vals[d];
    const spread = Math.max(
      ...pts.slice(1).map((p) => Math.max(...p.map((v, i) => Math.abs(v - pts[0][i])))),
    );
    const relF = Math.abs(best - prevBest) / Math.max(1, Math.abs(best));
    if (it > 0 && relF < tolF && spread < tolU) {
      converged = true;
      break;
    }
    prevBest = best;

    const centroid = new Array(d).fill(0);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) centroid[j] += pts[i][j] / d;

    const xr = centroid.map((c, j) => c + (c - pts[d][j]));
    const fr = evalF(xr);
    if (fr < vals[0]) {
      const xe = centroid.map((c, j) => c + 2 * (c - pts[d][j]));
      const fe = evalF(xe);
      if (fe < fr) {
        pts[d] = xe;
        vals[d] = fe;
      } else {
        pts[d] = xr;
        vals[d] = fr;
      }
      continue;
    }
    if (fr < vals[d - 1]) {
      pts[d] = xr;
      vals[d] = fr;
      continue;
    }
    const xc = centroid.map((c, j) => c + 0.5 * (pts[d][j] - c));
    const fc = evalF(xc);
    if (fc < vals[d]) {
      pts[d] = xc;
      vals[d] = fc;
      continue;
    }
    for (let i = 1; i <= d; i++) {
      pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j]));
      vals[i] = evalF(pts[i]);
    }
    void worst;
  }

  let bi = 0;
  for (let i = 1; i < vals.length; i++) if (vals[i] < vals[bi]) bi = i;
  return { x: pts[bi].slice(), fx: vals[bi], evaluations: evals, converged };
}

/* ---------------- 统计工具 ---------------- */

/** Student t 的 0.975 分位（双侧 95%）；df > 30 用 1.96 */
const T975 = [
  0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export function tQuantile975(df: number): number {
  if (df < 1) return Number.NaN;
  if (df <= 30) return T975[Math.round(df)];
  return 1.96;
}

/** 对称矩阵特征值（Jacobi 迭代），用于 JᵀJ 条件数。已支持任意 N×N */
export function eigenvaluesSymmetric3(m: number[][]): number[] {
  return eigenvaluesSymmetricN(m);
}

/** 对称矩阵特征值（Jacobi 迭代），N×N 通用实现 */
export function eigenvaluesSymmetricN(m: number[][]): number[] {
  const a = m.map((r) => r.slice());
  const n = a.length;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
      }
    }
  }
  return a.map((r, i) => r[i]);
}

/** 3×3 矩阵求逆（伴随矩阵法），奇异时返回 null。已委托给通用 invertN */
export function invert3(m: number[][]): number[][] | null {
  return invertN(m);
}

/** N×N 矩阵求逆（Gauss-Jordan 带部分主元）。奇异时返回 null */
export function invertN(m: number[][]): number[][] | null {
  const n = m.length;
  if (n === 0) return [];
  if (m.some((r) => r.length !== n)) return null;
  // 增广矩阵 [A | I]
  const aug: number[][] = m.map((row, i) => {
    const r = row.slice();
    for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0);
    return r;
  });
  for (let col = 0; col < n; col++) {
    // 选主元
    let pivot = col;
    let pivotVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(aug[row][col]);
      if (v > pivotVal) {
        pivotVal = v;
        pivot = row;
      }
    }
    if (pivotVal < 1e-20) return null; // 奇异
    if (pivot !== col) [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    const div = aug[col][col];
    for (let j = col; j < 2 * n; j++) aug[col][j] /= div;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      if (Math.abs(factor) < 1e-30) continue;
      for (let j = col; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }
  return aug.map((r) => r.slice(n, 2 * n));
}

/** 分位数（线性插值），输入需已排序 */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 变换类型辅助（供外部构造策略时使用） */
export function describeTransform(t: ParamTransform): string {
  return t === 'log' ? 'ln' : 'scale';
}
