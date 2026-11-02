import type { CurvePoint, FormulaSpec, OutputSpec, ParamSpec } from '../../formula/types';
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
 *   端部修正    α0 = 0.5×0.8216(1 + 1.5319√σ + 1.4099σ − 0.8780σ^1.5)      (5)
 *               CG = 12/(k0r_h/M1 − 1) (k0r_h ≤ M1)；CG = 1 (k0r_h > M1)    (6)
 *
 *   单腔耦合方程（状态 y = [p1, w1, p2, w2]ᵀ，w = ρ0c0u）：(7)~(10)
 *               dw1/dx = −jk0·p1 − σ_i·(P1/(S1ξ))·(p1 − p2)                    (8)
 *               dw2/dx = −jk0·p2 + σ_i·(P2/(S2ξ))·(p1 − p2)                    (10)
 *   周界 / 面积     P1 = πd_in，S1 = πd_in²/4；P2 = πd_in，S2 = π(d_out² − d_in²)/4  (11)
 *   系统矩阵        A（4×4，见式(12)，耦合项均含 σ_i）                              (12)
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
 * ★ PPT 修正要点：耦合项必须乘本腔穿孔率 σ_i（ξ 为单孔声阻抗，壁面只有开孔部分过流），
 *   漏乘 σ 会把壁面当成 100% 全开，表现为 TL 在低频极高、随频率单调下降；
 *   腔体耦合周长取内壁 P2 = πd_in（外壁刚性，不参与耦合）。
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
  alpha0: number;
  xi: Cx;
  cavity: Mat;
}

/** 单腔几何参数（逐腔输入，已换算为 SI） */
interface CavityGeom {
  Lc: number;
  dout: number;
  dh: number;
  nh: number;
}

/** 各腔共用参数 */
interface CommonParams {
  din: number;
  tw: number;
  c0v: number;
  M1: number;
  R0: number;
}

/** 从入参中取出第 1~n 腔的几何参数 */
function geomsOf(v: Record<string, number>, n: number): CavityGeom[] {
  const out: CavityGeom[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({ Lc: v[`Lc${i}`], dout: v[`dout${i}`], dh: v[`dh${i}`], nh: v[`nh${i}`] });
  }
  return out;
}

/** 式(5)：端部修正系数 α0 = 0.5×0.8216(1 + 1.5319√σ + 1.4099σ − 0.8780σ^1.5) —— 仅由本腔自身穿孔率 σ 决定（与频率无关） */
function alpha0Of(sigma: number): number {
  return 0.5 * 0.8216 * (1 + 1.5319 * Math.sqrt(sigma) + 1.4099 * sigma - 0.878 * Math.pow(sigma, 1.5));
}

/** 按式(1)~(14)计算单腔 2×2 传递矩阵 */
function cavityAt(f: number, p: CommonParams, g: CavityGeom): CavityAt | null {
  const { din, tw, c0v, M1, R0 } = p;
  const { Lc, dout, dh, nh } = g;
  if (!(f > 0) || !(din > 0) || !(dout > din) || !(tw > 0) || !(dh > 0) || !(nh > 0) || !(Lc > 0) || !(c0v > 0) || !(M1 >= 0))
    return null;

  const k0 = (2 * Math.PI * f) / c0v; // 式(2)
  const rh = dh / 2;

  // 式(1)：本腔穿孔率（逐腔各自计算）
  const sigma = (nh * dh * dh) / (4 * din * Lc);

  // 式(5)：端部修正系数（按本腔自身 σ_i 计算，仅用于本腔的 ξ 与耦合项）
  const alpha0 = alpha0Of(sigma);

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

  // 式(11)：周界与面积（P2 取内壁穿孔面 π·d_in，外壁刚性不参与耦合）
  const P1 = Math.PI * din;
  const S1 = (Math.PI * din * din) / 4;
  const P2 = Math.PI * din;
  const S2 = (Math.PI * (dout * dout - din * din)) / 4;
  if (!(S1 > 0) || !(S2 > 0)) return null;

  // 式(8)(10)(12)：耦合项 σ_i·P/(S·ξ)，σ_i 为本腔穿孔率，ξ 为单孔声阻抗
  const c1c = cdiv(cx((sigma * P1) / S1, 0), xi);
  const c2c = cdiv(cx((sigma * P2) / S2, 0), xi);
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
  // 腔体两端刚性（w2 = 0），由「w2(L) = 0」这一行解出 p2(0)：
  //   p2(0) = −Φ21[2,:]·[p1(0), w1(0)] / Φ22[2,1]
  // 式中下标按 PPT 的 1 基记法：Φ12[:,1] 为第 1 列（p2 列），Φ21[2,:] 为第 2 行，
  // Φ22[2,1] 为第 2 行第 1 列，换算到 0 基分别为 [i][0]、[1][j]、[1][0]。
  const den = phi22[1][0];
  const inv = cdiv(cx(1, 0), den);
  if (!inv) return null;
  const cavity: Mat = [
    [cx(0, 0), cx(0, 0)],
    [cx(0, 0), cx(0, 0)],
  ];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      // Φ12[i][0] · Φ21[1][j] / Φ22[1][0]
      const num: Cx = [
        phi12[i][0][0] * phi21[1][j][0] - phi12[i][0][1] * phi21[1][j][1],
        phi12[i][0][0] * phi21[1][j][1] + phi12[i][0][1] * phi21[1][j][0],
      ];
      const corr: Cx = [num[0] * inv[0] - num[1] * inv[1], num[0] * inv[1] + num[1] * inv[0]];
      cavity[i][j] = [phi11[i][j][0] - corr[0], phi11[i][j][1] - corr[1]];
    }
  }
  return { sigma, alpha0, xi, cavity };
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

