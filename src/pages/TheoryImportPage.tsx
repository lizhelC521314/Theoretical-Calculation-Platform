import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, isDesktop, type CtrUser } from '../api';
import { KBE_THEORY } from '../report/db';
import {
  parseTheoryFileName,
  todayTheoryDate,
  THEORY_ACCEPT,
  THEORY_CATEGORIES,
  type TheoryRecord,
} from '../report/theory';

interface Props {
  user: CtrUser;
}

interface Entry {
  uid: string;
  fileName: string;
  filePath: string;
  title: string;
  author: string;
  publishedAt: string;
  category: string;
  status: 'idle' | 'importing' | 'done' | 'error';
  message: string;
  recordId?: string;
}

interface EditForm {
  title: string;
  author: string;
  publishedAt: string;
  category: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * 知识理论导入
 * 支持 PPT / Word / PDF 多选，入库时统一转为 PDF；
 * 每条资料须填写资料名、作者、日期与理论类别。下方同时维护已入库资料的编辑与删除。
 */
export function TheoryImportPage({ user }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [records, setRecords] = useState<TheoryRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ title: '', author: '', publishedAt: '', category: '' });
  const [saving, setSaving] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2800);
  };

  const patch = (id: string, next: Partial<Entry>) => {
    setEntries((prev) => prev.map((e) => (e.uid === id ? { ...e, ...next } : e)));
  };

  const refresh = useCallback(async () => {
    try {
      const res = await api.theory.list();
      if (res.ok) setRecords((res.records || []) as TheoryRecord[]);
      else setError(res.message || '读取已入库资料失败');
    } catch (e) {
      setError(`读取已入库资料失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addFiles = useCallback((files: FileList | null) => {
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
      const parsed = parseTheoryFileName(f.name);
      next.push({
        uid: uid(),
        fileName: f.name,
        filePath,
        title: parsed.title,
        author: parsed.author,
        publishedAt: parsed.publishedAt || todayTheoryDate(),
        category: parsed.category,
        status: 'idle',
        message: '',
      });
    }
    if (next.length === 0) setError('未能获取文件路径，请重新选择');
    setEntries((prev) => [...prev, ...next]);
  }, []);

  const pending = useMemo(() => entries.filter((e) => e.status === 'idle' || e.status === 'error'), [entries]);
  const doneCount = entries.filter((e) => e.status === 'done').length;

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
      if (!e.author.trim()) {
        patch(e.uid, { status: 'error', message: '作者不能为空' });
        continue;
      }
      patch(e.uid, { status: 'importing', message: '正在转 PDF…' });
      try {
        const res = await api.theory.import({
          srcPath: e.filePath,
          title: e.title.trim(),
          author: e.author.trim(),
          publishedAt: e.publishedAt.trim(),
          category: e.category,
          createdBy: user.username,
          createdByDisplay: user.displayName,
        });
        if (!res.ok) {
          patch(e.uid, { status: 'error', message: res.message || '导入失败' });
          continue;
        }
        const rec = res.record as TheoryRecord | undefined;
        okCount += 1;
        patch(e.uid, {
          status: 'done',
          message: `已转为 PDF 并入库：${rec?.id || ''}`,
          recordId: rec?.id,
        });
      } catch (err) {
        patch(e.uid, { status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }
    setBusy(false);
    if (okCount) {
      await refresh();
      showToast(`已导入 ${okCount} 份知识理论资料`);
    }
  };

  const startEdit = (r: TheoryRecord) => {
    setEditId(r.id);
    setEditForm({
      title: r.title || '',
      author: r.author || '',
      publishedAt: r.publishedAt || '',
      category: r.category || '',
    });
  };

  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.theory.update({
        id: editId,
        title: editForm.title.trim(),
        author: editForm.author.trim(),
        publishedAt: editForm.publishedAt.trim(),
        category: editForm.category,
      });
      if (res.ok) {
        await refresh();
        setEditId(null);
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

  const removeRecord = async (r: TheoryRecord) => {
    const ok = window.confirm(`确认删除「${r.title || r.id}」？\n归档 PDF 会一并移除，不可恢复。`);
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.theory.delete({ id: r.id });
      if (res.ok) {
        if (editId === r.id) setEditId(null);
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
          <h3>知识理论导入</h3>
          <div className="ts-status">
            <span className="chip">待导入 {pending.length}</span>
            <span className="chip">本次已导入 {doneCount}</span>
            <span className="chip">库内 {records.length}</span>
            <button className="btn-ghost sm" onClick={() => api.app.openPath(KBE_THEORY)}>
              打开归档目录
            </button>
          </div>
        </div>

        <div className="ts-toolbar">
          <label className={busy ? 'btn-primary sm disabled' : 'btn-primary sm'}>
            选择资料
            <input
              type="file"
              accept={THEORY_ACCEPT}
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
          <span className="lib-count">
            支持 PPT / Word / PDF；导入后统一转为 PDF。请填写作者与日期，并选择理论类别
          </span>
        </div>
        <div className="training-path">
          归档目录：<span className="mono">{KBE_THEORY}</span>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="settings-card training-import-card">
        {entries.length === 0 ? (
          <div className="preview-empty">
            <div className="pe-icon">📖</div>
            <div className="pe-title">还没有选择资料</div>
            <div className="pe-sub">
              点击「选择资料」可一次选多份，系统会从文件名识别资料名、作者与日期，识别结果可在下方修改。
            </div>
          </div>
        ) : (
          <div className="training-import-list">
            <div className="training-import-head">
              <span>资料名</span>
              <span>作者</span>
              <span>日期</span>
              <span>类别</span>
              <span>源文件</span>
              <span>状态</span>
              <span />
            </div>
            {entries.map((e) => (
              <div className="training-import-row" key={e.uid}>
                <input
                  className="training-input"
                  value={e.title}
                  disabled={e.status === 'done' || e.status === 'importing'}
                  onChange={(ev) => patch(e.uid, { title: ev.target.value })}
                  placeholder="如 进气系统流阻分析"
                />
                <input
                  className="training-input"
                  value={e.author}
                  disabled={e.status === 'done' || e.status === 'importing'}
                  onChange={(ev) => patch(e.uid, { author: ev.target.value })}
                  placeholder="如 张三"
                />
                <input
                  className="training-input"
                  type="date"
                  value={e.publishedAt}
                  disabled={e.status === 'done' || e.status === 'importing'}
                  onChange={(ev) => patch(e.uid, { publishedAt: ev.target.value })}
                />
                <select
                  className="training-input"
                  value={e.category}
                  disabled={e.status === 'done' || e.status === 'importing'}
                  onChange={(ev) => patch(e.uid, { category: ev.target.value })}
                >
                  <option value="">未分类</option>
                  {THEORY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className="training-source" title={e.fileName}>
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
                  {e.status === 'idle' && '待导入'}
                  {e.status === 'importing' && e.message}
                  {e.status === 'done' && e.message}
                  {e.status === 'error' && e.message}
                </span>
                {e.status === 'idle' || e.status === 'error' ? (
                  <button
                    className="btn-link danger sm"
                    disabled={busy}
                    onClick={() => setEntries((prev) => prev.filter((x) => x.uid !== e.uid))}
                  >
                    移除
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="settings-card">
        <div className="ts-head">
          <h3>已入库资料</h3>
          <div className="ts-status">
            <span className="chip">共 {records.length} 份</span>
            <button className="btn-ghost sm" onClick={refresh} disabled={saving}>
              刷新
            </button>
          </div>
        </div>

        {records.length === 0 ? (
          <p className="settings-hint">知识理论库暂无资料，导入后会显示在这里，可直接编辑或删除。</p>
        ) : (
          <div className="training-import-list">
            <div className="training-import-head">
              <span>资料名</span>
              <span>作者</span>
              <span>日期</span>
              <span>类别</span>
              <span>编号 / 源文件</span>
              <span>操作</span>
              <span />
            </div>
            {records.map((r) =>
              editId === r.id ? (
                <div className="training-import-row" key={r.id}>
                  <input
                    className="training-input"
                    value={editForm.title}
                    onChange={(ev) => setEditForm((p) => ({ ...p, title: ev.target.value }))}
                  />
                  <input
                    className="training-input"
                    value={editForm.author}
                    onChange={(ev) => setEditForm((p) => ({ ...p, author: ev.target.value }))}
                  />
                  <input
                    className="training-input"
                    type="date"
                    value={editForm.publishedAt}
                    onChange={(ev) => setEditForm((p) => ({ ...p, publishedAt: ev.target.value }))}
                  />
                  <select
                    className="training-input"
                    value={editForm.category}
                    onChange={(ev) => setEditForm((p) => ({ ...p, category: ev.target.value }))}
                  >
                    <option value="">未分类</option>
                    {THEORY_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <span className="training-source">{r.id}</span>
                  <span className="training-state">
                    <button className="btn-primary sm" onClick={saveEdit} disabled={saving}>
                      保存
                    </button>
                    <button className="btn-ghost sm" onClick={() => setEditId(null)} disabled={saving}>
                      取消
                    </button>
                  </span>
                  <span />
                </div>
              ) : (
                <div className="training-import-row" key={r.id}>
                  <span className="training-source" title={r.title}>
                    {r.title || '未命名资料'}
                  </span>
                  <span className="training-source">{r.author || '—'}</span>
                  <span className="training-source">{r.publishedAt || '—'}</span>
                  <span className="training-source">{r.category || '未分类'}</span>
                  <span className="training-source" title={r.sourceName}>
                    {r.id} · {r.sourceName || '—'}
                  </span>
                  <span className="training-state">
                    <button className="btn-ghost sm" onClick={() => api.app.openPath(r.pdfPath || '')}>
                      打开
                    </button>
                    <button className="btn-ghost sm" onClick={() => startEdit(r)} disabled={saving}>
                      编辑
                    </button>
                  </span>
                  <button className="btn-link danger sm" onClick={() => removeRecord(r)} disabled={saving}>
                    删除
                  </button>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
