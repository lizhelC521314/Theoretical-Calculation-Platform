import { describe, expect, it } from 'vitest';
import { intakeSystemTransmissionLoss } from '../src/domains/acoustics/intakeSystemTransmissionLoss';
import { wovenTubeSilencer } from '../src/domains/acoustics/wovenTubeSilencer';

const spec = intakeSystemTransmissionLoss as unknown as {
  benchmarks: { input: Record<string, number> }[];
  solve: (v: Record<string, number>) => Record<string, number>;
};
const wt = wovenTubeSilencer as unknown as { solve: (v: Record<string, number>) => Record<string, number> };
const base = () => ({ ...spec.benchmarks[0].input });

describe('进气系统：引用子部件记录（refRecord）', () => {
  it('赫姆霍兹旁支：快照覆盖内置参数，记录失效回退', () => {
    const b = spec.benchmarks.find((x) => (x as unknown as { name?: string }).name?.includes('亥姆霍兹谐振腔'));
    expect(b).toBeDefined();
    const v = { ...b!.input, hOn: 1, Vh: 5e-4, ln: 0.03, dn: 0.02 };
    const builtin = spec.solve(v);
    const ref = spec.solve({ ...v, hbModeBox: 1, hbRefLBox: 0.0362, hbRefABox: 3.1416e-4, hbRefVBox: 5e-4 });
    const missing = spec.solve({ ...v, hbModeBox: 1, hbRefLBox: 0, hbRefABox: 0, hbRefVBox: 0 });
    expect(ref.fH).toBeGreaterThan(builtin.fH + 20);
    expect(missing.fH).toBeCloseTo(builtin.fH, 9);
  });

  it('编织管段：引用记录后 TL 与记录公式一致，记录失效回退内置', () => {
    const p = { ...base(), t1: 3, L1: 0.3, D1: 0.05, Dout1: 0.05, twB1: 0.0027 };
    const builtin = spec.solve(p);
    const ref = spec.solve({
      ...p,
      wtMode1: 2,
      wtRefFp1: 1400,
      wtRefTw1: 0.0027,
      wtRefRho1: 1.204,
      wtRefC1: 343.42,
      wtRefGam1: 1.4,
      wtRefP1: 101325,
    });
    const missing = spec.solve({ ...p, wtMode1: 2 });
    const record = wt.solve({
      L: 0.3, D: 0.05, t: 0.0027, fp: 1400,
      rho0: 1.204, c0: 343.42, gam: 1.4, P0: 101325,
      fmin: 20, fmax: 2000,
    });
    expect(Math.abs(ref.tlBraidAvg - record.tl_avg)).toBeLessThan(0.1);
    expect(missing.tlBraidAvg).toBeCloseTo(builtin.tlBraidAvg, 9);
  });
});
