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

export type MaterialType = 'conventional' | 'hyperelastic';

export const MATERIAL_TYPE_LABEL: Record<MaterialType, string> = {
  conventional: '常规材料',
  hyperelastic: '超弹性材料',
};

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
  grade: string;
  series: string;
  supplier: string;
  temperature: number;
  density: number | null; // kg/m³
  poisson: number | null;
  elasticModulus: number | null;
  direction: number | null; // 方向，°
  hardness: number | null; // 硬度（HB / HV / HRC / HRB / ...）
  tensileStrength: number | null;
  failureStrain: number | null; // %
  stressStrainCurve: MaterialCurve | null;
  fatigueCurve: MaterialCurve | null;
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
  grade: string;
  series: string;
  supplier: string;
  temperature: string;
  density: string;
  poisson: string;
  elasticModulus: string;
  direction: string;
  hardness: string;
  tensileStrength: string;
  failureStrain: string;
  stressStrainCurve: MaterialCurve | null;
  fatigueCurve: MaterialCurve | null;
}

export type MaterialTextFieldKey =
  | 'grade'
  | 'series'
  | 'supplier'
  | 'temperature'
  | 'density'
  | 'poisson'
  | 'elasticModulus'
  | 'direction'
  | 'hardness'
  | 'tensileStrength'
  | 'failureStrain';

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

