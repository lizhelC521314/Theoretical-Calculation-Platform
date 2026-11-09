/**
 * 材料库数据模型与校验规则
 *
 * 存放目录：\\10.1.1.245\materials library
 * 每条材料保存为 Apache Parquet（单行记录，曲线以 JSON 字符串存列），文件名：
 *   常规材料+牌号+系列号+温度℃.parquet
 *   超弹性+牌号+系列号+温度℃.parquet
 * 检索页下载格式为 CSV。
 *
 * 唯一键：材料类型 + 牌号 + 系列号 + 温度（温度保留 1 位小数）。
 * 同一牌号 + 系列号下的不同温度是不同记录。
 */

import { cleanFileName } from './db';

export type MaterialType = 'conventional' | 'hyperelastic' | 'fluid' | 'porous';

/** 材料状态：湿态 / 干态（默认湿态） */
export type MaterialState = 'wet' | 'dry';

export const MATERIAL_STATE_LABEL: Record<MaterialState, string> = {
  wet: '湿态',
  dry: '干态',
};

export const MATERIAL_TYPE_LABEL: Record<MaterialType, string> = {
  conventional: '常规材料',
  hyperelastic: '超弹性材料',
  fluid: '流体',
  porous: '多孔介质',
};

/** 多孔介质参数（滤纸/滤芯等，随牌号给定，无温度维度） */
export interface PorousProps {
  poreSize: number | null; // 孔径，μm
  viscousResistance: number | null; // 粘性阻力系数，m⁻²
  inertialResistance: number | null; // 惯性阻力系数，m⁻¹
  viscousCoefficient: number | null; // 粘性阻力系数，kg/(m³·s)
  inertialCoefficient: number | null; // 惯性阻力系数，kg/m⁴
  remark: string; // 备注
}

/** 流体属性表一行：温度 + 4 项物性（随温度变化） */
export interface FluidPoint {
  temperature: number; // ℃
  density: number; // kg/m³
  dynamicViscosity: number; // mPa·s
  thermalConductivity: number; // W/(m·K)
  specificHeat: number; // kJ/(kg·K)
}

/** 流体属性表列表头（与导入表格列顺序一致） */
export const FLUID_TABLE_HEADER = [
  '温度(℃)',
  '密度(kg/m³)',
  '动力粘度(mPa·s)',
  '导热系数(W/(m·K))',
  '比热(kJ/(kg·K))',
] as const;

export const MATERIAL_SCHEMA = 'ctr-material-v1';

/** 曲线数据点：应力应变曲线 x=应变(%)，疲劳曲线 x=寿命(cycles) */
export interface CurvePoint {
  x: number;
  y: number;
}

export interface MaterialCurve {
  sourceName?: string;
  points: CurvePoint[];
}

/** 材料记录：物性数值为 null 表示该材料没有此参数 */
export interface MaterialRecord {
  schema: typeof MATERIAL_SCHEMA;
  type: MaterialType;
  name: string; // 名称（流体必填，其余类型为空串）
  grade: string;
  series: string;
  supplier: string;
  state: MaterialState; // 湿态 / 干态
  temperature: number | null; // 流体为 null（温度在属性表内逐行给出）
  density: number | null; // kg/m³
  poisson: number | null;
  elasticModulus: number | null;
  direction: number | null; // 方向，°
  hardness: number | null; // 硬度（HB / HV / HRC / HRB / ...）
  tensileStrength: number | null;
  failureStrain: number | null; // %
  specificHeat: number | null; // 比热容 Cp，J/(kg·℃)
  thermalConductivity: number | null; // 热导率 K，W/(m·℃)
  expansionCoefficient: number | null; // 膨胀系数，mm/(mm·K)
  stressStrainCurve: MaterialCurve | null;
  fatigueCurve: MaterialCurve | null;
  fluidPoints: FluidPoint[] | null; // 流体属性表（仅 fluid 类型）
  porousProps: PorousProps | null; // 多孔介质参数（仅 porous 类型）
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByDisplay: string;
  updatedBy: string;
  revision: number;
}

/** 录入草稿：表单中数值/温度均以字符串保存，便于保持空值 */
export interface MaterialDraft {
  type: MaterialType;
  name: string; // 名称（流体必填，其余类型为空串）
  grade: string;
  series: string;
  supplier: string;
  state: MaterialState;
  temperature: string;
  density: string;
  poisson: string;
  elasticModulus: string;
  direction: string;
  hardness: string;
  tensileStrength: string;
  failureStrain: string;
  specificHeat: string;
  thermalConductivity: string;
  expansionCoefficient: string;
  stressStrainCurve: MaterialCurve | null;
  fatigueCurve: MaterialCurve | null;
  fluidPoints: FluidPoint[] | null; // 流体属性表（仅 fluid 类型）
  // 多孔介质参数（仅 porous 类型，字符串便于保持空值）
  poreSize: string;
  viscousResistance: string;
  inertialResistance: string;
  viscousCoefficient: string;
  inertialCoefficient: string;
  remark: string;
}

export type MaterialTextFieldKey =
  | 'name'
  | 'grade'
  | 'series'
  | 'supplier'
  | 'state'
  | 'temperature'
  | 'density'
  | 'poisson'
  | 'elasticModulus'
  | 'direction'
  | 'hardness'
  | 'tensileStrength'
  | 'failureStrain'
  | 'specificHeat'
  | 'thermalConductivity'
  | 'expansionCoefficient'
  | 'poreSize'
  | 'viscousResistance'
  | 'inertialResistance'
  | 'viscousCoefficient'
  | 'inertialCoefficient'
  | 'remark';

/** 状态文本归一：含「干」判为干态，其余（含空）默认湿态 */
export function normalizeState(text: string): MaterialState {
  return /干/.test(String(text || '')) ? 'dry' : 'wet';
}

export type MaterialCurveKey = 'stressStrainCurve' | 'fatigueCurve';

export interface MaterialFieldDef {
  key: MaterialTextFieldKey;
  label: string;
  group: string;
  required?: boolean;
  unit?: string;
  placeholder?: string;
}

export const MATERIAL_GROUP_ORDER = ['标识与来源', '工况', '基础物性', '力学性能', '曲线数据'] as const;

/** 常规材料与超弹性材料使用同一套字段与导入读取规则 */
const COMMON_MATERIAL_FIELDS: MaterialFieldDef[] = [
  { key: 'grade', label: '牌号', group: '标识与来源', required: true, placeholder: '如 SPCC、PA66-GF30、EPDM-70' },
  { key: 'series', label: '系列号', group: '标识与来源', required: true, placeholder: '如 冷轧钢板、密封橡胶' },
  { key: 'supplier', label: '供应商', group: '标识与来源', placeholder: '如 宝钢、巴斯夫' },
  { key: 'temperature', label: '温度', group: '工况', required: true, unit: '°C', placeholder: '-60 ~ 400' },
  { key: 'direction', label: '方向', group: '工况', unit: '°', placeholder: '如 0 / 45 / 90' },
  { key: 'density', label: '密度', group: '基础物性', unit: 'kg/m³', placeholder: '50 ~ 30000' },
  { key: 'poisson', label: '泊松比', group: '基础物性', placeholder: '0 < v < 0.5' },
  { key: 'elasticModulus', label: '弹性模量', group: '基础物性', unit: 'MPa', placeholder: '选填' },
  { key: 'specificHeat', label: '比热容 Cp', group: '基础物性', unit: 'J/(kg·℃)', placeholder: '选填' },
  { key: 'thermalConductivity', label: '热导率 K', group: '基础物性', unit: 'W/(m·℃)', placeholder: '选填' },
  {
    key: 'expansionCoefficient',
    label: '膨胀系数',
    group: '基础物性',
    unit: 'mm/(mm·K)',
    placeholder: '如 2.3e-5',
  },
  { key: 'hardness', label: '硬度', group: '力学性能', placeholder: '如 180 HB、500 HV、58 HRC（仅数字）' },
  { key: 'tensileStrength', label: '抗拉强度', group: '力学性能', unit: 'MPa', placeholder: '选填' },
  { key: 'failureStrain', label: '破坏应变', group: '力学性能', unit: '%', placeholder: '选填' },
];

