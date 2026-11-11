import { createModel, nowIso, uid, type ModelTemplate, type ProductModel } from './types';

/** 空白模板：用于不依赖既有型号、手工搭建需求与参数骨架 */
export function createBlankTemplate(): ModelTemplate {
  return {
    id: uid(),
    name: '',
    system: '',
    description: '',
    sourceModelId: null,
    standards: [],
    requirements: [],
    params: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

/** 保存前校验：只拦会直接导致模板不可用的问题 */
export function templateIssues(tpl: ModelTemplate): string[] {
  const issues: string[] = [];
  if (!tpl.name.trim()) issues.push('模板名称不能为空');
  if (tpl.requirements.length === 0 && tpl.params.length === 0) {
    issues.push('至少需要一条需求或一个关键参数');
  }
  const reqNames = tpl.requirements.map((r) => r.name.trim());
  if (reqNames.some((n) => !n)) issues.push('需求项名称不能为空');
  else if (new Set(reqNames).size !== reqNames.length) issues.push('需求项名称重复');

  const keys = tpl.params.map((p) => p.key.trim());
  if (keys.some((k) => !k)) issues.push('参数键不能为空');
  else if (new Set(keys).size !== keys.length) issues.push('参数键重复');
  return issues;
}

export interface TemplateSeed {
  name: string;
  system?: string;
  description?: string;
}

/** 从型号提炼模板：保留需求目标与参数定义，清空参数取值 */
export function templateFromModel(model: ProductModel, seed: TemplateSeed): ModelTemplate {
  return {
    id: uid(),
    name: seed.name.trim() || `${model.name} 模板`,
    system: seed.system?.trim() || '',
    description: seed.description?.trim() || '',
    sourceModelId: model.id,
    standards: [...model.standards],
    requirements: model.requirements.map((r) => ({ ...r, id: uid() })),
    params: model.params.map((p) => ({ ...p, id: uid(), value: null })),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export interface NewModelSeed {
  /** 新型号 P/N */
  id: string;
  name?: string;
  customer?: string;
  owner?: string;
}

/** 套用模板生成型号：主键重生成、参数待取值、状态草稿、基线清空 */
export function modelFromTemplate(tpl: ModelTemplate, familyId: string, seed: NewModelSeed): ProductModel {
  return createModel(familyId, {
    id: seed.id.trim(),
    name: seed.name?.trim() || `${tpl.name} 新号`,
    customer: seed.customer ?? '',
    owner: seed.owner ?? '',
    status: 'draft',
    derivedFrom: tpl.sourceModelId,
    standards: [...tpl.standards],
    requirements: tpl.requirements.map((r) => ({ ...r, id: uid() })),
    params: tpl.params.map((p) => ({ ...p, id: uid(), value: null })),
    calcRefs: [],
  });
}
