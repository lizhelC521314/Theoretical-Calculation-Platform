import type { FormulaSpec } from '../../formula/types';
import { POROUS_MEDIA_DIAGRAM } from './diagrams';

/**
 * 多孔介质性能拟合（Darcy-Forchheimer 阻力系数反算）
 *
 * 由多组台架工况（ΔP、v）联立反算多孔介质的阻力系数：
 *   - 恰好 2 组：直接用 Cramer 法则解析求解
 *   - 3 组及以上：用最小二乘拟合（正则方程 2×2，线性模型 y = θ₁v + θ₂v²）
 *
 * 反算后同时给出 Fluent（1/α, C₂）与 STAR-CCM+（P_v, P_i）两套 CFD 软件输入系数，
 * 并对所有输入工况做正向回代，给出拟合误差与 RMSE。
 */
export const porousMediaFitting: FormulaSpec = {
  id: 'fluid.filter.porous-media-fitting',
  domain: 'fluid',
  subsystem: '滤清器与过滤元件',
  title: '多孔介质性能拟合',
  summary: '支持 2 组解析解与 3+ 组最小二乘拟合，直接得到 Fluent / STAR-CCM+ 多孔介质阻力系数，并回代校验拟合精度。',
  tags: ['多孔介质', '压降', '阻力系数', 'Fluent', 'STAR-CCM+', '滤芯', 'CFD', 'Darcy-Forchheimer', '最小二乘'],
  description:
    '多孔介质 Darcy-Forchheimer 阻力系数反算：2 组工况解析解，3 组及以上最小二乘拟合。直接得到 Fluent 1/α、C₂ 与 STAR-CCM+ P_v、P_i，并回代校验拟合精度。',
  inputs: [
    { key: 'rho', label: '流体密度', symbol: 'ρ', unit: 'kg/m³', unitGroup: 'density', default: 1.205, min: 0, required: true, description: '20℃ 空气约 1.205，需与试验介质一致' },
    { key: 'mu', label: '动力粘度', symbol: 'μ', unit: 'Pa·s', unitGroup: 'dynamicViscosity', default: 1.809e-5, min: 0, required: true, description: '20℃ 空气约 1.809e-5 Pa·s' },
    { key: 'L', label: '多孔介质厚度', symbol: 'L', unit: 'mm', unitGroup: 'length', default: 50, min: 0, required: true, description: '试验件沿流动方向的厚度，所有工况须为同一试件' },

    // ========== 工况1（必填） ==========
    { key: 'v1', label: '工况1 速度', symbol: 'v₁', unit: 'm/s', unitGroup: 'velocity', default: 3, min: 0, required: true, description: '第一组试验的表观流速' },
    { key: 'dp1', label: '工况1 压降', symbol: 'ΔP₁', unit: 'Pa', unitGroup: 'pressure', default: 2849.0625, min: 0, required: true, description: '第一组试验实测压降' },

    // ========== 工况2（必填） ==========
    { key: 'v2', label: '工况2 速度', symbol: 'v₂', unit: 'm/s', unitGroup: 'velocity', default: 5, min: 0, required: true, description: '第二组试验的表观流速，建议 v₂/v₁ ≥ 1.5' },
    { key: 'dp2', label: '工况2 压降', symbol: 'ΔP₂', unit: 'Pa', unitGroup: 'pressure', default: 4899.0625, min: 0, required: true, description: '第二组试验实测压降' },

    // ========== 工况3（可选） ==========
    { key: 'v3', label: '工况3 速度', symbol: 'v₃', unit: 'm/s', unitGroup: 'velocity', default: 0, min: 0, required: false, description: '可选。填写后启用最小二乘拟合（N ≥ 3）' },
    { key: 'dp3', label: '工况3 压降', symbol: 'ΔP₃', unit: 'Pa', unitGroup: 'pressure', default: 0, min: 0, required: false, description: '可选。与 v₃ 配对' },

    // ========== 工况4（可选） ==========
    { key: 'v4', label: '工况4 速度', symbol: 'v₄', unit: 'm/s', unitGroup: 'velocity', default: 0, min: 0, required: false, description: '可选。继续增加数据点以提高拟合精度' },
    { key: 'dp4', label: '工况4 压降', symbol: 'ΔP₄', unit: 'Pa', unitGroup: 'pressure', default: 0, min: 0, required: false, description: '可选。与 v₄ 配对' },

    // ========== 工况5（可选） ==========
    { key: 'v5', label: '工况5 速度', symbol: 'v₅', unit: 'm/s', unitGroup: 'velocity', default: 0, min: 0, required: false, description: '可选。工程上通常 3–5 组数据足够收敛' },
    { key: 'dp5', label: '工况5 压降', symbol: 'ΔP₅', unit: 'Pa', unitGroup: 'pressure', default: 0, min: 0, required: false, description: '可选。与 v₅ 配对' },
  ],
  outputs: [
    // Fluent（解析解 / 最小二乘直接得到）
    { key: 'viscousFluent', label: 'Fluent 粘性阻力系数', symbol: '1/α', unit: 'm⁻²', unitGroup: 'inverseArea', primary: true, group: 'Fluent', description: 'Fluent 多孔介质面板 Viscous Resistance 直接填入' },
    { key: 'c2Fluent', label: 'Fluent 惯性阻力系数', symbol: 'C₂', unit: 'm⁻¹', unitGroup: 'inverseLength', primary: true, group: 'Fluent', description: 'Fluent 多孔介质面板 Inertial Resistance 直接填入' },

    // STAR-CCM+（换算自 1/α、C₂）
    { key: 'pvStar', label: 'STAR-CCM+ 粘性阻力系数', symbol: 'P_v', unit: 'kg/(m³·s)', unitGroup: 'viscousResistance', primary: true, group: 'STAR-CCM+', description: 'Porous Viscous Resistance，P_v = μ·(1/α)' },
    { key: 'piStar', label: 'STAR-CCM+ 惯性阻力系数', symbol: 'P_i', unit: 'kg/m⁴', unitGroup: 'inertialResistance', primary: true, group: 'STAR-CCM+', description: 'Porous Inertial Resistance，P_i = ρ·C₂/2' },

    // 拟合质量指标
    { key: 'fitCount', label: '有效数据点数 N', symbol: 'N', unit: '', group: '拟合质量', description: '参与拟合的 (v, ΔP) 对数；N=2 为解析解，N≥3 为最小二乘' },
    { key: 'rmse', label: '回代均方根误差', symbol: 'RMSE', unit: 'Pa', unitGroup: 'pressure', group: '拟合质量', description: '所有有效工况回代的均方根误差，越小越好' },

    // 逐工况回代校验（只对已填工况有值）
    { key: 'dp1Fit', label: '工况1 压降（回代）', symbol: 'ΔP₁*', unit: 'Pa', unitGroup: 'pressure', group: '回代校验' },
    { key: 'err1', label: '工况1 相对误差', symbol: 'ε₁', unit: '%', group: '回代校验' },
    { key: 'dp2Fit', label: '工况2 压降（回代）', symbol: 'ΔP₂*', unit: 'Pa', unitGroup: 'pressure', group: '回代校验' },
    { key: 'err2', label: '工况2 相对误差', symbol: 'ε₂', unit: '%', group: '回代校验' },
    { key: 'dp3Fit', label: '工况3 压降（回代）', symbol: 'ΔP₃*', unit: 'Pa', unitGroup: 'pressure', group: '回代校验' },
    { key: 'err3', label: '工况3 相对误差', symbol: 'ε₃', unit: '%', group: '回代校验' },
    { key: 'dp4Fit', label: '工况4 压降（回代）', symbol: 'ΔP₄*', unit: 'Pa', unitGroup: 'pressure', group: '回代校验' },
    { key: 'err4', label: '工况4 相对误差', symbol: 'ε₄', unit: '%', group: '回代校验' },
    { key: 'dp5Fit', label: '工况5 压降（回代）', symbol: 'ΔP₅*', unit: 'Pa', unitGroup: 'pressure', group: '回代校验' },
    { key: 'err5', label: '工况5 相对误差', symbol: 'ε₅', unit: '%', group: '回代校验' },
  ],
  latex: [
    {
      label: '多孔介质动量方程（主公式）',
      tex: '\\frac{\\Delta P}{L} = -\\left(\\frac{\\mu}{\\alpha} + \\frac{\\rho C_2}{2}\\right)\\left|v\\right|v',
    },
    {
      label: '取绝对值后的正向形式',
      tex: '\\frac{\\left|\\Delta P\\right|}{L} = \\frac{\\mu}{\\alpha}v + \\frac{\\rho C_2}{2}v^{2} \\quad \\text{记} \\; y = \\frac{\\left|\\Delta P\\right|}{L}, \\; \\theta_1 = \\frac{\\mu}{\\alpha}, \\; \\theta_2 = \\frac{\\rho C_2}{2}',
    },
    {
      label: '恰好 2 组工况 → Cramer 法则解析解',
      tex: '\\theta_1 = \\frac{y_1 v_2^{2} - y_2 v_1^{2}}{v_1 v_2 (v_2 - v_1)},\\quad \\theta_2 = \\frac{v_1 y_2 - v_2 y_1}{v_1 v_2 (v_2 - v_1)},\\quad \\frac{1}{\\alpha} = \\frac{\\theta_1}{\\mu},\\quad C_2 = \\frac{2\\theta_2}{\\rho}',
    },
    {
      label: '3 组及以上 → 最小二乘拟合',
      tex: '\\theta = (X^{\\mathsf{T}} X)^{-1} X^{\\mathsf{T}} y, \\quad X = \\begin{bmatrix} v_1 & v_1^{2} \\\\ v_2 & v_2^{2} \\\\ \\vdots & \\vdots \\\\ v_N & v_N^{2} \\end{bmatrix},\\quad y = \\begin{bmatrix} y_1 \\\\ y_2 \\\\ \\vdots \\\\ y_N \\end{bmatrix}',
    },
    {
      label: '最小二乘的正则方程（2×2）',
      tex: '\\begin{pmatrix} \\sum v_i^{2} & \\sum v_i^{3} \\\\ \\sum v_i^{3} & \\sum v_i^{4} \\end{pmatrix} \\begin{pmatrix} \\theta_1 \\\\ \\theta_2 \\end{pmatrix} = \\begin{pmatrix} \\sum v_i y_i \\\\ \\sum v_i^{2} y_i \\end{pmatrix}',
    },
    {
      label: '换算 CFD 输入系数',
      tex: '\\frac{1}{\\alpha} = \\frac{\\theta_1}{\\mu},\\quad C_2 = \\frac{2\\theta_2}{\\rho},\\quad P_v = \\theta_1,\\quad P_i = \\theta_2',
    },
    {
      label: '回代预测与拟合质量',
      tex: 'y_k^{*} = \\theta_1 v_k + \\theta_2 v_k^{2},\\quad \\Delta P_k^{*} = L \\, y_k^{*},\\quad \\varepsilon_k = \\frac{\\Delta P_k^{*} - \\Delta P_k}{\\Delta P_k}\\times 100\\%,\\quad \\mathrm{RMSE} = \\sqrt{\\frac{1}{N}\\sum_{i=1}^{N} (\\Delta P_k^{*} - \\Delta P_k)^{2}}',
    },
  ],
  diagram: POROUS_MEDIA_DIAGRAM,
  sensitivity: false,
  assumptions: [
    '主公式 ΔP/L = −(μ/α + ρC₂/2)·|v|·v；计算时 ΔP 与 v 取绝对值后按正向形式求解',
    '至少填入 2 组工况数据；恰好 2 组用 Cramer 法则解析求解 1/α 与 C₂',
    '填写 3 组及以上时自动切换为最小二乘拟合，建议 N ≥ 3 以抑制单点测量噪声',
    '所有工况必须使用同一介质（ρ, μ）和同一试件厚度 L',
    'N=2 时两点速度差越小对测量误差越敏感，建议 v₂/v₁ ≥ 1.5；N≥3 时速度区间覆盖越宽越好',
    'Fluent 中 C₂ 的量纲为 m⁻¹，1/α 的量纲为 m⁻²，录入面板请核对单位',
    'STAR-CCM+ 的 P_v = μ·(1/α)、P_i = ρ·C₂/2，均为每单位长度的阻力系数',
    '当最小二乘的 (XᵀX) 矩阵接近奇异（数据点过近）时，拟合结果仍会给出但 RMSE 可能较大，请检查工况分布',
  ],
  solve(v) {
    const { rho, mu, L } = v;
    const empty = {
      viscousFluent: NaN, c2Fluent: NaN,
      pvStar: NaN, piStar: NaN,
      fitCount: 0, rmse: NaN,
      dp1Fit: NaN, err1: NaN,
      dp2Fit: NaN, err2: NaN,
      dp3Fit: NaN, err3: NaN,
      dp4Fit: NaN, err4: NaN,
      dp5Fit: NaN, err5: NaN,
    };

    if (!(L > 0) || !(rho > 0) || !(mu > 0)) return empty;

    // 收集有效工况对：v>0 且 dp>=0（dp=0 也允许，代表零压降工况）
    const pairs: { v: number; dp: number; idx: number }[] = [];
    for (let i = 1; i <= 5; i++) {
      const vi = Math.abs((v as Record<string, number>)[`v${i}`] ?? NaN);
      const dpi = Math.abs((v as Record<string, number>)[`dp${i}`] ?? NaN);
      if (vi > 0 && dpi >= 0 && Number.isFinite(vi) && Number.isFinite(dpi)) {
        pairs.push({ v: vi, dp: dpi, idx: i });
      }
    }
    const N = pairs.length;
    if (N < 2) return empty;

    // 最小二乘线性模型：y = θ₁·v + θ₂·v²，y = |ΔP|/L
    // θ₁ = μ/α,  θ₂ = ρC₂/2
    let theta1 = NaN;
    let theta2 = NaN;

    if (N === 2) {
      // Cramer 法则解析解
      const [a, b] = pairs;
      const det = a.v * b.v * (b.v - a.v);
      if (Math.abs(det) < 1e-30) return empty;
      const y1 = a.dp / L;
      const y2 = b.dp / L;
      theta1 = (y1 * b.v * b.v - y2 * a.v * a.v) / det;
      theta2 = (a.v * y2 - b.v * y1) / det;
    } else {
      // 最小二乘：正则方程 (XᵀX)·θ = Xᵀy
      // [Σv² Σv³; Σv³ Σv⁴] · [θ₁; θ₂] = [Σv·y; Σv²·y]
      let sv2 = 0, sv3 = 0, sv4 = 0, svy = 0, sv2y = 0;
      for (const p of pairs) {
        const y = p.dp / L;
        const v = p.v;
        const v2 = v * v;
        sv2 += v2;
        sv3 += v2 * v;
        sv4 += v2 * v2;
        svy += v * y;
        sv2y += v2 * y;
      }
      const det = sv2 * sv4 - sv3 * sv3;
      if (Math.abs(det) < 1e-30) return { ...empty, fitCount: N };
      theta1 = (svy * sv4 - sv2y * sv3) / det;
      theta2 = (sv2 * sv2y - sv3 * svy) / det;
    }

    // 换算 Fluent / STAR-CCM+
    const invAlpha = theta1 / mu;       // 1/α
    const c2 = (2 * theta2) / rho;      // C₂
    const pvStar = theta1;              // P_v = μ·(1/α)
    const piStar = theta2;              // P_i = ρ·C₂/2

    // 回代 + RMSE
    let sse = 0;
    const fits: Record<number, { dpFit: number; err: number }> = {};
    for (const p of pairs) {
      const dpFit = L * (theta1 * p.v + theta2 * p.v * p.v);
      const err = p.dp > 0 ? ((dpFit - p.dp) / p.dp) * 100 : 0;
      sse += (dpFit - p.dp) * (dpFit - p.dp);
      fits[p.idx] = { dpFit, err };
    }
    const rmse = Math.sqrt(sse / N);

    return {
      viscousFluent: invAlpha,
      c2Fluent: c2,
      pvStar,
      piStar,
      fitCount: N,
      rmse,
      dp1Fit: fits[1]?.dpFit ?? NaN, err1: fits[1]?.err ?? NaN,
      dp2Fit: fits[2]?.dpFit ?? NaN, err2: fits[2]?.err ?? NaN,
      dp3Fit: fits[3]?.dpFit ?? NaN, err3: fits[3]?.err ?? NaN,
      dp4Fit: fits[4]?.dpFit ?? NaN, err4: fits[4]?.err ?? NaN,
      dp5Fit: fits[5]?.dpFit ?? NaN, err5: fits[5]?.err ?? NaN,
    };
  },
  benchmarks: [
    {
      name: '2 组解析解（基准工况）',
      input: { rho: 1.205, mu: 1.809e-5, L: 0.05, v1: 3, dp1: 2849.0625, v2: 5, dp2: 4899.0625, v3: 0, dp3: 0, v4: 0, dp4: 0, v5: 0, dp5: 0 },
      expect: { viscousFluent: 1e9, c2Fluent: 500, pvStar: 18090, piStar: 301.25, fitCount: 2, dp1Fit: 2849.0625, dp2Fit: 4899.0625, err1: 0, err2: 0 },
      tolerance: 1e-6,
      source: 'Cramer 法则回代闭环',
    },
    {
      name: '3 组最小二乘（无噪声 → 与解析解完全一致）',
      // 在相同 1/α=1e9, C₂=500 上再加 v₃=7，用正向公式算 ΔP₃ = L*(θ₁v₃+θ₂v₃²)
      // θ₁=18090, θ₂=301.25 → ΔP₃ = 0.05*(18090*7 + 301.25*49) = 0.05*(126630+14761.25) = 7069.5625
      input: { rho: 1.205, mu: 1.809e-5, L: 0.05, v1: 3, dp1: 2849.0625, v2: 5, dp2: 4899.0625, v3: 7, dp3: 7069.5625, v4: 0, dp4: 0, v5: 0, dp5: 0 },
      expect: { viscousFluent: 1e9, c2Fluent: 500, fitCount: 3, dp3Fit: 7069.5625, err3: 0 },
      tolerance: 1e-6,
      source: '同一模型 3 组精确数据 → OLS 应还原相同系数、RMSE=0',
    },
    {
      name: '3 组含噪声最小二乘（宽速度区间）',
      // v = 2, 6, 10（覆盖 5 倍区间），给 v₃ 的 ΔP₃ 加 +50 Pa 噪声（约 0.5%）
      // 条件数比 v=3,5,7 好很多，噪声被压缩到系数约 ±5% 偏移
      input: { rho: 1.205, mu: 1.809e-5, L: 0.05, v1: 2, dp1: 1869.25, v2: 6, dp2: 5969.25, v3: 10, dp3: 10601.25, v4: 0, dp4: 0, v5: 0, dp5: 0 },
      expect: { viscousFluent: 1e9, c2Fluent: 500 },
      tolerance: 0.08,
      source: '跨 5 倍速度区间 + 50 Pa 噪声 → 系数仍在 8% 内收敛',
    },
    {
      name: '纯粘性极限（C₂ = 0）',
      input: { rho: 1.205, mu: 1.809e-5, L: 0.05, v1: 2, dp1: 1809, v2: 4, dp2: 3618, v3: 0, dp3: 0, v4: 0, dp4: 0, v5: 0, dp5: 0 },
      expect: { viscousFluent: 1e9, c2Fluent: 0, piStar: 0, fitCount: 2 },
      tolerance: 1e-6,
      source: '达西定律线性区，惯性项为零',
    },
  ],
};
