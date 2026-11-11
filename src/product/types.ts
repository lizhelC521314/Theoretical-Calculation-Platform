/**
 * 产品定义库（P0）：无三维建模条件下，用「需求 → 计算 → 关键参数 → 校核证据 → 版本基线」
 * 描述一个产品型号，替代传统的模型库。
 */

export type ModelStatus = 'draft' | 'review' | 'released' | 'obsolete';

export const MODEL_STATUS_LABEL: Record<ModelStatus, string> = {
  draft: '草稿',
  review: '评审中',
  released: '已发布',
  obsolete: '已停产',
};

export type ParamSource = 'manual' | 'calc' | 'backsolve' | 'link' | 'material';

export const PARAM_SOURCE_LABEL: Record<ParamSource, string> = {
  manual: '手工输入',
  calc: '公式计算',
  backsolve: '反算求解',
  link: '链路带入',
  material: '材料库绑定',
};

export type VerifyKind = 'calc' | 'cae' | 'test';

export const VERIFY_LABEL: Record<VerifyKind, string> = {
  calc: '计算',
  cae: 'CAE',
  test: '试验',
};

/** 需求方向：max 表示「不大于目标值」，min 表示「不小于目标值」 */
export type ReqDirection = 'max' | 'min';

export type ReqPriority = 'CC' | 'SC' | 'normal';

export interface ProductFamily {
  id: string;
  /** 族编码，沿用产品编码规则 */
  code: string;
  name: string;
  /** 所属系统，如 进气系统 */
  system: string;
  /** 结构型式，如 圆柱折叠式 / 面板式 */
  structure: string;
  /** 适用平台或客户 */
  platforms: string;
  /** 该族默认计算链（公式 id 列表） */
  formulaIds: string[];
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Requirement {
  id: string;
  name: string;
  /** 目标值 / 限值 */
  target: number | null;
  unit: string;
  direction: ReqDirection;
  priority: ReqPriority;
  /** 来源：客户 SOR、标准条款等 */
  source: string;
  verify: VerifyKind;
  note: string;
}

export interface DesignParam {
  id: string;
  /** 参数键，与公式输入保持一致，便于带入 */
  key: string;
  label: string;
  value: number | null;
  unit: string;
  min: number | null;
  max: number | null;
  source: ParamSource;
  /** 取值依据：公式名 + 版本 / 材料牌号等 */
  basis: string;
}

/** 关联的历史计算记录（快照关键字段，避免历史被删后无法追溯） */
export interface CalcRef {
  id: string;
  historyId: string;
  formulaId: string;
  formulaTitle: string;
  formulaVersion: string;
  createdAt: string;
  /** 数值型输出，键为输出 key */
  outputs: Record<string, number>;
  conclusion: 'pass' | 'fail' | 'pending';
  note: string;
}

export interface Baseline {
  id: string;
  label: string;
  createdAt: string;
  createdBy: string;
  note: string;
  params: Array<{ key: string; label: string; value: number | null; unit: string }>;
  calcRefIds: string[];
  requirementCount: number;
  errorCount: number;
  warnCount: number;
}

export interface ProductModel {
  /** 型号 P/N，作为主键 */
  id: string;
  familyId: string;
  name: string;
  projectId: string | null;
  customer: string;
  owner: string;
  status: ModelStatus;
  /** 变型来源型号 P/N；自主设计的型号为 null */
  derivedFrom: string | null;
  /** 设计依据标准编号 */
  standards: string[];
  requirements: Requirement[];
  params: DesignParam[];
  calcRefs: CalcRef[];
  baselines: Baseline[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 型号模板：可复用的需求 / 参数 / 标准骨架。
 * 只保存需求目标与参数定义，参数不携带取值，避免把上一项目的计算结果带进新项目。
 */
export interface ModelTemplate {
  id: string;
  name: string;
  /** 适用系统，如 进气系统，用于模板列表快速分辨 */
  system: string;
  description: string;
  /** 生成模板的源型号 P/N */
  sourceModelId: string | null;
  standards: string[];
  requirements: Requirement[];
  params: DesignParam[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductStore {
  families: ProductFamily[];
  models: ProductModel[];
  templates: ModelTemplate[];
}

export const EMPTY_STORE: ProductStore = { families: [], models: [], templates: [] };

export const uid = () => Math.random().toString(36).slice(2, 10);

export function nowIso(): string {
  return new Date().toISOString();
}

export function createFamily(p: Partial<ProductFamily> = {}): ProductFamily {
  const t = nowIso();
  return {
    id: p.id || uid(),
    code: p.code || '',
    name: p.name || '新产品族',
    system: p.system || '',
    structure: p.structure || '',
    platforms: p.platforms || '',
    formulaIds: p.formulaIds || [],
    description: p.description || '',
    createdAt: t,
    updatedAt: t,
  };
}

export function createModel(familyId: string, p: Partial<ProductModel> = {}): ProductModel {
  const t = nowIso();
  return {
    id: p.id || `NEW-${t.slice(0, 10).replace(/-/g, '')}`,
    familyId,
    name: p.name || '新型号',
    projectId: p.projectId ?? null,
    customer: p.customer || '',
    owner: p.owner || '',
    status: p.status || 'draft',
    derivedFrom: p.derivedFrom ?? null,
    standards: p.standards || [],
    requirements: p.requirements || [],
    params: p.params || [],
    calcRefs: p.calcRefs || [],
    baselines: p.baselines || [],
    createdAt: t,
    updatedAt: t,
  };
}

export function createRequirement(p: Partial<Requirement> = {}): Requirement {
  return {
    id: p.id || uid(),
    name: p.name || '',
    target: p.target ?? null,
    unit: p.unit || '',
    direction: p.direction || 'max',
    priority: p.priority || 'normal',
    source: p.source || '',
    verify: p.verify || 'calc',
    note: p.note || '',
  };
}

export function createParam(p: Partial<DesignParam> = {}): DesignParam {
  return {
    id: p.id || uid(),
    key: p.key || '',
    label: p.label || '',
    value: p.value ?? null,
    unit: p.unit || '',
    min: p.min ?? null,
    max: p.max ?? null,
    source: p.source || 'manual',
    basis: p.basis || '',
  };
}

/** 需求达成判断：max 表示值不大于目标，min 表示值不小于目标 */
export function meetsRequirement(req: Requirement, actual: number | null): 'pass' | 'fail' | 'unknown' {
  if (actual == null || !Number.isFinite(actual) || req.target == null) return 'unknown';
  return req.direction === 'max' ? (actual <= req.target ? 'pass' : 'fail') : actual >= req.target ? 'pass' : 'fail';
}

/** 裕度：正数表示有余量，负数表示超限（百分比，基于目标值） */
export function requirementMargin(req: Requirement, actual: number | null): number | null {
  if (actual == null || !Number.isFinite(actual) || req.target == null || req.target === 0) return null;
  const m = req.direction === 'max' ? (req.target - actual) / Math.abs(req.target) : (actual - req.target) / Math.abs(req.target);
  return m * 100;
}

/** 参数是否在给定上下限内 */
export function paramInRange(p: DesignParam): boolean {
  if (p.value == null || !Number.isFinite(p.value)) return true;
  if (p.min != null && p.value < p.min) return false;
  if (p.max != null && p.value > p.max) return false;
  return true;
}
