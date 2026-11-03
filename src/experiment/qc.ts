/**
 * §5 元数据必填校验 + §6 QC 规则
 */
import type { ExperimentMeta, MeasurementCurve } from './types';

/** §5 必填项中文字段名（用于 QC_FAILED 提示） */
export const REQUIRED_LABELS: [keyof ExperimentMeta, string][] = [
  ['reportId', '报告编号'],
  ['productFamily', '产品族'],
  ['productModel', '产品型号'],
  ['reportVersion', '报告版本'],
  ['testStandard', '试验标准'],
  ['testDate', '试验日期'],
  ['operator', '试验员'],
  ['lab', '实验室'],
  ['sensorIds', '传感器编号'],
  ['calibrationDue', '校准到期日'],
  ['temperature', '温度'],
  ['humidity', '湿度'],
  ['altitude', '海拔'],
  ['flowRate', '流量'],
  ['unitSystem', '单位制'],
];

/** §5：缺任一元数据 → 返回缺失项中文名列表（空数组 = 通过） */
export function missingMetadata(meta: Partial<ExperimentMeta>): string[] {
  const missing: string[] = [];
  for (const [key, label] of REQUIRED_LABELS) {
    const v = meta[key];
    if (v === undefined || v === null || v === '') missing.push(label);
    else if (Array.isArray(v) && v.length === 0) missing.push(label);
    else if (typeof v === 'number' && !Number.isFinite(v)) missing.push(label);
  }
  return missing;
}

export interface QcIssue {
  rule: string;
  level: 'FAIL' | 'SUSPECT';
  message: string;
  /** 涉及的测量量（曲线级问题） */
  quantity?: string;
}

export interface QcResult {
  /** FAIL 存在 → QC_FAILED，否则 QC_PASSED */
  passed: boolean;
  issues: QcIssue[];
  /** 被标记 SUSPECT 的测量量（不删除，仅标记） */
  suspectQuantities: string[];
}

/**
 * 物理上限简表：超上限 → SUSPECT（§6 规则 3）。
 * 阻力（压降 Pa）不应为负；TL 负值异常（< −5 dB 视为越界）。
 */
const PHYSICAL_BOUNDS: Record<string, { min?: number; max?: number }> = {
  阻力: { min: 0 },
  TL: { min: -5 },
};

/**
 * §6 QC 规则：
 * 1. 单位统一 SI；dB 类量不参与百分比误差；
 * 2. 重复性：同一工况 ≥3 次，极差/均值 ≤5%，否则 FAIL（dB 类不适用百分比，跳过）；
 * 3. 异常点：3σ 或超物理上限 → SUSPECT，不删除；
 * 4. 传感器校准过期 → FAIL；
 * 5. 曲线点数不足（<5 点/十倍频程）→ SUSPECT。
 */
export function qcReport(meta: ExperimentMeta, curves: MeasurementCurve[], now: Date = new Date()): QcResult {
  const issues: QcIssue[] = [];
  const suspect = new Set<string>();

  // 规则 1：单位统一 SI
  if (meta.unitSystem.trim().toUpperCase() !== 'SI') {
    issues.push({ rule: '§6.1', level: 'FAIL', message: `单位制 ${meta.unitSystem} 非 SI，须先换算后入库` });
  }

  // 规则 4：传感器校准过期
  const due = new Date(meta.calibrationDue);
  if (Number.isFinite(due.getTime()) && due.getTime() < now.getTime()) {
    issues.push({ rule: '§6.4', level: 'FAIL', message: `传感器校准已于 ${meta.calibrationDue} 过期` });
  }

  for (const c of curves) {
    // 规则 2：重复性（≥3 次重复，极差/均值 ≤5%；dB 类量不参与百分比误差）
    if (c.repeats && c.kind === 'linear') {
      for (let i = 0; i < c.repeats.length; i++) {
        const rep = c.repeats[i];
        if (rep.length < 3) continue;
        const mean = rep.reduce((a, b) => a + b, 0) / rep.length;
        const range = Math.max(...rep) - Math.min(...rep);
        if (mean !== 0 && range / Math.abs(mean) > 0.05) {
          issues.push({
            rule: '§6.2', level: 'FAIL', quantity: c.quantity,
            message: `${c.quantity} 第 ${i + 1} 点重复性 极差/均值 = ${((range / Math.abs(mean)) * 100).toFixed(2)}% > 5%`,
          });
        }
      }
    }

    // 规则 3：3σ 异常点 + 超物理上限 → SUSPECT（不删除）
    if (c.repeats) {
      for (let i = 0; i < c.repeats.length; i++) {
        const rep = c.repeats[i];
        if (rep.length < 3) continue;
        const mean = rep.reduce((a, b) => a + b, 0) / rep.length;
        const sd = Math.sqrt(rep.reduce((a, b) => a + (b - mean) ** 2, 0) / rep.length);
        if (sd > 0 && rep.some((x) => Math.abs(x - mean) > 3 * sd)) {
          suspect.add(c.quantity);
          issues.push({ rule: '§6.3', level: 'SUSPECT', quantity: c.quantity, message: `${c.quantity} 第 ${i + 1} 点存在 3σ 异常值` });
        }
      }
    }
    const bound = PHYSICAL_BOUNDS[c.quantity];
    if (bound) {
      if (c.points.some((p) => (bound.min !== undefined && p.y < bound.min) || (bound.max !== undefined && p.y > bound.max))) {
        suspect.add(c.quantity);
        issues.push({ rule: '§6.3', level: 'SUSPECT', quantity: c.quantity, message: `${c.quantity} 存在超物理上限的点` });
      }
    }

    // 规则 5：曲线点数 <5 点/十倍频程 → SUSPECT
    const xs = c.points.map((p) => p.x).filter((x) => x > 0);
    if (xs.length >= 2) {
      const decades = Math.log10(Math.max(...xs) / Math.min(...xs));
      if (decades > 0 && c.points.length / decades < 5) {
        suspect.add(c.quantity);
        issues.push({
          rule: '§6.5', level: 'SUSPECT', quantity: c.quantity,
          message: `${c.quantity} 曲线密度 ${(c.points.length / decades).toFixed(1)} 点/十倍频程 < 5`,
        });
      }
    }
  }

  return {
    passed: !issues.some((i) => i.level === 'FAIL'),
    issues,
    suspectQuantities: [...suspect],
  };
}
