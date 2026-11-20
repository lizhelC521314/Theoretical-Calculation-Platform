import { describe, it, expect } from 'vitest';
import { calibrateScalar } from '../src/ai/calibration/runScalar';
import { helmholtzInputs, helmholtzScalarModel } from '../src/ai/calibration/adapters/helmholtz';
import { HELMHOLTZ_H1_V1 } from '../src/ai/calibration/strategies/helmholtzV1';
import { evalHelmholtzF0 } from '../src/domains/acoustics/helmholtzMuffler';

describe('赫姆霍兹 H1 标量标定（当前工况对标 CAE 119 Hz）', () => {
  const geom = { D: 60, d: 25.09, lc: 62, h: 59.5, V: 1.5, t: 14.357, e: 12.5, am: 810.871 };
  const inputs = helmholtzInputs(geom);

  it('H0 基线 ≈ 109.3 Hz（δout=ψd，ψ=0.75）', () => {
    const f0 = evalHelmholtzF0(inputs); // 无 calib → H0
    expect(f0).toBeCloseTo(109.3, 0);
  });

  it('H1 标定 δtotal ≈ 6.2 mm，模型 f0 ≈ 119 Hz', () => {
    const report = calibrateScalar({
      strategy: HELMHOLTZ_H1_V1,
      samples: [{ inputs, target: 119, groupId: 'current' }],
      model: helmholtzScalarModel,
      formulaVersion: '3.0.0',
      targetLabel: '中心频率 f0',
      targetUnit: 'Hz',
      fast: true,
      seed: 20261119,
    });
    const dt = report.params.find((p) => p.key === 'delta_total');
    expect(dt).toBeDefined();
    const deltaMm = (dt!.value) * 1000;
    // 文档反算 δtotal ≈ 6.2 mm
    expect(deltaMm).toBeGreaterThan(5);
    expect(deltaMm).toBeLessThan(7);
    // 模型 f0 应贴近 119（正则化下单点不会精确命中，相对误差 < 1% 即可，远优于 H1 验收 5%）
    const band = report.bands.find((b) => b.included);
    expect(band).toBeDefined();
    expect(Math.abs((band!.model - 119) / 119)).toBeLessThan(0.01);
  });
});
