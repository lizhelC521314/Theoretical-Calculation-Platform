import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import type { CurveSpec } from '../formula/types';

interface Props {
  spec: CurveSpec;
  /** 当前 SI 输入；为 null 时不绘制 */
  inputsSI: Record<string, number> | null;
}

/**
 * 结果曲线图：绘制公式在当前输入下随自变量变化的连续曲线
 * （如赫姆霍兹消音器的 TL - Frequency 曲线）。
 */
export function CurveChart({ spec, inputsSI }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const points = useMemo(() => {
    if (!inputsSI) return [];
    try {
      return spec.compute(inputsSI).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    } catch {
      return [];
    }
  }, [spec, inputsSI]);

  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(ref.current);
    const chart = chartRef.current;

    if (points.length === 0) {
      chart.clear();
      return;
    }

    chart.setOption(
      {
        grid: { left: 62, right: 18, top: 34, bottom: 42 },
        tooltip: {
          trigger: 'axis',
          valueFormatter: (val: number) => `${val.toFixed(2)}`,
        },
        xAxis: {
          type: 'value',
          name: spec.xLabel,
          nameLocation: 'middle',
          nameGap: 26,
          axisLabel: { fontSize: 11 },
        },
        yAxis: {
          type: 'value',
          name: spec.yLabel,
          nameTextStyle: { fontSize: 11 },
          axisLabel: { fontSize: 11 },
        },
        series: [
          {
            type: 'line',
            smooth: true,
            symbol: 'none',
            data: points.map((p) => [p.x, p.y]),
            lineStyle: { color: '#c0392b', width: 2 },
            itemStyle: { color: '#c0392b' },
            areaStyle: { color: 'rgba(192,57,43,0.06)' },
          },
        ],
      },
      true,
    );
  }, [spec, points]);

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
    <div className="curve-block">
      <div className="sens-head">
        <span className="panel-title">{spec.label}</span>
      </div>
      <div className="sens-chart" ref={ref} />
      <p className="sens-hint">
        横轴 {spec.xLabel}，纵轴 {spec.yLabel}；曲线在共振中心频率处达到峰值（理论模型在该点趋于无穷大，图中为奇异点两侧的采样值）。
      </p>
    </div>
  );
}
