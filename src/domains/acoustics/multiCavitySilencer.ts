import type { CurvePoint, FormulaSpec } from '../../formula/types';
import { MULTI_CAVITY_DIAGRAM } from './diagrams';

/**
 * 多腔穿孔消声器（Multi-Cavity Perforated Silencer）
 *
 * 依据《多腔消声器-公式与参数.pptx》（Sullivan & Crocker 1978；Munjal 1987/2014；
 * 郭荣等 2014；田春娟等 2022）的一维传递矩阵（TMM）公式体系：
 *
 *   穿孔率      σ_i = n_h,i·d_h,i² / (4·d_in·L_c,i)                         (1)
 *   波数        r_h = d_h/2，k0 = 2πf/c0                                     (2)
 *   穿孔阻抗    ξ = R0 + j·k0(t_w + α0·d_h)                     (M1 = 0)     (3)
 *               ξ = R0 + 0.48|k0r_h − M1| + j·k0(t_w + CG·α0·d_h) (M1 > 0)  (4)
 *   端部修正    α0 = 0.8216(1 + 1.5319√σ + 1.4099σ − 0.8780σ^1.5)          (5)
 *               CG = 12/(k0r_h/M1 − 1) (k0r_h ≤ M1)；CG = 1 (k0r_h > M1)    (6)
 *
 *   单腔耦合方程（状态 y = [p1, w1, p2, w2]ᵀ，w = ρ0c0u）：(7)~(10)
 *   周界 / 面积     P1 = πd_in，S1 = πd_in²/4；P2 = πd_out，S2 = π(d_out² − d_in²)/4   (11)
 *   系统矩阵        A（4×4，见式(12)）                                              (12)
 *   传播矩阵        Φ = exp(A·L_c)，按 2×2 分块 Φ = [Φ11 Φ12; Φ21 Φ22]               (13)
 *   单腔传递矩阵    T_cav = Φ11 − Φ12[:,1]·Φ21[2,:] / Φ22[2,1]                      (14)
 *
 *   多腔串联        T = T_n·T_n−1·…·T_1                                             (15)
 *   直管段          T_duct = [cos(k0L), j·sin(k0L); j·sin(k0L), cos(k0L)]             (16)
 *   面积突变        T_area = [1, 0; 0, Sa/Sb]                                        (17)
 *   传递损失        TL(f) = 20·lg(|T11 + T12 + T21 + T22| / 2)                       (18)
 *
 * 式(19)（含 Z0 的 TL 定义）与式(20)(21)（以 L_c、d_h、n_h 为设计变量、σ≤0.25、
 * 孔间距≥2d_h、Δp≤Δp_max 为约束的优化问题）属于等效表述与优化流程，本模块按
 * 式(18)输出 TL，优化部分不在此实现（见适用条件）。
 *
 * ★ 本公式按 PPT 实现，尚无试验数据校核，结果仅供参考。
 */

/** 复数（[实部, 虚部]） */
type Cx = [number, number];

function cx(re: number, im = 0): Cx {
  return [re, im];
}

function cdivNum(a: Cx, d: number): Cx {
  return [a[0] / d, a[1] / d];
}

/** 复数除法：分母模过小时返回 null，避免伪数值 */
function cdiv(a: Cx, b: Cx): Cx | null {
  const d = b[0] * b[0] + b[1] * b[1];
  if (!(d > 1e-300)) return null;
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}

type Mat = Cx[][];

/** 复数矩阵乘法（通用 n×n） */
function matMul(a: Mat, b: Mat): Mat {
  const n = a.length;
  const p = b.length;
  const m = b[0].length;
  const out: Mat = [];
  for (let i = 0; i < n; i++) {
    const row: Cx[] = [];
    for (let j = 0; j < m; j++) {
      let re = 0;
      let im = 0;
      for (let t = 0; t < p; t++) {
        const a0 = a[i][t][0];
        const a1 = a[i][t][1];
        const b0 = b[t][j][0];
        const b1 = b[t][j][1];
        re += a0 * b0 - a1 * b1;
        im += a0 * b1 + a1 * b0;
      }
      row.push([re, im]);
    }
    out.push(row);
  }
  return out;
}

