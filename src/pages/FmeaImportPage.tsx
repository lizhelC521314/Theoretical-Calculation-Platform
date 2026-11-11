import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CtrUser } from '../api';
import { FmeaImageInput } from '../components/FmeaImageInput';
import {
  analyzeImportedRecords,
  buildFmeaRecord,
  classifyProduct,
  emptyFmeaDraft,
  fillMissingStructured,
  fmeaFileName,
  fmeaTemplateCsv,
  FMEA_FIELDS,
  FMEA_IMAGE_FIELDS,
  nextFmeaIdV2,
  productCodes,
  normalizeRecordDate,
  parseFmeaCsv,
  parseFmeaXlsx,
  validateFmeaDraft,
  type FmeaDraft,
  type FmeaImportAnalysis,
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

/** 迁移提示清单里的分级指标 chip */
function MetricChip({
  level,
  count,
  total,
  label,
  hint,
}: {
  level: 'critical' | 'warn' | 'info' | 'good';
  count: number;
  total: number;
  label: string;
  hint?: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const cls = count === 0 ? 'good' : level;
  return (
    <div className={`ia-metric ia-metric-${cls}`} title={hint}>
      <span className="ia-metric-count">{count}</span>
      <span className="ia-metric-label">{label}</span>
      <span className="ia-metric-pct">{pct}%</span>
    </div>
  );
}

/**
 * FMEA库导入
 * 批量导入技术中心的《FMEA 案例收集》Excel（多工作表自动合并），或手工录入一张卡片。
 * 入库时自动编号：FM-{产品族A~J}-{部件A~Jxx}-{三位序号}-v{版本}，
 * 如 FM-A-A03-001-v01 = 空滤器总成 / 滤芯总成 / 第 1 条 / 第 1 版。
 * 历史旧格式 FM-年份-序号 也能正常读取。
 */
export function FmeaImportPage({ user }: Props) {
  const [draft, setDraft] = useState<FmeaDraft>(() => emptyFmeaDraft());
  const [entries, setEntries] = useState<FmeaEntry[]>([]);
  const [existing, setExisting] = useState<Array<{ name: string; fullPath: string }>>([]);
  const [detailIdx, setDetailIdx] = useState(-1);
  const [formIssues, setFormIssues] = useState<string[]>([]);
  const [importNote, setImportNote] = useState('');
  const [importAnalysis, setImportAnalysis] = useState<FmeaImportAnalysis | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
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

  /** 批量导入结果统一入预览 + 生成迁移提示清单 */
  const queueParsed = (res: FmeaParseResult, hint: string) => {
    if (!res.rows.length) {
      const reason = res.warnings[0] || '没有读到有效数据行';
      showToast(`${hint}解析失败：${reason}`);
      setImportNote(`${hint}：${reason}`);
      setImportAnalysis(null);
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
    setEntries((prev) => [...prev, ...added]);
    if (detailIdx < 0) setDetailIdx(entries.length);
    setImportNote(
      `${hint}：识别 ${res.rows.length} 条` +
        (res.skipped ? `，跳过 ${res.skipped} 行（空行 / 小节标题 / 示例行）` : '') +
        (res.warnings.length ? `；${res.warnings.join('；')}` : ''),
    );
    // 生成迁移提示清单（即使所有数据都合格，也展示产品族分布）
    const analysis = analyzeImportedRecords(res.rows, res.skipped);
    setImportAnalysis(analysis);
    setShowAnalysis(true);
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
      const res = await api.file.save({ defaultName: 'FMEA库导入模板.csv', content });
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
      const res = await api.file.save({ defaultName: 'FMEA库导入模板.xlsx', buffer: buf });
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
        // 新版编号：先自动归类 → 取产品族/部件代码 → 同桶内序号递增
        const cls = classifyProduct(entry.draft.part || entry.draft.system);
        const { family, part } = productCodes(cls.major, cls.minor);
        const id = nextFmeaIdV2(used, family, part, 1);
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

      {/* 导入迁移提示清单：Excel 解析后自动生成，帮助用户了解哪些条目需要补数据 */}
      {importAnalysis && importAnalysis.totalRows > 0 && (
        <div className="import-analysis">
          <div className="ia-head">
            <h4>
              导入质量清单
              <span className="ia-summary">共 {importAnalysis.totalRows} 条</span>
              {importAnalysis.skippedRows > 0 && (
                <span className="ia-summary muted">跳过 {importAnalysis.skippedRows} 行</span>
              )}
            </h4>
            <button
              type="button"
              className="btn-ghost sm"
              onClick={() => setShowAnalysis((v) => !v)}
              aria-expanded={showAnalysis}
            >
              {showAnalysis ? '收起' : '展开'}
            </button>
          </div>

          {/* 始终展示：产品族分布 */}
          <div className="ia-family">
            <span className="ia-family-label">产品族分布：</span>
            {importAnalysis.familyBreakdown.map((fb) => (
              <span
                key={fb.major}
                className={`ia-family-chip ${fb.major.startsWith('U') ? 'unclassified' : ''}`}
                title={fb.major}
              >
                {fb.major.replace(/^[A-JU]\s+/, '')} {fb.count}
              </span>
            ))}
          </div>

          {showAnalysis && (
            <>
              {/* 分级提示：critical / warn / info */}
              <div className="ia-metrics">
                <MetricChip
                  level="critical"
                  count={importAnalysis.missingRatings}
                  total={importAnalysis.totalRows}
                  label="缺 S/O/D 评分"
                  hint="缺失任一评分则无法自动算 AP 优先级，建议补全"
                />
                <MetricChip
                  level="warn"
                  count={importAnalysis.unclassifiedFamily}
                  total={importAnalysis.totalRows}
                  label="产品族未匹配"
                  hint="归入 U 未分类桶，建议在部件名称里填写更标准的名称（如 '空滤器滤芯总成'）"
                />
                <MetricChip
                  level="warn"
                  count={importAnalysis.unclassifiedMinor}
                  total={importAnalysis.totalRows}
                  label="产品小类未匹配"
                  hint="归入 XX 兜底桶，检索时会混入其他同大类的案例"
                />
                <MetricChip
                  level="warn"
                  count={importAnalysis.unmergedModeMaster}
                  total={importAnalysis.totalRows}
                  label="失效模式未归并"
                  hint="原文未能匹配标准词表（FMEA 库建设方案 §3.2），检索时可能遗漏同义词"
                />
                <MetricChip
                  level="warn"
                  count={importAnalysis.unmergedCauseMaster}
                  total={importAnalysis.totalRows}
                  label="失效原因未归并"
                  hint="同失效模式下因原因描述不同而分散，建议统一用词"
                />
                <MetricChip
                  level="info"
                  count={importAnalysis.missingRiskLevel}
                  total={importAnalysis.totalRows}
                  label="缺风险等级"
                  hint="可根据后果 + AP 自动推导，不强制要求"
                />
                <MetricChip
                  level="info"
                  count={importAnalysis.missingAction}
                  total={importAnalysis.totalRows}
                  label="缺建议措施"
                  hint="建议每条案例都补上，形成知识闭环"
                />
                <MetricChip
                  level="info"
                  count={importAnalysis.missingOwner}
                  total={importAnalysis.totalRows}
                  label="缺责任人"
                />
              </div>

              {/* 前 20 行有问题的明细 */}
              {importAnalysis.issues.length > 0 && (
                <div className="ia-issues">
                  <h5>问题行明细（前 {importAnalysis.issues.length} 条）</h5>
                  <ul>
                    {importAnalysis.issues.map((iss) => (
                      <li key={`${iss.sourceSheet}-${iss.rowNumber}-${iss.failureMode}`}>
                        <span className="ia-row-no">
                          {iss.sourceSheet}:{iss.rowNumber}
                        </span>
                        <span className="ia-row-mode">{iss.failureMode}</span>
                        <span className="ia-row-issues">
                          {iss.issues.map((i) => (
                            <span key={i} className="ia-row-tag">
                              {i}
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 全部合格时的鼓励提示 */}
              {importAnalysis.missingRatings === 0 &&
                importAnalysis.unclassifiedFamily === 0 &&
                importAnalysis.unmergedModeMaster === 0 &&
                importAnalysis.unmergedCauseMaster === 0 && (
                  <div className="ia-all-good">
                    ✓ 全部 {importAnalysis.totalRows} 条都匹配到了产品族、标准词表和 S/O/D 评分，可以直接入库
                  </div>
                )}
            </>
          )}
        </div>
      )}

      <div className="settings-card">
        <div className="pc-head">
          <h3>单条录入 · 一张知识卡片</h3>
          <span className="tag">失效模式、建议措施必填</span>
          <span className="tag light">其余字段补齐后更利于检索</span>
        </div>

        <div className="fmea-form-grid">
          {FMEA_FIELDS.map((f) => {
            const rawVal = draft[f.key];
            const val = String(rawVal ?? '');
            const opts = f.options;
            const isCustom = !!(f.allowCustom && opts && !opts.includes(val) && val);
            return (
              <label className={f.multiline ? 'field full' : 'field'} key={f.key}>
                <span className="mat-field-label">
                  <span className="mat-field-name">{f.label}</span>
                  <span className="mat-field-unit">{f.hint || '\u00A0'}</span>
                </span>
                {opts ? (
                  <>
                    <select
                      value={isCustom ? (opts ? opts[opts.length - 1] : '') : val}
                      onChange={(e) => {
                        const sel = e.target.value;
                        if (f.allowCustom && opts && sel === '自定义') {
                          // 切到自定义：保留原值做占位，操作者再在 text 框里改
                          patch(f.key, isCustom ? val : '');
                        } else {
                          patch(f.key, sel);
                        }
                      }}
                    >
                      <option value="">未填写</option>
                      {opts.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    {f.allowCustom && (isCustom || !val) && (
                      <input
                        className="mat-custom-input"
                        placeholder="自定义系统名称，如 燃油系统 / 进气歧管系统"
                        value={isCustom ? val : ''}
                        onChange={(e) => patch(f.key, e.target.value)}
                      />
                    )}
                  </>
                ) : f.multiline ? (
                  <textarea
                    rows={3}
                    value={val}
                    placeholder={f.hint || '选填'}
                    onChange={(e) => patch(f.key, e.target.value)}
                  />
                ) : (
                  <input
                    value={val}
                    placeholder={f.hint || '选填'}
                    onChange={(e) => patch(f.key, e.target.value)}
                  />
                )}
              </label>
            );
          })}
          {FMEA_IMAGE_FIELDS.map((f) => (
            <div className="field image" key={f.key}>
              <FmeaImageInput
                label={f.label}
                value={String(draft[f.key] ?? '')}
                onChange={(v) => patch(f.key, v)}
                placeholder="支持导入图片或 Ctrl+V 粘贴"
              />
            </div>
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
          {/* 一键补全：AP → 风险等级 → 结论 → 设计规避（只填空值） */}
          <button
            className="btn-ghost sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              let patchedRisk = 0;
              let patchedAp = 0;
              let patchedConclusion = 0;
              let patchedDesignGuide = 0;
              setEntries((prev) =>
                prev.map((e) => {
                  const patched = fillMissingStructured(e.draft);
                  if (patched.riskLevel && !e.draft.riskLevel) patchedRisk++;
                  if (patched.apLevel && !e.draft.apLevel) patchedAp++;
                  if (patched.conclusion && !e.draft.conclusion) patchedConclusion++;
                  if (patched.designGuide && !e.draft.designGuide) patchedDesignGuide++;
                  return { ...e, draft: patched, validation: validateFmeaDraft(patched) };
                }),
              );
              const parts: string[] = [];
              if (patchedAp) parts.push(`AP ${patchedAp}`);
              if (patchedRisk) parts.push(`风险等级 ${patchedRisk}`);
              if (patchedConclusion) parts.push(`结论 ${patchedConclusion}`);
              if (patchedDesignGuide) parts.push(`设计规避 ${patchedDesignGuide}`);
              if (!parts.length) {
                showToast('全部条目已填齐，无需补全');
              } else {
                showToast(`已自动补全 ${parts.join(' · ')}`);
              }
            }}
            disabled={archiving || entries.length === 0}
            title="按 AP→RPN→关键词三级推导补全空的风险等级，同时补 AP/结论/设计规避。不覆写已填值。"
          >
            ⚡ 一键补全缺失字段
          </button>
          <button
            className="btn-primary sm"
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
              把《FMEA 案例收集》Excel 直接拖进「批量导入 Excel」，或在上面手工填写一条。入库后每张卡片按产品族+部件自动编号
              （FM-A-A03-001-v01 这样），保存为共享盘「FMEA Library」目录下的独立 .parquet 文件，检索页即可按机种、部件、关键词查到。
              导入时自动清理「填写示例 / 责任人填写 / 插入图片」等占位行，并合并同机种、同部件、同失效模式、同原因的重复案例。
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
              {FMEA_FIELDS.map((f) => {
                const rawVal = entries[detailIdx].draft[f.key];
                const val = String(rawVal ?? '');
                const opts = f.options;
                const isCustom = !!(f.allowCustom && opts && !opts.includes(val) && val);
                return (
                  <label className={f.multiline ? 'field full' : 'field'} key={f.key}>
                    <span className="mat-field-label">
                      <span className="mat-field-name">{f.label}</span>
                      <span className="mat-field-unit">{f.hint || '\u00A0'}</span>
                    </span>
                    {opts ? (
                      <>
                        <select
                          value={isCustom ? (opts ? opts[opts.length - 1] : '') : val}
                          onChange={(e) => {
                            const sel = e.target.value;
                            if (f.allowCustom && opts && sel === '自定义') {
                              patchEntry(detailIdx, f.key, isCustom ? val : '');
                            } else {
                              patchEntry(detailIdx, f.key, sel);
                            }
                          }}
                        >
                          <option value="">未填写</option>
                          {opts.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                        {f.allowCustom && (isCustom || !val) && (
                          <input
                            className="mat-custom-input"
                            placeholder="自定义系统名称，如 燃油系统 / 进气歧管系统"
                            value={isCustom ? val : ''}
                            onChange={(e) => patchEntry(detailIdx, f.key, e.target.value)}
                          />
                        )}
                      </>
                    ) : f.multiline ? (
                      <textarea
                        rows={3}
                        value={val}
                        onChange={(e) => patchEntry(detailIdx, f.key, e.target.value)}
                      />
                    ) : (
                      <input
                        value={val}
                        onChange={(e) => patchEntry(detailIdx, f.key, e.target.value)}
                      />
                    )}
                  </label>
                );
              })}
              {FMEA_IMAGE_FIELDS.map((f) => (
                <div className="field image" key={f.key}>
                  <FmeaImageInput
                    label={f.label}
                    value={String(entries[detailIdx].draft[f.key] ?? '')}
                    onChange={(v) => patchEntry(detailIdx, f.key, v)}
                    placeholder="导入或 Ctrl+V 粘贴"
                  />
                </div>
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
