import type { Domain, FormulaSpec } from './types';
import { DOMAIN_ORDER } from './types';

/**
 * 公式注册表
 *
 * 所有公式在此集中注册。新增公式只需：
 *   1. 在 src/domains/<领域>/ 下新建公式文件，导出 FormulaSpec；
 *   2. 在本文件 import 并加入 ALL_FORMULAS。
 * 界面（公式库、搜索、计算页）会自动收录，无需改动界面代码。
 */
import { porousMediaFitting } from '../domains/fluid/porousMedia';
import { helmholtzMuffler } from '../domains/acoustics/helmholtzMuffler';
import { expansionMuffler } from '../domains/acoustics/expansionMuffler';
import { quarterWaveTube } from '../domains/acoustics/quarterWaveTube';
import { wovenTubeSilencer } from '../domains/acoustics/wovenTubeSilencer';
import { multiCavitySilencer } from '../domains/acoustics/multiCavitySilencer';
import { pressureCorrection } from '../domains/fluid/pressureCorrection';
import { airFilterElement } from '../domains/structure/airFilterElement';
import { intakeHose } from '../domains/structure/intakeHose';
import { intakeHoseFull } from '../domains/structure/intakeHoseFull';

const ALL_FORMULAS: FormulaSpec[] = [
  porousMediaFitting,
  helmholtzMuffler,
  expansionMuffler,
  quarterWaveTube,
  wovenTubeSilencer,
  multiCavitySilencer,
  pressureCorrection,
  airFilterElement,
  intakeHose,
  intakeHoseFull,
];

const byId = new Map<string, FormulaSpec>(ALL_FORMULAS.map((f) => [f.id, f]));

export function listFormulas(): FormulaSpec[] {
  return [...ALL_FORMULAS].sort((a, b) => {
    const d = DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain);
    if (d !== 0) return d;
    return a.title.localeCompare(b.title, 'zh-Hans-CN');
  });
}

export function getFormula(id: string): FormulaSpec | undefined {
  return byId.get(id);
}

/** 按领域分组，用于公式库二级导航 */
export function groupByDomain(): { domain: Domain; items: FormulaSpec[] }[] {
  const map = new Map<Domain, FormulaSpec[]>();
  for (const f of listFormulas()) {
    if (!map.has(f.domain)) map.set(f.domain, []);
    map.get(f.domain)!.push(f);
  }
  return DOMAIN_ORDER.filter((d) => map.has(d)).map((domain) => ({
    domain,
    items: map.get(domain)!,
  }));
}

/** 关键词搜索：匹配标题、说明、标签、公式 ID */
export function searchFormulas(keyword: string): FormulaSpec[] {
  const k = keyword.trim().toLowerCase();
  if (!k) return listFormulas();
  return listFormulas().filter((f) =>
    [f.title, f.summary, f.description, f.id, ...f.tags].join(' ').toLowerCase().includes(k),
  );
}

/** 统计信息，用于首页概览 */
export function stats() {
  const domains = groupByDomain();
  return {
    total: ALL_FORMULAS.length,
    domainCount: domains.length,
    perDomain: domains.map((d) => ({ domain: d.domain, count: d.items.length })),
  };
}
