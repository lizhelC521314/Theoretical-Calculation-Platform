import { useMemo } from 'react';
import type { FormulaSpec } from '../formula/types';
import { UNIT_GROUPS } from '../formula/units';

interface Props {
  formula: FormulaSpec;
  /** 当前参数值（显示单位下的数值） */
  values: Record<string, number>;
  /** 各单位分组当前选用的显示单位 */
  units: Record<string, string>;
  onValuesChange: (v: Record<string, number>) => void;
  onUnitsChange: (u: Record<string, string>) => void;
}

function UnitSelect({
  group,
  value,
  onChange,
}: {
  group: string;
  value: string;
  onChange: (u: string) => void;
}) {
  const g = UNIT_GROUPS[group];
  if (!g) return <span className="unit-fixed">{value}</span>;
  return (
    <select className="unit-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {g.units.map((u) => (
        <option key={u.label} value={u.label}>
          {u.label}
        </option>
      ))}
    </select>
  );
}

/** 输入参数表单：由公式元数据自动生成，同名 unitGroup 共享单位下拉框 */
export function ParamForm({ formula, values, units, onValuesChange, onUnitsChange }: Props) {
  const groupUnit = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of formula.inputs) {
      if (p.unitGroup && !(p.unitGroup in m)) m[p.unitGroup] = units[p.unitGroup] ?? p.unit;
    }
    return m;
  }, [formula, units]);

  return (
    <div className="param-form">
      <h3 className="panel-title">输入参数</h3>
      {formula.inputs
        .filter(
          (p) =>
            !p.showIf ||
            (Number(values[p.showIf.key]) >= (p.showIf.min ?? -Infinity) &&
              Number(values[p.showIf.key]) <= (p.showIf.max ?? Infinity)),
        )
        .map((p) => {
        const unitLabel = p.unitGroup ? groupUnit[p.unitGroup] : p.unit;
        const v = values[p.key];
        const isSelect = p.kind === 'select' && p.options && p.options.length > 0;
        const outOfRange =
          !isSelect &&
          ((p.min !== undefined && typeof v === 'number' && v < p.min) ||
            (p.max !== undefined && typeof v === 'number' && v > p.max));
        return (
          <div className="param-row" key={p.key}>
            <label className="param-label" title={p.description}>
              <span className="param-symbol">{p.symbol}</span>
              <span className="param-name">{p.label}</span>
            </label>
            <div className="param-input">
              {isSelect ? (
                <select
                  className="unit-select param-select"
                  value={typeof v === 'number' && !Number.isNaN(v) ? v : ''}
                  onChange={(e) => onValuesChange({ ...values, [p.key]: Number(e.target.value) })}
                >
                  {p.options!.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    type="number"
                    step="any"
                    value={typeof v === 'number' && !Number.isNaN(v) ? v : ''}
                    onChange={(e) =>
                      onValuesChange({ ...values, [p.key]: e.target.value === '' ? NaN : Number(e.target.value) })
                    }
                    onFocus={(e) => e.target.select()}
                  />
                  {p.unitGroup ? (
                    <UnitSelect
                      group={p.unitGroup}
                      value={unitLabel}
                      onChange={(u) => onUnitsChange({ ...units, [p.unitGroup!]: u })}
                    />
                  ) : (
                    <span className="unit-fixed">{p.unit}</span>
                  )}
                </>
              )}
            </div>
            {p.description && <div className="param-desc">{p.description}</div>}
            {outOfRange && (
              <div className="param-warn">
                取值超出建议范围
                {p.min !== undefined ? ` [${p.min}, ` : ' （-'}
                {p.max !== undefined ? `${p.max}]` : '∞）'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
