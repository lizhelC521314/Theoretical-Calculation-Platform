/** 元数据校验辅助（§5） */
import type { ExperimentMeta } from './types';
import { missingMetadata } from './qc';

/** 缺失必填项的中文名列表 */
export function missingMetadataLabels(meta: Partial<ExperimentMeta>): string[] {
  return missingMetadata(meta);
}

/** 元数据不全时用占位值补全（仅用于登记 QC_FAILED 记录，保证表结构完整） */
export function requireFields(meta: Partial<ExperimentMeta>): ExperimentMeta {
  return {
    reportId: meta.reportId ?? '',
    productFamily: meta.productFamily ?? '',
    productModel: meta.productModel ?? '',
    reportVersion: meta.reportVersion ?? '',
    testStandard: meta.testStandard ?? '',
    testDate: meta.testDate ?? '',
    operator: meta.operator ?? '',
    lab: meta.lab ?? '',
    sensorIds: meta.sensorIds ?? [],
    calibrationDue: meta.calibrationDue ?? '',
    temperature: meta.temperature ?? NaN,
    humidity: meta.humidity ?? NaN,
    altitude: meta.altitude ?? NaN,
    flowRate: meta.flowRate ?? NaN,
    unitSystem: meta.unitSystem ?? '',
  };
}
