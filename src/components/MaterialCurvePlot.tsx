import { useMemo } from 'react';
import type { MaterialCurve, MaterialCurveKey } from '../report/material';

interface Props {
  curve: MaterialCurve | null;
  kind: MaterialCurveKey;
  /** 正方形画布（高:宽 = 1:1），用于检索页浏览区 */
  square?: boolean;
}

/** 材料曲线小图：应力应变 / 疲劳寿命（疲劳横轴取对数） */
export function MaterialCurvePlot({ curve, kind, square }: Props) {
  const points = useMemo(() => {
    if (!curve || !curve.points.length) return [];
    return [...curve.points].sort((a, b) => a.x - b.x);
  }, [curve]);

  if (!points.length) {
    return <div className="mat-curve-empty">暂无曲线数据</div>;
  }

  const isFatigue = kind === 'fatigueCurve';
  const xs = points.map((p) => (isFatigue ? Math.log10(Math.max(p.x, 1)) : p.x));
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const x0 = isFatigue ? minX : 0;
  const spanX = maxX - x0 || 1;
  const spanY = maxY || 1;

  const W = square ? 340 : 360;
  const H = square ? 340 : 140;
  const padL = square ? 50 : 44;
  const padR = square ? 20 : 12;
  const padT = square ? 26 : 12;
  const padB = square ? 42 : 24;

  const px = (x: number) => padL + ((x - x0) / spanX) * (W - padL - padR);
  const py = (y: number) => H - padB - (y / spanY) * (H - padT - padB);

  const path = points
    .map((p, i) => {
      const x = isFatigue ? Math.log10(Math.max(p.x, 1)) : p.x;
      return `${i === 0 ? 'M' : 'L'}${px(x).toFixed(1)},${py(p.y).toFixed(1)}`;
    })
    .join(' ');

  const dots = points.map((p) => {
    const x = isFatigue ? Math.log10(Math.max(p.x, 1)) : p.x;
    return (
      <circle
        key={`${p.x}-${p.y}`}
        cx={px(x)}
        cy={py(p.y)}
        r={square ? 3 : 2.4}
        fill="#1a5fb4"
      />
    );
  });

  const gridCount = square ? 6 : 4;
  const grid = Array.from({ length: gridCount }, (_, i) => {
    const y = padT + (i * (H - padT - padB)) / (gridCount - 1);
    return <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef2f7" />;
  });
  const vGrid = square
    ? Array.from({ length: 5 }, (_, i) => {
        const x = padL + (i * (W - padL - padR)) / 4;
        return <line key={`v${i}`} x1={x} y1={padT} x2={x} y2={H - padB} stroke="#f4f7fb" />;
      })
    : null;

  const axisFont = square ? 11 : 9;

  return (
    <svg
      className={square ? 'mat-curve-plot is-square' : 'mat-curve-plot'}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
    >
      {grid}
      {vGrid}
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#cfdbe9" />
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#cfdbe9" />
      <path d={path} fill="none" stroke="#1a5fb4" strokeWidth={square ? 2 : 1.8} />
      {dots}
      <text
        x={W - padR}
        y={H - (square ? 14 : 6)}
        fontSize={axisFont}
        fill="#8a99ab"
        textAnchor="end"
      >
        {isFatigue ? 'N (cycles，对数轴)' : 'ε (%)'}
      </text>
      <text x={square ? 10 : 8} y={square ? 16 : 14} fontSize={axisFont} fill="#8a99ab">
        σ (MPa)
      </text>
    </svg>
  );
}
