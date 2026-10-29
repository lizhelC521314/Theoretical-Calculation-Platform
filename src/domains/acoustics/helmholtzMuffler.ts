import type { FormulaSpec } from '../../formula/types';
import { HELMHOLTZ_DIAGRAM } from './diagrams';

/**
 * 赫姆霍兹消音器（Helmholtz Resonator Muffler）
 *
 * 主公式（与参考 PPT 严格一致）：
 *   中心频率  f = c/(2π)·√(Sc / (V·(lc + 1.5d/2)))
 *   传递损失  TL = 10·lg[ 1 + ( (√(Sc·V/(lc + 1.5d/2)) / (2Sp)) / (f/f_r − f_r/f) )² ]
 *   辅助式    Sc = πd²/4，Sp = πD²/4，c ≈ 331.3 + 0.606·t
 *
 * TL 曲线按 PPT 给定的 f_r 比值点绘制（0.05f ~ 0.995f，并按同间距镜像至 1.95f），
 * 纵轴 TL（dB），横轴 Frequency（Hz）。
 */

/** PPT 给定的频比采样点（f < f_r），上侧按同间距镜像 */
const FREQ_RATIOS = [
  0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85,
  0.9, 0.95, 0.96, 0.97, 0.98, 0.99, 0.995,
  1.005, 1.01, 1.02, 1.03, 1.04, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.55,
  1.6, 1.65, 1.7, 1.75, 1.8, 1.85, 1.9, 1.95,
];

/**
 * 按频比 r = f/f_r 计算该频点的传递损失（dB）：
 *   TL = 10·lg[ 1 + ( K/(r − 1/r) )² ]，K = √(Sc·V/lEff)/(2Sp)
 */
function tlAtRatio(r: number, K: number): number {
  const q = r - 1 / r;
  if (Math.abs(q) < 1e-12) return Infinity; // f = f_r，理论奇异点
  return 10 * Math.log10(1 + (K / q) ** 2);
}

/**
 * 中心频率处的 TL 峰值。
 * 理论模型（无阻尼）在 f = f_r 处趋于无穷大，故取采样点中 TL 最大者作为峰值，
 * 与 TL 曲线的峰值点严格一致。
 */
function peakTl(K: number): number {
  let max = 0;
  for (const r of FREQ_RATIOS) {
    const tl = tlAtRatio(r, K);
    if (Number.isFinite(tl) && tl > max) max = tl;
  }
  return max;
}

/** 由 SI 输入算出中心频率与 TL 计算所需的中间量 */
function derive(v: Record<string, number>) {
  const { V, lc, d, t, D } = v;
  if (!(V > 0) || !(lc > 0) || !(d > 0) || !(D > 0) || !Number.isFinite(t)) return null;
  const c = 331.3 + 0.606 * (t - 273.15);
  const sc = (Math.PI * d * d) / 4;
  const sp = (Math.PI * D * D) / 4;
  const lEff = lc + (1.5 * d) / 2;
  const fr = (c / (2 * Math.PI)) * Math.sqrt(sc / (V * lEff));
  const K = Math.sqrt((sc * V) / lEff) / (2 * sp);
  return { c, sc, sp, lEff, fr, K };
}

