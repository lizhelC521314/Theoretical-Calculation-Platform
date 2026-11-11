import { createModel, createParam, createRequirement, uid, type ProductModel } from './types';

export interface VariantOptions {
  /** 新型号 P/N */
  id: string;
  name?: string;
  customer?: string;
  owner?: string;
  /** 默认继承源型号的产品族 */
  familyId?: string;
  copyRequirements?: boolean;
  copyParams?: boolean;
  copyStandards?: boolean;
  /** 是否带上源型号的计算记录（默认不带，变型需重新计算取证） */
  copyCalcRefs?: boolean;
  /** 是否保留参数取值；false 时清空数值，便于按新需求重新计算 */
  keepValues?: boolean;
}

/**
 * 以现有型号为模板派生变型：
 * 需求与参数重新生成主键、基线清空、状态回到草稿，并记录 derivedFrom 以保持追溯。
 */
export function createVariant(source: ProductModel, opts: VariantOptions): ProductModel {
  const keepValues = opts.keepValues !== false;
  const requirements =
    opts.copyRequirements === false
      ? []
      : source.requirements.map((r) => createRequirement({ ...r, id: uid() }));
  const params =
    opts.copyParams === false
      ? []
      : source.params.map((p) => createParam({ ...p, id: uid(), value: keepValues ? p.value : null }));
  const calcRefs = opts.copyCalcRefs ? source.calcRefs.map((c) => ({ ...c, id: uid() })) : [];

  return createModel(opts.familyId || source.familyId, {
    id: opts.id.trim(),
    name: opts.name?.trim() || `${source.name} 变型`,
    customer: opts.customer ?? source.customer,
    owner: opts.owner ?? source.owner,
    status: 'draft',
    derivedFrom: source.id,
    standards: opts.copyStandards === false ? [] : [...source.standards],
    requirements,
    params,
    calcRefs,
  });
}
