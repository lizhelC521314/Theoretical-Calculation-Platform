/**
 * 设计探索：参数扫描 + 可行域
 *
 * 单点计算只能判断「当前设计行不行」；设计探索回答「改哪个参数能行、改到多少」。
 *
 *  - 参数扫描：固定其余输入，沿一个输入等距取点，输出目标结果曲线，
 *    并标出满足全部约束的连续区间（即可行段）。
 *  - 可行域：两个输入做网格采样，标记每个网格点是否满足约束，
 *    用于判断「同时调整两个参数时，设计窗口有多宽」。
 *
 * 所有数值均为 SI 单位；不满足约束或求解失败的网格点记为不可行（不会中断扫描）。
 */
import { showIfMatches, type FormulaSpec } from './types';

/** 约束比较方式 */
export type ConstraintOp = 'le' | 'ge' | 'between';

export const CONSTRAINT_OP_LABEL: Record<ConstraintOp, string> = {
  le: '≤',
  ge: '≥',
  between: '介于',
};

/** 单条结果约束：v ≤ value / v ≥ value / value ≤ v ≤ value2 */
export interface Constraint {
  /** 结果 key */
  output: string;
  op: ConstraintOp;
  value: number;
  /** op = between 时的上限 */
  value2?: number;
}

export function satisfyConstraint(v: number, c: Constraint): boolean {
  if (!Number.isFinite(v)) return false;
  if (c.op === 'le') return v <= c.value;
  if (c.op === 'ge') return v >= c.value;
  const lo = Math.min(c.value, c.value2 ?? c.value);
  const hi = Math.max(c.value, c.value2 ?? c.value);
  return v >= lo && v <= hi;
}

/** 全部约束均满足才视为可行；无约束时全部可行 */
export function isFeasible(out: Record<string, number>, constraints: Constraint[]): boolean {
  return constraints.every((c) => satisfyConstraint(out[c.output], c));
}

export interface SweepOptions {
  xKey: string;
  /** 扫描下限（SI） */
  xMin: number;
  /** 扫描上限（SI） */
  xMax: number;
  /** 采样点数（含两端），2~200 */
  steps: number;
  /** 曲线纵轴结果 key */
  output: string;
  constraints: Constraint[];
}

export interface SweepPoint {
  x: number;
  y: number;
  feasible: boolean;
  /** 全部输出（供切换纵轴时复用，不重复求解） */
  outputs: Record<string, number>;
}

export interface SweepResult {
  points: SweepPoint[];
  /** 可行段的 x 区间（首尾相接的可行点合并为一段） */
  segments: Array<[number, number]>;
  /** 可用点数占比 */
  ratio: number;
  /** 求解抛错或输出非有限的点数 */
  failed: number;
  /** 实际求解次数 */
  evaluated: number;
}

export function sweep(
  formula: FormulaSpec,
  inputsSI: Record<string, number>,
  opts: SweepOptions,
): SweepResult {
  const p = formula.inputs.find((x) => x.key === opts.xKey);
  if (!p || p.kind === 'select' || !showIfMatches(p.showIf, inputsSI)) {
    throw new Error('扫描参数不可用：该参数为选择型或当前被隐藏');
  }
  if (!Number.isFinite(opts.xMin) || !Number.isFinite(opts.xMax) || !(opts.xMax > opts.xMin)) {
    throw new Error('扫描区间非法：上限必须大于下限且均为有限值');
  }
  const steps = Math.min(200, Math.max(2, Math.floor(opts.steps)));

  const points: SweepPoint[] = [];
  let failed = 0;
  for (let i = 0; i < steps; i++) {
    const x = opts.xMin + ((opts.xMax - opts.xMin) * i) / (steps - 1);
    let outputs: Record<string, number> = {};
    try {
      outputs = formula.solve({ ...inputsSI, [opts.xKey]: x });
    } catch {
      failed++;
      points.push({ x, y: NaN, feasible: false, outputs });
      continue;
    }
    const y = outputs[opts.output];
    if (!Number.isFinite(y)) failed++;
    points.push({ x, y, feasible: isFeasible(outputs, opts.constraints), outputs });
  }

  return {
    points,
    segments: feasibleSegments(points),
    ratio: points.length ? points.filter((q) => q.feasible).length / points.length : 0,
    failed,
    evaluated: steps,
  };
}

/** 连续可行点合并成区间；单点可行也记为一个零宽区间 */
function feasibleSegments(points: SweepPoint[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start: number | null = null;
  let last = 0;
  for (const q of points) {
    if (q.feasible) {
      if (start === null) start = q.x;
      last = q.x;
    } else if (start !== null) {
      out.push([start, last]);
      start = null;
    }
  }
  if (start !== null) out.push([start, last]);
  return out;
}

export interface GridOptions {
  xKey: string;
  xMin: number;
  xMax: number;
  yKey: string;
  yMin: number;
  yMax: number;
  /** 每个方向的分格数（2~60），总求解次数为 size² */
  size: number;
  constraints: Constraint[];
}

export interface GridCell {
  xi: number;
  yi: number;
  feasible: boolean;
  /** 第一条约束对应的结果值（SI），无约束或未定义时为 NaN；用于悬浮提示 */
  v: number;
}

export interface GridResult {
  xs: number[];
  ys: number[];
  cells: GridCell[];
  /** 可行格占比 */
  ratio: number;
  feasibleCount: number;
  failed: number;
  evaluated: number;
}

export function sweepGrid(
  formula: FormulaSpec,
  inputsSI: Record<string, number>,
  opts: GridOptions,
): GridResult {
  const px = formula.inputs.find((x) => x.key === opts.xKey);
  const py = formula.inputs.find((x) => x.key === opts.yKey);
  for (const [p, name] of [
    [px, '横轴'],
    [py, '纵轴'],
  ] as const) {
    if (!p || p.kind === 'select' || !showIfMatches(p.showIf, inputsSI)) {
      throw new Error(`${name}参数不可用：该参数为选择型或当前被隐藏`);
    }
  }
  if (opts.xKey === opts.yKey) throw new Error('横轴与纵轴不能是同一参数');
  for (const [lo, hi, name] of [
    [opts.xMin, opts.xMax, '横轴'],
    [opts.yMin, opts.yMax, '纵轴'],
  ] as const) {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) {
      throw new Error(`${name}区间非法：上限必须大于下限且均为有限值`);
    }
  }

  const size = Math.min(60, Math.max(2, Math.floor(opts.size)));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < size; i++) {
    xs.push(opts.xMin + ((opts.xMax - opts.xMin) * i) / (size - 1));
    ys.push(opts.yMin + ((opts.yMax - opts.yMin) * i) / (size - 1));
  }

  const cells: GridCell[] = [];
  let feasibleCount = 0;
  let failed = 0;
  for (let yi = 0; yi < size; yi++) {
    for (let xi = 0; xi < size; xi++) {
      let out: Record<string, number>;
      try {
        out = formula.solve({ ...inputsSI, [opts.xKey]: xs[xi], [opts.yKey]: ys[yi] });
      } catch {
        failed++;
        cells.push({ xi, yi, feasible: false, v: NaN });
        continue;
      }
      const feasible = isFeasible(out, opts.constraints);
      if (feasible) feasibleCount++;
      const first = opts.constraints[0]?.output;
      cells.push({ xi, yi, feasible, v: first ? out[first] : NaN });
    }
  }

  return {
    xs,
    ys,
    cells,
    ratio: cells.length ? feasibleCount / cells.length : 0,
    feasibleCount,
    failed,
    evaluated: cells.length,
  };
}
