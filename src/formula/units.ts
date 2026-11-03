/**
 * 单位换算模块
 *
 * 约定：所有 solve 函数的入参、出参一律使用 SI 基本/导出单位。
 * 界面按单位分组提供下拉框，用户输入工程单位，模块负责换算与回显。
 */

/** 一个单位制分组：显示单位 -> 换算到 SI 的倍率（SI = 显示值 × factor） */
export interface UnitGroup {
  /** SI 基准单位，用于结果回显 */
  si: string;
  /** 工程习惯优先显示单位（结果数值在合理量级时固定使用） */
  preferred: string;
  /** 可选显示单位及倍率 */
  units: { label: string; factor: number }[];
}

export const UNIT_GROUPS: Record<string, UnitGroup> = {
  length: {
    si: 'm',
    preferred: 'mm',
    units: [
      { label: 'm', factor: 1 },
      { label: 'mm', factor: 0.001 },
      { label: 'cm', factor: 0.01 },
    ],
  },
  /** 与 length 同一套 factor，但默认显示 m，供需统一米制的公式（如进气阻力）使用 */
  lengthMeter: {
    si: 'm',
    preferred: 'm',
    units: [
      { label: 'm', factor: 1 },
      { label: 'mm', factor: 0.001 },
      { label: 'cm', factor: 0.01 },
    ],
  },
  diameter: {
    si: 'm',
    preferred: 'mm',
    units: [
      { label: 'm', factor: 1 },
      { label: 'mm', factor: 0.001 },
    ],
  },
  /** 与 diameter 同一套 factor，但默认显示 m，供需统一米制的公式（如进气阻力）使用 */
  diameterMeter: {
    si: 'm',
    preferred: 'm',
    units: [
      { label: 'm', factor: 1 },
      { label: 'mm', factor: 0.001 },
    ],
  },
  area: {
    si: 'm²',
    preferred: 'm²',
    units: [
      { label: 'm²', factor: 1 },
      { label: 'mm²', factor: 1e-6 },
      { label: 'cm²', factor: 1e-4 },
    ],
  },
  volume: {
    si: 'm³',
    preferred: 'L',
    units: [
      { label: 'L', factor: 0.001 },
      { label: 'm³', factor: 1 },
      { label: 'mL', factor: 1e-6 },
    ],
  },
  volumeFlow: {
    si: 'm³/s',
    preferred: 'L/s',
    units: [
      { label: 'm³/s', factor: 1 },
      { label: 'L/s', factor: 0.001 },
      { label: 'L/min', factor: 1 / 60000 },
      { label: 'm³/h', factor: 1 / 3600 },
    ],
  },
  pressure: {
    si: 'Pa',
    preferred: 'kPa',
    units: [
      { label: 'Pa', factor: 1 },
      { label: 'kPa', factor: 1000 },
      { label: 'MPa', factor: 1e6 },
      { label: 'bar', factor: 1e5 },
      { label: 'mbar', factor: 100 },
      { label: 'mmH₂O', factor: 9.80665 },
    ],
  },
  velocity: {
    si: 'm/s',
    preferred: 'm/s',
    units: [
      { label: 'm/s', factor: 1 },
      { label: 'km/h', factor: 1 / 3.6 },
    ],
  },
  density: {
    si: 'kg/m³',
    preferred: 'kg/m³',
    units: [
      { label: 'kg/m³', factor: 1 },
      { label: 'g/cm³', factor: 1000 },
    ],
  },
  dynamicViscosity: {
    si: 'Pa·s',
    preferred: 'mPa·s',
    units: [
      { label: 'Pa·s', factor: 1 },
      { label: ' mPa·s', factor: 1e-3 },
      { label: 'cP', factor: 1e-3 },
    ],
  },
  forchheimerInertia: {
    si: 'm⁻¹',
    preferred: '10⁻⁷ m⁻¹',
    units: [
      { label: 'm⁻¹', factor: 1 },
      { label: '10⁻⁷ m⁻¹', factor: 1e-7 },
      { label: '10⁻⁶ m⁻¹', factor: 1e-6 },
    ],
  },
  /** 惯性阻尼系数 β 的滤芯级分组：默认 10⁻⁴ m⁻¹ */
  forchheimerInertia4: {
    si: 'm⁻¹',
    preferred: '10⁻⁴ m⁻¹',
    units: [
      { label: 'm⁻¹', factor: 1 },
      { label: '10⁻⁴ m⁻¹', factor: 1e-4 },
      { label: '10⁻⁷ m⁻¹', factor: 1e-7 },
    ],
  },
  viscousDrag: {
    si: 'm⁻²',
    preferred: '10¹⁰ m⁻²',
    units: [
      { label: 'm⁻²', factor: 1 },
      { label: '10⁹ m⁻²', factor: 1e9 },
      { label: '10¹⁰ m⁻²', factor: 1e10 },
    ],
  },
  /** 粘性阻尼系数 α_v 的滤芯级分组：默认 10⁹ m⁻² */
  viscousDrag9: {
    si: 'm⁻²',
    preferred: '10⁹ m⁻²',
    units: [
      { label: 'm⁻²', factor: 1 },
      { label: '10⁹ m⁻²', factor: 1e9 },
      { label: '10¹⁰ m⁻²', factor: 1e10 },
    ],
  },
  force: {
    si: 'N',
    preferred: 'N',
    units: [
      { label: 'N', factor: 1 },
      { label: 'kN', factor: 1000 },
      { label: 'kgf', factor: 9.80665 },
    ],
  },
  stress: {
    si: 'Pa',
    preferred: 'MPa',
    units: [
      { label: 'Pa', factor: 1 },
      { label: 'kPa', factor: 1000 },
      { label: 'MPa', factor: 1e6 },
      { label: 'N/mm²', factor: 1e6 },
    ],
  },
  temperature: {
    // 摄氏与开尔文为平移换算，由 toSI / fromSI 单独处理
    si: 'K',
    preferred: '℃',
    units: [
      { label: '℃', factor: 1 },
      { label: 'K', factor: 1 },
    ],
  },
  temperatureDelta: {
    si: 'K',
    preferred: 'K',
    units: [
      { label: 'K', factor: 1 },
      { label: '℃', factor: 1 },
    ],
  },
  thermalConductivity: {
    si: 'W/(m·K)',
    preferred: 'W/(m·K)',
    units: [
      { label: 'W/(m·K)', factor: 1 },
      { label: 'W/(mm·K)', factor: 1000 },
    ],
  },
  heatFlux: {
    si: 'W/m²',
    preferred: 'W/m²',
    units: [
      { label: 'W/m²', factor: 1 },
      { label: 'kW/m²', factor: 1000 },
    ],
  },
  power: {
    si: 'W',
    preferred: 'W',
    units: [
      { label: 'W', factor: 1 },
      { label: 'kW', factor: 1000 },
    ],
  },
  massFlow: {
    si: 'kg/s',
    preferred: 'kg/s',
    units: [
      { label: 'kg/s', factor: 1 },
      { label: 'kg/h', factor: 1 / 3600 },
      { label: 'g/s', factor: 0.001 },
    ],
  },
  specificHeat: {
    si: 'J/(kg·K)',
    preferred: 'J/(kg·K)',
    units: [
      { label: 'J/(kg·K)', factor: 1 },
      { label: 'kJ/(kg·K)', factor: 1000 },
    ],
  },
  dimensionless: {
    si: '-',
    preferred: '-',
    units: [{ label: '-', factor: 1 }],
  },
  /** 截面二次矩（惯性矩） */
  secondMomentOfArea: {
    si: 'm⁴',
    preferred: 'mm⁴',
    units: [
      { label: 'm⁴', factor: 1 },
      { label: 'cm⁴', factor: 1e-8 },
      { label: 'mm⁴', factor: 1e-12 },
    ],
  },
  /** 刚度（轴向拉压、弯曲） */
  stiffness: {
    si: 'N/m',
    preferred: 'kN/m',
    units: [
      { label: 'N/m', factor: 1 },
      { label: 'kN/m', factor: 1000 },
      { label: 'N/mm', factor: 1000 },
    ],
  },
  frequency: {
    si: 'Hz',
    preferred: 'Hz',
    units: [
      { label: 'Hz', factor: 1 },
      { label: 'kHz', factor: 1000 },
    ],
  },
  mass: {
    si: 'kg',
    preferred: 'kg',
    units: [
      { label: 'kg', factor: 1 },
      { label: 'g', factor: 0.001 },
      { label: 't', factor: 1000 },
    ],
  },
  /** 面密度（管壁单位面积质量） */
  surfaceDensity: {
    si: 'kg/m²',
    preferred: 'kg/m²',
    units: [
      { label: 'kg/m²', factor: 1 },
      { label: 'g/m²', factor: 0.001 },
    ],
  },
  /** 多孔介质渗透率 α（m²） */
  permeability: {
    si: 'm²',
    preferred: '10⁻¹¹ m²',
    units: [
      { label: 'm²', factor: 1 },
      { label: '10⁻¹¹ m²', factor: 1e-11 },
      { label: '10⁻¹² m²', factor: 1e-12 },
    ],
  },
  /** 面积倒数，用于 Fluent 粘性阻力系数 1/α（m⁻²） */
  inverseArea: {
    si: 'm⁻²',
    preferred: 'm⁻²',
    units: [{ label: 'm⁻²', factor: 1 }],
  },
  /** 长度倒数，用于 Fluent 惯性阻力系数 C₂（m⁻¹） */
  inverseLength: {
    si: 'm⁻¹',
    preferred: 'm⁻¹',
    units: [{ label: 'm⁻¹', factor: 1 }],
  },
  /** STAR-CCM+ 粘性阻力系数 P_v（kg/(m³·s)） */
  viscousResistance: {
    si: 'kg/(m³·s)',
    preferred: 'kg/(m³·s)',
    units: [{ label: 'kg/(m³·s)', factor: 1 }],
  },
  /** STAR-CCM+ 惯性阻力系数 P_i（kg/m⁴） */
  inertialResistance: {
    si: 'kg/m⁴',
    preferred: 'kg/m⁴',
    units: [{ label: 'kg/m⁴', factor: 1 }],
  },
};

