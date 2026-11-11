import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { showIfMatches, type FormulaSpec } from '../formula/types';
import { UNIT_GROUPS, formatNumber, fromSI, toSI } from '../formula/units';
import {
  CONSTRAINT_OP_LABEL,
  sweep,
  sweepGrid,
  type Constraint,
  type ConstraintOp,
  type GridResult,
  type SweepResult,
} from '../formula/explore';

interface Props {
  formula: FormulaSpec;
  /** 当前 SI 输入；为 null 时不可运行 */
  inputsSI: Record<string, number> | null;
  /** 各输入的当前显示单位 */
  units: Record<string, string>;
}

interface ConstraintRow {
  output: string;
  op: ConstraintOp;
  value: string;
  value2: string;
}

/** 参数的显示单位 */
function unitOf(formula: FormulaSpec, key: string, units: Record<string, string>): string {
  const p = formula.inputs.find((x) => x.key === key);
  if (!p) return '';
  return p.unitGroup ? units[key] ?? p.unit : p.unit;
}

/** 输出的显示单位：优先工程习惯单位，与结果区保持一致 */
function outputUnit(formula: FormulaSpec, key: string): string {
  const o = formula.outputs.find((x) => x.key === key);
  if (!o) return '';
  if (!o.unitGroup) return o.unit;
  return UNIT_GROUPS[o.unitGroup]?.preferred ?? o.unit;
}

const fmt = (v: number, digits = 4) => (Number.isFinite(v) ? formatNumber(v, digits) : '—');

/**
 * 设计探索面板：参数扫描（一维）与可行域（二维）
 *
 * 参数扫描给出「沿某个参数变化时结果怎么走、哪一段满足约束」；
 * 可行域给出「同时调两个参数时，满足约束的设计窗口有多大」。
 */
