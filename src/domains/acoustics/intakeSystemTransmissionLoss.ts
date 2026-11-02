import type { CurvePoint, FormulaSpec, OutputSpec, ParamSpec, ShowIf } from '../../formula/types';

/**
 * 进气系统声音传递损失计算（进气管—波纹管—编织管—空滤器—出气管—多腔穿孔消音器）
 *
 * 按《进气系统传递损失计算（进气管-波纹管-编织管-空滤器-出气管-消音器）》实现，
 * 状态变量统一取 [p, ρcu]（w = ρ0c0u），此时 Z0 = 1：
 *   传递损失      TL = 10·lg(Win/Wout)                                        （式1）
 *   四端参数      TL = 20·lg(|T11 + T12 + T21 + T22|/2) + 10·lg(Sin/Sout)      （式3/33）
 *   总传递矩阵    T = Tn·Tn−1·…·T1                                           （式4）
 *   截面突变      Tarea = [1, 0; 0, Sd/Su]                                   （式5）
 *   等截面直管    Tduct = [cos(kL), jsin(kL); jsin(kL), cos(kL)]              （式6）
 *   波纹管        mw = (D+2h)²/D²，TLw = 10·lg[1 + 0.25(mw − 1/mw)²sin²(kw)]   （式7/8）
 *   编织管        JCA 等效流体 → 壁面阻抗 ζw → α = (2/D)·Rw/(Rw² + Xw²)，
 *                 TL ≈ 8.686·α·L（式9~18），本式按复波数 kx = k0 − jα 级联
 *   空滤器膨胀腔  TLexp = 10·lg[1 + 0.25(m − 1/m)²sin²(kL)]                   （式21）
 *   亥姆霍兹      f0 = (c/2π)·[An/(V·Leff)]^(1/2)，Leff = ln + 0.85dn          （式22）
 *   四分之一波长  fq = (2k−1)·c/(4L)，TLbranch = 20·lg|1 + Sp/(2Sbζb)|          （式23/24）
 *   滤芯          JCA 多孔层传递矩阵 Tlayer = [cos(kct), jZcsin(kct); …]        （式13）
 *   膨胀腔高频    峰值 fmax,n = (2n−1)c/(4L)，谷值 fmin,n = n·c/(2L)，
 *                 TLmax = 10lg[1+0.25(m−1/m)²]，TLavg = 10lg[1+0.125(m−1/m)²]，
 *                 一阶高阶模态截止 fc,1 = 1.84c/(πD)                          （式24a~24f）
 *   多腔消音器    σi = nh·dh²/(4·din·Lc)，ξi = R0 + jk0(tw + α0dh)，
 *                 A(4×4) → Φ = exp(A·Lc) → Tcav → 逐腔串联                     （式25~31）
 *   系统合成      Tsys = Tin·Tbellows·Tbraid·Tairbox·Tmuffler·Tout             （式32）
 *
 * ★ 单腔矩阵、多腔级联与多腔穿孔消音器模块（acoustics.muffler.multiCavity）保持同一套
 *   Sullivan-Crocker / Munjal 公式；R0 = 0.0055 未经试验标定，多腔结果仅供参考。
 */
type Cx = [number, number];

const cx = (re: number, im = 0): Cx => [re, im];

function cAdd(a: Cx, b: Cx): Cx {
  return [a[0] + b[0], a[1] + b[1]];
}

function cSub(a: Cx, b: Cx): Cx {
  return [a[0] - b[0], a[1] - b[1]];
}

function cMul(a: Cx, b: Cx): Cx {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

function cDiv(a: Cx, b: Cx): Cx | null {
  const d = b[0] * b[0] + b[1] * b[1];
  if (!(d > 1e-300)) return null;
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}

function cSqrt(a: Cx): Cx {
  const r = Math.sqrt(Math.hypot(a[0], a[1]));
  const th = Math.atan2(a[1], a[0]) / 2;
  return [r * Math.cos(th), r * Math.sin(th)];
}

/** 复正弦 / 复余弦：cos(a+bj) = cos a·cosh b − j sin a·sinh b；sin(a+bj) = sin a·cosh b + j cos a·sinh b */
function cCos(a: Cx): Cx {
  return [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])];
}
function cSin(a: Cx): Cx {
  return [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])];
}
function cTan(a: Cx): Cx | null {
  return cDiv(cSin(a), cCos(a));
}

type Mat2 = Cx[][];
type Mat4 = Cx[][];

function matMul(a: Cx[][], b: Cx[][]): Cx[][] {
  const n = a.length;
  const p = b.length;
  const m = b[0].length;
  const out: Cx[][] = [];
  for (let i = 0; i < n; i++) {
    const row: Cx[] = [];
    for (let j = 0; j < m; j++) {
      let re = 0;
      let im = 0;
      for (let t = 0; t < p; t++) {
        re += a[i][t][0] * b[t][j][0] - a[i][t][1] * b[t][j][1];
        im += a[i][t][0] * b[t][j][1] + a[i][t][1] * b[t][j][0];
      }
      row.push([re, im]);
    }
    out.push(row);
  }
  return out;
}

function matAdd(a: Cx[][], b: Cx[][]): Cx[][] {
  return a.map((row, i) => row.map((v, j) => cAdd(v, b[i][j])));
}

function ident(n: number): Cx[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? cx(1) : cx(0))),
  );
}

function norm1(m: Cx[][]): number {
  let max = 0;
  for (let j = 0; j < m[0].length; j++) {
    let s = 0;
    for (let i = 0; i < m.length; i++) s += Math.hypot(m[i][j][0], m[i][j][1]);
    if (s > max) max = s;
  }
  return max;
}

/** 复矩阵指数：缩放-平方 + 24 阶泰勒（与多腔消音器模块同实现） */
function expm(m: Cx[][]): Cx[][] {
  let s = 0;
  const nrm = norm1(m);
  let scale = 1;
  if (nrm > 0.5) {
    s = Math.ceil(Math.log2(nrm));
    scale = Math.pow(2, s);
  }
  const A = m.map((row) => row.map((v) => [v[0] / scale, v[1] / scale] as Cx));
  let result = ident(m.length);
  let term = ident(m.length);
  for (let k = 1; k <= 24; k++) {
    term = matMul(term, A);
    term = term.map((row) => row.map((v) => [v[0] / k, v[1] / k] as Cx));
    result = matAdd(result, term);
  }
  for (let i = 0; i < s; i++) result = matMul(result, result);
  return result;
}

/** 2×2 单位阵 */
const eye2 = (): Mat2 => [[cx(1), cx(0)], [cx(0), cx(1)]];

/** 等截面直管：kL 可为复数（编织管按 kx = k0 − jα 传入），Z0 = 1 时两处非对角元同为 jsin(kL) */
function ductMat(L: number, kL: Cx): Mat2 {
  if (!(L > 0)) return eye2();
  const cs = cCos(kL);
  const jSn = cMul(cx(0, 1), cSin(kL));
  return [
    [cs, jSn],
    [jSn, cs],
  ];
}

/** 截面突变：Tarea = [1, 0; 0, Sd/Su]（Sd 下游、Su 上游） */
function areaMat(sd: number, su: number): Mat2 {
  return [[cx(1), cx(0)], [cx(0), cx(sd / su)]];
}

/**
 * 渐变管离散段数（式6b/6c 约束）：N ≥ 10，且 ΔL = L/N ≤ λ_min/10（λ_min = c0/f_max）。
 * 上限 40 仅用于控制计算量；波纹管按自身波距给定的段数（nMin）不受该上限约束。
 */
function taperSegCount(L: number, c0: number, fMax: number): number {
  if (!(L > 0) || !(c0 > 0) || !(fMax > 0)) return 10;
  const nReq = (10 * L * fMax) / c0;
  return Math.max(10, Math.min(40, Math.ceil(nReq)));
}

/**
 * 渐变管（式6a~6c）：S(x) = πD(x)²/4，D_i = D_in + (D_out − D_in)(i − 0.5)/N，
 * T = Tarea(S_N→S_out)·Tduct(D_N)·…·Tduct(D_1)·Tarea(S_in→S_1)。
 * nodeAt(D, l) 给出该子段的本体矩阵（直管 / 波纹管 / 编织管各自实现）；
 * D_in = D_out 时各面积项均为单位阵，节点数退化为 nMin（直管为 1），即式(6) 等截面直管。
 */
function taperMat(
  din: number,
  dout: number,
  L: number,
  c0: number,
  fMax: number,
  nodeAt: (D: number, l: number) => Mat2,
  nMin = 1,
): Mat2 {
  if (!(L > 0)) return eye2();
  const tapered = Math.abs(dout / din - 1) > 1e-9;
  const N = tapered ? Math.max(nMin, taperSegCount(L, c0, fMax)) : Math.max(1, nMin);
  const dl = L / N;
  const dAt = (i: number) => (tapered ? din + (dout - din) * ((i - 0.5) / N) : din);
  const sAt = (i: number) => (Math.PI * dAt(i) * dAt(i)) / 4;
  let T = areaMat(sAt(1), (Math.PI * din * din) / 4);
  for (let i = 1; i <= N; i++) {
    T = matMul(nodeAt(dAt(i), dl), T);
    if (i < N) T = matMul(areaMat(sAt(i + 1), sAt(i)), T);
  }
  return matMul(areaMat((Math.PI * dout * dout) / 4, sAt(N)), T);
}

/** TL = 20·lg(|T11+T12+T21+T22|/2) + 10·lg(Sin/Sout)（式3，含式33 的面积修正） */
function tlOf(T: Cx[][], sin: number, sout: number): number {
  const s: Cx = [
    T[0][0][0] + T[0][1][0] + T[1][0][0] + T[1][1][0],
    T[0][0][1] + T[0][1][1] + T[1][0][1] + T[1][1][1],
  ];
  const mag = Math.hypot(s[0], s[1]) / 2;
  if (!(mag > 1e-300)) return NaN;
  return 20 * Math.log10(mag) + 10 * Math.log10(sin / sout);
}

/** JCA 五参数 */
interface JcaParams {
  sigma: number;
  phi: number;
  alphaInf: number;
  lambdaV: number;
  lambdaT: number;
}

/** 介质与常数 */
interface Medium {
  rho0: number;
  c0: number;
  mu: number;
  nPr: number;
  gam: number;
  pAtm: number;
}

interface JcaResult {
  rhoEq: Cx;
  kEq: Cx;
  zc: Cx;
  kc: Cx;
}

/**
 * JCA 等效流体（式9~12）：
 *   ρeq = α∞ρ0[1 + σ/(jωρ0α∞)·(1 + j·4α∞²ημρ0ω/(σ²Λ²φ²))^(1/2)]
 *   Keq = γP0/[γ − (γ−1)A]，A = [1 + σ/(jNprωρ0α∞)·(1 + j·4α∞²ημρ0ωNpr/(σ²Λ′²φ²))^(1/2)]^(−1)
 *   Zc = (ρeq·Keq)^(1/2)，kc = ω·(ρeq/Keq)^(1/2)
 */
function jca(f: number, m: Medium, p: JcaParams): JcaResult {
  const w = 2 * Math.PI * f;
  // 标准 JCA 形式：线性项取 σ（不含 φ），φ 只出现在根号内的黏/热项；
  // 文档式(9)(11) 写作 σfφ，若按其字面代入会使样件 TL 偏大约一倍（31.5 vs 论文 16.4 dB）
  const kv = p.sigma / (w * m.rho0 * p.alphaInf);
  const xv = (4 * p.alphaInf * p.alphaInf * m.mu * m.rho0 * w) /
    (p.sigma * p.sigma * p.lambdaV * p.lambdaV * p.phi * p.phi);
  const rhoEq = cMul(cx(p.alphaInf * m.rho0), cAdd(cx(1), cMul(cx(0, -kv), cSqrt(cx(1, xv)))));
  const kt = p.sigma / (m.nPr * w * m.rho0 * p.alphaInf);
  const xt = (4 * p.alphaInf * p.alphaInf * m.mu * m.rho0 * w * m.nPr) /
    (p.sigma * p.sigma * p.lambdaT * p.lambdaT * p.phi * p.phi);
  const A = cDiv(cx(1), cAdd(cx(1), cMul(cx(0, -kt), cSqrt(cx(1, xt)))) ) ?? cx(1);
  const kEq = cDiv(cx(m.gam * m.pAtm), cSub(cx(m.gam), cMul(cx(m.gam - 1), A))) ?? cx(1);
  return {
    rhoEq,
    kEq,
    zc: cSqrt(cMul(rhoEq, kEq)),
    kc: cMul(cx(w), cSqrt(cDiv(rhoEq, kEq) ?? cx(1))),
  };
}

/**
 * 编织管壁面归一化阻抗 ζw = Zw/(ρ0c0)（式13~15，外侧按空气背衬）。
 * 多孔层传递矩阵 Tlayer = [cos(kct), jZcsin(kct); jsin(kct)/Zc, cos(kct)]，
 * 表面阻抗 Zw = Zc(ZL + jZctan(kct))/(Zc + jZLtan(kct))，ZL = ρ0c0。
 */
function wallZeta(f: number, m: Medium, p: JcaParams, thickness: number): Cx | null {
  const j = jca(f, m, p);
  const zcN = cDiv(j.zc, cx(m.rho0 * m.c0));
  if (!zcN) return null;
  const tan = cTan(cMul(j.kc, cx(thickness)));
  if (!tan) return null;
  const num = cAdd(cx(1), cMul(cx(0, 1), cMul(zcN, tan)));
  const den = cAdd(zcN, cMul(cx(0, 1), tan));
  const ratio = cDiv(num, den);
  if (!ratio) return null;
  return cMul(zcN, ratio);
}

/**
 * 编织管壁面耗散因子 K = Rw/(Rw² + Xw²)（式17）：α = (2/D)·K，TL ≈ 8.686·α·L（式18）。
 * 渐变段按各子段自身直径取 α_i = 2K/D_i，K 与频率、壁厚有关，逐频点只算一次即可。
 */
function braidDissipation(f: number, thickness: number, m: Medium, p: JcaParams): number {
  if (!(f > 0) || !(thickness > 0)) return 0;
  const z = wallZeta(f, m, p, thickness);
  if (!z) return 0;
  const den = z[0] * z[0] + z[1] * z[1];
  if (!(den > 1e-300) || !(z[0] > 0)) return 0;
  return z[0] / den;
}

