import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Props {
  /** 服务器上的 PDF 完整路径（支持 UNC 路径） */
  filePath: string;
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
const ZOOM_STEP = 0.2;
/** 画布容器左右内边距合计（与样式表 .pdf-canvas-wrap 保持一致） */
const WRAP_PADDING = 32;

/**
 * 内置 PDF 阅读器
 *
 * 页面由主进程用 pdfjs + @napi-rs/canvas 渲染成 PNG 后再传回渲染进程，
 * 因此打包后的 file:// 环境也能正常显示（不依赖 Worker / iframe）。
 * 支持翻页、缩放与「适应宽度」。
 */
export function PdfViewer({ filePath }: Props) {
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(0); // 0 = 尚未完成「适应宽度」计算
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** 渲染请求序号：快速翻页时丢弃过期结果 */
  const seq = useRef(0);

  const calcFitScale = useCallback((pageWidth: number): number => {
    const boxWidth = wrapRef.current?.clientWidth ?? 0;
    if (pageWidth <= 0 || boxWidth <= 0) return 1;
    const fit = (boxWidth - WRAP_PADDING) / pageWidth;
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, fit));
  }, []);

  // 切换文件：重置状态，并先按 scale=1 取页面宽度来算「适应宽度」
  useEffect(() => {
    let cancel = false;
    seq.current += 1;
    setPage(1);
    setPageCount(0);
    setScale(0);
    setSrc('');
    setError('');
    setBusy(true);

    api.pdf
      .pageInfo(filePath)
      .then((res) => {
        if (cancel) return;
        if (!res.ok) {
          setError(res.message || 'PDF 无法打开');
          setScale(1);
          return;
        }
        setPageCount(res.pageCount || 0);
        setScale(calcFitScale(res.width || 0));
      })
      .catch((e) => {
        if (cancel) return;
        setError(`PDF 无法打开：${e instanceof Error ? e.message : String(e)}`);
        setScale(1);
      });

    return () => {
      cancel = true;
    };
  }, [filePath, calcFitScale]);

  // 渲染当前页
  useEffect(() => {
    if (!scale) return;
    let cancel = false;
    const my = ++seq.current;
    setBusy(true);
    setError('');

    api.pdf
      .renderPage({ filePath, page, scale })
      .then((res) => {
        if (cancel || my !== seq.current) return;
        if (res.ok && res.dataUrl) {
          setSrc(res.dataUrl);
          if (res.pageCount) setPageCount(res.pageCount);
          if (res.page && res.page !== page) setPage(res.page);
        } else {
          setError(res.message || 'PDF 渲染失败');
        }
      })
      .catch((e) => {
        if (!cancel && my === seq.current) {
          setError(`PDF 渲染失败：${e instanceof Error ? e.message : String(e)}`);
        }
      })
      .finally(() => {
        if (!cancel && my === seq.current) setBusy(false);
      });

    return () => {
      cancel = true;
    };
  }, [filePath, page, scale]);

  const maxPage = Math.max(1, pageCount);
  const gotoPage = (n: number) => setPage(Math.min(maxPage, Math.max(1, n)));
  const zoom = (delta: number) =>
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((s + delta).toFixed(2)))));

  const fitWidth = useCallback(async () => {
    const res = await api.pdf.pageInfo(filePath);
    if (res.ok) setScale(calcFitScale(res.width || 0));
  }, [filePath, calcFitScale]);

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button className="btn-ghost sm" onClick={() => gotoPage(page - 1)} disabled={page <= 1}>
          上一页
        </button>
        <span className="pdf-page-no">
          <input
            type="number"
            min={1}
            max={maxPage}
            value={page}
            onChange={(e) => gotoPage(Number(e.target.value) || 1)}
            aria-label="页码"
          />
          <span>/ {pageCount || '—'}</span>
        </span>
        <button
          className="btn-ghost sm"
          onClick={() => gotoPage(page + 1)}
          disabled={pageCount > 0 ? page >= pageCount : true}
        >
          下一页
        </button>
        <span className="pdf-sep" />
        <button className="btn-ghost sm" onClick={() => zoom(-ZOOM_STEP)} disabled={scale <= MIN_SCALE}>
          缩小
        </button>
        <span className="pdf-zoom">{Math.round((scale || 1) * 100)}%</span>
        <button className="btn-ghost sm" onClick={() => zoom(ZOOM_STEP)} disabled={scale >= MAX_SCALE}>
          放大
        </button>
        <button className="btn-link" onClick={fitWidth}>
          适应宽度
        </button>
        {busy && <span className="pdf-hint">渲染中…</span>}
      </div>

      <div className="pdf-canvas-wrap" ref={wrapRef}>
        {error ? (
          <div className="preview-empty">
            <div className="pe-icon">📄</div>
            <div className="pe-title">该 PDF 无法预览</div>
            <div className="pe-sub">{error}</div>
          </div>
        ) : src ? (
          <img className="pdf-page-img" src={src} alt={`第 ${page} 页`} draggable={false} />
        ) : (
          <div className="preview-loading">{busy ? '正在渲染 PDF…' : '暂无内容'}</div>
        )}
      </div>
    </div>
  );
}
