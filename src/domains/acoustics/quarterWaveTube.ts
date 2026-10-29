import type { CurvePoint, FormulaSpec } from '../../formula/types';
import { QUARTER_WAVE_DIAGRAM } from './diagrams';

/**
 * 四分之一波长管消音器（Quarter-Wavelength Tube Muffler）
 *
 * 主公式（与参考 PPT 严格一致）：
 *   中心频率  f_c = c/(4L)
 *   传递损失  TL = 10·lg[ 1 + (1/4)·( m·tan(2πL/λ) )² ]
 *   辅助式    m = Sc/Sp，Sc = πd²/4，Sp = πD²/4，c ≈ 331.3 + 0.606·t，λ = c/f
 *
 * TL 曲线按 PPT 给定：f 取值范围 0.5f_c ~ 2f_c，均分 200 份（201 个采样点），
 * 纵轴 TL（dB），横轴 Frequency（Hz）。
 */

/** PPT 给定的频带均分段数（0.5f_c ~ 2f_c 均分 200 份，共 201 个采样点） */
const SEGMENTS = 200;

/** 由 SI 输入算出中间量：截面积（直径优先，置 0 时按面积输入）、截面比、声速、中心频率 */
function derive(v: Record<string, number>) {
  const { Sp, D, Sc, d, L, t } = v;
  if (!Number.isFinite(t)) return null;
  const sp = D > 0 ? (Math.PI * D * D) / 4 : Sp;
  const sc = d > 0 ? (Math.PI * d * d) / 4 : Sc;
  if (!(sp > 0) || !(sc > 0) || !(L > 0)) return null;
  const c = 331.3 + 0.606 * (t - 273.15);
  const m = sc / sp;
  const fc = c / (4 * L);
  const dEq = 2 * Math.sqrt(sc / Math.PI);
  const DEq = 2 * Math.sqrt(sp / Math.PI);
  return { c, m, sc, sp, dEq, DEq, L, fc };
}

/**
 * 单频点传递损失（dB）：
 *   TL = 10·lg[ 1 + (1/4)·( m·tan(2πL/λ) )² ]，λ = c/f
 * f = f_c 时 tan(π/2) 趋于无穷大（无阻尼理论奇异点）。
 */
function tlAtFreq(f: number, r: NonNullable<ReturnType<typeof derive>>): number {
  if (!(f > 0)) return 0;
  const lambda = r.c / f;
  const tg = r.m * Math.tan((2 * Math.PI * r.L) / lambda);
  return 10 * Math.log10(1 + 0.25 * tg * tg);
}

/** 频带 [0.5f_c, 2f_c] 均分 200 份采样 TL 曲线 */
function sampleCurve(r: NonNullable<ReturnType<typeof derive>>): CurvePoint[] {
  const { fc } = r;
  if (!(fc > 0)) return [];
  const points: CurvePoint[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const f = 0.5 * fc + (i * 1.5 * fc) / SEGMENTS;
    const tl = tlAtFreq(f, r);
    if (!Number.isFinite(tl)) continue;
    points.push({ x: f, y: tl });
  }
  return points;
}

