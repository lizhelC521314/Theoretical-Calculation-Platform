/**
 * 公式依赖与组合链路
 *
 * 把一个公式的输出接到另一个公式的输入，形成「试验拟合 → 部件设计」的可追溯链路。
 * 传递值一律按公式内部统一的 SI 量传递，单位换算在此集中处理：
 *   direct  直接取输出值
 *   inverse 取倒数（如渗透率 K = 1/(Fluent 粘性阻力 1/α)）
 *   half    ×0.5（Forchheimer 系数 β = C₂/2）
 *   times2  ×2（惯性阻尼 β = 2/C₂）
 *
 * 物理口径（链路成立的共同前提）：
 *   三条压降式描述的是同一物理模型——Darcy 粘性项 + Forchheimer 惯性项：
 *     Fluent 源项（单位厚度）  Δp/t = (μ/α)·v + ½·ρ·C₂·v²
 *     空气滤清器滤材          Δp/t = μ·v/K + ρ·β·v²
 *     进气系统阻力（褶皱高 h_c）Δp  = (μ·α_v·v + (ρ/β)·v²)·h_c
 *   因此链路的实质是「同一个二次阻力曲线的不同写法之间做系数映射」，
 *   逐项对比即得变换关系；量纲自检由 linkDimensionIssue 固化。
 *
 *   链路的适用条件（超出则应视为估算）：
 *   - 上游拟合的试件与下游部件属同一多孔介质、同一流动方向（厚度方向），
 *     否则 K、β 的数值不可移植（褶皱、胶线、边框会引入额外阻力）；
 *   - 上游拟合所用 ρ、μ 应与下游计算取同一温度工况，否则粘性项/惯性项
 *     的温度相关性会以系数误差的形式进入下游；
 *   - Forchheimer 二次式仅在拟合所覆盖的流速区间内可信，外推需谨慎。
 */
import { getFormula } from './registry';
import type { FormulaSpec } from './types';

export type LinkTransform = 'direct' | 'inverse' | 'half' | 'times2';

export const LINK_TRANSFORM_LABEL: Record<LinkTransform, string> = {
  direct: '直接带入',
  inverse: '取倒数',
  half: '取一半',
  times2: '取 2 倍',
};

export interface FormulaLink {
  /** 上游公式 id */
  from: string;
  /** 上游输出 key（SI 值） */
  output: string;
  /** 下游公式 id */
  to: string;
  /** 下游输入 key（SI 值） */
  input: string;
  transform: LinkTransform;
  /** 物理含义说明，带入提示与文档共用 */
  note: string;
  /** 物理推导（压降式逐项对应），在计算页链路面板展示 */
  derivation?: string;
}

/**
 * 已声明的公式链路。
 *
 * 四条链均以「多孔介质试验拟合」为上游，按压降式逐项映射到两个下游公式：
 *  - 空气滤清器滤芯：K = 1/α，β = C₂/2（其压降式用 ρ·β·v²）
 *  - 进气系统阻力：α_v = 1/α，β = 2/C₂（其压降式用 (ρ/β)·v²）
 * 两条链对同一个 C₂ 的用法互为倒数（β 一为系数、一为分母），
 * 故显式声明变换而不做隐式换算，避免把系数口径当成单位差异。
 * 注意：这里是系数映射，不改变物理模型；四个变换均只乘除常数，不引入新量纲。
 */
