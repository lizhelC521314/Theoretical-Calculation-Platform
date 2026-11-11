/**
 * 公式输入的材料库绑定
 *
 * 目的：让材料相关输入（弹性模量、密度、拉伸强度等）不再手填，
 * 直接从材料库记录带入，并保证单位换算与公式内部 SI 体系一致。
 *
 * 材料库记录中的物性使用工程单位（MPa、kg/m³、J/(kg·℃) 等），
 * 此处统一先换算到 SI，再按参数的显示单位回算。
 */
import type { FluidPoint, MaterialRecord, MaterialType } from '../report/material';
import type { MaterialBind, MaterialBindField, ParamSpec } from './types';
import { fromSI } from './units';

/** 材料库中的一条可选记录 */
export interface MaterialOption {
  /** 材料记录文件完整路径，作为绑定标识 */
  filePath: string;
  rec: MaterialRecord;
}

/** 流体属性表插值结果：物性为材料库单位（kg/m³、mPa·s、W/(m·K)、kJ/(kg·K)） */
export interface FluidInterp {
  density: number;
  dynamicViscosity: number;
  thermalConductivity: number;
  specificHeat: number;
  /** 实际采用的温度（℃）；超出属性表范围时夹到端点 */
  temperature: number;
  /** 目标温度是否落在属性表温度范围内 */
  inRange: boolean;
}

/** 流体属性表温度范围（℃），无有效数据时返回 null */
export function fluidTemperatureRange(
  points: FluidPoint[] | null | undefined,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points ?? []) {
    if (!Number.isFinite(p.temperature)) continue;
    if (p.temperature < min) min = p.temperature;
    if (p.temperature > max) max = p.temperature;
  }
  return min <= max ? { min, max } : null;
}

/**
 * 按温度对流体属性表线性插值。
 * 超出属性表范围时取最近端点并置 inRange=false，由界面提示「按端点值带入」。
 */
export function interpFluidPoints(
  points: FluidPoint[] | null | undefined,
  temperatureC: number,
): FluidInterp | null {
  if (!Number.isFinite(temperatureC)) return null;
  const sorted = (points ?? [])
    .filter((p) => Number.isFinite(p.temperature))
    .sort((a, b) => a.temperature - b.temperature);
  if (!sorted.length) return null;

  const at = (p: FluidPoint, inRange: boolean): FluidInterp => ({
    density: p.density,
    dynamicViscosity: p.dynamicViscosity,
    thermalConductivity: p.thermalConductivity,
    specificHeat: p.specificHeat,
    temperature: p.temperature,
    inRange,
  });

  const first = sorted[0];
  if (temperatureC <= first.temperature) return at(first, temperatureC === first.temperature);
  const last = sorted[sorted.length - 1];
  if (temperatureC >= last.temperature) return at(last, temperatureC === last.temperature);

  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (temperatureC > b.temperature) continue;
    const span = b.temperature - a.temperature;
    const r = span > 0 ? (temperatureC - a.temperature) / span : 0;
    const lerp = (x: number, y: number) => x + (y - x) * r;
    return {
      density: lerp(a.density, b.density),
      dynamicViscosity: lerp(a.dynamicViscosity, b.dynamicViscosity),
      thermalConductivity: lerp(a.thermalConductivity, b.thermalConductivity),
      specificHeat: lerp(a.specificHeat, b.specificHeat),
      temperature: temperatureC,
      inRange: true,
    };
  }
  return at(last, false);
}

/** 各物性字段的展示名、库内单位与 SI 换算倍率 */
export const MATERIAL_BIND_FIELDS: Record<
  MaterialBindField,
  {
    label: string;
    /** 材料库记录中该值的单位 */
    unit: string;
    /** 库内值 → SI 的倍率 */
    factor: number;
    /** 参数应使用的单位分组（用于校验绑定声明是否合理） */
    unitGroup?: string;
    /** 取自流体属性表（需按温度插值） */
    fluid?: boolean;
    /** 取自多孔介质参数 */
    porous?: boolean;
    get: (rec: MaterialRecord, temperatureC?: number) => number | null;
  }