/** 流体字段：名称 + 牌号（属性表随文件导入，不走表单字段） */
const FLUID_MATERIAL_FIELDS: MaterialFieldDef[] = [
  { key: 'name', label: '名称', group: '标识与来源', required: true, placeholder: '如 水、乙二醇水溶液、液压油' },
  { key: 'grade', label: '牌号', group: '标识与来源', required: true, placeholder: '如 DW-40、L-HM46' },
];

/** 多孔介质字段：牌号必填，参数选填（与滤纸输入列表一致） */
const POROUS_MATERIAL_FIELDS: MaterialFieldDef[] = [
  { key: 'grade', label: '牌号', group: '标识与来源', required: true, placeholder: '如 XH34720、AK55/66CN1' },
  { key: 'poreSize', label: '孔径', group: '基础物性', unit: 'μm', placeholder: '(0, 10000]' },
  { key: 'viscousResistance', label: '粘性阻力系数', group: '基础物性', unit: 'm⁻²', placeholder: '(0, 1e12]' },
  { key: 'inertialResistance', label: '惯性阻力系数', group: '基础物性', unit: 'm⁻¹', placeholder: '(0, 1e12]' },
  { key: 'viscousCoefficient', label: '粘性阻力系数', group: '基础物性', unit: 'kg/(m³·s)', placeholder: '(0, 1e12]' },
  { key: 'inertialCoefficient', label: '惯性阻力系数', group: '基础物性', unit: 'kg/m⁴', placeholder: '(0, 1e12]' },
  { key: 'remark', label: '备注', group: '基础物性', placeholder: '选填' },
];

export const MATERIAL_FIELDS: Record<MaterialType, MaterialFieldDef[]> = {
  conventional: COMMON_MATERIAL_FIELDS,
  hyperelastic: COMMON_MATERIAL_FIELDS,
  fluid: FLUID_MATERIAL_FIELDS,
  porous: POROUS_MATERIAL_FIELDS,
};

export const MATERIAL_CURVE_FIELDS: Record<
  MaterialType,
  Array<{ key: MaterialCurveKey; label: string; hint: string }>
> = {
  conventional: [
    { key: 'stressStrainCurve', label: '应力应变曲线', hint: 'CSV 两列：应变(%)、应力(MPa)，至少 5 点' },
    { key: 'fatigueCurve', label: '疲劳寿命曲线', hint: 'CSV 两列：寿命(cycles)、应力(MPa)，至少 4 点' },
  ],
  hyperelastic: [
    { key: 'stressStrainCurve', label: '应力应变曲线（单轴）', hint: 'CSV 两列：应变(%)、应力(MPa)，至少 5 点' },
    { key: 'fatigueCurve', label: '疲劳寿命曲线', hint: 'CSV 两列：寿命(cycles)、应力(MPa)，至少 4 点' },
  ],
  fluid: [],
  porous: [],
};

export const CURVE_LABEL: Record<MaterialCurveKey, string> = {
  stressStrainCurve: '应力应变曲线',
  fatigueCurve: '疲劳寿命曲线',
};

export interface MaterialIssue {
  field: string;
  level: 'error' | 'warning';
  message: string;
}

export interface MaterialValidation {
  issues: MaterialIssue[];
  errors: MaterialIssue[];
  warnings: MaterialIssue[];
  missing: string[];
}

function parseNum(s: string): number {
  const t = (s || '').trim();
  if (!t) return NaN;
  return Number(t);
}

function tempLabel(t: number): string {
  return Number.isInteger(t) ? String(t) : String(Number(t.toFixed(1)));
}

/** 唯一键（用于库内比较与冲突提示） */
export function materialKey(input: {
  type: MaterialType;
  grade: string;
  series: string;
  temperature: number | string;
}): string {
  const t = parseNum(String(input.temperature));
  const norm = (s: string) => (s || '').trim().replace(/\s+/g, '').toLowerCase();
  return [input.type, norm(input.grade), norm(input.series), Number.isFinite(t) ? t.toFixed(1) : ''].join('|');
}

/** 空草稿 */
export function emptyDraft(type: MaterialType): MaterialDraft {
  return {
    type,
    name: '',
    grade: '',
    series: '',
    supplier: '',
    state: 'wet',
    temperature: '',
    density: '',
    poisson: '',
    elasticModulus: '',
    direction: '',
    hardness: '',
    tensileStrength: '',
    failureStrain: '',
    specificHeat: '',
    thermalConductivity: '',
    expansionCoefficient: '',
    stressStrainCurve: null,
    fatigueCurve: null,
    fluidPoints: null,
    poreSize: '',
    viscousResistance: '',
    inertialResistance: '',
    viscousCoefficient: '',
    inertialCoefficient: '',
    remark: '',
  };
}

/** 校验曲线数据点 */
export function validateCurvePoints(
  points: CurvePoint[],
  key: MaterialCurveKey,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (key === 'stressStrainCurve') {
    if (points.length < 5) errors.push('至少 5 个数据点');
    // 拉伸与压缩曲线均允许负应变/负应力，此处不再强制非负
    for (let i = 1; i < points.length; i++) {
      if (points[i].x <= points[i - 1].x) {
        warnings.push(`应变存在重复或回退（第 ${i + 1} 行），已按原始顺序保留全部点`);
        break;
      }
    }
    const maxStrain = Math.max(...points.map((p) => p.x));
    if (maxStrain > 1000) warnings.push('最大应变超过 1000%，请确认单位是否为 %');
  } else {
    if (points.length < 4) errors.push('至少 4 个数据点');
    if (points.some((p) => p.x <= 0)) errors.push('寿命必须为正数（cycles）');
    if (points.some((p) => p.y < 0)) errors.push('应力幅不能为负');
    for (let i = 1; i < points.length; i++) {
      if (points[i].x <= points[i - 1].x) {
        warnings.push(`寿命存在重复或回退（第 ${i + 1} 行），已按原始顺序保留全部点`);
        break;
      }
    }
    for (let i = 1; i < points.length; i++) {
      if (points[i].y > points[i - 1].y) {
        warnings.push('应力随寿命出现上升，请确认 S-N 曲线方向');
        break;
      }
    }
  }
  return { errors, warnings };
}

/** 校验流体属性表：逐行检查取值范围，重复温度给警告 */
export function validateFluidPoints(points: FluidPoint[]): MaterialIssue[] {
  const issues: MaterialIssue[] = [];
  const err = (message: string) => issues.push({ field: 'fluidPoints', level: 'error', message });
  const warn = (message: string) => issues.push({ field: 'fluidPoints', level: 'warning', message });
  // [取值函数, 标签, min, max, 单位]
  const ranges: Array<[keyof FluidPoint, string, number, number, string]> = [
    ['temperature', '温度', -273, 1000, '℃'],
    ['density', '密度', 1e-9, 10000, 'kg/m³'],
    ['dynamicViscosity', '动力粘度', 1e-7, 1e5, 'mPa·s'],
    ['thermalConductivity', '导热系数', 1e-9, 10000, 'W/(m·K)'],
    ['specificHeat', '比热', 1e-9, 10000, 'kJ/(kg·K)'],
  ];
  const seen = new Set<number>();
  let dupWarned = false;
  points.forEach((p, i) => {
    ranges.forEach(([key, label, min, max, unit]) => {
      const v = p[key];
      if (!Number.isFinite(v)) err(`第 ${i + 1} 行${label}必须为数值`);
      else if (v < min || v > max) err(`第 ${i + 1} 行${label}需在 ${min} ~ ${max} ${unit}（当前 ${v}）`);
    });
    if (!dupWarned && Number.isFinite(p.temperature)) {
      if (seen.has(p.temperature)) {
        warn(`第 ${i + 1} 行温度 ${p.temperature} ℃ 与前面行重复，已按原始顺序保留`);
        dupWarned = true;
      }
      seen.add(p.temperature);
    }
  });
  return issues;
}

