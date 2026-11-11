/**
 * 公式三大领域：按公司部门实际划分
 *
 *  - fluid     流体设计（含进气系统、冷却 / 热管理等与流路强耦合的热计算）
 *  - structure 结构设计（含强度、疲劳、耐久、电池包封装与模组结构）
 *  - acoustics NVH 设计（声学、振动、噪声、消声器与隔声）
 */
export type Domain = 'fluid' | 'structure' | 'acoustics';

export const DOMAIN_LABEL: Record<Domain, string> = {
  fluid: '流体设计',
  structure: '结构设计',
  acoustics: 'NVH 设计',
};

export const DOMAIN_ORDER: Domain[] = ['fluid', 'structure', 'acoustics'];

/** 参数类型 */
export type ParamKind = 'number' | 'select';

/** 条件显示的单条判断：参数值落在 [min, max] 区间内（缺省端视为无穷） */
export interface ShowIfCondition {
  key: string;
  min?: number;
  max?: number;
}

/**
 * 条件显示：单条条件，或条件数组（数组表示全部满足）。
 * 后者用于组合条件，如「进气管段数 ≥ i」且「该段管型 = 波纹管」。
 */
export type ShowIf = ShowIfCondition | ShowIfCondition[];

/** 判断 showIf 是否满足；参数缺失或为 NaN 时视为不满足 */
export function showIfMatches(cond: ShowIf | undefined, values: Record<string, number>): boolean {
  if (!cond) return true;
  const list = Array.isArray(cond) ? cond : [cond];
  return list.every((c) => {
    const v = Number(values[c.key]);
    return Number.isFinite(v) && v >= (c.min ?? -Infinity) && v <= (c.max ?? Infinity);
  });
}

/**
 * 可从材料库带入的物性字段
 *
 * 三类取值来源：
 *  - 标量物性：MaterialRecord 的同名属性（常规 / 超弹性材料）
 *  - 流体物性（fluid*）：按温度对 fluidPoints 属性表线性插值
 *  - 多孔介质物性（porous*）：读取 porousProps
 */
export type MaterialBindField =
  | 'density'
  | 'poisson'
  | 'elasticModulus'
  | 'tensileStrength'
  | 'failureStrain'
  | 'specificHeat'
  | 'thermalConductivity'
  | 'expansionCoefficient'
  | 'fluidDensity'
  | 'fluidViscosity'
  | 'fluidThermalConductivity'
  | 'fluidSpecificHeat'
  | 'poreSize'
  | 'porousPermeability'
  | 'porousViscousResistance'
  | 'porousInertialResistance'
  | 'porousViscousCoefficient'
  | 'porousInertialCoefficient';

/** 材料绑定声明：该输入可直接从材料库某条记录的物性带入 */
export interface MaterialBind {
  kind: 'material';
  /** 材料库中的物性字段 */
  field: MaterialBindField;
  /** 可接受的材料类型；缺省按字段自动判定（流体字段→流体，多孔字段→多孔介质，其余→常规/超弹性） */
  types?: Array<'conventional' | 'hyperelastic' | 'fluid' | 'porous'>;
  /**
   * 插值温度来源：公式中某个温度输入（℃ / K）的 key。
   * 流体物性随温度变化，必须声明，带入时按该输入的当前值插值。
   */
  temperatureFrom?: string;
}

/** 输入参数定义：界面据此自动生成表单控件 */
export interface ParamSpec {
  /** 内部键名，solve 函数据此取值（统一使用 SI 单位） */
  key: string;
  /** 界面显示名称 */
  label: string;
  /** 符号（用于公式与结果区） */
  symbol: string;
  /** 显示单位 */
  unit: string;
  /** 单位换算分组，同名分组共享同一单位下拉框 */
  unitGroup?: string;
  /** 参数说明 */
  description?: string;
  /**
   * 输入分区标题：相同 group 的连续输入在表单中归为一段，并在段首显示小标题
   * （如「系统组成」「进气管几何」）。留空则紧接上一段、不另起标题。
   */
  group?: string;
  /**
   * 横排流程分组：相同 row 的连续输入在同一行内按列并排显示，用于「系统组成」这类
   * 「段 → 旁支消音器 → 数量」的串联结构；留空则独立占一整行。
   */
  row?: string;
  /** 横排时单元格的小标题（留空则用 label） */
  cellTitle?: string;
  /** 默认值（以 unit 为单位） */
  default?: number;
  kind?: ParamKind;
  options?: { value: number; label: string }[];
  /** 建议取值范围（以 unit 为单位），越界时提示 */
  min?: number;
  max?: number;
  /** 是否必须输入 */
  required?: boolean;
  /**
   * 条件显示：仅当另一参数满足条件时在表单中显示。
   * 用于「按腔数逐腔展开」这类字段——腔数 n 变大后第 i 腔的输入才出现；
   * min/max 可同时或单独使用（如结构型式 1/2 切换：max:1 与 min:2）。
   */
  showIf?: ShowIf;
  /**
   * 材料绑定：声明该输入可取自材料库。
   * 界面据此在该行下方显示「从材料库带入」下拉框，选中后按当前显示单位换算填值；
   * 手工修改数值即视为脱离材料库（不再随材料或单位变化重算）。
   */
  bind?: MaterialBind;
}

