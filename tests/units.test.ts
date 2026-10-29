import { describe, expect, it } from 'vitest';
import { autoUnit, fromSI, toSI } from '../src/formula/units';

describe('单位换算', () => {
  it('长度：mm 转 m', () => {
    expect(toSI(50, 'length', 'mm')).toBeCloseTo(0.05, 12);
    expect(fromSI(0.05, 'length', 'mm')).toBeCloseTo(50, 9);
  });

  it('流量：L/min 转 m³/s', () => {
    expect(toSI(60, 'volumeFlow', 'L/min')).toBeCloseTo(0.001, 12);
  });

  it('压力：kPa 转 Pa', () => {
    expect(toSI(2.5, 'pressure', 'kPa')).toBeCloseTo(2500, 9);
  });

  it('温度：℃ 转 K 为平移换算', () => {
    expect(toSI(25, 'temperature', '℃')).toBeCloseTo(298.15, 9);
    expect(autoUnit(298.15, 'temperature').value).toBeCloseTo(25, 9);
  });

  it('结果自动选择单位', () => {
    expect(autoUnit(8812, 'pressure')).toEqual({ value: 8.812, unit: 'kPa' });
    expect(autoUnit(0.36, 'velocity').unit).toBe('m/s');
  });
});