function ident(n: number): Mat {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? cx(1, 0) : cx(0, 0))),
  );
}

function matAdd(a: Mat, b: Mat): Mat {
  return a.map((row, i) => row.map((v, j) => [v[0] + b[i][j][0], v[1] + b[i][j][1]] as Cx));
}

/** 1-范数（最大列和）用于缩放-平方 */
function norm1(m: Mat): number {
  let max = 0;
  for (let j = 0; j < m[0].length; j++) {
    let s = 0;
    for (let i = 0; i < m.length; i++) s += Math.hypot(m[i][j][0], m[i][j][1]);
    if (s > max) max = s;
  }
  return max;
}

/**
 * 复矩阵指数 exp(M)：缩放-平方 + 泰勒展开
 * （M 的 1-范数先缩到 ≤0.5，24 阶泰勒后连续平方还原，收敛稳定）
 */
function expm(m: Mat): Mat {
  let scale = 1;
  let s = 0;
  const nrm = norm1(m);
  if (nrm > 0.5) {
    s = Math.ceil(Math.log2(nrm));
    scale = Math.pow(2, s);
  }
  const A: Mat = m.map((row) => row.map((v) => cdivNum(v, scale)));

  let result = ident(m.length);
  let term = ident(m.length);
  for (let k = 1; k <= 24; k++) {
    term = matMul(term, A);
    term = term.map((row) => row.map((v) => cdivNum(v, k)));
    result = matAdd(result, term);
  }
  for (let i = 0; i < s; i++) result = matMul(result, result);
  return result;
}

/** 单频点的腔体中间量（SI 输入） */
interface CavityAt {
  sigma: number;
  xi: Cx;
  cavity: Mat;
}

/** 按式(1)~(14)计算单腔 2×2 传递矩阵 */
function cavityAt(f: number, v: Record<string, number>): CavityAt | null {
  const { din, dout, tw, dh, nh, Lc, c0v, M1, R0 } = v;
  if (!(f > 0) || !(din > 0) || !(dout > din) || !(tw > 0) || !(dh > 0) || !(nh > 0) || !(Lc > 0) || !(c0v > 0) || !(M1 >= 0))
    return null;

  const k0 = (2 * Math.PI * f) / c0v; // 式(2)
  const rh = dh / 2;

  // 式(1)：穿孔率（各腔统一参数）
  const sigma = (nh * dh * dh) / (4 * din * Lc);

  // 式(5)：端部修正系数
  const alpha0 = 0.8216 * (1 + 1.5319 * Math.sqrt(sigma) + 1.4099 * sigma - 0.878 * Math.pow(sigma, 1.5));

  // 式(3)(4)：穿孔比声阻抗
  let xi: Cx;
  if (M1 <= 0) {
    xi = cx(R0, k0 * (tw + alpha0 * dh));
  } else {
    // 式(6)：CG；k0rh/M1 → 1 时公式奇异，按 ±1e-3 截断分母
    let CG = 1;
    const q = (k0 * rh) / M1;
    if (q <= 1) {
      let den = q - 1;
      if (Math.abs(den) < 1e-3) den = den < 0 ? -1e-3 : 1e-3;
      CG = 12 / den;
    }
    xi = cx(R0 + 0.48 * Math.abs(k0 * rh - M1), k0 * (tw + CG * alpha0 * dh));
  }
  if (!Number.isFinite(xi[0]) || !Number.isFinite(xi[1])) return null;

  // 式(11)：周界与面积
  const P1 = Math.PI * din;
  const S1 = (Math.PI * din * din) / 4;
  const P2 = Math.PI * dout;
  const S2 = (Math.PI * (dout * dout - din * din)) / 4;
  if (!(S1 > 0) || !(S2 > 0)) return null;

  // 耦合项 c1 = P1/(S1ξ)、c2 = P2/(S2ξ)（复数）
  const c1c = cdiv(cx(P1 / S1, 0), xi);
  const c2c = cdiv(cx(P2 / S2, 0), xi);
  if (!c1c || !c2c) return null;

  // 式(12)：系统矩阵 A（再乘 Lc）
  const jk0: Cx = cx(0, k0);
  const zero = cx(0, 0);
  const m: Mat = [
    [zero, cx(-jk0[0], -jk0[1]), zero, zero],
    [cx(-jk0[0] - c1c[0], -jk0[1] - c1c[1]), zero, cx(c1c[0], c1c[1]), zero],
    [zero, zero, zero, cx(-jk0[0], -jk0[1])],
    [cx(c2c[0], c2c[1]), zero, cx(-jk0[0] - c2c[0], -jk0[1] - c2c[1]), zero],
  ];
  const A = m.map((row) => row.map((c) => cx(c[0] * Lc, c[1] * Lc)));

  // 式(13)：Φ = exp(A·Lc)
  const Phi = expm(A);
  const phi11: Mat = [
    [Phi[0][0], Phi[0][1]],
    [Phi[1][0], Phi[1][1]],
  ];
  const phi12: Mat = [
    [Phi[0][2], Phi[0][3]],
    [Phi[1][2], Phi[1][3]],
  ];
  const phi21: Mat = [
    [Phi[2][0], Phi[2][1]],
    [Phi[3][0], Phi[3][1]],
  ];
  const phi22: Mat = [
    [Phi[2][2], Phi[2][3]],
    [Phi[3][2], Phi[3][3]],
  ];

  // 式(14)：T_cav = Φ11 − Φ12[:,1]·Φ21[2,:]/Φ22[2,1]
  const den = phi22[1][1];
  const inv = cdiv(cx(1, 0), den);
  if (!inv) return null;
  const cavity: Mat = [
    [cx(0, 0), cx(0, 0)],
    [cx(0, 0), cx(0, 0)],
  ];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      // Φ12[i][1] · Φ21[1][j] / Φ22[1][1]
      const num: Cx = [
        phi12[i][1][0] * phi21[1][j][0] - phi12[i][1][1] * phi21[1][j][1],
        phi12[i][1][0] * phi21[1][j][1] + phi12[i][1][1] * phi21[1][j][0],
      ];
      const corr: Cx = [num[0] * inv[0] - num[1] * inv[1], num[0] * inv[1] + num[1] * inv[0]];
      cavity[i][j] = [phi11[i][j][0] - corr[0], phi11[i][j][1] - corr[1]];
    }
  }
  return { sigma, xi, cavity };
}

