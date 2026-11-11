import { describe, expect, it } from 'vitest';
import { listFormulas } from '../src/formula/registry';
import { computeFormula } from '../src/formula/compute';
import {
  MATERIAL_BIND_FIELDS,
  allowedMaterialTypes,
  bindFieldLabel,
  bindValueForParam,
  interpFluidPoints,
  resolveBindTemperature,
} from '../src/formula/materialBinding';
import { UNIT_GROUPS, autoUnit, fromSI, toSI } from '../src/formula/units';
import { isUnitValid, validateInputs } from '../src/formula/validate';
import { runUncertainty } from '../src/formula/uncertainty';
import { backsolve } from '../src/formula/backsolve';
import { isFeasible, satisfyConstraint, sweep, sweepGrid } from '../src/formula/explore';
import type { FormulaSpec, ParamSpec } from '../src/formula/types';
import { intakeHoseFull } from '../src/domains/structure/intakeHoseFull';
import type { MaterialRecord } from '../src/report/material';
import { helmholtzMuffler } from '../src/domains/acoustics/helmholtzMuffler';
import { expansionMuffler } from '../src/domains/acoustics/expansionMuffler';
import { quarterWaveTube } from '../src/domains/acoustics/quarterWaveTube';
import { multiCavitySilencer } from '../src/domains/acoustics/multiCavitySilencer';
import { airFilterElement } from '../src/domains/structure/airFilterElement';

/**
 * 公式基准算例回归测试
 *
 * 每个公式的 benchmarks 中都带有来源说明（教材例题 / 标准 / 解析解），
 * 此处统一执行，确保公式实现与理论值一致，避免公式在修改中算错。
 */
