import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CtrUser } from '../api';
import { PdfViewer } from '../components/PdfViewer';
import { IS_STANDARD } from '../edition';
import { KBE_TRAINING } from '../report/db';
import type { TrainingRecord } from '../report/training';
import { TRAINING_CATEGORIES } from '../report/training';

interface Props {
  user: CtrUser;
  /** 跳到导入页（标准版不提供） */
  onOpenImport?: () => void;
}

/**
 * 培训资料检索
 * 按资料名 / 培训人 / 培训时间筛选，右侧直接预览归档 PDF。
 */
export function TrainingSearchPage({ onOpenImport }: Props) {
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [keyword, setKeyword] = useState('');
  const [trainer, setTrainer] = useState('all');
  const [category, setCategory] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{
    title: string;
    trainer: string;
    trainedAt: string;
    category: string;
  } | null>(null);
  const [toast, setToast] = useState('');

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
      const res = await api.training.list();
      if (res.ok) setRecords((res.records || []) as TrainingRecord[]);
      else setError(res.message || '读取培训资料失败');
    } catch (e) {
      setError(`读取培训资料失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const trainers = useMemo(
    () => Array.from(new Set(records.map((r) => r.trainer).filter(Boolean))).sort(),
    [records],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return records.filter((r) => {
      if (trainer !== 'all' && r.trainer !== trainer) return false;
      if (category !== 'all' && (r.category || '未分类') !== category) return false;
      if (from && (!r.trainedAt || r.trainedAt < from)) return false;
      if (to && (!r.trainedAt || r.trainedAt > to)) return false;
      if (!kw) return true;
      return `${r.title} ${r.trainer} ${r.sourceName} ${r.category || ''}`.toLowerCase().includes(kw);
    });
  }, [records, keyword, trainer, category, from, to]);

  const selected = filtered.find((r) => r.id === selectedId) || null;

  const startEdit = () => {
    if (!selected) return;
    setEditing({
      title: selected.title || '',
      trainer: selected.trainer || '',
      trainedAt: selected.trainedAt || '',
      category: selected.category || '',
    });
  };

  const saveEdit = async () => {
    if (!editing || !selected) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.training.update({
        id: selected.id,
        title: editing.title.trim(),
        trainer: editing.trainer.trim(),
        trainedAt: editing.trainedAt.trim(),
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
      const res = await api.training.delete({ id: selected.id });
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
          <h3>培训</h3>
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
            <button className="btn-ghost sm" onClick={() => api.app.openPath(KBE_TRAINING)}>
              打开归档目录
            </button>
            {!IS_STANDARD && onOpenImport && (
              <button className="btn-primary sm" onClick={onOpenImport}>
                导入培训资料
              </button>
            )}
          </div>
        </div>

        <div className="ts-toolbar">
          <input
            className="search-input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索培训资料名 / 培训人，例如：空滤器、张三"
          />
          <select className="tu-project" value={trainer} onChange={(e) => setTrainer(e.target.value)}>
            <option value="all">全部培训人</option>
            {trainers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select className="tu-project" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">全部类别</option>
            {TRAINING_CATEGORIES.map((c) => (
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
            title="培训时间起"
          />
          <span className="training-date-sep">至</span>
          <input
            className="training-input date"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            title="培训时间止"
          />
          {(keyword || trainer !== 'all' || category !== 'all' || from || to) && (
            <button
              className="btn-link"
              onClick={() => {
                setKeyword('');
                setTrainer('all');
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

      <div className="fmea-body">
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
                <span className="fmea-year">{r.trainedAt || '未记录时间'}</span>
              </div>
              <div className="fmea-item-part">{r.title || '未命名资料'}</div>
              <div className="fmea-item-action">
                培训人：{r.trainer || '未填写'} · {r.sourceFormat ? r.sourceFormat.toUpperCase() : 'PDF'}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="fmea-list-empty">
              {records.length === 0
                ? IS_STANDARD
                  ? '培训资料暂无记录，请联系管理员导入'
                  : '培训资料暂无记录。到「培训资料导入」上传讲义或课件即可'
                : '没有匹配的资料，换个关键词或清除筛选'}
            </div>
          )}
        </div>

        <div className="fmea-detail">
          {!selected && (
            <div className="preview-empty">
              <div className="pe-icon">🎓</div>
              <div className="pe-title">从左侧选中一份培训资料</div>
              <div className="pe-sub">
                所有资料入库时已统一转为 PDF，可直接在这里翻阅。归档目录：
                <span className="mono"> {KBE_TRAINING} </span>
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
                  {selected.trainer && <span className="chip">培训人：{selected.trainer}</span>}
                  {selected.trainedAt && <span className="chip">培训时间：{selected.trainedAt}</span>}
                  <button className="btn-ghost sm" onClick={() => api.app.openPath(selected.pdfPath || '')}>
                    用默认程序打开
                  </button>
                  <button
                    className="btn-ghost sm"
                    onClick={() => api.app.openPath((selected.pdfPath || '').replace(/[^\\/]+$/, ''))}
                  >
                    打开所在目录
                  </button>
                  {!IS_STANDARD && (
                    <button className="btn-ghost sm" onClick={startEdit} disabled={saving}>
                      编辑元数据
                    </button>
                  )}
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
                <h3>修改培训资料 {selected.id}</h3>
                <span className="small muted">只修改元数据，不会替换归档 PDF</span>
              </div>
              <div className="fmea-form-grid training-edit-grid">
                <label className="field full">
                  <span className="mat-field-label">
                    <span className="mat-field-name">培训资料名</span>
                    <span className="mat-field-unit">必填</span>
                  </span>
                  <input
                    value={editing.title}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                  />
                </label>
                <label className="field">
                  <span className="mat-field-label">
                    <span className="mat-field-name">培训人</span>
                    <span className="mat-field-unit"></span>
                  </span>
                  <input
                    value={editing.trainer}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, trainer: e.target.value } : prev))}
                  />
                </label>
                <label className="field">
                  <span className="mat-field-label">
                    <span className="mat-field-name">培训时间</span>
                    <span className="mat-field-unit"></span>
                  </span>
                  <input
                    type="date"
                    value={editing.trainedAt}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, trainedAt: e.target.value } : prev))}
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
                    {TRAINING_CATEGORIES.map((c) => (
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