export function ExplorePanel({ formula, inputsSI, units }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'sweep' | 'grid'>('sweep');

  // 扫描设置
  const [xKey, setXKey] = useState('');
  const [xMinText, setXMinText] = useState('');
  const [xMaxText, setXMaxText] = useState('');
  const [steps, setSteps] = useState(41);
  const [curveKey, setCurveKey] = useState('');

  // 可行域设置
  const [gridYKey, setGridYKey] = useState('');
  const [yMinText, setYMinText] = useState('');
  const [yMaxText, setYMaxText] = useState('');
  const [size, setSize] = useState(21);

  // 约束
  const [rows, setRows] = useState<ConstraintRow[]>([]);

  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [gridResult, setGridResult] = useState<GridResult | null>(null);
  const [error, setError] = useState('');

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

  /** 把一个参数按「当前值的 0.5 / 1.5 倍」折算到显示单位，作为区间默认值 */
  const defaultRange = (key: string, lo = 0.5, hi = 1.5): [string, string] => {
    if (!inputsSI) return ['', ''];
    const p = formula.inputs.find((x) => x.key === key);
    if (!p) return ['', ''];
    const unit = unitOf(formula, key, units);
    const v = fromSI(inputsSI[key], p.unitGroup, unit);
    if (!Number.isFinite(v)) return ['', ''];
    const round = (n: number) => String(Number(n.toPrecision(6)));
    return [round(v * lo), round(v * hi)];
  };

  // 切换公式：重置
  useEffect(() => {
    setXKey('');
    setGridYKey('');
    setCurveKey('');
    setRows([]);
    setSweepResult(null);
    setGridResult(null);
    setError('');
  }, [formula.id]);

  // 可选集合变化时回落到首个可见项
  useEffect(() => {
    if (numericInputs.length && !numericInputs.some((p) => p.key === xKey)) {
      setXKey(numericInputs[0].key);
    }
    if (numericInputs.length && !numericInputs.some((p) => p.key === gridYKey)) {
      const second = numericInputs.find((p) => p.key !== xKey) ?? numericInputs[0];
      setGridYKey(second.key);
    }
    if (outputList.length && !outputList.some((o) => o.key === curveKey)) {
      setCurveKey(outputList[0].key);
    }
  }, [numericInputs, outputList, xKey, gridYKey, curveKey]);

  // 参数变化时按当前值预填区间（仅在尚未填写或切换参数时）
  const [rangeFor, setRangeFor] = useState('');
  useEffect(() => {
    if (!inputsSI || !xKey) return;
    const key = `x:${xKey}`;
    if (rangeFor === key) return;
    const [lo, hi] = defaultRange(xKey);
    setXMinText(lo);
    setXMaxText(hi);
    setRangeFor(key);
    setSweepResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xKey, hasInputs]);

  const [gridRangeFor, setGridRangeFor] = useState('');
  useEffect(() => {
    if (!inputsSI || !gridYKey) return;
    const key = `y:${gridYKey}`;
    if (gridRangeFor === key) return;
    const [lo, hi] = defaultRange(gridYKey);
    setYMinText(lo);
    setYMaxText(hi);
    setGridRangeFor(key);
    setGridResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridYKey, hasInputs]);

  /** 新增一条约束：默认取该结果当前值作为限值，方便再微调 */
  const addRow = () => {
    if (!outputList.length) return;
    const o = outputList.find((x) => !rows.some((r) => r.output === x.key)) ?? outputList[0];
    let init = '';
    if (inputsSI) {
      try {
        const v = formula.solve(inputsSI)[o.key];
        if (Number.isFinite(v)) {
          init = String(Number(fromSI(v, o.unitGroup, outputUnit(formula, o.key)).toPrecision(4)));
        }
      } catch {
        init = '';
      }
    }
    setRows((prev) => [...prev, { output: o.key, op: 'le', value: init, value2: '' }]);
  };

  const updateRow = (i: number, patch: Partial<ConstraintRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const buildConstraints = (): Constraint[] => {
    const out: Constraint[] = [];
    for (const r of rows) {
      const o = formula.outputs.find((x) => x.key === r.output);
      if (!o) continue;
      const unit = outputUnit(formula, r.output);
      const v = Number(r.value);
      if (!Number.isFinite(v)) throw new Error(`约束「${o.label}」的限值必须是数值`);
      const c: Constraint = { output: r.output, op: r.op, value: toSI(v, o.unitGroup, unit) };
      if (r.op === 'between') {
        const v2 = Number(r.value2);
        if (!Number.isFinite(v2)) throw new Error(`约束「${o.label}」的区间上限必须是数值`);
        c.value2 = toSI(v2, o.unitGroup, unit);
      }
      out.push(c);
    }
    return out;
  };

  const run = () => {
    if (!inputsSI || !xKey) return;
    setError('');
    try {
      const constraints = buildConstraints();
      const px = formula.inputs.find((p) => p.key === xKey)!;
      const xUnit = unitOf(formula, xKey, units);
      const xMin = toSI(Number(xMinText), px.unitGroup, xUnit);
      const xMax = toSI(Number(xMaxText), px.unitGroup, xUnit);
      if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) {
        throw new Error('扫描区间必须是数值');
      }

      if (mode === 'sweep') {
        const r = sweep(formula, inputsSI, {
          xKey,
          xMin,
          xMax,
          steps,
          output: curveKey,
          constraints,
        });
        setSweepResult(r);
        setGridResult(null);
      } else {
        const py = formula.inputs.find((p) => p.key === gridYKey);
        if (!py) throw new Error('请选择纵轴参数');
        const yUnit = unitOf(formula, gridYKey, units);
        const yMin = toSI(Number(yMinText), py.unitGroup, yUnit);
        const yMax = toSI(Number(yMaxText), py.unitGroup, yUnit);
        if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
          throw new Error('纵轴区间必须是数值');
        }
        const r = sweepGrid(formula, inputsSI, {
          xKey,
          xMin,
          xMax,
          yKey: gridYKey,
          yMin,
          yMax,
          size,
          constraints,
        });
        setGridResult(r);
        setSweepResult(null);
      }
    } catch (e) {
      setSweepResult(null);
      setGridResult(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="result-block unc-block">
      <div className="unc-head">
        <h3 className="panel-title">设计探索</h3>
        <button className="btn-link" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开'}
        </button>
      </div>

      {open && (
        <>
          <p className="unc-hint">
            参数扫描沿单个参数取点，标出满足约束的连续区间；可行域同时变动两个参数，
            标出满足约束的设计窗口。其余参数保持当前值。
          </p>

          <div className="ex-tabs">
            <button
              className={`ex-tab${mode === 'sweep' ? ' active' : ''}`}
              onClick={() => setMode('sweep')}
            >
              参数扫描
            </button>
            <button
              className={`ex-tab${mode === 'grid' ? ' active' : ''}`}
              onClick={() => setMode('grid')}
            >
              可行域
            </button>
          </div>

          <div className="bs-form">
            <label className="bs-field">
              <span>{mode === 'sweep' ? '扫描参数' : '横轴参数'}</span>
              <select
                value={xKey}
                onChange={(e) => {
                  setXKey(e.target.value);
                  setSweepResult(null);
                  setGridResult(null);
                }}
              >
                {numericInputs.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.symbol} {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="bs-field">
              <span>扫描区间</span>
              <div className="bs-inline">
                <input
                  className="unc-rel"
                  type="number"
                  value={xMinText}
                  onChange={(e) => setXMinText(e.target.value)}
                />
                <span className="unc-pct">~</span>
                <input
                  className="unc-rel"
                  type="number"
                  value={xMaxText}
                  onChange={(e) => setXMaxText(e.target.value)}
                />
                <span className="unc-pct">{unitOf(formula, xKey, units)}</span>
              </div>
            </label>

            {mode === 'sweep' ? (
              <>
                <label className="bs-field">
                  <span>纵轴结果</span>
                  <select value={curveKey} onChange={(e) => setCurveKey(e.target.value)}>
                    {outputList.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.symbol} {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="bs-field">
                  <span>采样点数</span>
                  <select value={steps} onChange={(e) => setSteps(Number(e.target.value))}>
                    <option value={11}>11 点</option>
                    <option value={21}>21 点</option>
                    <option value={41}>41 点</option>
                    <option value={81}>81 点</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className="bs-field">
                  <span>纵轴参数</span>
                  <select
                    value={gridYKey}
                    onChange={(e) => {
                      setGridYKey(e.target.value);
                      setGridResult(null);
                    }}
                  >
                    {numericInputs
                      .filter((p) => p.key !== xKey)
                      .map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.symbol} {p.label}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="bs-field">
                  <span>纵轴区间</span>
                  <div className="bs-inline">
                    <input
                      className="unc-rel"
                      type="number"
                      value={yMinText}
                      onChange={(e) => setYMinText(e.target.value)}
                    />
                    <span className="unc-pct">~</span>
                    <input
                      className="unc-rel"
                      type="number"
                      value={yMaxText}
                      onChange={(e) => setYMaxText(e.target.value)}
                    />
                    <span className="unc-pct">{unitOf(formula, gridYKey, units)}</span>
                  </div>
                </label>
                <label className="bs-field">
                  <span>网格密度</span>
                  <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
                    <option value={11}>11 × 11</option>
                    <option value={21}>21 × 21</option>
                    <option value={31}>31 × 31</option>
                  </select>
                </label>
              </>
            )}
          </div>

          <div className="ex-cons">
            <div className="ex-cons-head">
              <span>设计约束</span>
              <button className="btn-link" onClick={addRow}>
                + 添加约束
              </button>
            </div>
            {rows.length === 0 && (
              <p className="ex-cons-empty">未设置约束时全部区域视为可行，仅用于观察结果分布。</p>
            )}
            {rows.map((r, i) => {
              const unit = outputUnit(formula, r.output);
              return (
                <div className="ex-cons-row" key={`${r.output}-${i}`}>
                  <select
                    value={r.output}
                    onChange={(e) => updateRow(i, { output: e.target.value })}
                  >
                    {outputList.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.symbol} {o.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={r.op}
                    onChange={(e) => updateRow(i, { op: e.target.value as ConstraintOp })}
                  >
                    {(Object.keys(CONSTRAINT_OP_LABEL) as ConstraintOp[]).map((op) => (
                      <option key={op} value={op}>
                        {CONSTRAINT_OP_LABEL[op]}
                      </option>
                    ))}
                  </select>
                  <input
                    className="unc-rel"
                    type="number"
                    value={r.value}
                    onChange={(e) => updateRow(i, { value: e.target.value })}
                  />
                  {r.op === 'between' && (
                    <>
                      <span className="unc-pct">~</span>
                      <input
                        className="unc-rel"
                        type="number"
                        value={r.value2}
                        onChange={(e) => updateRow(i, { value2: e.target.value })}
                      />
                    </>
                  )}
                  <span className="unc-pct">{unit}</span>
                  <button
                    className="btn-link danger"
                    onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  >
                    删除
                  </button>
                </div>
              );
            })}
          </div>

          <div className="unc-run">
            <button className="btn-primary sm" onClick={run} disabled={!inputsSI || !xKey}>
              运行
            </button>
            {!inputsSI && <span className="bind-hint">请先补全输入参数</span>}
          </div>

          {error && <div className="bind-error">{error}</div>}

          {sweepResult && (
            <SweepView
              formula={formula}
              result={sweepResult}
              xKey={xKey}
              curveKey={curveKey}
              xUnit={unitOf(formula, xKey, units)}
            />
          )}
          {gridResult && (
            <GridView
              formula={formula}
              result={gridResult}
              xKey={xKey}
              yKey={gridYKey}
              xUnit={unitOf(formula, xKey, units)}
              yUnit={unitOf(formula, gridYKey, units)}
            />
          )}
        </>
      )}
    </div>
  );
}

/** 参数扫描结果：曲线 + 可行段表格 */
function SweepView({
  formula,
  result,
  xKey,
  curveKey,
  xUnit,
}: {
  formula: FormulaSpec;
  result: SweepResult;
  xKey: string;
  curveKey: string;
  xUnit: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const xSpec = formula.inputs.find((p) => p.key === xKey);
  const ySpec = formula.outputs.find((o) => o.key === curveKey);
  const yUnit = ySpec?.unitGroup
    ? UNIT_GROUPS[ySpec.unitGroup]?.preferred ?? ySpec.unit
    : ySpec?.unit ?? '';

  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(ref.current);
    const chart = chartRef.current;
    const data = result.points.map((pt) => [
      fromSI(pt.x, xSpec?.unitGroup, xUnit),
      Number.isFinite(pt.y) ? fromSI(pt.y, ySpec?.unitGroup, yUnit) : null,
    ]);
    chart.setOption(
      {
        grid: { left: 62, right: 18, top: 30, bottom: 40 },
        tooltip: { trigger: 'axis', valueFormatter: (v: number) => formatNumber(v) },
        xAxis: {
          type: 'value',
          name: `${xSpec?.symbol ?? xKey} (${xUnit})`,
          nameLocation: 'middle',
          nameGap: 26,
          axisLabel: { fontSize: 11 },
        },
        yAxis: {
          type: 'value',
          name: `${ySpec?.symbol ?? curveKey} (${yUnit})`,
          nameTextStyle: { fontSize: 11 },
          axisLabel: { fontSize: 11 },
        },
        series: [
          {
            type: 'line',
            data,
            connectNulls: false,
            symbolSize: 5,
            lineStyle: { color: '#1a5fb4', width: 2 },
            itemStyle: { color: '#1a5fb4' },
            // 可行段用浅绿色带标出
            markArea: {
              silent: true,
              itemStyle: { color: 'rgba(46,125,50,0.12)' },
              data: result.segments.map(([a, b]) => [
                { xAxis: fromSI(a, xSpec?.unitGroup, xUnit) },
                { xAxis: fromSI(b, xSpec?.unitGroup, xUnit) },
              ]),
            },
          },
        ],
      },
      true,
    );
  }, [result, xSpec, ySpec, xUnit, yUnit, xKey, curveKey]);

  useEffect(() => {
    const onResize = () => chartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return (
    <>
      <p className="unc-summary">
        采样 {result.evaluated} 点 · 求解失败 {result.failed} 点 · 可行点占比{' '}
        {(result.ratio * 100).toFixed(1)}%
      </p>
      <div className="ex-chart" ref={ref} />
      {result.segments.length > 0 ? (
        <table className="unc-table bs-table">
          <thead>
            <tr>
              <th>可行区间</th>
              <th>
                {xSpec?.label}（{xUnit}）
              </th>
            </tr>
          </thead>
          <tbody>
            {result.segments.map(([a, b], i) => (
              <tr key={`${a}-${b}`}>
                <td>第 {i + 1} 段</td>
                <td>
                  {fmt(fromSI(a, xSpec?.unitGroup, xUnit), 4)} ~{' '}
                  {fmt(fromSI(b, xSpec?.unitGroup, xUnit), 4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-hint">当前区间内没有满足全部约束的取值，可放宽约束或扩大扫描区间。</p>
      )}
      <p className="ex-hint">浅绿色带为满足全部约束的可行段；区间边界受采样步长限制，加密采样可提高精度。</p>
    </>
  );
}

/** 可行域结果：二维热力图 */
function GridView({
  formula,
  result,
  xKey,
  yKey,
  xUnit,
  yUnit,
}: {
  formula: FormulaSpec;
  result: GridResult;
  xKey: string;
  yKey: string;
  xUnit: string;
  yUnit: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const xSpec = formula.inputs.find((p) => p.key === xKey);
  const ySpec = formula.inputs.find((p) => p.key === yKey);

  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(ref.current);
    const chart = chartRef.current;
    const xs = result.xs.map((v) => fromSI(v, xSpec?.unitGroup, xUnit));
    const ys = result.ys.map((v) => fromSI(v, ySpec?.unitGroup, yUnit));
    const data = result.cells.map((c) => [c.xi, c.yi, c.feasible ? 1 : 0]);
    chart.setOption(
      {
        grid: { left: 58, right: 22, top: 20, bottom: 44 },
        tooltip: {
          formatter: (p: { value: [number, number, number] }) => {
            const [xi, yi, v] = p.value;
            const cell = result.cells.find((c) => c.xi === xi && c.yi === yi);
            const shown = cell && Number.isFinite(cell.v) ? fmt(cell.v, 4) : '—';
            return [
              `${xSpec?.symbol ?? xKey} = ${fmt(xs[xi], 4)} ${xUnit}`,
              `${ySpec?.symbol ?? yKey} = ${fmt(ys[yi], 4)} ${yUnit}`,
              v === 1 ? '可行' : '不可行',
              `首个约束结果：${shown}`,
            ].join('<br/>');
          },
        },
        xAxis: {
          type: 'category',
          data: xs.map((v) => fmt(v, 3)),
          name: `${xSpec?.symbol ?? xKey} (${xUnit})`,
          nameLocation: 'middle',
          nameGap: 26,
          axisLabel: { fontSize: 10, rotate: 45 },
        },
        yAxis: {
          type: 'category',
          data: ys.map((v) => fmt(v, 3)),
          name: `${ySpec?.symbol ?? yKey} (${yUnit})`,
          nameTextStyle: { fontSize: 10 },
          axisLabel: { fontSize: 10 },
        },
        visualMap: {
          show: false,
          type: 'piecewise',
          pieces: [
            { value: 1, color: '#2e7d32' },
            { value: 0, color: '#eceff1' },
          ],
        },
        series: [
          {
            type: 'heatmap',
            data,
            itemStyle: { borderColor: '#fff', borderWidth: 1 },
            emphasis: { itemStyle: { borderColor: '#1a5fb4', borderWidth: 1 } },
          },
        ],
      },
      true,
    );
  }, [result, xSpec, ySpec, xUnit, yUnit, xKey, yKey]);

  useEffect(() => {
    const onResize = () => chartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return (
    <>
      <p className="unc-summary">
        网格 {result.xs.length} × {result.ys.length} · 可行格 {result.feasibleCount} 个（
        {(result.ratio * 100).toFixed(1)}%）· 求解失败 {result.failed} 格
      </p>
      <div className="ex-chart" ref={ref} />
      <p className="ex-hint">
        绿色为满足全部约束的网格点。可行域边界受网格密度限制，加密网格可提高分辨率、但求解次数按平方增长。
      </p>
    </>
  );
}
