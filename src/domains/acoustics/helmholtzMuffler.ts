import type { FormulaSpec } from '../../formula/types';
import { HELMHOLTZ_DIAGRAM } from './diagrams';

/**
 * 亥姆霍兹消音器（Helmholtz Resonator Muffler）
 *
 * 依据《赫姆霍兹消音器理论计算公式》V3.0（2026-11，成都万友滤机技术中心）：
 *   §3.1 密封腔基准 f0 = (c/2π)·√[ Sc / (Vc·l_eff) ]               式(1)(3-3)
 *        Sc = πd²/4，Sp = πD²/4，c = 331.3 + 0.606t                式(2)(3)
 *        Vc 为净腔体体积；l_eff = lc + h + δ_out + δ_in(h)         式(3-2)
 *        毛体积输入会自动扣 Sc·h；δ_out = ψ·d（ψ 默认 0.75，
 *        管道旁支/有限壁面取 0.75，自由场 flanged 取 0.85）
 *   §3.2 喉管插入修正   h 为插入深度，δ_in 为内端修正（需试验标定）
 *   §3.3 相贯口修正     可选 l̄eff / Seff（工程上常用等效系数近似）
 *   §4   薄壁小孔 Sh = nh·πdh²/4                                   式(6)
 *        Mc = ρ·l_eff/Sc，Mh = ρ(th + 0.75dh)/Sh                   式(7)
 *        Meq = Mc·Mh/(Mc + Mh)，f′ = f0·√(1 + Mc/Mh)               式(8)(9)
 *   §5   壳体耦合 Zin = Zn + [Zh⁻¹ + Zcav⁻¹ + Zshell⁻¹]⁻¹          式(10)
 *        Zshell = Σs Γs²/[jωΛs(ωs² − ω² + jηsωsω)]                式(11)
 *   §6   腔体模态 Zcav  = Σn Γn²/[jωΛn(ωn² − ω² + jηnωnω)]         式(14)
 *        fmnp = (c/2)·√[(m/Lx)² + (n/Ly)² + (p/Lz)²]              式(16)
 *   §6   辐射阻抗 Zrad = (ρc/Sc)·θ(ka)，θ = (ka)²（flanged）/ (ka)²/2（unflanged）  式(17)
 *        辐射质量已由 δ_out = ψd 计入 leff，此处只取实部，避免重复计质量
 *        Z0 = ρc/Sp，TL = 10·lg|1 − Z0/(2Zin)|²                   式(18)(19)
 *
 * 实现约定：
 *  - 腔体模态取矩形刚性壁解析振型 φ = cos(mπξ)cos(nπψ)cos(pπζ)，
 *    归一化 Λn = V/(εm·εn·εp)（ε=1 当阶次为 0，否则 ε=2），
 *    模态声阻抗含 ρc² 因子，保证 Z 的单位为 Pa·s/m³。
 *  - 壳体模态的模态质量与振型来自模态/FEM 或试验，公式无法从几何推出，
 *    因此由用户输入：模态频率 fs、阻尼比 ηs、模态质量系数 Ks = ms/As²、位置耦合因子 Γs。
 */

/* ---------------- AI 标定注入（H0~H4 模型升级） ---------------- */

/**
 * 赫姆霍兹中心频率公式的可标定系数集（对应《自动优化实施方案》H0~H4）。
 *  - 未设置任何字段  → H0 基准，端部修正 = ψd(默认 0.75d) + δin（不标定）
 *  - 设置 deltaTotal → H1 总端部修正标定，leff = Lt + δtotal（替代 ψd + δin）
 *  - 设置 C0         → H2 偏心/开口/插入修正，δ = d·[C0 + ke·e/R + kh·h/Lt + kA·ln(Am/Sc)]，Smin 取最小流通面积
 *  - H3/H4 暂不在本集总公式内实现，仅在策略层占位（限域/研究）
 */
export interface HelmholtzCalib {
  /** H1：总端部修正 δ_total（m）。设置后替代 ψd + δin */
  deltaTotal?: number;
  /** H2：基准端部修正系数 C0（无量纲） */
  C0?: number;
  /** H2：偏心修正系数 ke */
  ke?: number;
  /** H2：插入深度修正系数 kh */
  kh?: number;
  /** H2：开口面积修正系数 kA */
  kA?: number;
}

export const HELMHOLTZ_DEFAULT_CALIB: HelmholtzCalib = {};

let activeHelmholtzCalib: HelmholtzCalib = { ...HELMHOLTZ_DEFAULT_CALIB };

export function getActiveHelmholtzCalib(): HelmholtzCalib {
  return { ...activeHelmholtzCalib };
}

export function setActiveHelmholtzCalib(calib: HelmholtzCalib | null | undefined): void {
  activeHelmholtzCalib = calib ? { ...calib } : { ...HELMHOLTZ_DEFAULT_CALIB };
}

/** 两圆重叠（透镜）面积：半径 r、R，圆心距 e。单位一致即可。 */
function circleOverlapArea(r: number, R: number, e: number): number {
  if (e >= r + R) return 0;
  if (e <= Math.abs(R - r)) return Math.PI * Math.min(r, R) * Math.min(r, R);
  const d2 = e * e;
  const t1 = r * r * Math.acos((d2 + r * r - R * R) / (2 * e * r));
  const t2 = R * R * Math.acos((d2 + R * R - r * r) / (2 * e * R));
  const t3 = 0.5 * Math.sqrt(Math.max(0, (-e + r + R) * (e + r - R) * (e - r + R) * (e + r + R)));
  return t1 + t2 - t3;
}

/** H2 最小流通面积 Smin：e+r≤R 取 Sc，否则取两圆重叠面积。输入均为同一长度单位。 */
function computeSmin(e: number, d: number, D: number): number {
  const r = d / 2;
  const R = D / 2;
  const sc = (Math.PI * d * d) / 4;
  if (e + r <= R) return sc;
  return circleOverlapArea(r, R, e);
}

/* ---------------- 复数运算 ---------------- */

interface Cx {
  re: number;
  im: number;
}

const C = (re: number, im = 0): Cx => ({ re, im });
const cAdd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
const cInv = (a: Cx): Cx => {
  const d = a.re * a.re + a.im * a.im;
  return { re: a.re / d, im: -a.im / d };
};
const cAbs = (a: Cx): number => Math.hypot(a.re, a.im);

/* ---------------- 模态模型 ---------------- */

interface ShellMode {
  /** 模态频率 Hz */
  fs: number;
  /** 模态阻尼比 */
  eta: number;
  /** 模态质量系数 Ks = ms/As²，kg/m⁴ */
  k: number;
  /** 开孔位置耦合因子 Γs */
  gamma: number;
}

/** 阻抗求解所需的全部参数 */
interface ImpedanceConfig {
  rho: number;
  c: number;
  V: number;
  mc: number;
  mh: number;
  hasHoles: boolean;
  ca: number;
  z0: number;
  /** 是否用矩形腔模态声阻抗替换集总声容（F3） */
  modalCavity: boolean;
  dims: [number, number, number];
  /** 开孔位置归一化坐标 ξ、ψ、ζ */
  pos: [number, number, number];
  etaCav: number;
  /** 壳体模态（F2），为空表示刚性壳体 */
  shell: ShellMode[];
  /** 颈部口辐射阻（式17 的实部），单位 Pa·s/m³；0 表示不计 */
  radR: (f: number) => number;
}

/** 矩形腔模态声阻抗（式14/16），含 (0,0,0) 基模声容项 */
function cavityImpedance(w: number, cfg: ImpedanceConfig): Cx {
  const [Lx, Ly, Lz] = cfg.dims;
  const [xi, psi, zeta] = cfg.pos;
  const eps = (i: number) => (i === 0 ? 1 : 2);
  let sum = C(0, 0);
  for (let m = 0; m <= 3; m++) {
    for (let n = 0; n <= 3; n++) {
      for (let p = 0; p <= 3; p++) {
        if (m === 0 && n === 0 && p === 0) continue;
        const fn = (cfg.c / 2) * Math.sqrt((m / Lx) ** 2 + (n / Ly) ** 2 + (p / Lz) ** 2);
        const wn = 2 * Math.PI * fn;
        const g =
          Math.cos(m * Math.PI * xi) * Math.cos(n * Math.PI * psi) * Math.cos(p * Math.PI * zeta);
        if (Math.abs(g) < 1e-12) continue;
        const lambda = cfg.V / (eps(m) * eps(n) * eps(p));
        const denRe = wn * wn - w * w;
        const denIm = cfg.etaCav * wn * w;
        const den2 = denRe * denRe + denIm * denIm;
        const num = (w * cfg.rho * cfg.c * cfg.c * g * g) / lambda;
        // j·num/(denRe + j·denIm) = num·denIm/den2 + j·num·denRe/den2
        sum = cAdd(sum, C((num * denIm) / den2, (num * denRe) / den2));
      }
    }
  }
  // (0,0,0)：刚性腔声容 1/(jωCa)
  sum = cAdd(sum, C(0, -1 / (w * cfg.ca)));
  return sum;
}