/** 全模型：多腔串联 → 2×2 总传递矩阵与第 1 腔中间量 */
function cascade(f: number, v: Record<string, number>): { T: Mat; ct: CavityAt } | null {
  const n = Math.round(v.n ?? 0);
  if (!(n >= 1)) return null;
  const p: CommonParams = { din: v.din, tw: v.tw, c0v: v.c0v, M1: v.M1, R0: v.R0 };
  const geoms = geomsOf(v, n);
  const mats: Mat[] = [];
  let first: CavityAt | null = null;
  for (const g of geoms) {
    const at = cavityAt(f, p, g);
    if (!at) return null;
    if (!first) first = at;
    mats.push(at.cavity);
  }

  const k0 = (2 * Math.PI * f) / v.c0v;
  // 式(15)：T = T_n·T_duct(c_t)·T_n−1·…·T_duct(c_t)·T_1
  // （Φ = exp(A·Lc) 为「入口 → 出口」的映射，故总矩阵按腔序倒序左乘）
  let T: Mat = mats[mats.length - 1];
  for (let i = mats.length - 2; i >= 0; i--) {
    if (v.ct > 0) T = matMul(T, ductMatrix(v.ct, k0));
    T = matMul(T, mats[i]);
  }
  return { T, ct: first! };
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

/** 按 Δf 等步长扫描 [f_min, f_max] 的 TL 曲线（点数超过 2000 时自动放大步长，保证覆盖全频段） */
function sampleCurve(v: Record<string, number>): CurvePoint[] {
  const { fmin, fmax } = v;
  if (!(fmax > fmin) || !(fmin >= 0)) return [];
  const span = fmax - fmin;
  let step = v.df > 0 ? v.df : 10;
  if (span / step > 2000) step = span / 2000;
  const count = Math.max(1, Math.round(span / step));
  const points: CurvePoint[] = [];
  for (let i = 0; i <= count; i++) {
    const f = fmin + i * step;
    if (f > fmax + 1e-9) break;
    const r = cascade(f, v);
    if (!r) continue;
    const y = tlOf(r.T);
    if (Number.isFinite(y)) points.push({ x: f, y });
  }
  return points;
}

/** 逐腔输入字段的最大腔数（PPT 腔数 3~6） */
const CAVITY_MAX = 6;

/**
 * 逐腔单独输入：长度、腔外径、开孔直径、开孔数量。
 * 腔数 n 增大后依次展开（showIf），n 之外的腔输入不参与计算。
 * 默认值建议取值（典型 5 腔算例）：L_c = 8/10/13/17/23.8 mm，
 * d_out = 69 mm，d_h = 3.1 mm，n_h = 36。
 */
const CAVITY_LC_DEFAULT = [8, 10, 13, 17, 23.8, 20];
const cavityInputs: ParamSpec[] = [];
for (let i = 1; i <= CAVITY_MAX; i++) {
  cavityInputs.push(
    {
      key: `Lc${i}`, label: `腔${i} 长度`, symbol: `L_c${i}`, unit: 'mm', unitGroup: 'length',
      default: CAVITY_LC_DEFAULT[i - 1], min: 6, max: 50, required: true, showIf: { key: 'n', min: i },
      description: `第 ${i} 腔沿轴向的宽度，建议范围 0.006~0.050 m，属设计变量；建议取值 ${CAVITY_LC_DEFAULT[i - 1]} mm`,
    },
    {
      key: `dout${i}`, label: `腔${i} 外径`, symbol: `d_out${i}`, unit: 'mm', unitGroup: 'length',
      default: 69, min: 52, max: 160, required: true, showIf: { key: 'n', min: i },
      description: `第 ${i} 腔的腔体外径，建议范围 1.3~2.0 倍主管内径；建议取值 69 mm`,
    },
    {
      key: `dh${i}`, label: `腔${i} 开孔直径`, symbol: `d_h${i}`, unit: 'mm', unitGroup: 'length',
      default: 3.1, min: 2, max: 4, required: true, showIf: { key: 'n', min: i },
      description: `第 ${i} 腔的单孔直径，建议范围 0.002~0.004 m，属设计变量；建议取值 3.1 mm`,
    },
    {
      key: `nh${i}`, label: `腔${i} 开孔数量`, symbol: `n_h${i}`, unit: '个',
      default: 36, min: 20, max: 60, required: true, showIf: { key: 'n', min: i },
      description: `第 ${i} 腔的穿孔个数，建议范围 20~60，属设计变量；建议取值 36`,
    },
  );
}

/**
 * 逐腔穿孔率输出：σ_i = n_h,i·d_h,i²/(4·d_in·L_c,i)（式1），
 * 每个腔的 σ_i 直接乘入该腔的耦合项 σ_i·P/(S·ξ)（式8/10/12）。
 * 腔数之外的腔不参与计算，结果区与符号说明表按 showIf 隐藏对应行。
 */
const cavitySigmaOutputs: OutputSpec[] = Array.from({ length: CAVITY_MAX }, (_, k) => ({
  key: `sigma${k + 1}`,
  label: `穿孔率（腔${k + 1}）`,
  symbol: `σ${k + 1}`,
  unit: '-',
  group: '各腔穿孔率',
  showIf: { key: 'n', min: k + 1 },
  description: `第 ${k + 1} 腔的穿孔率 σ = n_h·d_h²/(4·d_in·L_c)（式1），用于该腔的穿孔阻抗修正与耦合项（式8/10/12）`,
}));

/**
 * 逐腔端部修正系数输出：α0,i 只由该腔自身穿孔率 σ_i 决定（式5，与频率无关），
 * 直接进入该腔穿孔阻抗 ξ_i 的虚部 j·k0(t_w + α0,i·d_h)（式3/4）。
 * 腔数之外的腔不参与计算，结果区与符号说明表按 showIf 隐藏对应行。
 */
const cavityAlphaOutputs: OutputSpec[] = Array.from({ length: CAVITY_MAX }, (_, k) => ({
  key: `alpha${k + 1}`,
  label: `端部修正系数（腔${k + 1}）`,
  symbol: `α0${k + 1}`,
  unit: '-',
  group: '各腔端部修正',
  showIf: { key: 'n', min: k + 1 },
  description: `第 ${k + 1} 腔按自身穿孔率 σ${k + 1} 按式(5) 计算的端部修正系数 α0 = 0.5×0.8216(1 + 1.5319√σ + 1.4099σ − 0.8780σ^1.5)，仅用于该腔的穿孔阻抗 ξ（式3/式4）`,
}));

export const multiCavitySilencer: FormulaSpec = {
  id: 'acoustics.muffler.multiCavity',
  domain: 'acoustics',
  subsystem: '消声器',
  title: '★ 多腔穿孔消音器',
  summary:
    '按 PPT 的一维传递矩阵（TMM）模型，逐腔输入长度、腔外径、开孔直径与开孔数量，各腔分别按式(1) 计算穿孔率 σ_i、按式(5) 由该腔 σ_i 单独计算端部修正 α0,i，并以 σ_i 乘入该腔的耦合项（σ_i·P/(S·ξ_i)），由穿孔比声阻抗 ξ_i 构造单腔 4×4 耦合方程，取 Φ = exp(A·Lc) 的矩阵分块得到单腔传递矩阵，多腔串联后给出传递损失 TL 并绘制 TL - Frequency 曲线。★ 公式验证不充分，结果仅供参考。',
  tags: ['多腔', '穿孔', '消声器', '消音器', '传递损失', 'TL', 'TMM', '宽频', 'NVH', '进气系统', '排气系统'],
  description:
    '多腔宽频消声器由主管穿孔段与串联腔体构成，PPT 采用一维传递矩阵法：各腔按自身几何（L_c,i、d_out,i、d_h,i、n_h,i）单独按式(1) 算穿孔率 σ_i，按式(5) 由该腔 σ_i 单独算端部修正 α0,i，再按式(3)~(6) 用该腔 α0,i、CG 算穿孔阻抗 ξ_i（含 M1=0 与 M1>0 两种工况），耦合项按 σ_i·P/(S·ξ_i) 计入（式8/10/12，P2 取内壁 πd_in），再按式(12) 构造 4×4 系统矩阵 A，取 Φ = exp(A·Lc) 并按式(14) 压缩为单腔 2×2 传递矩阵，按式(15) 将各腔串联（相邻腔间按式(16) 插入隔板直管段），最后由式(18) TL(f) = 20lg(|T11+T12+T21+T22|/2) 得到传递损失。结果区给出频带平均 TL、峰值 TL、峰值频率、各腔穿孔率与各腔端部修正系数，并绘制 TL - Frequency 曲线。',
  inputs: [
    { key: 'din', label: '主管内径', symbol: 'd_in', unit: 'mm', unitGroup: 'length', default: 41.6, min: 40, max: 80, required: true, description: '主管（穿孔段）内径，建议范围 0.040~0.080 m；建议取值 41.6 mm' },
    { key: 'tw', label: '穿孔壁厚（孔深）', symbol: 't_w', unit: 'mm', unitGroup: 'length', default: 2.8, min: 1.5, max: 3, required: true, description: '穿孔板厚度，即孔的有效深度，建议范围 0.0015~0.003 m；建议取值 2.8 mm' },
    { key: 'n', label: '腔数', symbol: 'n', unit: '个', default: 5, min: 3, max: 6, required: true, description: '串联腔体数量，建议范围 3~6；建议取值 5 腔，改动后下方逐腔输入按腔数依次展开' },
    ...cavityInputs,
    { key: 'ct', label: '隔板厚度', symbol: 'c_t', unit: 'mm', unitGroup: 'length', default: 2, min: 1, max: 3, required: true, description: '相邻腔之间的隔板（环形叶片）厚度，按式(16)作为直管段插入，建议范围 0.001~0.003 m；建议取值 2 mm' },
    { key: 'rho0', label: '空气密度', symbol: 'ρ0', unit: 'kg/m³', unitGroup: 'density', default: 1.205, min: 0, required: true, description: '常温常压空气密度，建议取值 1.205 kg/m³（20℃）' },
    { key: 'c0v', label: '空气声速', symbol: 'c0', unit: 'm/s', default: 343, min: 0, required: true, description: '常温常压声速，建议取值 343 m/s（20℃）' },
    { key: 'M1', label: '主管马赫数', symbol: 'M1', unit: '-', default: 0, min: 0, max: 0.15, required: true, description: '主管流速马赫数，建议范围 0~0.15；建议取值 0（无气流，按式3），有气流时按式(4)~式(6)计算' },
    { key: 'R0', label: '阻性常数', symbol: 'R0', unit: '-', default: 0.0055, min: 0, required: true, description: '穿孔阻抗实部经验常数，建议取值 0.0055（±20%）' },
    { key: 'fmin', label: '频率最小值', symbol: 'f_min', unit: 'Hz', default: 100, min: 0, required: true, description: 'TL 曲线扫描下限，建议取值 100 Hz' },
    { key: 'fmax', label: '频率最大值', symbol: 'f_max', unit: 'Hz', default: 5000, min: 0, required: true, description: 'TL 曲线扫描上限，建议取值 5000 Hz' },
    { key: 'df', label: '频率步长', symbol: 'Δf', unit: 'Hz', default: 10, min: 1, required: true, description: '频率扫描步长，建议范围 5~10 Hz' },
  ],
  outputs: [
    { key: 'tl_avg', label: '频带平均传递损失', symbol: 'TL_avg', unit: 'dB', primary: true, group: '声学特性', description: '在 [f_min, f_max] 内按 Δf 扫描得到的 TL 平均值' },
    { key: 'tl_max', label: '最大传递损失', symbol: 'TL_max', unit: 'dB', primary: true, group: '声学特性', description: '扫描频段内 TL 的最大值（峰值）' },
    { key: 'f_peak', label: '峰值频率', symbol: 'f_p', unit: 'Hz', group: '声学特性', description: 'TL 峰值对应的频率' },
    ...cavitySigmaOutputs,
    ...cavityAlphaOutputs,
    { key: 'xi_re', label: '穿孔阻抗实部（腔1/示例频率）', symbol: 'Re ξ', unit: '-', group: '中间量', description: '示例频率 √(f_min·f_max) 处第 1 腔穿孔比声阻抗的实部（式3/式4）' },
    { key: 'xi_im', label: '穿孔阻抗虚部（腔1/示例频率）', symbol: 'Im ξ', unit: '-', group: '中间量', description: '示例频率 √(f_min·f_max) 处第 1 腔穿孔比声阻抗的虚部（式3/式4）' },
    { key: 'k0', label: '波数（示例频率）', symbol: 'k0', unit: '1/m', group: '中间量', description: 'k0 = 2πf/c0（式2），随频率线性变化；此处为示例频率 √(f_min·f_max) 处的值。求解时每个频率采样点都重新计算 k0，并用于该点的 ξ_i、A 与 Φ' },
  ],
  latex: [
    { label: '穿孔率', tex: '\\sigma_i = \\frac{n_{h,i}\\,d_{h,i}^{2}}{4\\,d_{in}\\,L_{c,i}}' },
    { label: '波数与穿孔半径', tex: 'r_h = \\frac{d_h}{2},\\qquad k_0 = \\frac{2\\pi f}{c_0}' },
    {
      label: '穿孔比声阻抗（M1 = 0 / M1 > 0）',
      tex: '\\xi_i = R_0 + j k_0\\left(t_w + \\alpha_{0,i}\\,d_h\\right);\\qquad \\xi_i = R_0 + 0.48\\left|k_0 r_h - M_1\\right| + j k_0\\left(t_w + C_G\\,\\alpha_{0,i}\\,d_h\\right)',
    },
    {
      label: '端部修正与 CG',
      tex: '\\alpha_{0,i} = 0.5\\times 0.8216\\left(1 + 1.5319\\sqrt{\\sigma_i} + 1.4099\\sigma_i - 0.8780\\,\\sigma_i^{3/2}\\right),\\qquad C_G = \\frac{12}{k_0 r_h/M_1 - 1}\\;(k_0 r_h \\le M_1),\\; C_G = 1\\;(k_0 r_h > M_1)',
    },
    {
      label: '单腔耦合方程',
      tex: '\\frac{dp_1}{dx} = -jk_0 w_1,\\quad \\frac{dw_1}{dx} = -jk_0 p_1 - \\sigma_i\\frac{P_1}{S_1\\xi_i}(p_1 - p_2),\\quad \\frac{dp_2}{dx} = -jk_0 w_2,\\quad \\frac{dw_2}{dx} = -jk_0 p_2 + \\sigma_i\\frac{P_2}{S_2\\xi_i}(p_1 - p_2)',
    },
    {
      label: '周界与面积',
      tex: 'P_1 = \\pi d_{in},\\; S_1 = \\frac{\\pi d_{in}^{2}}{4};\\qquad P_2 = \\pi d_{in},\\; S_2 = \\frac{\\pi\\left(d_{out}^{2} - d_{in}^{2}\\right)}{4}',
    },
    {
      label: '系统矩阵与传播矩阵',
      tex: 'A = \\begin{bmatrix} 0 & -jk_0 & 0 & 0 \\\\ -jk_0 - \\sigma_i\\frac{P_1}{S_1\\xi_i} & 0 & \\sigma_i\\frac{P_1}{S_1\\xi_i} & 0 \\\\ 0 & 0 & 0 & -jk_0 \\\\ \\sigma_i\\frac{P_2}{S_2\\xi_i} & 0 & -jk_0 - \\sigma_i\\frac{P_2}{S_2\\xi_i} & 0 \\end{bmatrix},\\qquad \\Phi = e^{A L_c} = \\begin{bmatrix} \\Phi_{11} & \\Phi_{12} \\\\ \\Phi_{21} & \\Phi_{22} \\end{bmatrix}',
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
  sensitivity: false,
  assumptions: [
    '★ 标记说明：该公式尚未用实测数据校核——已与 PPT 引用的郭荣论文算例（即默认初始值）对比：α0 按工程约定乘 0.5 修正后，本实现 500 Hz≈1.0 dB、1.7 kHz≈8.9 dB、2.3 kHz≈34.1 dB、3.2 kHz≈25.2 dB，峰值 ≈51.5 dB 移至 ≈2.88 kHz（PPT 给出 ≈1/26/42/4 dB、峰值约 2.3 kHz），曲线整体向高频偏移，工程应用前建议用试验数据重新标定 α0 修正系数',
    '公式与参考 PPT 严格一致：σ_i（式1）、α0,i（式5）、ξ_i（式3/4）、CG（式6）、A（式12）、Φ = exp(A·Lc)（式13）、T_cav（式14）、串联（式15）、TL（式18）',
    '波数 k0 = 2πf/c0（式2）逐频率点更新：TL 曲线每个采样频率都重新计算 k0、ξ_i、A 与 Φ = exp(A·Lc)，k0 不是常数；结果区「中间量」给出的 k0 为示例频率 √(f_min·f_max) 处的值',
    '端部修正系数 α0,i 逐腔单独按式(5) 由该腔自身穿孔率 σ_i 计算（σ 越大 α0,i 越大），且只用于该腔的穿孔阻抗 ξ_i（式3/式4），不沿用其他腔的值；各腔 α0,i 在结果区「各腔端部修正」分组中给出。α0 公式按工程约定整体乘 0.5 修正：α0,i = 0.5×0.8216(1 + 1.5319√σ_i + 1.4099σ_i − 0.8780σ_i^1.5)',
    '各腔的长度 L_c,i、腔外径 d_out,i、开孔直径 d_h,i、开孔数量 n_h,i 均逐腔单独输入；腔数 n 决定参与计算的腔，n 之外的腔输入不参与计算',
    '各腔穿孔率 σ_i 由该腔自身几何按式(1) 计算，并以 σ_i 乘入该腔的耦合项（式8/10/12）；腔体耦合周长取内壁 P2 = πd_in，外壁刚性不参与耦合',
    'PPT 校验点：漏乘 σ 会把壁面当成 100% 全开，表现为 TL 在 100 Hz 达 60 dB 以上且随频率单调下降；正常结果应呈带通特性',
    'R0 很小时腔体共振几乎无阻尼，TL 峰值极高且对频率步长 Δf 敏感；工程判断应以频带平均 TL 与实测数据为准',
    '默认初始值建议取值：d_in=41.6、d_out=69、d_h=3.1、n_h=36、t_w=2.8、c_t=2 mm，5 腔、L_c=8/10/13/17/23.8 mm',
    '逐腔参数开放后不再逐腔扫描敏感性（参数数量过多且腔数会改变计算结构），故本公式不提供参数敏感性分析',
    'PPT 式(20)(21) 的优化流程（以 L_c、d_h、n_h 为设计变量，σ≤0.25、孔间距≥2d_h、Δp≤Δp_max）不在本模块实现',
    '相邻腔之间按式(16)以隔板厚度 c_t 的直管段连接；进出口管段与面积突变矩阵（式17）默认不参与计算',
    'TL 采用式(18)：20lg(|T11+T12+T21+T22|/2)。式(19)（含 Z0=ρ0c0/S 的等效定义）未采用，避免与本模型的无量纲化状态变量 w=ρ0c0u 混用',
    'M1 > 0 时 ξ 的实部按 0.48|k0r_h − M1| 计算；CG 按 PPT 式(6) 原式实现（k0r_h/M1 < 1 时 CG 为负、ξ 虚部可为负），分母接近 0 处按最小 |·|=1e-3 截断，未作符号修正',
    '穿孔率 σ 由式(1)反算得到（非独立输入）；PPT 约束 σ≤0.25、孔间距≥2d_h 由设计者自行校核',
    '一维平面波传递矩阵模型：忽略高阶模态、腔体结构振动与非线性大振幅效应',
    '穿孔率 σ 已按式(1) 逐腔乘入耦合项，TL 一般呈带通特性；R0 取值很小时个别频点可能出现负值，属模型本身的特性而非数值错误',
    '介质取 20℃、常压空气（ρ0=1.205 kg/m³、c0=343 m/s）；极端温度/压力需按实际介质参数修正',
  ],
  solve(v) {
    const empty = { tl_avg: NaN, tl_max: NaN, f_peak: NaN, xi_re: NaN, xi_im: NaN };
    const n = Math.round(v.n ?? 0);
    if (!(n >= 1) || !(v.din > 0) || !(v.tw > 0)) return empty;
    const geoms = geomsOf(v, n);
    if (geoms.some((g) => !(g.Lc > 0) || !(g.dout > v.din) || !(g.dh > 0) || !(g.nh > 0))) return empty;

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

    // 示例频率处中间量（取第 1 腔，几何均值频率）
    const fSample = Math.sqrt(Math.max(v.fmin, 1) * Math.max(v.fmax, 1));
    const p: CommonParams = { din: v.din, tw: v.tw, c0v: v.c0v, M1: v.M1, R0: v.R0 };
    const at = cavityAt(fSample, p, geoms[0]);

    const out: Record<string, number> = {
      tl_avg,
      tl_max,
      f_peak,
      xi_re: at ? at.xi[0] : NaN,
      xi_im: at ? at.xi[1] : NaN,
      // 波数 k0 = 2πf/c0（式2），示例频率处的取值；每个频率采样点都会重新计算
      k0: (2 * Math.PI * fSample) / Math.max(v.c0v, 1e-12),
    };
    // 逐腔穿孔率与端部修正：σ_i = n_h,i·d_h,i²/(4·d_in·L_c,i)，α0,i 由该腔 σ_i 按式(5) 单独计算
    geoms.forEach((g, i) => {
      const sigma = (g.nh * g.dh * g.dh) / (4 * v.din * g.Lc);
      out[`sigma${i + 1}`] = sigma;
      out[`alpha${i + 1}`] = alpha0Of(sigma);
    });
    return out;
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
      name: '郭荣论文算例（PPT 末页验证参数，即默认初始值：d_in=41.6mm, d_out=69mm, d_h=3.1mm, n_h=36, t_w=2.8mm, n=5, L_c=8/10/13/17/23.8mm, c_t=2mm, M1=0）',
      input: {
        din: 0.0416, tw: 0.0028, n: 5,
        Lc1: 0.008, Lc2: 0.01, Lc3: 0.013, Lc4: 0.017, Lc5: 0.0238,
        dout1: 0.069, dout2: 0.069, dout3: 0.069, dout4: 0.069, dout5: 0.069,
        dh1: 0.0031, dh2: 0.0031, dh3: 0.0031, dh4: 0.0031, dh5: 0.0031,
        nh1: 36, nh2: 36, nh3: 36, nh4: 36, nh5: 36,
        ct: 0.002, rho0: 1.205, c0v: 343, M1: 0, R0: 0.0055,
        fmin: 100, fmax: 5000, df: 10,
      },
      expect: {
        sigma1: 0.2598858173,
        sigma2: 0.2079086538,
        sigma3: 0.1599297337,
        sigma4: 0.1222992081,
        sigma5: 0.0873565772,
        alpha1: 0.8343498053,
        alpha2: 0.7839692319,
        alpha3: 0.7320272692,
        alpha4: 0.6862838446,
        alpha5: 0.6380814057,
        xi_re: 0.0055,
        xi_im: 0.0697711942,
        k0: 12.9530114815,
        tl_avg: 12.69846403,
        tl_max: 51.4952195,
        f_peak: 2880,
      },
      tolerance: 5e-3,
      source: 'PPT 末页郭荣论文校验：PPT 给出 500 Hz≈1 dB、1.7 kHz≈26 dB、2.3 kHz≈42 dB、3.2 kHz≈4 dB（呈带通）。α0 乘 0.5 修正后本实现同参数下为 1.04 / 8.92 / 34.13 / 25.24 dB，491 点扫描 TL 均值 12.6985 dB、峰值 51.4952 dB @ 2880 Hz；各腔 σ_i 按式(1) 各自计算，α0,i 按式(5) 由该腔 σ_i 单独计算并整体乘 0.5（0.8343 / 0.7840 / 0.7320 / 0.6863 / 0.6381）',
    },
    {
      name: '默认工况（无气流：4 腔各 L_c=20mm, d_out=60mm, d_h=3mm, n_h=40；d_in=40mm, t_w=2mm, c_t=2mm, M1=0, f∈[100,5000]Hz, Δf=10Hz）',
      input: {
        din: 0.04, tw: 0.002, n: 4,
        Lc1: 0.02, Lc2: 0.02, Lc3: 0.02, Lc4: 0.02,
        dout1: 0.06, dout2: 0.06, dout3: 0.06, dout4: 0.06,
        dh1: 0.003, dh2: 0.003, dh3: 0.003, dh4: 0.003,
        nh1: 40, nh2: 40, nh3: 40, nh4: 40,
        ct: 0.002, rho0: 1.205, c0v: 343, M1: 0, R0: 0.0055,
        fmin: 100, fmax: 5000, df: 10,
      },
      expect: {
        sigma1: 0.1125,
        sigma2: 0.1125,
        sigma3: 0.1125,
        sigma4: 0.1125,
        xi_re: 0.0055,
        xi_im: 0.0520746223,
        tl_avg: 14.20480118,
        tl_max: 112.4710454,
        f_peak: 2820,
      },
      tolerance: 5e-3,
      source: '按 PPT 式(1)~(18) 核算：各腔 σ = 40×0.003²/(4×0.04×0.02) = 0.1125，耦合项取 σ_i·P/(S·ξ)、P2 = πd_in；α0 乘 0.5 后示例频率 √(100×5000)=707.1 Hz 处 ξ = 0.0055 + j0.052075；491 点扫描 TL 均值 14.2048 dB，峰值 112.47 dB 出现在 2820 Hz（低频 TL≈0，呈带通）',
    },
    {
      name: '有气流变工况（M1=0.08：3 腔各 L_c=30mm, d_out=80mm, d_h=4mm, n_h=30；d_in=50mm, t_w=2.5mm, c_t=1.5mm, f∈[100,4000]Hz）',
      input: {
        din: 0.05, tw: 0.0025, n: 3,
        Lc1: 0.03, Lc2: 0.03, Lc3: 0.03,
        dout1: 0.08, dout2: 0.08, dout3: 0.08,
        dh1: 0.004, dh2: 0.004, dh3: 0.004,
        nh1: 30, nh2: 30, nh3: 30,
        ct: 0.0015, rho0: 1.205, c0v: 343, M1: 0.08, R0: 0.0055,
        fmin: 100, fmax: 4000, df: 10,
      },
      expect: {
        sigma1: 0.08,
        sigma2: 0.08,
        sigma3: 0.08,
        xi_re: 0.0327778954,
        xi_im: -0.4618565928,
        tl_avg: 0.8302501039,
        tl_max: 20.11815532,
        f_peak: 2190,
      },
      tolerance: 5e-3,
      source: '按 PPT 式(4)(6) 核算：各腔 σ = 30×0.004²/(4×0.05×0.03) = 0.08；α0 乘 0.5 后 707.1 Hz 处 ξ = 0.032778 − j0.461857（CG 为负）；391 点扫描 TL 均值 0.8303 dB、峰值 20.1182 dB 出现在 2190 Hz',
    },
    {
      name: '逐腔差异化（第 3 腔 L_c=35mm, d_h=4mm, n_h=50，其余腔按默认；验证 σ_i 与腔体一一对应）',
      input: {
        din: 0.04, tw: 0.002, n: 4,
        Lc1: 0.02, Lc2: 0.02, Lc3: 0.035, Lc4: 0.02,
        dout1: 0.06, dout2: 0.06, dout3: 0.06, dout4: 0.06,
        dh1: 0.003, dh2: 0.003, dh3: 0.004, dh4: 0.003,
        nh1: 40, nh2: 40, nh3: 50, nh4: 40,
        ct: 0.002, rho0: 1.205, c0v: 343, M1: 0, R0: 0.0055,
        fmin: 100, fmax: 5000, df: 10,
      },
      expect: {
        sigma1: 0.1125,
        sigma2: 0.1125,
        sigma3: 0.1428571429,
        sigma4: 0.1125,
        tl_avg: 16.12736379,
        tl_max: 96.98054328,
        f_peak: 2820,
      },
      tolerance: 5e-3,
      source: '按式(1) 核算：第 3 腔 σ = 50×0.004²/(4×0.04×0.035) = 0.142857，其余腔 0.1125；该 σ 只进入第 3 腔的耦合项 σ_i·P/(S·ξ)，α0 乘 0.5 后 491 点扫描 TL 均值 16.1274 dB、峰值 96.9805 dB 出现在 2820 Hz',
    },
  ],
};