export const MATERIAL_FIELDS: Record<MaterialType, MaterialFieldDef[]> = {
  conventional: [
    { key: 'grade', label: '牌号', group: '标识与来源', required: true, placeholder: '如 SPCC、PA66-GF30' },
    { key: 'series', label: '系列号', group: '标识与来源', required: true, placeholder: '如 冷轧钢板、铝合金系列' },
    { key: 'supplier', label: '供应商', group: '标识与来源', placeholder: '如 宝钢、巴斯夫' },
    { key: 'temperature', label: '温度', group: '工况', required: true, unit: '°C', placeholder: '-60 ~ 400' },
    { key: 'direction', label: '方向', group: '工况', unit: '°', placeholder: '如 0 / 45 / 90' },
    { key: 'density', label: '密度', group: '基础物性', unit: 'kg/m³', placeholder: '50 ~ 30000' },
    { key: 'poisson', label: '泊松比', group: '基础物性', placeholder: '0 < v < 0.5' },
    { key: 'elasticModulus', label: '弹性模量', group: '基础物性', unit: 'MPa', placeholder: '选填' },
    { key: 'hardness', label: '硬度', group: '力学性能', placeholder: '如 180 HB、500 HV、58 HRC（仅数字）' },
    { key: 'tensileStrength', label: '抗拉强度', group: '力学性能', unit: 'MPa', placeholder: '选填' },
    { key: 'failureStrain', label: '破坏应变', group: '力学性能', unit: '%', placeholder: '选填' },
  ],
  hyperelastic: [
    { key: 'grade', label: '牌号', group: '标识与来源', required: true, placeholder: '如 EPDM-70、FKM-80' },
    { key: 'series', label: '系列号', group: '标识与来源', required: true, placeholder: '如 密封橡胶、氟橡胶系列' },
    { key: 'temperature', label: '温度', group: '工况', required: true, unit: '°C', placeholder: '-60 ~ 400' },
    { key: 'poisson', label: '泊松比', group: '基础物性', placeholder: '建议 0.45 ~ 0.5' },
  ],
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
    grade: '',
    series: '',
    supplier: '',
    temperature: '',
    density: '',
    poisson: '',
    elasticModulus: '',
    direction: '',
    hardness: '',
    tensileStrength: '',
    failureStrain: '',
    stressStrainCurve: null,
    fatigueCurve: null,
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
    if (points.some((p) => p.x < 0)) errors.push('应变不能为负');
    if (points.some((p) => p.y < 0)) errors.push('应力不能为负');
    for (let i = 1; i < points.length; i++) {
      if (points[i].x <= points[i - 1].x) {
        errors.push(`应变必须严格递增（第 ${i + 1} 行）`);
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
        errors.push(`寿命必须递增（第 ${i + 1} 行）`);
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
  } else if (/[\\/:*?"<>|]/.test(grade)) {
    err('grade', '牌号不能包含 \\ / : * ? " < > |');
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
  const numericFields: Array<[MaterialTextFieldKey, string, number, number, string]> =
    draft.type === 'conventional'
      ? [
          ['direction', '方向', -180, 360, '°'],
          ['density', '密度', 50, 30000, 'kg/m³'],
          ['poisson', '泊松比', 0.001, 0.499, ''],
          ['elasticModulus', '弹性模量', 0.01, 1000000, 'MPa'],
          ['hardness', '硬度', 0.01, 2000, ''],
          ['tensileStrength', '抗拉强度', 0.01, 5000, 'MPa'],
          ['failureStrain', '破坏应变', 0.01, 1000, '%'],
        ]
      : [['poisson', '泊松比', 0.001, 0.499, '']];

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
    grade: draft.grade.trim(),
    series: draft.series.trim(),
    supplier: draft.supplier.trim(),
    temperature: parseNum(draft.temperature),
    density: toNum(draft.density),
    poisson: toNum(draft.poisson),
    elasticModulus: toNum(draft.elasticModulus),
    direction: toNum(draft.direction),
    hardness: toNum(draft.hardness),
    tensileStrength: toNum(draft.tensileStrength),
    failureStrain: toNum(draft.failureStrain),
    stressStrainCurve: draft.stressStrainCurve?.points.length ? draft.stressStrainCurve : null,
    fatigueCurve: draft.fatigueCurve?.points.length ? draft.fatigueCurve : null,
    createdAt: meta.previous?.createdAt || nowIso,
    updatedAt: nowIso,
    createdBy: meta.previous?.createdBy || meta.username,
    createdByDisplay: meta.previous?.createdByDisplay || meta.displayName || meta.username,
    updatedBy: meta.username,
    revision: meta.previous ? meta.previous.revision + 1 : 1,
  };
}

/** 材料归档文件名（含类型前缀，避免两类材料同名） */
export function materialFileName(
  type: MaterialType,
  grade: string,
  series: string,
  temperature: number,
): string {
  const prefix = type === 'hyperelastic' ? '超弹性' : '常规材料';
  return `${prefix}+${cleanFileName(grade)}+${cleanFileName(series)}+${tempLabel(temperature)}℃.parquet`;
}

/** 反解材料文件名（检索列表快速展示用） */
export function parseMaterialFileName(name: string): {
  type: MaterialType;
  grade: string;
  series: string;
  temperature: number | null;
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
  const tempPart = parts.length ? parts.pop() || '' : '';
  const t = Number(tempPart.replace(/℃/g, ''));
  return {
    type,
    grade: parts.shift() || '',
    series: parts.join('+'),
    temperature: Number.isFinite(t) ? t : null,
  };
}

/** 反序列化材料记录（检索页读取） */
export function parseMaterialRecord(text: string): MaterialRecord | null {
  try {
    const raw = JSON.parse(text) as Partial<MaterialRecord>;
    if (!raw || raw.schema !== MATERIAL_SCHEMA) return null;
    if (raw.type !== 'conventional' && raw.type !== 'hyperelastic') return null;
    if (typeof raw.grade !== 'string' || typeof raw.series !== 'string') return null;
    const temperature = Number(raw.temperature);
    if (!Number.isFinite(temperature)) return null;

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

    return {
      schema: MATERIAL_SCHEMA,
      type: raw.type,
      grade: raw.grade,
      series: raw.series,
      supplier: typeof raw.supplier === 'string' ? raw.supplier : '',
      temperature,
      density: numOrNull(raw.density),
      poisson: numOrNull(raw.poisson),
      elasticModulus: numOrNull(raw.elasticModulus),
      direction: numOrNull(raw.direction),
      hardness: numOrNull(raw.hardness),
      tensileStrength: numOrNull(raw.tensileStrength),
      failureStrain: numOrNull(raw.failureStrain),
      stressStrainCurve: curve(raw.stressStrainCurve),
      fatigueCurve: curve(raw.fatigueCurve),
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
    grade: rec.grade,
    series: rec.series,
    supplier: rec.supplier,
    temperature: tempLabel(rec.temperature),
    direction: s(rec.direction),
    density: s(rec.density),
    poisson: s(rec.poisson),
    elasticModulus: s(rec.elasticModulus),
    hardness: s(rec.hardness),
    tensileStrength: s(rec.tensileStrength),
    failureStrain: s(rec.failureStrain),
    stressStrainCurve: rec.stressStrainCurve ? { ...rec.stressStrainCurve, points: [...rec.stressStrainCurve.points] } : null,
    fatigueCurve: rec.fatigueCurve ? { ...rec.fatigueCurve, points: [...rec.fatigueCurve.points] } : null,
  };
}

/** 序列化记录（浏览器调试 / 测试用；正式入库写入 Parquet） */
export function serializeMaterialRecord(rec: MaterialRecord): string {
  return JSON.stringify(rec, null, 2);
}

/** 检索页下载的 CSV 文件名：与 Parquet 文件同名，扩展名改为 .csv */
export function materialCsvFileName(rec: MaterialRecord): string {
  return materialFileName(rec.type, rec.grade, rec.series, rec.temperature).replace(/\.parquet$/i, '.csv');
}

/** 材料记录 → CSV 文本（单行记录，曲线按 x:y 用分号连接，带 UTF-8 BOM） */
export function materialRecordToCsv(rec: MaterialRecord): string {
  const quote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const points = (curve: MaterialCurve | null) =>
    curve ? curve.points.map((p) => `${p.x}:${p.y}`).join(';') : '';
  const headers = [
    '记录格式',
    '类型',
    '牌号',
    '系列号',
    '供应商',
    '温度(℃)',
    '方向(°)',
    '密度(kg/m³)',
    '泊松比',
    '弹性模量(MPa)',
    '硬度',
    '抗拉强度(MPa)',
    '破坏应变(%)',
    '应力应变曲线来源',
    '应力应变曲线(应变%:应力MPa)',
    '疲劳曲线来源',
    '疲劳曲线(寿命cycles:应力MPa)',
    '创建时间',
    '更新时间',
    '创建人',
    '更新人',
    '版本',
  ];
  const values = [
    rec.schema,
    rec.type === 'hyperelastic' ? '超弹性' : '常规材料',
    rec.grade,
    rec.series,
    rec.supplier,
    rec.temperature,
    rec.direction,
    rec.density,
    rec.poisson,
    rec.elasticModulus,
    rec.hardness,
    rec.tensileStrength,
    rec.failureStrain,
    rec.stressStrainCurve?.sourceName || '',
    points(rec.stressStrainCurve),
    rec.fatigueCurve?.sourceName || '',
    points(rec.fatigueCurve),
    rec.createdAt,
    rec.updatedAt,
    rec.createdByDisplay || rec.createdBy,
    rec.updatedBy,
    rec.revision,
  ];
  const rows: unknown[][] = [headers, values];
  return `\ufeff${rows.map((row) => row.map(quote).join(',')).join('\r\n')}`;
}

/** 解析曲线 CSV：两列，首行可为表头 */
export function parseCurveCsv(text: string): { points: CurvePoint[]; error: string } {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return { points: [], error: '没有可解析的数据行' };

  const points: CurvePoint[] = [];
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(/[,，;；\t ]+/).filter(Boolean);
    if (parts.length < 2) {
      if (!points.length) continue; // 表头
      return { points, error: `第 ${i + 1} 行不是两个数值` };
    }
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (!points.length) continue; // 表头
      return { points, error: `第 ${i + 1} 行包含非数值` };
    }
    points.push({ x, y });
  }
  if (points.length < 2) return { points, error: '至少需要 2 个数据点' };
  return { points, error: '' };
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
  grade: /牌号/,
  series: /系列号|系列|规格/,
  supplier: /供应商|厂商|品牌/,
  temperature: /温度/,
  direction: /方向|角度|取向/,
  density: /密度/,
  poisson: /泊松比|泊松/,
  elasticModulus: /弹性模量|杨氏模量|E[-\s]?modulus/i,
  hardness: /硬度|HB|HV|HRC|HRB/,
  tensileStrength: /抗拉强度|拉伸强度|Rm/,
  failureStrain: /破坏应变|断裂应变|延伸率|A[-\s]?50/i,
  stressStrainCurve: /应力应变曲线|应力-应变曲线|应力应变/,
  fatigueCurve: /疲劳寿命曲线|疲劳曲线|S[-\s]?N/i,
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
    draft.temperature = get('temperature');
    draft.density = get('density');
    draft.poisson = get('poisson');
    draft.elasticModulus = get('elasticModulus');
    draft.tensileStrength = get('tensileStrength');
    draft.failureStrain = get('failureStrain');
    if (draft.grade || draft.series || draft.temperature) drafts.push(draft);
  }
  return { drafts, error: '', ignoredCurves };
}