/** 壳体模态声阻抗（式11），叠加各阶模态 */
function shellImpedance(w: number, modes: ShellMode[]): Cx {
  let sum = C(0, 0);
  for (const s of modes) {
    const ws = 2 * Math.PI * s.fs;
    const denRe = ws * ws - w * w;
    const denIm = s.eta * ws * w;
    const den2 = denRe * denRe + denIm * denIm;
    if (!(den2 > 0)) continue;
    const num = w * s.k * s.gamma * s.gamma;
    sum = cAdd(sum, C((num * denIm) / den2, (num * denRe) / den2));
  }
  return sum;
}

/** 总输入声阻抗（式10）：颈管串联「小孔 ∥ 腔体 ∥ 壳体」 */
function inputImpedance(f: number, cfg: ImpedanceConfig): Cx {
  const w = 2 * Math.PI * f;
  const zn = C(0, w * cfg.mc); // Zn = jωMc
  let y = C(0, 0);
  if (cfg.hasHoles) y = cAdd(y, cInv(C(0, w * cfg.mh))); // Zh = jωMh
  const zc = cfg.modalCavity ? cavityImpedance(w, cfg) : C(0, -1 / (w * cfg.ca));
  y = cAdd(y, cInv(zc));
  if (cfg.shell.length > 0) {
    const zs = shellImpedance(w, cfg.shell);
    if (cAbs(zs) > 0) y = cAdd(y, cInv(zs));
  }
  return cAdd(cAdd(zn, cAbs(y) > 0 ? cInv(y) : C(0, Number.POSITIVE_INFINITY)), C(cfg.radR(f), 0));
}

/** 阻抗法传递损失（式19） */
function impedanceTl(f: number, cfg: ImpedanceConfig): number {
  const zin = inputImpedance(f, cfg);
  const zr = cAbs(zin);
  if (!(zr > 1e-30)) return 200;
  // |1 − Z0/(2Zin)|² = 1 − Re(Z0/Zin) + (Z0/(2|Zin|))²
  const reRatio = (cfg.z0 * zin.re) / (zr * zr);
  const term = 1 - reRatio + (cfg.z0 / (2 * zr)) ** 2;
  if (!(term > 1e-12)) return 200;
  return Math.min(200, 10 * Math.log10(term));
}

/** 模态模型下的传递损失曲线：等频率扫描 + 峰值局部细化 */
function modalTlCurve(f0: number, cfg: ImpedanceConfig): { x: number; y: number }[] {
  const fMin = 0.05 * f0;
  const fMax = 2.5 * f0;
  const N = 1200;
  const pts: { x: number; y: number }[] = [];
  let best = { f: f0, tl: -Infinity };
  for (let i = 0; i <= N; i++) {
    const f = fMin + ((fMax - fMin) * i) / N;
    const tl = impedanceTl(f, cfg);
    pts.push({ x: f, y: tl });
    if (tl > best.tl) best = { f, tl };
  }
  // 抛物线/三分法细化峰值位置与幅值
  const step = (fMax - fMin) / N;
  let lo = Math.max(fMin, best.f - step);
  let hi = Math.min(fMax, best.f + step);
  for (let k = 0; k < 40; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (impedanceTl(m1, cfg) < impedanceTl(m2, cfg)) lo = m1;
    else hi = m2;
  }
  const fPeak = (lo + hi) / 2;
  const tlPeak = impedanceTl(fPeak, cfg);
  pts.push({ x: fPeak, y: tlPeak });
  pts.sort((a, b) => a.x - b.x);
  return pts;
}

/* ---------------- 集总参数（F0/F1） ---------------- */

/** 给定共振频率与阻抗参数，用等频率间隔在 [0, 2.5·f_res] 生成密集采样点 */
function denseTlCurve(
  resFreq: number,
  meq: number,
  ca: number,
  z0: number,
  radR?: (f: number) => number,
): { x: number; y: number }[] {
  const fMax = 2.5 * resFreq;
  const N = 240; // 总点数
  const fStep = fMax / N;
  const points: { x: number; y: number }[] = [];
  const EPS_F = 0.01; // 距共振频率的最近采样距离（Hz），保证不正好踩在奇异点

  // TL = 10lg|1 − Z0/(2Zin)|²，Zin = j(ωMeq − 1/(ωCa)) + R_rad
  // R_rad 为颈部口辐射阻（式17 实部）：无辐射时共振点趋于无穷，计入后峰值有限
  const tlAt = (f: number): number => {
    const w = 2 * Math.PI * f;
    const x = w * meq - 1 / (w * ca);
    const r = radR ? radR(f) : 0;
    const zr = Math.hypot(r, x);
    if (!(zr > 1e-30)) return 200;
    const term = 1 - (z0 * r) / (zr * zr) + (z0 / (2 * zr)) ** 2;
    if (!(term > 1e-12)) return 200;
    return Math.min(200, 10 * Math.log10(term));
  };
  const push = (f: number) => {
    const tl = tlAt(f);
    if (Number.isFinite(tl)) points.push({ x: f, y: tl });
  };

  // 先采 f < f_res 一侧，从 f=0 到 f=f_res−EPS_F
  for (let i = 1; ; i++) {
    const f = i * fStep;
    if (f >= resFreq - EPS_F) break;
    push(f);
  }
  // 奇异点"近侧"：各采一个，展示尖峰最顶端
  push(resFreq - EPS_F);
  push(resFreq + EPS_F);

  // 再采 f > f_res 一侧，从 f_res+EPS_F 到 fMax
  for (let i = Math.ceil((resFreq + EPS_F) / fStep); i * fStep <= fMax; i++) {
    const f = i * fStep;
    if (Math.abs(f - resFreq) < EPS_F) continue; // 跳过已经加过的奇异点近侧
    push(f);
  }
  points.sort((a, b) => a.x - b.x);
  return points;
}

