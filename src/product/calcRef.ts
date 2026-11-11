import type { HistoryEntry } from '../api';
import type { OutputSpec } from '../formula/types';
import { autoUnit } from '../formula/units';
import { createParam, uid, type CalcRef, type DesignParam, type ModelStatus, type ProductModel, type ProductStore } from './types';

/**
 * 由历史计算记录生成产品库的关联快照。
 * 只取数值型输出（SI），并保留公式版本，避免历史被删后无法追溯。
 */
export function buildCalcRef(h: HistoryEntry): CalcRef {
  const outputs: Record<string, number> = {};
  for (const [k, v] of Object.entries(h.outputs || {})) {
    if (typeof v === 'number' && Number.isFinite(v)) outputs[k] = v;
  }
  return {
    id: uid(),
    historyId: h.id,
    formulaId: h.formulaId,
    formulaTitle: h.formulaTitle,
    formulaVersion: h.formulaVersion || '',
    createdAt: h.createdAt,
    outputs,
    conclusion: 'pending',
    note: '',
  };
}

/**
 * 把计算输出补成关键参数：已存在的参数键跳过，单位按公式输出定义自动选取工程单位。
 */
export function buildCalcParams(
  outputsSpec: OutputSpec[],
  ref: CalcRef,
  existingKeys: string[],
): DesignParam[] {
  const existing = new Set(existingKeys);
  return outputsSpec
    .filter((o) => ref.outputs[o.key] != null && !existing.has(o.key))
    .map((o) => {
      const raw = ref.outputs[o.key];
      const disp = o.unitGroup ? autoUnit(raw, o.unitGroup) : { value: raw, unit: o.unit };
      return createParam({
        key: o.key,
        label: o.label,
        value: Number(disp.value.toPrecision(6)),
        unit: disp.unit,
        source: 'calc',
        basis: `${ref.formulaTitle} v${ref.formulaVersion || '未记录'}`,
      });
    });
}

/** 把关联记录与新增参数挂到型号上（新记录排在最前） */
export function attachCalcRef(model: ProductModel, ref: CalcRef, params: DesignParam[]): ProductModel {
  return {
    ...model,
    calcRefs: [ref, ...model.calcRefs],
    params: [...model.params, ...params],
    updatedAt: new Date().toISOString(),
  };
}

export interface ModelOption {
  id: string;
  name: string;
  familyId: string;
  familyName: string;
  status: ModelStatus;
}

/** 供选择器使用的扁平型号列表 */
export function modelOptions(store: ProductStore | null): ModelOption[] {
  if (!store) return [];
  const families = new Map(store.families.map((f) => [f.id, f.name]));
  return store.models.map((m) => ({
    id: m.id,
    name: m.name,
    familyId: m.familyId,
    familyName: families.get(m.familyId) || '未归类',
    status: m.status,
  }));
}