/** 校验一条材料草稿 */
export function validateMaterialDraft(draft: MaterialDraft): MaterialValidation {
  const issues: MaterialIssue[] = [];
  const missing: string[] = [];
  const err = (field: string, message: string) => issues.push({ field, level: 'error', message });
  const warn = (field: string, message: string) => issues.push({ field, level: 'warning', message });

  const grade = draft.grade.trim();
  if (!grade) {
    err('grade', '牌号必填');
    missing.push('牌号');
  } else if (grade.length > 40) {
    err('grade', '牌号不能超过 40 个字符');
  } else if (draft.type !== 'porous' && /[\\/:*?"<>|]/.test(grade)) {
    // 多孔介质牌号允许 / 等字符（如 AK55/66CN1），归档文件名由 cleanFileName 处理
    err('grade', '牌号不能包含 \\ / : * ? " < > |');
  }

  // 流体：名称 + 牌号 + 属性表，与其余类型走不同的校验路径
  if (draft.type === 'fluid') {
    const name = draft.name.trim();
    if (!name) {
      err('name', '名称必填');
      missing.push('名称');
    } else if (name.length > 40) {
      err('name', '名称不能超过 40 个字符');
    } else if (/[\\/:*?"<>|]/.test(name)) {
      err('name', '名称不能包含 \\ / : * ? " < > |');
    }
    if (!draft.fluidPoints || !draft.fluidPoints.length) {
      err('fluidPoints', '流体属性表至少需要 1 行数据');
      missing.push('流体属性表');
    } else {
      issues.push(...validateFluidPoints(draft.fluidPoints));
    }
    return {
      issues,
      errors: issues.filter((i) => i.level === 'error'),
      warnings: issues.filter((i) => i.level === 'warning'),
      missing,
    };
  }

  // 多孔介质：牌号必填，参数选填但限范围
  if (draft.type === 'porous') {
    const porousNums: Array<[MaterialTextFieldKey, string, number, number, string]> = [
      ['poreSize', '孔径', 1e-9, 10000, 'μm'],
      ['viscousResistance', '粘性阻力系数(m⁻²)', 1e-9, 1e12, 'm⁻²'],
      ['inertialResistance', '惯性阻力系数(m⁻¹)', 1e-9, 1e12, 'm⁻¹'],
      ['viscousCoefficient', '粘性阻力系数(kg/(m³·s))', 1e-9, 1e12, 'kg/(m³·s)'],
      ['inertialCoefficient', '惯性阻力系数(kg/m⁴)', 1e-9, 1e12, 'kg/m⁴'],
    ];
    porousNums.forEach(([key, label, min, max, unit]) => {
      const raw = draft[key].trim();
      if (!raw) return;
      const v = parseNum(raw);
      if (!Number.isFinite(v)) err(key, `${label}必须为数值`);
      else if (v < min || v > max) err(key, `${label}需在 ${min} ~ ${max} ${unit}（当前 ${v}）`);
    });
    return {
      issues,
      errors: issues.filter((i) => i.level === 'error'),
      warnings: issues.filter((i) => i.level === 'warning'),
      missing,
    };
  }

  const series = draft.series.trim();
  if (!series) {
    err('series', '系列号必填');
    missing.push('系列号');
  } else if (series.length < 2 || series.length > 40) {
    err('series', '系列号需为 2–40 个字符');
  }

  const tempRaw = draft.temperature.trim();
  const temp = parseNum(tempRaw);
  if (!tempRaw) {
    err('temperature', '温度必填');
    missing.push('温度');
  } else if (!Number.isFinite(temp)) {
    err('temperature', '温度必须为数值');
  } else if (temp < -60 || temp > 400) {
    err('temperature', `温度需在 -60 ~ 400 °C 之间（当前 ${temp}）`);
  } else if (draft.type === 'hyperelastic' && temp > 200) {
    warn('temperature', '超弹性材料温度高于 200 °C，请确认是否超出长期使用温区');
  }

  // 选填空值不校验；非空才检查数值与范围
  const thermalFields: Array<[MaterialTextFieldKey, string, number, number, string]> = [
    ['specificHeat', '比热容 Cp', 100, 10000, 'J/(kg·℃)'],
    ['thermalConductivity', '热导率 K', 0.001, 2000, 'W/(m·℃)'],
    ['expansionCoefficient', '膨胀系数', 0.0000001, 0.01, 'mm/(mm·K)'],
  ];
  const numericFields: Array<[MaterialTextFieldKey, string, number, number, string]> = [
    ['direction', '方向', -180, 360, '°'],
    ['density', '密度', 50, 30000, 'kg/m³'],
    ['poisson', '泊松比', 0.001, 0.499, ''],
    ['elasticModulus', '弹性模量', 0.01, 1000000, 'MPa'],
    ['hardness', '硬度', 0.01, 2000, ''],
    ['tensileStrength', '抗拉强度', 0.01, 5000, 'MPa'],
    ['failureStrain', '破坏应变', 0.01, 1000, '%'],
    ...thermalFields,
  ];

  numericFields.forEach(([key, label, min, max, unit]) => {
    const raw = draft[key].trim();
    if (!raw) return;
    const n = parseNum(raw);
    if (!Number.isFinite(n)) {
      err(key, `${label}必须为数值`);
      return;
    }
    if (key === 'poisson') {
      if (n <= 0 || n >= 0.5) err(key, `泊松比需满足 0 < v < 0.5（当前 ${n}）`);
      else if (draft.type === 'hyperelastic' && n < 0.4) {
        warn(key, '超弹性材料泊松比通常 0.45 ~ 0.5，当前偏低');
      }
      return;
    }
    if (n < min || n > max) {
      err(key, `${label}需在 ${min} ~ ${max}${unit ? ` ${unit}` : ''}（当前 ${n}）`);
    }
  });

  // 曲线选填；有数据时校验格式
  (['stressStrainCurve', 'fatigueCurve'] as MaterialCurveKey[]).forEach((key) => {
    const curve = draft[key];
    if (!curve || curve.points.length === 0) {
      if (key === 'stressStrainCurve') {
        warn(
          key,
          draft.type === 'hyperelastic'
            ? '未提供应力应变曲线：无法拟合超弹性本构'
            : '未提供应力应变曲线：仅支持线弹性计算',
        );
      } else {
        warn(key, '未提供疲劳寿命曲线：无法进行疲劳校核');
      }
      return;
    }
    const res = validateCurvePoints(curve.points, key);
    res.errors.forEach((m) => err(key, `${CURVE_LABEL[key]}：${m}`));
    res.warnings.forEach((m) => warn(key, `${CURVE_LABEL[key]}：${m}`));
  });

  // 交叉校验：破坏应变不得小于曲线最大应变
  if (draft.type === 'conventional' && draft.stressStrainCurve?.points.length) {
    const fs = parseNum(draft.failureStrain);
    const maxStrain = Math.max(...draft.stressStrainCurve.points.map((p) => p.x));
    if (Number.isFinite(fs) && fs > 0 && fs < maxStrain) {
      err('failureStrain', `破坏应变 ${fs}% 小于曲线最大应变 ${maxStrain}%`);
    }
  }

  return {
    issues,
    errors: issues.filter((i) => i.level === 'error'),
    warnings: issues.filter((i) => i.level === 'warning'),
    missing,
  };
}

/** 草稿 → 入库记录 */
export function buildMaterialRecord(
  draft: MaterialDraft,
  meta: {
    username: string;
    displayName?: string;
    previous?: MaterialRecord | null;
    now?: Date;
  },
): MaterialRecord {
  const nowIso = (meta.now || new Date()).toISOString();
  const toNum = (s: string): number | null => {
    const n = parseNum(s);
    return Number.isFinite(n) ? n : null;
  };
  return {
    schema: MATERIAL_SCHEMA,
    type: draft.type,
    name: draft.name.trim(),
    grade: draft.grade.trim(),
    series: draft.series.trim(),
    supplier: draft.supplier.trim(),
    state: draft.state === 'dry' ? 'dry' : 'wet',
    temperature: draft.type === 'fluid' || draft.type === 'porous' ? null : parseNum(draft.temperature),
    density: toNum(draft.density),
    poisson: toNum(draft.poisson),
    elasticModulus: toNum(draft.elasticModulus),
    direction: toNum(draft.direction),
    hardness: toNum(draft.hardness),
    tensileStrength: toNum(draft.tensileStrength),
    failureStrain: toNum(draft.failureStrain),
    specificHeat: toNum(draft.specificHeat),
    thermalConductivity: toNum(draft.thermalConductivity),
    expansionCoefficient: toNum(draft.expansionCoefficient),
    stressStrainCurve: draft.stressStrainCurve?.points.length ? draft.stressStrainCurve : null,
    fatigueCurve: draft.fatigueCurve?.points.length ? draft.fatigueCurve : null,
    fluidPoints:
      draft.type === 'fluid' && draft.fluidPoints?.length
        ? draft.fluidPoints.map((p) => ({ ...p }))
        : null,
    porousProps:
      draft.type === 'porous'
        ? {
            poreSize: toNum(draft.poreSize),
            viscousResistance: toNum(draft.viscousResistance),
            inertialResistance: toNum(draft.inertialResistance),
            viscousCoefficient: toNum(draft.viscousCoefficient),
            inertialCoefficient: toNum(draft.inertialCoefficient),
            remark: draft.remark.trim(),
          }
        : null,
    createdAt: meta.previous?.createdAt || nowIso,
    updatedAt: nowIso,
    createdBy: meta.previous?.createdBy || meta.username,
    createdByDisplay: meta.previous?.createdByDisplay || meta.displayName || meta.username,
    updatedBy: meta.username,
    revision: meta.previous ? meta.previous.revision + 1 : 1,
  };
}

/** 流体归档文件名：名称+牌号.parquet */
export function fluidFileName(name: string, grade: string): string {
  return `${[cleanFileName(name), cleanFileName(grade)].filter(Boolean).join('+')}.parquet`;
}

/** 多孔介质归档文件名：牌号.parquet（牌号唯一标识一条多孔介质） */
export function porousFileName(grade: string): string {
  return `${cleanFileName(grade)}.parquet`;
}

/** 材料归档文件名：牌号+系列号+温度+硬度(仅超弹性)+供应商（空段省略） */
export function materialFileName(
  grade: string,
  series: string,
  temperature: number,
  supplier = '',
  hardness = '',
): string {
  const parts = [cleanFileName(grade), cleanFileName(series), `${tempLabel(temperature)}℃`];
  if ((hardness || '').trim()) parts.push(cleanFileName(hardness));
  if ((supplier || '').trim()) parts.push(cleanFileName(supplier));
  return `${parts.join('+')}.parquet`;
}

/** 反解材料文件名（检索列表在记录读回前先用它展示）
 *  兼容旧命名：类型前缀+牌号+系列号+温度(+干态)
 */
export function parseMaterialFileName(name: string): {
  type: MaterialType;
  grade: string;
  series: string;
  supplier: string;
  hardness: string;
  temperature: number | null;
  state: MaterialState;
} {
  const stem = (name || '').replace(/\.(parquet|json)$/i, '');
  const parts = stem.split('+');
  let type: MaterialType = 'conventional';
  if (parts.length > 1 && /^超弹性/.test(parts[0])) {
    type = 'hyperelastic';
    parts.shift();
  } else if (parts.length > 1 && /^常规材料/.test(parts[0])) {
    type = 'conventional';
    parts.shift();
  }
  let state: MaterialState = 'wet';
  if (parts.length > 1 && /^(干态|湿态)$/.test(parts[parts.length - 1].trim())) {
    state = parts.pop()!.trim() === '干态' ? 'dry' : 'wet';
  }
  // 温度段：定位带 ℃ 的片段，其后的片段归为供应商
  let tempIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/℃/.test(parts[i])) {
      tempIdx = i;
      break;
    }
  }
  const tempPart = tempIdx >= 0 ? parts[tempIdx] : '';
  const t = tempPart ? Number(tempPart.replace(/℃/g, '')) : NaN;
  const grade = parts[0] || '';
  const series = parts.slice(1, tempIdx >= 0 ? tempIdx : parts.length).join('+');
  const tail = tempIdx >= 0 ? parts.slice(tempIdx + 1) : [];
  // 温度后的纯数字段视为硬度（超弹性命名），其余为供应商
  const hardness = tail.length && /^\d+(\.\d+)?$/.test(tail[0].trim()) ? tail.shift()!.trim() : '';
  const supplier = tail.join('+');
  return {
    type,
    grade,
    series,
    supplier,
    hardness,
    temperature: Number.isFinite(t) ? t : null,
    state,
  };
}

