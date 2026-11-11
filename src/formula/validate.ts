/**
 * 输入域校验（单位安全的第一道闸门）
 *
 * 公式的 solve 只接受 SI 数值、不做防御式判断；界面与历史重算统一走 computeFormula，
 * 在进入 solve 之前拦截：
 *  - 缺失 / 非数值输入（阻断）
 *  - 单位标签不属于对应分组（阻断，避免 toSI 静默按原值计算导致量纲错位）
 *  - 超出建议范围（仅提示，不阻断——工程上允许超范围外推）
 */
import { showIfMatches, type FormulaSpec, type ParamSpec } from './types';
import { UNIT_GROUPS, fromSI, toSI } from './units';

/** error 阻断计算；warn 只提示 */
export type IssueLevel = 'error' | 'warn';

export interface InputIssue {
  /** 参数 key；输出/求解异常时为空串 */
  key: string;
  label: string;
  level: IssueLevel;
  message: string;
}

/** 参数当前显示单位；未声明单位分组时用元数据里的固定单位 */
export function currentUnit(p: ParamSpec, units: Record<string, string>): string {
  return p.unitGroup ? units[p.key] ?? p.unit : p.unit;
}

/** 单位标签是否属于该参数的单位分组 */
export function isUnitValid(p: ParamSpec, unitLabel: string): boolean {
  if (!p.unitGroup) return true;
  const g = UNIT_GROUPS[p.unitGroup];
  if (!g) return false;
  return g.units.some((u) => u.label === unitLabel);
}

/**
 * 把以「声明单位」表示的界限换算到当前显示单位。
 * min/max 在元数据里统一按 ParamSpec.unit 书写，切换单位后必须换算再比较。
 */
export function boundInUnit(bound: number, p: ParamSpec, unitLabel: string): number {
  if (!p.unitGroup) return bound;
  return fromSI(toSI(bound, p.unitGroup, p.unit), p.unitGroup, unitLabel);
}

/** 保留 6 位有效数字，避免 0.30000000000000004 这类换算尾差出现在提示文案里 */
function tidy(v: number): number {
  return Number.isFinite(v) ? Number(v.toPrecision(6)) : v;
}

/** 校验全部「当前可见」的输入；被 showIf 隐藏的参数不参与 */
export function validateInputs(
  formula: FormulaSpec,
  values: Record<string, number>,
  units: Record<string, string>,
): InputIssue[] {
  const issues: InputIssue[] = [];
  for (const p of formula.inputs) {
    if (!showIfMatches(p.showIf, values)) continue;
    const unitLabel = currentUnit(p, units);

    if (!isUnitValid(p, unitLabel)) {
      issues.push({
        key: p.key,
        label: p.label,
        level: 'error',
        message: `${p.label}：单位「${unitLabel}」不在单位分组「${p.unitGroup}」中，已拒绝计算以避免量纲错位`,
      });
      continue;
    }

    const v = values[p.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      issues.push({ key: p.key, label: p.label, level: 'error', message: `${p.label}：未填写` });
      continue;
    }
    if (p.kind === 'select') continue;

    const lo = p.min !== undefined ? boundInUnit(p.min, p, unitLabel) : undefined;
    const hi = p.max !== undefined ? boundInUnit(p.max, p, unitLabel) : undefined;
    if ((lo !== undefined && v < lo) || (hi !== undefined && v > hi)) {
      issues.push({
        key: p.key,
        label: p.label,
        level: 'warn',
        message: `${p.label}：${tidy(v)} ${unitLabel} 超出建议范围 [${lo === undefined ? '-∞' : tidy(lo)}, ${
          hi === undefined ? '∞' : tidy(hi)
        }] ${unitLabel}`,
      });
    }
  }
  return issues;
}
