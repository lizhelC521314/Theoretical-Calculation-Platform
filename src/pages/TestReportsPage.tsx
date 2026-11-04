import { useState } from 'react';
import { api, type CtrUser, type Project } from '../api';
import {
  bufToBase64,
  extractPdfText,
  missingMetaFields,
  ocrPdfFirstPage,
  parseMetaOnly,
  parseOcrMeta,
  type PdfReportMeta,
} from '../report/testReport';
import { archivePdfFileName } from '../report/db';

interface Props {
  user: CtrUser;
  currentProject: Project | null;
}

/** 导入的 PDF 报告条目：原始文件 + 自动提取的元信息（可编辑） */
interface PdfReportEntry {
  id: string;
  originalName: string;
  file: File;
  meta: PdfReportMeta;
  /** 扫描件（无文字层），元信息来自封面 OCR */
  scanned?: boolean;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** 把 File 读成 base64（用于归档到 UNC） */
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return bufToBase64(buf);
}

/** 实验报告导入：提取元信息 → 人工补全 → 以 PDF 原文件归档到实验库 */
export function TestReportsPage({ user, currentProject }: Props) {
  const [reports, setReports] = useState<PdfReportEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const showToast = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 2600);
  };

  /** 选 PDF → 提取文字层 → 解析元字段 */
  const importPdf = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const added: PdfReportEntry[] = [];
      for (const file of Array.from(files)) {
        try {
          let text = '';
          try {
            text = await extractPdfText(file);
          } catch {
            text = '';
          }
          let meta: PdfReportMeta;
          let scanned = false;
          if (text.trim()) {
            meta = parseMetaOnly(text, file.name);
          } else {
            // 无文字层：扫描件，渲染封面走系统 OCR 识别
            scanned = true;
            showToast(`「${file.name}」无文字层（扫描件），正在 OCR 识别封面…`);
            const ocrText = await ocrPdfFirstPage(file);
            meta = ocrText.trim() ? parseOcrMeta(ocrText, file.name) : parseMetaOnly('', file.name);
          }
          // 用当前项目兜底一些字段（如果 PDF 里没识别到）
          if (!meta.project && currentProject?.name) meta.project = currentProject.name;
          if (!meta.product && currentProject?.product) meta.product = currentProject.product;
          if (!meta.version && currentProject?.version) meta.version = currentProject.version;
          added.push({ id: uid(), originalName: file.name, file, meta, scanned });
        } catch (e) {
          showToast(`「${file.name}」解析失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setReports((prev) => [...prev, ...added]);
      // 统计缺失情况
      const empty = added.filter((r) => missingMetaFields(r.meta).length > 0).length;
      showToast(
        empty > 0
          ? `已导入 ${added.length} 份报告，其中 ${empty} 份有缺失字段，请补全后再归档`
          : `已导入 ${added.length} 份报告并成功提取元信息`,
      );
    } finally {
      setBusy(false);
    }
  };

  const patchMeta = (reportId: string, key: keyof PdfReportMeta, value: string) => {
    setReports((prev) =>
      prev.map((r) => (r.id === reportId ? { ...r, meta: { ...r.meta, [key]: value } } : r)),
    );
  };

  const removeReport = (reportId: string) => {
    setReports((prev) => prev.filter((r) => r.id !== reportId));
  };

  const totalMissing = reports.reduce((n, r) => n + missingMetaFields(r.meta).length, 0);

  /** 批量归档：校验 → 转 base64 → 写 UNC */
  const archiveAll = async () => {
    if (reports.length === 0) {
      showToast('没有可归档的报告');
      return;
    }
    // 校验每份报告的必填字段
    const incomplete = reports.filter((r) => missingMetaFields(r.meta).length > 0);
    if (incomplete.length > 0) {
      const lines = incomplete
        .map((r) => `「${r.originalName}」缺：${missingMetaFields(r.meta).join('、')}`)
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
          const b64 = await fileToBase64(r.file);
          const fileName = archivePdfFileName(
            r.meta.customer,
            r.meta.project,
            r.meta.testItem,
            r.meta.product,
            r.meta.version,
            r.meta.date,
          );
          const res = await api.db.archive({ base64: b64, fileName, libType: 'test' });
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
      setReports((prev) => prev.filter((_, i) => i >= okCount + failCount));
      showToast(`归档完成：成功 ${okCount} 份${failCount > 0 ? `，失败 ${failCount} 份` : ''}`);
      // 归档成功的从列表里移除（不再需要留着）
      setReports([]);
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="test-page">
      <div className="lib-toolbar">
        <label className={busy ? 'btn-primary sm disabled' : 'btn-primary sm'}>
          {busy ? '解析中…' : '选择 PDF 实验报告'}
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => {
              importPdf(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <button
          className="btn-primary sm"
          disabled={archiving || busy || reports.length === 0 || totalMissing > 0}
          onClick={archiveAll}
        >
          {archiving ? '归档中…' : `全部归档到实验库 (${reports.length})`}
        </button>
        {totalMissing > 0 && (
          <span className="ts-warn">⚠ {reports.filter((r) => missingMetaFields(r.meta).length > 0).length} 份报告有 {totalMissing} 处缺失字段，请补全后再归档</span>
        )}
        <span className="lib-count">当前登录：{user.displayName || user.username}</span>
      </div>

      {error && <div className="login-error" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}

      {reports.length === 0 && (
        <div className="settings-card test-empty">
          <h3>选择 PDF 实验报告开始归档</h3>
          <p className="settings-hint">
            点击上方「选择 PDF 实验报告」按钮，支持多选。系统会自动从报告封面与正文识别客户、项目、实验项目、产品、版本号、日期等信息，
            其中日期优先取报告顶端页眉编号（如 SYZX-BYD 26 07 01 01：年份按当前电脑年份补齐前两位 26 → 2026），
            客户取封面「客户名称」并截取到「XX汽车」为止，实验项目取封面「项目名称」一栏。
            所有字段均可在下方列表中校对 / 补全，确认无误后点击「全部归档到实验库」。
            扫描件（无文字层的图片型 PDF）会自动对封面做系统 OCR 识别，准确率低于文字版，请重点核对。
            归档文件名统一格式为「客户+项目+实验项目+产品+版本+日期.pdf」，存放在 UNC 实验库目录。
          </p>
        </div>
      )}

      {reports.map((r) => {
        const missing = missingMetaFields(r.meta);
        const previewName = archivePdfFileName(
          r.meta.customer,
          r.meta.project,
          r.meta.testItem,
          r.meta.product,
          r.meta.version,
          r.meta.date,
        );
        return (
          <div className="settings-card test-report-card" key={r.id}>
            <div className="pc-head">
              <h3>{r.originalName}</h3>
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
                <span>实验项目</span>
                <input
                  value={r.meta.testItem}
                  onChange={(e) => patchMeta(r.id, 'testItem', e.target.value)}
                  placeholder="如：压力损失"
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
              {missing.length > 0 && (
                <span className="pfp-hint">（请先补全缺失字段）</span>
              )}
            </div>
          </div>
        );
      })}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
