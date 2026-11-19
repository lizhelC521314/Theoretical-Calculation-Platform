import { memo, useEffect, useMemo, useRef } from 'react';
import { echarts, type EChartsInstance } from './echarts';
import type { CurveSpec } from '../formula/types';

interface Props {
  spec: CurveSpec;
  /** 当前 SI 输入；为 null 时不绘制 */
  inputsSI: Record<string, number> | null;
}

/**
 * 结果曲线图：绘制公式在当前输入下随自变量变化的连续曲线
 * （如亥姆霍兹消音器的 TL - Frequency 曲线）。
 */
function CurveChartView({ spec, inputsSI }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsInstance | null>(null);

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

    // 给 series 显式设置稳定 id（用 formula.id + "curve"），
    // 让 ECharts 的 replaceMerge 能精确匹配替换，防止旧 series 残留
    const option = {
      grid: { left: 62, right: 18, top: 34, bottom: 42 },
      tooltip: {
        trigger: 'axis' as const,
        valueFormatter: (val: number) => `${val.toFixed(3)}`,
      },
      xAxis: {
        type: 'value' as const,
        name: spec.xLabel,
        nameLocation: 'middle' as const,
        nameGap: 26,
        axisLabel: { fontSize: 11 },
      },
      yAxis: {
        type: 'value' as const,
        name: spec.yLabel,
        nameTextStyle: { fontSize: 11 },
        axisLabel: { fontSize: 11 },
      },
      series: [
        {
          id: `${spec.label}-main`,
          type: 'line' as const,
          smooth: true,
          symbol: 'none',
          data: points.map((p) => [p.x, p.y]),
          lineStyle: { color: '#c0392b', width: 2 },
          itemStyle: { color: '#c0392b' },
          areaStyle: { color: 'rgba(192,57,43,0.06)' },
        },
      ],
    };

    // 强制 notMerge: true —— 最保守策略，每次 setOption 全量替换所有配置
    // 彻底防止旧 series 残留（用户反馈计算后多次出现"多条曲线"的根因）
    chart.setOption(option, { notMerge: true });
  }, [spec, points]);

  useEffect(() => {
    // 窗口尺寸变化用 rAF 合并，拖动窗口时不会每一帧都重排图表
    let raf = 0;
    const onResize = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        chartRef.current?.resize();
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (raf) window.cancelAnimationFrame(raf);
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

export const CurveChart = memo(CurveChartView);