export const quarterWaveTube: FormulaSpec = {
  id: 'acoustics.muffler.quarterWave',
  domain: 'acoustics',
  subsystem: '消声器',
  title: '四分之一波长管消音器',
  summary: '由主管道与四分之一波长管截面、管长计算中心频率与传递损失 TL 曲线，用于针对单一频率的旁支消声设计。',
  tags: ['四分之一波长管', '消音器', '消声器', '传递损失', 'TL', '中心频率', 'NVH', '进气系统', '排气系统'],
  description:
    '四分之一波长管消音器在主管道旁接一根长度为 L 的闭端支管，当管长等于声波波长的四分之一时（f_c = c/(4L)）产生最大传递损失。本公式按参考 PPT 计算：TL = 10lg[1 + (1/4)(m·tan(2πL/λ))²]，截面比 m = Sc/Sp，Sc = πd²/4，Sp = πD²/4，波长 λ = c/f，声速 c ≈ 331.3 + 0.606t（t 为摄氏温度）。主管道与波长管的截面积/直径均可二选一输入（直径优先，置 0 时按面积）。结果区输出中心频率与频带内 TL 峰值，并绘制 TL - Frequency 曲线（0.5f_c ~ 2f_c 均分 200 份，纵轴 TL/dB，横轴 Frequency/Hz）。',
  inputs: [
    { key: 'Sp', label: '主管道截面积', symbol: 'S_p', unit: 'mm²', unitGroup: 'area', default: 2827, min: 0, required: true, description: '与直径 D 二选一：D = 0 时按本值计算；D > 0 时自动按 S_p = πD²/4 取值' },
    { key: 'D', label: '主管道直径', symbol: 'D', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, required: true, description: '非零时优先按 D 计算 S_p；置 0 则直接采用上方输入的 S_p' },
    { key: 'Sc', label: '四分之一波长管截面积', symbol: 'S_c', unit: 'mm²', unitGroup: 'area', default: 314, min: 0, required: true, description: '与直径 d 二选一：d = 0 时按本值计算；d > 0 时自动按 S_c = πd²/4 取值' },
    { key: 'd', label: '四分之一波长管直径', symbol: 'd', unit: 'mm', unitGroup: 'diameter', default: 10, min: 0, required: true, description: '非零时优先按 d 计算 S_c；置 0 则直接采用上方输入的 S_c' },
    { key: 'L', label: '四分之一波长管长度', symbol: 'L', unit: 'mm', unitGroup: 'length', default: 100, min: 0, required: true, description: '闭端支管长度，决定中心频率 f_c = c/(4L)' },
    { key: 't', label: '温度', symbol: 't', unit: '℃', unitGroup: 'temperature', default: 25, required: true, description: '介质温度，用于计算声速 c ≈ 331.3 + 0.606t' },
  ],
  outputs: [
    { key: 'fc', label: '中心频率', symbol: 'f_c', unit: 'Hz', primary: true, group: '声学特性', description: 'f_c = c/(4L)，管长等于四分之一波长时 TL 达到峰值' },
    { key: 'tl', label: '传递损失', symbol: 'TL', unit: 'dB', primary: true, group: '声学特性', description: 'TL 曲线的最大值（0.5f_c~2f_c 均分 200 份采样）。理论模型在 f = f_c 处 tan 项趋于无穷大（无阻尼），此处取最接近中心频率的采样点对应的 TL 值' },
    { key: 'c', label: '介质声速', symbol: 'c', unit: 'm/s', group: '声学特性', description: 'c ≈ 331.3 + 0.606·t（t 为摄氏温度）' },
    { key: 'm', label: '截面比', symbol: 'm', unit: '—', group: '中间量', description: 'm = S_c/S_p，波长管与主管道截面积之比' },
    { key: 'sc', label: '波长管截面积', symbol: 'S_c', unit: 'mm²', unitGroup: 'area', group: '中间量', description: '直径输入时 S_c = πd²/4；否则为输入值' },
    { key: 'sp', label: '主管道截面积', symbol: 'S_p', unit: 'mm²', unitGroup: 'area', group: '中间量', description: '直径输入时 S_p = πD²/4；否则为输入值' },
    { key: 'dEq', label: '波长管当量直径', symbol: 'd', unit: 'mm', unitGroup: 'diameter', group: '中间量', description: '由截面积换算 d = 2√(S_c/π)' },
    { key: 'DEq', label: '主管道当量直径', symbol: 'D', unit: 'mm', unitGroup: 'diameter', group: '中间量', description: '由截面积换算 D = 2√(S_p/π)' },
  ],
  latex: [
    {
      label: '中心频率（主公式）',
      tex: 'f_c = \\frac{c}{4L}',
    },
    {
      label: '传递损失（主公式）',
      tex: 'TL = 10\\,\\log_{10}\\left[1 + \\frac{1}{4}\\left(m\\,\\tan\\frac{2\\pi L}{\\lambda}\\right)^{2}\\right]',
    },
    {
      label: '辅助式',
      tex: 'm = \\frac{S_c}{S_p},\\qquad S_c = \\frac{\\pi d^{2}}{4},\\qquad S_p = \\frac{\\pi D^{2}}{4},\\qquad c \\approx 331.3 + 0.606\\,t,\\qquad \\lambda = \\frac{c}{f}',
    },
    {
      label: 'TL 曲线（频带均分 200 份）',
      tex: 'f \\in \\left[0.5\\,f_c,\\,2\\,f_c\\right]\\;\\text{均分 200 份},\\qquad TL = TL(f)',
    },
  ],
  diagram: QUARTER_WAVE_DIAGRAM,
  sensitivity: true,
  assumptions: [
    '公式与参考 PPT 严格一致：f_c = c/(4L)，TL = 10lg[1 + (1/4)(m·tan(2πL/λ))²]，m = Sc/Sp，λ = c/f',
    '截面积与直径二选一（PPT 说明：任一输入，不能同时输入）：d > 0 时按 S_c = πd²/4 计算，d = 0 时直接取用输入的 S_c；D 与 S_p 同理',
    '声速按经验式 c ≈ 331.3 + 0.606t 计算（t 为摄氏温度），未计湿度与压力影响',
    '模型忽略支管声阻尼（粘性、热传导），理论 TL 在 f = f_c 处 tan(π/2) 趋于无穷大，实际峰值受声阻限制为有限值',
    '一维平面波理论：支管与主管道截面尺寸须远小于波长，未计高阶模态与气流流速',
    'TL 曲线与峰值均按 PPT 给定的 0.5f_c ~ 2f_c 频带均分 200 份采样；工程设计中 f_c 应正对噪声主导频率',
  ],
  solve(v) {
    const empty = {
      fc: NaN, tl: NaN, c: NaN, m: NaN, sc: NaN, sp: NaN, dEq: NaN, DEq: NaN,
    };
    const r = derive(v);
    if (!r) return empty;
    // TL 取曲线最大值（与曲线共用同一采样，保证峰值与曲线最大值严格一致）
    const pts = sampleCurve(r);
    let tl = NaN;
    if (pts.length > 0) {
      tl = Math.max(...pts.map((p) => p.y));
    }
    return { fc: r.fc, tl, c: r.c, m: r.m, sc: r.sc, sp: r.sp, dEq: r.dEq, DEq: r.DEq };
  },
  curve: {
    label: '传递损失 TL 曲线',
    xLabel: 'Frequency (Hz)',
    yLabel: 'TL (dB)',
    compute(v) {
      const r = derive(v);
      if (!r) return [];
      return sampleCurve(r);
    },
  },
  benchmarks: [
    {
      name: '默认工况（直径输入：d=10mm, D=60mm, L=100mm, t=25℃）',
      input: {
        Sp: 2.827433388230814e-3, D: 0.06, Sc: 7.853981633974483e-5, d: 0.01,
        L: 0.1, t: 298.15,
      },
      expect: {
        fc: 866.125,
        c: 346.45,
        m: 0.027777777777777776,
        sc: 7.853981633974483e-5,
        sp: 2.827433388230814e-3,
        tl: 11.3061,
      },
      tolerance: 2e-3,
      source: '按 PPT 公式手工核算：f_c = 346.45/0.4 = 866.125 Hz；m = 10²/60² = 1/36；峰值出现在最接近 f_c 的采样点 1.0025f_c，tan(1.0025·π/2) ≈ −254.65，TL ≈ 10lg[1+0.25×(254.65/36)²] ≈ 11.31 dB',
    },
    {
      name: '变工况（d=20mm, D=80mm, L=200mm, t=0℃）',
      input: {
        Sp: 5.026548245743669e-3, D: 0.08, Sc: 3.141592653589793e-4, d: 0.02,
        L: 0.2, t: 273.15,
      },
      expect: {
        fc: 414.125,
        c: 331.3,
        m: 0.0625,
        tl: 18.0838,
      },
      tolerance: 2e-3,
      source: '0℃ 时 c = 331.3 m/s，f_c = 331.3/0.8 = 414.125 Hz；m = 0.0625；峰值采样点 1.0025f_c ≈ 415.16 Hz，TL ≈ 10lg[1+0.25×(254.65×0.0625)²] ≈ 18.08 dB',
    },
  ],
};
