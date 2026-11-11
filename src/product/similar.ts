import type { ProductModel } from './types';

/** 需求项比对结果 */
export interface ReqMatch {
  name: string;
  /** 基准型号目标值 */
  refTarget: number | null;
  /** 候选型号目标值 */
  target: number | null;
  unit: string;
  /** 目标值相对偏差（%），单位不同或数据缺失时为 null */
  deltaPct: number | null;
}

/** 关键参数比对结果 */
export interface ParamMatch {
  key: string;
  label: string;
  refValue: number | null;
  value: number | null;
  unit: string;
  deltaPct: number | null;
}

export interface SimilarResult {
  model: ProductModel;
  /** 0~100 的相似度 */
  score: number;
  sameFamily: boolean;
  sharedStandards: string[];
  requirements: ReqMatch[];
  params: ParamMatch[];
  /** 相似理由，用于结果行直接展示 */
  reasons: string[];
}

/** 名称归一化：忽略大小写、空格与常见分隔符，避免「初始压降 / 初始 压降」被判为不同项 */
export const normalizeName = (s: string) => s.toLowerCase().replace(/[\s\-_/]/g, '');

/** 相对偏差百分比；基准值为 0 或数据缺失时返回 null */
function deltaPct(ref: number | null, cur: number | null, refUnit: string, curUnit: string): number | null {
  if (ref == null || cur == null || !Number.isFinite(ref) || !Number.isFinite(cur)) return null;
  if (refUnit.trim().toLowerCase() !== curUnit.trim().toLowerCase()) return null;
  if (ref === 0) return null;
  return ((cur - ref) / Math.abs(ref)) * 100;
}

/**
 * 型号相似度：同族 25 + 需求重合 35 + 需求目标接近 10 + 参数重合 20 + 标准共用 10。
 * 只做数量与目标值层面的比较，不引入额外的经验权重，保证结果可解释。
 */
export function similarity(ref: ProductModel, cand: ProductModel): SimilarResult {
  const refReq = new Map(ref.requirements.filter((r) => r.name.trim()).map((r) => [normalizeName(r.name), r]));
  const refParam = new Map(ref.params.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p]));
  const sameFamily = ref.familyId === cand.familyId;

  const requirements: ReqMatch[] = [];
  for (const r of cand.requirements) {
    const match = refReq.get(normalizeName(r.name));
    if (!match) continue;
    requirements.push({
      name: r.name,
      refTarget: match.target,
      target: r.target,
      unit: r.unit || match.unit,
      deltaPct: deltaPct(match.target, r.target, match.unit, r.unit),
    });
  }

  const params: ParamMatch[] = [];
  for (const p of cand.params) {
    const match = refParam.get(p.key.trim());
    if (!match) continue;
    params.push({
      key: p.key,
      label: p.label || match.label,
      refValue: match.value,
      value: p.value,
      unit: p.unit || match.unit,
      deltaPct: deltaPct(match.value, p.value, match.unit, p.unit),
    });
  }

  const refStd = new Set(ref.standards.map((s) => normalizeName(s)).filter(Boolean));
  const sharedStandards = cand.standards.filter((s) => normalizeName(s) && refStd.has(normalizeName(s)));

  const reqBase = Math.max(ref.requirements.length, cand.requirements.length, 1);
  const paramBase = Math.max(ref.params.length, cand.params.length, 1);
  const reqRatio = requirements.length / reqBase;
  const paramRatio = params.length / paramBase;
  const stdRatio = sharedStandards.length / Math.max(ref.standards.length, cand.standards.length, 1);
  const closeness =
    requirements.filter((r) => r.deltaPct != null).length === 0
      ? 0
      : requirements
          .filter((r) => r.deltaPct != null)
          .reduce((sum, r) => sum + Math.max(0, 1 - Math.min(1, Math.abs(r.deltaPct!) / 100)), 0) /
        requirements.filter((r) => r.deltaPct != null).length;

  const score =
    (sameFamily ? 25 : 0) + reqRatio * 35 + closeness * 10 + paramRatio * 20 + stdRatio * 10;

  const reasons: string[] = [];
  if (sameFamily) reasons.push('同一产品族');
  if (requirements.length) reasons.push(`需求重合 ${requirements.length} 项`);
  if (params.length) reasons.push(`参数一致 ${params.length} 个`);
  if (sharedStandards.length) reasons.push(`共用标准 ${sharedStandards.length} 条`);

  return {
    model: cand,
    score: Math.round(score * 10) / 10,
    sameFamily,
    sharedStandards,
    requirements,
    params,
    reasons,
  };
}

export interface FindSimilarOptions {
  /** 仅在同产品族内检索 */
  sameFamilyOnly?: boolean;
  /** 是否把已停产型号纳入结果（默认纳入，供参考） */
  includeObsolete?: boolean;
  limit?: number;
}

/** 以某个型号为基准，按相似度降序返回候选型号（不含自身） */
export function findSimilarModels(
  models: ProductModel[],
  ref: ProductModel,
  opts: FindSimilarOptions = {},
): SimilarResult[] {
  const { sameFamilyOnly = false, includeObsolete = true, limit = 8 } = opts;
  return models
    .filter((m) => m.id !== ref.id)
    .filter((m) => (sameFamilyOnly ? m.familyId === ref.familyId : true))
    .filter((m) => (includeObsolete ? true : m.status !== 'obsolete'))
    .map((m) => similarity(ref, m))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.model.id.localeCompare(b.model.id))
    .slice(0, limit);
}
