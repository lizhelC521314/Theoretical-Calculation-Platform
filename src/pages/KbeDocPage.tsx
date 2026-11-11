import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, isDesktop, type CtrUser } from '../api';
import { PdfViewer } from '../components/PdfViewer';
import {
  KBE_DOC_ACCEPT,
  inferKbeDocCategory,
  parseKbeDocFileName,
  todayKbeDocDate,
  kbeDocConfig,
  type KbeDocCategory,
  type KbeDocRecord,
} from '../report/kbeDoc';

interface Props {
  user: CtrUser;
  category: KbeDocCategory;
}

interface Entry {
  uid: string;
  fileName: string;
  filePath: string;
  title: string;
  author: string;
  publishedAt: string;
  docCategory: string;
  /** 文件名中已识别的分类专属字段（如标准号） */
  extras: Record<string, string>;
  status: 'idle' | 'importing' | 'done' | 'error';
  message: string;
}

/** 状态类徽标配色：现行/已关闭为绿，作废/高为红，即将实施/整改中为黄 */
function badgeTone(value: string): string {
  if (!value) return '';
  if (['现行', '已关闭'].includes(value)) return 'ok';
  if (['作废', '高', '待评估'].includes(value)) return 'err';
  if (['即将实施', '征求意见', '整改中', '中'].includes(value)) return 'warn';
  return '';
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** 共享：读取某分类下的已入库资料 */
function useKbeRecords(category: KbeDocCategory) {
  const [records, setRecords] = useState<KbeDocRecord[]>([]);
  const [dir, setDir] = useState('');
  const [exists, setExists] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await api.kbe.docList({ category });
      if (res.ok) {
        setRecords((res.records || []) as KbeDocRecord[]);
        setDir(res.dir || '');
        setExists(res.exists !== false);
        setError('');
      } else {
        setError(res.message || '读取归档目录失败');
      }
    } catch (e) {
      setError(`读取归档目录失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [category]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { records, dir, exists, error, setError, refresh };
}

/**
 * 知识经验库·资料导入页
 * 多选 PPT / Word / PDF，入库统一转 PDF；资料名、作者、日期、类别与业务领域自动识别并可逐行修改。
 */
export function KbeDocImportPage({ user, category }: Props) {
  const cfg = kbeDocConfig(category);
  /** 分类专属字段：导入框内直接展示，importInRow 标记的排在前面 */
  const fields = useMemo(
    () => [...cfg.fields].sort((a, b) => Number(!!b.importInRow) - Number(!!a.importInRow)),
    [cfg],
  );

  const { records, dir, exists, error, setError, refresh } = useKbeRecords(category);
  const [entries, setEntries] = useState<Entry[]>([]);
  /** 批量导入时的默认类别：非空则整批沿用，不再按文件名推断 */
  const [defaultKind, setDefaultKind] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2800);
  };

  const patch = (id: string, next: Partial<Entry>) => {
    setEntries((prev) => prev.map((e) => (e.uid === id ? { ...e, ...next } : e)));
  };

  const addFiles = useCallback(
    (files: FileList | null) => {
      if (!files || !files.length) return;
      if (!isDesktop) {
        setError('浏览器调试模式不支持导入本地文件，请在桌面程序中使用');
        return;
      }
      setError('');
      const next: Entry[] = [];
      for (const f of Array.from(files)) {
        const filePath = api.file.getPath(f);
        if (!filePath) continue;
        const parsed = parseKbeDocFileName(f.name);
        next.push({
          uid: uid(),
          fileName: f.name,
          filePath,
          title: parsed.title,
          author: parsed.author,
          publishedAt: parsed.publishedAt || todayKbeDocDate(),
          docCategory: defaultKind || inferKbeDocCategory(f.name, category) || parsed.docCategory,
          extras: parsed.extras,
          status: 'idle',
          message: '',
        });
      }
      if (next.length === 0) setError('未能获取文件路径，请重新选择');
      setEntries((prev) => [...prev, ...next]);
    },
    [category, defaultKind, setError],
  );

  const pending = useMemo(
    () => entries.filter((e) => e.status === 'idle' || e.status === 'error'),
    [entries],
  );

  const startImport = async () => {
    if (!pending.length) return;
    setBusy(true);
    setError('');
    let okCount = 0;
    for (const e of pending) {
      if (!e.title.trim()) {
        patch(e.uid, { status: 'error', message: '资料名不能为空' });
        continue;
      }
      patch(e.uid, { status: 'importing', message: '正在转 PDF…' });
      try {
        const res = await api.kbe.docImport({
          category,
          srcPath: e.filePath,
          title: e.title.trim(),
          author: e.author.trim(),
          publishedAt: e.publishedAt.trim(),
          docCategory: e.docCategory,
          extras: e.extras,
          createdBy: user.username,
          createdByDisplay: user.displayName,
        });
        if (!res.ok) {
          patch(e.uid, { status: 'error', message: res.message || '导入失败' });
          continue;
        }
        const rec = res.record as KbeDocRecord | undefined;
        okCount += 1;
        patch(e.uid, { status: 'done', message: `已入库：${rec?.id || ''}` });
      } catch (err) {
        patch(e.uid, { status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }
    setBusy(false);
    if (okCount) {
      await refresh();
      showToast(`已导入 ${okCount} 份${cfg.label}资料`);
    }
  };

  return (
    <div className="test-search fmea-page training-page">
      <div className="settings-card">
        <div className="ts-head">
          <h3>{cfg.label} · 资料导入</h3>
          <div className="ts-status">
            <span className="chip">库内 {records.length}</span>
            <button className="btn-ghost sm" onClick={refresh} disabled={busy}>
              {busy ? '处理中…' : '刷新'}
            </button>
            <button className="btn-ghost sm" onClick={() => api.app.openPath(dir)}>
              打开归档目录
            </button>
          </div>
        </div>

        <div className="ts-toolbar">
          <label className={busy ? 'btn-primary sm disabled' : 'btn-primary sm'}>
            选择资料
            <input
              type="file"
              accept={KBE_DOC_ACCEPT}
              multiple
              hidden
              disabled={busy}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <button className="btn-primary sm" onClick={startImport} disabled={busy || pending.length === 0}>
            {busy ? '导入中…' : `开始导入（${pending.length}）`}
          </button>
          <select
            className="tu-project"
            value={defaultKind}
            onChange={(e) => setDefaultKind(e.target.value)}
            disabled={busy}
            title="批量导入时统一使用的类别；留空则按文件名自动识别"
          >
            <option value="">类别：自动识别</option>
            {cfg.kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button
            className="btn-ghost sm"
            disabled={busy || !defaultKind || pending.length === 0}
            onClick={() =>
              setEntries((prev) =>
                prev.map((e) => (e.status === 'done' ? e : { ...e, docCategory: defaultKind })),
              )
            }
          >
            应用到待导入
          </button>
        </div>
        <div className="training-path">
          支持 PPT / Word / PDF，入库统一转 PDF；归档目录：
          <span className="mono">
            {dir || `\\\\10.1.1.245\\Knowledge & Experience Base\\${cfg.dirName}`}
          </span>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="settings-card">
        <div className="ts-head">
          <h3>待导入</h3>
          <div className="ts-status">
            <span className="chip">待导入 {pending.length}</span>
            {entries.some((e) => e.status === 'done') && (
              <button
                className="btn-link"
                onClick={() => setEntries((prev) => prev.filter((e) => e.status !== 'done'))}
                disabled={busy}
              >
                清空已完成
              </button>
            )}
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="settings-hint">
            「选择资料」可一次多选，入库前的元数据在这里填好：资料名、{cfg.authorLabel}、日期、类别与
            {fields.map((f) => f.label).join('、')}
            会按文件名自动识别，识别不出的可直接补填；导入后仍可在「{cfg.label} · 资料检索」页修改。
            {!exists && `（提示：共享目录中还没有「${cfg.label}」文件夹）`}
          </p>
        ) : (
          <div className="kbe-entry-list">
            {entries.map((e) => {
              const locked = e.status === 'done' || e.status === 'importing';
              return (
                <div className="kbe-entry" key={e.uid}>
                  <div className="kbe-entry-head">
                    <span className="kbe-entry-file" title={e.fileName}>
                      {e.fileName}
                    </span>
                    <span
                      className={
                        e.status === 'done'
                          ? 'training-state ok'
                          : e.status === 'error'
                            ? 'training-state err'
                            : 'training-state'
                      }
                    >
                      {e.status === 'idle' ? '待导入' : e.message}
                    </span>
                    {!locked && (
                      <button
                        className="btn-link danger sm"
                        disabled={busy}
                        onClick={() => setEntries((prev) => prev.filter((x) => x.uid !== e.uid))}
                      >
                        移除
                      </button>
                    )}
                  </div>
                  <div className="kbe-edit-grid">
                    <label className="kbe-field kbe-span2">
                      <span>资料名</span>
                      <input
                        className="training-input"
                        value={e.title}
                        placeholder={cfg.titleHint}
                        disabled={locked}
                        onChange={(ev) => patch(e.uid, { title: ev.target.value })}
                      />
                    </label>
                    <label className="kbe-field">
                      <span>{cfg.authorLabel}</span>
                      <input
                        className="training-input"
                        value={e.author}
                        placeholder="可空"
                        disabled={locked}
                        onChange={(ev) => patch(e.uid, { author: ev.target.value })}
                      />
                    </label>
                    <label className="kbe-field">
                      <span>日期</span>
                      <input
                        className="training-input"
                        type="date"
                        value={e.publishedAt}
                        disabled={locked}
                        onChange={(ev) => patch(e.uid, { publishedAt: ev.target.value })}
                      />
                    </label>
                    <label className="kbe-field">
                      <span>类别</span>
                      <select
                        className="training-input"
                        value={e.docCategory}
                        disabled={locked}
                        onChange={(ev) => patch(e.uid, { docCategory: ev.target.value })}
                      >
                        <option value="">未分类</option>
                        {cfg.kinds.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </label>
                    {fields.map((f) => (
                      <label className="kbe-field" key={f.key}>
                        <span>{f.label}</span>
                        {f.options ? (
                          <select
                            className="training-input"
                            value={e.extras[f.key] || ''}
                            disabled={locked}
                            onChange={(ev) =>
                              patch(e.uid, { extras: { ...e.extras, [f.key]: ev.target.value } })
                            }
                          >
                            <option value="">未填写</option>
                            {f.options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="training-input"
                            type={f.type === 'date' ? 'date' : 'text'}
                            placeholder={f.placeholder}
                            value={e.extras[f.key] || ''}
                            disabled={locked}
                            onChange={(ev) =>
                              patch(e.uid, { extras: { ...e.extras, [f.key]: ev.target.value } })
                            }
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="settings-card">
        <div className="ts-head">
          <h3>最近入库</h3>
          <div className="ts-status">
            <span className="lib-count">
              共 {records.length} 份，检索、预览与元数据修改请到「{cfg.label} · 资料检索」页
            </span>
          </div>
        </div>
        {records.length === 0 ? (
          <p className="settings-hint">还没有入库资料。</p>
        ) : (
          <div>
            {records.slice(0, 6).map((r) => (
              <div className="training-import-row kbe-recent-row" key={r.id}>
                <span className="mono">{r.id}</span>
                <span className="kbe-recent-title">{r.title || '未命名资料'}</span>
                <span>{r.docCategory || '未分类'}</span>
                <span>{r.extras?.domain || '—'}</span>
                <span>{r.publishedAt || '—'}</span>
                <button className="btn-ghost sm" onClick={() => api.app.openPath(r.pdfPath || '')}>
                  打开
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/**
 * 知识经验库·资料检索页
 * 左侧按关键词、类别与专属字段筛选，右侧内置 PDF 阅读器预览，并支持元数据补录与删除。
 */
export function KbeDocSearchPage({ category }: Props) {
  const cfg = kbeDocConfig(category);
  const filterField = cfg.fields.find((f) => f.filterInList);
  const { records, dir, exists, error, setError, refresh } = useKbeRecords(category);

  const [keyword, setKeyword] = useState('');
  const [kind, setKind] = useState('all');
  const [fieldFilter, setFieldFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  /** 元数据编辑草稿：null 表示未进入编辑 */
  const [draft, setDraft] = useState<{
    title: string;
    author: string;
    publishedAt: string;
    docCategory: string;
    extras: Record<string, string>;
  } | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2800);
  };

  useEffect(() => {
    setKeyword('');
    setKind('all');
    setFieldFilter('');
    setSelectedId(null);
    setDraft(null);
    setError('');
  }, [category, setError]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return records.filter((r) => {
      if (kind !== 'all' && (r.docCategory || '未分类') !== kind) return false;
      if (filterField && fieldFilter && (r.extras?.[filterField.key] || '') !== fieldFilter) return false;
      if (!kw) return true;
      return [r.title, r.author, r.id, r.sourceName, r.docCategory, ...Object.values(r.extras || {})]
        .map((x) => String(x || '').toLowerCase())
        .some((x) => x.includes(kw));
    });
  }, [records, keyword, kind, filterField, fieldFilter]);

  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  const startEdit = (r: KbeDocRecord) => {
    setDraft({
      title: r.title || '',
      author: r.author || '',
      publishedAt: r.publishedAt || '',
      docCategory: r.docCategory || '',
      extras: { ...(r.extras || {}) },
    });
  };

  const saveEdit = async () => {
    if (!selected || !draft) return;
    const res = await api.kbe.docUpdate({
      category,
      id: selected.id,
      title: draft.title,
      author: draft.author,
      publishedAt: draft.publishedAt,
      docCategory: draft.docCategory,
      extras: draft.extras,
    });
    if (!res.ok) {
      setError(res.message || '保存失败');
      return;
    }
    setDraft(null);
    await refresh();
    showToast('元数据已更新');
  };

  const removeRecord = async (r: KbeDocRecord) => {
    const ok = window.confirm(`确认删除「${r.title || r.id}」？\n归档 PDF 会一并移除，不可恢复。`);
    if (!ok) return;
    const res = await api.kbe.docDelete({ category, id: r.id });
    if (res.ok) {
      if (selectedId === r.id) setSelectedId(null);
      await refresh();
      showToast('已删除');
    } else {
      setError(res.message || '删除失败');
    }
  };

  return (
    <div className="test-search fmea-page training-page">
      <div className="settings-card">
        <div className="ts-head">
          <h3>{cfg.label} · 资料检索</h3>
          <div className="ts-status">
            <span className="chip">库内 {records.length}</span>
            <button className="btn-ghost sm" onClick={refresh}>
              刷新
            </button>
            <button className="btn-ghost sm" onClick={() => api.app.openPath(dir)}>
              打开归档目录
            </button>
          </div>
        </div>
        <div className="ts-toolbar">
          <input
            className="search-input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={`搜索资料名 / ${cfg.authorLabel} / 编号 / 类别 / 专属字段`}
          />
          <select className="tu-project" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">全部类别</option>
            {cfg.kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
            <option value="未分类">未分类</option>
          </select>
          {filterField && (
            <select
              className="tu-project"
              value={fieldFilter}
              onChange={(e) => setFieldFilter(e.target.value)}
              title={`按${filterField.label}筛选`}
            >
              <option value="">全部{filterField.label}</option>
              {filterField.options?.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          <span className="lib-count">筛选结果 {filtered.length} 份</span>
        </div>
        <div className="training-path">
          归档目录：<span className="mono">{dir || `\\\\10.1.1.245\\Knowledge & Experience Base\\${cfg.dirName}`}</span>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="settings-card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="fmea-body" style={{ gridTemplateColumns: '340px minmax(0, 1fr)', marginTop: 4 }}>
          <div className="fmea-list">
            {filtered.map((r) => (
              <div
                key={r.id}
                className={selectedId === r.id ? 'fmea-item active' : 'fmea-item'}
                onClick={() => {
                  setSelectedId(r.id);
                  setDraft(null);
                }}
              >
                <div className="fmea-item-top">
                  <span className="fmea-item-id">{r.id}</span>
                  <span className="fmea-cat">{r.docCategory || '未分类'}</span>
                  <span className="fmea-year">{r.publishedAt || '未记录日期'}</span>
                </div>
                <div className="fmea-item-part">{r.title || '未命名资料'}</div>
                <div className="kbe-badges">
                  {cfg.fields
                    .filter((f) => f.badge)
                    .map((f) => {
                      const v = r.extras?.[f.key];
                      return v ? (
                        <span key={f.key} className={`kbe-badge ${badgeTone(v)}`}>
                          {v}
                        </span>
                      ) : null;
                    })}
                </div>
                <div className="fmea-item-action">
                  {cfg.authorLabel}：{r.author || '未填写'}
                  {r.extras?.stdNo ? ` · ${r.extras.stdNo}` : ''} ·{' '}
                  {r.sourceFormat ? r.sourceFormat.toUpperCase() : 'PDF'}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="fmea-list-empty">
                {records.length === 0
                  ? exists
                    ? `${cfg.label}暂无资料，请到「${cfg.label}导入」页上传 PPT / Word / PDF`
                    : `共享目录中还没有「${cfg.label}」文件夹，请先创建后再导入`
                  : '没有匹配的资料，换个关键词或清除筛选'}
              </div>
            )}
          </div>

          <div className="fmea-detail">
            {!selected && (
              <div className="preview-empty">
                <div className="pe-icon">📄</div>
                <div className="pe-title">从左侧选中一份资料</div>
                <div className="pe-sub">
                  入库时已统一转为 PDF，可直接在这里翻阅。归档目录：
                  <span className="mono"> {dir || '\\\\10.1.1.245\\Knowledge & Experience Base'} </span>
                </div>
              </div>
            )}

            {selected && (
              <>
                <div className="fmea-detail-head">
                  <h3>{selected.title || '未命名资料'}</h3>
                  <div className="preview-meta">
                    <span className="chip">{selected.id}</span>
                    <span className="chip">类别：{selected.docCategory || '未分类'}</span>
                    {selected.author && (
                      <span className="chip">
                        {cfg.authorLabel}：{selected.author}
                      </span>
                    )}
                    {selected.publishedAt && <span className="chip">日期：{selected.publishedAt}</span>}
                    {cfg.fields.map((f) => {
                      const v = selected.extras?.[f.key];
                      return v ? (
                        <span className="chip" key={f.key}>
                          {f.label}：{v}
                        </span>
                      ) : null;
                    })}
                    {selected.createdByDisplay && <span className="chip">导入人：{selected.createdByDisplay}</span>}
                    <button className="btn-ghost sm" onClick={() => startEdit(selected)}>
                      编辑元数据
                    </button>
                    <button className="btn-ghost sm" onClick={() => api.app.openPath(selected.pdfPath || '')}>
                      用默认程序打开
                    </button>
                    <button
                      className="btn-ghost sm"
                      onClick={() => api.app.openPath((selected.pdfPath || '').replace(/[^\\/]+$/, ''))}
                    >
                      打开所在目录
                    </button>
                    <button className="btn-link danger sm" onClick={() => removeRecord(selected)}>
                      删除
                    </button>
                  </div>
                </div>

                {draft && (
                  <div className="kbe-edit">
                    <div className="kbe-edit-grid">
                      <label className="kbe-field kbe-span2">
                        <span>资料名</span>
                        <input
                          className="training-input"
                          value={draft.title}
                          placeholder={cfg.titleHint}
                          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                        />
                      </label>
                      <label className="kbe-field">
                        <span>{cfg.authorLabel}</span>
                        <input
                          className="training-input"
                          value={draft.author}
                          onChange={(e) => setDraft({ ...draft, author: e.target.value })}
                        />
                      </label>
                      <label className="kbe-field">
                        <span>日期</span>
                        <input
                          className="training-input"
                          type="date"
                          value={draft.publishedAt}
                          onChange={(e) => setDraft({ ...draft, publishedAt: e.target.value })}
                        />
                      </label>
                      <label className="kbe-field">
                        <span>类别</span>
                        <select
                          className="training-input"
                          value={draft.docCategory}
                          onChange={(e) => setDraft({ ...draft, docCategory: e.target.value })}
                        >
                          <option value="">未分类</option>
                          {cfg.kinds.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                      </label>
                      {cfg.fields.map((f) => (
                        <label className="kbe-field" key={f.key}>
                          <span>{f.label}</span>
                          {f.options ? (
                            <select
                              className="training-input"
                              value={draft.extras[f.key] || ''}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  extras: { ...draft.extras, [f.key]: e.target.value },
                                })
                              }
                            >
                              <option value="">未填写</option>
                              {f.options.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="training-input"
                              type={f.type === 'date' ? 'date' : 'text'}
                              placeholder={f.placeholder}
                              value={draft.extras[f.key] || ''}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  extras: { ...draft.extras, [f.key]: e.target.value },
                                })
                              }
                            />
                          )}
                        </label>
                      ))}
                    </div>
                    <div className="kbe-edit-actions">
                      <button className="btn-primary sm" onClick={saveEdit}>
                        保存
                      </button>
                      <button className="btn-ghost sm" onClick={() => setDraft(null)}>
                        取消
                      </button>
                    </div>
                  </div>
                )}

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
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