/** 下载用模板（与批量导入解析共用表头） */
export function materialTemplateCsv(type: MaterialType): string {
  if (type === 'conventional') {
    return [
      '牌号,系列号,供应商,温度(°C),方向(°),密度(kg/m³),泊松比,弹性模量(MPa),硬度,抗拉强度(MPa),破坏应变(%),应力应变曲线文件,疲劳寿命曲线文件',
      'SPCC,冷轧钢板,宝钢,25,,7850,0.30,205000,180,370,32,,',
      'PA66-GF30,尼龙加玻纤,巴斯夫,120,,1350,0.34,95000,90,185,3.5,,',
    ].join('\r\n');
  }
  return [
    '牌号,系列号,温度(°C),泊松比,应力应变曲线文件,疲劳寿命曲线文件',
    'EPDM-70,密封橡胶,23,0.48,,',
    'FKM-80,氟橡胶,150,0.47,,',
  ].join('\r\n');
}

/**
 * 解析批量导入 CSV。
 * 自动判断：有「牌号」表头关键字 → 表头映射；否则 → 固定坐标布局。
 */
export function parseMaterialCsv(
  text: string,
  type: MaterialType,
): { drafts: MaterialDraft[]; error: string; ignoredCurves: boolean } {
  const rows = (text || '')
    .split(/\r?\n/)
    .map((line) => line.split(/[,，;；\t]/))
    .filter((r) => r.length && r.some((c) => String(c ?? '').trim()));
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
): Promise<{ drafts: MaterialDraft[]; error: string; ignoredCurves: boolean }> {
  let data: ArrayBuffer;
  if (file instanceof File) data = await file.arrayBuffer();
  else data = file;
  const XLSX = await import('xlsx');
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
  if (detectHeaderMode(rows)) return parseRows(rows, type);
  return parseFixedCoords(rows, type);
}

