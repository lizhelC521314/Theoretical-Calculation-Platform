import { useEffect, useMemo, useState } from 'react';
import { showIfMatches, type FormulaSpec } from '../formula/types';
import { UNIT_GROUPS, formatNumber, fromSI, toSI } from '../formula/units';
import { backsolve, type BacksolveResult } from '../formula/backsolve';

interface Props {
  formula: FormulaSpec;
  /** 当前 SI 输入；为 null 时（输入不完整 / 校验未通过）不可运行 */
  inputsSI: Record<string, number> | null;
  /** 回填结果到参数表单（值为目标参数的显示单位） */
  onApply: (key: string, displayValue: number) => void;
  /** 参数当前显示单位，用于结果换算与回填 */
  units: Record<string, string>;
}

/** 目标结果的候选显示单位（输出已声明分组时取整组，否则用固定单位） */
function goalUnits(formula: FormulaSpec, outputKey: string): string[] {
  const o = formula.outputs.find((x) => x.key === outputKey);
  if (!o) return [''];
  if (!o.unitGroup) return [o.unit];
  const g = UNIT_GROUPS[o.unitGroup];
  return g ? g.units.map((u) => u.label) : [o.unit];
}

/** 目标结果默认显示单位：与结果区一致，取工程习惯单位 */
function preferredUnit(formula: FormulaSpec, outputKey: string): string {
  const o = formula.outputs.find((x) => x.key === outputKey);
  if (!o) return '';
  const g = o.unitGroup ? UNIT_GROUPS[o.unitGroup] : undefined;
  return g?.preferred ?? o.unit;
}

/**
 * 反算求解面板：给目标结果定一个值，反推某个输入应该取多少。
 *
 * 用于设计校核的逆向问题，例如「压降限值 0.5 kPa，滤材厚度至少要多大」。
 * 反算只做一维单参数反演，其余参数保持当前值不变。
 */
