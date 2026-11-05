import { useMemo } from 'react';
import type { MaterialCurve, MaterialCurveKey } from '../report/material';

interface Props {
  curve: MaterialCurve | null;
  kind: MaterialCurveKey;
}

/** 材料曲线小图：应力应变 / 疲劳寿命（疲劳横轴取对数） */
export function MaterialCurvePlot({ curve, kind }: Props) {
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

  const W = 360;
  const H = 140;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 24;

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
    return <circle key={`${p.x}-${p.y}`} cx={px(x)} cy={py(p.y)} r={2.4} fill="#1a5fb4" />;
  });

  const grid = [0, 1, 2, 3].map((i) => {
    const y = padT + (i * (H - padT - padB)) / 3;
    return <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eef2f7" />;
  });

  return (
    <svg className="mat-curve-plot" viewBox={`0 0 ${W} ${H}`} role="img">
      {grid}
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#cfdbe9" />
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#cfdbe9" />
      <path d={path} fill="none" stroke="#1a5fb4" strokeWidth={1.8} />
      {dots}
      <text x={W - padR} y={H - 6} fontSize={9} fill="#8a99ab" textAnchor="end">
        {isFatigue ? 'N (cycles，对数轴)' : 'ε (%)'}
      </text>
      <text x={8} y={14} fontSize={9} fill="#8a99ab">
        σ (MPa)
      </text>
    </svg>
  );
}
