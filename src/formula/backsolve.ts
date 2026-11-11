/**
 * 反算求解：给定目标输出值，反推某个输入参数
 *
 * 正向计算回答「给定参数得到什么结果」；设计校核常要反过来问——
 * 「压降不得超过 0.5 kPa，滤材厚度最小取多少？」「寿命要 ≥ 800 h，面速度需要压到多少？」
 * 本模块在 SI 输入空间内对单个数值输入做一维反演（割线法 + 括号保护，退化时二分）。
 *
 * 约定：
 *  - 只反解单个数值输入（选择型与 showIf 隐藏的输入不参与）；
 *  - 目标输出必须是当前可见输出；
 *  - 要求目标输出在搜索区间内单调（区间两端把目标值夹在中间），否则明确报不可达，
 *    而不是给出一个看似收敛但没有工程意义的解。
 */
import { showIfMatches, type FormulaSpec } from './types';

export interface BacksolveOptions {
  /** 待反算的输入参数 key */
  target: string;
  /** 目标输出 key */
  output: string;
  /** 目标值（SI 单位） */
  goal: number;
  /** 搜索区间下限（SI 单位），缺省取基点值的 0.1 倍 */
  min?: number;
  /** 搜索区间上限（SI 单位），缺省取基点值的 10 倍 */
  max?: number;
  /** 相对收敛容差，默认 1e-6 */
  tol?: number;
  /** 最大迭代次数，默认 60 */
  iters?: number;
}

export interface BacksolveResult {
  /** 反算得到的输入值（SI 单位） */
  value: number;
  /** 该输入下目标输出的实际值（SI 单位） */
  outputSI: number;
  /** 目标值 − 实际值（SI 单位） */
  residual: number;
  /** 迭代次数 */
  iterations: number;
  /** 实际使用的搜索区间（SI 单位） */
  bracket: [number, number];
  /** 解落在搜索边界上：提示区间可能偏小或约束本身成为瓶颈 */
  atBound: boolean;
}

export function backsolve(
  formula: FormulaSpec,
  inputsSI: Record<string, number>,
  opts: BacksolveOptions,
): BacksolveResult {
  const { target, output, goal } = opts;
  const p = formula.inputs.find((x) => x.key === target);
  if (!p || p.kind === 'select' || !showIfMatches(p.showIf, inputsSI)) {
    throw new Error('反算参数不可用：该参数为选择型或当前被隐藏');
  }
  const o = formula.outputs.find((x) => x.key === output);
  if (!o || !showIfMatches(o.showIf, inputsSI)) {
    throw new Error('目标结果不可用：该结果当前被隐藏或不存在');
  }
  if (!Number.isFinite(goal)) throw new Error('目标值必须是有限数值');

  const base = inputsSI[target];
  if (!Number.isFinite(base) || base === 0) {
    throw new Error('反算参数当前值为 0 或非有限，无法确定搜索基点');
  }

  // 默认区间按基点的 0.1~10 倍；显式传入时以传入值为准
  const lo = opts.min ?? Math.min(base * 0.1, base * 10);
  const hi = opts.max ?? Math.max(base * 0.1, base * 10);
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new Error('搜索区间非法：上限必须大于下限且均为有限值');
  }

  const f = (x: number) => {
    const y = formula.solve({ ...inputsSI, [target]: x })[output];
    if (!Number.isFinite(y)) throw new Error('该输入下无法求解，请调整搜索区间');
    return y;
  };

  let fLo: number;
  let fHi: number;
  try {
    fLo = f(lo);
    fHi = f(hi);
  } catch (e) {
    throw new Error('搜索区间端点无法求解：' + (e instanceof Error ? e.message : String(e)));
  }

  // 两端输出把目标值夹在中间，才存在单调解
  const spanLo = Math.min(fLo, fHi);
  const spanHi = Math.max(fLo, fHi);
  const pad = Math.abs(spanHi - spanLo) * 1e-12;
  if (goal < spanLo - pad || goal > spanHi + pad) {
    throw new Error(
      `目标值 ${fmt(goal)} 超出搜索区间内可达到的输出范围 [${fmt(spanLo)}, ${fmt(spanHi)}]，` +
        '请调整目标值或扩大搜索区间',
    );
  }

  const tol = opts.tol ?? 1e-6;
  const maxIters = opts.iters ?? 60;
  // 相对容差以目标值为基准（目标为 0 时退化为区间跨度），
  // 不能用区间跨度统一缩放：跨度可能比目标大一个量级，会把容差放得过松。
  const scale = Math.abs(goal) > 0 ? Math.abs(goal) : Math.abs(spanHi - spanLo);
  const tolAbs = tol * Math.max(scale, 1e-12);

  let a = lo;
  let b = hi;
  let fa = fLo - goal;
  let fb = fHi - goal;
  let iterations = 0;

  for (let i = 0; i < maxIters; i++) {
    iterations = i;
    if (Math.abs(fa) <= tolAbs) return result(a, fa, goal, iterations, lo, hi);
    if (Math.abs(fb) <= tolAbs) return result(b, fb, goal, iterations, lo, hi);

    // 二分：反算输出常是 1/x、平方这类强非线性函数，割线法（试位法）在凸函数上
    // 会长期停滞在一端，二分虽然多几次迭代但收敛有保证。
    const x = (a + b) / 2;
    if (x === a || x === b) break; // 已达到浮点精度
    let fx: number;
    try {
      fx = f(x) - goal;
    } catch {
      break;
    }

    if (fa * fx < 0) {
      b = x;
      fb = fx;
    } else {
      a = x;
      fa = fx;
    }
    iterations = i + 1;
  }

  return Math.abs(fa) <= Math.abs(fb)
    ? result(a, fa, goal, iterations, lo, hi)
    : result(b, fb, goal, iterations, lo, hi);
}

function result(
  x: number,
  fx: number,
  goal: number,
  iterations: number,
  lo: number,
  hi: number,
): BacksolveResult {
  return {
    value: x,
    outputSI: fx + goal,
    residual: fx,
    iterations,
    bracket: [lo, hi],
    atBound: x === lo || x === hi,
  };
}

function fmt(v: number): string {
  return Number.isFinite(v) ? String(Number(v.toPrecision(4))) : 'NaN';
}