/** 式(16)：直管段（长度 L 的隔板段）传递矩阵 */
function ductMatrix(L: number, k0: number): Mat {
  const c = Math.cos(k0 * L);
  const s = Math.sin(k0 * L);
  return [
    [cx(c, 0), cx(0, s)],
    [cx(0, s), cx(c, 0)],
  ];
}

/** 全模型：多腔串联 → 2×2 总传递矩阵与单腔中间量 */
function cascade(f: number, v: Record<string, number>): { T: Mat; ct: CavityAt } | null {
  const n = Math.round(v.n ?? 0);
  if (!(n >= 1)) return null;
  const at = cavityAt(f, v);
  if (!at) return null;

  const k0 = (2 * Math.PI * f) / v.c0v;
  // 式(15)：T = Tn·Tn−1·…·T1；相邻腔之间按式(16)插入隔板直管段
  let T: Mat = at.cavity;
  for (let i = 1; i < n; i++) {
    T = v.ct > 0 ? matMul(T, ductMatrix(v.ct, k0)) : T;
    T = matMul(T, at.cavity);
  }
  return { T, ct: at };
}

/** 式(18)：TL = 20lg(|T11 + T12 + T21 + T22|/2) */
function tlOf(T: Mat): number {
  const sum: Cx = [
    T[0][0][0] + T[0][1][0] + T[1][0][0] + T[1][1][0],
    T[0][0][1] + T[0][1][1] + T[1][0][1] + T[1][1][1],
  ];
  const mag = Math.hypot(sum[0], sum[1]) / 2;
  if (!(mag > 1e-300)) return NaN;
  return 20 * Math.log10(mag);
}