/** 反序列化材料记录（检索页读取） */
export function parseMaterialRecord(text: string): MaterialRecord | null {
  try {
    const raw = JSON.parse(text) as Partial<MaterialRecord>;
    if (!raw || raw.schema !== MATERIAL_SCHEMA) return null;
    if (
      raw.type !== 'conventional' &&
      raw.type !== 'hyperelastic' &&
      raw.type !== 'fluid' &&
      raw.type !== 'porous'
    )
      return null;
    if (typeof raw.grade !== 'string' || typeof raw.series !== 'string') return null;
    const isFluid = raw.type === 'fluid';
    const temperature = Number(raw.temperature);
    // 流体/多孔介质记录温度为空；其余类型必须为数值
    if (!isFluid && raw.type !== 'porous' && !Number.isFinite(temperature)) return null;

    const numOrNull = (v: unknown): number | null => {
      const n = Number(v);
      return v == null || !Number.isFinite(n) ? null : n;
    };
    const curve = (v: unknown): MaterialCurve | null => {
      if (!v || typeof v !== 'object') return null;
      const c = v as MaterialCurve;
      if (!Array.isArray(c.points)) return null;
      const points = c.points
        .filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
        .map((p) => ({ x: Number(p.x), y: Number(p.y) }));
      if (!points.length) return null;
      return { sourceName: typeof c.sourceName === 'string' ? c.sourceName : '', points };
    };
    const fluidPoints = (v: unknown): FluidPoint[] | null => {
      if (!Array.isArray(v)) return null;
      const keys = [
        'temperature',
        'density',
        'dynamicViscosity',
        'thermalConductivity',
        'specificHeat',
      ] as const;
      const points = v
        .filter((p) => p && keys.every((k) => Number.isFinite(Number((p as FluidPoint)[k]))))
        .map((p) => {
          const src = p as FluidPoint;
          return {
            temperature: Number(src.temperature),
            density: Number(src.density),
            dynamicViscosity: Number(src.dynamicViscosity),
            thermalConductivity: Number(src.thermalConductivity),
            specificHeat: Number(src.specificHeat),
          };
        });
      return points.length ? points : null;
    };
    const porousProps = (v: unknown): PorousProps | null => {
      if (!v || typeof v !== 'object') return null;
      const p = v as Partial<PorousProps>;
      return {
        poreSize: numOrNull(p.poreSize),
        viscousResistance: numOrNull(p.viscousResistance),
        inertialResistance: numOrNull(p.inertialResistance),
        viscousCoefficient: numOrNull(p.viscousCoefficient),
        inertialCoefficient: numOrNull(p.inertialCoefficient),
        remark: typeof p.remark === 'string' ? p.remark : '',
      };
    };

    return {
      schema: MATERIAL_SCHEMA,
      type: raw.type,
      name: typeof raw.name === 'string' ? raw.name : '',
      grade: raw.grade,
      series: raw.series,
      supplier: typeof raw.supplier === 'string' ? raw.supplier : '',
      state: raw.state === 'dry' ? 'dry' : 'wet', // 旧记录无此字段 → 默认湿态
      temperature: isFluid ? numOrNull(raw.temperature) : temperature,
      density: numOrNull(raw.density),
      poisson: numOrNull(raw.poisson),
      elasticModulus: numOrNull(raw.elasticModulus),
      direction: numOrNull(raw.direction),
      hardness: numOrNull(raw.hardness),
      tensileStrength: numOrNull(raw.tensileStrength),
      failureStrain: numOrNull(raw.failureStrain),
      specificHeat: numOrNull(raw.specificHeat),
      thermalConductivity: numOrNull(raw.thermalConductivity),
      expansionCoefficient: numOrNull(raw.expansionCoefficient),
      stressStrainCurve: curve(raw.stressStrainCurve),
      fatigueCurve: curve(raw.fatigueCurve),
      fluidPoints: fluidPoints(raw.fluidPoints),
      porousProps: porousProps(raw.porousProps),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
      createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : '',
      createdByDisplay: typeof raw.createdByDisplay === 'string' ? raw.createdByDisplay : '',
      updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : '',
      revision: Number(raw.revision) > 0 ? Number(raw.revision) : 1,
    };
  } catch {
    return null;
  }
}

