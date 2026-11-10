import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CtrUser } from '../api';
import { IS_STANDARD } from '../edition';
import { KBE_FMEA } from '../report/db';
import {
  buildFmeaRecord,
  draftFromRecord,
  fmeaCardText,
  fmeaCsvFileName,
  fmeaRecordToCsv,
  fmeaSearchText,
  FMEA_FIELDS,
  FMEA_IMAGE_FIELDS,
  parseFmeaRecord,
  yearFromDate,
  validateFmeaDraft,
  type FmeaDraft,
  type FmeaRecord,
} from '../report/fmea';

interface Props {
  user: CtrUser;
  /** 跳到导入页（标准版不提供） */
  onOpenImport?: () => void;
}

interface FmeaFile {
  name: string;
  size: number;
  mtime: string;
  fullPath: string;
}

/** 年份：编号优先，其次记录时间 */
function recordYear(rec: FmeaRecord): number {
  const m = rec.id.match(/FM-(\d{4})/i);
  return m ? Number(m[1]) : yearFromDate(rec.recordDate);
}

function shortText(text: string, max = 60): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * FMEA 案例库检索
 * 左侧紧凑卡片列表（机种·部件 / 失效模式 / 措施摘要），右侧一屏看完整的失效链与对策。
 */
export function FmeaSearchPage({ user, onOpenImport }: Props) {
  const [files, setFiles] = useState<FmeaFile[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [cache, setCache] = useState<Record<string, FmeaRecord | null>>({});
  const [cacheBusy, setCacheBusy] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [machineFilter, setMachineFilter] = useState('all');
  const [partFilter, setPartFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<FmeaDraft | null>(null);
  const [editIssues, setEditIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const ping = await api.db.ping();
      setReachable(ping.reachable);
      const res = await api.db.list({ libType: 'fmea' });
      if (res.ok) setFiles(res.files || []);
      else setError(res.message || '读取 FMEA 库失败');
    } catch (e) {
      setError(`读取 FMEA 库失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 文件名之外的信息都在 Parquet 里，进页面后分批读取并缓存（每次 6 个，避免 UNC 并发过多）
  useEffect(() => {
    const todo = files.filter((f) => !(f.fullPath in cache));
    if (!todo.length) return;
    let cancelled = false;
    setCacheBusy(true);
    (async () => {
      for (let i = 0; i < todo.length; i += 6) {
        const batch = todo.slice(i, i + 6);
        const part = await Promise.all(
          batch.map(async (f) => {
            try {
              const res = await api.db.readText({ fullPath: f.fullPath });
              return [f.fullPath, res.ok && res.text ? parseFmeaRecord(res.text) : null] as const;
            } catch {
              return [f.fullPath, null] as const;
            }
          }),
        );
        if (cancelled) return;
        setCache((prev) => {
          const next = { ...prev };
          part.forEach(([k, v]) => {
            next[k] = v;
          });
          return next;
        });
      }
      if (!cancelled) setCacheBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [files, cache]);

  const loaded = useMemo(
    () =>
      files
        .map((file) => ({ file, rec: cache[file.fullPath] }))
        .filter((x): x is { file: FmeaFile; rec: FmeaRecord } => !!x.rec),
    [files, cache],
  );

  const machines = useMemo(
    () => Array.from(new Set(loaded.map((x) => x.rec.machine.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh')),
    [loaded],
  );
  const parts = useMemo(
    () => Array.from(new Set(loaded.map((x) => x.rec.part.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh')),
    [loaded],
  );
  const years = useMemo(
    () => Array.from(new Set(loaded.map((x) => recordYear(x.rec)))).sort((a, b) => b - a),
    [loaded],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return loaded
      .filter((x) => (machineFilter === 'all' ? true : x.rec.machine.trim() === machineFilter))
      .filter((x) => (partFilter === 'all' ? true : x.rec.part.trim() === partFilter))
      .filter((x) => (yearFilter === 'all' ? true : recordYear(x.rec) === Number(yearFilter)))
      .filter((x) => (kw ? fmeaSearchText(x.rec).includes(kw) : true))
      .sort((a, b) => {
        const ya = recordYear(a.rec);
        const yb = recordYear(b.rec);
        if (ya !== yb) return yb - ya;
        return b.rec.id.localeCompare(a.rec.id);
      });
  }, [loaded, keyword, machineFilter, partFilter, yearFilter]);

  const selected = selectedPath ? loaded.find((x) => x.file.fullPath === selectedPath) ?? null : null;
  const record = selected?.rec ?? null;

  // 列表刷新后（如升版保存）保持选中
  useEffect(() => {
    if (!selectedPath) return;
    if (!files.some((f) => f.fullPath === selectedPath)) setSelectedPath(null);
  }, [files, selectedPath]);

  const patchCache = useCallback((fullPath: string, rec: FmeaRecord) => {
    setCache((prev) => ({ ...prev, [fullPath]: rec }));
  }, []);

  /** 记录一次取用：复用次数 +1 后覆写原文件 */
  const markUsed = async () => {
    if (!record || !selected) return;
    setSaving(true);
    try {
      const next: FmeaRecord = { ...record, useCount: record.useCount + 1, updatedAt: new Date().toISOString() };
      const res = await api.fmea.write({
        record: next,
        fileName: selected.file.name,
        overwrite: true,
      });
      if (!res.ok) {
        setError(`取用记录失败：${res.message || '未知错误'}`);
        return;
      }
      patchCache(selected.file.fullPath, next);
      showToast(`已记录取用（第 ${next.useCount} 次）`);
    } finally {
      setSaving(false);
    }
  };

  const copyCard = async () => {
    if (!record) return;
    try {
      await navigator.clipboard.writeText(fmeaCardText(record));
      showToast('卡片内容已复制，可直接粘贴到设计说明或邮件');
    } catch {
      showToast('复制失败，请检查剪贴板权限');
    }
  };

  const downloadCsv = async () => {
    if (!record) return;
    const res = await api.file.save({
      defaultName: fmeaCsvFileName(record),
      content: fmeaRecordToCsv(record),
    });
    if (res.ok) showToast('CSV 已保存');
    else if (!res.canceled) showToast('保存 CSV 失败');
  };

  const removeRecord = async (file: FmeaFile) => {
    if (!window.confirm(`确定删除这条 FMEA 记录吗？\n\n${file.name}\n\n删除后无法恢复。`)) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.db.remove({ fullPath: file.fullPath });
      if (!res.ok) {
        setError(`删除失败：${res.message || '未知错误'}`);
        return;
      }
      if (selectedPath === file.fullPath) {
        setSelectedPath(null);
        setEditDraft(null);
      }
      setCache((prev) => {
        const next = { ...prev };
        delete next[file.fullPath];
        return next;
      });
      showToast('已删除该 FMEA 记录');
      await refresh();
    } catch (e) {
      setError(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    if (!record) return;
    setEditDraft(draftFromRecord(record));
    setEditIssues([]);
  };

  const saveEdit = async () => {
    if (!editDraft || !record || !selected) return;
    const v = validateFmeaDraft(editDraft);
    if (v.errors.length) {
      setEditIssues(v.errors.map((i) => i.message));
      return;
    }
    setSaving(true);
    try {
      const next = buildFmeaRecord(editDraft, {
        id: record.id,
        username: user.username,
        displayName: user.displayName,
        previous: record,
      });
      const res = await api.fmea.write({
        record: next,
        fileName: selected.file.name,
        overwrite: true,
      });
      if (!res.ok) {
        setError(`保存失败：${res.message || '未知错误'}`);
        return;
      }
      patchCache(selected.file.fullPath, next);
      setEditDraft(null);
      setEditIssues([]);
      showToast(`已保存修改（第 ${next.revision} 版）`);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const imageNote = (value: string) => (value ? <span className="fmea-image-note">原表含图片</span> : null);

  return (
    <div className="test-search fmea-page">
      <div className="settings-card">
        <div className="ts-head">
          <h3>FMEA 案例库</h3>
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
            <span className="chip">案例 {loaded.length}</span>
            {cacheBusy && <span className="chip">读取中…</span>}
            <button className="btn-ghost sm" onClick={refresh} disabled={busy}>
              {busy ? '刷新中…' : '刷新'}
            </button>
            {!IS_STANDARD && onOpenImport && (
              <button className="btn-primary sm" onClick={onOpenImport}>
                导入新案例
              </button>
            )}
          </div>
        </div>
        <div className="ts-toolbar">
          <input
            className="search-input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索失效模式 / 部件 / 材料 / 措施，例如：卡扣断裂、PP-T20"
          />
          <select className="tu-project" value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)}>
            <option value="all">全部机种</option>
            {machines.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select className="tu-project" value={partFilter} onChange={(e) => setPartFilter(e.target.value)}>
            <option value="all">全部部件</option>
            {parts.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select className="tu-project" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="all">全部年份</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y} 年
              </option>
            ))}
          </select>
          {(keyword || machineFilter !== 'all' || partFilter !== 'all' || yearFilter !== 'all') && (
            <button
              className="btn-link"
              onClick={() => {
                setKeyword('');
                setMachineFilter('all');
                setPartFilter('all');
                setYearFilter('all');
              }}
            >
              重置筛选
            </button>
          )}
          <span className="lib-count">筛选结果 {filtered.length} 条 · 点击左侧卡片查看完整失效链</span>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="fmea-body">
        <div className="fmea-list">
          {filtered.map(({ file, rec }) => (
            <div
              key={file.fullPath}
              className={selectedPath === file.fullPath ? 'fmea-item active' : 'fmea-item'}
              onClick={() => {
                setSelectedPath(file.fullPath);
                setEditDraft(null);
                setEditIssues([]);
              }}
            >
              <div className="fmea-item-top">
                <span className="fmea-item-id">{rec.id}</span>
                <span className="fmea-year">{recordYear(rec)} 年</span>
                {rec.useCount > 0 && <span className="fmea-use">取用 {rec.useCount}</span>}
              </div>
              <div className="fmea-item-part">
                {rec.machine || '通用'} · {rec.part || '未分类'}
              </div>
              <div className="fmea-item-mode">{shortText(rec.failureMode, 72)}</div>
              <div className="fmea-item-action">措施：{shortText(rec.action, 56)}</div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="fmea-list-empty">
              {files.length === 0
                ? IS_STANDARD
                  ? 'FMEA 案例库暂无记录，请联系管理员导入'
                  : 'FMEA 案例库暂无记录。到「FMEA 导入」把技术中心的案例表导入即可'
                : '没有匹配的案例，换个关键词或清除筛选'}
            </div>
          )}
        </div>

        <div className="fmea-detail">
          {!record && (
            <div className="preview-empty">
              <div className="pe-icon">◫</div>
              <div className="pe-title">从左侧选中一条 FMEA 案例</div>
              <div className="pe-sub">
                每条案例按「失效起因 → 失效模式 → 失效后果 → 建议措施」一屏展开。归档目录：
                <span className="mono"> {KBE_FMEA} </span>
              </div>
            </div>
          )}

          {record && !editDraft && (
            <>
              <div className="fmea-detail-head">
                <h3>
                  {record.machine || '通用'} · {record.part || '未分类'}
                </h3>
                <div className="preview-meta">
                  <span className="chip">{record.id}</span>
                  {record.material && <span className="chip">材料：{record.material}</span>}
                  {record.owner && <span className="chip">责任人：{record.owner}</span>}
                  {record.recordDate && <span className="chip">记录时间：{record.recordDate}</span>}
                  <span className="chip">取用 {record.useCount} 次</span>
                  <button className="btn-ghost sm" onClick={copyCard}>
                    复制卡片
                  </button>
                  <button className="btn-ghost sm" onClick={downloadCsv}>
                    下载 CSV
                  </button>
                  <button className="btn-ghost sm" onClick={markUsed} disabled={saving}>
                    取用（+1）
                  </button>
                  {!IS_STANDARD && (
                    <button className="btn-ghost sm" onClick={startEdit} disabled={saving}>
                      编辑
                    </button>
                  )}
                  <button
                    className="btn-link danger sm"
                    onClick={() => selected && removeRecord(selected.file)}
                    disabled={busy}
                  >
                    删除
                  </button>
                </div>
              </div>

              <div className="fmea-chain">
                <div className="fmea-chain-cell cause">
                  <div className="fmea-chain-label">① 失效起因 / 机理</div>
                  <div className="fmea-chain-text">{record.failureCause || '未填写'}</div>
                </div>
                <div className="fmea-arrow">→</div>
                <div className="fmea-chain-cell mode">
                  <div className="fmea-chain-label">② 失效模式</div>
                  <div className="fmea-chain-text">{record.failureMode}</div>
                  {imageNote(record.failureModeImage)}
                </div>
                <div className="fmea-arrow">→</div>
                <div className="fmea-chain-cell effect">
                  <div className="fmea-chain-label">③ 失效后果</div>
                  <div className="fmea-chain-text">{record.failureEffect || '未填写'}</div>
                </div>
              </div>

              <div className="fmea-block ok">
                <h4>建议的措施</h4>
                <p>{record.action}</p>
                {imageNote(record.actionImage)}
              </div>

              {record.remark && (
                <div className="fmea-block">
                  <h4>备注</h4>
                  <p>{record.remark}</p>
                </div>
              )}

              <div className="fmea-detail-foot">
                <span>来源：{record.sourceSheet || '手工录入'}</span>
                <span>录入：{record.createdByDisplay || record.createdBy || '—'}</span>
                <span>版本：第 {record.revision} 版</span>
                <span>更新：{record.updatedAt ? record.updatedAt.replace('T', ' ').slice(0, 19) : '—'}</span>
                <span className="mono">{KBE_FMEA}\{record.id}.parquet</span>
              </div>
            </>
          )}

          {record && editDraft && (
            <div className="fmea-edit">
              <div className="fmea-edit-head">
                <h3>修改 {record.id}</h3>
                <span className="small muted">保存后覆盖原卡片并升版，编号不变</span>
              </div>
              <div className="fmea-form-grid">
                {FMEA_FIELDS.map((f) => (
                  <label className={f.multiline ? 'field full' : 'field'} key={f.key}>
                    <span className="mat-field-label">
                      <span className="mat-field-name">{f.label}</span>
                      <span className="mat-field-unit">{f.hint || '\u00A0'}</span>
                    </span>
                    {f.multiline ? (
                      <textarea
                        rows={3}
                        value={editDraft[f.key]}
                        onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, [f.key]: e.target.value } : prev))}
                      />
                    ) : (
                      <input
                        value={editDraft[f.key]}
                        onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, [f.key]: e.target.value } : prev))}
                      />
                    )}
                  </label>
                ))}
                {FMEA_IMAGE_FIELDS.map((f) => (
                  <label className="field" key={f.key}>
                    <span className="mat-field-label">
                      <span className="mat-field-name">{f.label}</span>
                      <span className="mat-field-unit">选填，填写序号或说明</span>
                    </span>
                    <input
                      value={editDraft[f.key]}
                      onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, [f.key]: e.target.value } : prev))}
                    />
                  </label>
                ))}
              </div>
              {editIssues.length > 0 && (
                <div className="mat-edit-issues">
                  {editIssues.map((m) => (
                    <div key={m}>· {m}</div>
                  ))}
                </div>
              )}
              <div className="mat-edit-actions">
                <button className="btn-primary sm" onClick={saveEdit} disabled={saving}>
                  {saving ? '保存中…' : '保存修改'}
                </button>
                <button
                  className="btn-ghost sm"
                  onClick={() => {
                    setEditDraft(null);
                    setEditIssues([]);
                  }}
                  disabled={saving}
                >
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
