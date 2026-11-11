import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CtrUser } from '../api';
import { PdfViewer } from '../components/PdfViewer';
import { IS_STANDARD } from '../edition';
import { KBE_THEORY } from '../report/db';
import { THEORY_CATEGORIES, type TheoryRecord } from '../report/theory';

interface Props {
  user: CtrUser;
  /** 跳到导入页（标准版不提供） */
  onOpenImport?: () => void;
}

/**
 * 知识理论检索
 * 按资料名 / 作者 / 类别 / 日期筛选，右侧直接预览归档 PDF，并支持编辑元数据与删除。
 */
export function TheorySearchPage({ onOpenImport }: Props) {
  const [records, setRecords] = useState<TheoryRecord[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [keyword, setKeyword] = useState('');
  const [author, setAuthor] = useState('all');
  const [category, setCategory] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{
    title: string;
    author: string;
    publishedAt: string;
    category: string;
  } | null>(null);
  const [toast, setToast] = useState('');
  /** 左侧列表宽度，支持拖动中缝调整 */
  const [leftWidth, setLeftWidth] = useState(340);
  const draggingRef = useRef(false);

  const startResize = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startWidth = leftWidth;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = startWidth + (ev.clientX - startX);
      // 限制在 240px ~ 窗口宽度的 60% 之间，保证右侧预览始终可读
      const max = Math.max(360, Math.round(window.innerWidth * 0.6));
      setLeftWidth(Math.min(Math.max(next, 240), max));
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('col-resizing');
    };
    document.body.classList.add('col-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2500);
  };

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const ping = await api.db.ping();
      setReachable(ping.reachable);
      const res = await api.theory.list();
      if (res.ok) setRecords((res.records || []) as TheoryRecord[]);
      else setError(res.message || '读取知识理论失败');
    } catch (e) {
      setError(`读取知识理论失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const authors = useMemo(
    () => Array.from(new Set(records.map((r) => r.author).filter(Boolean))).sort(),
    [records],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return records.filter((r) => {
      if (author !== 'all' && r.author !== author) return false;
      if (category !== 'all' && (r.category || '未分类') !== category) return false;
      if (from && (!r.publishedAt || r.publishedAt < from)) return false;
      if (to && (!r.publishedAt || r.publishedAt > to)) return false;
      if (!kw) return true;
      return `${r.title} ${r.author} ${r.sourceName} ${r.category || ''}`.toLowerCase().includes(kw);
    });
  }, [records, keyword, author, category, from, to]);

  const selected = filtered.find((r) => r.id === selectedId) || null;

  const startEdit = () => {
    if (!selected) return;
    setEditing({
      title: selected.title || '',
      author: selected.author || '',
      publishedAt: selected.publishedAt || '',
      category: selected.category || '',
    });
  };

  const saveEdit = async () => {
    if (!editing || !selected) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.theory.update({
        id: selected.id,
        title: editing.title.trim(),
        author: editing.author.trim(),
        publishedAt: editing.publishedAt.trim(),
        category: editing.category,
      });
      if (res.ok) {
        await refresh();
        setEditing(null);
        showToast('已更新');
      } else {
        setError(res.message || '更新失败');
      }
    } catch (e) {
      setError(`更新失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    const ok = window.confirm(
      `确认删除「${selected.title || selected.id}」？\n归档 PDF 会一并移除，不可恢复。`,
    );
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.theory.delete({ id: selected.id });
      if (res.ok) {
        setSelectedId(null);
        setEditing(null);
        await refresh();
        showToast('已删除');
      } else {
        setError(res.message || '删除失败');
      }
    } catch (e) {
      setError(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="test-search fmea-page training-page">
      <div className="settings-card">
        <div className="ts-head">
          <h3>知识理论</h3>
          <div className="ts-status">
            <span>
              服务器状态：
              {reachable === null ? (
                '检测中…'
              ) : reachable ? (
                <b className="ok">可达</b>
              ) : (
                <b className="warn">不可达（浏览器调试模式无法访问 UNC 路径）</b>
              )}
            </span>
            <span className="chip">资料 {records.length}</span>
            <button className="btn-ghost sm" onClick={refresh} disabled={busy}>
              {busy ? '刷新中…' : '刷新'}
            </button>
            <button className="btn-ghost sm" onClick={() => api.app.openPath(KBE_THEORY)}>
              打开归档目录
            </button>
            {!IS_STANDARD && onOpenImport && (
              <button className="btn-primary sm" onClick={onOpenImport}>
                导入知识理论
              </button>
            )}
          </div>
        </div>

        <div className="ts-toolbar">
          <input
            className="search-input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索资料名 / 作者，例如：流阻、张三"
          />
          <select className="tu-project" value={author} onChange={(e) => setAuthor(e.target.value)}>
            <option value="all">全部作者</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select className="tu-project" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">全部类别</option>
            {THEORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="未分类">未分类</option>
          </select>
          <input
            className="training-input date"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            title="日期起"
          />
          <span className="training-date-sep">至</span>
          <input
            className="training-input date"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            title="日期止"
          />
          {(keyword || author !== 'all' || category !== 'all' || from || to) && (
            <button
              className="btn-link"
              onClick={() => {
                setKeyword('');
                setAuthor('all');
                setCategory('all');
                setFrom('');
                setTo('');
              }}
            >
              重置筛选
            </button>
          )}
          <span className="lib-count">筛选结果 {filtered.length} 份</span>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div
        className="fmea-body"
        style={{ gridTemplateColumns: `${leftWidth}px 8px minmax(0, 1fr)`, columnGap: 0 }}
      >
        <div className="fmea-list">
          {filtered.map((r) => (
            <div
              key={r.id}
              className={selectedId === r.id ? 'fmea-item active' : 'fmea-item'}
              onClick={() => setSelectedId(r.id)}
            >
              <div className="fmea-item-top">
                <span className="fmea-item-id">{r.id}</span>
                <span className="fmea-cat">{r.category || '未分类'}</span>
                <span className="fmea-year">{r.publishedAt || '未记录日期'}</span>
              </div>
              <div className="fmea-item-part">{r.title || '未命名资料'}</div>
              <div className="fmea-item-action">
                作者：{r.author || '未填写'} · {r.sourceFormat ? r.sourceFormat.toUpperCase() : 'PDF'}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="fmea-list-empty">
              {records.length === 0
                ? IS_STANDARD
                  ? '知识理论暂无资料，请联系管理员导入'
                  : '知识理论暂无资料。到「知识理论导入」上传 PPT / Word / PDF 即可'
                : '没有匹配的资料，换个关键词或清除筛选'}
            </div>
          )}
        </div>

        <div
          className="theory-splitter"
          onMouseDown={startResize}
          title="按住拖动可调整左右区域宽度"
        />

        <div className="fmea-detail">
          {!selected && (
            <div className="preview-empty">
              <div className="pe-icon">📖</div>
              <div className="pe-title">从左侧选中一份知识理论</div>
              <div className="pe-sub">
                所有资料入库时已统一转为 PDF，可直接在这里翻阅。归档目录：
                <span className="mono"> {KBE_THEORY} </span>
              </div>
            </div>
          )}

          {selected && !editing && (
            <>
              <div className="fmea-detail-head">
                <h3>{selected.title || '未命名资料'}</h3>
                <div className="preview-meta">
                  <span className="chip">{selected.id}</span>
                  <span className="chip">类别：{selected.category || '未分类'}</span>
                  {selected.author && <span className="chip">作者：{selected.author}</span>}
                  {selected.publishedAt && <span className="chip">日期：{selected.publishedAt}</span>}
                  <button className="btn-ghost sm" onClick={() => api.app.openPath(selected.pdfPath || '')}>
                    用默认程序打开
                  </button>
                  <button
                    className="btn-ghost sm"
                    onClick={() => api.app.openPath((selected.pdfPath || '').replace(/[^\\/]+$/, ''))}
                  >
                    打开所在目录
                  </button>
                  <button className="btn-ghost sm" onClick={startEdit} disabled={saving}>
                    编辑元数据
                  </button>
                  <button className="btn-link danger sm" onClick={remove} disabled={saving}>
                    删除
                  </button>
                </div>
              </div>
              {selected.pdfExists === false ? (
                <div className="preview-empty">
                  <div className="pe-icon">⚠</div>
                  <div className="pe-title">归档 PDF 不存在</div>
                  <div className="pe-sub">该记录的 PDF 可能已被移动或删除，请重新导入。</div>
                </div>
              ) : (
                <PdfViewer filePath={selected.pdfPath || ''} />
              )}
            </>
          )}

          {selected && editing && (
            <div className="fmea-edit">
              <div className="fmea-edit-head">
                <h3>修改知识理论 {selected.id}</h3>
                <span className="small muted">只修改元数据，不会替换归档 PDF</span>
              </div>
              <div className="fmea-form-grid training-edit-grid">
                <label className="field full">
                  <span className="mat-field-label">
                    <span className="mat-field-name">资料名</span>
                    <span className="mat-field-unit">必填</span>
                  </span>
                  <input
                    value={editing.title}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                  />
                </label>
                <label className="field">
                  <span className="mat-field-label">
                    <span className="mat-field-name">作者</span>
                    <span className="mat-field-unit">必填</span>
                  </span>
                  <input
                    value={editing.author}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, author: e.target.value } : prev))}
                  />
                </label>
                <label className="field">
                  <span className="mat-field-label">
                    <span className="mat-field-name">日期</span>
                    <span className="mat-field-unit"></span>
                  </span>
                  <input
                    type="date"
                    value={editing.publishedAt}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, publishedAt: e.target.value } : prev))}
                  />
                </label>
                <label className="field">
                  <span className="mat-field-label">
                    <span className="mat-field-name">类别</span>
                    <span className="mat-field-unit"></span>
                  </span>
                  <select
                    value={editing.category}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, category: e.target.value } : prev))}
                  >
                    <option value="">未分类</option>
                    {THEORY_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field full training-edit-source">
                  <span className="small muted">
                    源文件：{selected.sourceName || '—'} · 归档：{selected.pdfName || selected.id + '.pdf'}
                  </span>
                </div>
              </div>
              <div className="mat-edit-actions">
                <button className="btn-primary sm" onClick={saveEdit} disabled={saving}>
                  {saving ? '保存中…' : '保存修改'}
                </button>
                <button className="btn-ghost sm" onClick={() => setEditing(null)} disabled={saving}>
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