/** 记录 → 草稿（编辑已有材料时回填表单） */
export function draftFromRecord(rec: MaterialRecord): MaterialDraft {
  const s = (v: number | null) => (v == null ? '' : String(v));
  return {
    type: rec.type,
    name: rec.name || '',
    grade: rec.grade,
    series: rec.series,
    supplier: rec.supplier,
    state: rec.state === 'dry' ? 'dry' : 'wet',
    temperature: rec.temperature == null ? '' : tempLabel(rec.temperature),
    direction: s(rec.direction),
    density: s(rec.density),
    poisson: s(rec.poisson),
    elasticModulus: s(rec.elasticModulus),
    hardness: s(rec.hardness),
    tensileStrength: s(rec.tensileStrength),
    failureStrain: s(rec.failureStrain),
    specificHeat: s(rec.specificHeat),
    thermalConductivity: s(rec.thermalConductivity),
    expansionCoefficient: s(rec.expansionCoefficient),
    stressStrainCurve: rec.stressStrainCurve ? { ...rec.stressStrainCurve, points: [...rec.stressStrainCurve.points] } : null,
    fatigueCurve: rec.fatigueCurve ? { ...rec.fatigueCurve, points: [...rec.fatigueCurve.points] } : null,
    fluidPoints: rec.fluidPoints ? rec.fluidPoints.map((p) => ({ ...p })) : null,
    poreSize: s(rec.porousProps?.poreSize ?? null),
    viscousResistance: s(rec.porousProps?.viscousResistance ?? null),
    inertialResistance: s(rec.porousProps?.inertialResistance ?? null),
    viscousCoefficient: s(rec.porousProps?.viscousCoefficient ?? null),
    inertialCoefficient: s(rec.porousProps?.inertialCoefficient ?? null),
    remark: rec.porousProps?.remark || '',
  };
}

/** 序列化记录（浏览器调试 / 测试用；正式入库写入 Parquet） */
export function serializeMaterialRecord(rec: MaterialRecord): string {
  return JSON.stringify(rec, null, 2);
}

/** 检索页下载的 CSV 文件名：与 Parquet 文件同名，扩展名改为 .csv */
export function materialCsvFileName(rec: MaterialRecord): string {
  if (rec.type === 'fluid') {
    return fluidFileName(rec.name, rec.grade).replace(/\.parquet$/i, '.csv');
  }
  if (rec.type === 'porous') {
    return porousFileName(rec.grade).replace(/\.parquet$/i, '.csv');
  }
  const hardness =
    rec.type === 'hyperelastic' && rec.hardness !== null ? String(rec.hardness) : '';
  return materialFileName(
    rec.grade,
    rec.series,
    rec.temperature ?? 0,
    rec.supplier,
    hardness,
  ).replace(/\.parquet$/i, '.csv');
}

/**
 * 材料记录 → CSV 文本（带 UTF-8 BOM）
 *
 * 常规/超弹性：基础信息按行重复，应力应变曲线与疲劳曲线各占两列（x、y），
 * 一行一个数据点、从上到下顺序导出，x 与 y 同行一一对应；两条曲线点数不同时缺项留空。
 * 流体：单行 + 属性表；多孔介质：单行。
 */
export function materialRecordToCsv(rec: MaterialRecord): string {
  const quote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  // 流体：名称 + 牌号 + 属性表（五元组按 温度:密度:粘度:导热:比热 用分号连接）
  if (rec.type === 'fluid') {
    const table = (rec.fluidPoints || [])
      .map((p) =>
        [p.temperature, p.density, p.dynamicViscosity, p.thermalConductivity, p.specificHeat].join(
          ':',
        ),
      )
      .join(';');
    const headers = [
      '记录格式',
      '类型',
      '名称',
      '牌号',
      '流体属性表(温度℃:密度kg/m³:动力粘度mPa·s:导热系数W/(m·K):比热kJ/(kg·K))',
      '创建时间',
      '更新时间',
      '创建人',
      '更新人',
      '版本',
    ];
    const values = [
      rec.schema,
      '流体',
      rec.name,
      rec.grade,
      table,
      rec.createdAt,
      rec.updatedAt,
      rec.createdByDisplay || rec.createdBy,
      rec.updatedBy,
      rec.revision,
    ];
    return `\ufeff${[headers, values].map((row) => row.map(quote).join(',')).join('\r\n')}`;
  }
  // 多孔介质：牌号 + 孔径 + 4 项阻力系数 + 备注
  if (rec.type === 'porous') {
    const p = rec.porousProps;
    const porousHeaders = [
      '记录格式',
      '类型',
      '牌号',
      '孔径(μm)',
      '粘性阻力系数(m⁻²)',
      '惯性阻力系数(m⁻¹)',
      '粘性阻力系数(kg/(m³·s))',
      '惯性阻力系数(kg/m⁴)',
      '备注',
      '创建时间',
      '更新时间',
      '创建人',
      '更新人',
      '版本',
    ];
    const porousValues = [
      rec.schema,
      '多孔介质',
      rec.grade,
      p?.poreSize ?? '',
      p?.viscousResistance ?? '',
      p?.inertialResistance ?? '',
      p?.viscousCoefficient ?? '',
      p?.inertialCoefficient ?? '',
      p?.remark || '',
      rec.createdAt,
      rec.updatedAt,
      rec.createdByDisplay || rec.createdBy,
      rec.updatedBy,
      rec.revision,
    ];
    return `﻿${[porousHeaders, porousValues].map((row) => row.map(quote).join(',')).join('\r\n')}`;
  }
  const headers = [
    '记录格式',
    '类型',
    '牌号',
    '系列号',
    '供应商',
    '状态',
    '温度(℃)',
    '方向(°)',
    '密度(kg/m³)',
    '泊松比',
    '弹性模量(MPa)',
    '硬度',
    '抗拉强度(MPa)',
    '破坏应变(%)',
    '比热容 Cp(J/(kg·℃))',
    '热导率 K(W/(m·℃))',
    '膨胀系数(mm/(mm·K))',
    '应力应变曲线来源',
    '应变(%)',
    '应力(MPa)',
    '疲劳曲线来源',
    '寿命(cycles)',
    '应力幅(MPa)',
    '创建时间',
    '更新时间',
    '创建人',
    '更新人',
    '版本',
  ];
  const base = [
    rec.schema,
    rec.type === 'hyperelastic' ? '超弹性' : '常规材料',
    rec.grade,
    rec.series,
    rec.supplier,
    MATERIAL_STATE_LABEL[rec.state === 'dry' ? 'dry' : 'wet'],
    rec.temperature,
    rec.direction,
    rec.density,
    rec.poisson,
    rec.elasticModulus,
    rec.hardness,
    rec.tensileStrength,
    rec.failureStrain,
    rec.specificHeat,
    rec.thermalConductivity,
    rec.expansionCoefficient,
    rec.createdAt,
    rec.updatedAt,
    rec.createdByDisplay || rec.createdBy,
    rec.updatedBy,
    rec.revision,
  ];
  // 曲线按两列逐行导出：应变/应力（疲劳为寿命/应力幅），每行一个点，上下顺序与录入一致
  const ss = rec.stressStrainCurve?.points || [];
  const fc = rec.fatigueCurve?.points || [];
  const rowCount = Math.max(ss.length, fc.length, 1);
  const rows: unknown[][] = [headers];
  for (let i = 0; i < rowCount; i++) {
    const a = ss[i];
    const b = fc[i];
    rows.push([
      ...base.slice(0, 17),
      rec.stressStrainCurve?.sourceName || '',
      a ? a.x : '',
      a ? a.y : '',
      rec.fatigueCurve?.sourceName || '',
      b ? b.x : '',
      b ? b.y : '',
      ...base.slice(17),
    ]);
  }
  return `\ufeff${rows.map((row) => row.map(quote).join(',')).join('\r\n')}`;
}