describe('公式基准算例', () => {
  const formulas = listFormulas();

  it('公式库不为空', () => {
    expect(formulas.length).toBeGreaterThan(0);
  });

  for (const f of formulas) {
    describe(`${f.title} (${f.id})`, () => {
      it('元数据完整性', () => {
        expect(f.inputs.length).toBeGreaterThan(0);
        expect(f.outputs.length).toBeGreaterThan(0);
        expect(f.latex.length).toBeGreaterThan(0);
        expect(f.assumptions.length).toBeGreaterThan(0);
        expect(f.benchmarks.length).toBeGreaterThan(0);
      });

      // 版本与状态是计算可追溯的前提：历史记录只快照这三个字段
      it('版本号与生命周期状态合法', () => {
        expect(f.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(['draft', 'review', 'published', 'deprecated']).toContain(f.status);
      });

      it('标准依据结构合法', () => {
        for (const s of f.standardRefs || []) {
          expect(s.code.trim().length).toBeGreaterThan(0);
          expect(s.title.trim().length).toBeGreaterThan(0);
        }
      });

      // 输入声明的默认单位标签必须在其 unitGroup 中存在，否则界面初始化会回退到分组首项，
      // 静默改变换算倍率（曾因此导致 μ 按 Pa·s 读入而放大 1000 倍）
      it('输入单位标签与单位分组匹配', () => {
        for (const p of f.inputs) {
          if (!p.unitGroup) continue;
          const g = UNIT_GROUPS[p.unitGroup];
          expect(g, `${p.key}: unitGroup '${p.unitGroup}' 未定义`).toBeDefined();
          expect(
            g.units.some((u) => u.label === p.unit),
            `${p.key}: unit '${p.unit}' 不在分组 ${p.unitGroup} [${g.units.map((u) => u.label).join('|')}]`,
          ).toBe(true);
        }
      });

      for (const b of f.benchmarks) {
        it(b.name, () => {
          const out = f.solve(b.input);
          for (const [key, target] of Object.entries(b.expect)) {
            const actual = out[key];
            expect(Number.isFinite(actual), `${key} 应为数值`).toBe(true);
            const tol = Math.abs(target) * b.tolerance + 1e-9;
            expect(Math.abs(actual - target), `${key}: 期望 ${target}，实际 ${actual}`).toBeLessThanOrEqual(tol);
          }
        });
      }
    });
  }
});

/**
 * 赫姆霍兹消音器 TL 曲线专项测试
 *
 * 验证 TL = 10lg[1+( K/(f/f_r − f_r/f) )²]（K = √(Sc·V/lEff)/(2Sp)）的实现：
 * 默认工况下手算 TL(0.5·f_r) ≈ 0.2057 dB，近共振点 0.99·f_r 处 TL ≈ 24.3 dB。
 */
describe('赫姆霍兹消音器 TL 曲线', () => {
  const input = { V: 5e-4, lc: 0.03, d: 0.02, t: 298.15, D: 0.06 };
  const spec = helmholtzMuffler.curve!;

  it('曲线点齐全且横轴覆盖 0.05·f_r ~ 1.95·f_r', () => {
    const fr = helmholtzMuffler.solve(input).fr;
    const pts = spec.compute(input);
    expect(pts.length).toBeGreaterThanOrEqual(45);
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(0.05 * fr, 3);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(1.95 * fr, 3);
    // x 升序排列
    for (let i = 1; i < pts.length; i++) expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
  });

  it('TL(0.5·f_r) 与手算一致（≈0.2057 dB）', () => {
    const fr = helmholtzMuffler.solve(input).fr;
    const p = spec.compute(input).find((q) => Math.abs(q.x - 0.5 * fr) < 1e-6);
    expect(p).toBeDefined();
    expect(Math.abs(p!.y - 0.2057)).toBeLessThan(0.002);
  });

  it('结果输出中心频率处的 TL 峰值（≈30.41 dB），且与曲线最大采样值一致', () => {
    const tl = helmholtzMuffler.solve(input).tl;
    expect(Math.abs(tl - 30.406)).toBeLessThan(0.02);
    const maxY = Math.max(...spec.compute(input).map((q) => q.y));
    expect(tl).toBe(maxY);
  });

  it('近共振点 0.99·f_r 处 TL ≈ 24.3 dB，且为曲线显著峰值', () => {
    const fr = helmholtzMuffler.solve(input).fr;
    const pts = spec.compute(input);
    const near = pts.find((q) => Math.abs(q.x - 0.99 * fr) < 1e-6)!;
    expect(Math.abs(near.y - 24.33)).toBeLessThan(0.3);
    const maxY = Math.max(...pts.map((q) => q.y));
    expect(maxY).toBeGreaterThan(20);
    // 远离共振处 TL 趋近 0（0.05·f_r 处应小于 0.1 dB）
    const far = pts.find((q) => q.x < 0.06 * fr)!;
    expect(far.y).toBeLessThan(0.1);
  });
});

/**
 * 公式版本治理
 *
 * 版本 / 状态 / 标准依据是计算可追溯的基础字段，
 * 历史记录会快照前两者，报告会输出标准依据清单。
 */
describe('公式版本治理', () => {
  it('滤芯设计公式引用 ISO 5011 等标准依据', () => {
    const air = listFormulas().find((f) => f.id === airFilterElement.id);
    expect(air).toBeDefined();
    expect(air!.standardRefs?.some((s) => s.code.includes('ISO 5011'))).toBe(true);
  });

  it('全部公式默认为已发布状态，可直接用于正式校核', () => {
    for (const f of listFormulas()) expect(f.status).toBe('published');
  });
});

/**
 * 膨胀腔消音器 TL 曲线专项测试
 *
 * 验证 TL = 10lg[1 + 0.25(m−1/m)²·(sin(2πL/λ)/(cos(2πLa/λ)cos(2πLb/λ)))²] 的实现：
 * 默认工况（d=70mm, D=200mm, L=200mm, La=Lb=0, t=25℃, 0~3000Hz 均分 400 份）下
 * m = 8.1633，首峰 f ≈ c/(4L) = 433.06 Hz，理论峰值 12.346 dB。
 */
describe('膨胀腔消音器 TL 曲线', () => {
  const input = {
    S1: 3.848451000647496e-3, d: 0.07, S2: 3.141592653589793e-2, D: 0.2,
    L: 0.2, La: 0, Lb: 0, t: 298.15, fmin: 0, fmax: 3000,
  };
  const spec = expansionMuffler.curve!;

  it('曲线点齐全且横轴覆盖 fmin ~ fmax（401 点，步长 7.5 Hz）', () => {
    const pts = spec.compute(input);
    expect(pts.length).toBe(401);
    expect(pts[0].x).toBe(0);
    expect(pts[pts.length - 1].x).toBe(3000);
    for (let i = 1; i < pts.length; i++) expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
  });

  it('f = 0 时 TL = 0，首峰附近 TL 与手算一致', () => {
    const pts = spec.compute(input);
    expect(pts[0].y).toBe(0);
    // f = 435 Hz（采样点）：kL = 2π×435×0.2/346.45，TL ≈ 12.346 dB
    const p = pts.find((q) => Math.abs(q.x - 435) < 1e-9)!;
    expect(Math.abs(p.y - 12.3459)).toBeLessThan(0.005);
  });

  it('结果输出频带内 TL 峰值（≈12.346 dB @ 1297.5 Hz），且与曲线最大采样值一致', () => {
    const out = expansionMuffler.solve(input);
    // 理论峰 f = (2n−1)·433.06 Hz，采样点 1297.5 Hz 最接近第 2 峰（1299.19 Hz）
    expect(out.fPeak).toBe(1297.5);
    expect(Math.abs(out.tlMax - 12.3459)).toBeLessThan(0.005);
    const maxY = Math.max(...spec.compute(input).map((q) => q.y));
    expect(out.tlMax).toBe(maxY);
  });

  it('La = 50mm 时 TL(502.5Hz) ≈ 12.967 dB（验证插入深度 cos 项）', () => {
    const pts = spec.compute({ ...input, La: 0.05 });
    const p = pts.find((q) => Math.abs(q.x - 502.5) < 1e-9)!;
    expect(Math.abs(p.y - 12.9667)).toBeLessThan(0.005);
    // 同频点 La = 0 时 TL ≈ 12.084 dB，插入深度改变 TL
    const p0 = spec.compute(input).find((q) => Math.abs(q.x - 502.5) < 1e-9)!;
    expect(Math.abs(p0.y - 12.0843)).toBeLessThan(0.005);
  });

  it('面积输入与直径输入结果一致（二选一规则：d/D 置 0 时按 S₁/S₂ 计算）', () => {
    const byDiameter = expansionMuffler.solve(input);
    const byArea = expansionMuffler.solve({ ...input, d: 0, D: 0 });
    expect(byArea.s1).toBeCloseTo(byDiameter.s1, 12);
    expect(byArea.s2).toBeCloseTo(byDiameter.s2, 12);
    expect(byArea.m).toBeCloseTo(byDiameter.m, 12);
    expect(byArea.tlMax).toBeCloseTo(byDiameter.tlMax, 12);
  });
});

/**
 * 四分之一波长管消音器 TL 曲线专项测试
 *
 * 验证 f_c = c/(4L) 与 TL = 10lg[1 + ¼(m·tan(2πL/λ))²] 的实现：
 * 默认工况（d=10mm, D=60mm, L=100mm, t=25℃）下 f_c = 866.125 Hz，m = 1/36，
 * TL 曲线按 PPT 在 0.5f_c ~ 2f_c 均分 200 份（201 点），峰值出现在 1.0025f_c ≈ 11.31 dB。
 */
describe('四分之一波长管消音器 TL 曲线', () => {
  const input = {
    Sp: 2.827433388230814e-3, D: 0.06, Sc: 7.853981633974483e-5, d: 0.01,
    L: 0.1, t: 298.15,
  };
  const spec = quarterWaveTube.curve!;

  it('曲线点齐全且横轴覆盖 0.5f_c ~ 2f_c（201 点）', () => {
    const fc = quarterWaveTube.solve(input).fc;
    expect(fc).toBeCloseTo(866.125, 3);
    const pts = spec.compute(input);
    expect(pts.length).toBe(201);
    expect(pts[0].x).toBeCloseTo(0.5 * fc, 6);
    expect(pts[200].x).toBeCloseTo(2 * fc, 6);
    for (let i = 1; i < pts.length; i++) expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
  });

  it('TL(0.995f_c) 与 TL(0.5f_c) 手算一致（≈6.156 dB / ≈0.00084 dB）', () => {
    const fc = quarterWaveTube.solve(input).fc;
    const pts = spec.compute(input);
    const near = pts.find((q) => Math.abs(q.x - 0.995 * fc) < 1e-6)!;
    expect(Math.abs(near.y - 6.1564)).toBeLessThan(0.005);
    expect(pts[0].y).toBeLessThan(0.001); // 0.5f_c 处 TL 趋近 0
    expect(pts[200].y).toBe(0); // 2f_c 处 tan(π) = 0，TL = 0
  });

  it('结果输出 TL 曲线最大值（≈11.31 dB），且与曲线最大采样值严格一致', () => {
    const tl = quarterWaveTube.solve(input).tl;
    expect(Math.abs(tl - 11.3061)).toBeLessThan(0.005);
    const maxY = Math.max(...spec.compute(input).map((q) => q.y));
    expect(tl).toBe(maxY);
  });

  it('面积输入与直径输入结果一致（二选一规则：d/D 置 0 时按 S_c/S_p 计算）', () => {
    const byDiameter = quarterWaveTube.solve(input);
    const byArea = quarterWaveTube.solve({ ...input, d: 0, D: 0 });
    expect(byArea.sc).toBeCloseTo(byDiameter.sc, 12);
    expect(byArea.sp).toBeCloseTo(byDiameter.sp, 12);
    expect(byArea.m).toBeCloseTo(byDiameter.m, 12);
    expect(byArea.fc).toBeCloseTo(byDiameter.fc, 10);
    expect(byArea.tl).toBeCloseTo(byDiameter.tl, 10);
  });
});

/**
 * 多腔穿孔消音器：郭荣论文算例校验
 *
 * 参数取自参考图表（PPT 末页）：d_in=41.6mm、d_out=69mm、d_h=3.1mm、n_h=36、
 * t_w=2.8mm、5 腔、L_c=8/10/13/17/23.8mm、c_t=2mm。
 * PPT 给出 500 Hz≈1 dB、1.7 kHz≈26 dB、2.3 kHz≈42 dB、3.2 kHz≈4 dB（带通特性）；
 * α0 按工程约定乘 0.5 修正后，本实现为 ≈1.0/8.9/34.1/25.2 dB、峰值 ≈51.5 dB @ 2.88 kHz，
 * 曲线整体向高频偏移（见公式模块 assumptions 说明），以下用例按修正后数值做回归校验。
 */
describe('多腔穿孔消音器 郭荣算例校验', () => {
  const input: Record<string, number> = {
    din: 0.0416, tw: 0.0028, n: 5, ct: 0.002,
    rho0: 1.205, c0v: 343, M1: 0, R0: 0.0055, fmin: 100, fmax: 5000, df: 10,
  };
  const Lc = [0.008, 0.01, 0.013, 0.017, 0.0238];
  for (let i = 1; i <= 5; i++) {
    input[`Lc${i}`] = Lc[i - 1];
    input[`dout${i}`] = 0.069;
    input[`dh${i}`] = 0.0031;
    input[`nh${i}`] = 36;
  }
  const pts = multiCavitySilencer.curve!.compute(input);
  const at = (f: number) => pts.find((p) => Math.abs(p.x - f) < 1e-6)!.y;

  it('各腔穿孔率按腔宽各自计算（L_c 越宽 σ 越小）', () => {
    const out = multiCavitySilencer.solve(input);
    expect(out.sigma1).toBeGreaterThan(out.sigma2);
    expect(out.sigma2).toBeGreaterThan(out.sigma3);
    expect(out.sigma3).toBeGreaterThan(out.sigma4);
    expect(out.sigma4).toBeGreaterThan(out.sigma5);
  });

  it('各腔端部修正 α0,i 按自身 σ_i 单独计算并乘 0.5（逐腔不同，不可沿用第 1 腔）', () => {
    const out = multiCavitySilencer.solve(input);
    const alphaOf = (s: number) => 0.5 * 0.8216 * (1 + 1.5319 * Math.sqrt(s) + 1.4099 * s - 0.878 * Math.pow(s, 1.5));
    for (let i = 1; i <= 5; i++) {
      expect(out[`alpha${i}`]).toBeCloseTo(alphaOf(out[`sigma${i}`]), 10);
    }
    // σ 递减 → α0 递减
    for (let i = 1; i <= 4; i++) expect(out[`alpha${i}`]).toBeGreaterThan(out[`alpha${i + 1}`]);
    // 算例参考值：σ1=0.259886 → α0,1≈0.8343；σ5=0.087357 → α0,5≈0.6381
    expect(out.alpha1).toBeCloseTo(0.8343498053, 8);
    expect(out.alpha5).toBeCloseTo(0.6380814057, 8);
    // 未参与计算的腔不给出结果
    expect(out.alpha6).toBeUndefined();
  });

  it('α0 乘 0.5 后回归校验：500 Hz / 1.7k / 2.3k / 3.2k 处 TL ≈ 1.0/8.9/34.1/25.2 dB（差 < 1 dB）', () => {
    expect(Math.abs(at(500) - 1.041047792)).toBeLessThan(1);
    expect(Math.abs(at(1700) - 8.91501119)).toBeLessThan(1);
    expect(Math.abs(at(2300) - 34.13063836)).toBeLessThan(1);
    expect(Math.abs(at(3200) - 25.2411343)).toBeLessThan(1);
  });

  it('低频 TL ≈ 0、峰值位于 2.9 kHz 附近（呈带通，非单调下降）', () => {
    expect(at(100)).toBeLessThan(1);
    const peak = pts.reduce((a, b) => (b.y > a.y ? b : a));
    expect(peak.x).toBeGreaterThan(2700);
    expect(peak.x).toBeLessThan(3000);
    expect(peak.y).toBeGreaterThan(30);
  });
});

/**
 * 材料库绑定
 *
 * 绑定声明必须指向材料库真实存在的物性，且参数单位分组要与材料库单位一致，
 * 否则带入值会静默错位（如把 MPa 当 Pa 填进应力参数）。
 */
describe('材料库绑定', () => {
  const bound = listFormulas().flatMap((f) =>
    f.inputs.filter((p) => p.bind).map((p) => ({ formula: f, param: p })),
  );

  const fakeRec = (patch: Partial<MaterialRecord>): MaterialRecord =>
    ({ grade: 'EPDM-70', series: '密封橡胶', temperature: 23, ...patch }) as MaterialRecord;

  /** 流体材料：属性表 0℃ / 80℃ 两点，用于验证线性插值与端点提示 */
  const fluidRec = {
    ...fakeRec({ grade: 'DW-40', series: '冷却液', temperature: null }),
    type: 'fluid',
    fluidPoints: [
      { temperature: 0, density: 1050, dynamicViscosity: 4.0, thermalConductivity: 0.4, specificHeat: 3.8 },
      { temperature: 80, density: 1000, dynamicViscosity: 1.0, thermalConductivity: 0.6, specificHeat: 4.2 },
    ],
  } as MaterialRecord;

  it('存在已声明材料绑定的输入（进气管胶料参数）', () => {
    expect(bound.length).toBeGreaterThan(0);
    expect(bound.map((b) => `${b.formula.id}.${b.param.key}`)).toContain('structure.intakeHoseFull.E');
  });

  it('绑定字段均已定义，且参数单位分组与材料库单位一致', () => {
    for (const { formula, param } of bound) {
      const meta = MATERIAL_BIND_FIELDS[param.bind!.field];
      expect(meta, `${formula.id}.${param.key} 绑定了未定义字段 ${param.bind!.field}`).toBeDefined();
      if (param.unitGroup) {
        expect(meta.unitGroup, `${formula.id}.${param.key} 单位分组应为 ${meta.unitGroup}`).toBe(
          param.unitGroup,
        );
      } else {
        expect(param.unit, `${formula.id}.${param.key} 单位应为 ${meta.unit}`).toBe(meta.unit);
      }
    }
  });

  it('按参数显示单位换算：应力 MPa/Pa、密度 g/cm³、泊松比无量纲', () => {
    const rec = fakeRec({ elasticModulus: 6, density: 1200, poisson: 0.49, tensileStrength: 10 });
    const stressMPa = { unitGroup: 'stress', unit: 'MPa' } as const;
    const stressPa = { unitGroup: 'stress', unit: 'Pa' } as const;
    expect(bindValueForParam(rec, 'elasticModulus', stressMPa, 'MPa')).toBeCloseTo(6, 9);
    expect(bindValueForParam(rec, 'elasticModulus', stressPa, 'Pa')).toBeCloseTo(6e6, 3);
    expect(bindValueForParam(rec, 'tensileStrength', stressMPa, 'MPa')).toBeCloseTo(10, 9);
    expect(
      bindValueForParam(rec, 'density', { unitGroup: 'density', unit: 'kg/m³' }, 'g/cm³'),
    ).toBeCloseTo(1.2, 9);
    expect(bindValueForParam(rec, 'poisson', { unit: '-' }, '-')).toBeCloseTo(0.49, 9);
  });

  it('材料缺少该物性时返回 null，界面保持手工输入', () => {
    const rec = fakeRec({ elasticModulus: null });
    expect(
      bindValueForParam(rec, 'elasticModulus', { unitGroup: 'stress', unit: 'MPa' }, 'MPa'),
    ).toBeNull();
  });

  it('流体绑定必须声明插值温度，且温度来源是已定义的温度输入', () => {
    for (const { formula, param } of bound) {
      if (!MATERIAL_BIND_FIELDS[param.bind!.field].fluid) continue;
      expect(
        param.bind!.temperatureFrom,
        `${formula.id}.${param.key} 缺少插值温度来源`,
      ).toBeTruthy();
      const tp = formula.inputs.find((x) => x.key === param.bind!.temperatureFrom);
      expect(tp, `${formula.id}.${param.key} 的插值温度输入不存在`).toBeDefined();
      expect(['℃', 'K']).toContain(tp!.unit);
      if (tp!.unitGroup) expect(tp!.unitGroup).toBe('temperature');
    }
  });

  it('流体 / 多孔字段的默认材料类型按物性自动判定', () => {
    expect(allowedMaterialTypes('fluidViscosity')).toEqual(['fluid']);
    expect(allowedMaterialTypes('porousPermeability')).toEqual(['porous']);
    expect(allowedMaterialTypes('density')).toEqual(['conventional', 'hyperelastic']);
    expect(allowedMaterialTypes('density', ['fluid'])).toEqual(['fluid']);
  });

  it('按温度线性插值流体属性表', () => {
    const mid = interpFluidPoints(fluidRec.fluidPoints, 40)!;
    expect(mid.inRange).toBe(true);
    expect(mid.density).toBeCloseTo(1025, 9);
    expect(mid.dynamicViscosity).toBeCloseTo(2.5, 9);
    expect(mid.thermalConductivity).toBeCloseTo(0.5, 9);
    expect(mid.specificHeat).toBeCloseTo(4.0, 9);
    expect(interpFluidPoints(fluidRec.fluidPoints, 0)!.inRange).toBe(true);
    expect(interpFluidPoints(null, 25)).toBeNull();
  });

  it('温度超出属性表范围时取端点并提示，不静默外推', () => {
    const hot = interpFluidPoints(fluidRec.fluidPoints, 120)!;
    expect(hot.temperature).toBe(80);
    expect(hot.inRange).toBe(false);
    expect(hot.dynamicViscosity).toBeCloseTo(1.0, 9);
    expect(bindFieldLabel(fluidRec, 'fluidViscosity', 120)).toContain('超出属性表');
    expect(bindFieldLabel(fluidRec, 'fluidViscosity', 40)).toContain('按 40℃ 插值');
    expect(bindFieldLabel(fluidRec, 'fluidViscosity')).toBe('动力粘度');
  });

  it('流体物性按库内单位换算到参数显示单位（mPa·s → Pa·s，kJ → J）', () => {
    const opts = { temperatureC: 40 };
    const dyn = { unitGroup: 'dynamicViscosity', unit: 'Pa·s' } as const;
    expect(bindValueForParam(fluidRec, 'fluidViscosity', dyn, 'Pa·s', opts)).toBeCloseTo(2.5e-3, 12);
    expect(bindValueForParam(fluidRec, 'fluidViscosity', dyn, 'mPa·s', opts)).toBeCloseTo(2.5, 9);
    expect(
      bindValueForParam(
        fluidRec,
        'fluidSpecificHeat',
        { unitGroup: 'specificHeat', unit: 'J/(kg·K)' },
        'kJ/(kg·K)',
        opts,
      ),
    ).toBeCloseTo(4.0, 9);
    // 未给出插值温度时不带值，避免用错温度
    expect(bindValueForParam(fluidRec, 'fluidViscosity', dyn, 'Pa·s')).toBeNull();
  });

  it('多孔介质物性映射：渗透率取粘性阻力系数倒数，惯性阻力系数直取', () => {
    const rec = {
      ...fakeRec({}),
      porousProps: {
        poreSize: 25,
        viscousResistance: 1e10,
        inertialResistance: 5e5,
        viscousCoefficient: 0.018,
        inertialCoefficient: 3000,
        remark: '',
      },
    } as MaterialRecord;
    expect(
      bindValueForParam(rec, 'porousPermeability', { unitGroup: 'permeability', unit: 'm²' }, 'm²'),
    ).toBeCloseTo(1e-10, 20);
    expect(
      bindValueForParam(rec, 'porousPermeability', { unitGroup: 'permeability', unit: 'm²' }, '10⁻¹¹ m²'),
    ).toBeCloseTo(10, 9);
    expect(
      bindValueForParam(
        rec,
        'porousInertialResistance',
        { unitGroup: 'inverseLength', unit: 'm⁻¹' },
        'm⁻¹',
      ),
    ).toBeCloseTo(5e5, 6);
    expect(
      bindValueForParam(
        rec,
        'porousViscousCoefficient',
        { unitGroup: 'viscousResistance', unit: 'kg/(m³·s)' },
        'kg/(m³·s)',
      ),
    ).toBeCloseTo(0.018, 12);
    expect(
      bindValueForParam(
        fakeRec({}),
        'porousPermeability',
        { unitGroup: 'permeability', unit: 'm²' },
        'm²',
      ),
    ).toBeNull();
  });

  it('从公式温度输入解析插值温度（℃ / K 均支持）', () => {
    const inputs = [
      { key: 'T', label: '空气温度', symbol: 'T', unit: '℃', unitGroup: 'temperature' },
      { key: 'T0', label: '环境温度', symbol: 'T0', unit: 'K' },
    ] as ParamSpec[];
    const bind = { kind: 'material', field: 'fluidViscosity', temperatureFrom: 'T' } as const;
    expect(resolveBindTemperature(bind, inputs, { T: 45 }, {})).toBeCloseTo(45, 9);
    expect(
      resolveBindTemperature({ ...bind, temperatureFrom: 'T0' }, inputs, { T0: 318 }, {}),
    ).toBeCloseTo(44.85, 6);
    expect(resolveBindTemperature(bind, inputs, { T: NaN }, {})).toBeUndefined();
    expect(
      resolveBindTemperature({ kind: 'material', field: 'density' }, inputs, { T: 45 }, {}),
    ).toBeUndefined();
  });

  it('空气滤清器已接入流体与多孔介质绑定', () => {
    const byKey = new Map(airFilterElement.inputs.map((p) => [p.key, p]));
    expect(byKey.get('mu')!.bind).toMatchObject({ field: 'fluidViscosity', temperatureFrom: 'T0' });
    expect(byKey.get('rho')!.bind).toMatchObject({ field: 'fluidDensity', temperatureFrom: 'T0' });
    expect(byKey.get('K')!.bind).toMatchObject({ field: 'porousPermeability' });
    expect(byKey.get('beta')!.bind).toMatchObject({ field: 'porousInertialResistance' });
  });
});

/** 按元数据生成默认输入（声明单位），用于校验用例 */
function defaultInputs(f: FormulaSpec) {
  const values: Record<string, number> = {};
  const units: Record<string, string> = {};
  for (const p of f.inputs) {
    values[p.key] = p.default ?? 0;
    units[p.key] = p.unit;
  }
  return { values, units };
}

/**
 * 单位安全与输出一致性
 *
 * 1) 单位分组内的换算必须可逆（含 ℃ ↔ K 平移）；
 * 2) 更换显示单位不得改变 SI 计算结果——这是「单位安全」的核心断言；
 * 3) 输出自动单位必须落在其分组内，且换算回 SI 后与原始值一致。
 */
describe('单位安全与输出一致性', () => {
  const formulas = listFormulas();

  it('单位分组内换算可逆（含温度平移）', () => {
    for (const f of formulas) {
      for (const p of f.inputs) {
        if (!p.unitGroup) continue;
        const g = UNIT_GROUPS[p.unitGroup];
        expect(g, `${f.id}.${p.key} 单位分组 ${p.unitGroup} 未定义`).toBeDefined();
        for (const u of g.units) {
          expect(isUnitValid(p, u.label), `${f.id}.${p.key} 单位 ${u.label} 判定为非法`).toBe(true);
          const v = 123.456;
          const back = toSI(fromSI(v, p.unitGroup, u.label), p.unitGroup, u.label);
          expect(Math.abs(back - v), `${f.id}.${p.key} ${u.label} 往返失真`).toBeLessThanOrEqual(
            Math.abs(v) * 1e-12 + 1e-12,
          );
        }
      }
    }
  });

  it('常用单位换算系数正确（抽查）', () => {
    expect(toSI(1, 'length', 'mm')).toBeCloseTo(1e-3, 12);
    expect(toSI(1, 'stress', 'MPa')).toBeCloseTo(1e6, 6);
    expect(toSI(1, 'stress', 'N/mm²')).toBeCloseTo(1e6, 6);
    expect(toSI(1, 'pressure', 'mmH₂O')).toBeCloseTo(9.80665, 9);
    expect(toSI(1, 'volumeFlow', 'm³/h')).toBeCloseTo(1 / 3600, 12);
    expect(toSI(1, 'density', 'g/cm³')).toBeCloseTo(1000, 9);
    expect(toSI(1, 'dynamicViscosity', 'cP')).toBeCloseTo(1e-3, 12);
    // 温度是平移换算：0 ℃ = 273.15 K，但温差 1 ℃ = 1 K
    expect(toSI(0, 'temperature', '℃')).toBeCloseTo(273.15, 9);
    expect(fromSI(273.15, 'temperature', '℃')).toBeCloseTo(0, 9);
    expect(toSI(1, 'temperatureDelta', '℃')).toBeCloseTo(1, 12);
  });

  it('切换显示单位不改变 SI 计算结果（全部基准算例）', () => {
    let checked = 0;
    for (const f of formulas) {
      for (const b of f.benchmarks) {
        // SI 输入向量 = 基准输入 + 其余参数的元数据默认值（默认值按声明单位书写，先折算到 SI）
        const { values, units } = defaultInputs(f);
        const siInputs: Record<string, number> = {};
        for (const p of f.inputs) {
          siInputs[p.key] = toSI(p.default ?? 0, p.unitGroup, p.unit);
        }
        Object.assign(siInputs, b.input);

        // 展示值统一换到分组内最后一个（通常非首选）单位
        for (const p of f.inputs) {
          if (!p.unitGroup) {
            values[p.key] = siInputs[p.key];
            continue;
          }
          const g = UNIT_GROUPS[p.unitGroup];
          const alt = g.units[g.units.length - 1].label;
          units[p.key] = alt;
          values[p.key] = fromSI(siInputs[p.key], p.unitGroup, alt);
        }

        const base = f.solve(siInputs);
        const res = computeFormula(f, values, units);
        expect(
          res.ok,
          `${f.id} · ${b.name} 校验未通过：${res.issues.map((i) => i.message).join('；')}`,
        ).toBe(true);
        for (const [k, v] of Object.entries(base)) {
          if (!Number.isFinite(v)) continue;
          const actual = res.outputsSI![k];
          const rel = Math.abs(actual - v) / Math.max(Math.abs(v), 1e-12);
          expect(rel, `${f.id}.${k} 换单位后偏差 ${rel}`).toBeLessThanOrEqual(1e-9);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('输出自动单位属于其分组，且可换算回原 SI 值', () => {
    let checked = 0;
    for (const f of formulas) {
      for (const b of f.benchmarks) {
        const out = f.solve(b.input);
        for (const o of f.outputs) {
          const v = out[o.key];
          if (!o.unitGroup || !Number.isFinite(v)) continue;
          const g = UNIT_GROUPS[o.unitGroup];
          expect(g, `${f.id}.${o.key} 输出单位分组 ${o.unitGroup} 未定义`).toBeDefined();
          const { value, unit } = autoUnit(v, o.unitGroup);
          expect(
            g.units.some((u) => u.label === unit),
            `${f.id}.${o.key} 自动单位 ${unit} 不在分组 ${o.unitGroup} 内`,
          ).toBe(true);
          const back = toSI(value, o.unitGroup, unit);
          expect(
            Math.abs(back - v),
            `${f.id}.${o.key} 输出显示值 ${value} ${unit} 换算回 SI 失真`,
          ).toBeLessThanOrEqual(Math.abs(v) * 1e-9 + 1e-12);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('输入域校验', () => {
  const f = intakeHoseFull;
  const { values, units } = defaultInputs(f);

  it('必填缺失 → error 并阻断计算', () => {
    const bad = { ...values, E: NaN };
    expect(validateInputs(f, bad, units).some((i) => i.key === 'E' && i.level === 'error')).toBe(true);
    const res = computeFormula(f, bad, units);
    expect(res.ok).toBe(false);
    expect(res.outputsSI).toBeUndefined();
  });

  it('非法单位标签 → error，不再按原值静默计算', () => {
    const res = computeFormula(f, values, { ...units, E: 'bar' });
    expect(res.ok).toBe(false);
    expect(res.outputsSI).toBeUndefined();
    expect(res.issues.some((i) => i.key === 'E' && i.level === 'error')).toBe(true);
  });

  it('超出建议范围 → 仅 warn，不阻断计算', () => {
    const p = f.inputs.find((x) => x.min !== undefined && x.min > 0 && x.kind !== 'select')!;
    expect(p, '进气管公式应有带下限的数值输入').toBeDefined();
    const below = { ...values, [p.key]: p.min! * 0.5 };
    const issues = validateInputs(f, below, units);
    expect(issues.some((i) => i.key === p.key && i.level === 'warn')).toBe(true);
    expect(issues.some((i) => i.level === 'error')).toBe(false);
    expect(computeFormula(f, below, units).ok).toBe(true);
  });
});

/**
 * 不确定性分析（蒙特卡洛 + 极值角点包络）
 *
 * 输入带公差时，单点结果不足以支撑设计判断。此处验证：
 * 1) 固定种子可复现；
 * 2) 不扰动时退化为基准值（区间宽度为 0）；
 * 3) 统计量自洽：low ≤ P5 ≤ P50 ≤ P95 ≤ high、std ≥ 0、low ≤ mean ≤ high；
 * 4) 影响因子为秩相关绝对值（0~1）且降序，抽样不失败。
 */
describe('不确定性分析', () => {
  const f = airFilterElement;
  const base = f.benchmarks[0].input;
  const siInputs: Record<string, number> = {};
  for (const p of f.inputs) siInputs[p.key] = toSI(p.default ?? 0, p.unitGroup, p.unit);
  Object.assign(siInputs, base);

  const specs = [
    { key: 'vm', rel: 0.05, dist: 'uniform' as const },
    { key: 'mu', rel: 0.05, dist: 'normal' as const },
    { key: 'K', rel: 0.1, dist: 'uniform' as const },
  ];

  it('同一组输入与种子结果完全可复现', () => {
    const a = runUncertainty(f, siInputs, specs, { samples: 500, seed: 42 });
    const b = runUncertainty(f, siInputs, specs, { samples: 500, seed: 42 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('不确定度为 0 时退化为基准结果（区间宽度为 0）', () => {
    const zero = specs.map((s) => ({ ...s, rel: 0 }));
    const r = runUncertainty(f, siInputs, zero, { samples: 300 });
    expect(r.active).toEqual([]);
    expect(r.failed).toBe(0);
    const expect0 = f.solve(siInputs);
    const dp = r.outputs.find((o) => o.key === 'dp')!;
    expect(dp.mean).toBeCloseTo(expect0.dp, 12);
    expect(dp.p5).toBe(dp.mean);
    expect(dp.p95).toBe(dp.mean);
    expect(dp.low).toBe(dp.mean);
    expect(dp.high).toBe(dp.mean);
    expect(dp.std).toBe(0);
  });

  it('统计量自洽且包络包含全部分位数', () => {
    const r = runUncertainty(f, siInputs, specs, { samples: 1000, seed: 7 });
    expect(r.failed).toBe(0);
    expect(r.outputs.length).toBeGreaterThan(0);
    for (const o of r.outputs) {
      expect(Number.isFinite(o.mean), `${o.key} mean 应为数值`).toBe(true);
      expect(o.std).toBeGreaterThanOrEqual(0);
      expect(o.low).toBeLessThanOrEqual(o.p5 + Math.abs(o.p5) * 1e-12 + 1e-12);
      expect(o.p5).toBeLessThanOrEqual(o.p50 + Math.abs(o.p50) * 1e-12 + 1e-12);
      expect(o.p50).toBeLessThanOrEqual(o.p95 + Math.abs(o.p95) * 1e-12 + 1e-12);
      expect(o.p95).toBeLessThanOrEqual(o.high + Math.abs(o.high) * 1e-12 + 1e-12);
      expect(o.low).toBeLessThanOrEqual(o.mean + Math.abs(o.mean) * 1e-12 + 1e-12);
      expect(o.mean).toBeLessThanOrEqual(o.high + Math.abs(o.high) * 1e-12 + 1e-12);
    }
    expect(r.active.map((a) => a.key)).toEqual(['vm', 'mu', 'K']);
  });

  it('扰动参数确实改变结果（压降随不确定度变化）', () => {
    const r = runUncertainty(f, siInputs, specs, { samples: 1000, seed: 7 });
    const dp = r.outputs.find((o) => o.key === 'dp')!;
    const dp0 = f.solve(siInputs).dp;
    expect(dp.high - dp.low).toBeGreaterThan(dp0 * 0.01);
    // 未受扰动的输出保持不变
    const dpc = r.outputs.find((o) => o.key === 'dpc')!;
    expect(dpc.low).toBeCloseTo(dpc.high, 12);
  });

  it('影响因子为 0~1 的秩相关绝对值并降序排列', () => {
    const r = runUncertainty(f, siInputs, specs, { samples: 1000, seed: 7 });
    const dp = r.outputs.find((o) => o.key === 'dp')!;
    expect(dp.influence.length).toBeGreaterThan(0);
    for (const it of dp.influence) {
      expect(it.score).toBeGreaterThanOrEqual(0);
      expect(it.score).toBeLessThanOrEqual(1 + 1e-12);
    }
    for (let i = 1; i < dp.influence.length; i++) {
      expect(dp.influence[i - 1].score).toBeGreaterThanOrEqual(dp.influence[i].score);
    }
  });

  it('抽样数被限制在 100~5000', () => {
    expect(runUncertainty(f, siInputs, specs, { samples: 10 }).samples).toBe(100);
    expect(runUncertainty(f, siInputs, specs, { samples: 99999 }).samples).toBe(5000);
  });

  it('选择型输入与隐藏输入不参与扰动', () => {
    const r = runUncertainty(
      f,
      siInputs,
      [
        { key: 'ftype', rel: 0.1, dist: 'uniform' },
        { key: 'hP', rel: 0.1, dist: 'uniform' }, // ftype=1（圆柱式）时 hP 被隐藏
        { key: 'K', rel: 0.1, dist: 'uniform' },
      ],
      { samples: 200 },
    );
    expect(r.active.map((a) => a.key)).toEqual(['K']);
  });
});

/**
 * 反算求解
 *
 * 正算给结果、反算给参数，是设计校核的两种提问方式。
 * 这里验证：反算值回代后确实命中目标、显示单位回填链路一致、不可达时明确报错。
 */
describe('反算求解', () => {
  const f = airFilterElement;
  const { values, units } = defaultInputs(f);
  const computed = computeFormula(f, values, units);
  const inputsSI = computed.inputsSI!;
  const outputsSI = computed.outputsSI!;

  it('基准输入可正常计算（反算前提）', () => {
    expect(computed.ok).toBe(true);
    expect(outputsSI.dp).toBeGreaterThan(0);
  });

  it('按目标压降反算渗透率 K，回代命中目标', () => {
    const goal = outputsSI.dp * 0.9;
    const r = backsolve(f, inputsSI, { target: 'K', output: 'dp', goal });
    expect(Math.abs(r.residual)).toBeLessThanOrEqual(goal * 1e-6);
    expect(Math.abs(r.outputSI - goal) / goal).toBeLessThanOrEqual(1e-6);
    // 压降随渗透率增大而下降，因此 90% 压降对应更大的 K
    expect(r.value).toBeGreaterThan(inputsSI.K);
    const check = f.solve({ ...inputsSI, K: r.value });
    expect(Math.abs(check.dp - goal) / goal).toBeLessThanOrEqual(1e-6);
    expect(r.iterations).toBeLessThan(60);
  });

  it('反算厚度并按显示单位回填后重算一致', () => {
    const goal = outputsSI.dp * 0.8;
    const r = backsolve(f, inputsSI, { target: 't', output: 'dp', goal });
    const tDisplay = fromSI(r.value, 'length', units.t);
    const res = computeFormula(f, { ...values, t: tDisplay }, units);
    expect(res.ok).toBe(true);
    expect(Math.abs(res.outputsSI!.dp - goal) / goal).toBeLessThanOrEqual(1e-6);
  });

  it('目标值超出搜索区间可达范围时明确报错', () => {
    expect(() =>
      backsolve(f, inputsSI, { target: 'etaV', output: 'Q', goal: outputsSI.Q * 1000 }),
    ).toThrow(/超出搜索区间/);
  });

  it('选择型参数不可反算', () => {
    expect(() => backsolve(f, inputsSI, { target: 'ftype', output: 'dp', goal: 200 })).toThrow(
      /选择型/,
    );
  });

  it('显式搜索区间被采用，且解落在区间内', () => {
    const goal = outputsSI.dp * 0.9;
    const min = inputsSI.K * 0.5;
    const max = inputsSI.K * 4;
    const r = backsolve(f, inputsSI, { target: 'K', output: 'dp', goal, min, max });
    expect(r.bracket).toEqual([min, max]);
    expect(r.value).toBeGreaterThanOrEqual(min);
    expect(r.value).toBeLessThanOrEqual(max);
    expect(Math.abs(r.residual)).toBeLessThanOrEqual(goal * 1e-6);
  });
});

/**
 * 设计探索：参数扫描与可行域
 *
 * 扫描给出「沿某参数变化时结果怎么走、哪一段满足约束」；
 * 可行域给出「同时调两个参数时的设计窗口」。
 */
describe('设计探索', () => {
  const f = airFilterElement;
  const { values, units } = defaultInputs(f);
  const computed = computeFormula(f, values, units);
  const inputsSI = computed.inputsSI!;
  const outputsSI = computed.outputsSI!;

  it('约束判定：le / ge / between 及非有限值', () => {
    expect(satisfyConstraint(5, { output: 'x', op: 'le', value: 5 })).toBe(true);
    expect(satisfyConstraint(5.1, { output: 'x', op: 'le', value: 5 })).toBe(false);
    expect(satisfyConstraint(5, { output: 'x', op: 'ge', value: 5 })).toBe(true);
    expect(satisfyConstraint(4.9, { output: 'x', op: 'ge', value: 5 })).toBe(false);
    expect(satisfyConstraint(5, { output: 'x', op: 'between', value: 10, value2: 1 })).toBe(true);
    expect(satisfyConstraint(11, { output: 'x', op: 'between', value: 1, value2: 10 })).toBe(false);
    expect(satisfyConstraint(NaN, { output: 'x', op: 'le', value: 5 })).toBe(false);
    // 无约束时一律可行
    expect(isFeasible({}, [])).toBe(true);
    expect(isFeasible({ x: 100 }, [{ output: 'x', op: 'le', value: 5 }])).toBe(false);
  });

  it('参数扫描点数与首尾取值正确', () => {
    const r = sweep(f, inputsSI, {
      xKey: 'vm',
      xMin: inputsSI.vm * 0.5,
      xMax: inputsSI.vm * 1.5,
      steps: 21,
      output: 'dp',
      constraints: [],
    });
    expect(r.points.length).toBe(21);
    expect(r.evaluated).toBe(21);
    expect(r.failed).toBe(0);
    expect(r.points[0].x).toBeCloseTo(inputsSI.vm * 0.5, 15);
    expect(r.points[20].x).toBeCloseTo(inputsSI.vm * 1.5, 15);
    // 无约束 → 全程可行，且合并为一段覆盖全区间
    expect(r.ratio).toBe(1);
    expect(r.segments.length).toBe(1);
    expect(r.segments[0][0]).toBeCloseTo(inputsSI.vm * 0.5, 15);
  });

  it('压降约束下可行段连续，且段内每点都满足约束', () => {
    // 压降 ∝ 滤材厚度 t（β=0 时纯 Darcy 项），扫描 t 可得到明确的分界
    const limit = outputsSI.dp;
    const r = sweep(f, inputsSI, {
      xKey: 't',
      xMin: inputsSI.t * 0.2,
      xMax: inputsSI.t * 3,
      steps: 81,
      output: 'dp',
      constraints: [{ output: 'dp', op: 'le', value: limit }],
    });
    // 压降随厚度单调上升，故可行段必从区间左端开始
    expect(r.segments.length).toBeGreaterThan(0);
    expect(r.segments[0][0]).toBeCloseTo(inputsSI.t * 0.2, 15);
    expect(r.ratio).toBeGreaterThan(0);
    expect(r.ratio).toBeLessThan(1);
    for (const pt of r.points) {
      if (!pt.feasible) continue;
      expect(pt.outputs.dp).toBeLessThanOrEqual(limit);
      expect(pt.y).toBeLessThanOrEqual(limit);
    }
    // 段间按 x 升序、互不重叠
    for (let i = 1; i < r.segments.length; i++) {
      expect(r.segments[i][0]).toBeGreaterThan(r.segments[i - 1][1]);
    }
  });

  it('区间约束（between）时只保留交集内的点', () => {
    const mid = outputsSI.dp;
    const r = sweep(f, inputsSI, {
      xKey: 't',
      xMin: inputsSI.t * 0.2,
      xMax: inputsSI.t * 3,
      steps: 81,
      output: 'dp',
      constraints: [{ output: 'dp', op: 'between', value: mid * 0.5, value2: mid * 1.2 }],
    });
    expect(r.segments.length).toBeGreaterThan(0);
    for (const pt of r.points) {
      if (!pt.feasible) continue;
      expect(pt.outputs.dp).toBeGreaterThanOrEqual(mid * 0.5);
      expect(pt.outputs.dp).toBeLessThanOrEqual(mid * 1.2);
    }
  });

  it('扫描区间非法时明确报错', () => {
    expect(() =>
      sweep(f, inputsSI, { xKey: 'vm', xMin: 1, xMax: 1, steps: 11, output: 'dp', constraints: [] }),
    ).toThrow(/扫描区间非法/);
    expect(() =>
      sweep(f, inputsSI, { xKey: 'ftype', xMin: 0, xMax: 1, steps: 11, output: 'dp', constraints: [] }),
    ).toThrow(/选择型/);
  });

  it('可行域网格：格数、可行占比与约束一致', () => {
    const r = sweepGrid(f, inputsSI, {
      xKey: 't',
      xMin: inputsSI.t * 0.5,
      xMax: inputsSI.t * 2,
      yKey: 'K',
      yMin: inputsSI.K * 0.5,
      yMax: inputsSI.K * 3,
      size: 11,
      constraints: [{ output: 'dp', op: 'le', value: outputsSI.dp * 1.5 }],
    });
    expect(r.xs.length).toBe(11);
    expect(r.ys.length).toBe(11);
    expect(r.cells.length).toBe(121);
    expect(r.evaluated).toBe(121);
    expect(r.failed).toBe(0);
    expect(r.feasibleCount).toBe(r.cells.filter((c) => c.feasible).length);
    expect(r.ratio).toBeCloseTo(r.feasibleCount / 121, 12);
    // 压降 ∝ t/K：可行格应集中在小厚度、大渗透率一侧
    const feasibleCells = r.cells.filter((c) => c.feasible);
    expect(feasibleCells.length).toBeGreaterThan(0);
    const avgX = feasibleCells.reduce((s, c) => s + c.xi, 0) / feasibleCells.length;
    const avgY = feasibleCells.reduce((s, c) => s + c.yi, 0) / feasibleCells.length;
    expect(avgX).toBeLessThan(5); // 网格中位索引
    expect(avgY).toBeGreaterThan(5);
  });

  it('可行域横纵轴相同或非法区间时报错', () => {
    expect(() =>
      sweepGrid(f, inputsSI, {
        xKey: 'vm',
        xMin: 0.01,
        xMax: 0.2,
        yKey: 'vm',
        yMin: 0.01,
        yMax: 0.2,
        size: 11,
        constraints: [],
      }),
    ).toThrow(/不能是同一参数/);
    expect(() =>
      sweepGrid(f, inputsSI, {
        xKey: 'vm',
        xMin: 0.2,
        xMax: 0.01,
        yKey: 'K',
        yMin: 1e-12,
        yMax: 1e-11,
        size: 11,
        constraints: [],
      }),
    ).toThrow(/横轴区间非法/);
  });
});