export const helmholtzMuffler: FormulaSpec = {
  id: 'acoustics.muffler.helmholtz',
  domain: 'acoustics',
  subsystem: '消声器',
  title: '赫姆霍兹消音器',
  summary: '由腔体体积、喉管尺寸与管道直径计算共振中心频率与传递损失 TL 曲线，用于进气/排气消声器的调谐设计。',
  tags: ['赫姆霍兹', '消音器', '消声器', '传递损失', 'TL', '共振频率', 'NVH', '进气系统', '排气系统'],
  description:
    '赫姆霍兹消音器由管道旁接的共振腔与喉管组成，在共振频率 f_r 附近产生最大传递损失。本公式按参考 PPT 计算：中心频率 f = c/(2π)·√(Sc/(V·(lc+1.5d/2)))，传递损失 TL = 10lg[1+( (√(Sc·V/(lc+1.5d/2))/(2Sp)) / (f/f_r − f_r/f) )²]，其中 Sc = πd²/4、Sp = πD²/4、声速 c ≈ 331.3 + 0.606t（t 为摄氏温度）。结果区输出中心频率与中间量，并绘制 TL - Frequency 曲线（纵轴 TL/dB，横轴 Frequency/Hz）。',
  inputs: [
    { key: 'V', label: '赫姆霍兹腔体的体积', symbol: 'V', unit: 'L', unitGroup: 'volume', default: 0.5, min: 0, required: true, description: '共振腔净容积' },
    { key: 'lc', label: '喉管长度', symbol: 'lc', unit: 'mm', unitGroup: 'length', default: 30, min: 0, required: true, description: '喉管（连接管）的几何长度' },
    { key: 'd', label: '喉管的直径', symbol: 'd', unit: 'mm', unitGroup: 'diameter', default: 20, min: 0, required: true, description: '喉管内径，决定喉管截面积 Sc' },
    { key: 't', label: '温度', symbol: 't', unit: '℃', unitGroup: 'temperature', default: 25, required: true, description: '介质温度，用于计算声速 c ≈ 331.3 + 0.606t' },
    { key: 'D', label: '主管道直径', symbol: 'D', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, required: true, description: '主管道内径，决定管道截面积 Sp' },
  ],
  outputs: [
    { key: 'fr', label: '中心频率', symbol: 'f', unit: 'Hz', primary: true, group: '声学特性', description: '赫姆霍兹共振中心频率 f_r，TL 在该频率达到峰值' },
    { key: 'tl', label: '传递损失', symbol: 'TL', unit: 'dB', primary: true, group: '声学特性', description: '中心频率处的传递损失峰值。理论模型在 f = f_r 处趋于无穷大（无阻尼），此处取最接近中心频率的采样点 0.995·f_r 对应的 TL 值' },
    { key: 'c', label: '介质声速', symbol: 'c', unit: 'm/s', group: '声学特性', description: 'c ≈ 331.3 + 0.606·t（t 为摄氏温度）' },
    { key: 'sc', label: '喉管截面积', symbol: 'Sc', unit: 'mm²', unitGroup: 'area', group: '中间量', description: 'Sc = π·d²/4' },
    { key: 'sp', label: '管道截面积', symbol: 'Sp', unit: 'mm²', unitGroup: 'area', group: '中间量', description: 'Sp = π·D²/4' },
    { key: 'lEff', label: '喉管有效长度', symbol: 'l_eff', unit: 'mm', unitGroup: 'length', group: '中间量', description: 'l_eff = lc + 1.5d/2，含末端修正' },
  ],
  latex: [
    {
      label: '中心频率（主公式）',
      tex: 'f = \\frac{c}{2\\pi}\\sqrt{\\frac{S_c}{V\\left(l_c + \\dfrac{1.5\\cdot d}{2}\\right)}}',
    },
    {
      label: '传递损失（主公式）',
      tex: 'TL = 10\\,\\lg\\left[1 + \\left\\{ \\frac{\\dfrac{\\sqrt{S_c V}\\Big/\\left(l_c + \\dfrac{1.5\\cdot d}{2}\\right)}{2S_p}}{\\dfrac{f}{f_r} - \\dfrac{f_r}{f}} \\right\\}^{2} \\right]',
    },
    {
      label: '辅助式',
      tex: 'S_c = \\frac{\\pi d^{2}}{4},\\qquad S_p = \\frac{\\pi D^{2}}{4},\\qquad c \\approx 331.3 + 0.606\\,t',
    },
    {
      label: 'TL 曲线（随 f/f_r 取值变化）',
      tex: '\\frac{f}{f_r} = 0.05,\\,0.1,\\,0.15,\\,\\ldots,\\,0.95,\\,0.96,\\,0.97,\\,0.98,\\,0.99,\\,0.995\\;（并按同间距镜像至 1.95）',
    },
  ],
  diagram: HELMHOLTZ_DIAGRAM,
  sensitivity: true,
  assumptions: [
    '公式与参考 PPT 严格一致：中心频率 f = c/(2π)·√(Sc/(V·(lc+1.5d/2)))，TL 按上式计算',
    '喉管有效长度取 l_eff = lc + 1.5d/2，即包含 1.5·d/2 的末端修正',
    '声速按经验式 c ≈ 331.3 + 0.606t 计算（t 为摄氏温度），未计湿度与压力影响',
    '模型忽略喉管与腔体的声阻尼（粘性、热传导），理论 TL 在 f = f_r 处趋于无穷大，实际峰值受声阻限制为有限值',
    'TL 公式适用于单腔旁支赫姆霍兹共振器，腔体尺寸远小于波长（低频近似）',
    'TL 曲线频比点按 PPT 给定列表（0.05f ~ 0.995f）并在 f_r 上侧按同间距镜像至 1.95f',
    '工程设计中 TL 峰值频率应正对噪声主导频率；带宽较窄，宽频降噪需组合多腔或与扩张腔配合',
  ],
  solve(v) {
    const empty = { fr: NaN, tl: NaN, c: NaN, sc: NaN, sp: NaN, lEff: NaN };
    const r = derive(v);
    if (!r) return empty;
    const { fr, c, sc, sp, lEff, K } = r;
    // 中心频率处的 TL 峰值（理论趋于无穷，取采样点上的最大 TL）
    const tl = peakTl(K);
    return { fr, tl, c, sc, sp, lEff };
  },
  curve: {
    label: '传递损失 TL 曲线',
    xLabel: 'Frequency (Hz)',
    yLabel: 'TL (dB)',
    compute(v) {
      const r = derive(v);
      if (!r || !Number.isFinite(r.fr) || r.fr <= 0) return [];
      const points: { x: number; y: number }[] = [];
      for (const ratio of FREQ_RATIOS) {
        const tl = tlAtRatio(ratio, r.K);
        if (!Number.isFinite(tl)) continue; // f = f_r 理论奇异点，跳过
        points.push({ x: r.fr * ratio, y: tl });
      }
      points.sort((a, b) => a.x - b.x);
      return points;
    },
  },
  benchmarks: [
    {
      name: '默认工况中心频率（V=0.5L, lc=30mm, d=20mm, t=25℃, D=60mm）',
      input: { V: 5e-4, lc: 0.03, d: 0.02, t: 298.15, D: 0.06 },
      expect: {
        fr: 206.037,
        c: 346.45,
        sc: 3.141592653589793e-4,
        sp: 2.827433388230814e-3,
        lEff: 0.045,
      },
      tolerance: 2e-3,
      source: '按 PPT 公式手工核算：c=331.3+0.606×25=346.45，f_r = 346.45/(2π)·√(3.1416e-4/(5e-4×0.045))',
    },
    {
      name: '变工况中心频率（V=1L, lc=50mm, d=25mm, t=0℃, D=80mm）',
      input: { V: 1e-3, lc: 0.05, d: 0.025, t: 273.15, D: 0.08 },
      expect: {
        fr: 140.89,
        c: 331.3,
        sc: 4.908738521234052e-4,
        sp: 5.026548245743669e-3,
        lEff: 0.06875,
      },
      tolerance: 5e-3,
      source: '0℃ 时 c=331.3 m/s；f_r = 331.3/(2π)·√(4.9087e-4/(1e-3×0.06875)) ≈ 140.9 Hz',
    },
  ],
};