/** 单腔穿孔消音器传递矩阵（式25~30，与多腔模块同一实现） */
function cavityMat(
  f: number,
  c0: number,
  din: number,
  dout: number,
  dh: number,
  nh: number,
  tw: number,
  Lc: number,
  M1: number,
  R0: number,
): Cx[][] | null {
  if (!(f > 0) || !(din > 0) || !(dout > din) || !(tw > 0) || !(dh > 0) || !(nh > 0) || !(Lc > 0)) return null;
  const k0 = (2 * Math.PI * f) / c0;
  const rh = dh / 2;
  const sigma = (nh * dh * dh) / (4 * din * Lc);
  const alpha0 = 0.5 * 0.8216 *
    (1 + 1.5319 * Math.sqrt(sigma) + 1.4099 * sigma - 0.878 * Math.pow(sigma, 1.5));
  let xi: Cx;
  if (M1 <= 0) {
    xi = cx(R0, k0 * (tw + alpha0 * dh));
  } else {
    let CG = 1;
    const q = (k0 * rh) / M1;
    if (q <= 1) {
      let den = q - 1;
      if (Math.abs(den) < 1e-3) den = den < 0 ? -1e-3 : 1e-3;
      CG = 12 / den;
    }
    xi = cx(R0 + 0.48 * Math.abs(k0 * rh - M1), k0 * (tw + CG * alpha0 * dh));
  }
  const P1 = Math.PI * din;
  const S1 = (Math.PI * din * din) / 4;
  const P2 = Math.PI * din;
  const S2 = (Math.PI * (dout * dout - din * din)) / 4;
  if (!(S1 > 0) || !(S2 > 0)) return null;
  const c1 = cDiv(cx((sigma * P1) / S1), xi);
  const c2 = cDiv(cx((sigma * P2) / S2), xi);
  if (!c1 || !c2) return null;
  const zero = cx(0);
  const rowA: Mat4 = [
    [zero, cx(0, -k0), zero, zero],
    [cSub(cx(0, -k0), c1), zero, c1, zero],
    [zero, zero, zero, cx(0, -k0)],
    [c2, zero, cSub(cx(0, -k0), c2), zero],
  ];
  const A: Mat4 = rowA.map((row) => row.map((c): Cx => [c[0] * Lc, c[1] * Lc]));
  const Phi = expm(A);
  const phi11: Cx[][] = [[Phi[0][0], Phi[0][1]], [Phi[1][0], Phi[1][1]]];
  const phi12: Cx[][] = [[Phi[0][2], Phi[0][3]], [Phi[1][2], Phi[1][3]]];
  const phi21: Cx[][] = [[Phi[2][0], Phi[2][1]], [Phi[3][0], Phi[3][1]]];
  const phi22: Cx[][] = [[Phi[2][2], Phi[2][3]], [Phi[3][2], Phi[3][3]]];
  const den = phi22[1][0];
  const inv = cDiv(cx(1), den);
  if (!inv) return null;
  const out: Cx[][] = [[cx(0), cx(0)], [cx(0), cx(0)]];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const num = cMul(phi12[i][0], phi21[1][j]);
      const corr = cMul(num, inv);
      out[i][j] = cSub(phi11[i][j], corr);
    }
  }
  return out;
}

/** 多腔穿孔消音器：逐腔串联（式31） */
function mufflerMat(
  f: number,
  c0: number,
  din: number,
  dout: number,
  dh: number,
  nh: number,
  tw: number,
  ct: number,
  lcs: number[],
  M1: number,
  R0: number,
): Cx[][] | null {
  if (lcs.length < 1) return null;
  const k0 = (2 * Math.PI * f) / c0;
  const mats: Cx[][][] = [];
  for (const Lc of lcs) {
    const m = cavityMat(f, c0, din, dout, dh, nh, tw, Lc, M1, R0);
    if (!m) return null;
    mats.push(m);
  }
  let T: Cx[][] = mats[mats.length - 1];
  for (let i = mats.length - 2; i >= 0; i--) {
    if (ct > 0) T = matMul(T, ductMat(ct, cx(k0 * ct)));
    T = matMul(T, mats[i]);
  }
  return T;
}

/** 进气管/出气管每侧最多支持的段数（操作者在「系统组成」里选实际段数） */
const SEG_MAX = 5;

/** 分段几何默认值（进气管最多 5 段，第 4/5 段默认不启用，长度取 0） */
const IN_SEG_DEFAULT = [
  { type: 1, D: 70, L: 300, h: 4, w: 10, tw: 2.7 },
  { type: 2, D: 60, L: 150, h: 4, w: 10, tw: 2.7 },
  { type: 3, D: 60, L: 250, h: 4, w: 10, tw: 2.7 },
  { type: 1, D: 60, L: 0, h: 4, w: 10, tw: 2.7 },
  { type: 1, D: 60, L: 0, h: 4, w: 10, tw: 2.7 },
];

/** 出气管最多 5 段：段 1 直管、段 2 多腔穿孔消音器、段 3 未使用，段 4/5 默认不启用 */
const OUT_SEG_DEFAULT = [
  { type: 1, D: 60, L: 400, h: 4, w: 10, nc: 5, dout: 69, dh: 3.1, nh: 36, tw: 2.8, ct: 2 },
  { type: 3, D: 60, L: 200, h: 4, w: 10, nc: 5, dout: 69, dh: 3.1, nh: 36, tw: 2.8, ct: 2 },
  { type: 1, D: 60, L: 0, h: 4, w: 10, nc: 5, dout: 69, dh: 3.1, nh: 36, tw: 2.8, ct: 2 },
  { type: 1, D: 60, L: 0, h: 4, w: 10, nc: 5, dout: 69, dh: 3.1, nh: 36, tw: 2.8, ct: 2 },
  { type: 1, D: 60, L: 0, h: 4, w: 10, nc: 5, dout: 69, dh: 3.1, nh: 36, tw: 2.8, ct: 2 },
];

const CAVITY_LC_DEFAULT = [8, 10, 13, 17, 23.8];

/** 旁支消音器建议几何（选定旁支类型后才参与计算） */
const BRANCH_DEFAULT = { V: 0.5, ln: 30, dn: 20, Lq: 400, dq: 35 };

/** 旁支消音器类型：0 无、1 四分之一波长管、2 亥姆霍兹消音器 */
const BRANCH_OPTIONS = [
  { value: 0, label: '无' },
  { value: 1, label: '四分之一波长管' },
  { value: 2, label: '亥姆霍兹消音器' },
];
/** 旁支数量选择：选定旁支类型后才出现，1/2/3/… */
const BRANCH_N_OPTIONS = [1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: `${n}` }));

/** 输入分区标题 */
const SEC_COMP = '系统组成';
const SEC_RUN = '运行参数';
const SEC_JCA = '编织管材料（JCA）';
const SEC_MED = '介质与多腔消音器参数';
const SEC_IN = '进气管几何';
const SEC_BOX = '空滤器';
const SEC_FIL = '空滤器滤芯';
const SEC_OUT = '出气管几何与消音器';

/** 给一组输入统一加分区标题 */
const withGroup = (list: ParamSpec[], group: string): ParamSpec[] =>
  list.map((p) => ({ ...p, group }));