/** 判断是否走表头映射（首行含「牌号/系列/grade/series」关键字即可） */
function detectHeaderMode(rows: string[][]): boolean {
  const first = (rows[0] || []).map((c) => String(c ?? '').trim().toLowerCase());
  return first.some((c) => /牌号|grade|系列|series/i.test(c));
}

/** 从固定坐标布局解析一条材料记录 */
function parseFixedCoords(
  rows: string[][],
  type: MaterialType,
): { drafts: MaterialDraft[]; error: string; ignoredCurves: boolean } {
  const get = (rowIdx: number, colIdx: number): string => {
    const row = rows[rowIdx];
    if (!row) return '';
    return String(row[colIdx] ?? '').trim();
  };
  const num = (rowIdx: number, colIdx: number): string => {
    const s = get(rowIdx, colIdx);
    if (!s) return '';
    const m = s.match(/-?\d+(\.\d+)?/);
    return m ? m[0] : '';
  };

  const draft = emptyDraft(type);
  // 第二列（索引1）的固定值行
  draft.grade = get(1, 1); // 第2行
  draft.supplier = get(2, 1); // 第3行
  draft.series = get(3, 1); // 第4行
  draft.temperature = num(4, 1); // 第5行
  draft.density = num(5, 1); // 第6行
  draft.elasticModulus = num(6, 1); // 第7行
  draft.direction = num(7, 1); // 第8行
  draft.hardness = num(9, 1); // 第10行
  draft.poisson = num(10, 1); // 第11行

  // 曲线读取：C列(索引2)=应变，D列(索引3)=应力，从第2行连续读，遇非数字即停
  // 允许 Excel 在固定值区和曲线区之间留几行空行/标签行（曲线行号从第1行表头之后，固定值区之后）
  // 这里放宽为：从第2行起逐行尝试两列均为数值则收集，否则跳过；遇到连续 2 次空（或文件末尾）就结束。
  // 这样即使固定值区域在上面几行，曲线从后段开始也能正确取到。
  const curvePoints: CurvePoint[] = [];
  let trailingEmpty = 0;
  let hitAnyPoint = false;
  for (let r = 1; r < rows.length && trailingEmpty < 2; r++) {
    const ex = num(r, 2);
    const sy = num(r, 3);
    if (!ex || !sy) {
      if (hitAnyPoint) trailingEmpty++;
      continue;
    }
    trailingEmpty = 0;
    hitAnyPoint = true;
    const exN = Number(ex);
    const syN = Number(sy);
    if (!Number.isFinite(exN) || !Number.isFinite(syN)) continue;
    // 应变：<1 视为小数（如 0.05）→ 乘 100 变 %；>=1 视为已百分数
    const strain = exN <= 1 ? exN * 100 : exN;
    curvePoints.push({ x: Math.round(strain * 10000) / 10000, y: syN });
  }

  if (curvePoints.length >= 2) {
    // 校验应变递增，必要时过滤重复/回退
    const clean: CurvePoint[] = [];
    for (const p of curvePoints) {
      if (!clean.length || p.x > clean[clean.length - 1].x) clean.push(p);
      else if (clean.length && p.x === clean[clean.length - 1].x) {
        // 同应变取最大应力
        clean[clean.length - 1].y = Math.max(clean[clean.length - 1].y, p.y);
      }
    }
    if (clean.length >= 2) {
      draft.stressStrainCurve = { sourceName: '', points: clean };
      // 抗拉强度 = 应力最大值（破坏点附近通常也是峰值）
      const maxStress = Math.max(...clean.map((p) => p.y));
      draft.tensileStrength = String(Math.round(maxStress * 100) / 100);
      // 破坏应变 = 曲线末端应变（已为 %）
      const maxStrain = Math.max(...clean.map((p) => p.x));
      draft.failureStrain = String(Math.round(maxStrain * 100) / 100);
    }
  }

  if (!draft.grade || !draft.series || !draft.temperature) {
    return {
      drafts: [],
      error: '固定坐标布局未找到必填值（牌号/系列号/温度），请确认文件格式',
      ignoredCurves: false,
    };
  }
  // 只有在没拿到曲线时才置 ignoredCurves=true 提示用户
  return {
    drafts: [draft],
    error: '',
    ignoredCurves: !draft.stressStrainCurve,
  };
}
