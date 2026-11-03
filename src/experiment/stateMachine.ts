/**
 * §4 导入状态机
 *
 * UPLOADED → PARSED → QC_PASSED / QC_FAILED → COMPARED → GOLDEN / MISFIT → REVIEWED → PUBLISHED
 * 每次状态迁移必须写 audit_log；QC_FAILED 与 SUSPECT 退回补测，不入库（不进案例库）。
 */
import type { ReportStatus } from './types';

/** 合法迁移表 */
const TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  UPLOADED: ['PARSED'],
  PARSED: ['QC_PASSED', 'QC_FAILED'],
  // QC_FAILED 退回补测后可重新上传
  QC_FAILED: ['UPLOADED'],
  QC_PASSED: ['COMPARED'],
  COMPARED: ['GOLDEN', 'MISFIT'],
  GOLDEN: ['REVIEWED'],
  // MISFIT 允许补充根因后回到 COMPARED 重新分流
  MISFIT: ['COMPARED'],
  REVIEWED: ['PUBLISHED'],
  PUBLISHED: [],
};

export function canTransit(from: ReportStatus, to: ReportStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** 非法迁移抛出错误（调用方应先用 canTransit 判断） */
export function assertTransit(from: ReportStatus, to: ReportStatus): void {
  if (!canTransit(from, to)) {
    throw new Error(`非法状态迁移：${from} → ${to}（允许：${TRANSITIONS[from].join(' / ') || '无'}）`);
  }
}