export const FORMULA_LINKS: FormulaLink[] = [
  /**
   * 粘性阻力 → 滤材渗透率（取倒数）
   *
   * 上游（Fluent 源项，单位厚度）：Δp/t = (μ/α)·v + ½·ρ·C₂·v²
   * 下游（滤材压降，单位厚度）：   Δp/t = μ·v/K + ρ·β·v²
   * 粘性项逐项对应 μ·v/K ≡ (μ/α)·v ⇒ K = α = 1/(1/α)
   * 量纲：1/α [m⁻²] → K [m²]，故必须取倒数；渗透率为 0 时返回 NaN 而非无穷大。
   */
  {
    from: 'fluid.filter.porous-media-fitting',
    output: 'viscousFluent',
    to: 'structure.airFilter.element',
    input: 'K',
    transform: 'inverse',
    note: '渗透率 K = 1/(Fluent 粘性阻力系数 1/α)',
    derivation: '粘性项 μ·v/K ≡ (μ/α)·v ⇒ K = 1/(1/α)，量纲 m⁻² → m²',
  },
  /**
   * Fluent 惯性系数 → 滤材 Forchheimer 系数（取一半）
   *
   * 上游惯性项：½·ρ·C₂·v²；下游惯性项：ρ·β·v²
   * ⇒ β = C₂/2（即 C₂ = 2β）
   * 量纲：C₂ [m⁻¹] 与 β [m⁻¹] 同量纲，此处只是系数口径差别，不做单位换算。
   */
  {
    from: 'fluid.filter.porous-media-fitting',
    output: 'c2Fluent',
    to: 'structure.airFilter.element',
    input: 'beta',
    transform: 'half',
    note: '惯性系数 β = C₂/2（压降式 Δp = μ·v·t/K + ρ·β·v²·t）',
    derivation: '惯性项 ½·ρ·C₂·v² ≡ ρ·β·v² ⇒ β = C₂/2，两侧同为 m⁻¹',
  },
  /**
   * 粘性阻力 → 进气阻力粘性阻尼系数（直接带入）
   *
   * 上游：Δp/t = (μ/α)·v + …
   * 下游（式 13）：Δp = (μ·α_v·v + (ρ/β)·v²)·h_c
   * ⇒ α_v = 1/α。Fluent 的 1/α 与 α_v 同名同义、同为 m⁻²，可直接带入。
   * 与空气滤清器链路的区别：那里求渗透率需取倒数，此处保留「阻力」形式。
   */
  {
    from: 'fluid.filter.porous-media-fitting',
    output: 'viscousFluent',
    to: 'fluid.intakeSystemResistance',
    input: 'alphaV',
    transform: 'direct',
    note: '粘性阻尼系数 α_v 与 Fluent 1/α 同义',
    derivation: '粘性项 μ·α_v·v ≡ (μ/α)·v ⇒ α_v = 1/α，同为 m⁻²',
  },
  /**
   * Fluent 惯性系数 → 进气阻力惯性阻尼系数（取 2 倍）
   *
   * 下游二次项写作 (ρ/β)·v²，令其等于 ½·ρ·C₂·v² ⇒ 1/β = C₂/2 ⇒ β = 2/C₂
   * 量纲：C₂ [m⁻¹] → β [m⁻¹]，同为 m⁻¹，仅系数口径不同。
   * 因此该 β 与空气滤清器的 β（= C₂/2）互为倒数，不可互相代入。
   */
  {
    from: 'fluid.filter.porous-media-fitting',
    output: 'c2Fluent',
    to: 'fluid.intakeSystemResistance',
    input: 'betaF',
    transform: 'times2',
    note: '惯性阻尼系数 β = 2/C₂（压降式含 (ρ/β)·v² 项）',
    derivation: '惯性项 (ρ/β)·v² ≡ ½·ρ·C₂·v² ⇒ β = 2/C₂，与空滤的 β = C₂/2 互为倒数',
  },
];

/**
 * 链路物理依据（面向界面展示）：计算页链路面板与计算书共用同一份文案。
 * 只描述模型与前提，不参与计算；数值换算仍由 FORMULA_LINKS 的 transform 决定。
 */
export interface LinkPhysics {
  /** 阻力模型名称 */
  model: string;
  /** 各公式的压降式（纯文本，逐条对应） */
  equations: Array<{ label: string; text: string }>;
  /** 链路实质 */
  summary: string;
  /** 适用条件 */
  conditions: string[];
}

export const LINK_PHYSICS: LinkPhysics = {
  model: '多孔介质 Darcy + Forchheimer 阻力模型',
  equations: [
    { label: 'Fluent 源项（单位厚度）', text: 'Δp/t = (μ/α)·v + ½·ρ·C₂·v²' },
    { label: '空气滤清器滤材', text: 'Δp/t = μ·v/K + ρ·β·v²' },
    { label: '进气系统阻力（褶皱高 h_c）', text: 'Δp = [μ·α_v·v + (ρ/β)·v²]·h_c' },
  ],
  summary:
    '三条压降式描述同一条二次阻力曲线，链路只是在系数写法之间做映射，不改变物理模型：粘性项对应 K = 1/α，惯性项对应 β = C₂/2 与 β = 2/C₂。',
  conditions: [
    '上游拟合试件与下游部件须为同一多孔介质、同一流动方向（厚度方向）',
    '上游拟合所用 ρ、μ 应与下游计算的温度工况一致',
    'Forchheimer 二次式仅在拟合覆盖的流速区间内可信，外推应视为估算',
  ],
};

/** 本公式的上游链路（其输出带入本公式输入） */
export function upstreamLinks(formulaId: string): FormulaLink[] {
  return FORMULA_LINKS.filter((l) => l.to === formulaId);
}