/** 解析曲线 CSV：两列，首行可为表头；从上到下顺序读取，遇到空行或非数值行即停止 */
export function parseCurveCsv(text: string): { points: CurvePoint[]; error: string } {
  const lines = (text || '').split(/\r?\n/);
  if (!lines.some((l) => l.trim())) return { points: [], error: '没有可解析的数据行' };

  const points: CurvePoint[] = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('#')) {
      if (points.length) break; // 数据区后的空行表示结束
      continue; // 跳过表头前的空行/注释
    }
    const parts = l.split(/[,，;；\t ]+/).filter(Boolean);
    if (parts.length < 2) {
      if (points.length) break;
      continue; // 表头
    }
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (points.length) break; // 非数值行表示数据结束
      continue; // 表头
    }
    points.push({ x, y });
  }
  if (points.length < 2) return { points, error: '至少需要 2 个数据点' };
  return { points, error: '' };
}

/** 流体属性表摘要文案 */
export function fluidSummary(points: FluidPoint[] | null): string {
  if (!points || !points.length) return '';
  const temps = points.map((p) => p.temperature);
  return `${points.length} 行 · 温度 ${Math.min(...temps)}–${Math.max(...temps)} ℃`;
}

/**
 * 解析流体属性表（CSV / Excel 共用）：
 * 第 1~5 列依次为 温度(℃)、密度(kg/m³)、动力粘度(mPa·s)、导热系数(W/(m·K))、比热(kJ/(kg·K))。
 * 从第 2 行起按顺序往下读，遇到温度列不是数字的行即停止（首行若是数据则一并读取）；
 * 温度列为数字但其余列存在非数值时，跳过该行并给出警告。
 */
export function parseFluidRows(rows: string[][]): {
  points: FluidPoint[];
  warnings: string[];
  error: string;
} {
  const clean = (rows || []).map((r) => (r || []).map((c) => String(c ?? '').trim()));
  const warnings: string[] = [];
  const points: FluidPoint[] = [];
  // 首行第 1 列是数字 → 无表头，从第 1 行读；否则按约定从第 2 行读
  const start = Number.isFinite(Number(clean[0]?.[0])) && clean[0][0] !== '' ? 0 : 1;
  for (let r = start; r < clean.length; r++) {
    const cells = clean[r];
    const t = Number(cells[0]);
    if (cells[0] === '' || !Number.isFinite(t)) break; // 温度列没有数字 → 数据结束
    const nums = cells.slice(0, 5).map((c) => Number(c));
    if (cells.length < 5 || nums.some((n) => !Number.isFinite(n))) {
      warnings.push(`第 ${r + 1} 行存在非数值单元格，已跳过`);
      continue;
    }
    points.push({
      temperature: nums[0],
      density: nums[1],
      dynamicViscosity: nums[2],
      thermalConductivity: nums[3],
      specificHeat: nums[4],
    });
  }
  if (!points.length) {
    return {
      points,
      warnings,
      error: '未从第 2 行起读到有效的流体属性数据（第 1 列温度需为数字）',
    };
  }
  return { points, warnings, error: '' };
}

/** 解析流体属性表 CSV：5 列，首行可为表头 */
export function parseFluidCsv(text: string): {
  points: FluidPoint[];
  warnings: string[];
  error: string;
} {
  const rows = (text || '')
    .split(/\r?\n/)
    .map((line) => line.split(/[,，;；\t]/));
  return parseFluidRows(rows);
}

