/** 计算书导出动作：组装模型 → 公式渲染为图片 → 生成 Word/PDF → 调主进程保存对话框 */
import { api, type CtrUser, type HistoryEntry, type Project } from '../api';
import { archiveFileName } from './db';
import {
  buildDocxBase64,
  buildPdfHtml,
  buildReportModel,
  buildSummaryXlsxBase64,
  preRenderFormulaImages,
  reportFileName,
} from './buildReport';

export type ReportFormat = 'docx' | 'pdf';

/** 导出某项目（或临时记录集合）的设计计算书。返回是否真正写盘。 */
export async function exportReport(
  records: HistoryEntry[],
  project: Project | null,
  user: CtrUser,
  format: ReportFormat,
): Promise<{ ok: boolean; canceled?: boolean }> {
  const model = buildReportModel(records, project, user);
  // 关键：所有公式统一在渲染进程中用 KaTeX + html2canvas 转成 PNG，
  // Word 用 ImageRun 嵌入、PDF 用 <img> 嵌入，彻底规避 LaTeX 源码在导出时乱码的问题
  await preRenderFormulaImages(model);
  const name = reportFileName(project);
  if (format === 'docx') {
    const base64 = await buildDocxBase64(model);
    return api.file.saveDocx({ defaultName: `${name}.docx`, base64 });
  }
  const html = buildPdfHtml(model);
  return api.file.savePdf({ defaultName: `${name}.pdf`, html });
}

/**
 * 导出「全部计算汇总」到 Excel，弹保存对话框（本地保存）。
 * 归档到服务器产品数据库请用 archiveSummaryExcel。
 */
export async function exportSummaryExcel(
  records: HistoryEntry[],
  project: Project | null,
  user: CtrUser,
): Promise<{ ok: boolean; canceled?: boolean }> {
  const model = buildReportModel(records, project, user);
  const base64 = await buildSummaryXlsxBase64(model);
  return api.file.saveXlsx({ defaultName: `${reportFileName(project)}.xlsx`, base64 });
}

/**
 * 把计算汇总 Excel 直接归档到服务器 UNC 计算库
 * （\\10.1.1.245\Product Database\Theoretical Calculation Library）。
 */
export async function archiveSummaryExcel(
  records: HistoryEntry[],
  project: Project | null,
  user: CtrUser,
): Promise<{ ok: boolean; message?: string; filePath?: string }> {
  const model = buildReportModel(records, project, user);
  const base64 = await buildSummaryXlsxBase64(model);
  const name = archiveFileName(model.projectName || '', model.product || '', model.productVersion, model.dateShort);
  return api.db.archive({ base64, fileName: name, libType: 'calc' });
}