/** 由 SI 输入算出中心频率、等效声质量与 TL 计算所需的中间量 */
function derive(v: Record<string, number>, calibOverride?: HelmholtzCalib) {
  const { V, lc, d, t, D } = v;
  // AI 标定系数：显式传入优先（标定引擎评估候选参数），否则取已发布的激活系数
  const calib = calibOverride ?? activeHelmholtzCalib;
  // 新增参数：未传入时按"密封腔、无小孔、刚性壳体"处理，兼容旧算例
  const dh = v.dh ?? 0;
  const th = v.th ?? 0;
  const nh = v.nh ?? 1;
  const rho = v.rho ?? 1.204;
  const Lx = v.Lx ?? 0;
  const Ly = v.Ly ?? 0;
  const Lz = v.Lz ?? 0;
  const useCav = (v.useCav ?? 0) >= 1;
  const etaCav = v.etaCav ?? 0.02;
  const xi = v.xi ?? 0.25;
  const psi = v.psi ?? 0.25;
  const zeta = v.zeta ?? 0.25;
  const ns = Math.max(0, Math.min(3, Math.round(v.ns ?? 0)));

  // V3 §3.2 喉管插入修正（图片1/2要求）：
  // - 长度口径 lengthKind：0=总长（默认，lc 已包含 h）；1=外露长度（lc 是外露段，需加 h）
  // - δout=ψd（ψ 默认 0.75；管道旁支/有限壁面 0.75，自由场 flanged 0.85）；δin 默认 0 需试验标定
  const hInsert = v.h ?? 0;
  const lengthKind = (v.lengthKind ?? 0) >= 1 ? 1 : 0; // 0=总长，1=外露长度
  const deltaIn = v.deltaIn ?? 0;
  const tWall = v.tWall ?? 0; // 喉管壁厚（m），用于算管壁体积 Vwall

  // 外露长度（自动校验，展示用）
  const exposedLen = lengthKind === 0
    ? Math.max(0, lc - hInsert)      // 总长口径：外露 = Lt − h
    : lc;                              // 外露口径：lc 本身就是外露段

  if (!(V > 0) || !(lc > 0) || !(d > 0) || !(D > 0) || !Number.isFinite(t)) return null;
  if (!(rho > 0)) return null;
  if (!(hInsert >= 0)) return null;
  if (lengthKind === 0 && hInsert > lc * 1.1) {
    // 总长口径下，h 理论上不应该超过 lc（约 10% 冗余容差）
    // 非致命错误，但返回 warning 字段给 UI 提示
  }

  const c = 331.3 + 0.606 * (t - 273.15);
  const sc = (Math.PI * d * d) / 4;
  const sp = (Math.PI * D * D) / 4;
  // 外端修正 δ_out = ψ·d：ψ 可输入，默认 0.75
  //   默认取值：管道旁支/有限壁面 0.75；自由场大障板（flanged）0.85
  const kDeltaOut = v.kDeltaOut && v.kDeltaOut > 0 ? v.kDeltaOut : 0.75;
  const deltaOut = kDeltaOut * d;

  // ===== §3.3 喉管与主管相贯口修正 =====
  // intersectKind：0=垂直插入（默认，无修正）；1=斜插（输入相贯角自动修正）；2=自定义系数
  const intersectKind = (v.intersectKind ?? 0) >= 2 ? 2 : (v.intersectKind ?? 0) >= 1 ? 1 : 0;
  const intersectAlpha = Math.max(30, Math.min(90, v.intersectAlpha ?? 90)); // 相贯角（度）：90=垂直，60/45=斜插
  const kSeffCustom = v.kSeff ?? 1.0;   // 自定义 Seff 系数
  const kLeffCustom = v.kLeff ?? 1.0;   // 自定义 leff 系数

  // 相贯口修正计算（工程近似，替代 §3.3 的圆周积分）
  let kSeff = 1.0;        // Seff / Sc
  let deltaOutEff = deltaOut; // 有效外端修正（相贯口椭圆使辐射阻抗增大）
  let intersectNote = '';
  if (intersectKind === 1) {
    // 斜插：相贯口为椭圆，短轴 = d·sin(α)，流通面积折减
    const sinA = Math.max(Math.sin((intersectAlpha * Math.PI) / 180), 0.35);
    kSeff = Math.max(0.45, sinA);                       // Seff ≈ Sc·sin(α)（椭圆短轴方向流通）
    deltaOutEff = deltaOut / sinA;                       // 椭圆辐射阻抗 > 圆孔，δout 需放大
    intersectNote = `相贯角 ${intersectAlpha.toFixed(0)}°：k_Seff=${kSeff.toFixed(3)}，δ_out,eff=${(deltaOutEff*1000).toFixed(2)} mm`;
  } else if (intersectKind === 2) {
    kSeff = kSeffCustom;
    deltaOutEff = deltaOut * kLeffCustom; // 自定义系数直接乘到修正长度上
    intersectNote = `自定义系数：k_Seff=${kSeff.toFixed(3)}，k_leff=${kLeffCustom.toFixed(3)}`;
  }
  const scEff = sc * kSeff;

  // AI 标定注入（H0/H1/H2）：端部修正 endCorr 与流通面积 sArea 受 calib 控制
  //   H0（无 calib）：endCorr = δout,eff + δin，sArea = Sc,eff
  //   H1（deltaTotal）：endCorr = δtotal，sArea = Sc,eff（文档式3-5）
  //   H2（C0 等）：endCorr = d·[C0 + ke·e/R + kh·h/Lt + kA·ln(Am/Sc)]，sArea = Smin（文档式6-7）
  let endCorr = deltaOutEff + deltaIn;
  let sArea = scEff;
  if (calib && Number.isFinite(calib.deltaTotal as number)) {
    endCorr = calib.deltaTotal as number; // H1
  } else if (calib && Number.isFinite(calib.C0 as number)) {
    const R = D / 2;
    const eVal = v.eccentricity ?? 0;
    const am = v.am && v.am > 0 ? v.am : sc; // 相贯开口面积，未填退化为 Sc（ln(1)=0）
    const lt = Math.max(lc, 1e-9);
    const C0 = calib.C0 as number;
    const ke = calib.ke ?? 0;
    const kh = calib.kh ?? 0;
    const kA = calib.kA ?? 0;
    endCorr = d * (C0 + ke * (eVal / R) + kh * (hInsert / lt) + kA * Math.log(am / sc));
    sArea = computeSmin(eVal, d, D);
  }

  // 关键：按长度口径决定 leff 是否加 h（图片2）
  // 总长口径：lc 已经包含 h，不能再重复加！
  // 外露口径：lc 是外露段，需补回插入段 h
  // 端部修正 endCorr 由 AI 标定（H0/H1/H2）决定
  const lEff = lengthKind === 0
    ? lc + endCorr            // 总长（推荐）
    : lc + hInsert + endCorr; // 外露长度

  // §3.2 体积口径（图片3）
  const cavityGrossNum = (v.cavityGross ?? 0) >= 1 ? 1 : 0;
  // 体积口径（文档 §2.2）：
  //   净腔体（cavityGross=0）：Vc = V，不得再扣 Sc·h（喉管已在净体积外）
  //   毛腔体（cavityGross=1）：Vc = V − Vwall − Sc·h（扣管壁 + 插入段空气）
  const Vwall = tWall > 0
    ? (Math.PI * ((d + 2 * tWall) * (d + 2 * tWall) - d * d)) / 4 * lc
    : 0;
  const Vc = cavityGrossNum === 1
    ? Math.max(1e-15, V - Vwall - sc * hInsert)
    : V;

  // V3 式(3-3)：带插入修正 + 相贯口修正 + AI 标定的密封腔共振频率
  // sArea = Sc,eff（H0/H1）或 Smin（H2 偏心/开口修正后的最小流通面积）
  const f0 = (c / (2 * Math.PI)) * Math.sqrt(sArea / (Vc * lEff));
  const ca = Vc / (rho * c * c); // 式(4)，基于净腔体
  const mc = (rho * lEff) / sArea;  // 式(7)，声质量用标定后的流通面积

  // 薄壁小孔：孔径与数量有效时才并联计入
  const hasHoles = dh > 0 && nh >= 1;
  const sh = hasHoles ? (nh * Math.PI * dh * dh) / 4 : 0; // 式(6)
  const mh = hasHoles ? (rho * (th + 0.75 * dh)) / sh : Number.NaN; // 式(7)
  const meq = hasHoles ? (mc * mh) / (mc + mh) : mc; // 式(8)
  // 开孔后共振频率 f′ = f0·√(Mc/Meq) = f0·√(1 + Mc/Mh)（式(9)）
  const fp = f0 * Math.sqrt(mc / meq);

  const z0 = (rho * c) / sp; // 式(18)

  // 壳体模态：仅采纳频率 > 0 的阶次，便于用户逐阶启用
  const shell: ShellMode[] = [];
  for (let i = 1; i <= ns; i++) {
    const fs = v[`fs${i}`] ?? 0;
    if (!(fs > 0)) continue;
    shell.push({
      fs,
      eta: v[`etaS${i}`] ?? 0.03,
      k: v[`ms${i}`] ?? 1,
      gamma: v[`gs${i}`] ?? 1,
    });
  }

  const dimsOk = Lx > 0 && Ly > 0 && Lz > 0;
  const modalCavity = useCav && dimsOk;
  const modalActive = modalCavity || shell.length > 0;

  // 颈部口辐射阻（式17 实部，小 ka 近似）：θ = (ka)²（带障板）/ (ka)²/2（无障板）。
  // 端部条件沿用 ψ：ψ ≥ 0.8 视为 flanged。只取实部——辐射质量已由 δ_out = ψd
  // 计入 leff，再加 χ 会重复计质量、把共振频率拉低。
  const flanged = (v.kDeltaOut ?? 0.75) >= 0.8;
  const radA = d / 2;
  const radR = (f: number): number => {
    const ka = (2 * Math.PI * f * radA) / c;
    return ((rho * c) / sc) * (flanged ? ka * ka : 0.5 * ka * ka);
  };

  const imp: ImpedanceConfig | null = modalActive
    ? {
        rho, c, V: Vc, mc, mh, hasHoles, ca, z0,
        modalCavity,
        dims: [Lx, Ly, Lz],
        pos: [xi, psi, zeta],
        etaCav: Math.max(1e-4, etaCav),
        shell,
        radR,
      }
    : null;

  // 模态适用性校核：矩形腔最低阶非零模态 + 无量纲波数
  const f100 = dimsOk ? (c / 2) * Math.min(1 / Lx, 1 / Ly, 1 / Lz) : Number.NaN;
  const a = Math.max(Lx, Ly, Lz);
  const ka = a > 0 ? (2 * Math.PI * f0 * a) / c : Number.NaN;
  const fRatio = Number.isFinite(f100) && f100 > 0 ? f0 / f100 : Number.NaN;

  // 校验提示（图片4）：总长口径下 h 已包含在 lc 中
  // 当用户填 h > 0 且选总长口径时，leff 不会再加 h，给出提示让用户确认
  const hIncludedInTotal = lengthKind === 0 && hInsert > 1e-6 * lc;
  const warnings: string[] = [];
  if (hIncludedInTotal) {
    warnings.push(
      `检测到插入深度 ${(hInsert * 1000).toFixed(1)} mm 已包含在总长 ${(lc * 1000).toFixed(1)} mm 内，` +
      `有效长度 leff = Lt + δ（总长口径不再重复加 h）。` +
      `若 lc 实际是外露段，请切换"长度口径"为"外露长度"。`,
    );
  }
  if (cavityGrossNum === 1 && tWall <= 0) {
    warnings.push('毛腔体积口径下，喉管壁厚填 0 将只扣除插入段空气体积 Sc·h，不扣管壁体积 Vwall。');
  }
  if (cavityGrossNum === 0 && hInsert > 1e-6 * lc) {
    warnings.push(
      '净腔体口径下 Vc 不扣插入段 Sc·h（文档 §2.2：净体积已排除喉管）；若 V 是毛体积，请切换"体积口径"为"毛腔体"。',
    );
  }

  return {
    c, sc, scEff, sArea, sp, lEff, f0, fp, ca, mc, mh, meq, sh, z0,
    f100, ka, fRatio, imp, radR,
    hInsert, deltaOut, deltaOutEff, deltaIn, Vc, cavityGrossNum,
    lengthKind, tWall, Vwall, exposedLen,
    intersectKind, intersectAlpha, kSeff, intersectNote,
    warnings,
  };
}

