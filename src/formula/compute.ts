/**
 * 统一计算入口：显示单位 → SI → solve → 输出有限性检查
 *
 * 所有需要执行公式的界面（计算页、历史重算）都应走这里，而不是直接调用 formula.solve，
 * 以便把「输入缺失 / 单位非法 / 输出非有限」统一暴露为可展示的问题列表。
 */
import { showIfMatches, type FormulaSpec } from './types';
import { toSI } from './units';
import { currentUnit, validateInputs, type InputIssue } from './validate';

export interface ComputeResult {
  /** 校验与求解问题；level=error 时结果不可用 */
  issues: InputIssue[];
  /** 是否成功得到可用结果 */
  ok: boolean;
  /** SI 输入（仅 ok 时有值） */
  inputsSI?: Record<string, number>;
  /** SI 输出（仅 ok 时有值） */
  outputsSI?: Record<string, number>;
}

export function computeFormula(
  formula: FormulaSpec,
  values: Record<string, number>,
  units: Record<string, string>,
): ComputeResult {
  const issues = validateInputs(formula, values, units);
  if (issues.some((i) => i.level === 'error')) return { issues, ok: false };

  const inputsSI: Record<string, number> = {};
  for (const p of formula.inputs) {
    inputsSI[p.key] = toSI(values[p.key], p.unitGroup, currentUnit(p, units));
  }

  let outputsSI: Record<string, number>;
  try {
    outputsSI = formula.solve(inputsSI);
  } catch {
    return {
      issues: [
        ...issues,
        {
          key: '',
          label: '求解',
          level: 'error',
          message: '求解失败：输入超出公式定义域（请检查是否存在 0 或负值、除零等情形）',
        },
      ],
      ok: false,
    };
  }

  // 输出必须为有限数值；被 showIf 隐藏的输出不参与判断。
  // 部分公式含「可选工况」输出（如回代误差），未填工况时本就为 NaN，不能逐条报错；
  // 因此只在全部输出都非有限时判定为求解失败。
  const visibleOutputs = formula.outputs.filter((o) => showIfMatches(o.showIf, inputsSI));
  const finite = visibleOutputs.filter((o) => Number.isFinite(outputsSI[o.key])).length;
  if (visibleOutputs.length > 0 && finite === 0) {
    return {
      issues: [
        ...issues,
        {
          key: '',
          label: '结果',
          level: 'error',
          message: '全部输出均为非有限值，求解失败（请检查输入是否落在公式适用范围内）',
        },
      ],
      ok: false,
    };
  }

  return { issues, ok: true, inputsSI, outputsSI };
}