> = {
  density: {
    label: '密度',
    unit: 'kg/m³',
    factor: 1,
    unitGroup: 'density',
    get: (r) => r.density,
  },
  poisson: {
    label: '泊松比',
    unit: '-',
    factor: 1,
    unitGroup: 'dimensionless',
    get: (r) => r.poisson,
  },
  elasticModulus: {
    label: '弹性模量',
    unit: 'MPa',
    factor: 1e6,
    unitGroup: 'stress',
    get: (r) => r.elasticModulus,
  },
  tensileStrength: {
    label: '抗拉强度',
    unit: 'MPa',
    factor: 1e6,
    unitGroup: 'stress',
    get: (r) => r.tensileStrength,
  },
  failureStrain: {
    label: '破坏应变',
    unit: '%',
    factor: 1,
    get: (r) => r.failureStrain,
  },
  specificHeat: {
    label: '比热容',
    unit: 'J/(kg·℃)',
    factor: 1,
    unitGroup: 'specificHeat',
    get: (r) => r.specificHeat,
  },
  thermalConductivity: {
    label: '热导率',
    unit: 'W/(m·℃)',
    factor: 1,
    unitGroup: 'thermalConductivity',
    get: (r) => r.thermalConductivity,
  },
  expansionCoefficient: {
    label: '膨胀系数',
    unit: 'mm/(mm·K)',
    factor: 1,
    get: (r) => r.expansionCoefficient,
  },

  // ===== 流体属性表（按温度插值） =====
  fluidDensity: {
    label: '密度',
    unit: 'kg/m³',
    factor: 1,
    unitGroup: 'density',
    fluid: true,
    get: (r, t) => fluidPick(r, t, (i) => i.density),
  },
  fluidViscosity: {
    label: '动力粘度',
    unit: 'mPa·s',
    factor: 1e-3,
    unitGroup: 'dynamicViscosity',
    fluid: true,
    get: (r, t) => fluidPick(r, t, (i) => i.dynamicViscosity),
  },
  fluidThermalConductivity: {
    label: '热导率',
    unit: 'W/(m·K)',
    factor: 1,
    unitGroup: 'thermalConductivity',
    fluid: true,
    get: (r, t) => fluidPick(r, t, (i) => i.thermalConductivity),
  },
  fluidSpecificHeat: {
    label: '比热容',
    unit: 'kJ/(kg·K)',
    factor: 1000,
    unitGroup: 'specificHeat',
    fluid: true,
    get: (r, t) => fluidPick(r, t, (i) => i.specificHeat),
  },

  // ===== 多孔介质参数 =====
  poreSize: {
    label: '孔径',
    unit: 'μm',
    factor: 1e-6,
    porous: true,
    get: (r) => r.porousProps?.poreSize ?? null,
  },
  /** Fluent 粘性阻力系数 1/α（m⁻²）与渗透率 α（m²）互为倒数 */
  porousPermeability: {
    label: '渗透率',
    unit: 'm²',
    factor: 1,
    unitGroup: 'permeability',
    porous: true,
    get: (r) => {
      const v = r.porousProps?.viscousResistance;
      return v != null && v > 0 ? 1 / v : null;
    },
  },
  porousViscousResistance: {
    label: '粘性阻力系数',
    unit: 'm⁻²',
    factor: 1,
    unitGroup: 'viscousDrag9',
    porous: true,
    get: (r) => r.porousProps?.viscousResistance ?? null,
  },
  porousInertialResistance: {
    label: '惯性阻力系数',
    unit: 'm⁻¹',
    factor: 1,
    unitGroup: 'inverseLength',
    porous: true,
    get: (r) => r.porousProps?.inertialResistance ?? null,
  },
  porousViscousCoefficient: {
    label: '粘性阻尼系数',
    unit: 'kg/(m³·s)',
    factor: 1,
    unitGroup: 'viscousResistance',
    porous: true,
    get: (r) => r.porousProps?.viscousCoefficient ?? null,
  },
  porousInertialCoefficient: {
    label: '惯性阻尼系数',
    unit: 'kg/m⁴',
    factor: 1,
    unitGroup: 'inertialResistance',
    porous: true,
    get: (r) => r.porousProps?.inertialCoefficient ?? null,
  },
};

/** 流体物性：按温度插值后取单项；缺少温度或无属性表时返回 null */
function fluidPick(
  rec: MaterialRecord,
  temperatureC: number | undefined,
  pick: (i: FluidInterp) => number,
): number | null {
  if (temperatureC == null) return null;
  const it = interpFluidPoints(rec.fluidPoints, temperatureC);
  if (!it) return null;
  const v = pick(it);
  return Number.isFinite(v) ? v : null;
}

/** 该字段是否来自流体属性表（需要插值温度） */
export function isFluidBindField(field: MaterialBindField): boolean {
  return !!MATERIAL_BIND_FIELDS[field].fluid;
}

/** 该字段是否来自多孔介质参数 */
export function isPorousBindField(field: MaterialBindField): boolean {
  return !!MATERIAL_BIND_FIELDS[field].porous;
}

/** 绑定声明可接受的材料类型：未显式声明时按物性字段判定 */
export function allowedMaterialTypes(
  field: MaterialBindField,
  declared?: MaterialBind['types'],
): MaterialType[] {
  if (declared && declared.length) return declared;
  if (isFluidBindField(field)) return ['fluid'];
  if (isPorousBindField(field)) return ['porous'];
  return ['conventional', 'hyperelastic'];
}