/**
 * AI 标定引擎公开求值入口：给定 SI 输入与可选标定系数，返回中心频率 f0（Hz）。
 * 用于 H1/H2 对标：优化器反复调用，比较 model f0 与实测/CAE f0。
 */
export function evalHelmholtzF0(v: Record<string, number>, calib?: HelmholtzCalib): number {
  const r = derive(v, calib);
  return r ? r.f0 : NaN;
}

/** 返回 f0、有效长度与流通面积，供结果页展示与口径校验。 */
export function evalHelmholtzSummary(
  v: Record<string, number>,
  calib?: HelmholtzCalib,
): { f0: number; lEff: number; sArea: number; sc: number; Vc: number; endCorr: number } {
  const r = derive(v, calib);
  if (!r) return { f0: NaN, lEff: NaN, sArea: NaN, sc: NaN, Vc: NaN, endCorr: NaN };
  return {
    f0: r.f0,
    lEff: r.lEff,
    sArea: r.sArea,
    sc: r.sc,
    Vc: r.Vc,
    endCorr: r.lEff - (r.lengthKind === 0 ? v.lc : v.lc + r.hInsert),
  };
}

export const helmholtzMuffler: FormulaSpec = {
  id: 'acoustics.muffler.helmholtz',
  version: '3.0.0',
  status: 'published',
  domain: 'acoustics',
  subsystem: '消声器',
  title: '亥姆霍兹消音器',
  summary:
    '按 V3.0 理论公式计算密封腔共振频率、喉管插入/相贯修正、薄壁小孔移频与传递损失 TL 曲线，支持 F2 壳体模态耦合与 F3 矩形腔模态修正，并给出集总参数适用性校核。',
  tags: ['亥姆霍兹', '消音器', '消声器', '传递损失', 'TL', '共振频率', '薄壁小孔', '模态', 'NVH', '进气系统', '排气系统'],
  description:
    '亥姆霍兹消音器由管道旁接的共振腔与喉管组成，在共振频率附近产生最大传递损失。V3.0 按图片口径区分长度口径（总长/外露长度）与体积口径（净腔体/毛腔体）：默认总长口径下 leff = Lt + δout + δin（δout = ψd，ψ 默认 0.85；总长已包含 h，不重复叠加）；外露长度口径下 leff = Lexposed + h + δout + δin。毛腔体积自动扣 Vwall + Sc·h。F0 密封腔 f0 = (c/2π)·√[Sc/(Vc·leff)]；薄壁小孔按等效声质量并联 f′ = f0·√(1+Mc/Mh)；传递损失按阻抗法 TL = 10lg|1−Z0/(2Zin)|²。开启「腔体模态修正」后按式(14)(16) 以矩形腔解析模态声阻抗替换集总声容（F3）；填写壳体模态后按式(11) 并入 Zshell（F2）。总输入阻抗 Zin = Zn + [Zh⁻¹+Zcav⁻¹+Zshell⁻¹]⁻¹（式10），中心频率取 TL 峰值位置。',
  inputs: [
    { key: 'V', label: '亥姆霍兹腔体的体积', symbol: 'V', unit: 'L', unitGroup: 'volume', default: 0.5, min: 0, required: true, group: '密封腔基本参数', description: '共振腔容积，需配合下方"体积口径"选项选择是净腔体还是毛腔体' },
    { key: 'lc', label: '喉管总长度 L<tspan font-size="0.7em" dy="2">t</tspan>', symbol: 'Lt', unit: 'mm', unitGroup: 'length', default: 30, min: 0, required: true, group: '密封腔基本参数', description: '喉管沿自身中心线量的总长度（外露段 + 插入段）；斜插相贯口时 lc 不变（圆管切斜口不改变中心线长度），相贯口的椭圆效应由下方"相贯角 α"自动修正为 Seff 和 δ_out,eff' },
    { key: 'd', label: '喉管的直径', symbol: 'd', unit: 'mm', unitGroup: 'diameter', default: 20, min: 0, required: true, group: '密封腔基本参数', description: '喉管内径，决定喉管截面积 Sc = πd²/4' },
    { key: 't', label: '温度', symbol: 't', unit: '℃', unitGroup: 'temperature', default: 25, required: true, group: '密封腔基本参数', description: '介质温度，用于计算声速 c = 331.3 + 0.606t' },
    { key: 'D', label: '主管道直径', symbol: 'D', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, required: true, group: '密封腔基本参数', description: '主管道内径，决定管道截面积 Sp = πD²/4' },

    {
      key: 'lengthKind', label: '喉管长度口径', symbol: '—', unit: '—', kind: 'select',
      options: [
        { value: 0, label: '总长度（推荐）leff = Lt + δ' },
        { value: 1, label: '外露长度 leff = Lexposed + h + δ' },
      ],
      default: 0, group: '喉管插入与体积口径（§3.2）',
      description: '选"总长度"时，lc 视为包含插入深度 h 的总长度，leff = Lt + δout + δin（不重复加 h）；选"外露长度"时，lc 是外露段，leff = lc + h + δout + δin',
    },
    { key: 'h', label: '喉管插入深度 h', symbol: 'h', unit: 'mm', unitGroup: 'length', default: 0, min: 0, group: '喉管插入与体积口径（§3.2）', description: '喉管伸入腔体的深度；总长口径下 h 已包含在 lc 中（仅用于校验外露长度 Lexposed = Lt − h）；外露长度口径下 leff 会补加 h' },
    {
      key: 'kDeltaOut',
      label: '外端修正系数 ψ（管道旁支 0.75 / 自由场 flanged 0.85）',
      symbol: 'ψ',
      unit: '—',
      default: 0.75,
      min: 0.3,
      max: 1.2,
      group: '喉管插入与体积口径（§3.2）',
      description: '外端修正 δ_out = ψ·d。默认 0.75：颈部开在管壁/有限壁面上（管道旁支、有限障板）取 0.75；四周为无限大障板、向自由半空间辐射时取 0.85（flanged）；悬空自由端取 0.75 或更低的 0.61d。该默认值由标定样件（V=1.5L、45×25mm、D=60mm、15℃ → f0=122.743Hz）锁定',
      // 实时展示派生值：改 d 或 ψ 时同步更新 δ_out，避免手工换算
      deriveHint: (v, u) => {
        const psi = v.kDeltaOut;
        const dV = v.d;
        if (!Number.isFinite(psi) || !Number.isFinite(dV) || psi <= 0) return '';
        const unit = u.d ?? 'mm';
        const out = Number((psi * dV).toPrecision(4));
        return `当前 δ_out = ψ·d = ${psi} × ${dV} = ${out} ${unit}`;
      },
    },
    { key: 'deltaIn', label: '内端修正 δ_in', symbol: 'δ_in', unit: 'mm', unitGroup: 'length', default: 0, min: 0, group: '喉管插入与体积口径（§3.2）', description: '喉管内端（伸入腔体一端）的辐射修正；默认 0（无插入时与外端对称）；严格取值需试验或三维声学标定，通常 0~0.6d 量级' },
    { key: 'fTarget', label: '对标目标中心频率（0 = 关闭）', symbol: 'f_t', unit: 'Hz', default: 0, min: 0, group: '喉管插入与体积口径（§3.2）', description: '填入 CAE/实测中心频率后，结果区反推使 f0 对齐目标所需的 ψ* 与 H1 总端部修正 δ_total*；仅作对标参考，不改变本次计算' },
    { key: 'tWall', label: '喉管壁厚', symbol: 't', unit: 'mm', unitGroup: 'length', default: 0, min: 0, group: '喉管插入与体积口径（§3.2）', description: '仅在"毛腔体积"口径下需要；用于自动扣除管壁体积 Vwall = π[(d+2t)²−d²]/4·Lt；填 0 时毛腔体只扣 Sc·h' },

    {
      key: 'cavityGross', label: '腔体体积口径', symbol: '—', unit: '—', kind: 'select',
      options: [
        { value: 0, label: '净腔体（已扣喉管）' },
        { value: 1, label: '毛腔体（软件自动扣 Vwall + Sc·h）' },
      ],
      default: 0, group: '喉管插入与体积口径（§3.2）',
      description: '默认选"净腔体"（V 已是扣喉管后的体积）；若选"毛腔体"，软件按 V3.0 自动扣除管壁体积 Vwall 和插入段空气体积 Sc·h',
    },

    {
      key: 'intersectKind', label: '喉管与主管相贯口修正', symbol: '—', unit: '—', kind: 'select',
      options: [
        { value: 0, label: '垂直插入（默认，无修正）' },
        { value: 1, label: '斜插（输入相贯角自动修正）' },
        { value: 2, label: '自定义系数（进阶）' },
      ],
      default: 0, group: '相贯口修正（§3.3）',
      description: '喉管垂直插入主管时相贯口为圆形（默认）；斜插时相贯口为椭圆，沿圆周加权平均有效面积 Seff 和辐射修正 δout,eff（文档式3-4/3-5 的工程近似）',
    },
    { key: 'intersectAlpha', label: '相贯角 α', symbol: 'α', unit: '°', default: 90, min: 30, max: 90, group: '相贯口修正（§3.3）', showIf: { key: 'intersectKind', min: 1, max: 1 }, description: '喉管中心线与主管壁面的夹角（90°=垂直插入，60°/45°=斜插）；注意：lc 仍沿喉管中心线量，不改！斜插只通过相贯角自动折算 Seff ≈ Sc·sin(α)、δ_out,eff = δ_out/sin(α)' },
    { key: 'kSeff', label: 'Seff/Sc 系数', symbol: 'k_Seff', unit: '—', default: 1, min: 0.3, max: 1.2, group: '相贯口修正（§3.3）', showIf: { key: 'intersectKind', min: 2 }, description: '自定义流通面积修正系数；0.45~1.0 范围，实验标定或仿真结果直接输入' },
    { key: 'kLeff', label: 'δout 修正系数', symbol: 'k_δ', unit: '—', default: 1, min: 0.5, max: 2.5, group: '相贯口修正（§3.3）', showIf: { key: 'intersectKind', min: 2 }, description: '自定义外端辐射修正系数；椭圆相贯口辐射阻抗更大，通常取 1.0~1.5' },

    { key: 'rho', label: '空气密度', symbol: 'ρ', unit: 'kg/m³', unitGroup: 'density', default: 1.204, min: 0, required: true, group: '薄壁小孔（可选）', description: '20℃ 约 1.204 kg/m³，用于计算声质量 Mc、Mh 与特性阻抗 Z0' },
    { key: 'dh', label: '薄壁小孔直径', symbol: 'dh', unit: 'mm', unitGroup: 'diameter', default: 0, min: 0, group: '薄壁小孔（可选）', description: '薄壁圆孔直径；填 0 表示密封腔（仅按 F0 计算）' },
    { key: 'th', label: '小孔壁厚（孔长）', symbol: 'th', unit: 'mm', unitGroup: 'length', default: 2, min: 0, group: '薄壁小孔（可选）', description: '开孔处壁厚，用于计算小孔声质量 Mh' },
    { key: 'nh', label: '小孔数量', symbol: 'nh', unit: '—', default: 1, min: 0, group: '薄壁小孔（可选）', description: '小孔总数，小孔总面积 Sh = nh·πdh²/4' },
    { key: 'Lx', label: '腔体长度', symbol: 'Lx', unit: 'mm', unitGroup: 'length', default: 0, min: 0, group: '腔体尺寸与孔位（F3）', description: '矩形腔 X 向尺寸；开启腔体模态修正时必须填写' },
    { key: 'Ly', label: '腔体宽度', symbol: 'Ly', unit: 'mm', unitGroup: 'length', default: 0, min: 0, group: '腔体尺寸与孔位（F3）', description: '矩形腔 Y 向尺寸' },
    { key: 'Lz', label: '腔体高度', symbol: 'Lz', unit: 'mm', unitGroup: 'length', default: 0, min: 0, group: '腔体尺寸与孔位（F3）', description: '矩形腔 Z 向尺寸' },
    {
      key: 'useCav', label: '腔体模态修正', symbol: 'F3', unit: '—', kind: 'select',
      options: [{ value: 0, label: '关闭（集总腔）' }, { value: 1, label: '开启（矩形腔模态）' }],
      default: 0, group: '腔体尺寸与孔位（F3）',
      description: '开启后按式(14)计算腔体模态声阻抗；需填写三边尺寸，f0/f100 > 0.2 时尤为重要',
    },
    { key: 'etaCav', label: '腔体模态阻尼比', symbol: 'ηn', unit: '—', default: 0.02, min: 0, max: 1, group: '腔体尺寸与孔位（F3）', showIf: { key: 'useCav', min: 1 }, description: '0~0.1 量级，缺省 0.02' },
    { key: 'xi', label: '开孔位置 ξ（X 向）', symbol: 'ξ', unit: '—', default: 0.25, min: 0, max: 1, group: '腔体尺寸与孔位（F3）', showIf: { key: 'useCav', min: 1 }, description: '孔中心沿 X 的归一化位置 0~1；腹点耦合强，节点耦合弱' },
    { key: 'psi', label: '开孔位置 ψ（Y 向）', symbol: 'ψ', unit: '—', default: 0.25, min: 0, max: 1, group: '腔体尺寸与孔位（F3）', showIf: { key: 'useCav', min: 1 }, description: '孔中心沿 Y 的归一化位置' },
    { key: 'zeta', label: '开孔位置 ζ（Z 向）', symbol: 'ζ', unit: '—', default: 0.25, min: 0, max: 1, group: '腔体尺寸与孔位（F3）', showIf: { key: 'useCav', min: 1 }, description: '孔中心沿 Z 的归一化位置' },
    {
      key: 'ns', label: '壳体模态数', symbol: 'ns', unit: '—', kind: 'select',
      options: [{ value: 0, label: '0（刚性壳体）' }, { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }],
      default: 0, group: '壳体模态（F2）',
      description: '壳体低阶模态接近或低于 f0 时应并入 Zshell；模态参数来自模态/FEM 或试验',
    },
    { key: 'fs1', label: '壳体模态 1 频率', symbol: 'fs1', unit: 'Hz', default: 0, min: 0, group: '壳体模态（F2）', showIf: { key: 'ns', min: 1 }, description: '第 1 阶壳体模态频率；填 0 表示该阶不参与' },
    { key: 'etaS1', label: '壳体模态 1 阻尼比', symbol: 'ηs1', unit: '—', default: 0.03, min: 0, max: 1, group: '壳体模态（F2）', showIf: { key: 'ns', min: 1 }, description: '0~0.1 量级' },
    { key: 'ms1', label: '壳体模态 1 质量系数', symbol: 'Ks1', unit: 'kg/m⁴', default: 1, min: 0, group: '壳体模态（F2）', showIf: { key: 'ns', min: 1 }, description: 'Ks = ms/As²，由模态质量与等效面积得到；越大表示壳体越"重"、耦合越弱' },
    { key: 'gs1', label: '壳体模态 1 耦合因子', symbol: 'Γs1', unit: '—', default: 1, min: 0, max: 1, group: '壳体模态（F2）', showIf: { key: 'ns', min: 1 }, description: '开孔处振型与振型最大值之比，腹点取 1，节点取 0' },
    { key: 'fs2', label: '壳体模态 2 频率', symbol: 'fs2', unit: 'Hz', default: 0, min: 0, group: '壳体模态（F2）', showIf: { key: 'ns', min: 2 }, description: '第 2 阶壳体模态频率' },
    { key: 'etaS2', label: '壳体模态 2 阻尼比', symbol: 'ηs2', unit: '—', default: 0.03, min: 0, max: 1, group: '壳体模态（F2）', showIf: { key: 'ns', min: 2 }, description: '0~0.1 量级' },
    { key: 'ms2', label: '壳体模态 2 质量系数', symbol: 'Ks2', unit: 'kg/m⁴', default: 1, min: 0, group: '壳体模态（F2）', showIf: { key: 'ns', min: 2 }, description: 'Ks = ms/As²' },
    { key: 'gs2', label: '壳体模态 2 耦合因子', symbol: 'Γs2', unit: '—', default: 1, min: 0, max: 1, group: '壳体模态（F2）', showIf: { key: 'ns', min: 2 }, description: '开孔处振型比值' },
    { key: 'fs3', label: '壳体模态 3 频率', symbol: 'fs3', unit: 'Hz', default: 0, min: 0, group: '壳体模态（F2）', showIf: { key: 'ns', min: 3 }, description: '第 3 阶壳体模态频率' },
    { key: 'etaS3', label: '壳体模态 3 阻尼比', symbol: 'ηs3', unit: '—', default: 0.03, min: 0, max: 1, group: '壳体模态（F2）', showIf: { key: 'ns', min: 3 }, description: '0~0.1 量级' },
    { key: 'ms3', label: '壳体模态 3 质量系数', symbol: 'Ks3', unit: 'kg/m⁴', default: 1, min: 0, group: '壳体模态（F2）', showIf: { key: 'ns', min: 3 }, description: 'Ks = ms/As²' },
    { key: 'gs3', label: '壳体模态 3 耦合因子', symbol: 'Γs3', unit: '—', default: 1, min: 0, max: 1, group: '壳体模态（F2）', showIf: { key: 'ns', min: 3 }, description: '开孔处振型比值' },
  ],
  outputs: [
    { key: 'fr', label: '密封腔中心频率', symbol: 'f0', unit: 'Hz', primary: true, group: '声学特性', description: '密封腔 Helmholtz 共振频率 f0（V3.0 式3-3）' },
    { key: 'fp', label: '共振频率（含修正）', symbol: 'f′', unit: 'Hz', primary: true, group: '声学特性', description: '薄壁小孔移频后 f′ = f0·√(1+Mc/Mh)（式9）；开启 F2/F3 后取阻抗法 TL 峰值频率' },
    { key: 'tl', label: '传递损失峰值', symbol: 'TL', unit: 'dB', primary: true, group: '声学特性', description: '共振频率处的传递损失，已计入颈部口辐射阻（式17 实部），为有限物理峰值；模态模型取扫描峰值' },
    { key: 'c', label: '介质声速', symbol: 'c', unit: 'm/s', group: '声学特性', description: 'c = 331.3 + 0.606t（t 为摄氏温度，式3）' },
    { key: 'ka', label: '无量纲波数', symbol: 'ka', unit: '—', group: '模态适用性', description: 'ka = 2πf0·a/c，a 为腔体最大边；ka < 0.5 时集总参数假设成立' },
    { key: 'f100', label: '最低阶腔体模态', symbol: 'f100', unit: 'Hz', group: '模态适用性', description: '矩形腔最低阶非零模态 f100 = (c/2)·min(1/Lx,1/Ly,1/Lz)；需填写三边尺寸' },
    { key: 'fRatio', label: 'f0/f100', symbol: 'f0/f100', unit: '—', group: '模态适用性', description: '< 0.2 可按集总参数；0.2~0.5 需检查；> 0.5 应开启腔体模态修正' },
    { key: 'psiFit', label: '对标所需外端修正系数 ψ*', symbol: 'ψ*', unit: '—', group: '频率对标', showIf: { key: 'fTarget', min: 1e-9 }, description: '使 f0 等于目标的 H0 端部修正系数：δ* = S_a/(V(2πf_t/c)²) − 有效颈部长度，ψ* = δ*/d；可直接填入「外端修正系数 ψ」' },
    { key: 'deltaFit', label: '对标所需总端部修正 δ_total*', symbol: 'δ*', unit: 'mm', unitGroup: 'length', group: '频率对标', showIf: { key: 'fTarget', min: 1e-9 }, description: 'H1 标定应得的 δ_total；用「目标 f0」多样本跑一次 H1 标定并发布即可对齐' },

    { key: 'Vc', label: '净腔体体积', symbol: 'Vc', unit: 'L', unitGroup: 'volume', group: '§3.2 插入修正中间量', description: '实际参与计算的净腔体体积；毛体积口径时已自动扣 Vwall + Sc·h' },
    { key: 'cavityGrossNum', label: '体积口径', symbol: '—', unit: '—', group: '§3.2 插入修正中间量', description: '0=净腔体（直接用），1=毛腔体（已扣 Vwall + Sc·h）' },
    { key: 'Vwall', label: '管壁体积 Vwall', symbol: 'Vwall', unit: 'cm³', unitGroup: 'volume', group: '§3.2 插入修正中间量', description: 'Vwall = π[(d+2t)²−d²]/4·Lt；tWall=0 时此项为 0（毛腔体只扣 Sc·h）' },
    { key: 'lengthKind', label: '长度口径', symbol: '—', unit: '—', group: '§3.2 插入修正中间量', description: '0=总长（推荐，lc 已含 h），1=外露长度（lc 需补 h）' },
    { key: 'exposedLen', label: '外露长度 Lexposed', symbol: 'Lexposed', unit: 'mm', unitGroup: 'length', group: '§3.2 插入修正中间量', description: '自动校验：总长口径下 Lexposed = Lt − h；外露长度口径下 Lexposed = lc' },
    { key: 'hInsert', label: '喉管插入深度', symbol: 'h', unit: 'mm', unitGroup: 'length', group: '§3.2 插入修正中间量', description: '喉管伸入腔体的深度；总长口径下用于校验 Lexposed，外露长度口径下 leff 会叠加 h' },
    { key: 'deltaOut', label: '外端修正 δ_out', symbol: 'δ_out', unit: 'mm', unitGroup: 'length', group: '§3.2 插入修正中间量', description: 'δ_out = ψ·d；ψ 默认 0.75（管道旁支/有限壁面；自由场 flanged 取 0.85）' },
    { key: 'deltaIn', label: '内端修正 δ_in', symbol: 'δ_in', unit: 'mm', unitGroup: 'length', group: '§3.2 插入修正中间量', description: '喉管内端辐射修正，默认 0，需试验/声学标定' },
    { key: 'lEff', label: '喉管有效长度', symbol: 'l_eff', unit: 'mm', unitGroup: 'length', group: '§3.2 插入修正中间量', description: '总长口径：leff = Lt + δ_out,eff + δ_in；外露长度口径：leff = Lexposed + h + δ_out,eff + δ_in；斜插时 δ_out,eff = δ_out / sin(α)' },

    // ===== §3.3 相贯口修正输出 =====
    { key: 'intersectKind', label: '相贯口修正方式', symbol: '—', unit: '—', group: '§3.3 相贯口修正', description: '0=垂直插入（无修正），1=斜插相贯角，2=自定义系数' },
    { key: 'intersectAlpha', label: '相贯角 α', symbol: 'α', unit: '°', group: '§3.3 相贯口修正', showIf: { key: 'intersectKind', min: 1, max: 1 }, description: '相贯角输入值（喉管中心线与主管壁面夹角）' },
    { key: 'kSeff', label: 'Seff / Sc', symbol: 'k_Seff', unit: '—', group: '§3.3 相贯口修正', description: '流通面积折减系数；斜插时 k_Seff ≈ sin(α)；自定义时由实验/FEM 标定' },
    { key: 'scEff', label: '相贯口有效面积 Seff', symbol: 'Seff', unit: 'mm²', unitGroup: 'area', group: '§3.3 相贯口修正', description: 'Seff = Sc · k_Seff；斜插时椭圆流通面积折减' },
    { key: 'deltaOut', label: 'δ_out（垂直基准）', symbol: 'δ_out', unit: 'mm', unitGroup: 'length', group: '§3.3 相贯口修正', description: '垂直插入时的外端修正，δ_out = ψ·d（ψ 默认 0.75）' },
    { key: 'deltaOutEff', label: 'δ_out,eff（相贯修正后）', symbol: 'δ_out,eff', unit: 'mm', unitGroup: 'length', group: '§3.3 相贯口修正', description: '斜插时 δ_out,eff = δ_out / sin(α)（椭圆辐射阻抗 > 圆孔）；垂直插入时等于 δ_out' },
    { key: 'intersectNote', label: '相贯口修正摘要', symbol: '—', unit: '—', group: '§3.3 相贯口修正', description: '自动生成的修正参数摘要，便于快速核对' },

    { key: 'sc', label: '喉管截面积', symbol: 'Sc', unit: 'mm²', unitGroup: 'area', group: '基本几何', description: 'Sc = π·d²/4' },
    { key: 'sp', label: '管道截面积', symbol: 'Sp', unit: 'mm²', unitGroup: 'area', group: '基本几何', description: 'Sp = π·D²/4' },
    { key: 'sh', label: '小孔总面积', symbol: 'Sh', unit: 'mm²', unitGroup: 'area', group: '小孔修正', showIf: { key: 'dh', min: 1e-9 }, description: 'Sh = nh·πdh²/4（式6）' },
    { key: 'mc', label: '喉管声质量', symbol: 'Mc', unit: 'kg/m⁴', group: '小孔修正', description: 'Mc = ρ·l_eff/Sc（式7）；l_eff 按式3-2含插入深度与两端修正' },
    { key: 'mh', label: '小孔声质量', symbol: 'Mh', unit: 'kg/m⁴', group: '小孔修正', showIf: { key: 'dh', min: 1e-9 }, description: 'Mh = ρ(th+0.75dh)/Sh（式7）' },
    { key: 'meq', label: '等效声质量', symbol: 'Meq', unit: 'kg/m⁴', group: '小孔修正', showIf: { key: 'dh', min: 1e-9 }, description: 'Meq = Mc·Mh/(Mc+Mh)（式8）；未开孔时等于 Mc' },
  ],
  latex: [
    {
      label: '§3.2 喉管插入与体积口径（V3.0 新增）',
      tex: 'V_c = V_{input}\\;(\\text{净腔体}),\\quad V_c = V_g - V_{wall} - S_c h\\;(\\text{毛腔体}),\\quad V_{wall}=\\frac{\\pi}{4}\\left[(d+2t_w)^2-d^2\\right]L_t',
    },
    {
      label: '§3.2 长度口径与有效长度',
      tex: '\\text{总长口径（推荐）:}\\; l_{eff} = L_t + \\delta_{out} + \\delta_{in},\\quad \\delta_{out}=\\psi d\\ (\\psi\\text{ 默认 }0.75;\\ \\text{管道旁支 }0.75/\\text{自由场 flanged }0.85)\\qquad \\text{外露长度口径:}\\; l_{eff} = L_{exposed} + h + \\delta_{out} + \\delta_{in},\\quad L_{exposed}=L_t-h',
    },
    {
      label: '密封腔中心频率（§3.1 / 式3-3）',
      tex: 'f_0 = \\frac{c}{2\\pi}\\sqrt{\\frac{S_{eff}}{V_c\\,l_{eff}}},\\qquad S_c=\\frac{\\pi d^2}{4},\\; S_{eff}=k_{Seff}\\,S_c,\\; c \\approx 331.3 + 0.606t',
    },
    {
      label: '腔体声容与声质量（式4、7）',
      tex: 'C_a = \\frac{V_c}{\\rho c^2},\\qquad M_c = \\frac{\\rho\\,l_{eff}}{S_{eff}},\\qquad M_h = \\frac{\\rho\\left(t_h + 0.75d_h\\right)}{S_h},\\qquad S_h = \\frac{n_h\\pi d_h^2}{4}',
    },
    {
      label: '§3.3 喉管与主管相贯口修正（文档式3-4/3-5 + 工程实现）',
      tex: '\\text{文档圆周积分: } S_{eff}=\\frac{1}{2\\pi}\\int S(\\theta)\\,d\\theta,\\quad \\delta_{out,eff}=\\frac{\\int \\delta_{out}(\\theta)\\,S(\\theta)\\,d\\theta}{\\int S(\\theta)\\,d\\theta}\\\\\n\\text{工程近似（斜插夹角 }\\alpha\\text{）: } k_{Seff}=\\sin\\alpha,\\; \\delta_{out,eff}=\\frac{\\psi d}{\\sin\\alpha},\\quad \\alpha=90°\\text{ 时退化为垂直插入 }',
    },
    {
      label: '薄壁小孔移频（§4 / 式8~9）',
      tex: 'M_{eq} = \\frac{M_c M_h}{M_c + M_h},\\qquad f\' = f_0\\sqrt{1 + \\frac{M_c}{M_h}} = f_0\\sqrt{\\frac{M_c}{M_{eq}}}',
    },
    {
      label: '总输入阻抗（§5 / 式10~12）',
      tex: 'Z_{in} = Z_n + \\left[Z_h^{-1} + Z_{cav}^{-1} + Z_{shell}^{-1}\\right]^{-1},\\qquad Z_{shell} = \\sum_s \\frac{\\Gamma_s^2}{j\\omega\\Lambda_s\\left(\\omega_s^2-\\omega^2+j\\eta_s\\omega_s\\omega\\right)}',
    },
    {
      label: '腔体模态声阻抗（§6 / 式14~16）',
      tex: 'Z_{cav} = \\sum_n \\frac{\\Gamma_n^2\\rho c^2}{j\\omega\\Lambda_n\\left(\\omega_n^2-\\omega^2+j\\eta_n\\omega_n\\omega\\right)},\\qquad f_{mnp} = \\frac{c}{2}\\sqrt{\\left(\\frac{m}{L_x}\\right)^2+\\left(\\frac{n}{L_y}\\right)^2+\\left(\\frac{p}{L_z}\\right)^2}',
    },
    {
      label: '辐射阻抗与传递损失（§6 / 式17~19）',
      tex: 'Z_{rad} = \\frac{\\rho c}{S}\\left[\\theta(ka) + j\\chi(ka)\\right],\\qquad Z_0 = \\frac{\\rho c}{S_p},\\qquad TL = 10\\,\\lg\\left|1 - \\frac{Z_0}{2Z_{in}}\\right|^2',
    },
    {
      label: '模型选用（§8 / 表8-1）',
      tex: 'ka<0.5\\;\\text{且密封} \\Rightarrow F0;\\quad ka<0.5\\;\\text{且薄壁小孔} \\Rightarrow F1;\\quad f_0/f_{100}>0.2 \\Rightarrow \\text{开启 F3};\\quad \\text{壳体低阶模态接近} \\Rightarrow \\text{并入 F2}',
    },
  ],
  diagram: HELMHOLTZ_DIAGRAM,
  sensitivity: true,
  assumptions: [
    '按《赫姆霍兹消音器理论计算公式》V3.0（2026-11）实现 §3.1 密封腔 / §3.2 喉管插入 / §3.3 相贯口 / §4 薄壁小孔 / §5 壳体耦合 / §6 模态+辐射 / §7 开孔位置因子',
    '§3.2 喉管插入修正：l_eff = lc + h + δout + δin(h)，δout = ψ·d（ψ 可输入，默认 0.75；管道旁支/有限壁面 0.75，自由场大障板 flanged 0.85），δin 默认 0 表示未插入或内端修正对称；严格值需试验/三维声学标定（0~0.6d 量级）',
    '§3.2 体积口径：输入默认"净腔体"（V 已是扣喉管后的体积）；选"毛腔体"时软件自动按式(A-10)扣 Sc·h（喉管插入段的空气柱体积），不扣管壁体积 Vwall',
    '§3.3 相贯口平均（进阶）：文档式(3-4)(3-5)给出沿圆周加权平均 l̄eff / Seff 的积分形式；软件当前未实现自动积分，复杂相贯口建议三维声学仿真',
    '腔体模态采用矩形刚性壁解析振型 φ = cos(mπξ)cos(nπψ)cos(pπζ)，归一化 Λn = V/(εmεnεp)，模态声阻抗含 ρc² 因子以保证单位为 Pa·s/m³',
    '壳体模态参数（模态频率、阻尼比、模态质量系数 Ks = ms/As²、位置耦合因子 Γs）无法由几何推出，需由模态分析、FEM 或试验提供；Ks 越大表示壳体越"重"、与腔内耦合越弱',
    '壳体模态数 ns > 0 但某阶频率填 0 时，该阶不参与计算；ns = 0 表示刚性壳体（Zshell → ∞）',
    '辐射阻抗按式(17) 计入实部：θ = (ka)²（带障板）/ (ka)²/2（无障板），ka 取颈部半径；端部条件沿用 ψ（≥0.8 视为 flanged）。虚部（辐射质量）不再另加，已由 δ_out = ψd 计入 leff',
    '声速 c = 331.3 + 0.606t（t 为摄氏温度），式(3)；空气密度默认 1.204 kg/m³（20℃）',
    '薄壁小孔要求孔口无倒角、无网布/多孔材料，且 dh 远小于腔体尺寸；dh 填 0 时退化为密封腔 F0',
    '集总模型（F0/F1）已计入颈部口辐射阻，共振峰值有限；若仍需更低的峰值，可开启 F3 腔体模态或填写黏热损耗等效阻尼',
    '适用于单腔旁支亥姆霍兹共振器；大孔、强流、强壳体振动或复杂相贯口时简化公式失效，应以试验/FEM 为准',
    '工程设计中 TL 峰值频率应正对噪声主导频率；带宽较窄，宽频降噪需组合多腔或与扩张腔配合',
  ],
  solve(v) {
    const empty = {
      fr: NaN, fp: NaN, tl: NaN, c: NaN, sc: NaN, sp: NaN, lEff: NaN,
      sh: NaN, mc: NaN, mh: NaN, meq: NaN, ka: NaN, f100: NaN, fRatio: NaN,
      Vc: NaN, hInsert: NaN, deltaOut: NaN, deltaIn: NaN, cavityGrossNum: 0,
      psiFit: NaN, deltaFit: NaN,
    };
    const r = derive(v);
    if (!r) return empty;
    const { f0, c, sc, sp, lEff, sh, mc, mh, meq, ca, z0, ka, f100, fRatio, imp, radR,
            Vc, hInsert, deltaOut, deltaIn, cavityGrossNum, sArea, lengthKind } = r;
    let fp = r.fp;
    let tl: number;
    if (imp) {
      // F2/F3：阻抗法扫描求 TL 峰值及其频率
      const curve = modalTlCurve(f0, imp);
      let idx = 0;
      for (let i = 1; i < curve.length; i++) if (curve[i].y > curve[idx].y) idx = i;
      fp = curve[idx].x;
      tl = curve[idx].y;
    } else {
      // F0/F1：解析共振频率 + 密集采样取峰值（含颈部口辐射阻）
      const ys = denseTlCurve(fp, meq, ca, z0, radR).map((p) => p.y);
      tl = ys.length ? Math.max(...ys) : 0;
    }
    // 频率对标：由目标 f0 反推所需端部修正（仅展示，不改变本次计算）
    // f = c/(2π)·√(S_a/(V·leff)) ⇒ leff* = S_a/(V·(2πf/c)²)，δ* = leff* − 有效颈部长度
    let psiFit = NaN;
    let deltaFit = NaN;
    const fT = v.fTarget ?? 0;
    if (fT > 0 && sArea > 0 && Vc > 0 && c > 0 && v.d > 0) {
      const wT = (2 * Math.PI * fT) / c;
      const leffT = sArea / (Vc * wT * wT);
      const baseLen = lengthKind === 0 ? v.lc : v.lc + hInsert;
      deltaFit = leffT - baseLen;
      psiFit = deltaFit / v.d;
    }
    return {
      fr: f0, fp, tl, c, sc, sp, lEff,
      sh: sh > 0 ? sh : NaN,
      mc, mh, meq, ka, f100, fRatio,
      Vc, hInsert, deltaOut, deltaIn, cavityGrossNum,
      psiFit, deltaFit,
    };
  },
  curve: {
    label: '传递损失 TL 曲线',
    xLabel: 'Frequency (Hz)',
    yLabel: 'TL (dB)',
    compute(v) {
      const r = derive(v);
      if (!r || !Number.isFinite(r.f0) || r.f0 <= 0) return [];
      if (r.imp) return modalTlCurve(r.f0, r.imp);
      return denseTlCurve(r.fp, r.meq, r.ca, r.z0, r.radR);
    },
  },
  benchmarks: [
    {
      name: '默认密封腔（V=0.5L, lc=30mm, d=20mm, t=25℃, D=60mm）',
      input: { V: 5e-4, lc: 0.03, d: 0.02, t: 298.15, D: 0.06 },
      expect: {
        fr: 206.0366,
        fp: 206.0366,
        c: 346.45,
        sc: 3.141592653589793e-4,
        sp: 2.827433388230814e-3,
        lEff: 0.045,
      },
      tolerance: 2e-3,
      source: '按式(1)~(3)手工核算：c=331.3+0.606×25=346.45，δout=ψd=0.75×20=15mm，leff=30+15=45mm，f0 = 346.45/(2π)·√(3.1416e-4/(5e-4×0.045))',
    },
    {
      name: '变工况密封腔（V=1L, lc=50mm, d=25mm, t=0℃, D=80mm）',
      input: { V: 1e-3, lc: 0.05, d: 0.025, t: 273.15, D: 0.08 },
      expect: {
        fr: 140.8932,
        c: 331.3,
        sc: 4.908738521234052e-4,
        sp: 5.026548245743669e-3,
        lEff: 0.06875,
      },
      tolerance: 5e-3,
      source: '0℃ 时 c=331.3 m/s；δout=ψd=0.75×25=18.75mm，leff=50+18.75=68.75mm，f0 = 331.3/(2π)·√(4.9087e-4/(1e-3×0.06875)) ≈ 140.9 Hz',
    },
    {
      name: '文档算例：薄壁小孔移频（V=0.5L, lc=30mm, d=20mm, D=60mm, t=25℃, dh=5mm, th=2mm, nh=1）',
      input: { V: 5e-4, lc: 0.03, d: 0.02, t: 298.15, D: 0.06, dh: 0.005, th: 0.002, nh: 1, rho: 1.204 },
      expect: {
        fr: 206.0366,
        fp: 251.4263,
        sh: 1.9634954e-5,
        mc: 172.4603,
        mh: 352.5855,
        meq: 115.8128,
      },
      tolerance: 5e-3,
      source: '按文档式(8-2)/(8-3)核算：Sh=1.9635e-5 m²，δout=ψd（ψ=0.75）→ Mc/Mh≈0.489，f′≈206.04×√1.489≈251.4 Hz',
    },
    {
      name: '标定样件：V=1.5L、喉管 45×25mm、主管 D=60mm、15℃（f0=122.743 Hz）',
      input: { V: 1.5e-3, lc: 0.045, d: 0.025, t: 288.15, D: 0.06 },
      expect: {
        fr: 122.742835,
        fp: 122.742835,
        c: 340.39,
        sc: 4.908738521234052e-4,
        sp: 2.827433388230814e-3,
        lEff: 0.06375,
        deltaOut: 0.01875,
      },
      tolerance: 1e-6,
      source: '标定样件（无管道插入、无开孔、未开腔体模态、未计辐射质量）：δout=ψd=0.75×25=18.75mm，leff=45+18.75=63.75mm，f0=340.39/(2π)·√(4.9087e-4/(1.5e-3×0.06375))=122.743 Hz；ψ=0.75 即由此数据锁定为默认',
    },
  ],
};
