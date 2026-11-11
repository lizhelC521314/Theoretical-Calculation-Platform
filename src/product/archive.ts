/**
 * 型号设计档案归档
 *
 * 发布型号时把「需求-参数-校核-基线」导出为一份 Excel，归档到
 * \\10.1.1.245\Knowledge & Experience Base\Product Design Library，
 * 由「产品数据库 → 型号设计档案」页签浏览。
 *
 * Excel 生成逻辑见 archiveWorkbook.ts（纯函数），此处只负责写共享目录。
 */
import { api } from '../api';
import { designArchiveFileName } from '../report/db';
import { buildDesignArchiveBase64 } from './archiveWorkbook';
import type { Baseline, ProductFamily, ProductModel } from './types';

export { buildDesignArchiveBase64 } from './archiveWorkbook';

/** 归档型号设计档案到产品设计库目录 */
export async function archiveDesignArchive(
  model: ProductModel,
  family: ProductFamily | null,
  baseline: Baseline,
): Promise<{ ok: boolean; filePath?: string; message?: string }> {
  try {
    const base64 = await buildDesignArchiveBase64(model, family, baseline);
    const name = designArchiveFileName(family?.name ?? '', model.id, baseline.label);
    return await api.db.archive({ base64, fileName: name, libType: 'design', overwrite: true });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