/** 下拉框中的材料名称：牌号 · 系列号 · 温度 */
export function materialOptionLabel(rec: MaterialRecord): string {
  const parts = [rec.grade, rec.series];
  if (rec.temperature != null) parts.push(`${rec.temperature}℃`);
  return parts.filter(Boolean).join(' · ');
}

/** 温度显示值 → 摄氏温度（材料库属性表以 ℃ 给出） */
export function temperatureToCelsius(value: number, unitLabel: string): number {
  if (!Number.isFinite(value)) return NaN;
  return unitLabel === 'K' ? value - 273.15 : value;
}

/**
 * 从公式当前输入解析绑定所需的插值温度（℃）。
 * 未声明 temperatureFrom、输入未填或非温度输入时返回 undefined。
 */
export function resolveBindTemperature(
  bind: MaterialBind | undefined,
  inputs: ParamSpec[],
  values: Record<string, number>,
  units: Record<string, string>,
): number | undefined {
  const key = bind?.temperatureFrom;
  if (!key) return undefined;
  const v = values[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const p = inputs.find((x) => x.key === key);
  if (!p) return undefined;
  const unitLabel = p.unitGroup ? units[key] ?? p.unit : p.unit;
  const c = temperatureToCelsius(v, unitLabel);
  return Number.isFinite(c) ? c : undefined;
}

/** 绑定物性的展示名：流体物性附带插值温度，超出属性表范围时说明取端点值 */
export function bindFieldLabel(
  rec: MaterialRecord | null | undefined,
  field: MaterialBindField,
  temperatureC?: number,
): string {
  const meta = MATERIAL_BIND_FIELDS[field];
  if (!meta.fluid || temperatureC == null) return meta.label;
  const it = interpFluidPoints(rec?.fluidPoints, temperatureC);
  if (!it) return meta.label;
  const fmt = (t: number) => String(Number(t.toFixed(1)));
  if (it.inRange) return `${meta.label}（按 ${fmt(it.temperature)}℃ 插值）`;
  const range = fluidTemperatureRange(rec?.fluidPoints);
  const span = range ? `${fmt(range.min)}~${fmt(range.max)}℃` : '给定范围';
  return `${meta.label}（${fmt(temperatureC)}℃ 超出属性表 ${span}，按 ${fmt(it.temperature)}℃ 取值）`;
}

/** 绑定带入的可选项：流体物性需给出插值温度（℃） */
export interface BindOptions {
  temperatureC?: number;
}

/**
 * 按参数当前显示单位，把材料库值换算成可直接填入表单的数值。
 * 材料缺少该物性（或流体物性缺少插值温度）时返回 null（界面保持手工输入）。
 */
export function bindValueForParam(
  rec: MaterialRecord,
  field: MaterialBindField,
  param: Pick<ParamSpec, 'unitGroup' | 'unit'>,
  unitLabel: string,
  opts?: BindOptions,
): number | null {
  const meta = MATERIAL_BIND_FIELDS[field];
  const raw = meta.get(rec, opts?.temperatureC);
  if (raw == null || !Number.isFinite(raw)) return null;
  const si = raw * meta.factor;
  return param.unitGroup ? fromSI(si, param.unitGroup, unitLabel) : si;
}

/**
 * 读取材料库中可用于绑定的材料（常规 / 超弹性 / 流体 / 多孔介质）。
 *
 * 材料库位于网络共享目录，逐条读取 Parquet 转 JSON，按 6 条一批并发；
 * 目录不可达或浏览器调试模式下返回空数组，界面自动隐藏材料下拉框。
 * 类型过滤由绑定声明在界面侧完成（同一批候选可服务多种物性）。
 */
export async function loadMaterialOptions(limit = 300): Promise<MaterialOption[]> {
  try {
    // 动态导入：api 依赖 window（桌面 preload 注入），测试环境不应在模块加载时求值
    const [{ api }, { parseMaterialRecord }] = await Promise.all([
      import('../api'),
      import('../report/material'),
    ]);
    const res = await api.db.list({ libType: 'material' });
    if (!res.ok || !res.files) return [];
    const files = res.files.filter((f) => /\.parquet$/i.test(f.name)).slice(0, limit);
    const out: MaterialOption[] = [];
    for (let i = 0; i < files.length; i += 6) {
      const chunk = files.slice(i, i + 6);
      const parsed = await Promise.all(
        chunk.map(async (f) => {
          try {
            const r = await api.db.readText({ fullPath: f.fullPath });
            const rec = r.ok && r.text ? parseMaterialRecord(r.text) : null;
            return rec ? { filePath: f.fullPath, rec } : null;
          } catch {
            return null;
          }
        }),
      );
      for (const p of parsed) if (p) out.push(p);
    }
    out.sort((a, b) =>
      `${a.rec.grade}${a.rec.series}`.localeCompare(`${b.rec.grade}${b.rec.series}`, 'zh-CN'),
    );
    return out;
  } catch {
    return [];
  }
}
