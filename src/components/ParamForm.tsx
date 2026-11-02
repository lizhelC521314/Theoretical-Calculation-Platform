import { Fragment } from 'react';
import type { FormulaSpec } from '../formula/types';
import { UNIT_GROUPS } from '../formula/units';

interface Props {
  formula: FormulaSpec;
  /** 当前参数值（显示单位下的数值） */
  values: Record<string, number>;
  /** 各输入项当前选用的显示单位（按输入 key 记录） */
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

/** 输入参数表单：由公式元数据自动生成，每个输入独立选择显示单位 */
export function ParamForm({ formula, values, units, onValuesChange, onUnitsChange }: Props) {
  const visible = formula.inputs.filter(
    (p) =>
      !p.showIf ||
      (Number(values[p.showIf.key]) >= (p.showIf.min ?? -Infinity) &&
        Number(values[p.showIf.key]) <= (p.showIf.max ?? Infinity)),
  );

  return (
    <div className="param-form">
      <h3 className="panel-title">输入参数</h3>
      {visible.map((p, idx) => {
        // 分区标题：group 非空且与上一可见项的 group 不同时插入
        const showSection = !!p.group && (idx === 0 || visible[idx - 1].group !== p.group);
        const unitLabel = p.unitGroup ? units[p.key] ?? p.unit : p.unit;
        const v = values[p.key];
        const isSelect = p.kind === 'select' && p.options && p.options.length > 0;
        const outOfRange =
          !isSelect &&
          ((p.min !== undefined && typeof v === 'number' && v < p.min) ||
            (p.max !== undefined && typeof v === 'number' && v > p.max));
        return (
          <Fragment key={p.key}>
            {showSection && <div className="param-section-title">{p.group}</div>}
            <div className="param-row">
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
                        onChange={(u) => onUnitsChange({ ...units, [p.key]: u })}
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
          </Fragment>
        );
      })}
    </div>
  );
}
