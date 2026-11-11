import { paramInRange, type ProductModel } from './types';

export type GateLevel = 'error' | 'warn';

export interface GateIssue {
  level: GateLevel;
  /** 问题定位，便于界面分组：型号 / 需求 / 参数 / 计算 / 标准 */
  scope: 'model' | 'requirement' | 'param' | 'calc' | 'standard';
  message: string;
}

export interface GateResult {
  errors: number;
  warns: number;
  issues: GateIssue[];
  /** 无 error 即可发布 */
  ok: boolean;
}

/**
 * 发布门禁（P0）：需求是否完整、关键参数是否有值且不越界、是否都有计算依据。
 * 只做规则校验，不修改数据，便于在版本基线与界面中共用。
 */
export function runGate(model: ProductModel): GateResult {
  const issues: GateIssue[] = [];

  if (!model.name.trim()) issues.push({ level: 'error', scope: 'model', message: '型号名称不能为空' });
  if (!model.id.trim()) issues.push({ level: 'error', scope: 'model', message: '型号 P/N 不能为空' });
  if (!model.customer.trim() && !model.projectId) {
    issues.push({ level: 'warn', scope: 'model', message: '未绑定项目或客户，发布后不便追溯' });
  }
  if (!model.owner.trim()) issues.push({ level: 'warn', scope: 'model', message: '未填写设计负责人' });
  if (model.status === 'obsolete') {
    issues.push({ level: 'error', scope: 'model', message: '已停产型号不可再次发布' });
  }

  if (model.standards.filter((s) => s.trim()).length === 0) {
    issues.push({ level: 'error', scope: 'standard', message: '至少填写一条设计依据标准' });
  }

  if (model.requirements.length === 0) {
    issues.push({ level: 'error', scope: 'requirement', message: '还没有需求项，无法证明设计目标' });
  }
  for (const req of model.requirements) {
    const name = req.name.trim() || '未命名需求';
    if (req.target == null || !Number.isFinite(req.target)) {
      issues.push({ level: 'error', scope: 'requirement', message: `需求「${name}」缺少目标值` });
    }
    if (!req.unit.trim()) {
      issues.push({ level: 'warn', scope: 'requirement', message: `需求「${name}」缺少单位` });
    }
    if (!req.source.trim()) {
      issues.push({ level: 'warn', scope: 'requirement', message: `需求「${name}」未标注来源（客户 SOR / 标准条款）` });
    }
  }
  // 计算类需求必须至少有计算记录支撑；其余类型提示证据缺口
  const calcReqs = model.requirements.filter((r) => r.verify === 'calc');
  if (calcReqs.length > 0 && model.calcRefs.length === 0) {
    issues.push({ level: 'error', scope: 'calc', message: '存在计算类需求，但尚未关联任何计算记录' });
  }
  for (const r of model.requirements.filter((x) => x.verify !== 'calc')) {
    issues.push({
      level: 'warn',
      scope: 'requirement',
      message: `需求「${r.name || '未命名需求'}」为${r.verify === 'cae' ? 'CAE' : '试验'}验证，P0 暂不自动校验，请人工确认证据`,
    });
  }

  if (model.params.length === 0) {
    issues.push({ level: 'error', scope: 'param', message: '还没有关键参数，无法固化设计结果' });
  }
  for (const p of model.params) {
    const name = p.label.trim() || p.key || '未命名参数';
    if (p.value == null || !Number.isFinite(p.value)) {
      issues.push({ level: 'warn', scope: 'param', message: `参数「${name}」尚未取值` });
    }
    if (!paramInRange(p)) {
      issues.push({ level: 'error', scope: 'param', message: `参数「${name}」超出允许范围 ${p.min ?? '-∞'} ~ ${p.max ?? '+∞'}` });
    }
    if (p.source === 'manual' && !p.basis.trim()) {
      issues.push({ level: 'warn', scope: 'param', message: `参数「${name}」为手工输入且未写明依据` });
    }
  }

  for (const ref of model.calcRefs) {
    if (!ref.formulaVersion.trim()) {
      issues.push({ level: 'warn', scope: 'calc', message: `计算记录「${ref.formulaTitle}」缺少公式版本快照` });
    }
    if (ref.conclusion === 'fail') {
      issues.push({ level: 'error', scope: 'calc', message: `计算记录「${ref.formulaTitle}」结论为不满足，需先整改` });
    }
    if (ref.conclusion === 'pending') {
      issues.push({ level: 'warn', scope: 'calc', message: `计算记录「${ref.formulaTitle}」尚未给出结论` });
    }
  }

  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  return { errors, warns, issues, ok: errors === 0 };
}
