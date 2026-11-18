import { describe, expect, it } from 'vitest';
import {
  fromU,
  huber,
  invert3,
  nominalCenters,
  tQuantile975,
  toU,
} from '../src/ai/calibration/math';
import { calibrate } from '../src/ai/calibration/run';
import { renderFitChartSvg, renderResidualChartSvg } from '../src/ai/calibration/chart';
import { renderReportMarkdown } from '../src/ai/calibration/report';
import { JCA_POROUS_V11 } from '../src/ai/calibration/strategies/jcaPorousV11';
import { wovenTubeInputs, wovenTubeModel } from '../src/ai/calibration/adapters/wovenTube';
import type { CalibrationDataset } from '../src/ai/calibration/types';

describe('标定引擎 · 数学工具', () => {
  it('1/3 倍频带中心为 GB/ISO 标称值，且不固定 24 带', () => {
    const c = nominalCenters(20, 5000);
    expect(c[0]).toBe(20);
    expect(c).toContain(100);
    expect(c).toContain(1000);
    expect(c).toContain(5000);
    expect(c).not.toContain(6300);
    expect(nominalCenters(100, 2000).length).toBe(14);
  });

  it('Huber 损失在 δ 处连续', () => {
    const d = 2;
    expect(huber(1, d)).toBeCloseTo(0.5, 12);
    expect(huber(-1, d)).toBeCloseTo(0.5, 12);
    expect(huber(2, d)).toBeCloseTo(2, 12);
    expect(huber(4, d)).toBeCloseTo(2 * (4 - 1), 12);
  });

  it('参数变换可往返（ln / 尺度）', () => {
    const cr = JCA_POROUS_V11.params[0];
    const al = JCA_POROUS_V11.params[1];
    expect(fromU(cr, toU(cr, 0.6))).toBeCloseTo(0.6, 12);
    expect(fromU(al, toU(al, 34.2))).toBeCloseTo(34.2, 12);
  });

  it('t 分位使用 t 表而非固定 1.96', () => {
    expect(tQuantile975(22)).toBeCloseTo(2.074, 3);
    expect(tQuantile975(100)).toBe(1.96);
  });

  it('3×3 求逆正确', () => {
    const m = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ];
    const inv = invert3(m);
    expect(inv).not.toBeNull();
    const prod = m.map((row) => row.map((_, j) => row.reduce((s, v, k) => s + v * inv![k][j], 0)));
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(prod[i][j]).toBeCloseTo(i === j ? 1 : 0, 10);
    }
  });
});

describe('标定引擎 · 端到端', () => {
  /** 用已知参数生成 1/3 倍频带上的合成曲线，再反演 */
  function synthetic(cr: number, al: number, bl: number): CalibrationDataset {
    const inputs = wovenTubeInputs({ D: 50, L: 300, t: 2.7, fp: 1400 });
    const points: { f: number; y: number }[] = [];
    for (const fc of nominalCenters(20, 5000)) {
      const lo = fc / Math.pow(2, 1 / 6);
      const hi = fc * Math.pow(2, 1 / 6);
      for (let i = 0; i <= 20; i++) {
        const f = lo + ((hi - lo) * i) / 20;
        const [v] = wovenTubeModel(inputs, { C_R: cr, A_L: al, B_L: bl }, [f]);
        points.push({ f, y: v + 0.03 * Math.sin(i * 1.7) });
      }
    }
    return {
      id: 'synthetic',
      formulaId: JCA_POROUS_V11.formulaId,
      quantity: 'TL',
      unit: 'dB',
      inputs,
      points,
      groupId: 'synthetic-L300',
      hash: 'synthetic',
    };
  }

  it('可反演出已知参数（±3%）', () => {
    const truth = { C_R: 0.55, A_L: 33, B_L: -22 };
    const ds = synthetic(truth.C_R, truth.A_L, truth.B_L);
    const report = calibrate({
      strategy: {
        ...JCA_POROUS_V11,
        optimizer: { ...JCA_POROUS_V11.optimizer, starts: 5, maxIter: 800 },
      },
      dataset: ds,
      model: wovenTubeModel,
      formulaVersion: 'test',
      seed: 7,
      fast: true,
    });
    const byKey = Object.fromEntries(report.params.map((p) => [p.key, p.value]));
    expect(byKey.C_R).toBeCloseTo(truth.C_R, 1);
    expect(Math.abs(byKey.A_L - truth.A_L) / truth.A_L).toBeLessThan(0.03);
    expect(Math.abs(byKey.B_L - truth.B_L) / Math.abs(truth.B_L)).toBeLessThan(0.03);
    expect(report.bands.filter((b) => b.included).length).toBeGreaterThanOrEqual(20);
    expect(report.validation.status).toBe('calibrated-only');
  });

  it('同种子结果可复现', () => {
    const ds = synthetic(0.5, 32, -24);
    const run = () =>
      calibrate({
        strategy: { ...JCA_POROUS_V11, optimizer: { ...JCA_POROUS_V11.optimizer, starts: 3, maxIter: 400 } },
        dataset: ds,
        model: wovenTubeModel,
        seed: 11,
        fast: true,
      });
    const a = run();
    const b = run();
    expect(a.params.map((p) => p.value)).toEqual(b.params.map((p) => p.value));
  });
});

describe('标定图形输出', () => {
  const inputs = wovenTubeInputs({ D: 50, L: 300, t: 2.7, fp: 1400 });
  const points: { f: number; y: number }[] = [];
  for (const fc of nominalCenters(20, 2000)) {
    for (let i = 0; i <= 4; i++) {
      const f = fc * (1 + (i - 2) * 0.02);
      points.push({ f, y: wovenTubeModel(inputs, { C_R: 0.5, A_L: 32, B_L: -24 }, [f])[0] });
    }
  }
  const dataset: CalibrationDataset = {
    id: 'chart-test',
    formulaId: JCA_POROUS_V11.formulaId,
    quantity: 'TL',
    unit: 'dB',
    inputs,
    points,
    groupId: 'chart-L300',
    hash: 'chart',
  };
  const report = calibrate({
    strategy: { ...JCA_POROUS_V11, optimizer: { ...JCA_POROUS_V11.optimizer, starts: 2, maxIter: 200 } },
    dataset,
    model: wovenTubeModel,
    fast: true,
    seed: 3,
  });

  it('拟合曲线 SVG 含实测/模型两条曲线且无非法数值', () => {
    const svg = renderFitChartSvg(report);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('传递损失拟合曲线');
    expect(svg).toContain('实测（1/3 倍频带均值）');
    expect(svg).toContain('模型（频带）');
    expect(svg.match(/<path /g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('残差图为每个有效频带绘制柱形并标注 ±RMSE', () => {
    const svg = renderResidualChartSvg(report);
    const included = report.bands.filter((b) => b.included).length;
    expect(included).toBeGreaterThan(5);
    expect(svg.match(/<rect /g)?.length ?? 0).toBeGreaterThanOrEqual(included);
    expect(svg).toContain('逐带残差（模型 − 实测）');
    expect(svg).toContain('RMSE');
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('报告附图形链接', () => {
    const md = renderReportMarkdown(report, { curveFile: 'fit.svg', residualFile: 'residual.svg' });
    expect(md).toContain('## 10 图形');
    expect(md).toContain('![实测/模型拟合曲线](fit.svg)');
    expect(md).toContain('![逐带残差](residual.svg)');
  });
});
