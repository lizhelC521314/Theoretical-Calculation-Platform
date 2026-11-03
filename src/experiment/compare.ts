/**
 * §7 比较判据（核心）
 *
 * 线性量（压降、力、位移）：|model − test| / |test| ≤ 5% 且 ≤ U95（取二者较大值）
 * 声学量（TL、声压级）：|ΔdB| ≤ 1.5 dB 且 ≤ U95(dB)；不允许用"5%"
 * 曲线指标（全部满足才 PASS）：MAPE ≤ 5%、RMSE ≤ 2 dB（声学）/ ≤5%（线性）、
 *   峰值频率偏差 ≤5%、带内平均偏差 ≤1.5 dB
 * 三态输出：PASS / FAIL / SUSPECT（数据质量问题，不算模型偏差）
 */
import type { ComparisonMetrics, CurvePoint, QuantityKind, Verdict } from './types';

export interface CompareVerdict {
  verdict: Verdict;
  metrics: ComparisonMetrics;
  reason: string;
}

/** 标量对比：threshold = max(相对限值, U95) */
export function compareScalar(kind: QuantityKind, model: number, test: number, u95?: number): CompareVerdictScalar {
  if (kind === 'acoustic') {
    const absErr = Math.abs(model - test);
    const limit = Math.max(1.5, u95 ?? 0);
    return {
      verdict: absErr <= limit ? 'PASS' : 'FAIL',
      metrics: { refValue: test, modelValue: model, absErrDb: absErr },
      reason: `|Δ| = ${absErr.toFixed(2)} dB，限值 ${limit.toFixed(2)} dB（1.5 dB 与 U95 取大）`,
    };
  }
  const relErr = test !== 0 ? Math.abs(model - test) / Math.abs(test) : (model === 0 ? 0 : Infinity);
  const limitAbs = Math.max(0.05 * Math.abs(test), u95 ?? 0);
  const pass = Math.abs(model - test) <= limitAbs;
  return {
    verdict: pass ? 'PASS' : 'FAIL',
    metrics: { refValue: test, modelValue: model, relErrPct: relErr * 100 },
    reason: `|偏差| = ${Math.abs(model - test).toFixed(3)}，限值 ${limitAbs.toFixed(3)}（5%·|test| 与 U95 取大）`,
  };
}

interface CompareVerdictScalar {
  verdict: Verdict;
  metrics: ComparisonMetrics;
  reason: string;
}

/** 线性插值：把模型曲线重采样到实测 x 上（x 需升序） */
export function resample(modelPts: CurvePoint[], xs: number[]): number[] {
  const pts = [...modelPts].sort((a, b) => a.x - b.x);
  return xs.map((x) => {
    if (x <= pts[0].x) return pts[0].y;
    if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i].x) {
        const t = (x - pts[i - 1].x) / (pts[i].x - pts[i - 1].x);
        return pts[i - 1].y + t * (pts[i].y - pts[i - 1].y);
      }
    }
    return pts[pts.length - 1].y;
  });
}

/**
 * 曲线对比：四项指标全部满足才 PASS。
 * 声学：RMSE ≤ 2 dB、峰值频率偏差 ≤5%、带内平均 |偏差| ≤ 1.5 dB（MAPE 不适用 dB）；
 * 线性：MAPE ≤ 5%、RMSE/|均值| ≤ 5%、峰值频率偏差 ≤5%、带内平均相对偏差 ≤5%。
 */
export function compareCurve(kind: QuantityKind, modelPts: CurvePoint[], testPts: CurvePoint[]): CompareVerdict {
  const sorted = [...testPts].sort((a, b) => a.x - b.x);
  const xs = sorted.map((p) => p.x);
  const ts = sorted.map((p) => p.y);
  const ms = resample(modelPts, xs);
  const n = xs.length;
  const diffs = ms.map((m, i) => m - ts[i]);

  // 峰值频率偏差
  const peakAt = (arr: number[]) => xs[arr.indexOf(Math.max(...arr))];
  const fModel = peakAt(ms);
  const fTest = peakAt(ts);
  const peakFreqDevPct = fTest !== 0 ? (Math.abs(fModel - fTest) / fTest) * 100 : 0;

  const rmse = Math.sqrt(diffs.reduce((a, d) => a + d * d, 0) / n);
  const bandAvgDev = diffs.reduce((a, d) => a + d, 0) / n;

  const fails: string[] = [];
  const metrics: ComparisonMetrics = { rmse, peakFreqDevPct, bandAvgDev };

  if (kind === 'acoustic') {
    metrics.mapePct = undefined;
    if (rmse > 2) fails.push(`RMSE ${rmse.toFixed(2)} dB > 2 dB`);
    if (peakFreqDevPct > 5) fails.push(`峰值频率偏差 ${peakFreqDevPct.toFixed(2)}% > 5%`);
    if (Math.abs(bandAvgDev) > 1.5) fails.push(`带内平均偏差 ${bandAvgDev.toFixed(2)} dB 超 ±1.5 dB`);
  } else {
    const mape = (diffs.reduce((a, d, i) => a + (ts[i] !== 0 ? Math.abs(d / ts[i]) : 0), 0) / n) * 100;
    const meanAbs = ts.reduce((a, t) => a + Math.abs(t), 0) / n;
    const rmseRel = meanAbs !== 0 ? rmse / meanAbs : 0;
    const bandAvgRel = meanAbs !== 0 ? bandAvgDev / meanAbs : 0;
    metrics.mapePct = mape;
    if (mape > 5) fails.push(`MAPE ${mape.toFixed(2)}% > 5%`);
    if (rmseRel > 0.05) fails.push(`RMSE/|均值| ${(rmseRel * 100).toFixed(2)}% > 5%`);
    if (peakFreqDevPct > 5) fails.push(`峰值频率偏差 ${peakFreqDevPct.toFixed(2)}% > 5%`);
    if (Math.abs(bandAvgRel) > 0.05) fails.push(`带内平均相对偏差 ${(bandAvgRel * 100).toFixed(2)}% > 5%`);
  }

  return {
    verdict: fails.length === 0 ? 'PASS' : 'FAIL',
    metrics,
    reason: fails.length === 0 ? '曲线指标全部满足 §7 限值' : fails.join('；'),
  };
}

/** 汇总：QC 已标记 SUSPECT 的量直接给出 SUSPECT（不算模型偏差） */
export function finalVerdict(suspect: boolean, base: CompareVerdict): CompareVerdict {
  if (suspect) return { ...base, verdict: 'SUSPECT', reason: `数据质量问题（QC SUSPECT），退回补测；${base.reason}` };
  return base;
}
