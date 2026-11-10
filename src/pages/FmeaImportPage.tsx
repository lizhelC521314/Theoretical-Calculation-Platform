import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CtrUser } from '../api';
import { KBE_FMEA } from '../report/db';
import {
  buildFmeaRecord,
  emptyFmeaDraft,
  fmeaFileName,
  fmeaTemplateCsv,
  FMEA_FIELDS,
  FMEA_IMAGE_FIELDS,
  nextFmeaId,
  normalizeRecordDate,
  parseFmeaCsv,
  parseFmeaXlsx,
  validateFmeaDraft,
  yearFromDate,
  type FmeaDraft,
  type FmeaParseResult,
  type FmeaValidation,
} from '../report/fmea';

interface Props {
  user: CtrUser;
}

interface FmeaEntry {
  uid: string;
  draft: FmeaDraft;
  sourceSheet: string;
  validation: FmeaValidation;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * FMEA 案例库导入
 * 批量导入技术中心的《FMEA 案例收集》Excel（多工作表自动合并），或手工录入一张卡片。
 * 入库时自动编号 FM-年份-序号，一张卡片一个 Parquet 文件。
 */
export function FmeaImportPage({ user }: Props) {
  const [draft, setDraft] = useState<FmeaDraft>(() => emptyFmeaDraft());
  const [entries, setEntries] = useState<FmeaEntry[]>([]);
  const [existing, setExisting] = useState<Array<{ name: string; fullPath: string }>>([]);
  const [detailIdx, setDetailIdx] = useState(-1);
  const [formIssues, setFormIssues] = useState<string[]>([]);
  const [importNote, setImportNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2800);
  };