/** 温度是平移换算，需单独处理 */
export function isTemperatureGroup(group?: string): boolean {
  return group === 'temperature';
}

/** 显示值 -> SI 值 */
export function toSI(value: number, group: string | undefined, unitLabel: string): number {
  if (!group) return value;
  const g = UNIT_GROUPS[group];
  if (!g) return value;
  if (group === 'temperature') {
    // 显示值可能是 ℃ 或 K；求解内部统一使用 K
    return unitLabel === '℃' ? value + 273.15 : value;
  }
  const u = g.units.find((x) => x.label === unitLabel);
  if (!u) return value;
  return value * u.factor;
}

/** SI 值 -> 显示值 */
export function fromSI(value: number, group: string | undefined, unitLabel: string): number {
  if (!group) return value;
  const g = UNIT_GROUPS[group];
  if (!g) return value;
  if (group === 'temperature') {
    return unitLabel === '℃' ? value - 273.15 : value;
  }
  const u = g.units.find((x) => x.label === unitLabel);
  if (!u) return value;
  return value / u.factor;
}

/** 结果自动选择显示单位：优先工程习惯单位，量级极端时自动缩放 */
export function autoUnit(valueSI: number, group?: string): { value: number; unit: string } {
  if (!group) return { value: valueSI, unit: '' };
  const g = UNIT_GROUPS[group];
  if (!g) return { value: valueSI, unit: '' };
  // 绝对温度默认以 ℃ 显示（工程习惯），温差以 K 显示
  if (group === 'temperature') return { value: valueSI - 273.15, unit: '℃' };
  if (group === 'temperatureDelta') return { value: valueSI, unit: 'K' };

  const pref = g.units.find((u) => u.label === g.preferred);
  if (pref) {
    const pv = valueSI / pref.factor;
    if (Math.abs(pv) >= 0.01 && Math.abs(pv) < 1e5) return { value: pv, unit: pref.label };
  }
  const sorted = [...g.units].sort((a, b) => b.factor - a.factor);
  for (const u of sorted) {
    const v = valueSI / u.factor;
    if (Math.abs(v) >= 1) return { value: v, unit: u.label };
  }
  const smallest = sorted[sorted.length - 1];
  return { value: valueSI / smallest.factor, unit: smallest.label };
}

/** 数值格式化：软件内所有输出结果统一保留 3 位小数 */
export function formatNumber(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : s;
}