/** 分段数选择：1~5 段；超出段数的管段其参数与公式自动隐藏 */
const SEG_N_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} 段` }));

/**
 * 系统组成（放在所有输入参数之前）：先由操作者选择「进气管段数」与「出气管段数」，
 * 再按「进气管 1…n + 空滤器 + 出气管 1…m」逐件组建——每段选定管型，并在同段选择是否加装旁支消音器与数量；
 * 表单按图上流程横排为「段 → 旁支消音器 → 数量」，段与段之间竖向串联，
 * 后续几何参数与公式区按所选段数与管型展开。
 */
const compInputs: ParamSpec[] = [
  { key: 'nIn', label: '进气管分段数', symbol: 'N_in,seg', unit: '段', kind: 'select', options: SEG_N_OPTIONS, default: 3, required: true, group: SEC_COMP, description: '进气管按实际走向分成几段（1~5）。超出该段数的进气管段，其管型、旁支与几何参数、专用公式均自动隐藏' },
];
for (let i = 1; i <= SEG_MAX; i++) {
  const d = IN_SEG_DEFAULT[i - 1];
  compInputs.push(
    { key: `t${i}`, label: `进气管段 ${i} 管型`, cellTitle: `进气管 ${i}`, row: `in${i}`, symbol: '-', unit: '-', kind: 'select', options: [{ value: 1, label: '进气管' }, { value: 2, label: '波纹管' }, { value: 3, label: '编织管' }], default: d.type, required: true, group: SEC_COMP, showIf: { key: 'nIn', min: i }, description: `进气管第 ${i} 段的类别由操作者选择：直管 / 波纹管 / 编织管；段 ${i} 默认${d.type === 1 ? '进气管' : d.type === 2 ? '波纹管' : '编织管'}，下方公式随选择切换` },
    { key: `br${i}`, label: `进气管段 ${i} 旁支消音器`, cellTitle: '旁支消音器', row: `in${i}`, symbol: '-', unit: '-', kind: 'select', options: BRANCH_OPTIONS, default: 0, required: true, group: SEC_COMP, showIf: { key: 'nIn', min: i }, description: '默认「无」；选择四分之一波长管或亥姆霍兹消音器后，紧接着出现数量选择，并在下方展开对应几何参数' },
    { key: `brN${i}`, label: `进气管段 ${i} 旁支数量`, cellTitle: '数量', row: `in${i}`, symbol: `N_in${i}`, unit: '个', kind: 'select', options: BRANCH_N_OPTIONS, default: 1, min: 1, max: 6, required: true, showIf: [{ key: `br${i}`, min: 1 }, { key: 'nIn', min: i }], group: SEC_COMP, description: '在该段下游端并联的相同旁支个数；N 个并联的等效归一化阻抗取 ζb/N' },
  );
}
compInputs.push(
  { key: 'hOn', label: '空滤器亥姆霍兹谐振腔', cellTitle: '空滤器 · 亥姆霍兹谐振腔', row: 'box', symbol: '-', unit: '-', kind: 'select', options: [{ value: 0, label: '不设置' }, { value: 1, label: '设置' }], default: 1, required: true, group: SEC_COMP, description: '设置在空滤器入口主管上的旁支谐振腔，用于对准目标噪声峰值（式22）' },
  { key: 'qOn', label: '空滤器四分之一波长支管', cellTitle: '空滤器 · 四分之一波长支管', row: 'box', symbol: '-', unit: '-', kind: 'select', options: [{ value: 0, label: '不设置' }, { value: 1, label: '设置' }], default: 0, required: true, group: SEC_COMP, description: '设置在空滤器入口主管上的封闭支管，fq = c/(4L) 处形成 TL 峰值（式23/24）' },
  { key: 'nOut', label: '出气管分段数', symbol: 'N_out,seg', unit: '段', kind: 'select', options: SEG_N_OPTIONS, default: 3, required: true, group: SEC_COMP, description: '出气管按实际走向分成几段（1~5）。超出该段数的出气管段，其管型、旁支与几何参数、专用公式均自动隐藏' },
);
for (let i = 1; i <= SEG_MAX; i++) {
  const d = OUT_SEG_DEFAULT[i - 1];
  compInputs.push(
    { key: `o${i}`, label: `出气管段 ${i} 管型`, cellTitle: `出气管 ${i}`, row: `out${i}`, symbol: '-', unit: '-', kind: 'select', options: [{ value: 1, label: '出气管' }, { value: 2, label: '波纹管' }, { value: 3, label: '多腔穿孔消音器' }], default: d.type, required: true, group: SEC_COMP, showIf: { key: 'nOut', min: i }, description: `出气管第 ${i} 段的类别由操作者选择：直管 / 波纹管 / 多腔穿孔消音器；段 ${i} 默认${d.type === 1 ? '出气管' : d.type === 2 ? '波纹管' : '多腔穿孔消音器'}，下方公式随选择切换` },
    { key: `bro${i}`, label: `出气管段 ${i} 旁支消音器`, cellTitle: '旁支消音器', row: `out${i}`, symbol: '-', unit: '-', kind: 'select', options: BRANCH_OPTIONS, default: 0, required: true, group: SEC_COMP, showIf: { key: 'nOut', min: i }, description: '默认「无」；选择四分之一波长管或亥姆霍兹消音器后，紧接着出现数量选择，并在下方展开对应几何参数' },
    { key: `broN${i}`, label: `出气管段 ${i} 旁支数量`, cellTitle: '数量', row: `out${i}`, symbol: `N_out${i}`, unit: '个', kind: 'select', options: BRANCH_N_OPTIONS, default: 1, min: 1, max: 6, required: true, showIf: [{ key: `bro${i}`, min: 1 }, { key: 'nOut', min: i }], group: SEC_COMP, description: '在该段下游端并联的相同旁支个数；N 个并联的等效归一化阻抗取 ζb/N' },
  );
}

/** 进气管侧几何输入（1~SEG_MAX 段，按所选段数的前 nIn 段展开） */
const inInputs: ParamSpec[] = [];
for (let i = 1; i <= SEG_MAX; i++) {
  const d = IN_SEG_DEFAULT[i - 1];
  const seg = { key: 'nIn', min: i };
  inInputs.push(
    { key: `D${i}`, label: `进气管段 ${i} 进口内径`, symbol: `D_in${i}`, unit: 'mm', unitGroup: 'diameter', default: d.D, min: 0, required: true, showIf: seg, description: '该段进口内径，用于截面突变、波数与旁支阻抗归一化计算' },
    { key: `Dout${i}`, label: `进气管段 ${i} 出口内径`, symbol: `D_out${i}`, unit: 'mm', unitGroup: 'diameter', default: d.D, min: 0, required: true, showIf: seg, description: '该段出口内径；与进口内径不同时按渐变管（式6b/6c）离散为 N 段圆柱，相同则退化为等截面直管。直管/波纹管/编织管均按此处理，不能用一个平均直径代替全段' },
    { key: `L${i}`, label: `进气管段 ${i} 长度`, symbol: `L_in${i}`, unit: 'mm', unitGroup: 'length', default: d.L, min: 0, required: true, showIf: seg, description: '该段沿程长度，未使用取 0；旁支数量非 0 时长度可取 0，旁支仍按集中元件接入' },
    { key: `h${i}`, label: `进气管段 ${i} 波纹波深`, symbol: `h${i}`, unit: 'mm', unitGroup: 'length', default: d.h, min: 0, showIf: [seg, { key: `t${i}`, min: 2, max: 2 }], description: '仅波纹管需要：波深 h；mw = (D+2h)²/D²（式7）' },
    { key: `w${i}`, label: `进气管段 ${i} 波纹波距`, symbol: `w${i}`, unit: 'mm', unitGroup: 'length', default: d.w, min: 0, showIf: [seg, { key: `t${i}`, min: 2, max: 2 }], description: '仅波纹管需要：波距 w，每个波节按长度 w 的膨胀腔处理（式8）' },
    { key: `twB${i}`, label: `进气管段 ${i} 编织壁厚`, symbol: `t_b${i}`, unit: 'mm', unitGroup: 'length', default: d.tw, min: 0, showIf: [seg, { key: `t${i}`, min: 3, max: 3 }], description: '仅编织管需要：壁厚 t，进入 JCA 壁面阻抗计算（式13/14）' },
    { key: `hbV${i}`, label: `进气管段 ${i} 亥姆霍兹腔容积`, symbol: `V_H,in${i}`, unit: 'L', unitGroup: 'volume', default: BRANCH_DEFAULT.V, min: 0, showIf: [seg, { key: `br${i}`, min: 2, max: 2 }], description: '仅该段旁支选为亥姆霍兹消音器时填写：总容积 V（多腔并联时按单个腔计）' },
    { key: `hbLn${i}`, label: `进气管段 ${i} 亥姆霍兹腔颈长`, symbol: `l_n,in${i}`, unit: 'mm', unitGroup: 'length', default: BRANCH_DEFAULT.ln, min: 0, showIf: [seg, { key: `br${i}`, min: 2, max: 2 }], description: '仅该段旁支选为亥姆霍兹消音器时填写：颈长 l_n，Leff = l_n + 0.85d_n（式22）' },
    { key: `hbDn${i}`, label: `进气管段 ${i} 亥姆霍兹腔颈径`, symbol: `d_n,in${i}`, unit: 'mm', unitGroup: 'diameter', default: BRANCH_DEFAULT.dn, min: 0, showIf: [seg, { key: `br${i}`, min: 2, max: 2 }], description: '仅该段旁支选为亥姆霍兹消音器时填写：颈径 d_n，An = πd_n²/4（式22）' },
    { key: `qwL${i}`, label: `进气管段 ${i} 四分之一波长支管长度`, symbol: `L_q,in${i}`, unit: 'mm', unitGroup: 'length', default: BRANCH_DEFAULT.Lq, min: 0, showIf: [seg, { key: `br${i}`, min: 1, max: 1 }], description: '仅该段旁支选为四分之一波长管时填写：支管长度 L_b，fq = c/(4L)（式23）' },
    { key: `qwD${i}`, label: `进气管段 ${i} 四分之一波长支管直径`, symbol: `d_q,in${i}`, unit: 'mm', unitGroup: 'diameter', default: BRANCH_DEFAULT.dq, min: 0, showIf: [seg, { key: `br${i}`, min: 1, max: 1 }], description: '仅该段旁支选为四分之一波长管时填写：支管直径 d_b，Sb = πd_b²/4（式24）' },
  );
}

/** 出气管侧几何输入（1~SEG_MAX 段，按所选段数的前 nOut 段展开） */
const outInputs: ParamSpec[] = [];
for (let i = 1; i <= SEG_MAX; i++) {
  const d = OUT_SEG_DEFAULT[i - 1];
  const seg = { key: 'nOut', min: i };
  outInputs.push(
    { key: `Do${i}`, label: `出气管段 ${i} 进口内径`, symbol: `D_out,in${i}`, unit: 'mm', unitGroup: 'diameter', default: d.D, min: 0, required: true, showIf: seg, description: '出气管段进口内径；多腔消音器时为穿孔主管内径 d_in（进出口共用）' },
    { key: `Douto${i}`, label: `出气管段 ${i} 出口内径`, symbol: `D_out,out${i}`, unit: 'mm', unitGroup: 'diameter', default: d.D, min: 0, required: true, showIf: seg, description: '出气管段出口内径；与进口内径不同时按渐变管（式6b/6c）离散，多腔消音器段按出口截面突变接入下游' },
    { key: `Lo${i}`, label: `出气管段 ${i} 长度`, symbol: `L_out${i}`, unit: 'mm', unitGroup: 'length', default: d.L, min: 0, required: true, showIf: seg, description: '该段长度，未使用取 0；旁支数量非 0 时长度可取 0，旁支仍按集中元件接入' },
    { key: `hO${i}`, label: `出气管段 ${i} 波纹波深`, symbol: `h${i}`, unit: 'mm', unitGroup: 'length', default: d.h, min: 0, showIf: [seg, { key: `o${i}`, min: 2, max: 2 }], description: '仅波纹管需要：波深 h' },
    { key: `wO${i}`, label: `出气管段 ${i} 波纹波距`, symbol: `w${i}`, unit: 'mm', unitGroup: 'length', default: d.w, min: 0, showIf: [seg, { key: `o${i}`, min: 2, max: 2 }], description: '仅波纹管需要：波距 w' },
    { key: `nc${i}`, label: `出气管段 ${i} 消音器腔数`, symbol: `n${i}`, unit: '个', default: d.nc, min: 1, max: 5, showIf: [seg, { key: `o${i}`, min: 3, max: 3 }], description: '仅多腔穿孔消音器需要：串联腔数 1~5，改动后下方逐腔长度按腔数依次展开' },
    { key: `DoutS${i}`, label: `出气管段 ${i} 消音器腔外径`, symbol: `d_out${i}`, unit: 'mm', unitGroup: 'diameter', default: d.dout, min: 0, showIf: [seg, { key: `o${i}`, min: 3, max: 3 }], description: '仅多腔穿孔消音器需要：腔体外径，须大于穿孔管内径' },
    { key: `dhS${i}`, label: `出气管段 ${i} 消音器开孔直径`, symbol: `d_h${i}`, unit: 'mm', unitGroup: 'diameter', default: d.dh, min: 0, showIf: [seg, { key: `o${i}`, min: 3, max: 3 }], description: '仅多腔穿孔消音器需要：单孔直径 d_h' },
    { key: `nhS${i}`, label: `出气管段 ${i} 消音器开孔数量`, symbol: `n_h${i}`, unit: '个', default: d.nh, min: 0, showIf: [seg, { key: `o${i}`, min: 3, max: 3 }], description: '仅多腔穿孔消音器需要：该腔穿孔个数（本段各腔共用）' },
    { key: `twS${i}`, label: `出气管段 ${i} 消音器穿孔壁厚`, symbol: `t_w${i}`, unit: 'mm', unitGroup: 'length', default: d.tw, min: 0, showIf: [seg, { key: `o${i}`, min: 3, max: 3 }], description: '仅多腔穿孔消音器需要：穿孔板厚度（孔深）t_w' },
    { key: `ctS${i}`, label: `出气管段 ${i} 消音器隔板厚度`, symbol: `c_t${i}`, unit: 'mm', unitGroup: 'length', default: d.ct, min: 0, showIf: [seg, { key: `o${i}`, min: 3, max: 3 }], description: '仅多腔穿孔消音器需要：相邻腔间环形隔板厚度，按直管段插入（式31）' },
    { key: `hbVo${i}`, label: `出气管段 ${i} 亥姆霍兹腔容积`, symbol: `V_H,out${i}`, unit: 'L', unitGroup: 'volume', default: BRANCH_DEFAULT.V, min: 0, showIf: [seg, { key: `bro${i}`, min: 2, max: 2 }], description: '仅该段旁支选为亥姆霍兹消音器时填写：总容积 V（多腔并联时按单个腔计）' },
    { key: `hbLno${i}`, label: `出气管段 ${i} 亥姆霍兹腔颈长`, symbol: `l_n,out${i}`, unit: 'mm', unitGroup: 'length', default: BRANCH_DEFAULT.ln, min: 0, showIf: [seg, { key: `bro${i}`, min: 2, max: 2 }], description: '仅该段旁支选为亥姆霍兹消音器时填写：颈长 l_n，Leff = l_n + 0.85d_n（式22）' },
    { key: `hbDno${i}`, label: `出气管段 ${i} 亥姆霍兹腔颈径`, symbol: `d_n,out${i}`, unit: 'mm', unitGroup: 'diameter', default: BRANCH_DEFAULT.dn, min: 0, showIf: [seg, { key: `bro${i}`, min: 2, max: 2 }], description: '仅该段旁支选为亥姆霍兹消音器时填写：颈径 d_n，An = πd_n²/4（式22）' },
    { key: `qwLo${i}`, label: `出气管段 ${i} 四分之一波长支管长度`, symbol: `L_q,out${i}`, unit: 'mm', unitGroup: 'length', default: BRANCH_DEFAULT.Lq, min: 0, showIf: [seg, { key: `bro${i}`, min: 1, max: 1 }], description: '仅该段旁支选为四分之一波长管时填写：支管长度 L_b，fq = c/(4L)（式23）' },
    { key: `qwDo${i}`, label: `出气管段 ${i} 四分之一波长支管直径`, symbol: `d_q,out${i}`, unit: 'mm', unitGroup: 'diameter', default: BRANCH_DEFAULT.dq, min: 0, showIf: [seg, { key: `bro${i}`, min: 1, max: 1 }], description: '仅该段旁支选为四分之一波长管时填写：支管直径 d_b，Sb = πd_b²/4（式24）' },
  );
  for (let j = 1; j <= 5; j++) {
    outInputs.push({
      key: `Lc${i}_${j}`,
      label: `出气管段 ${i} 腔${j} 长度`,
      symbol: `L_c${i},${j}`,
      unit: 'mm',
      unitGroup: 'length',
      default: CAVITY_LC_DEFAULT[j - 1],
      min: 0,
      showIf: [seg, { key: `o${i}`, min: 3, max: 3 }],
      description: `第 ${j} 腔沿轴向宽度；该段腔数小于 ${j} 时不参与计算。建议取值 8/10/13/17/23.8 mm`,
    });
  }
}

const jcaInputs: ParamSpec[] = [
  { key: 'sigmaF', label: '编织壁流阻率', symbol: 'σ_f', unit: 'Pa·s/m²', default: 240000, min: 0, required: true, description: 'JCA 五参数之一（式9/10）；建议取值 σ_f = 240 kPa·s/m²，即 240000 Pa·s/m²' },
  { key: 'phiJ', label: '编织壁孔隙率', symbol: 'φ', unit: '-', unitGroup: 'dimensionless', default: 0.35, min: 0, max: 1, required: true, description: 'JCA 孔隙率 φ，建议取值 0.35' },
  { key: 'alphaInf', label: '编织壁曲折度', symbol: 'α∞', unit: '-', unitGroup: 'dimensionless', default: 2.5, min: 1, required: true, description: 'JCA 高频曲折度 α∞，建议取值 2.5' },
  { key: 'lambdaV', label: '编织壁黏性特征长度', symbol: 'Λ', unit: 'mm', unitGroup: 'length', default: 0.027, min: 0, required: true, description: 'JCA 黏性特征长度 Λ，建议取值 0.027 mm（27 μm）' },
  { key: 'lambdaT', label: '编织壁热特征长度', symbol: 'Λ′', unit: 'mm', unitGroup: 'length', default: 0.054, min: 0, required: true, description: 'JCA 热特征长度 Λ′，建议取值 0.054 mm（54 μm）' },
];

const filterInputs: ParamSpec[] = [
  { key: 'tFil', label: '滤芯厚度', symbol: 't_f', unit: 'mm', unitGroup: 'length', default: 30, min: 0, required: true, description: '滤芯多孔层厚度，取 0 表示空滤器不装滤芯（滤芯矩阵为单位阵）' },
  { key: 'sigmaFil', label: '滤材流阻率', symbol: 'σ_f,f', unit: 'Pa·s/m²', default: 300000, min: 0, required: true, description: '滤材 JCA 流阻率，建议按本滤材实测数据取值，不能套用编织管参数' },
  { key: 'phiFil', label: '滤材孔隙率', symbol: 'φ_f', unit: '-', unitGroup: 'dimensionless', default: 0.9, min: 0, max: 1, required: true, description: '滤材孔隙率，滤纸/无纺布通常 0.85~0.95' },
  { key: 'alphaFil', label: '滤材曲折度', symbol: 'α∞,f', unit: '-', unitGroup: 'dimensionless', default: 1.5, min: 1, required: true, description: '滤材曲折度，纤维滤材通常 1.2~2.0' },
  { key: 'lambdaVFil', label: '滤材黏性特征长度', symbol: 'Λ_f', unit: 'mm', unitGroup: 'length', default: 0.1, min: 0, required: true, description: '滤材黏性特征长度，建议按滤材纤维直径与孔隙结构取值' },
  { key: 'lambdaTFil', label: '滤材热特征长度', symbol: 'Λ′_f', unit: 'mm', unitGroup: 'length', default: 0.2, min: 0, required: true, description: '滤材热特征长度，通常约为 Λ_f 的 2 倍' },
];

const outputList: OutputSpec[] = [
  { key: 'c', label: '介质声速', symbol: 'c', unit: 'm/s', digits: 1, group: '声学特性', description: 'c ≈ 331.3 + 0.606t（t 为摄氏温度，式11 注意事项）；20 ℃ 约 343.4 m/s' },
  { key: 'tl_avg', label: '系统平均传递损失', symbol: 'TL_avg', unit: 'dB', digits: 1, primary: true, group: '声学特性', description: '频带 [f_min, f_max] 内 201 点系统 TL 的算术平均' },
  { key: 'tl_max', label: '系统传递损失峰值', symbol: 'TL_max', unit: 'dB', digits: 1, primary: true, group: '声学特性', description: '频带内系统 TL 的最大值' },
  { key: 'f_peak', label: '峰值频率', symbol: 'f_p', unit: 'Hz', digits: 0, group: '声学特性', description: 'TL 峰值对应的频率（采样点）' },

  { key: 'tl250', label: '250 Hz 系统传递损失', symbol: 'TL(250)', unit: 'dB', digits: 1, group: '指定频率', description: '用于与文档第 10 节算例表（250/500/1000/1500 Hz）逐点对照' },
  { key: 'tl500', label: '500 Hz 系统传递损失', symbol: 'TL(500)', unit: 'dB', digits: 1, group: '指定频率', description: '固定频点 TL，便于与实测/文档表格对比' },
  { key: 'tl1000', label: '1000 Hz 系统传递损失', symbol: 'TL(1000)', unit: 'dB', digits: 1, group: '指定频率', description: '固定频点 TL' },
  { key: 'tl1500', label: '1500 Hz 系统传递损失', symbol: 'TL(1500)', unit: 'dB', digits: 1, group: '指定频率', description: '固定频点 TL' },

  { key: 'tlInAvg', label: '进气管侧平均传递损失', symbol: 'TL_in', unit: 'dB', digits: 1, group: '分部件平均传递损失', description: '仅进气管已启用各段（1~nIn）串联（含各段所选旁支）的频带平均 TL；等截面直管段自身 TL ≈ 0' },
  { key: 'tlBoxAvg', label: '空滤器总成平均传递损失', symbol: 'TL_airbox', unit: 'dB', digits: 1, group: '分部件平均传递损失', description: '膨胀腔 + 滤芯 + 谐振腔 + 四分之一波长支管的频带平均 TL' },
  { key: 'tlOutAvg', label: '出气管侧平均传递损失', symbol: 'TL_out', unit: 'dB', digits: 1, group: '分部件平均传递损失', description: '出气管已启用各段（1~nOut）串联（含各段所选旁支）的频带平均 TL' },
  { key: 'tlBraidAvg', label: '编织管平均传递损失', symbol: 'TL_braid', unit: 'dB', digits: 1, group: '分部件平均传递损失', description: '仅编织管段串联的平均 TL；论文样件（L=145 mm、D=49.36 mm、t=2.7 mm）20~2000 Hz 平均 TL ≈ 16.4 dB' },
  { key: 'tlBellowsAvg', label: '波纹管平均传递损失', symbol: 'TL_bel', unit: 'dB', digits: 1, group: '分部件平均传递损失', description: '仅波纹管段串联的平均 TL，通常 1~3 dB，远小于其隔振贡献' },
  { key: 'tlSilAvg', label: '多腔消音器平均传递损失', symbol: 'TL_muf', unit: 'dB', digits: 1, group: '分部件平均传递损失', description: '仅多腔穿孔消音器段串联的平均 TL；R0 为建议取值，结果仅供参考' },

  { key: 'fExpPeak1', label: '膨胀腔一阶峰值频率', symbol: 'f_max,1', unit: 'Hz', digits: 1, group: '膨胀腔高频特性', description: 'fmax,1 = c/(4L)，即式(24c) 取 n=1；高阶峰值 fmax,n = (2n−1)c/(4L)，峰谷交替、间隔约 c/(2L)' },
  { key: 'fExpMin1', label: '膨胀腔一阶谷值频率', symbol: 'f_min,1', unit: 'Hz', digits: 1, group: '膨胀腔高频特性', description: 'fmin,1 = c/(2L)，即式(24b) 取 n=1；谷值处 sin²(kL)=0，膨胀腔 TL 回到 0 dB' },
  { key: 'tlExpMax', label: '膨胀腔峰值传递损失', symbol: 'TL_max', unit: 'dB', digits: 1, group: '膨胀腔高频特性', description: 'TLmax = 10lg[1 + 0.25(m − 1/m)²]（式24d）；峰值不随阶次升高而增大，只是频率变密' },
  { key: 'tlExpAvg', label: '膨胀腔高频平均传递损失', symbol: 'TL_avg,exp', unit: 'dB', digits: 1, group: '膨胀腔高频特性', description: 'TLavg = 10lg[1 + 0.125(m − 1/m)²]（式24e，sin² 取 1/2），用于评价高频段整体消音量' },
  { key: 'fcMode1', label: '腔体一阶高阶模态截止频率', symbol: 'f_c,1', unit: 'Hz', digits: 1, group: '膨胀腔高频特性', description: 'fc,1 = 1.84c/(πD_chamber)（式24f）；频率超过该值后平面波假设失效，需用三维模型或实测' },
  { key: 'fcDuct', label: '最细管段一阶高阶模态截止频率', symbol: 'f_c,duct', unit: 'Hz', digits: 1, group: '膨胀腔高频特性', description: 'fc = 1.84c/(πD_min)（式6d，D_min 为各管段进出口内径的最小值）；渐变管按最小直径校核平面波假设，超过该频率后应改用三维模型或实测' },

  { key: 'fH', label: '亥姆霍兹谐振频率', symbol: 'f_0', unit: 'Hz', digits: 1, group: '谐振频率', showIf: { key: 'hOn', min: 1, max: 1 }, description: 'f0 = (c/2π)·[An/(V·Leff)]^(1/2)，Leff = ln + 0.85dn（式22）' },
  { key: 'fQ', label: '四分之一波长首阶频率', symbol: 'f_q', unit: 'Hz', digits: 1, group: '谐振频率', showIf: { key: 'qOn', min: 1, max: 1 }, description: 'fq = (2k−1)·c/(4L)，k=1,2,…；结果为首阶 c/(4L)（式23）' },
];

/**
 * 曲线专用单频点求解器：solve 执行时把当前输入下的 at(f) 注册到这里，
 * 供 curve.compute 复用同一套模型（避免复制或重复构建矩阵）。
 */
let modelAt: ((f: number) => number) | null = null;

/** 各管段旁支消音器的专用公式：该段启用且选定对应旁支类型时在公式区显示 */
const branchLatex: { label: string; tex: string; showIf?: ShowIf }[] = [];
for (let i = 1; i <= SEG_MAX; i++) {
  const seg = { key: 'nIn', min: i };
  branchLatex.push(
    { label: `进气管段 ${i} 亥姆霍兹旁支（式22）`, tex: 'T_b = \\begin{bmatrix}1 & 0 \\\\ N/\\zeta_b & 1\\end{bmatrix},\\qquad \\zeta_b = j\\left[\\frac{\\omega\\rho_0 L_{eff}}{A_n}-\\frac{\\rho_0 c_0^2}{\\omega V}\\right]\\frac{S}{\\rho_0c_0}', showIf: [seg, { key: `br${i}`, min: 2, max: 2 }] },
    { label: `进气管段 ${i} 四分之一波长旁支（式23/24）`, tex: 'T_b = \\begin{bmatrix}1 & 0 \\\\ N/\\zeta_b & 1\\end{bmatrix},\\qquad \\zeta_b = -j\\frac{S}{S_b}\\cot(kL_b)', showIf: [seg, { key: `br${i}`, min: 1, max: 1 }] },
  );
}
for (let i = 1; i <= SEG_MAX; i++) {
  const seg = { key: 'nOut', min: i };
  branchLatex.push(
    { label: `出气管段 ${i} 亥姆霍兹旁支（式22）`, tex: 'T_b = \\begin{bmatrix}1 & 0 \\\\ N/\\zeta_b & 1\\end{bmatrix},\\qquad \\zeta_b = j\\left[\\frac{\\omega\\rho_0 L_{eff}}{A_n}-\\frac{\\rho_0 c_0^2}{\\omega V}\\right]\\frac{S}{\\rho_0c_0}', showIf: [seg, { key: `bro${i}`, min: 2, max: 2 }] },
    { label: `出气管段 ${i} 四分之一波长旁支（式23/24）`, tex: 'T_b = \\begin{bmatrix}1 & 0 \\\\ N/\\zeta_b & 1\\end{bmatrix},\\qquad \\zeta_b = -j\\frac{S}{S_b}\\cot(kL_b)', showIf: [seg, { key: `bro${i}`, min: 1, max: 1 }] },
  );
}

/** 各管段按所选管型显示的专用公式：仅显示已启用段（i ≤ nIn / nOut）且管型匹配 */
const segTypeLatex: { label: string; tex: string; showIf?: ShowIf }[] = [];
for (let i = 1; i <= SEG_MAX; i++) {
  const seg = { key: 'nIn', min: i };
  segTypeLatex.push(
    { label: `进气管段 ${i}：波纹管（式7/8）`, tex: 'm_w = \\frac{(D+2h)^2}{D^2},\\qquad TL_w = 10\\lg\\left[1+0.25\\left(m_w-\\frac{1}{m_w}\\right)^2\\sin^2(kw)\\right]', showIf: [seg, { key: `t${i}`, min: 2, max: 2 }] },
    { label: `进气管段 ${i}：编织管（JCA + 壁面衰减，式9~18）`, tex: '\\zeta_w = \\frac{Z_w}{\\rho_0c_0}=R_w+jX_w,\\qquad \\alpha = \\frac{2}{D}\\frac{R_w}{R_w^2+X_w^2},\\qquad TL \\approx 8.686\\,\\alpha L', showIf: [seg, { key: `t${i}`, min: 3, max: 3 }] },
  );
}
for (let i = 1; i <= SEG_MAX; i++) {
  const seg = { key: 'nOut', min: i };
  segTypeLatex.push(
    { label: `出气管段 ${i}：波纹管（式7/8）`, tex: 'm_w = \\frac{(D+2h)^2}{D^2},\\qquad TL_w = 10\\lg\\left[1+0.25\\left(m_w-\\frac{1}{m_w}\\right)^2\\sin^2(kw)\\right]', showIf: [seg, { key: `o${i}`, min: 2, max: 2 }] },
    { label: `出气管段 ${i}：多腔穿孔消音器（式25~31）`, tex: '\\sigma_i = \\frac{n_h d_h^2}{4d_{in}L_{c,i}},\\quad \\xi_i = R_0 + jk_0\\left(t_w+\\alpha_0 d_h\\right),\\quad A = \\begin{bmatrix}0&-jk_0&0&0\\\\ -jk_0-\\sigma_i\\frac{P_1}{S_1\\xi_i}&0&\\sigma_i\\frac{P_1}{S_1\\xi_i}&0\\\\ 0&0&0&-jk_0\\\\ \\sigma_i\\frac{P_2}{S_2\\xi_i}&0&-jk_0-\\sigma_i\\frac{P_2}{S_2\\xi_i}&0\\end{bmatrix},\\quad \\Phi = e^{A L_{c,i}}', showIf: [seg, { key: `o${i}`, min: 3, max: 3 }] },
  );
}

export const intakeSystemTransmissionLoss: FormulaSpec = {
  id: 'acoustics.intakeSystemTransmissionLoss',
  domain: 'acoustics',
  subsystem: '进气系统',
  title: '进气系统声音传递损失计算（进气管—波纹管—编织管—空滤器—出气管—消音器）',
  summary:
    '按「系统组成 → 参数 → 公式」组织：输入区最前先由操作者选择进气管与出气管的分段数（各 1~5 段），再按「进气管 1…nIn + 空滤器 + 出气管 1…nOut」逐件组建，每段选定管型，并在同段选择是否加装旁支消音器（无 / 四分之一波长管 / 亥姆霍兹消音器，默认无），选定后紧接着选择数量 1/2/3…；超出所选段数的管段，其管型、旁支、几何参数与专用公式自动隐藏，其余几何参数与公式区只按所选组成展开。每个管段按进口/出口内径建模，两者不同时按渐变管离散（式6b/6c）。模型按四端参数（传递矩阵）级联，输出系统传递损失 TL 曲线与各分部件平均 TL。',
  tags: ['进气系统', '传递损失', 'TL', 'NVH', '声学', '进气管', '波纹管', '编织管', 'JCA', '空气滤清器', '滤芯', '膨胀腔', '亥姆霍兹', '四分之一波长', '多腔', '穿孔', '消音器', '传递矩阵', '四端参数', '高频共振', '峰谷频率', '高阶模态', '渐变管', '锥形管', '进出口直径'],
  description:
    '输入区最前为「系统组成」：先选择进气管与出气管的分段数（各 1~5 段），再按「进气管 1…nIn + 空滤器 + 出气管 1…nOut」逐件组建，每段先选管型，再在同一段选择旁支消音器（无 / 四分之一波长管 / 亥姆霍兹消音器，默认无），选定后紧接数量选择 1/2/3…；空滤器单独选择是否设谐振腔与支管。超出所选段数的管段不显示管型、旁支与几何参数，其专用公式也不出现；选定旁支后，下方几何参数区立即展开该元件所需参数，公式区同步显示对应旁支公式；未选中的元件不出现参数、也不显示公式。每个管段分别给出进口内径 D_in 与出口内径 D_out：两者不同时按 Webster 方程（式6a）离散为 N 段圆柱（D_i = D_in + (D_out − D_in)(i − 0.5)/N，式6b），逐段建立传递矩阵并按局部截面突变级联（式6c）；离散满足 N ≥ 10 且 ΔL ≤ λ_min/10 时与精确锥形管理论误差 < 1 dB，D_in = D_out 时退化为等截面直管（式6）。数量为 N 时，在该段下游端按集中元件并联接入 N 个相同旁支（等效归一化阻抗 ζb/N，传递矩阵 [1, 0; N/ζb, 1]）。传递损失 TL 是消音元件入射声功率与透射声功率之比，只与元件本身有关，与声源和末端反射无关（式1）。本公式统一采用 [p, ρcu] 状态变量（Z0 = 1），按四端参数逐段建立 2×2 传递矩阵并级联：等截面直管 T = [cos(kL), jsin(kL); jsin(kL), cos(kL)]，截面突变 T = [1, 0; 0, Sd/Su]；系统总矩阵 Tsys = Tin·Tbellows·Tbraid·Tairbox·Tmuffler·Tout，最后按 TL = 20lg(|T11+T12+T21+T22|/2) + 10lg(Sin/Sout) 求得（式3 与式33 的面积修正）。进气管侧每段可选进气管（纯直管）、波纹管（按「一串短膨胀腔」逐波节级联，mw = (D+2h)²/D²，单节 TLw = 10lg[1 + 0.25(mw−1/mw)²sin²(kw)]）或编织管（Johnson-Champoux-Allard 等效流体模型：五参数 → ρeq、Keq → Zc、kc → 壁面阻抗 ζw = Rw + jXw → 衰减系数 α = (2/D)·Rw/(Rw²+Xw²) → TL ≈ 8.686·α·L；系统级联时按复波数 kx = k0 − jα 处理）。空滤器按「膨胀腔 + 滤芯 + 可选谐振腔/四分之一波长支管」建模：膨胀腔 TLexp = 10lg[1 + 0.25(m−1/m)²sin²(kL)]（式21，与传递矩阵解严格等价），滤芯按 JCA 多孔层传递矩阵 Tlayer = [cos(kct), jZcsin(kct); jsin(kct)/Zc, cos(kct)]，亥姆霍兹 f0 = (c/2π)[An/(V·Leff)]^(1/2)（Leff = ln + 0.85dn），四分之一波长 fq = (2k−1)c/(4L) 按支管传递矩阵并联接入。出气管侧每段可选普通出气管、波纹管或 Sullivan-Crocker 多腔穿孔消音器（σ = nh·dh²/(4·din·Lc)、ξ = R0 + jk0(tw + α0dh)、4×4 系统矩阵 A → Φ = exp(A·Lc) → 单腔 Tcav → 逐腔串联）。结果区给出系统平均/峰值 TL、250/500/1000/1500 Hz 固定频点 TL、各分部件平均 TL、谐振频率，并按第 6.5 节输出膨胀腔高频峰谷频率、峰值/高频平均 TL 与一阶高阶模态截止频率（fmax,n = (2n−1)c/(4L)、fmin,n = n·c/(2L)、TLmax = 10lg[1+0.25(m−1/m)²]、TLavg = 10lg[1+0.125(m−1/m)²]、fc,1 = 1.84c/(πD)，式24a~24f），同时绘制系统 TL - Frequency 曲线。高频峰来自腔长与波长的干涉：多腔宜错开长度、腔长公差建议 ±2%、按 1/3 倍频程平均评价。选定管型后输入区只显示该元件需要的参数，公式区同步切换为该元件的专用公式。',
  inputs: [
    ...compInputs,

    { key: 't', label: '介质温度', symbol: 't', unit: '℃', unitGroup: 'temperature', default: 20, required: true, group: SEC_RUN, description: '空气温度，用于声速 c ≈ 331.3 + 0.606t（摄氏温度）' },
    { key: 'rho0', label: '空气密度', symbol: 'ρ0', unit: 'kg/m³', unitGroup: 'density', default: 1.205, min: 0, required: true, group: SEC_RUN, description: '常温常压 20 ℃ 约 1.205 kg/m³；高温进气按实际密度修正' },
    { key: 'fmin', label: '频率下限', symbol: 'f_min', unit: 'Hz', default: 20, min: 0, required: true, group: SEC_RUN, description: 'TL 曲线与平均值的频带下限，进气噪声通常关注 20~2000 Hz' },
    { key: 'fmax', label: '频率上限', symbol: 'f_max', unit: 'Hz', default: 2000, min: 0, required: true, group: SEC_RUN, description: 'TL 曲线与平均值的频带上限' },
    ...withGroup(jcaInputs, SEC_JCA),
    { key: 'mu', label: '空气动力粘度', symbol: 'μ', unit: 'Pa·s', unitGroup: 'dynamicViscosity', default: 1.81e-5, min: 0, required: true, group: SEC_MED, description: '20 ℃ 空气约 1.81×10⁻⁵ Pa·s；也可切换为 mPa·s 输入 0.0181' },
    { key: 'nPr', label: '空气普朗特数', symbol: 'N_pr', unit: '-', unitGroup: 'dimensionless', default: 0.71, min: 0, required: true, group: SEC_MED, description: '常温空气约 0.71，用于 JCA 热损耗项（式11）' },
    { key: 'gam', label: '比热比', symbol: 'γ', unit: '-', unitGroup: 'dimensionless', default: 1.4, min: 0, required: true, group: SEC_MED, description: '空气比热比，常温取 1.4' },
    { key: 'pAtm', label: '大气压力', symbol: 'P_0', unit: 'Pa', unitGroup: 'pressure', default: 101325, min: 0, required: true, group: SEC_MED, description: '用于 Keq = γP0/[γ − (γ−1)A]（式10）' },
    { key: 'M1', label: '主管马赫数（多腔消音器）', symbol: 'M1', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, max: 0.15, required: true, group: SEC_MED, description: '仅多腔穿孔消音器使用：0 表示无气流（式25/26）；有气流时按 CG 修正（式26/28）' },
    { key: 'R0', label: '穿孔阻性常数（多腔消音器）', symbol: 'R_0', unit: '-', unitGroup: 'dimensionless', default: 0.0055, min: 0, required: true, group: SEC_MED, description: '仅多腔穿孔消音器使用：ξ 的实部，建议取值 0.0055（±20%）' },

    ...withGroup(inInputs, SEC_IN),

    { key: 'dBoxIn', label: '空滤器进口管直径', symbol: 'd_box,in', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, required: true, group: SEC_BOX, description: '膨胀腔进口管直径，决定进口截面突变面积比 m = (D_chamber/d_box,in)²' },
    { key: 'dBoxOut', label: '空滤器出口管直径', symbol: 'd_box,out', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, required: true, group: SEC_BOX, description: '膨胀腔出口管直径，可与进口不同；膨胀腔到出口管按截面突变（式5）接入' },
    { key: 'dBoxCh', label: '空滤器腔体直径', symbol: 'D_chamber', unit: 'mm', unitGroup: 'diameter', default: 200, min: 0, required: true, group: SEC_BOX, description: '膨胀腔腔体直径，须不小于进出口管直径' },
    { key: 'LBox', label: '空滤器腔体长度', symbol: 'L_airbox', unit: 'mm', unitGroup: 'length', default: 300, min: 0, required: true, group: SEC_BOX, description: '膨胀腔有效长度，决定 TL 峰值位置 f ≈ (2n−1)c/(4L)' },
    { key: 'Vh', label: '谐振腔容积', symbol: 'V', unit: 'L', unitGroup: 'volume', default: 0.5, min: 0, showIf: { key: 'hOn', min: 1, max: 1 }, group: SEC_BOX, description: '仅谐振腔需要：腔体容积 V，示例 0.5 L = 5×10⁻⁴ m³' },
    { key: 'ln', label: '谐振腔颈长', symbol: 'l_n', unit: 'mm', unitGroup: 'length', default: 30, min: 0, showIf: { key: 'hOn', min: 1, max: 1 }, group: SEC_BOX, description: '仅谐振腔需要：颈口长度 l_n，Leff = l_n + 0.85d_n' },
    { key: 'dn', label: '谐振腔颈径', symbol: 'd_n', unit: 'mm', unitGroup: 'diameter', default: 20, min: 0, showIf: { key: 'hOn', min: 1, max: 1 }, group: SEC_BOX, description: '仅谐振腔需要：颈口直径 d_n，An = πd_n²/4' },
    { key: 'Lq', label: '支管长度', symbol: 'L_b', unit: 'mm', unitGroup: 'length', default: 400, min: 0, showIf: { key: 'qOn', min: 1, max: 1 }, group: SEC_BOX, description: '仅四分之一波长支管需要：支管长度 L_b' },
    { key: 'dq', label: '支管直径', symbol: 'd_b', unit: 'mm', unitGroup: 'diameter', default: 35, min: 0, showIf: { key: 'qOn', min: 1, max: 1 }, group: SEC_BOX, description: '仅四分之一波长支管需要：支管直径 d_b，Sb = πd_b²/4' },
    ...withGroup(filterInputs, SEC_FIL),

    ...withGroup(outInputs, SEC_OUT),
  ],
  outputs: outputList,
  latex: [
    { label: '传递损失定义', tex: 'TL = 10\\lg\\frac{W_{in}}{W_{out}}' },
    { label: '四端参数传递损失（[p, ρcu] 状态，Z0 = 1）', tex: 'TL = 20\\lg\\frac{\\left|T_{11}+T_{12}+T_{21}+T_{22}\\right|}{2} + 10\\lg\\frac{S_{in}}{S_{out}}' },
    { label: '系统总传递矩阵（按气流方向级联，式32）', tex: 'T_{sys} = T_{in}\\,T_{bellows}\\,T_{braid}\\,T_{airbox}\\,T_{muffler}\\,T_{out}' },
    { label: '截面突变与等截面直管（式5/6）', tex: 'T_{area} = \\begin{bmatrix}1 & 0 \\\\ 0 & S_d/S_u\\end{bmatrix},\\qquad T_{duct} = \\begin{bmatrix}\\cos(kL) & j\\sin(kL) \\\\ j\\sin(kL) & \\cos(kL)\\end{bmatrix}' },
    { label: '渐变管离散与级联（式6a~6c，D_in ≠ D_out 时启用）', tex: '\\frac{1}{S}\\frac{d}{dx}\\left(S\\frac{dp}{dx}\\right)+k^2p=0,\\quad D_i=D_{in}+(D_{out}-D_{in})\\frac{i-0.5}{N},\\quad T_{taper}=T_{area}(S_N\\to S_{out})\\,T_{duct}(D_N,\\Delta L)\\cdots T_{duct}(D_1,\\Delta L)\\,T_{area}(S_{in}\\to S_1)' },
    { label: '渐变管离散约束与截止频率（式6d）', tex: 'N\\ge 10,\\qquad \\Delta L=\\frac{L}{N}\\le\\frac{\\lambda_{\\min}}{10},\\qquad f_c=\\frac{1.84\\,c}{\\pi D_{\\min}}' },
    { label: '编织管 JCA 等效流体（式9~12）', tex: '\\rho_{eq}=\\alpha_\\infty\\rho_0\\left[1+\\frac{\\sigma_f}{j\\omega\\rho_0\\alpha_\\infty}\\sqrt{1+j\\frac{4\\alpha_\\infty^2\\eta\\rho_0\\omega}{\\sigma_f^2\\Lambda^2\\varphi^2}}\\right],\\quad K_{eq}=\\frac{\\gamma P_0}{\\gamma-(\\gamma-1)A},\\quad Z_c=\\sqrt{\\rho_{eq}K_{eq}},\\quad k_c=\\omega\\sqrt{\\rho_{eq}/K_{eq}}' },
    ...segTypeLatex,
    { label: '空滤器膨胀腔（式21）', tex: 'm = \\frac{S_2}{S_1},\\qquad TL_{exp} = 10\\lg\\left[1+0.25\\left(m-\\frac{1}{m}\\right)^2\\sin^2(kL)\\right]' },
    { label: '膨胀腔峰谷频率与峰值（式24a~24d）', tex: '\\lambda=\\frac{c}{f},\\quad kL=\\frac{2\\pi L}{\\lambda},\\qquad f_{min,n}=\\frac{nc}{2L},\\quad f_{max,n}=\\frac{(2n-1)c}{4L},\\quad TL_{max}=10\\lg\\left[1+0.25\\left(m-\\frac{1}{m}\\right)^2\\right]' },
    { label: '膨胀腔高频平均与高阶模态截止（式24e/24f）', tex: 'TL_{avg}=10\\lg\\left[1+0.125\\left(m-\\frac{1}{m}\\right)^2\\right],\\qquad f_{c,1}=\\frac{1.84c}{\\pi D}' },
    { label: '滤芯多孔层（JCA + 传递矩阵，式13）', tex: 'T_{layer} = \\begin{bmatrix}\\cos(k_c t_f) & jZ_c\\sin(k_c t_f)\\\\ j\\sin(k_c t_f)/Z_c & \\cos(k_c t_f)\\end{bmatrix}' },
    { label: '亥姆霍兹谐振腔（式22）', tex: 'f_0 = \\frac{c}{2\\pi}\\sqrt{\\frac{A_n}{V L_{eff}}},\\qquad L_{eff}=l_n+0.85d_n', showIf: { key: 'hOn', min: 1, max: 1 } },
    { label: '四分之一波长支管（式23/24）', tex: 'f_q = \\frac{(2k-1)c}{4L},\\qquad TL_{branch} = 20\\lg\\left|1+\\frac{S_p}{2S_b\\zeta_b}\\right|', showIf: { key: 'qOn', min: 1, max: 1 } },
    ...branchLatex,
    { label: '波纹管逐波节级联（式8）', tex: 'N_w = \\mathrm{round}(L/w),\\qquad T_{node} = T_{area}(m_w)\\,T_{duct}(w)\\,T_{area}(1/m_w)' },
    { label: '传递损失曲线采样', tex: 'f \\in [f_{\\min}, f_{\\max}]\\ \\text{均分 200 份},\\qquad TL_{avg} = \\frac{1}{N}\\sum_i TL(f_i)' },
  ],
  sensitivity: false,
  assumptions: [
    '公式与《进气系统传递损失计算（进气管-波纹管-编织管-空滤器-出气管-消音器）》一致：统一采用 [p, ρcu] 状态变量（Z0 = 1），TL = 20lg(|T11+T12+T21+T22|/2) + 10lg(Sin/Sout)；等截面进出口时面积项为 0，与文档式(3) 完全一致，截面不同时该面积项对应式(33) 的 10lg(Si/So)',
    '目标是把传递损失（元件本身属性，与声源/末端无关）与插入损失区分开：本公式只算 TL，插入损失还需计入声源阻抗与末端反射，不能直接互换',
    '每个管道元件都同时给出进口直径 D_in 与出口直径 D_out：进气管、波纹管、编织管、空滤器进出口、出气管、消音器进出口均按式(6b)(6c) 处理，不能用一个平均直径代替全段。D_in = D_out 时按等截面直管退化处理（式6）',
    '渐变管按 Webster 方程（式6a）离散：S(x) = πD(x)²/4，D_i = D_in + (D_out − D_in)(i − 0.5)/N；每段子圆柱取自身直径建立传递矩阵，段间按局部截面突变（式5）接入。离散约束为 N ≥ 10 且 ΔL = L/N ≤ λ_min/10（λ_min = c/f_max），满足时与精确锥形管理论误差 < 1 dB；本实现取 N = max(10, ⌈10Lf_max/c⌉) 并限制在 40 以内以控制计算量',
    '波纹管与编织管在渐变段中同样逐子段处理：波纹管每个子段的直径为渐变插值值、波节数按 L/w 给定；编织管壁面耗散因子 K = Rw/(Rw²+Xw²) 逐频点只算一次，各子段按自身直径取 α_i = 2K/D_i 后按复波数级联',
    '旁支消音器接在所在管段的下游端，按该处局部截面（该段出口内径）归一化支管阻抗；多腔穿孔消音器本体按穿孔主管进口内径建模，进出口直径不同时在出口端按截面突变接入，不改变其内部穿孔参数定义',
    '渐变段最小直径 D_min 决定平面波假设的上限：f_c = 1.84c/(πD_min)（式6d），计算频率超过该值时一维结果不可信，应以三维声学或实测为准',
    '波纹管按「一串短膨胀腔」处理：每个波节取 mw = (D+2h)²/D²、长度 w，单节 TLw = 10lg[1 + 0.25(mw−1/mw)²sin²(kw)]（式8）；波节数 N = round(L/w)，余量并入每节长度。波纹管本体 TL 通常 1~3 dB，其声学贡献远小于隔振贡献',
    '编织管用 JCA 五参数（σ_f=240 kPa·s/m²、φ=0.35、α∞=2.5、Λ=0.027 mm、Λ′=0.054 mm）算等效流体，再由壁面阻抗得 ζw = Rw + jXw，按 α = (2/D)·Rw/(Rw²+Xw²)（式17）与 TL ≈ 8.686·α·L（式18）计算；本实现按复波数 kx = k0 − jα 级联，单件时与式18 严格一致',
    '编织管校核：按论文样件（L=145 mm、D=49.36 mm、t=2.7 mm）20~2000 Hz 的频带平均 TL 本实现约 18.4 dB（论文约 16.4 dB，580 Hz 附近论文约 20 dB、本实现约 19.5 dB）；差异来自式17/18 的端部与背衬简化，工程定型前应按实测两负载法标定',
    'JCA 参数必须按材料标定，Maa 简化式（式19/20）只在缺少五参数时估算，本模块未采用；若某段改用 Maa 模型，需自行代入等效参数后再与本模型对比',
    '空滤器按「膨胀腔（式21）+ 滤芯（JCA 多孔层传递矩阵）+ 可选亥姆霍兹谐振腔（式22）+ 可选四分之一波长支管（式23/24）」建模；文档给出的膨胀腔 TL = 10lg[1+0.25(m−1/m)²sin²(kL)] 与传递矩阵解严格等价，本实现用传递矩阵以便与其他元件级联',
    '膨胀腔高频峰谷规律（式24a~24e）：峰值 fmax,n = (2n−1)c/(4L)、谷值 fmin,n = n·c/(2L)，峰谷交替、间隔约 c/(2L)；峰值 TLmax = 10lg[1+0.25(m−1/m)²]、高频平均 TLavg = 10lg[1+0.125(m−1/m)²]（sin² 取 1/2）。峰值不随阶次升高而增大，只是频率越高越密；这种「高频共振附加消音」来自腔长与波长的干涉，不是材料吸声',
    '高频峰对腔长、温度与加工公差敏感：腔长差 5% 峰位约偏 5%，建议腔长公差控制在 ±2%；c 随温度升高而增大、峰位向高频偏移，按最高工作温度校核峰位，避免峰移出目标频段',
    '多腔/分段结构：各腔长度应错开（避免成整数倍），使高频峰互相填补形成宽频带；若各腔等长，峰谷同步，反而出现深谷。按目标频率反解腔长可用 L = (2n−1)c/(4f_target)，让峰值落在目标噪声频率上',
    '本式按空滤器腔体直径估算一阶高阶模态截止 f_c,1 = 1.84c/(πD_chamber)（式24f，最保守）：f > f_c,1 后平面波假设失效，膨胀腔会出现三维模态峰，也可能因模态耦合出现低谷，工程上以实测或 FEM 为准',
    '评价高频消音效果建议按 1/3 倍频程能量平均，避免单频峰造成「消音很好」的误判；穿孔腔的 Helmholtz 峰（低频）与膨胀腔的高频峰互补，可覆盖更宽频带',
    '滤芯按 JCA 多孔层法向传递矩阵计算，滤材的 σ_f、φ、α∞、Λ、Λ′ 建议按本滤材实测数据取值（默认值仅为典型量级），不能套用编织管参数；滤芯厚度取 0 时按不装滤芯处理',
    '旁支消音器按「系统组成」选择：进气管已启用各段（1~nIn）、出气管已启用各段（1~nOut）每段先选旁支类型（无 / 四分之一波长管 / 亥姆霍兹消音器，默认无），选定后选择数量 N（1/2/3…），空滤器另用开关选择是否设置；N 个相同旁支在该段下游端按集中元件并联接入，等效归一化阻抗取 ζb/N（传递矩阵 [1, 0; N/ζb, 1]），段长取 0 时旁支仍接入。旁支按集中元件处理、不计轴向位置分布，也未计入旁支自身的壁面阻尼与气流影响',
    '进气管与出气管的分段数（各 1~5 段）由操作者在「系统组成」中选定：只对前 nIn / nOut 段建模，超出段数的段不参与计算；各段管型（进气管/波纹管/编织管、出气管/波纹管/多腔穿孔消音器）与旁支类型逐段独立选择，参数区与公式区随选择展开',
    '旁支只并入所在管段的段矩阵（系统 TL 与 tlInAvg/tlOutAvg），不改变编织管、波纹管、多腔消音器与空滤器总分部件的独立平均，便于把旁支贡献与本体贡献分开评估',
    '亥姆霍兹与四分之一波长支管按并联支管传递矩阵 [1,0; 1/ζb, 1] 接入，ζb 为支管输入阻抗相对主管特性阻抗的归一化值；支管共振频点上 ζb → 0，TL 出现理论峰值，采样点未落在共振频率时峰值会略低',
    '多腔穿孔消音器按 Sullivan-Crocker / Munjal 一维耦合模型：σ = nh·dh²/(4·din·Lc)、ξ = R0 + jk0(tw + α0dh)、4×4 矩阵 A → Φ = exp(A·Lc) → Tcav → 逐腔串联（式25~31）；R0 默认 0.0055 为建议取值，未用实测校核，结果仅供参考',
    '多腔消音器的孔口是声学耦合，不是流阻；声学 TL 与流动阻力应分开计算（阻力见 fluid.intakeSystemResistance）',
    '多腔穿孔消音器在本模型下呈带通特性：约 2 kHz 以下 TL 接近 0，峰值出现在 2~3 kHz（与既有 acoustics.muffler.multiCavity 公式为同一实现、同一结论）；因此 20~2000 Hz 频带内 tlSilAvg 接近 0 属模型特性而非漏算，评估消音器效果应在含峰值的频段内取平均',
    '温度对声速影响明显：c ≈ 331.3 + 0.606t，计算前按温度修正；本模型未计气流平均流与温度梯度对传递矩阵的影响（多腔消音器可另填 M1）',
    '一维平面波假设：截面尺寸须远小于波长（一般 D < λ/4~λ/2），忽略高阶模态、结构振动与非线性大振幅效应；高频段结果应结合三维声学或实测',
    '系统级联不考虑元件之间的近场耦合与安装方向差异；TL 不等同于整车进气口噪声降噪量，定型前须做两负载法测量（ASTM E2611 / ISO 10534-2）或整机 NVH 验证',
    '频带平均 TL 为 201 点算术平均，与按 1/3 倍频程能量平均的口径不同；对比论文/实测数据时应统一平均方式',
    '本公式不提供参数敏感性分析：求解需逐频率扫描并逐腔求矩阵指数，计算量大，且腔数变化会改变计算结构',
  ],
  solve(v) {
    modelAt = null;
    const empty = {
      c: NaN, tl_avg: NaN, tl_max: NaN, f_peak: NaN,
      tl250: NaN, tl500: NaN, tl1000: NaN, tl1500: NaN,
      tlInAvg: NaN, tlBoxAvg: NaN, tlOutAvg: NaN, tlBraidAvg: NaN, tlBellowsAvg: NaN, tlSilAvg: NaN,
      fExpPeak1: NaN, fExpMin1: NaN, tlExpMax: NaN, tlExpAvg: NaN, fcMode1: NaN, fcDuct: NaN,
      fH: NaN, fQ: NaN,
    };

    const pos = (x: number) => Number.isFinite(x) && x > 0;
    const nn = (x: number) => Number.isFinite(x) && x >= 0;

    if (!pos(v.t) || !pos(v.rho0) || !nn(v.fmin) || !(v.fmax > v.fmin) ||
        !pos(v.mu) || !pos(v.nPr) || !(v.gam > 1) || !pos(v.pAtm) ||
        !pos(v.sigmaF) || !pos(v.phiJ) || !(v.alphaInf >= 1) || !pos(v.lambdaV) || !pos(v.lambdaT) ||
        !nn(v.M1) || !nn(v.R0)) return empty;

    // 分段数由操作者选择：仅校验已启用段（i ≤ nIn / nOut），超出段数的参数不参与计算
    const nIn = Math.round(v.nIn ?? 3);
    const nOut = Math.round(v.nOut ?? 3);
    if (!(nIn >= 1 && nIn <= SEG_MAX) || !(nOut >= 1 && nOut <= SEG_MAX)) return empty;

    for (let i = 1; i <= nIn; i++) {
      if (!(v[`t${i}`] >= 1 && v[`t${i}`] <= 3)) return empty;
      if (!pos(v[`D${i}`]) || !pos(v[`Dout${i}`] ?? v[`D${i}`]) || !nn(v[`L${i}`]) || !nn(v[`h${i}`]) || !nn(v[`w${i}`]) || !nn(v[`twB${i}`])) return empty;
      // 旁支：类型 0 无、1 四分之一波长管、2 亥姆霍兹消音器；选定后数量 1~6 并校验其几何
      const br = Math.round(v[`br${i}`] ?? 0);
      const brN = Math.round(v[`brN${i}`] ?? 0);
      if (!(br >= 0 && br <= 2)) return empty;
      if (br > 0 && !(brN >= 1 && brN <= 6)) return empty;
      if (br === 2 && (!pos(v[`hbV${i}`]) || !nn(v[`hbLn${i}`]) || !pos(v[`hbDn${i}`]))) return empty;
      if (br === 1 && (!pos(v[`qwL${i}`]) || !pos(v[`qwD${i}`]))) return empty;
    }
    for (let i = 1; i <= nOut; i++) {
      if (!(v[`o${i}`] >= 1 && v[`o${i}`] <= 3)) return empty;
      if (!pos(v[`Do${i}`]) || !pos(v[`Douto${i}`] ?? v[`Do${i}`]) || !nn(v[`Lo${i}`]) || !nn(v[`hO${i}`]) || !nn(v[`wO${i}`])) return empty;
      // 多腔消音器参数只在该段选为消音器时校验，未使用段的默认值不参与计算
      if (v[`o${i}`] === 3) {
        const nc = Math.round(v[`nc${i}`] ?? 0);
        if (!(nc >= 1 && nc <= 5)) return empty;
        if (!pos(v[`DoutS${i}`]) || !pos(v[`dhS${i}`]) || !pos(v[`nhS${i}`]) || !pos(v[`twS${i}`]) || !nn(v[`ctS${i}`])) return empty;
        for (let j = 1; j <= nc; j++) if (!nn(v[`Lc${i}_${j}`])) return empty;
      }
      const bro = Math.round(v[`bro${i}`] ?? 0);
      const broN = Math.round(v[`broN${i}`] ?? 0);
      if (!(bro >= 0 && bro <= 2)) return empty;
      if (bro > 0 && !(broN >= 1 && broN <= 6)) return empty;
      if (bro === 2 && (!pos(v[`hbVo${i}`]) || !nn(v[`hbLno${i}`]) || !pos(v[`hbDno${i}`]))) return empty;
      if (bro === 1 && (!pos(v[`qwLo${i}`]) || !pos(v[`qwDo${i}`]))) return empty;
    }

    const dBOut = v.dBoxOut ?? v.dBoxIn;
    if (!pos(v.dBoxIn) || !pos(dBOut) || !(v.dBoxCh >= v.dBoxIn) || !(v.dBoxCh >= dBOut) || !nn(v.LBox)) return empty;
    if (!(v.hOn === 0 || v.hOn === 1) || !(v.qOn === 0 || v.qOn === 1)) return empty;
    if (v.hOn === 1 && (!pos(v.Vh) || !nn(v.ln) || !pos(v.dn))) return empty;
    if (v.qOn === 1 && (!pos(v.Lq) || !pos(v.dq))) return empty;
    if (!nn(v.tFil) || !pos(v.sigmaFil) || !pos(v.phiFil) || !(v.alphaFil >= 1) || !pos(v.lambdaVFil) || !pos(v.lambdaTFil)) return empty;

    const c = 331.3 + 0.606 * (v.t - 273.15);
    if (!(c > 0)) return empty;
    const med: Medium = { rho0: v.rho0, c0: c, mu: v.mu, nPr: v.nPr, gam: v.gam, pAtm: v.pAtm };
    const braidP: JcaParams = {
      sigma: v.sigmaF, phi: v.phiJ, alphaInf: v.alphaInf,
      lambdaV: v.lambdaV, lambdaT: v.lambdaT,
    };
    const filtP: JcaParams = {
      sigma: v.sigmaFil, phi: v.phiFil, alphaInf: v.alphaFil,
      lambdaV: v.lambdaVFil, lambdaT: v.lambdaTFil,
    };

    const area = (d: number) => (Math.PI * d * d) / 4;
    /** 已启用段号（进气管 1…nIn、出气管 1…nOut），超出段数不参与建模 */
    const inIdx = Array.from({ length: nIn }, (_, k) => k + 1);
    const outIdx = Array.from({ length: nOut }, (_, k) => k + 1);
    /** 每段进口/出口内径（SI，m）：段内 D_in ≠ D_out 时按渐变管离散（式6b/6c） */
    const dinIn = inIdx.map((i) => v[`D${i}`]);
    const doutIn = inIdx.map((i) => v[`Dout${i}`] ?? v[`D${i}`]);
    const dinOut = outIdx.map((i) => v[`Do${i}`]);
    const doutOut = outIdx.map((i) => v[`Douto${i}`] ?? v[`Do${i}`]);
    const aInI = dinIn.map(area);
    const aInO = doutIn.map(area);
    const aOutI = dinOut.map(area);
    const aOutO = doutOut.map(area);

    /** 集中旁支（N 个相同元件并联）：T = [1, 0; N/ζb, 1]，ζb 为相对主管特性阻抗的归一化值 */
    const branchMat = (zeta: Cx, n: number): Cx[][] => {
      // 共振点 ζb → 0，做极小值保护，避免矩阵元素溢出或出现 NaN
      const mag = Math.hypot(zeta[0], zeta[1]);
      const z: Cx = mag < 1e-6
        ? [zeta[0] === 0 ? 1e-6 : zeta[0], zeta[1] === 0 ? 1e-6 : zeta[1]]
        : zeta;
      const inv = cDiv(cx(n, 0), z) ?? cx(0);
      return [[cx(1), cx(0)], [inv, cx(1)]];
    };

    /** 亥姆霍兹旁支：ζb = j[ωρ0Leff/An − ρ0c0²/(ωV)]·S/(ρ0c0)（式22） */
    const helmholtzBranch = (f: number, S: number, V: number, ln: number, dn: number, n: number): Cx[][] => {
      const w = 2 * Math.PI * f;
      const an = area(dn);
      const leff = ln + 0.85 * dn;
      const zb: Cx = [0, (w * v.rho0 * leff) / an - (v.rho0 * c * c) / (w * V)];
      return branchMat(cMul(zb, cx(S / (v.rho0 * c))), n);
    };

    /** 四分之一波长支管：ζb = −j(S/Sb)cot(kL)（式23/24） */
    const quarterBranch = (k0: number, S: number, Sb: number, L: number, n: number): Cx[][] => {
      const kL = k0 * L;
      const sn = Math.sin(kL);
      let zIm = -(S / Sb) * (Math.cos(kL) / sn);
      if (!Number.isFinite(zIm)) zIm = -(S / Sb) * 1e12;
      return branchMat([0, zIm], n);
    };

    /** 进气管段旁支矩阵：选定旁支类型后在该段下游端并联 N 个（段长取 0 时仍接入） */
    const inBranchMat = (i: number, f: number, k0: number): Cx[][] => {
      if (i > nIn) return eye2();
      // 旁支接在该段下游端，按该处局部截面（出口内径）归一化
      const S = aInO[i - 1];
      let T = eye2();
      const br = Math.round(v[`br${i}`] ?? 0);
      const brN = Math.round(v[`brN${i}`] ?? 0);
      if (br === 2 && brN > 0) T = matMul(T, helmholtzBranch(f, S, v[`hbV${i}`], v[`hbLn${i}`], v[`hbDn${i}`], brN));
      if (br === 1 && brN > 0) T = matMul(T, quarterBranch(k0, S, area(v[`qwD${i}`]), v[`qwL${i}`], brN));
      return T;
    };

    /** 出气管段旁支矩阵：选定旁支类型后在该段下游端并联 N 个（段长取 0 时仍接入） */
    const outBranchMat = (i: number, f: number, k0: number): Cx[][] => {
      if (i > nOut) return eye2();
      // 旁支接在该段下游端，按该处局部截面（出口内径）归一化
      const S = aOutO[i - 1];
      let T = eye2();
      const bro = Math.round(v[`bro${i}`] ?? 0);
      const broN = Math.round(v[`broN${i}`] ?? 0);
      if (bro === 2 && broN > 0) T = matMul(T, helmholtzBranch(f, S, v[`hbVo${i}`], v[`hbLno${i}`], v[`hbDno${i}`], broN));
      if (bro === 1 && broN > 0) T = matMul(T, quarterBranch(k0, S, area(v[`qwDo${i}`]), v[`qwLo${i}`], broN));
      return T;
    };

    /** 进气管段本体矩阵（不含旁支；type 1 直管、2 波纹管、3 编织管，均按 D_in→D_out 渐变离散） */
    const inSegBaseMat = (i: number, f: number, k0: number): Cx[][] => {
      if (i > nIn) return eye2();
      const din = dinIn[i - 1];
      const dout = doutIn[i - 1];
      const L = v[`L${i}`];
      const type = v[`t${i}`];
      if (!(L > 0)) return eye2();
      const straight = (_D: number, l: number): Mat2 => ductMat(l, cx(k0 * l));
      if (type === 1) return taperMat(din, dout, L, c, v.fmax, straight);
      if (type === 2) {
        const h = v[`h${i}`];
        const w = v[`w${i}`];
        if (!(h > 0) || !(w > 0)) return taperMat(din, dout, L, c, v.fmax, straight);
        // 每个波节按「扩到 D+2h → 直管 → 缩回」的短膨胀腔处理（式7/8），直径随渐变段插值
        const wave = (D: number, l: number): Mat2 => {
          const m = ((D + 2 * h) * (D + 2 * h)) / (D * D);
          return matMul(matMul(areaMat(m, 1), ductMat(l, cx(k0 * l))), areaMat(1, m));
        };
        return taperMat(din, dout, L, c, v.fmax, wave, Math.max(1, Math.round(L / w)));
      }
      const tw = v[`twB${i}`];
      // 壁面耗散因子逐频点只算一次；各子段按自身直径取 α_i = 2K/D_i（式17），复波数级联
      const kd = braidDissipation(f, tw, med, braidP);
      const braid = (D: number, l: number): Mat2 => ductMat(l, cx(k0 * l, -((2 * kd) / D) * l));
      return taperMat(din, dout, L, c, v.fmax, braid);
    };

    /** 出气管段本体矩阵（不含旁支；type 1 直管、2 波纹管、3 多腔穿孔消音器） */
    const outSegBaseMat = (i: number, f: number, k0: number): Cx[][] => {
      if (i > nOut) return eye2();
      const din = dinOut[i - 1];
      const dout = doutOut[i - 1];
      const L = v[`Lo${i}`];
      const type = v[`o${i}`];
      if (!(L > 0)) return eye2();
      const straight = (_D: number, l: number): Mat2 => ductMat(l, cx(k0 * l));
      if (type === 1) return taperMat(din, dout, L, c, v.fmax, straight);
      if (type === 2) {
        const h = v[`hO${i}`];
        const w = v[`wO${i}`];
        if (!(h > 0) || !(w > 0)) return taperMat(din, dout, L, c, v.fmax, straight);
        const wave = (D: number, l: number): Mat2 => {
          const m = ((D + 2 * h) * (D + 2 * h)) / (D * D);
          return matMul(matMul(areaMat(m, 1), ductMat(l, cx(k0 * l))), areaMat(1, m));
        };
        return taperMat(din, dout, L, c, v.fmax, wave, Math.max(1, Math.round(L / w)));
      }
      const nc = Math.round(v[`nc${i}`]);
      const lcs: number[] = [];
      for (let j = 1; j <= nc; j++) lcs.push(v[`Lc${i}_${j}`]);
      const m = mufflerMat(
        f, c, din, v[`DoutS${i}`], v[`dhS${i}`], v[`nhS${i}`], v[`twS${i}`],
        v[`ctS${i}`], lcs, v.M1, v.R0,
      );
      if (!m) return eye2();
      // 多腔消音器本体按穿孔主管进口内径建模，进出口直径不同时在出口端按截面突变接入
      return Math.abs(dout / din - 1) > 1e-9 ? matMul(areaMat(area(dout), area(din)), m) : m;
    };

    /** 段矩阵 = 旁支（下游端）· 本体 */
    const inSegMat = (i: number, f: number, k0: number): Cx[][] =>
      matMul(inBranchMat(i, f, k0), inSegBaseMat(i, f, k0));
    const outSegMat = (i: number, f: number, k0: number): Cx[][] =>
      matMul(outBranchMat(i, f, k0), outSegBaseMat(i, f, k0));

    /** 空滤器总成矩阵：谐振腔/支管 → 膨胀腔（含滤芯层） */
    const boxMat = (f: number, k0: number): Cx[][] | null => {
      const sIn = area(v.dBoxIn);
      const sOut = area(v.dBoxOut ?? v.dBoxIn);
      const sCh = area(v.dBoxCh);
      const tFil = v.tFil;
      let T = areaMat(sCh, sIn);
      T = matMul(T, ductMat(v.LBox / 2, cx(k0 * v.LBox / 2)));
      if (tFil > 0) {
        const j = jca(f, med, filtP);
        const kt = cMul(j.kc, cx(tFil));
        const cs = cCos(kt);
        const sn = cSin(kt);
        const zcN = cDiv(j.zc, cx(v.rho0 * c)) ?? cx(1);
        const layer: Cx[][] = [
          [cs, cMul(cx(0, 1), cMul(zcN, sn))],
          [cMul(cx(0, 1), cDiv(sn, zcN) ?? cx(1)), cs],
        ];
        T = matMul(T, layer);
      }
      T = matMul(T, ductMat(v.LBox / 2, cx(k0 * v.LBox / 2)));
      T = matMul(T, areaMat(sOut, sCh));

      // 亥姆霍兹谐振腔旁支：ζb = Zb·S/(ρ0c0)，Zb = jωρ0Leff/An + ρ0c0²/(jωV)
      if (v.hOn === 1) {
        const w = 2 * Math.PI * f;
        const an = area(v.dn);
        const leff = v.ln + 0.85 * v.dn;
        const zb: Cx = [
          0,
          (w * v.rho0 * leff) / an - (v.rho0 * c * c) / (w * v.Vh),
        ];
        const zeta = cMul(zb, cx(sIn / (v.rho0 * c)));
        const inv = cDiv(cx(1), zeta);
        if (!inv) return null;
        T = matMul([[cx(1), cx(0)], [inv, cx(1)]], T);
      }

      // 四分之一波长支管旁支：ζb = −j(S/Sb)cot(kL)
      if (v.qOn === 1) {
        const sb = area(v.dq);
        const kL = k0 * v.Lq;
        const cot = Math.cos(kL) / Math.sin(kL);
        const zeta: Cx = [0, -(sIn / sb) * cot];
        const inv = cDiv(cx(1), zeta);
        if (!inv) return null;
        T = matMul([[cx(1), cx(0)], [inv, cx(1)]], T);
      }
      return T;
    };

    /** 单频点：系统 TL 与各分部件 TL */
    const at = (f: number) => {
      // f = 0 时 JCA/旁支阻抗出现除以零，按无声衰减处理（TL = 0）
      if (!(f > 0)) return { sys: 0, in: 0, box: 0, out: 0, braid: NaN, bel: NaN, sil: NaN };
      const k0 = (2 * Math.PI * f) / c;
      // 参与计算的管段：长度 > 0，或该段设置了旁支（长度 0 时旁支仍按集中元件接入）
      const inHasBranch = (i: number) => Math.round(v[`br${i}`] ?? 0) > 0;
      const outHasBranch = (i: number) => Math.round(v[`bro${i}`] ?? 0) > 0;
      const inAct = inIdx.filter((i) => v[`L${i}`] > 0 || inHasBranch(i));
      const outAct = outIdx.filter((i) => v[`Lo${i}`] > 0 || outHasBranch(i));
      const sBox = area(v.dBoxIn);
      const sBoxOut = area(v.dBoxOut ?? v.dBoxIn);
      const inTerm = inAct.length ? aInI[inAct[0] - 1] : sBox;
      const inLast = inAct.length ? aInO[inAct[inAct.length - 1] - 1] : sBox;
      const outFirst = outAct.length ? aOutI[outAct[0] - 1] : sBoxOut;
      const outTerm = outAct.length ? aOutO[outAct[outAct.length - 1] - 1] : sBoxOut;

      const inMats = inIdx.map((i) => inSegMat(i, f, k0));
      const inBases = inIdx.map((i) => inSegBaseMat(i, f, k0));
      // 进气管：活跃段级联，前段出口截面 → 后段进口截面按截面突变矩阵接入（式5）
      let tIn = eye2();
      for (let k = 0; k < inAct.length; k++) {
        const i = inAct[k];
        if (k > 0) {
          const prev = aInO[inAct[k - 1] - 1];
          if (Math.abs(aInI[i - 1] / prev - 1) > 1e-12) tIn = matMul(tIn, areaMat(aInI[i - 1], prev));
        }
        tIn = matMul(tIn, inMats[i - 1]);
      }
      if (Math.abs(sBox / inLast - 1) > 1e-12) tIn = matMul(tIn, areaMat(sBox, inLast));
      const inTl = tlOf(tIn, inTerm, inLast);

      // 仅编织管段 / 仅波纹管段（孤立元件，不含段间截面突变与旁支）
      let tBraid = eye2();
      let braidMin = NaN;
      let braidMax = NaN;
      for (const i of inIdx) {
        if (v[`t${i}`] === 3 && v[`L${i}`] > 0) {
          tBraid = matMul(tBraid, inBases[i - 1]);
          if (!Number.isFinite(braidMin)) braidMin = aInI[i - 1];
          braidMax = aInO[i - 1];
        }
      }
      const braidTl = Number.isFinite(braidMin) ? tlOf(tBraid, braidMin, braidMax) : NaN;

      let tBel = eye2();
      let belMin = NaN;
      let belMax = NaN;
      for (const i of inIdx) {
        if (v[`t${i}`] === 2 && v[`L${i}`] > 0) {
          tBel = matMul(tBel, inBases[i - 1]);
          if (!Number.isFinite(belMin)) belMin = aInI[i - 1];
          belMax = aInO[i - 1];
        }
      }
      const belTl = Number.isFinite(belMin) ? tlOf(tBel, belMin, belMax) : NaN;

      // 空滤器（进口/出口管直径可不同）
      const tBox = boxMat(f, k0);
      const boxTl = tBox ? tlOf(tBox, sBox, sBoxOut) : NaN;

      // 出气管：活跃段级联，段间与空滤器出口同样按截面突变处理
      const outMats = outIdx.map((i) => outSegMat(i, f, k0));
      const outBases = outIdx.map((i) => outSegBaseMat(i, f, k0));
      let tOut = eye2();
      for (let k = 0; k < outAct.length; k++) {
        const i = outAct[k];
        if (k === 0) {
          if (Math.abs(aOutI[i - 1] / sBoxOut - 1) > 1e-12) tOut = matMul(tOut, areaMat(aOutI[i - 1], sBoxOut));
        } else {
          const prev = aOutO[outAct[k - 1] - 1];
          if (Math.abs(aOutI[i - 1] / prev - 1) > 1e-12) tOut = matMul(tOut, areaMat(aOutI[i - 1], prev));
        }
        tOut = matMul(tOut, outMats[i - 1]);
      }
      const outTl = tlOf(tOut, outFirst, outTerm);

      let tSil = eye2();
      let silMin = NaN;
      let silMax = NaN;
      for (const i of outIdx) {
        if (v[`o${i}`] === 3 && v[`Lo${i}`] > 0) {
          tSil = matMul(tSil, outBases[i - 1]);
          if (!Number.isFinite(silMin)) silMin = aOutI[i - 1];
          silMax = aOutO[i - 1];
        }
      }
      const silTl = Number.isFinite(silMin) ? tlOf(tSil, silMin, silMax) : NaN;

      let tSys = tIn;
      if (tBox) tSys = matMul(tSys, tBox);
      tSys = matMul(tSys, tOut);
      return {
        sys: tlOf(tSys, inTerm, outTerm),
        in: inTl, box: boxTl, out: outTl, braid: braidTl, bel: belTl, sil: silTl,
      };
    };
    modelAt = (f: number) => at(f).sys;

    // 频带扫描
    const N = 200;
    const span = v.fmax - v.fmin;
    let nSys = 0;
    let cntIn = 0;
    let nBox = 0;
    let cntOut = 0;
    let nBraid = 0;
    let nBel = 0;
    let nSil = 0;
    let sumSys = 0;
    let sumIn = 0;
    let sumBox = 0;
    let sumOut = 0;
    let sumBraid = 0;
    let sumBel = 0;
    let sumSil = 0;
    let tlMax = -Infinity;
    let fPeak = NaN;
    for (let i = 0; i <= N; i++) {
      const f = v.fmin + (i * span) / N;
      const r = at(f);
      if (Number.isFinite(r.sys)) {
        sumSys += r.sys;
        nSys++;
        if (r.sys > tlMax) {
          tlMax = r.sys;
          fPeak = f;
        }
      }
      if (Number.isFinite(r.in)) { sumIn += r.in; cntIn++; }
      if (Number.isFinite(r.box)) { sumBox += r.box; nBox++; }
      if (Number.isFinite(r.out)) { sumOut += r.out; cntOut++; }
      if (Number.isFinite(r.braid)) { sumBraid += r.braid; nBraid++; }
      if (Number.isFinite(r.bel)) { sumBel += r.bel; nBel++; }
      if (Number.isFinite(r.sil)) { sumSil += r.sil; nSil++; }
    }

    // 固定频点 TL
    const at250 = at(250).sys;
    const at500 = at(500).sys;
    const at1000 = at(1000).sys;
    const at1500 = at(1500).sys;

    // 谐振频率
    const fH = v.hOn === 1
      ? (c / (2 * Math.PI)) * Math.sqrt(area(v.dn) / (v.Vh * (v.ln + 0.85 * v.dn)))
      : NaN;
    const fQ = v.qOn === 1 ? c / (4 * v.Lq) : NaN;

    // 膨胀腔高频峰谷特性（式24a~24f）：m = (D_chamber/d_box)²，峰谷间隔约 c/(2L)
    const mExp = (v.dBoxCh * v.dBoxCh) / (v.dBoxIn * v.dBoxIn);
    const fExpPeak1 = v.LBox > 0 ? c / (4 * v.LBox) : NaN;
    const fExpMin1 = v.LBox > 0 ? c / (2 * v.LBox) : NaN;
    const tlExpMax = 10 * Math.log10(1 + 0.25 * Math.pow(mExp - 1 / mExp, 2));
    const tlExpAvg = 10 * Math.log10(1 + 0.125 * Math.pow(mExp - 1 / mExp, 2));
    const fcMode1 = (1.84 * c) / (Math.PI * v.dBoxCh);
    // 管段最小截面一阶高阶模态截止（式6d）：取各管段进出口内径（含空滤器进出口管）的最小值
    const dAll = [
      ...dinIn, ...doutIn, ...dinOut, ...doutOut,
      v.dBoxIn, v.dBoxOut ?? v.dBoxIn,
    ].filter((d) => d > 0);
    const fcDuct = dAll.length ? (1.84 * c) / (Math.PI * Math.min(...dAll)) : NaN;

    return {
      c,
      tl_avg: nSys > 0 ? sumSys / nSys : NaN,
      tl_max: Number.isFinite(tlMax) ? tlMax : NaN,
      f_peak: fPeak,
      tl250: at250, tl500: at500, tl1000: at1000, tl1500: at1500,
      tlInAvg: cntIn > 0 ? sumIn / cntIn : NaN,
      tlBoxAvg: nBox > 0 ? sumBox / nBox : NaN,
      tlOutAvg: cntOut > 0 ? sumOut / cntOut : NaN,
      tlBraidAvg: nBraid > 0 ? sumBraid / nBraid : NaN,
      tlBellowsAvg: nBel > 0 ? sumBel / nBel : NaN,
      tlSilAvg: nSil > 0 ? sumSil / nSil : NaN,
      fExpPeak1, fExpMin1, tlExpMax, tlExpAvg, fcMode1, fcDuct,
      fH, fQ,
    };
  },
  curve: {
    label: '系统传递损失 TL 曲线',
    xLabel: 'Frequency (Hz)',
    yLabel: 'TL (dB)',
    compute(v) {
      const c = 331.3 + 0.606 * (v.t - 273.15);
      if (!(c > 0) || !(v.fmax > v.fmin) || !(v.fmin >= 0)) return [];
      // 先在当前输入下执行一次 solve，注册单频点模型，再按同一模型采样
      intakeSystemTransmissionLoss.solve(v);
      const fn = modelAt as ((f: number) => number) | null;
      if (!fn) return [];
      const pts: CurvePoint[] = [];
      const N = 200;
      for (let i = 0; i <= N; i++) {
        const f = v.fmin + (i * (v.fmax - v.fmin)) / N;
        const y = fn(f);
        if (Number.isFinite(y)) pts.push({ x: f, y });
      }
      return pts;
    },
  },
  benchmarks: [
    {
      name: '文档算例：单膨胀腔 D1=60 mm、D2=200 mm、L=300 mm（c=343 m/s）',
      input: vBase({
        t: 19.306930693069307 + 273.15, fmin: 20, fmax: 2000,
        // 只保留空滤器膨胀腔：进/出气管段全部取 0 长度，关掉谐振腔、支管与滤芯
        hOn: 0, qOn: 0, tFil: 0,
        dBoxIn: 0.06, dBoxCh: 0.2, LBox: 0.3,
        L1: 0, L2: 0, L3: 0, Lo1: 0, Lo2: 0, Lo3: 0,
      }),
      expect: {
        c: 343, tl250: 14.800618, tl500: 7.381177, tl1000: 12.109240, tl1500: 14.312461,
        fExpPeak1: 285.83333333333337, fExpMin1: 571.6666666666667,
        tlExpMax: 14.964622192784612, tlExpAvg: 12.090620200891928, fcMode1: 1004.4586768415699,
      },
      tolerance: 1e-6,
      source: '《进气系统传递损失计算》第 10 节算例表：m=(200/60)²=11.11，TL=10lg[1+0.25(m−1/m)²sin²(kL)] 在 250/500/1000/1500 Hz 分别为 14.8/7.5/12.2/14.3 dB（表中四舍五入到 0.1 dB）；第 6.5 节示例给出峰值 286/857/1429/2000 Hz、谷值 572/1143/1714 Hz、TLmax≈15.0 dB、TLavg≈12.1 dB，f_c1 按式(24f) 由腔径 200 mm 估算',
    },
    {
      name: '亥姆霍兹谐振腔：V=0.5 L、l_n=30 mm、d_n=20 mm',
      input: vBase({
        hOn: 1, Vh: 5e-4, ln: 0.03, dn: 0.02,
        qOn: 0, tFil: 0,
      }),
      expect: { c: 343.42, fH: 199.841979 },
      tolerance: 1e-6,
      source: '文档第 10 节算例：Leff = 30 + 0.85×20 = 47 mm，f0 = (343/2π)·[3.1416×10⁻⁴/(5×10⁻⁴×0.047)]^(1/2) ≈ 200 Hz',
    },
    {
      name: '编织管样件：D=49.36 mm、L=145 mm、t=2.7 mm（20~2000 Hz 平均 TL）',
      input: vBase({
        tFil: 0, hOn: 0, qOn: 0, dBoxIn: 0.06, dBoxOut: 0.06, dBoxCh: 0.06, LBox: 0,
        t1: 3, D1: 0.04936, Dout1: 0.04936, L1: 0.145, twB1: 2.7e-3,
        t2: 1, L2: 0, t3: 1, L3: 0,
        Lo1: 0, Lo2: 0, Lo3: 0,
      }),
      expect: { tlBraidAvg: 18.370085, tl250: 19.950131, tl500: 19.658950, tl1000: 18.691743 },
      tolerance: 1e-6,
      source: '文档第 10 节：论文样件 20~2000 Hz 平均 TL≈16.4 dB、580 Hz 约 20 dB；本式按式17/18 得平均约 18.4 dB（差异见 assumptions），基准值由 solve 实跑取得',
    },
    {
      name: '默认系统：进气管 3 段 + 空滤器（膨胀腔/滤芯/谐振腔）+ 出气管 3 段（含多腔消音器）',
      input: vBase({}),
      expect: { tl_avg: 67.057286, tl_max: 78.063762, f_peak: 1594.1 },
      tolerance: 1e-6,
      source: '默认参数实跑回归：进气管 70/60/60 mm（直管/波纹管/编织管）→ 空滤器 200 mm×300 mm（含 30 mm 滤芯与亥姆霍兹腔）→ 出气管 60 mm×400 mm / 5 腔穿孔消音器 200 mm / 未使用段',
    },
  ],
};

/** 默认输入（SI 单位），供基准算例复用 */
function vBase(over: Record<string, number>): Record<string, number> {
  const base: Record<string, number> = {
    t: 293.15, rho0: 1.205, fmin: 20, fmax: 2000,
    sigmaF: 240000, phiJ: 0.35, alphaInf: 2.5, lambdaV: 2.7e-5, lambdaT: 5.4e-5,
    mu: 1.81e-5, nPr: 0.71, gam: 1.4, pAtm: 101325, M1: 0, R0: 0.0055,
    hOn: 1, Vh: 5e-4, ln: 0.03, dn: 0.02,
    qOn: 0, Lq: 0.4, dq: 0.035,
    tFil: 0.03, sigmaFil: 300000, phiFil: 0.9, alphaFil: 1.5, lambdaVFil: 1e-4, lambdaTFil: 2e-4,
    dBoxIn: 0.06, dBoxOut: 0.06, dBoxCh: 0.2, LBox: 0.3,
    nIn: 3, nOut: 3,
  };
  const inD = [
    { t: 1, D: 0.07, L: 0.3, h: 0.004, w: 0.01, tw: 0.0027 },
    { t: 2, D: 0.06, L: 0.15, h: 0.004, w: 0.01, tw: 0.0027 },
    { t: 3, D: 0.06, L: 0.25, h: 0.004, w: 0.01, tw: 0.0027 },
    { t: 1, D: 0.06, L: 0, h: 0.004, w: 0.01, tw: 0.0027 },
    { t: 1, D: 0.06, L: 0, h: 0.004, w: 0.01, tw: 0.0027 },
  ];
  const outD = [
    { o: 1, D: 0.06, L: 0.4, h: 0.004, w: 0.01, nc: 5, dout: 0.069, dh: 0.0031, nh: 36, tw: 0.0028, ct: 0.002 },
    { o: 3, D: 0.06, L: 0.2, h: 0.004, w: 0.01, nc: 5, dout: 0.069, dh: 0.0031, nh: 36, tw: 0.0028, ct: 0.002 },
    { o: 1, D: 0.06, L: 0, h: 0.004, w: 0.01, nc: 5, dout: 0.069, dh: 0.0031, nh: 36, tw: 0.0028, ct: 0.002 },
    { o: 1, D: 0.06, L: 0, h: 0.004, w: 0.01, nc: 5, dout: 0.069, dh: 0.0031, nh: 36, tw: 0.0028, ct: 0.002 },
    { o: 1, D: 0.06, L: 0, h: 0.004, w: 0.01, nc: 5, dout: 0.069, dh: 0.0031, nh: 36, tw: 0.0028, ct: 0.002 },
  ];
  const Lc = [0.008, 0.01, 0.013, 0.017, 0.0238];
  for (let i = 1; i <= SEG_MAX; i++) {
    const d = inD[i - 1];
    base[`t${i}`] = d.t;
    base[`D${i}`] = d.D;
    base[`Dout${i}`] = d.D;
    base[`L${i}`] = d.L;
    base[`h${i}`] = d.h;
    base[`w${i}`] = d.w;
    base[`twB${i}`] = d.tw;
    const o = outD[i - 1];
    base[`o${i}`] = o.o;
    base[`Do${i}`] = o.D;
    base[`Douto${i}`] = o.D;
    base[`Lo${i}`] = o.L;
    base[`hO${i}`] = o.h;
    base[`wO${i}`] = o.w;
    base[`nc${i}`] = o.nc;
    base[`DoutS${i}`] = o.dout;
    base[`dhS${i}`] = o.dh;
    base[`nhS${i}`] = o.nh;
    base[`twS${i}`] = o.tw;
    base[`ctS${i}`] = o.ct;
    // 旁支默认「无」（类型 0）；几何按建议取值预置，选定类型后数量默认 1
    base[`br${i}`] = 0;
    base[`brN${i}`] = 1;
    base[`hbV${i}`] = 5e-4;
    base[`hbLn${i}`] = 0.03;
    base[`hbDn${i}`] = 0.02;
    base[`qwL${i}`] = 0.4;
    base[`qwD${i}`] = 0.035;
    base[`bro${i}`] = 0;
    base[`broN${i}`] = 1;
    base[`hbVo${i}`] = 5e-4;
    base[`hbLno${i}`] = 0.03;
    base[`hbDno${i}`] = 0.02;
    base[`qwLo${i}`] = 0.4;
    base[`qwDo${i}`] = 0.035;
    for (let j = 1; j <= 5; j++) base[`Lc${i}_${j}`] = Lc[j - 1];
  }
  return { ...base, ...over };
}