  const refreshExisting = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.db.list({ libType: 'fmea' });
      if (res.ok) setExisting(res.files || []);
      else setError(res.message || '读取 FMEA 库失败');
    } catch (e) {
      setError(`读取 FMEA 库失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refreshExisting();
  }, [refreshExisting]);

  /** 默认记录时间填今天，减少一次输入 */
  useEffect(() => {
    setDraft((prev) => (prev.recordDate ? prev : { ...prev, recordDate: new Date().toISOString().slice(0, 10) }));
  }, []);

  const patch = (key: keyof FmeaDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const addEntry = () => {
    setFormIssues([]);
    const v = validateFmeaDraft(draft);
    if (v.errors.length) {
      setFormIssues(v.errors.map((i) => i.message));
      showToast(`存在 ${v.errors.length} 处必填项未填写`);
      return;
    }
    const entryDraft = { ...draft, recordDate: normalizeRecordDate(draft.recordDate) };
    setEntries((prev) => [
      ...prev,
      { uid: uid(), draft: entryDraft, sourceSheet: '手工录入', validation: validateFmeaDraft(entryDraft) },
    ]);
    showToast('已加入待入库预览');
    // 保留机种 / 部件，便于连续录入同一产品的多条失效
    setDraft({ ...emptyFmeaDraft(), machine: draft.machine, part: draft.part, recordDate: entryDraft.recordDate });
  };

  const removeEntry = (id: string) => setEntries((prev) => prev.filter((e) => e.uid !== id));

  const loadEntryToForm = (entry: FmeaEntry) => {
    setDraft({ ...entry.draft });
    setEntries((prev) => prev.filter((e) => e.uid !== entry.uid));
    setFormIssues([]);
    showToast('已载入表单，修改后重新加入预览');
  };

  /** 批量导入结果统一入预览 */
  const queueParsed = (res: FmeaParseResult, hint: string) => {
    if (!res.rows.length) {
      const reason = res.warnings[0] || '没有读到有效数据行';
      showToast(`${hint}解析失败：${reason}`);
      setImportNote(`${hint}：${reason}`);
      return;
    }
    const added: FmeaEntry[] = res.rows.map((r) => {
      const draftRow = { ...r.draft };
      return {
        uid: uid(),
        draft: draftRow,
        sourceSheet: r.sourceSheet,
        validation: validateFmeaDraft(draftRow),
      };
    });
    setEntries((prev) => {
      const next = [...prev, ...added];
      if (detailIdx < 0) window.setTimeout(() => setDetailIdx(next.length - added.length), 0);
      return next;
    });
    setImportNote(
      `${hint}：识别 ${res.rows.length} 条` +
        (res.skipped ? `，跳过 ${res.skipped} 行（空行 / 小节标题 / 示例行）` : '') +
        (res.warnings.length ? `；${res.warnings.join('；')}` : ''),
    );
    showToast(`${hint}：已加入 ${res.rows.length} 条待入库卡片`);
  };

  const importXlsx = async (file: File) => {
    setError('');
    try {
      queueParsed(await parseFmeaXlsx(file), 'Excel');
    } catch (e) {
      setError(`Excel 解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const importCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        queueParsed(parseFmeaCsv(String(reader.result || '')), 'CSV');
      } catch (e) {
        setError(`CSV 解析失败：${e instanceof Error ? e.message : String(e)}`);
      }
    };
    reader.onerror = () => setError('文件读取失败');
    reader.readAsText(file, 'utf-8');
  };

  const downloadTemplate = async (kind: 'csv' | 'xlsx') => {
    const content = fmeaTemplateCsv();
    if (kind === 'csv') {
      const res = await api.file.save({ defaultName: 'FMEA案例库导入模板.csv', content });
      if (res.ok) showToast('CSV 模板已保存');
      return;
    }
    try {
      const XLSX = await import('xlsx');
      const rows = content.split(/\r?\n/).map((line) => line.split(','));
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'FMEA案例');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const res = await api.file.save({ defaultName: 'FMEA案例库导入模板.xlsx', buffer: buf });
      if (res.ok) showToast('Excel 模板已保存');
    } catch (e) {
      showToast(`模板生成失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 入库预览里直接改：同步校验结果 */
  const patchEntry = (idx: number, key: keyof FmeaDraft, value: string) => {
    setEntries((prev) => {
      const next = [...prev];
      const cur = { ...next[idx] };
      cur.draft = { ...cur.draft, [key]: value };
      cur.validation = validateFmeaDraft(cur.draft);
      next[idx] = cur;
      return next;
    });
  };

  /** 分配编号并逐条写入 FMEA 库 */
  const archiveAll = async () => {
    if (!entries.length || archiving) return;
    setArchiving(true);
    setError('');
    const used = existing.map((f) => f.name);
    const remain: FmeaEntry[] = [];
    let ok = 0;
    let failed = 0;
    try {
      for (const entry of entries) {
        const v = validateFmeaDraft(entry.draft);
        if (v.errors.length) {
          failed++;
          remain.push({ ...entry, validation: v });
          continue;
        }
        const year = yearFromDate(entry.draft.recordDate);
        const id = nextFmeaId(used, year);
        const fileName = fmeaFileName(id);
        const record = buildFmeaRecord(entry.draft, {
          id,
          sourceSheet: entry.sourceSheet,
          username: user.username,
          displayName: user.displayName,
        });
        const res = await api.fmea.write({ record, fileName, overwrite: false });
        if (res.ok) {
          ok++;
          used.push(fileName);
        } else {
          failed++;
          remain.push(entry);
          setError(`入库失败：${fileName} — ${res.message || '未知错误'}`);
        }
      }
      setEntries(remain);
      if (remain.length === 0) setDetailIdx(-1);
      await refreshExisting();
      showToast(`入库完成：成功 ${ok} 张卡片${failed ? `，未入库 ${failed} 张` : ''}`);
    } catch (e) {
      setError(`入库异常：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setArchiving(false);
    }
  };

  const errorCount = useMemo(
    () => entries.filter((e) => e.validation.errors.length > 0).length,
    [entries],
  );
  const warnCount = useMemo(
    () => entries.reduce((n, e) => n + e.validation.warnings.length, 0),
    [entries],
  );

  return (
    <div className="test-page fmea-import">
      <div className="lib-toolbar">
        <label className={busy || archiving ? 'btn-primary sm disabled' : 'btn-primary sm'}>
          批量导入 Excel
          <input
            type="file"
            accept=".xlsx,.xls"
            hidden
            disabled={busy || archiving}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) importXlsx(f);
            }}
          />
        </label>
        <label className={busy || archiving ? 'btn-ghost sm disabled' : 'btn-ghost sm'}>
          批量导入 CSV
          <input
            type="file"
            accept=".csv,.txt"
            hidden
            disabled={busy || archiving}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) importCsv(f);
            }}
          />
        </label>
        <div className="btn-group sm">
          <button className="btn-ghost sm" onClick={() => downloadTemplate('csv')} disabled={archiving}>
            下载 CSV 模板
          </button>
          <button className="btn-ghost sm" onClick={() => downloadTemplate('xlsx')} disabled={archiving}>
            下载 Excel 模板
          </button>
        </div>
        <span className="lib-count">
          支持技术中心《FMEA 案例收集》原表：自动识别表头、合并多个工作表、跳过小节标题与示例行
        </span>
      </div>

      {error && <div className="login-error">{error}</div>}
      {importNote && <div className="settings-hint small">{importNote}</div>}

      <div className="settings-card">
        <div className="pc-head">
          <h3>单条录入 · 一张知识卡片</h3>
          <span className="tag">失效模式、建议措施必填</span>
          <span className="tag light">其余字段补齐后更利于检索</span>
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
                  value={draft[f.key]}
                  placeholder={f.hint || '选填'}
                  onChange={(e) => patch(f.key, e.target.value)}
                />
              ) : (
                <input
                  value={draft[f.key]}
                  placeholder={f.hint || '选填'}
                  onChange={(e) => patch(f.key, e.target.value)}
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
              <input value={draft[f.key]} onChange={(e) => patch(f.key, e.target.value)} placeholder="如：原表图 3" />
            </label>
          ))}
        </div>

        {formIssues.length > 0 && (
          <div className="login-error" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>
            {formIssues.join('\n')}
          </div>
        )}

        <div className="mat-form-actions">
          <button className="btn-primary sm" onClick={addEntry} disabled={archiving}>
            校验并加入预览
          </button>
          <button
            className="btn-ghost sm"
            onClick={() => {
              setDraft(emptyFmeaDraft());
              setFormIssues([]);
            }}
            disabled={archiving}
          >
            清空表单
          </button>
        </div>
      </div>

      <div className="settings-card">
        <div className="pc-head">
          <h3>待入库预览（{entries.length}）</h3>
          {errorCount > 0 && <span className="tag tag-danger">{errorCount} 张待补全</span>}
          {warnCount > 0 && <span className="tag light">提示 {warnCount} 条</span>}
          <button
            className="btn-primary sm"
            style={{ marginLeft: 'auto' }}
            onClick={archiveAll}
            disabled={archiving || entries.length === 0}
          >
            {archiving ? '入库中…' : `全部入库（${entries.length}）`}
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="test-empty">
            <h3>还没有待入库的卡片</h3>
            <p className="settings-hint">
              把《FMEA 案例收集》Excel 直接拖进「批量导入 Excel」，或在上面手工填写一条。入库后每张卡片自动编号
              （FM-年份-序号），保存为
              <span className="mono"> {KBE_FMEA} </span>
              下的独立 .parquet 文件，检索页即可按机种、部件、关键词查到。
            </p>
          </div>
        ) : (
          <div className="ts-list-wrap" style={{ marginTop: 8 }}>
            <table className="ts-list">
              <thead>
                <tr>
                  <th style={{ width: 64 }}>序号</th>
                  <th style={{ width: '13%' }}>机种</th>
                  <th style={{ width: '15%' }}>部件</th>
                  <th style={{ width: '24%' }}>失效模式</th>
                  <th style={{ width: '22%' }}>建议措施</th>
                  <th style={{ width: 88 }}>记录时间</th>
                  <th style={{ width: '10%' }}>来源</th>
                  <th style={{ width: 84 }}>状态</th>
                  <th style={{ width: 96 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => (
                  <tr
                    key={entry.uid}
                    className={detailIdx === idx ? 'active' : ''}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setDetailIdx(idx)}
                  >
                    <td>{idx + 1}</td>
                    <td>{entry.draft.machine || '—'}</td>
                    <td>{entry.draft.part || '—'}</td>
                    <td>{entry.draft.failureMode}</td>
                    <td>{entry.draft.action}</td>
                    <td className="small">{entry.draft.recordDate || '—'}</td>
                    <td className="small">{entry.sourceSheet}</td>
                    <td>
                      {entry.validation.errors.length ? (
                        <span className="tag light tag-warn">待补全 {entry.validation.errors.length}</span>
                      ) : (
                        <span className="tag tag-ok">可入库</span>
                      )}
                    </td>
                    <td>
                      <button className="btn-link" onClick={() => loadEntryToForm(entry)} disabled={archiving}>
                        载入
                      </button>
                      <button className="btn-link danger" onClick={() => removeEntry(entry.uid)} disabled={archiving}>
                        移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {entries[detailIdx] && (
          <div className="fmea-edit" style={{ marginTop: 12 }}>
            <div className="fmea-edit-head">
              <h3>补全 / 修改第 {detailIdx + 1} 张卡片</h3>
              {entries[detailIdx].validation.errors.length > 0 && (
                <span className="tag tag-danger">{entries[detailIdx].validation.errors.length} 处必填</span>
              )}
              {entries[detailIdx].validation.warnings.length > 0 && (
                <span className="tag light">{entries[detailIdx].validation.warnings.length} 条提示</span>
              )}
              <span className="small muted">改动实时校验，补全后即可入库</span>
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
                      value={entries[detailIdx].draft[f.key]}
                      onChange={(e) => patchEntry(detailIdx, f.key, e.target.value)}
                    />
                  ) : (
                    <input
                      value={entries[detailIdx].draft[f.key]}
                      onChange={(e) => patchEntry(detailIdx, f.key, e.target.value)}
                    />
                  )}
                </label>
              ))}
              {FMEA_IMAGE_FIELDS.map((f) => (
                <label className="field" key={f.key}>
                  <span className="mat-field-label">
                    <span className="mat-field-name">{f.label}</span>
                    <span className="mat-field-unit">选填</span>
                  </span>
                  <input
                    value={entries[detailIdx].draft[f.key]}
                    onChange={(e) => patchEntry(detailIdx, f.key, e.target.value)}
                  />
                </label>
              ))}
            </div>
            {entries[detailIdx].validation.issues.length > 0 && (
              <div className="mat-edit-issues">
                {entries[detailIdx].validation.issues.map((i) => (
                  <div key={`${i.field}-${i.message}`}>
                    · {i.level === 'error' ? '必填' : '提示'}：{i.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
