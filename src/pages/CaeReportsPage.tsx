import { useState } from 'react';
import { api, type CtrUser, type Project } from '../api';
import {
  bufToBase64,
  extractPdfText,
  fillCaeMetaMissing,
  missingCaeMetaFields,
  parseCaeMeta,
  parseCaeOcrMeta,
  type CaeReportMeta,
} from '../report/caeReport';
import { archiveCaeFileName } from '../report/db';

interface Props {
  user: CtrUser;
  currentProject: Project | null;
}

/** 导入的 CAE 报告条目：原始文件 + 自动识别的元信息（可编辑） */
interface CaeReportEntry {
  id: string;
  originalName: string;
  file: File;
  meta: CaeReportMeta;
  /** PPT 转换后的文字版 PDF（base64），归档时直接写入 CAE 库 */
  pdfBase64?: string;
  /** 由 PPT/PPTX 转换而来 */
  converted?: boolean;
  /** 扫描件（无文字层），元信息来自封面 OCR */
  scanned?: boolean;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** 把 File 读成 base64（用于归档到 UNC） */
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return bufToBase64(buf);
}

/** 从 PDF 路径解析元信息：文字层优先，无文字层时走封面 OCR */
async function parseMetaFromPdfPath(
  fileName: string,
  pdfPath: string,
): Promise<{ meta: CaeReportMeta; scanned: boolean }> {
  let text = '';
  const res = await api.pdf.extractText(pdfPath);
  if (res.ok && typeof res.text === 'string') text = res.text;

  let scanned = false;
  if (!text.trim()) {
    const ocr = await api.pdf.ocrFirstPage(pdfPath);
    if (ocr.ok && typeof ocr.text === 'string') {
      text = ocr.text;
      scanned = true;
    }
  }
  if (!text.trim()) return { meta: parseCaeMeta('', fileName), scanned: false };

  const primary = scanned ? parseCaeOcrMeta(text, fileName) : parseCaeMeta(text, fileName);
  // 文字版再用 OCR 规则互补，避免 PPT 导出的文本框换行造成漏读
  const merged = scanned ? primary : fillCaeMetaMissing(primary, parseCaeOcrMeta(text, fileName));
  return { meta: merged, scanned };
}

/** 浏览器调试模式（无真实路径）时用 pdf.js 直接解析文字层 */
async function parseMetaFromFile(file: File): Promise<{ meta: CaeReportMeta; scanned: boolean }> {
  let text = '';
  try {
    text = await extractPdfText(file);
  } catch {
    text = '';
  }
  if (!text.trim()) return { meta: parseCaeMeta('', file.name), scanned: false };
  return {
    meta: fillCaeMetaMissing(parseCaeMeta(text, file.name), parseCaeOcrMeta(text, file.name)),
    scanned: false,
  };
}