/** 曲线摘要文案 */
export function curveSummary(curve: MaterialCurve | null, key: MaterialCurveKey): string {
  if (!curve || !curve.points.length) return '';
  const xs = curve.points.map((p) => p.x);
  const ys = curve.points.map((p) => p.y);
  const f = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(0)}e4` : String(Number(n.toFixed(2))));
  const maxY = f(Math.max(...ys));
  if (key === 'stressStrainCurve') {
    return `${curve.points.length} 点 · 应变 ${f(Math.min(...xs))}–${f(Math.max(...xs))}% · 应力 ≤ ${maxY} MPa`;
  }
  return `${curve.points.length} 点 · 寿命 ${f(Math.min(...xs))}–${f(Math.max(...xs))} cycles · 应力 ≤ ${maxY} MPa`;
}

/** 表头候选：用于 CSV / Excel 两种导入的字段识别 */
const HEADER_ALIASES: Record<MaterialTextFieldKey | 'stressStrainCurve' | 'fatigueCurve', RegExp> = {
  name: /名称|品名/,
  grade: /牌号/,
  series: /系列号|系列|规格/,
  supplier: /供应商|厂商|品牌/,
  state: /状态|干湿态|湿态|干态/,
  temperature: /温度/,
  direction: /方向|角度|取向/,
  density: /密度/,
  poisson: /泊松比|泊松/,
  elasticModulus: /弹性模量|杨氏模量|E[-\s]?modulus/i,
  hardness: /硬度|HB|HV|HRC|HRB/,
  tensileStrength: /抗拉强度|拉伸强度|Rm/,
  failureStrain: /破坏应变|断裂应变|延伸率|A[-\s]?50/i,
  specificHeat: /比热容|比热|\bCp\b/i,
  thermalConductivity: /热导率|导热系数|热传导系数|thermal\s*conductivity/i,
  expansionCoefficient: /膨胀系数|热膨胀|线膨胀|\bCTE\b/i,
  stressStrainCurve: /应力应变曲线|应力-应变曲线|应力应变/,
  fatigueCurve: /疲劳寿命曲线|疲劳曲线|S[-\s]?N/i,
  // 多孔介质（滤纸输入列表）
  poreSize: /孔径/,
  viscousResistance: /粘性阻力系数.*m[-^]?2/i,
  inertialResistance: /惯性阻力系数.*m[-^]?1/i,
  viscousCoefficient: /粘性阻力系数.*kg/i,
  inertialCoefficient: /惯性阻力系数.*kg/i,
  remark: /备注/,
};

/** 行解析（通用：由 CSV / Excel 两种入口分别喂进二维数组） */
function parseRows(
  rows: string[][],
  type: MaterialType,
): { drafts: MaterialDraft[]; error: string; ignoredCurves: boolean } {
  const cleanRows = rows
    .map((r) => r.map((c) => String(c ?? '').trim()))
    .filter((r) => r.length && r.some((c) => c && !c.startsWith('#')));
  if (cleanRows.length < 2) return { drafts: [], error: '文件至少需要表头与 1 行数据', ignoredCurves: false };
  const header = cleanRows[0];
  const map: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  let ignoredCurves = false;
  header.forEach((h, i) => {
    if (!h) return;
    (Object.keys(HEADER_ALIASES) as Array<keyof typeof HEADER_ALIASES>).forEach((key) => {
      if (HEADER_ALIASES[key].test(h) && map[key] == null) map[key] = i;
    });
  });
  if (map.stressStrainCurve != null || map.fatigueCurve != null) ignoredCurves = true;
  if (map.grade == null || map.series == null || map.temperature == null) {
    return { drafts: [], error: '表头缺少必填列：牌号 / 系列号 / 温度', ignoredCurves };
  }
  const drafts: MaterialDraft[] = [];
  for (let i = 1; i < cleanRows.length; i++) {
    const cells = cleanRows[i];
    const get = (k: keyof typeof map): string => {
      const idx = map[k];
      return idx == null ? '' : cells[idx] || '';
    };
    const draft = emptyDraft(type);
    draft.grade = get('grade');
    draft.series = get('series');
    draft.supplier = get('supplier');
    draft.state = normalizeState(get('state'));
    draft.temperature = get('temperature');
    draft.direction = get('direction');
    draft.density = get('density');
    draft.poisson = get('poisson');
    draft.elasticModulus = get('elasticModulus');
    draft.hardness = get('hardness');
    draft.tensileStrength = get('tensileStrength');
    draft.failureStrain = get('failureStrain');
    draft.specificHeat = get('specificHeat');
    draft.thermalConductivity = get('thermalConductivity');
    draft.expansionCoefficient = get('expansionCoefficient');
    if (draft.grade || draft.series || draft.temperature) drafts.push(draft);
  }
  return { drafts, error: '', ignoredCurves };
}

/** 下载用模板（与批量导入解析共用表头） */
export function materialTemplateCsv(type: MaterialType): string {
  if (type === 'porous') {
    // 与滤纸输入列表同构：每行一条多孔介质，序号列忽略
    return [
      '序号,牌号,孔径（um）,粘性阻力系数（m-2）,惯性阻力系数（m-1),粘性阻力系数(kg/m^3-s),惯性阻力系数(kg/m^4),备注',
      '1,XH34720,74.6,4.874E+07,2.121E+03,9.066E+02,1.278E+03,',
      '2,AK55/66CN1,51,1.043E+08,3.103E+03,1.940E+03,1.870E+03,常用数据',
    ].join('\r\n');
  }
  if (type === 'fluid') {
    // 示例为水的物性（近似值），名称与牌号在导入表单中填写
    return [
      FLUID_TABLE_HEADER.join(','),
      '20,998.2,1.002,0.599,4.182',
      '40,992.2,0.653,0.631,4.179',
      '60,983.2,0.467,0.654,4.185',
    ].join('\r\n');
  }
  if (type === 'conventional') {
    return [
      '牌号,系列号,供应商,状态,温度(°C),方向(°),密度(kg/m³),泊松比,弹性模量(MPa),硬度,抗拉强度(MPa),破坏应变(%),比热容 Cp(J/(kg·℃)),热导率 K(W/(m·℃)),膨胀系数(mm/(mm·K)),应力应变曲线文件,疲劳寿命曲线文件',
      'SPCC,冷轧钢板,宝钢,湿态,25,,7850,0.30,205000,180,370,32,,,,,',
      'PA66-GF30,尼龙加玻纤,巴斯夫,干态,120,,1350,0.34,95000,90,185,3.5,,,,,',
    ].join('\r\n');
  }
  return [
    '牌号,系列号,供应商,状态,温度(°C),方向(°),密度(kg/m³),泊松比,弹性模量(MPa),硬度,抗拉强度(MPa),破坏应变(%),比热容 Cp(J/(kg·℃)),热导率 K(W/(m·℃)),膨胀系数(mm/(mm·K)),应力应变曲线文件,疲劳寿命曲线文件',
    'EPDM-70,密封橡胶,某密封件厂,湿态,23,,1100,0.48,10,60,15,300,1800,0.25,2.3e-4,,',
    'FKM-80,氟橡胶,某密封件厂,干态,150,,1850,0.47,12,75,18,250,1200,0.2,2.0e-4,,',
  ].join('\r\n');
}

/** 流体批量导入：整张表即一条流体的属性表，名称/牌号在预览面板中补填 */
function fluidDraftFromRows(
  rows: string[][],
): { drafts: MaterialDraft[]; error: string; ignoredCurves: boolean; warnings: string[] } {
  const res = parseFluidRows(rows);
  if (res.error) return { drafts: [], error: res.error, ignoredCurves: false, warnings: res.warnings };
  const draft = emptyDraft('fluid');
  draft.fluidPoints = res.points;
  return { drafts: [draft], error: '', ignoredCurves: false, warnings: res.warnings };
}

/** 多孔介质批量导入：表头映射（滤纸输入列表），每行一条记录，牌号必填 */
function parsePorousRows(rows: string[][]): {
  drafts: MaterialDraft[];
  error: string;
  ignoredCurves: boolean;
  warnings: string[];
} {
  const clean = rows
    .map((r) => r.map((c) => String(c ?? '').trim()))
    .filter((r) => r.length && r.some((c) => c && !c.startsWith('#')));
  if (clean.length < 2) return { drafts: [], error: '文件至少需要表头与 1 行数据', ignoredCurves: false, warnings: [] };
  const keys: MaterialTextFieldKey[] = [
    'grade',
    'poreSize',
    'viscousResistance',
    'inertialResistance',
    'viscousCoefficient',
    'inertialCoefficient',
    'remark',
  ];
  const map: Partial<Record<MaterialTextFieldKey, number>> = {};
  clean[0].forEach((h, i) => {
    if (!h) return;
    keys.forEach((k) => {
      if (HEADER_ALIASES[k].test(h) && map[k] == null) map[k] = i;
    });
  });
  if (map.grade == null) {
    return { drafts: [], error: '表头缺少必填列：牌号', ignoredCurves: false, warnings: [] };
  }
  const drafts: MaterialDraft[] = [];
  const warnings: string[] = [];
  for (let i = 1; i < clean.length; i++) {
    const cells = clean[i];
    const get = (k: MaterialTextFieldKey): string => {
      const idx = map[k];
      return idx == null ? '' : cells[idx] || '';
    };
    if (!get('grade')) {
      warnings.push(`第 ${i + 1} 行牌号为空，已跳过`);
      continue;
    }
    const d = emptyDraft('porous');
    d.grade = get('grade');
    d.poreSize = get('poreSize');
    d.viscousResistance = get('viscousResistance');
    d.inertialResistance = get('inertialResistance');
    d.viscousCoefficient = get('viscousCoefficient');
    d.inertialCoefficient = get('inertialCoefficient');
    d.remark = get('remark');
    drafts.push(d);
  }
  if (!drafts.length) return { drafts: [], error: '未读到有效的牌号行', ignoredCurves: false, warnings };
  return { drafts, error: '', ignoredCurves: false, warnings };
}

/**
 * 解析批量导入 CSV。
 * 自动判断：有「牌号」表头关键字 → 表头映射；否则 → 固定坐标布局。
 */
export function parseMaterialCsv(
  text: string,
  type: MaterialType,
): { drafts: MaterialDraft[]; error: string; ignoredCurves: boolean; warnings?: string[] } {
  const rows = (text || '')
    .split(/\r?\n/)
    .map((line) => line.split(/[,，;；\t]/));
  if (type === 'fluid') return fluidDraftFromRows(rows);
  if (type === 'porous') return parsePorousRows(rows);
  if (detectHeaderMode(rows)) return parseRows(rows, type);
  return parseFixedCoords(rows, type);
}

/**
 * 解析批量导入 Excel（.xlsx / .xls）。
 * 自动判断走表头映射还是固定坐标布局。
 */
export async function parseMaterialXlsx(
  file: File | ArrayBuffer,
  type: MaterialType,
): Promise<{ drafts: MaterialDraft[]; error: string; ignoredCurves: boolean; warnings?: string[] }> {
  let data: ArrayBuffer;
  if (file instanceof File) data = await file.arrayBuffer();
  else data = file;
  const XLSX = await import('xlsx');
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // raw: true 拿原始数值，避免 Excel 里被格式化成 "6.35912E-05" 这类科学计数法字符串后丢精度
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
  const rows = raw.map((r) => (r || []).map((c) => (c == null ? '' : String(c).trim())));
  if (type === 'fluid') return fluidDraftFromRows(rows);
  if (type === 'porous') return parsePorousRows(rows);
  if (detectHeaderMode(rows)) return parseRows(rows, type);
  return parseFixedCoords(rows, type);
}

/** 判断是否走表头映射（首行含「牌号/系列/grade/series」关键字即可） */
function detectHeaderMode(rows: string[][]): boolean {
  const first = (rows[0] || []).map((c) => String(c ?? '').trim().toLowerCase());
  return first.some((c) => /牌号|grade|系列|series/i.test(c));
}

/** 从固定坐标布局解析一条材料记录。
 * 坐标约定（0-based，参考 Excel 人类行列 -1）：
 *   第 2 列（索引 1）第 2 行（索引 1）= 牌号
 *   第 2 列 第 3 行 = 供应商；第 4 行 = 系列号；第 5 行 = 温度
 *   第 6 行 = 密度；第 7 行 = 弹性模量；第 8 行 = 方向
 *   第 10 行 = 硬度；第 11 行 = 泊松比
 *   C 列（索引 2）= 应变，D 列（索引 3）= 应力，从第 2 行连续扫
 *
 * 如果严格坐标取不到必填值（常见于 Excel 有合并单元格、额外表头或位置偏移），
 * 自动退回到「标签扫描」模式：逐格查找包含「牌号/系列号/温度」等关键字的单元格，
 * 然后读其右侧相邻列（通常是 B 列）的值作为该字段。
 */
function parseFixedCoords(
  rows: string[][],
  type: MaterialType,
): { drafts: MaterialDraft[]; error: string; ignoredCurves: boolean } {
  const get = (rowIdx: number, colIdx: number): string => {
    const row = rows[rowIdx];
    if (!row) return '';
    return String(row[colIdx] ?? '').trim();
  };
  const num = (s: string): string => {
    if (!s) return '';
    // 兼容科学计数法（如 Excel 里的 6.35912E-05），直接取数字串会丢量级
    const m = String(s).match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/);
    return m ? m[0] : '';
  };

  /** 严格坐标：第 2 列各固定行
   *  注：牌号 / 系列号 / 供应商可能含字母（如 PA66-GF30），不能用 num() 过滤。
   *  同时跳过 "/"、"×"、空占位符（Excel 里常用 "/" 表示"无"）。
   */
  const skipPh = (s: string): string => {
    if (!s) return '';
    if (/^[\/×\-\—\s]*$/.test(s)) return '';
    return s;
  };
  const fromFixedPos = (): Record<string, string> => ({
    grade: skipPh(get(1, 1)),
    supplier: skipPh(get(2, 1)),
    series: skipPh(get(3, 1)),
    temperature: num(get(4, 1)),
    density: num(get(5, 1)),
    elasticModulus: num(get(6, 1)),
    direction: num(get(7, 1)),
    hardness: num(get(9, 1)),
    poisson: num(get(10, 1)),
  });

  /** 标签扫描：逐格查找字段名关键字，取右侧相邻列的值
   *  关键词用「包含匹配」（去掉 ^$），兼容用户写 "温度（℃）" "密度 kg/m³" 等带单位的标签。
   */
  const FIELD_LABELS: Array<{ key: MaterialTextFieldKey; labels: RegExp; numOnly?: boolean }> = [
    { key: 'grade', labels: /材料牌号|^材料$/i },     // "材料"行 → 牌号；其次才看"牌号"行
    { key: 'grade', labels: /牌号/ },                // 兜底：如果"材料"行没值，再看"牌号"行（但值可能是 "/" 要跳过）
    { key: 'series', labels: /系列号|系列|规格|型号/ },
    { key: 'supplier', labels: /供应商|厂商|品牌/ },
    { key: 'state', labels: /状态|干湿态/ },
    { key: 'temperature', labels: /温度|温区/i, numOnly: true },
    { key: 'density', labels: /密度/, numOnly: true },
    { key: 'elasticModulus', labels: /弹性模量|杨氏模量|弹性模量E|E[-\s]?modulus/i, numOnly: true },
    { key: 'direction', labels: /方向|角度|取向/, numOnly: true },
    { key: 'hardness', labels: /硬度|HB|HV|HRC|HRB/, numOnly: true },
    { key: 'poisson', labels: /泊松比|泊松/, numOnly: true },
    { key: 'specificHeat', labels: /比热容|比热|\bCp\b/i, numOnly: true },
    { key: 'thermalConductivity', labels: /热导率|导热系数|热传导/, numOnly: true },
    { key: 'expansionCoefficient', labels: /膨胀系数|热膨胀|线膨胀|CTE/i, numOnly: true },
  ];
  const fromLabelScan = (): Record<string, string> => {
    const out: Record<string, string> = {};
    // 按行扫描，每行内按列扫，遇到匹配就取右侧值
    for (let r = 0; r < rows.length && Object.keys(out).length < FIELD_LABELS.length; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] ?? '').trim();
        if (!cell) continue;
        for (const { key, labels, numOnly } of FIELD_LABELS) {
          if (out[key]) continue;
          if (!labels.test(cell)) continue;
          // 右侧相邻列的值
          const right = row[c + 1] != null ? String(row[c + 1]).trim() : '';
          // 跳过 "/", "×", 空占位符
          if (!right || /^[\/×\-]*$/.test(right)) continue;
          out[key] = numOnly ? num(right) : right;
        }
      }
    }
    return out;
  };

  // 先用严格坐标；再用标签扫描补齐固定坐标里没有的字段（固定坐标优先）
  const fp = fromFixedPos();
  const sc = fromLabelScan();
  const vals: Record<string, string> = { ...sc };
  (Object.keys(fp) as Array<keyof typeof fp>).forEach((k) => {
    if (fp[k]) vals[k] = fp[k];
  });

  const draft = emptyDraft(type);
  draft.grade = vals.grade || '';
  draft.supplier = vals.supplier || '';
  draft.series = vals.series || '';
  draft.state = normalizeState(vals.state || '');
  draft.temperature = vals.temperature || '';
  draft.density = vals.density || '';
  draft.elasticModulus = vals.elasticModulus || '';
  draft.direction = vals.direction || '';
  draft.hardness = vals.hardness || '';
  draft.poisson = vals.poisson || '';
  draft.specificHeat = vals.specificHeat || '';
  draft.thermalConductivity = vals.thermalConductivity || '';
  draft.expansionCoefficient = vals.expansionCoefficient || '';

  // 曲线读取：C列(索引2)=应变，D列(索引3)=应力，从第2行起自上而下顺序读取，遇到空行/非数字即停止
  // 应变的单位按整列统一判断，不能逐点判断（否则 0.93 会被单独放大成 93，导致点位顺序错乱）
  const rawPoints: Array<{ x: number; y: number }> = [];
  for (let r = 1; r < rows.length; r++) {
    const ex = num(get(r, 2));
    const sy = num(get(r, 3));
    if (!ex || !sy) break;
    const exN = Number(ex);
    const syN = Number(sy);
    if (!Number.isFinite(exN) || !Number.isFinite(syN)) break;
    rawPoints.push({ x: exN, y: syN });
  }

  const headerX = String(get(0, 2) ?? '').trim();
  const headerIsPercent = /%|％|百分/.test(headerX);
  const headerIsFraction = /小数|比例|fraction/i.test(headerX);
  const maxRawX = rawPoints.length ? Math.max(...rawPoints.map((p) => p.x)) : 0;
  // 超弹性材料：应变按小数存储（0.01 = 1%），统一 ×100；常规材料按表头/整列数值判断单位
  const strainScale =
    type === 'hyperelastic'
      ? 100
      : headerIsFraction
        ? 100
        : headerIsPercent
          ? 1
          : maxRawX <= 1
            ? 100
            : 1;
  const curvePoints: CurvePoint[] = rawPoints.map((p) => ({
    x: Math.round(p.x * strainScale * 10000) / 10000,
    y: p.y,
  }));

  if (curvePoints.length >= 2) {
    draft.stressStrainCurve = { sourceName: '', points: curvePoints };
    const maxStress = Math.max(...curvePoints.map((p) => p.y));
    draft.tensileStrength = String(Math.round(maxStress * 100) / 100);
    // 破坏应变取曲线末端应变本身（与点位同精度），不能四舍五入到更小值，否则交叉校验会报错
    const maxStrain = Math.max(...curvePoints.map((p) => p.x));
    draft.failureStrain = String(Math.round(maxStrain * 10000) / 10000);
  }

  // 只要 grade / temperature 这两个最关键的能取到（series 可能用户没写标签），就先返回 draft
  // 让后面的 validateMaterialDraft 做必填校验——验证面板会提示缺失项，用户在验证 & 修改面板里补
  if (!draft.grade || !draft.temperature) {
    const diag = FIELD_LABELS.map((f) => `${f.key}=${(vals as Record<string, string>)[f.key] || '(空)'}`).join(', ');
    return {
      drafts: [],
      error: `固定坐标布局未找到关键必填值（牌号/温度）。诊断：${diag}`,
      ignoredCurves: false,
    };
  }
  return {
    drafts: [draft],
    error: '',
    ignoredCurves: !draft.stressStrainCurve,
  };
}