/** 按 Δf 等步长扫描 [f_min, f_max] 的 TL 曲线（最多 2000 点） */
function sampleCurve(v: Record<string, number>): CurvePoint[] {
  const { fmin, fmax } = v;
  if (!(fmax > fmin) || !(fmin >= 0)) return [];
  const df = v.df > 0 ? v.df : 10;
  const points: CurvePoint[] = [];
  const count = Math.min(2000, Math.max(1, Math.round((fmax - fmin) / df)));
  for (let i = 0; i <= count; i++) {
    const f = fmin + i * df;
    if (f > fmax + 1e-9) break;
    const r = cascade(f, v);
    if (!r) continue;
    const y = tlOf(r.T);
    if (Number.isFinite(y)) points.push({ x: f, y });
  }
  return points;
}

export const multiCavitySilencer: FormulaSpec = {
  id: 'acoustics.muffler.multiCavity',
  domain: 'acoustics',
  subsystem: '消声器',
  title: '★ 多腔穿孔消音',
  summary:
    '按 PPT 的一维传递矩阵（TMM）模型，由穿孔率 σ、穿孔比声阻抗 ξ 构造单腔 4×4 耦合方程，取 Φ = exp(A·Lc) 的矩阵分块得到单腔传递矩阵，多腔串联后给出传递损失 TL 并绘制 TL - Frequency 曲线。★ 公式验证不充分，结果仅供参考。',
  tags: ['多腔', '穿孔', '消声器', '消音器', '传递损失', 'TL', 'TMM', '宽频', 'NVH', '进气系统', '排气系统'],
  description:
    '多腔宽频消声器由主管穿孔段与串联腔体构成，PPT 采用一维传递矩阵法：先按式(1)算穿孔率 σ，按式(3)~(6)算穿孔阻抗 ξ（含 M1=0 与 M1>0 两种工况及端部修正 α0、CG），再按式(12)构造 4×4 系统矩阵 A，取 Φ = exp(A·Lc) 并按式(14)压缩为单腔 2×2 传递矩阵，按式(15)将各腔串联（相邻腔间按式(16)插入隔板直管段），最后由式(18) TL(f) = 20lg(|T11+T12+T21+T22|/2) 得到传递损失。结果区给出频带平均 TL、峰值 TL 与峰值频率，并绘制 TL - Frequency 曲线。',
  inputs: [
    { key: 'din', label: '主管内径', symbol: 'd_in', unit: 'mm', unitGroup: 'length', default: 40, min: 40, max: 80, required: true, description: '主管（穿孔段）内径，PPT 范围 0.040~0.080 m，默认 40 mm' },
    { key: 'dout', label: '腔体外径', symbol: 'd_out', unit: 'mm', unitGroup: 'length', default: 60, min: 52, max: 160, required: true, description: '消声器腔体外径，PPT 要求 1.3~2.0 倍主管内径，默认 60 mm' },
    { key: 'tw', label: '穿孔壁厚（孔深）', symbol: 't_w', unit: 'mm', unitGroup: 'length', default: 2, min: 1.5, max: 3, required: true, description: '穿孔板厚度，即孔的有效深度，PPT 范围 0.0015~0.003 m' },
    { key: 'dh', label: '穿孔孔径', symbol: 'd_h', unit: 'mm', unitGroup: 'length', default: 3, min: 2, max: 4, required: true, description: '单孔直径，PPT 范围 0.002~0.004 m，属设计变量' },
    { key: 'nh', label: '每腔孔数', symbol: 'n_h', unit: '个', default: 40, min: 20, max: 60, required: true, description: '每个腔对应的穿孔个数，PPT 范围 20~60，属设计变量' },
    { key: 'n', label: '腔数', symbol: 'n', unit: '个', default: 4, min: 3, max: 6, required: true, description: '串联腔体数量，PPT 范围 3~6' },
    { key: 'Lc', label: '各腔宽度', symbol: 'L_c', unit: 'mm', unitGroup: 'length', default: 20, min: 6, max: 50, required: true, description: '每个腔沿轴向的宽度（各腔统一取值），PPT 范围 0.006~0.050 m，属设计变量' },
    { key: 'ct', label: '隔板厚度', symbol: 'c_t', unit: 'mm', unitGroup: 'length', default: 2, min: 1, max: 3, required: true, description: '相邻腔之间的隔板厚度，按式(16)作为直管段插入，PPT 范围 0.001~0.003 m' },
    { key: 'rho0', label: '空气密度', symbol: 'ρ0', unit: 'kg/m³', unitGroup: 'density', default: 1.205, min: 0, required: true, description: '常温常压空气密度，20℃ 取 1.205 kg/m³' },
    { key: 'c0v', label: '空气声速', symbol: 'c0', unit: 'm/s', default: 343, min: 0, required: true, description: '常温常压声速，20℃ 取 343 m/s' },
    { key: 'M1', label: '主管马赫数', symbol: 'M1', unit: '-', default: 0, min: 0, max: 0.15, required: true, description: '主管流速马赫数，PPT 范围 0~0.15；默认 0（无气流，按式3），有气流时按式(4)~式(6)计算' },
    { key: 'R0', label: '阻性常数', symbol: 'R0', unit: '-', default: 0.0055, min: 0, required: true, description: '穿孔阻抗实部经验常数，PPT 取值 0.0055（±20%，需标定）' },
    { key: 'fmin', label: '频率最小值', symbol: 'f_min', unit: 'Hz', default: 100, min: 0, required: true, description: 'TL 曲线扫描下限，PPT 默认 100 Hz' },
    { key: 'fmax', label: '频率最大值', symbol: 'f_max', unit: 'Hz', default: 5000, min: 0, required: true, description: 'TL 曲线扫描上限，PPT 默认 5000 Hz' },
    { key: 'df', label: '频率步长', symbol: 'Δf', unit: 'Hz', default: 10, min: 1, required: true, description: '频率扫描步长，PPT 建议 5~10 Hz' },
  ],
  outputs: [
    { key: 'tl_avg', label: '频带平均传递损失', symbol: 'TL_avg', unit: 'dB', primary: true, group: '声学特性', description: '在 [f_min, f_max] 内按 Δf 扫描得到的 TL 平均值' },
    { key: 'tl_max', label: '最大传递损失', symbol: 'TL_max', unit: 'dB', primary: true, group: '声学特性', description: '扫描频段内 TL 的最大值（峰值）' },
    { key: 'f_peak', label: '峰值频率', symbol: 'f_p', unit: 'Hz', group: '声学特性', description: 'TL 峰值对应的频率' },
    { key: 'sigma', label: '穿孔率', symbol: 'σ', unit: '-', group: '中间量', description: 'σ = n_h·d_h²/(4·d_in·L_c)（式1），各腔统一参数' },
    { key: 'xi_re', label: '穿孔阻抗实部（示例）', symbol: 'Re ξ', unit: '-', group: '中间量', description: '示例频率处穿孔比声阻抗的实部（式3/式4）' },
    { key: 'xi_im', label: '穿孔阻抗虚部（示例）', symbol: 'Im ξ', unit: '-', group: '中间量', description: '示例频率处穿孔比声阻抗的虚部（式3/式4）' },
  ],
  latex: [
    { label: '穿孔率', tex: '\\sigma_i = \\frac{n_{h,i}\\,d_{h,i}^{2}}{4\\,d_{in}\\,L_{c,i}}' },
    { label: '波数与穿孔半径', tex: 'r_h = \\frac{d_h}{2},\\qquad k_0 = \\frac{2\\pi f}{c_0}' },
    {
      label: '穿孔比声阻抗（M1 = 0 / M1 > 0）',
      tex: '\\xi = R_0 + j k_0\\left(t_w + \\alpha_0 d_h\\right);\\qquad \\xi = R_0 + 0.48\\left|k_0 r_h - M_1\\right| + j k_0\\left(t_w + C_G\\alpha_0 d_h\\right)',
    },
    {
      label: '端部修正与 CG',
      tex: '\\alpha_0 = 0.8216\\left(1 + 1.5319\\sqrt{\\sigma} + 1.4099\\sigma - 0.8780\\,\\sigma^{3/2}\\right),\\qquad C_G = \\frac{12}{k_0 r_h/M_1 - 1}\\;(k_0 r_h \\le M_1),\\; C_G = 1\\;(k_0 r_h > M_1)',
    },
    {
      label: '单腔耦合方程',
      tex: '\\frac{dp_1}{dx} = -jk_0 w_1,\\quad \\frac{dw_1}{dx} = -jk_0 p_1 - \\frac{P_1}{S_1\\xi}(p_1 - p_2),\\quad \\frac{dp_2}{dx} = -jk_0 w_2,\\quad \\frac{dw_2}{dx} = -jk_0 p_2 + \\frac{P_2}{S_2\\xi}(p_1 - p_2)',
    },
    {
      label: '周界与面积',
      tex: 'P_1 = \\pi d_{in},\\; S_1 = \\frac{\\pi d_{in}^{2}}{4};\\qquad P_2 = \\pi d_{out},\\; S_2 = \\frac{\\pi\\left(d_{out}^{2} - d_{in}^{2}\\right)}{4}',
    },
    {
      label: '系统矩阵与传播矩阵',
      tex: 'A = \\begin{bmatrix} 0 & -jk_0 & 0 & 0 \\\\ -jk_0 - \\frac{P_1}{S_1\\xi} & 0 & \\frac{P_1}{S_1\\xi} & 0 \\\\ 0 & 0 & 0 & -jk_0 \\\\ \\frac{P_2}{S_2\\xi} & 0 & -jk_0 - \\frac{P_2}{S_2\\xi} & 0 \\end{bmatrix},\\qquad \\Phi = e^{A L_c} = \\begin{bmatrix} \\Phi_{11} & \\Phi_{12} \\\\ \\Phi_{21} & \\Phi_{22} \\end{bmatrix}',
    },
    {
      label: '单腔传递矩阵',
      tex: 'T_{cav} = \\Phi_{11} - \\frac{\\Phi_{12}[:,1]\\,\\Phi_{21}[2,:]}{\\Phi_{22}[2,1]}',
    },
    {
      label: '多腔串联与直管段',
      tex: 'T = T_n T_{n-1} \\cdots T_1,\\qquad T_{duct} = \\begin{bmatrix} \\cos k_0L & j\\sin k_0L \\\\ j\\sin k_0L & \\cos k_0L \\end{bmatrix},\\qquad T_{area} = \\begin{bmatrix} 1 & 0 \\\\ 0 & S_a/S_b \\end{bmatrix}',
    },
    {
      label: '传递损失',
      tex: 'TL(f) = 20\\lg\\frac{\\left|T_{11} + T_{12} + T_{21} + T_{22}\\right|}{2}',
    },
  ],
  diagram: MULTI_CAVITY_DIAGRAM,
  sensitivity: true,
  assumptions: [
    '★ 标记说明：该公式验证不充分——仅按参考 PPT 的公式实现，尚无试验数据或权威算例校核，计算结果仅供参考，工程应用前须结合实际测试数据验证',
    '公式与参考 PPT 严格一致：σ（式1）、ξ（式3/4）、α0（式5）、CG（式6）、A（式12）、Φ = exp(A·Lc)（式13）、T_cav（式14）、串联（式15）、TL（式18）',
    '各腔采用统一几何参数（L_c、d_h、n_h 全腔相同）；逐腔差异化与式(20)(21)的优化（以 L_c、d_h、n_h 为设计变量，σ≤0.25、孔间距≥2d_h、Δp≤Δp_max）不在本模块实现',
    '相邻腔之间按式(16)以隔板厚度 c_t 的直管段连接；进出口管段与面积突变矩阵（式17）默认不参与计算',
    'TL 采用式(18)：20lg(|T11+T12+T21+T22|/2)。式(19)（含 Z0=ρ0c0/S 的等效定义）未采用，避免与本模型的无量纲化状态变量 w=ρ0c0u 混用',
    'M1 > 0 时 ξ 的实部按 0.48|k0r_h − M1| 计算；CG 按 PPT 式(6) 原式实现（k0r_h/M1 < 1 时 CG 为负、ξ 虚部可为负），分母接近 0 处按最小 |·|=1e-3 截断，未作符号修正',
    '穿孔率 σ 由式(1)反算得到（非独立输入）；PPT 约束 σ≤0.25、孔间距≥2d_h 由设计者自行校核',
    '一维平面波传递矩阵模型：忽略高阶模态、腔体结构振动与非线性大振幅效应',
    '由于 R0 取值很小，该模型给出的 TL 通常随频率升高而下降，且个别频点可能出现负值，属模型本身的特性而非数值错误',
    '介质取 20℃、常压空气（ρ0=1.205 kg/m³、c0=343 m/s）；极端温度/压力需按实际介质参数修正',
  ],
  solve(v) {
    const empty = { tl_avg: NaN, tl_max: NaN, f_peak: NaN, sigma: NaN, xi_re: NaN, xi_im: NaN };
    if (!(v.n >= 1) || !(v.din > 0) || !(v.dout > v.din) || !(v.Lc > 0)) return empty;

    const pts = sampleCurve(v);
    let tl_avg = NaN;
    let tl_max = NaN;
    let f_peak = NaN;
    if (pts.length > 0) {
      let best = pts[0];
      let sum = 0;
      for (const p of pts) {
        sum += p.y;
        if (p.y > best.y) best = p;
      }
      tl_max = best.y;
      f_peak = best.x;
      tl_avg = sum / pts.length;
    }

    // 示例频率处中间量（几何均值）
    const fSample = Math.sqrt(Math.max(v.fmin, 1) * Math.max(v.fmax, 1));
    const at = cavityAt(fSample, v);
    return {
      tl_avg,
      tl_max,
      f_peak,
      sigma: at ? at.sigma : NaN,
      xi_re: at ? at.xi[0] : NaN,
      xi_im: at ? at.xi[1] : NaN,
    };
  },
  curve: {
    label: '传递损失 TL 曲线',
    xLabel: 'Frequency (Hz)',
    yLabel: 'TL (dB)',
    compute(v) {
      return sampleCurve(v);
    },
  },
  // 基准值由本实现按 PPT 公式逐项核算（见 source），待试验数据到位后替换为实测校核算例
  benchmarks: [
    {
      name: '默认工况（无气流：d_in=40mm, d_out=60mm, t_w=2mm, d_h=3mm, n_h=40, n=4, L_c=20mm, c_t=2mm, M1=0, f∈[100,5000]Hz, Δf=10Hz）',
      input: {
        din: 0.04, dout: 0.06, tw: 0.002, dh: 0.003, nh: 40, n: 4,
        Lc: 0.02, ct: 0.002, rho0: 1.205, c0v: 343, M1: 0, R0: 0.0055,
        fmin: 100, fmax: 5000, df: 10,
      },
      expect: {
        sigma: 0.1125,
        xi_re: 0.0055,
        xi_im: 0.0782432217,
        tl_avg: 25.326579,
        tl_max: 66.704545,
        f_peak: 100,
      },
      tolerance: 5e-3,
      source: '按 PPT 式(1)~(18) 核算：σ = 40×0.003²/(4×0.04×0.02) = 0.1125；示例频率 √(100×5000)=707.1 Hz 处 ξ = 0.0055 + j0.078243；491 点扫描 TL 均值 25.3266 dB、峰值 66.7045 dB 出现在 100 Hz',
    },
    {
      name: '有气流变工况（M1=0.08, d_in=50mm, d_out=80mm, t_w=2.5mm, d_h=4mm, n_h=30, n=3, L_c=30mm, c_t=1.5mm, f∈[100,4000]Hz）',
      input: {
        din: 0.05, dout: 0.08, tw: 0.0025, dh: 0.004, nh: 30, n: 3,
        Lc: 0.03, ct: 0.0015, rho0: 1.205, c0v: 343, M1: 0.08, R0: 0.0055,
        fmin: 100, fmax: 4000, df: 10,
      },
      expect: {
        sigma: 0.08,
        xi_re: 0.0327778954,
        xi_im: -0.9526769998,
        tl_avg: 2.1509366,
        tl_max: 23.961784,
        f_peak: 100,
      },
      tolerance: 5e-3,
      source: '按 PPT 式(4)(6) 核算：σ = 30×0.004²/(4×0.05×0.03) = 0.08；707.1 Hz 处 ξ = 0.032778 − j0.952677（CG 为负）；391 点扫描 TL 均值 2.1509 dB、峰值 23.9618 dB 出现在 100 Hz',
    },
  ],
};
