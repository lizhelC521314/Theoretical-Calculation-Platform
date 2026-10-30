import { describe, expect, it } from 'vitest';
import { listFormulas } from '../src/formula/registry';
import { helmholtzMuffler } from '../src/domains/acoustics/helmholtzMuffler';
import { expansionMuffler } from '../src/domains/acoustics/expansionMuffler';
import { quarterWaveTube } from '../src/domains/acoustics/quarterWaveTube';
import { multiCavitySilencer } from '../src/domains/acoustics/multiCavitySilencer';

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
 * PPT 给出 500 Hz≈1 dB、1.7 kHz≈26 dB、2.3 kHz≈42 dB、3.2 kHz≈4 dB（带通特性），
 * 用于确认「耦合项乘逐腔穿孔率 σ_i、P2=πd_in」的实现与文献一致。
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

  it('各腔端部修正 α0,i 按自身 σ_i 单独计算（逐腔不同，不可沿用第 1 腔）', () => {
    const out = multiCavitySilencer.solve(input);
    const alphaOf = (s: number) => 0.8216 * (1 + 1.5319 * Math.sqrt(s) + 1.4099 * s - 0.878 * Math.pow(s, 1.5));
    for (let i = 1; i <= 5; i++) {
      expect(out[`alpha${i}`]).toBeCloseTo(alphaOf(out[`sigma${i}`]), 10);
    }
    // σ 递减 → α0 递减
    for (let i = 1; i <= 4; i++) expect(out[`alpha${i}`]).toBeGreaterThan(out[`alpha${i + 1}`]);
    // 算例参考值：σ1=0.259886 → α0,1≈1.6687；σ5=0.087357 → α0,5≈1.2762
    expect(out.alpha1).toBeCloseTo(1.6686996106, 8);
    expect(out.alpha5).toBeCloseTo(1.2761628113, 8);
    // 未参与计算的腔不给出结果
    expect(out.alpha6).toBeUndefined();
  });

  it('500 Hz / 1.7k / 2.3k / 3.2k 处 TL 与 PPT 文献值（≈1/26/42/4 dB）相差不超过 5 dB', () => {
    expect(Math.abs(at(500) - 1)).toBeLessThan(5);
    expect(Math.abs(at(1700) - 26)).toBeLessThan(5);
    expect(Math.abs(at(2300) - 42)).toBeLessThan(5);
    expect(Math.abs(at(3200) - 4)).toBeLessThan(5);
  });

  it('低频 TL ≈ 0、峰值位于 2.3 kHz 附近（呈带通，非单调下降）', () => {
    expect(at(100)).toBeLessThan(1);
    const peak = pts.reduce((a, b) => (b.y > a.y ? b : a));
    expect(peak.x).toBeGreaterThan(2000);
    expect(peak.x).toBeLessThan(2600);
    expect(peak.y).toBeGreaterThan(30);
  });
});