export function BacksolvePanel({ formula, inputsSI, onApply, units }: Props) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [output, setOutput] = useState('');
  const [goalText, setGoalText] = useState('');
  const [goalUnit, setGoalUnit] = useState('');
  const [minPct, setMinPct] = useState(10);
  const [maxPct, setMaxPct] = useState(1000);
  const [result, setResult] = useState<BacksolveResult | null>(null);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);

  // 按 showIf 只列当前设计模式下实际参与计算的数值输入与输出
  const numericInputs = useMemo(
    () =>
      formula.inputs.filter(
        (p) => p.kind !== 'select' && showIfMatches(p.showIf, inputsSI ?? {}),
      ),
    [formula, inputsSI],
  );
  const outputList = useMemo(
    () => formula.outputs.filter((o) => showIfMatches(o.showIf, inputsSI ?? {})),
    [formula, inputsSI],
  );
  const hasInputs = inputsSI !== null;

  // 切换公式：重置一切
  useEffect(() => {
    setTarget('');
    setOutput('');
    setGoalText('');
    setResult(null);
    setError('');
    setApplied(false);
  }, [formula.id]);

  // 设计模式切换导致可选集合变化时，回落到首个可见项
  useEffect(() => {
    if (numericInputs.length && !numericInputs.some((p) => p.key === target)) {
      setTarget(numericInputs[0].key);
    }
    if (outputList.length && !outputList.some((o) => o.key === output)) {
      setOutput(outputList[0].key);
    }
  }, [numericInputs, outputList, target, output]);

  // 目标结果变化（或输入首次齐备）时，按当前结果量级预填目标值
  useEffect(() => {
    if (!inputsSI || !output) return;
    setGoalUnit(preferredUnit(formula, output));
    setResult(null);
    setApplied(false);
    try {
      const o = formula.outputs.find((x) => x.key === output);
      const unit = o ? preferredUnit(formula, output) : '';
      const base = formula.solve(inputsSI)[output];
      if (!Number.isFinite(base)) {
        setGoalText('');
        return;
      }
      setGoalText(String(Number(fromSI(base, o?.unitGroup, unit).toPrecision(4))));
    } catch {
      setGoalText('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formula.id, output, hasInputs]);

  const run = () => {
    if (!inputsSI || !target || !output) return;
    const goalRaw = Number(goalText);
    if (!Number.isFinite(goalRaw)) {
      setError('目标值必须是数值');
      setResult(null);
      return;
    }
    const outputSpec = formula.outputs.find((o) => o.key === output);
    const goal = toSI(goalRaw, outputSpec?.unitGroup, goalUnit || outputSpec?.unit || '');
    const base = inputsSI[target];
    try {
      const r = backsolve(formula, inputsSI, {
        target,
        output,
        goal,
        min: base * (minPct / 100),
        max: base * (maxPct / 100),
      });
      setResult(r);
      setError('');
      setApplied(false);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const apply = () => {
    if (!result) return;
    const p = formula.inputs.find((x) => x.key === target);
    if (!p) return;
    const unit = p.unitGroup ? units[target] ?? p.unit : p.unit;
    onApply(target, p.unitGroup ? fromSI(result.value, p.unitGroup, unit) : result.value);
    setApplied(true);
  };

  const targetSpec = formula.inputs.find((x) => x.key === target);
  const outputSpec = formula.outputs.find((o) => o.key === output);
  const targetUnit = targetSpec?.unitGroup
    ? units[target] ?? targetSpec.unit
    : targetSpec?.unit ?? '';
  const shown = (v: number, group: string | undefined, unit: string) =>
    Number.isFinite(v) ? formatNumber(fromSI(v, group, unit), 4) : '—';

  return (
    <div className="result-block unc-block">
      <div className="unc-head">
        <h3 className="panel-title">反算求解</h3>
        <button className="btn-link" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开'}
        </button>
      </div>

      {open && (
        <>
          <p className="unc-hint">
            给定目标结果的限值，反推某个输入应取多少。其余参数保持当前值不变，
            搜索区间按反算参数当前值的百分比给出。
          </p>

          <div className="bs-form">
            <label className="bs-field">
              <span>反算参数</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {numericInputs.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.symbol} {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="bs-field">
              <span>目标结果</span>
              <select value={output} onChange={(e) => setOutput(e.target.value)}>
                {outputList.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.symbol} {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="bs-field">
              <span>目标值</span>
              <div className="bs-inline">
                <input
                  className="unc-rel"
                  type="number"
                  value={goalText}
                  onChange={(e) => {
                    setGoalText(e.target.value);
                    setResult(null);
                    setApplied(false);
                  }}
                />
                <select
                  className="unc-dist"
                  value={goalUnit}
                  onChange={(e) => setGoalUnit(e.target.value)}
                >
                  {goalUnits(formula, output).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label className="bs-field">
              <span>搜索区间（相对当前值）</span>
              <div className="bs-inline">
                <input
                  className="unc-rel"
                  type="number"
                  min={1}
                  max={99}
                  value={minPct}
                  onChange={(e) => setMinPct(Number(e.target.value) || 1)}
                />
                <span className="unc-pct">% ~</span>
                <input
                  className="unc-rel"
                  type="number"
                  min={101}
                  max={10000}
                  value={maxPct}
                  onChange={(e) => setMaxPct(Number(e.target.value) || 100)}
                />
                <span className="unc-pct">%</span>
              </div>
            </label>
          </div>

          <div className="unc-run">
            <button
              className="btn-primary sm"
              onClick={run}
              disabled={!inputsSI || !target || !output}
            >
              开始反算
            </button>
            {!inputsSI && <span className="bind-hint">请先补全输入参数</span>}
          </div>

          {error && <div className="bind-error">{error}</div>}

          {result && (
            <>
              <table className="unc-table bs-table">
                <tbody>
                  <tr>
                    <td>反算输入</td>
                    <td colSpan={2}>
                      {targetSpec?.label} = {shown(result.value, targetSpec?.unitGroup, targetUnit)}{' '}
                      {targetUnit}
                    </td>
                  </tr>
                  <tr>
                    <td>实际输出</td>
                    <td colSpan={2}>
                      {outputSpec?.label} ={' '}
                      {shown(
                        result.outputSI,
                        outputSpec?.unitGroup,
                        goalUnit || outputSpec?.unit || '',
                      )}{' '}
                      {goalUnit || outputSpec?.unit}
                    </td>
                  </tr>
                  <tr>
                    <td>残差</td>
                    <td colSpan={2}>
                      {shown(
                        result.residual,
                        outputSpec?.unitGroup,
                        goalUnit || outputSpec?.unit || '',
                      )}{' '}
                      {goalUnit || outputSpec?.unit}
                    </td>
                  </tr>
                  <tr className="unc-influence">
                    <td colSpan={3}>
                      迭代 {result.iterations} 次 · 搜索区间 [{formatNumber(result.bracket[0], 4)},{' '}
                      {formatNumber(result.bracket[1], 4)}]（SI）
                      {result.atBound && ' · 解落在搜索边界，建议扩大区间或确认约束是否可达'}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="unc-run">
                <button className="btn-ghost" onClick={apply} disabled={applied}>
                  {applied ? '已回填参数' : '回填到参数表'}
                </button>
                <span className="bind-hint">回填后结果区按新值自动重算</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
