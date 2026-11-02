import { Fragment } from 'react';
import type { FormulaSpec, ParamSpec } from '../formula/types';
import { showIfMatches } from '../formula/types';
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

/** 表单分块：普通参数行，或「横排流程行」（同一 row 的连续参数并排显示） */
type Block =
  | { kind: 'single'; param: ParamSpec; section?: string }
  | { kind: 'flow'; key: string; params: ParamSpec[]; section?: string };

function buildBlocks(visible: ParamSpec[]): Block[] {
  const blocks: Block[] = [];
  visible.forEach((p, idx) => {
    // 分区标题：group 非空且与上一可见项的 group 不同时插入
    const prev = idx > 0 ? visible[idx - 1] : undefined;
    const section = p.group && (!prev || prev.group !== p.group) ? p.group : undefined;
    const last = blocks[blocks.length - 1];
    if (p.row && last?.kind === 'flow' && last.key === p.row) {
      last.params.push(p);
      return;
    }
    if (p.row) blocks.push({ kind: 'flow', key: p.row, params: [p], section });
    else blocks.push({ kind: 'single', param: p, section });
  });
  return blocks;
}

/** 输入参数表单：由公式元数据自动生成，每个输入独立选择显示单位 */
export function ParamForm({ formula, values, units, onValuesChange, onUnitsChange }: Props) {
  const visible = formula.inputs.filter((p) => showIfMatches(p.showIf, values));

  /** 控件本体：下拉框（枚举）或数值框 + 单位 */
  const control = (p: ParamSpec) => {
    const unitLabel = p.unitGroup ? units[p.key] ?? p.unit : p.unit;
    const v = values[p.key];
    const isSelect = p.kind === 'select' && p.options && p.options.length > 0;
    return (
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
    );
  };

  /** 普通行是否越界（枚举参数不提示） */
  const outOfRange = (p: ParamSpec) => {
    const v = values[p.key];
    const isSelect = p.kind === 'select' && p.options && p.options.length > 0;
    return (
      !isSelect &&
      ((p.min !== undefined && typeof v === 'number' && v < p.min) ||
        (p.max !== undefined && typeof v === 'number' && v > p.max))
    );
  };

  return (
    <div className="param-form">
      <h3 className="panel-title">输入参数</h3>
      {buildBlocks(visible).map((b) =>
        b.kind === 'single' ? (
          <Fragment key={b.param.key}>
            {b.section && <div className="param-section-title">{b.section}</div>}
            <div className="param-row">
              <label className="param-label" title={b.param.description}>
                <span className="param-symbol">{b.param.symbol}</span>
                <span className="param-name">{b.param.label}</span>
              </label>
              {control(b.param)}
              {b.param.description && <div className="param-desc">{b.param.description}</div>}
              {outOfRange(b.param) && (
                <div className="param-warn">
                  取值超出建议范围
                  {b.param.min !== undefined ? ` [${b.param.min}, ` : ' （-'}
                  {b.param.max !== undefined ? `${b.param.max}]` : '∞）'}
                </div>
              )}
            </div>
          </Fragment>
        ) : (
          <Fragment key={`flow-${b.key}`}>
            {b.section && <div className="param-section-title">{b.section}</div>}
            <div className="flow-row">
              {b.params.map((p) => (
                <div className="flow-cell" key={p.key}>
                  <div className="flow-cell-title" title={p.description}>
                    {p.cellTitle ?? p.label}
                  </div>
                  {control(p)}
                </div>
              ))}
            </div>
          </Fragment>
        ),
      )}
    </div>
  );
}
