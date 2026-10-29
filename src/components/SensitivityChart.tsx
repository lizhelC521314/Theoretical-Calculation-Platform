import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { FormulaSpec } from '../formula/types';

interface Props {
  formula: FormulaSpec;
  /** 当前 SI 输入 */
  inputsSI: Record<string, number> | null;
}

/**
 * 参数敏感性分析：对选定输入在 ±50% 范围内扫描，观察某个输出结果的变化趋势。
 * 用于快速判断哪个参数对结果影响最大（设计优化的方向）。
 */
export function SensitivityChart({ formula, inputsSI }: Props) {
  const numericInputs = formula.inputs.filter((p) => !p.options && p.kind !== 'select');
  const [xKey, setXKey] = useState(numericInputs[0]?.key ?? '');
  const [yKey, setYKey] = useState(formula.outputs[0]?.key ?? '');
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(ref.current);
    const chart = chartRef.current;

    if (!inputsSI || !xKey || !yKey) {
      chart.clear();
      return;
    }
    const base = inputsSI[xKey];
    if (!Number.isFinite(base) || base === 0) {
      chart.clear();
      return;
    }

    const points: [number, number][] = [];
    for (let i = 0; i <= 20; i++) {
      const factor = 0.5 + (i / 20) * 1.0; // 0.5x ~ 1.5x
      const probe = { ...inputsSI, [xKey]: base * factor };
      try {
        const out = formula.solve(probe);
        const y = out[yKey];
        if (Number.isFinite(y)) points.push([base * factor, y]);
      } catch {
        /* 该参数点不可解，跳过 */
      }
    }

    const xSpec = formula.inputs.find((p) => p.key === xKey);
    const ySpec = formula.outputs.find((o) => o.key === yKey);

    chart.setOption(
      {
        grid: { left: 62, right: 18, top: 34, bottom: 40 },
        tooltip: { trigger: 'axis' },
        xAxis: {
          type: 'value',
          name: `${xSpec?.symbol ?? xKey} (${xSpec?.unit ?? ''})`,
          nameLocation: 'middle',
          nameGap: 26,
          axisLabel: { fontSize: 11 },
        },
        yAxis: {
          type: 'value',
          name: `${ySpec?.symbol ?? yKey} (${ySpec?.unit ?? ''})`,
          nameTextStyle: { fontSize: 11 },
          axisLabel: { fontSize: 11 },
        },
        series: [
          {
            type: 'line',
            smooth: true,
            symbolSize: 5,
            data: points,
            lineStyle: { color: '#1a5fb4', width: 2 },
            itemStyle: { color: '#1a5fb4' },
            areaStyle: { color: 'rgba(26,95,180,0.08)' },
          },
        ],
      },
      true,
    );
  }, [formula, inputsSI, xKey, yKey]);

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
    <div className="sensitivity">
      <div className="sens-head">
        <span className="panel-title">参数敏感性分析</span>
        {formula.sensitivity !== false && (
          <div className="sens-controls">
            <label>
              变量
              <select value={xKey} onChange={(e) => setXKey(e.target.value)}>
                {numericInputs.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.symbol} {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              结果
              <select value={yKey} onChange={(e) => setYKey(e.target.value)}>
                {formula.outputs.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.symbol} {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
      {formula.sensitivity === false ? (
        <p className="sens-hint">
          本公式为两点试验数据联立反算，单独扫描某一个输入参数会破坏两组数据之间的关联，
          扫描结果不具备物理意义，故不提供敏感性分析。
        </p>
      ) : (
        <>
          <div className="sens-chart" ref={ref} />
          <p className="sens-hint">横轴为所选变量在当前值 0.5~1.5 倍区间内扫描，纵轴为所选结果的变化。</p>
        </>
      )}
    </div>
  );
}