/** 输出参数定义 */
export interface OutputSpec {
  key: string;
  label: string;
  symbol: string;
  unit: string;
  /** 单位换算分组，用于结果自动选择显示单位 */
  unitGroup?: string;
  /** 小数位 */
  digits?: number;
  /** 是否作为主结果突出显示 */
  primary?: boolean;
  description?: string;
  /**
   * 结果分组标签。相同分组的输出在结果区会集中在一起，
   * 顶部给出分组小标题（如 "Fluent / STAR-CCM+ / 回代校验"）。
   */
  group?: string;
  /**
   * 条件显示：仅当某输入参数满足条件时，结果区与符号说明表才显示该输出。
   * 与 ParamSpec.showIf 同义——用于「按腔数逐腔展开」的逐腔输出，
   * 腔数 n 之外的腔不参与计算，对应行直接隐藏；min/max 可同时或单独使用。
   */
  showIf?: ShowIf;
}

/** 基准算例：用于自动化回归测试，保证公式实现正确 */
export interface BenchmarkCase {
  name: string;
  /** 输入值（SI 单位） */
  input: Record<string, number>;
  /** 期望输出（SI 单位） */
  expect: Record<string, number>;
  /** 相对容差 */
  tolerance: number;
  /** 算例来源：教材、标准或内部验证数据 */
  source: string;
}

/** 曲线图上的一个数据点 */
export interface CurvePoint {
  x: number;
  y: number;
}

/**
 * 结果曲线：随主结果变化的连续曲线（如消声器 TL - Frequency 曲线）。
 * compute 输入与 solve 相同的 SI 入参，返回已按 x 升序排列的数据点。
 */
export interface CurveSpec {
  /** 曲线标题（界面显示） */
  label: string;
  /** 横轴标签（含单位） */
  xLabel: string;
  /** 纵轴标签（含单位） */
  yLabel: string;
  compute: (v: Record<string, number>) => CurvePoint[];
}

/** 公式生命周期状态 */
export type FormulaStatus = 'draft' | 'review' | 'published' | 'deprecated';

/** 公式状态中文标签 */
export const FORMULA_STATUS_LABEL: Record<FormulaStatus, string> = {
  draft: '草稿',
  review: '评审中',
  published: '已发布',
  deprecated: '已废止',
};

/** 标准 / 规范依据（结构化，便于生成依据清单） */
export interface StandardRef {
  /** 标准号，如 ISO 5011:2025 */
  code: string;
  /** 标准名称 */
  title: string;
  /** 引用的条款号（可选） */
  clause?: string;
}

/** 公式统一描述结构：新增公式只需新增一个该结构的对象 */
export interface FormulaSpec {
  id: string;
  /** 语义化版本号；发布后不原地修改，改动需升版 */
  version: string;
  /** 生命周期状态；仅 published 可用于正式校核 */
  status: FormulaStatus;
  /** 标准 / 规范依据 */
  standardRefs?: StandardRef[];
  domain: Domain;
  /** 所属子系统，用于二级导航 */
  subsystem: string;
  title: string;
  /** 一句话说明用途 */
  summary: string;
  tags: string[];
  /** 详细说明 */
  description: string;
  inputs: ParamSpec[];
  outputs: OutputSpec[];
  /** 主公式与中间公式的 LaTeX 表达式 */
  latex: {
    label: string;
    tex: string;
    /**
     * 条件显示：仅当某输入参数满足条件时才在公式区显示该条公式。
     * 用于「按元件类型切换公式」——选中波纹管/穿孔消音器时才显示其专用公式。
     */
    showIf?: ShowIf;
  }[];
  /** 配套示意图（SVG 字符串，尺寸建议 viewBox 0 0 400 220） */
  diagram?: string;
  /** 结果曲线（可选）：有值时计算页在结果区下方绘制曲线图 */
  curve?: CurveSpec;
  /** 适用条件与假设，界面上以提示条显示 */
  assumptions: string[];
  /** 求解函数：入参与出参均为 SI 单位数值 */
  solve: (v: Record<string, number>) => Record<string, number>;
  benchmarks: BenchmarkCase[];
  /**
   * 是否提供参数敏感性分析，默认开启。
   * 两点拟合类公式（如由两组试验反算系数）单独扫描一个输入会破坏数据对的
   * 内在关联，扫描结果无物理意义，此时应置为 false。
   */
  sensitivity?: boolean;
}