/** 本公式的下游链路（本公式输出带入其他公式输入） */
export function downstreamLinks(formulaId: string): FormulaLink[] {
  return FORMULA_LINKS.filter((l) => l.from === formulaId);
}

/**
 * 按链路的变换规则，把上游输出的 SI 值换算为下游输入的 SI 值。
 *
 * 四种变换都是「同一阻力项的系数改写」，不涉及单位制换算：
 *   inverse 渗透率 K = α = 1/(1/α)——粘性阻力与渗透率互为倒数（m⁻² ↔ m²）
 *   half    β = C₂/2——下游压降式未含 ½ 因子，故吸收到系数中
 *   times2  β = 2/C₂——下游把 C₂/2 写进了分母 (ρ/β)
 *   direct  同一物理量直接传递（如 1/α ↔ α_v）
 * 上游值非有限或取倒数遇到 0 时返回 NaN，由调用方提示「链路值不可用」。
 */
export function applyLinkTransform(link: FormulaLink, valueSI: number): number {
  if (!Number.isFinite(valueSI)) return NaN;
  switch (link.transform) {
    case 'inverse':
      return valueSI === 0 ? NaN : 1 / valueSI;
    case 'half':
      return valueSI / 2;
    case 'times2':
      return valueSI * 2;
    default:
      return valueSI;
  }
}

/**
 * 单位分组归一：同一物理量在公式中可能使用不同分组名。
 * 物理含义：inverseArea = 1/面积（1/α、α_v，m⁻²）、permeability = 渗透率 K（m²）、
 * inverseLength = 1/长度（C₂、β，m⁻¹）；分组名不同但量纲相同，故先归一再加校验。
 */
const DIM_NORMAL: Record<string, string> = {
  inverseArea: 'inverseArea',
  /** 进气阻力的 α_v 分组名，实为 1/α（m⁻²） */
  viscousDrag9: 'inverseArea',
  permeability: 'permeability',
  inverseLength: 'inverseLength',
  /** 进气阻力的 β 分组名，实为 Forchheimer 惯性系数（m⁻¹） */
  forchheimerInertia4: 'inverseLength',
};

/**
 * 自检：链路引用的公式、输入、输出是否存在，变换前后量纲是否一致。
 * 返回问题描述列表（空数组表示全部通过），供单元测试与开发期自检使用。
 */
export function validateLinks(links: FormulaLink[] = FORMULA_LINKS): string[] {
  const issues: string[] = [];
  for (const l of links) {
    const from = getFormula(l.from);
    const to = getFormula(l.to);
    const tag = `${l.from}.${l.output} → ${l.to}.${l.input}`;
    if (!from) {
      issues.push(`${tag}：上游公式不存在`);
      continue;
    }
    if (!to) {
      issues.push(`${tag}：下游公式不存在`);
      continue;
    }
    const out = from.outputs.find((o) => o.key === l.output);
    const inp = to.inputs.find((i) => i.key === l.input);
    if (!out) {
      issues.push(`${tag}：上游输出不存在`);
      continue;
    }
    if (!inp) {
      issues.push(`${tag}：下游输入不存在`);
      continue;
    }
    const dim = linkDimensionIssue(out.unitGroup, inp.unitGroup, l.transform);
    if (dim) issues.push(`${tag}：${dim}`);
  }
  return issues;
}

/**
 * 量纲一致性：inverse 要求 m⁻² → m²，其余变换要求同量纲。
 * 物理依据：inverse 改变的是「阻力 ↔ 渗透率」这一对互逆量，量纲必然翻转；
 * direct/half/times2 只改系数口径，量纲必须保持不变。
 */
export function linkDimensionIssue(
  outGroup: string | undefined,
  inGroup: string | undefined,
  transform: LinkTransform,
): string | null {
  if (!outGroup || !inGroup) return null;
  const o = DIM_NORMAL[outGroup] ?? outGroup;
  const i = DIM_NORMAL[inGroup] ?? inGroup;
  if (transform === 'inverse') {
    return o === 'inverseArea' && i === 'permeability'
      ? null
      : `取倒数要求「1/面积 → 面积」，实际为「${outGroup} → ${inGroup}」`;
  }
  return o === i ? null : `量纲不一致：「${outGroup} → ${inGroup}」（${transform}）`;
}

/** 链路两端公式（用于界面展示标题） */
export function linkEnds(link: FormulaLink): {
  from: FormulaSpec | undefined;
  to: FormulaSpec | undefined;
} {
  return { from: getFormula(link.from), to: getFormula(link.to) };
}
