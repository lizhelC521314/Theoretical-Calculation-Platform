import { Fragment, useEffect, useState } from 'react';
import type { FormulaSpec, ParamSpec } from '../formula/types';
import { showIfMatches } from '../formula/types';
import {
  MATERIAL_BIND_FIELDS,
  allowedMaterialTypes,
  bindFieldLabel,
  bindValueForParam,
  isFluidBindField,
  materialOptionLabel,
  resolveBindTemperature,
  type MaterialOption,
} from '../formula/materialBinding';
import { UNIT_GROUPS } from '../formula/units';
import { boundInUnit } from '../formula/validate';
import { IS_STANDARD } from '../edition';

interface Props {
  formula: FormulaSpec;
  /** 当前参数值（显示单位下的数值） */
  values: Record<string, number>;
  /** 各输入项当前选用的显示单位（按输入 key 记录） */
  units: Record<string, string>;
  onValuesChange: (v: Record<string, number>) => void;
  onUnitsChange: (u: Record<string, string>) => void;
  /** 材料库候选（undefined = 正在加载；空数组 = 不可用） */
  materials?: MaterialOption[];
  /** 各可绑定参数已选材料（参数 key → 材料文件路径） */
  bindings?: Record<string, string>;
  onBindingsChange?: (b: Record<string, string>) => void;
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

/** 输入参数表单：由公式元数据自动生成，每个输入独立选择显示单位；可绑定材料库物性 */
export function ParamForm({
  formula,
  values,
  units,
  onValuesChange,
  onUnitsChange,
  materials,
  bindings,
  onBindingsChange,
}: Props) {
  const visible = formula.inputs.filter((p) => showIfMatches(p.showIf, values));
  const [bindError, setBindError] = useState<{ key: string; msg: string } | null>(null);
  // 切换公式时清掉上一条材料的缺失提示
  useEffect(() => setBindError(null), [formula.id]);

  const unitOf = (p: ParamSpec) => (p.unitGroup ? units[p.key] ?? p.unit : p.unit);

  /** 当前绑定所需的插值温度（℃）：流体物性按公式温度输入的实时值插值 */
  const bindTemp = (p: ParamSpec) =>
    resolveBindTemperature(p.bind, formula.inputs, values, units);

  /** 选中材料后按当前显示单位带入物性值；材料缺少该物性时给出提示且不改变输入 */
  const pickMaterial = (p: ParamSpec, filePath: string) => {
    if (!onBindingsChange || !bindings) return;
    setBindError(null);
    if (!filePath) {
      onBindingsChange({ ...bindings, [p.key]: '' });
      return;
    }
    const opt = materials?.find((m) => m.filePath === filePath);
    if (!opt || !p.bind) return;
    const temp = bindTemp(p);
    const v = bindValueForParam(opt.rec, p.bind.field, p, unitOf(p), { temperatureC: temp });
    if (v == null) {
      setBindError({
        key: p.key,
        msg:
          isFluidBindField(p.bind.field) && temp == null
            ? `材料「${materialOptionLabel(opt.rec)}」为流体物性，需先填写插值温度`
            : `材料「${materialOptionLabel(opt.rec)}」未提供${MATERIAL_BIND_FIELDS[p.bind.field].label}，请手工输入`,
      });
      return;
    }
    // 取 6 位有效数字，避免 6.000000000000001 这类换算尾差
    onValuesChange({ ...values, [p.key]: Number(v.toPrecision(6)) });
    onBindingsChange({ ...bindings, [p.key]: filePath });
  };

  /** 单位切换：已绑定材料时同步按新单位重算数值 */
  const changeUnit = (p: ParamSpec, u: string) => {
    onUnitsChange({ ...units, [p.key]: u });
    const opt = materials?.find((m) => m.filePath === bindings?.[p.key]);
    if (p.bind && opt) {
      const v = bindValueForParam(opt.rec, p.bind.field, p, u, { temperatureC: bindTemp(p) });
      if (v != null) onValuesChange({ ...values, [p.key]: Number(v.toPrecision(6)) });
    }
  };

  /**
   * 已绑定物性随温度输入实时刷新：
   * 流体属性表随温度变化，用户改温度后带入值必须同步，否则算例与材料来源不一致。
   */
  useEffect(() => {
    if (!bindings || !materials || !onValuesChange) return;
    let next: Record<string, number> | null = null;
    for (const p of formula.inputs) {
      const filePath = bindings[p.key];
      if (!filePath || !p.bind) continue;
      const opt = materials.find((m) => m.filePath === filePath);
      if (!opt) continue;
      const v = bindValueForParam(opt.rec, p.bind.field, p, unitOf(p), {
        temperatureC: bindTemp(p),
      });
      if (v == null) continue;
      const rounded = Number(v.toPrecision(6));
      if (values[p.key] !== rounded) {
        next = next ?? { ...values };
        next[p.key] = rounded;
      }
    }
    if (next) onValuesChange(next);
  }, [bindings, materials, formula, values, units, onValuesChange]);

  /** 手工改数值即脱离材料库（避免「已带入」与实际值不符） */
  const changeValue = (p: ParamSpec, raw: string) => {
    onValuesChange({ ...values, [p.key]: raw === '' ? NaN : Number(raw) });
    if (p.bind && bindings?.[p.key] && onBindingsChange) {
      onBindingsChange({ ...bindings, [p.key]: '' });
    }
  };

  /** 材料下拉框：按绑定声明的材料类型过滤（流体 / 多孔介质按字段自动判定） */
  const bindControl = (p: ParamSpec) => {
    if (!p.bind || !onBindingsChange) return null;
    const types = allowedMaterialTypes(p.bind.field, p.bind.types);
    const options = (materials || []).filter((m) => types.includes(m.rec.type));
    const picked = bindings?.[p.key]
      ? materials?.find((m) => m.filePath === bindings[p.key])
      : undefined;
    return (
      <div className="param-bind">
        {materials === undefined ? (
          <span className="bind-hint">材料库加载中…</span>
        ) : options.length === 0 ? (
          <span className="bind-hint">
            材料库无可选{isFluidBindField(p.bind.field) ? '流体' : ''}材料，请手工输入
          </span>
        ) : (
          <select
            className="bind-select"
            value={bindings?.[p.key] ?? ''}
            onChange={(e) => pickMaterial(p, e.target.value)}
            title={`从材料库带入${MATERIAL_BIND_FIELDS[p.bind.field].label}`}
          >
            <option value="">从材料库带入（可选）</option>
            {options.map((m) => (
              <option key={m.filePath} value={m.filePath}>
                {materialOptionLabel(m.rec)}
              </option>
            ))}
          </select>
        )}
        {picked && (
          <span className="bind-picked">
            已带入 {bindFieldLabel(picked.rec, p.bind.field, bindTemp(p))}（{picked.rec.grade}）
          </span>
        )}
        {bindError?.key === p.key && <span className="bind-error">{bindError.msg}</span>}
      </div>
    );
  };

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
              onChange={(e) => changeValue(p, e.target.value)}
              onFocus={(e) => e.target.select()}
            />
            {p.unitGroup ? (
              <UnitSelect
                group={p.unitGroup}
                value={unitLabel}
                onChange={(u) => changeUnit(p, u)}
              />
            ) : (
              <span className="unit-fixed">{p.unit}</span>
            )}
          </>
        )}
      </div>
    );
  };

  /** 建议范围在当前显示单位下的界限（min/max 元数据以声明单位书写） */
  const bounds = (p: ParamSpec) => {
    const unitLabel = p.unitGroup ? units[p.key] ?? p.unit : p.unit;
    const lo = p.min !== undefined ? boundInUnit(p.min, p, unitLabel) : undefined;
    const hi = p.max !== undefined ? boundInUnit(p.max, p, unitLabel) : undefined;
    return { unitLabel, lo, hi };
  };

  /** 普通行是否越界（枚举参数不提示） */
  const outOfRange = (p: ParamSpec) => {
    const v = values[p.key];
    const isSelect = p.kind === 'select' && p.options && p.options.length > 0;
    if (isSelect || typeof v !== 'number' || Number.isNaN(v)) return false;
    const { lo, hi } = bounds(p);
    return (lo !== undefined && v < lo) || (hi !== undefined && v > hi);
  };

  /** 参考范围文案（标准版只展示这一条提示，无范围则不显示任何说明） */
  const rangeText = (p: ParamSpec) => {
    if (p.min === undefined && p.max === undefined) return '';
    const { unitLabel, lo, hi } = bounds(p);
    const tidy = (n: number) => Number(n.toPrecision(6));
    return `参考范围：[${lo === undefined ? '不限' : tidy(lo)}, ${hi === undefined ? '不限' : tidy(hi)}]${
      unitLabel ? ` ${unitLabel}` : ''
    }`;
  };

  return (
    <div className="param-form">
      <h3 className="panel-title">输入参数</h3>
      {buildBlocks(visible).map((b) =>
        b.kind === 'single' ? (
          <Fragment key={b.param.key}>
            {b.section && <div className="param-section-title">{b.section}</div>}
            <div className="param-row">
              <label
                className="param-label"
                title={IS_STANDARD ? undefined : b.param.description}
              >
                <span className="param-symbol">{b.param.symbol}</span>
                <span className="param-name">{b.param.label}</span>
              </label>
              {control(b.param)}
              {bindControl(b.param)}
              {IS_STANDARD
                ? rangeText(b.param) && <div className="param-range">{rangeText(b.param)}</div>
                : b.param.description && <div className="param-desc">{b.param.description}</div>}
              {outOfRange(b.param) && (
                <div className="param-warn">
                  取值超出建议范围 {rangeText(b.param).replace('参考范围：', '')}
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
                  <div
                    className="flow-cell-title"
                    title={IS_STANDARD ? undefined : p.description}
                  >
                    {p.cellTitle ?? p.label}
                  </div>
                  {control(p)}
                  {IS_STANDARD && rangeText(p) && <div className="param-range">{rangeText(p)}</div>}
                </div>
              ))}
            </div>
          </Fragment>
        ),
      )}
    </div>
  );
}
