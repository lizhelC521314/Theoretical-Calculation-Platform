import { normalizeName } from './similar';
import type { ProductModel } from './types';

/** 影响类型：标准 / 同名需求 / 同参数 / 下游变型 */
export type ImpactKind = 'standard' | 'requirement' | 'param' | 'variant';

export const IMPACT_LABEL: Record<ImpactKind, string> = {
  standard: '同一标准',
  requirement: '同名需求',
  param: '同一参数',
  variant: '下游变型',
};

export interface ImpactHit {
  kind: ImpactKind;
  /** 命中的标准号 / 需求名 / 参数键 / 变型型号 */
  key: string;
  /** 差异说明，直接展示给设计者判断是否需要同步修改 */
  detail: string;
}

export interface ImpactItem {
  model: ProductModel;
  hits: ImpactHit[];
}

/** 数值 + 单位：空值明确标注，避免看起来像 0 */
const fmt = (v: number | null, unit: string) =>
  v == null || !Number.isFinite(v) ? '未取值' : `${Number(v.toPrecision(4))}${unit}`;

/**
 * 变更影响分析：反查哪些型号与被分析型号共用标准、同名需求、同参数键，或由其派生。
 * 只做引用关系识别，不判断影响严重度。
 */
export function analyzeImpact(models: ProductModel[], target: ProductModel): ImpactItem[] {
  const stdSet = new Set(target.standards.map(normalizeName).filter(Boolean));
  const reqMap = new Map(
    target.requirements.filter((r) => r.name.trim()).map((r) => [normalizeName(r.name), r]),
  );
  const paramMap = new Map(target.params.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p]));

  const items: ImpactItem[] = [];
  for (const m of models) {
    if (m.id === target.id) continue;
    const hits: ImpactHit[] = [];

    if (m.derivedFrom === target.id) {
      hits.push({ kind: 'variant', key: m.id, detail: '由当前型号派生，需一并复核' });
    }
    for (const s of m.standards) {
      if (normalizeName(s) && stdSet.has(normalizeName(s))) {
        hits.push({ kind: 'standard', key: s, detail: '与本型号共用设计标准' });
      }
    }
    for (const r of m.requirements) {
      const ref = reqMap.get(normalizeName(r.name));
      if (!ref) continue;
      const aligned =
        ref.target != null &&
        r.target != null &&
        normalizeName(ref.unit) === normalizeName(r.unit);
      hits.push({
        kind: 'requirement',
        key: r.name,
        detail: aligned
          ? `目标 ${fmt(ref.target, ref.unit)} → ${fmt(r.target, r.unit)}`
          : '同名需求，目标值或单位未对齐',
      });
    }
    for (const p of m.params) {
      const ref = paramMap.get(p.key.trim());
      if (!ref) continue;
      hits.push({
        kind: 'param',
        key: p.key,
        detail: `${fmt(ref.value, ref.unit)} → ${fmt(p.value, p.unit)}`,
      });
    }

    if (hits.length) items.push({ model: m, hits });
  }
  return items.sort((a, b) => b.hits.length - a.hits.length || a.model.id.localeCompare(b.model.id));
}