/** CAE 报告导入：PPT/PPTX 转文字版 PDF → 识别元信息 → 人工补全 → 归档到 CAE 仿真库 */
export function CaeReportsPage({ user, currentProject }: Props) {
  const [reports, setReports] = useState<CaeReportEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const showToast = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 2600);
  };

  /** 选择 PPT/PPTX（或 PDF）→ 转文字版 PDF → 解析元字段（扫描件走 OCR） */
  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const added: CaeReportEntry[] = [];
      for (const file of Array.from(files)) {
        try {
          const isPpt = /\.(pptx?|ppsx?)$/i.test(file.name);
          let pdfBase64: string | undefined;
          let converted = false;
          let parsed: { meta: CaeReportMeta; scanned: boolean };

          if (isPpt) {
            const srcPath = api.file.getPath(file);
            if (!srcPath) throw new Error('浏览器调试模式不支持 PPT 导入，请在桌面版中使用');
            showToast(`正在将「${file.name}」转换为文字版 PDF…`);
            const conv = await api.ppt.toPdf(srcPath);
            if (!conv.ok || !conv.pdfPath || !conv.pdfBase64) {
              throw new Error(conv.message || 'PPT 转 PDF 失败');
            }
            pdfBase64 = conv.pdfBase64;
            converted = true;
            parsed = await parseMetaFromPdfPath(file.name, conv.pdfPath);
            // 临时 PDF 已完成解析与取数，立即清理
            api.ppt.cleanup(conv.pdfPath);
          } else {
            const path = api.file.getPath(file);
            parsed = path ? await parseMetaFromPdfPath(file.name, path) : await parseMetaFromFile(file);
          }

          const meta = parsed.meta;
          if (parsed.scanned) showToast(`「${file.name}」无文字层（扫描件），已对封面做 OCR 识别`);
          // 用当前项目兜底一些字段（如果报告里没识别到）
          if (!meta.customer && currentProject?.customer) meta.customer = currentProject.customer;
          if (!meta.project && (currentProject?.code || currentProject?.name)) {
            meta.project = currentProject.code || currentProject.name;
          }
          if (!meta.product && currentProject?.product) meta.product = currentProject.product;
          if (!meta.version && currentProject?.version) meta.version = currentProject.version;

          added.push({
            id: uid(),
            originalName: file.name,
            file,
            meta,
            pdfBase64,
            converted,
            scanned: parsed.scanned,
          });
        } catch (e) {
          showToast(`「${file.name}」导入失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setReports((prev) => [...prev, ...added]);
      const empty = added.filter((r) => missingCaeMetaFields(r.meta).length > 0).length;
      showToast(
        empty > 0
          ? `已导入 ${added.length} 份报告，其中 ${empty} 份有缺失字段，请补全后再归档`
          : `已导入 ${added.length} 份报告并成功提取元信息`,
      );
    } finally {
      setBusy(false);
    }
  };

  const patchMeta = (reportId: string, key: keyof CaeReportMeta, value: string) => {
    setReports((prev) =>
      prev.map((r) => (r.id === reportId ? { ...r, meta: { ...r.meta, [key]: value } } : r)),
    );
  };

  const removeReport = (reportId: string) => {
    setReports((prev) => prev.filter((r) => r.id !== reportId));
  };

  const totalMissing = reports.reduce((n, r) => n + missingCaeMetaFields(r.meta).length, 0);

  /** 批量归档：校验 → 转 base64 → 写 UNC */
  const archiveAll = async () => {
    if (reports.length === 0) {
      showToast('没有可归档的报告');
      return;
    }
    const incomplete = reports.filter((r) => missingCaeMetaFields(r.meta).length > 0);
    if (incomplete.length > 0) {
      const lines = incomplete
        .map((r) => `「${r.originalName}」缺：${missingCaeMetaFields(r.meta).join('、')}`)
        .join('\n');
      setError(`以下 ${incomplete.length} 份报告元信息不完整，请先补全：\n${lines}`);
      return;
    }

    setArchiving(true);
    setError('');
    let okCount = 0;
    let failCount = 0;
    try {
      for (const r of reports) {
        try {
          const b64 = r.pdfBase64 ?? (await fileToBase64(r.file));
          const fileName = archiveCaeFileName(
            r.meta.customer,
            r.meta.project,
            r.meta.caeItem,
            r.meta.product,
            r.meta.version,
            r.meta.date,
          );
          const res = await api.db.archive({ base64: b64, fileName, libType: 'cae' });
          if (res.ok) {
            okCount++;
          } else {
            failCount++;
            showToast(`归档失败：${fileName} — ${res.message || '未知错误'}`);
          }
        } catch (e) {
          failCount++;
          showToast(`归档异常：${r.originalName} — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      showToast(`归档完成：成功 ${okCount} 份${failCount > 0 ? `，失败 ${failCount} 份` : ''}`);
      if (failCount === 0) setReports([]);
      else setReports((prev) => prev.slice(failCount));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="test-page">
      <div className="lib-toolbar">
        <label className={busy ? 'btn-primary sm disabled' : 'btn-primary sm'}>
          {busy ? '转换 / 解析中…' : '选择 PPT CAE 报告'}
          <input
            type="file"
            accept=".ppt,.pptx,.pps,.ppsx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/pdf,.pdf"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => {
              importFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <button
          className="btn-primary sm"
          disabled={archiving || busy || reports.length === 0 || totalMissing > 0}
          onClick={archiveAll}
        >
          {archiving ? '归档中…' : `全部归档到 CAE 库 (${reports.length})`}
        </button>
        {totalMissing > 0 && (
          <span className="ts-warn">
            ⚠ {reports.filter((r) => missingCaeMetaFields(r.meta).length > 0).length} 份报告有 {totalMissing} 处缺失字段，请补全后再归档
          </span>
        )}
        <span className="lib-count">当前登录：{user.displayName || user.username}</span>
      </div>

      {error && <div className="login-error" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}

      {reports.length === 0 && (
        <div className="settings-card test-empty">
          <h3>选择 PPT CAE 报告开始归档</h3>
          <p className="settings-hint">
            点击上方「选择 PPT CAE 报告」按钮，支持多选 PPT / PPTX（也兼容 PDF）。系统会先用本机 PowerPoint（WPS 演示兜底、
            LibreOffice 备用）把报告转换为「文字版 PDF」，再从转换后的 PDF 中识别客户、项目、仿真项目、产品、版本号、日期等信息，
            其中日期优先取报告顶端页眉编号（如 SYZX-BYD 26 07 01 01：年份按当前电脑年份补齐前两位 26 → 2026），
            客户取封面「客户名称」并截取到「XX汽车」为止，仿真项目优先取「仿真项目 / 分析项目」字段，其次取封面「项目名称」一栏。
            所有字段均可在下方列表中校对 / 补全，确认无误后点击「全部归档到 CAE 库」。
            PPT 中若只有图片没有文字，转换后的 PDF 同样会走系统 OCR，请重点核对识别结果。
            归档文件名统一格式为「客户+项目+仿真项目+产品+版本+日期.pdf」，库中保存的是转换后的文字版 PDF，
            存放在 UNC 的 Virtual Verification Library 目录。
          </p>
        </div>
      )}

      {reports.map((r) => {
        const missing = missingCaeMetaFields(r.meta);
        const previewName = archiveCaeFileName(
          r.meta.customer,
          r.meta.project,
          r.meta.caeItem,
          r.meta.product,
          r.meta.version,
          r.meta.date,
        );
        return (
          <div className="settings-card test-report-card" key={r.id}>
            <div className="pc-head">
              <h3>{r.originalName}</h3>
              {r.converted && <span className="tag light tag-ok">PPT → 文字版 PDF</span>}
              {r.scanned && <span className="tag light tag-warn">扫描件 OCR</span>}
              {missing.length > 0 ? (
                <span className="tag light tag-warn">缺：{missing.join('、')}</span>
              ) : (
                <span className="tag tag-ok">✓ 字段完整</span>
              )}
              <button className="btn-link danger" onClick={() => removeReport(r.id)}>
                移除
              </button>
            </div>

            <div className="test-meta test-meta-pdf">
              <label className={`field ${!r.meta.customer ? 'field-warn' : ''}`}>
                <span>客户（必填）</span>
                <input
                  value={r.meta.customer}
                  onChange={(e) => patchMeta(r.id, 'customer', e.target.value)}
                  placeholder="如：长安汽车"
                />
              </label>
              <label className={`field ${!r.meta.project ? 'field-warn' : ''}`}>
                <span>项目（必填）</span>
                <input
                  value={r.meta.project}
                  onChange={(e) => patchMeta(r.id, 'project', e.target.value)}
                  placeholder="如：CS75-2025"
                />
              </label>
              <label className="field">
                <span>仿真项目</span>
                <input
                  value={r.meta.caeItem}
                  onChange={(e) => patchMeta(r.id, 'caeItem', e.target.value)}
                  placeholder="如：进气阻力仿真分析"
                />
              </label>
              <label className={`field ${!r.meta.product ? 'field-warn' : ''}`}>
                <span>产品（必填）</span>
                <input
                  value={r.meta.product}
                  onChange={(e) => patchMeta(r.id, 'product', e.target.value)}
                  placeholder="如：空气滤清器"
                />
              </label>
              <label className={`field ${!r.meta.version ? 'field-warn' : ''}`}>
                <span>版本号（必填）</span>
                <input
                  value={r.meta.version}
                  onChange={(e) => patchMeta(r.id, 'version', e.target.value)}
                  placeholder="如：V1.0"
                />
              </label>
              <label className={`field ${!r.meta.date ? 'field-warn' : ''}`}>
                <span>日期（必填）</span>
                <input
                  value={r.meta.date}
                  onChange={(e) => patchMeta(r.id, 'date', e.target.value)}
                  placeholder="YYYY-MM-DD"
                />
              </label>
            </div>

            <div className="pdf-filename-preview">
              <span className="pfp-label">归档后文件名：</span>
              <code className="pfp-name">{previewName}</code>
              {missing.length > 0 && <span className="pfp-hint">（请先补全缺失字段）</span>}
            </div>
          </div>
        );
      })}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
