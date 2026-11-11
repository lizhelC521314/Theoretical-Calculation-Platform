import { describe, expect, it } from 'vitest';
import { getFormula } from '../src/formula/registry';
import { computeFormula } from '../src/formula/compute';
import { UNIT_GROUPS, fromSI } from '../src/formula/units';
import {
  FORMULA_LINKS,
  applyLinkTransform,
  downstreamLinks,
  linkDimensionIssue,
  upstreamLinks,
  validateLinks,
  type FormulaLink,
} from '../src/formula/links';
import type { FormulaSpec } from '../src/formula/types';

/** 按公式元数据默认值构造显示值与单位选择 */
function defaults(id: string) {
  const f = getFormula(id)!;
  const values: Record<string, number> = {};
  const units: Record<string, string> = {};
  for (const p of f.inputs) {
    values[p.key] = p.default ?? 0;
    if (p.unitGroup) {
      const g = UNIT_GROUPS[p.unitGroup];
      const has = g?.units.some((u) => u.label === p.unit);
      units[p.key] = has ? p.unit : g?.units[0].label ?? p.unit;
    }
  }
  return { f, values, units };
}

describe('公式依赖与组合链路', () => {
  it('全部链路的公式、输入、输出与量纲均自洽', () => {
    expect(validateLinks()).toEqual([]);
    expect(FORMULA_LINKS.length).toBeGreaterThan(0);
  });

  it('上下游客引正常', () => {
    const ups = upstreamLinks('structure.airFilter.element');
    expect(ups.map((l) => l.input).sort()).toEqual(['K', 'beta']);
    expect(ups.every((l) => l.from === 'fluid.filter.porous-media-fitting')).toBe(true);

    const downs = downstreamLinks('fluid.filter.porous-media-fitting');
    expect(downs).toHaveLength(4);
    expect(upstreamLinks('fluid.filter.porous-media-fitting')).toEqual([]);
    expect(downstreamLinks('structure.airFilter.element')).toEqual([]);
  });

  it('变换规则：直接、倒数、一半、两倍', () => {
    const make = (transform: FormulaLink['transform']): FormulaLink => ({
      from: 'a',
      output: 'o',
      to: 'b',
      input: 'i',
      transform,
      note: '',
    });
    expect(applyLinkTransform(make('direct'), 1e10)).toBe(1e10);
    expect(applyLinkTransform(make('inverse'), 1e10)).toBeCloseTo(1e-10, 20);
    expect(applyLinkTransform(make('inverse'), 0)).toBeNaN();
    expect(applyLinkTransform(make('half'), 2637)).toBeCloseTo(1318.5, 9);
    expect(applyLinkTransform(make('times2'), 2637)).toBeCloseTo(5274, 9);
    expect(applyLinkTransform(make('direct'), NaN)).toBeNaN();
  });

  it('量纲不一致的链路会被自检拦下', () => {
    const bad: FormulaLink = {
      from: 'fluid.filter.porous-media-fitting',
      output: 'viscousFluent',
      to: 'structure.airFilter.element',
      input: 'beta',
      transform: 'direct',
      note: '故意错误',
    };
    const issues = validateLinks([bad]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('量纲不一致');
    expect(
      linkDimensionIssue('inverseArea', 'permeability', 'inverse'),
    ).toBeNull();
    expect(linkDimensionIssue('inverseLength', 'forchheimerInertia4', 'times2')).toBeNull();
    expect(linkDimensionIssue('inverseLength', 'inverseLength', 'half')).toBeNull();
  });

  it('多孔拟合结果可直接带入压降公式（端到端）', () => {
    const pm = defaults('fluid.filter.porous-media-fitting');
    const fitted = computeFormula(pm.f, pm.values, pm.units);
    expect(fitted.ok).toBe(true);
    const alpha = fitted.outputsSI!['viscousFluent'];
    const c2 = fitted.outputsSI!['c2Fluent'];
    expect(alpha).toBeGreaterThan(0);
    expect(c2).toBeGreaterThan(0);

    const af = defaults('structure.airFilter.element');
    const links = upstreamLinks(af.f.id);
    const kLink = links.find((l) => l.input === 'K')!;
    const bLink = links.find((l) => l.input === 'beta')!;
    const K = applyLinkTransform(kLink, alpha);
    const beta = applyLinkTransform(bLink, c2);
    expect(K).toBeCloseTo(1 / alpha, 18);
    expect(beta).toBeCloseTo(c2 / 2, 12);

    // 按目标输入当前的显示单位回填
    const kParam = af.f.inputs.find((p) => p.key === 'K') as FormulaSpec['inputs'][number];
    const bParam = af.f.inputs.find((p) => p.key === 'beta') as FormulaSpec['inputs'][number];
    af.values.K = fromSI(K, kParam.unitGroup!, af.units.K);
    af.values.beta = fromSI(beta, bParam.unitGroup!, af.units.beta);

    const res = computeFormula(af.f, af.values, af.units);
    expect(res.ok).toBe(true);
    expect(res.outputsSI!['dp']).toBeGreaterThan(0);
  });
});
