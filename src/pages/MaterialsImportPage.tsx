import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CtrUser } from '../api';
import { MaterialCurvePlot } from '../components/MaterialCurvePlot';
import {
  buildMaterialRecord,
  CURVE_LABEL,
  curveSummary,
  emptyDraft,
  FLUID_TABLE_HEADER,
  fluidFileName,
  porousFileName,
  fluidSummary,
  MATERIAL_CURVE_FIELDS,
  MATERIAL_FIELDS,
  MATERIAL_GROUP_ORDER,
  MATERIAL_STATE_LABEL,
  MATERIAL_TYPE_LABEL,
  materialFileName,
  materialTemplateCsv,
  parseCurveCsv,
  parseFluidCsv,
  parseMaterialCsv,
  parseMaterialFileName,
  parseMaterialRecord,
  parseMaterialXlsx,
  validateMaterialDraft,
  type FluidPoint,
  type MaterialCurve,
  type MaterialCurveKey,
  type MaterialDraft,
  type MaterialState,
  type MaterialType,
  type MaterialValidation,
} from '../report/material';
import { UNC_MATERIAL_LIB } from '../report/db';

interface Props {
  user: CtrUser;
}

interface MaterialEntry {
  id: string;
  draft: MaterialDraft;
  validation: MaterialValidation;
  fileName: string;
  conflict: boolean;
}

const uid = () => Math.random().toString(36).slice(2, 10);

function cloneDraft(d: MaterialDraft): MaterialDraft {
  return {
    ...d,
    stressStrainCurve: d.stressStrainCurve
      ? { ...d.stressStrainCurve, points: d.stressStrainCurve.points.map((p) => ({ ...p })) }
      : null,
    fatigueCurve: d.fatigueCurve
      ? { ...d.fatigueCurve, points: d.fatigueCurve.points.map((p) => ({ ...p })) }
      : null,
    fluidPoints: d.fluidPoints ? d.fluidPoints.map((p) => ({ ...p })) : null,
  };
}

function fieldLabel(key: string): string {
  if (key === 'stressStrainCurve' || key === 'fatigueCurve') return CURVE_LABEL[key];
  if (key === 'fluidPoints') return '流体属性表';
  for (const t of Object.keys(MATERIAL_FIELDS) as MaterialType[]) {
    const f = MATERIAL_FIELDS[t].find((x) => x.key === key);
    if (f) return f.label;
  }
  return key;
}

/** 生成归档文件名：流体=名称+牌号；超弹性材料在供应商前加入硬度段 */
function draftFileName(d: MaterialDraft): string {
  if (d.type === 'fluid') return fluidFileName(d.name.trim(), d.grade.trim());
  if (d.type === 'porous') return porousFileName(d.grade.trim());
  const hardness = d.type === 'hyperelastic' ? d.hardness.trim() : '';
  return materialFileName(
    d.grade.trim(),
    d.series.trim(),
    Number(d.temperature),
    d.supplier.trim(),
    hardness,
  );
}

/** 统一两行标签（名称 / 单位），保证同一行输入框顶端对齐 */
function FieldLabel({ label, unit, required }: { label: string; unit?: string; required?: boolean }) {
  return (
    <span className="mat-field-label">
      <span className="mat-field-name">
        {label}
        {required ? '（必填）' : ''}
      </span>
      <span className="mat-field-unit">{unit ? `（${unit}）` : '\u00A0'}</span>
    </span>
  );
}

/** 流体属性表预览（只读表格） */
function FluidTablePreview({ points }: { points: FluidPoint[] }) {
  return (
    <div className="mat-curve-table-wrap mat-table-lg">
      <table className="mat-curve-table">
        <thead>
          <tr>
            <th style={{ width: 56 }}>#</th>
            {FLUID_TABLE_HEADER.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{p.temperature}</td>
              <td>{p.density}</td>
              <td>{p.dynamicViscosity}</td>
              <td>{p.thermalConductivity}</td>
              <td>{p.specificHeat}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 材料库数据导入：补齐必填项 → 校验物性与曲线 → 归档为 Apache Parquet */
export function MaterialsImportPage({ user }: Props) {
  const [type, setType] = useState<MaterialType>('conventional');
  const [draft, setDraft] = useState<MaterialDraft>(() => emptyDraft('conventional'));
  const [entries, setEntries] = useState<MaterialEntry[]>([]);
  const [existing, setExisting] = useState<Array<{ name: string; fullPath: string }>>([]);
  const [detailIdx, setDetailIdx] = useState<number>(-1);
  const [formIssues, setFormIssues] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<'overwrite' | 'skip'>('overwrite');
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [pasteOpen, setPasteOpen] = useState<Record<string, boolean>>({});
  const [pasteText, setPasteText] = useState<Record<string, string>>({});

  const curveInputRef = useRef<HTMLInputElement | null>(null);
  const curveTarget = useRef<MaterialCurveKey>('stressStrainCurve');

  // 上下分区高度比例，支持鼠标拖动并记忆
  const [rowRatio, setRowRatio] = useState<number>(() => {
    const v = Number(window.localStorage.getItem('ctr.materialImportRowRatio'));
    return Number.isFinite(v) && v >= 0.25 && v <= 0.75 ? v : 0.6;
  });
  useEffect(() => {
    window.localStorage.setItem('ctr.materialImportRowRatio', String(rowRatio));
  }, [rowRatio]);

  const handleRowResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = e.currentTarget.parentElement as HTMLElement | null;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const startY = e.clientY;
      const startRatio = rowRatio;
      const minR = 0.25;
      const maxR = 0.75;
      const onMove = (ev: MouseEvent) => {
        const next = startRatio + (ev.clientY - startY) / rect.height;
        setRowRatio(Math.min(maxR, Math.max(minR, next)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [rowRatio],
  );

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2800);
  };

  const refreshExisting = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.db.list({ libType: 'material' });
      if (res.ok) setExisting(res.files || []);
      else setError(res.message || '读取材料库失败');
    } catch (e) {
      setError(`读取材料库失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refreshExisting();
  }, [refreshExisting]);

  const patch = (key: keyof MaterialDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const patchState = (value: MaterialState) => {
    setDraft((prev) => ({ ...prev, state: value }));
  };

  const switchType = (next: MaterialType) => {
    if (archiving) return;
    setType(next);
    setDraft(emptyDraft(next));
    setFormIssues([]);
    setError('');
  };

  /** 同牌号 + 系列号下已有的温度记录 */
  const existingTemps = useMemo(() => {
    const grade = draft.grade.trim().toLowerCase();
    const series = draft.series.trim().toLowerCase();
    if (!grade || !series) return [];
    const norm = (s: string) => s.trim().replace(/\s+/g, '').toLowerCase();
    return existing
      .map((f) => parseMaterialFileName(f.name))
      .filter((p) => p.type === type && norm(p.grade) === grade && norm(p.series) === series)
      .map((p) => p.temperature)
      .filter((t): t is number => t != null)
      .sort((a, b) => a - b);
  }, [draft.grade, draft.series, existing, type]);

  const conflictOf = (fileName: string) =>
    existing.some((f) => f.name.toLowerCase() === fileName.toLowerCase());

  const addEntry = () => {
    setFormIssues([]);
    const validation = validateMaterialDraft(draft);
    if (validation.errors.length) {
      setFormIssues(validation.errors.map((i) => `${fieldLabel(i.field)}：${i.message}`));
      showToast(`存在 ${validation.errors.length} 处错误，请先修正`);
      return;
    }
    const fileName = draftFileName(draft);
    setEntries((prev) => [
      ...prev,
      { id: uid(), draft: cloneDraft(draft), validation, fileName, conflict: conflictOf(fileName) },
    ]);
    showToast(
      type === 'fluid'
        ? `${draft.name} / ${draft.grade} 已加入预览`
        : type === 'porous'
          ? `${draft.grade} 已加入预览`
          : `${draft.grade} / ${draft.temperature} °C / ${MATERIAL_STATE_LABEL[draft.state]} 已加入预览`,
    );
    // 保留牌号、系列号与状态（流体保留名称与牌号；多孔介质每条独立，不保留），便于继续录入下一条
    setDraft(
      type === 'fluid'
        ? { ...emptyDraft(type), name: draft.name, grade: draft.grade }
        : type === 'porous'
          ? emptyDraft(type)
          : { ...emptyDraft(type), grade: draft.grade, series: draft.series, state: draft.state },
    );
    setPasteOpen({});
    setPasteText({});
  };

  const editEntry = (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    setType(entry.draft.type);
    setDraft(cloneDraft(entry.draft));
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setFormIssues([]);
    showToast('已载入表单，修改后重新加入预览');
  };

  const removeEntry = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));

  const setCurve = (key: MaterialCurveKey, curve: MaterialCurve | null) => {
    setDraft((prev) => ({ ...prev, [key]: curve }));
  };

  const applyCurveText = (key: MaterialCurveKey, text: string, sourceName?: string) => {
    const res = parseCurveCsv(text);
    if (res.error) {
      showToast(`曲线解析失败：${res.error}`);
      return;
    }
    setCurve(key, { sourceName: sourceName || '', points: res.points });
    showToast(`已解析 ${res.points.length} 个数据点`);
  };

  const onCurveFile = (key: MaterialCurveKey, file: File) => {
    const reader = new FileReader();
    reader.onload = () => applyCurveText(key, String(reader.result || ''), file.name);
    reader.onerror = () => showToast('曲线文件读取失败');
    reader.readAsText(file, 'utf-8');
  };

  const pickCurveFile = (key: MaterialCurveKey) => {
    curveTarget.current = key;
    curveInputRef.current?.click();
  };

  /** 流体属性表：应用解析结果（CSV / Excel / 粘贴三种入口共用） */
  const applyFluidTable = (
    res: { points: FluidPoint[]; warnings: string[]; error: string },
    target: 'form' | number,
  ) => {
    if (res.error) {
      showToast(`属性表解析失败：${res.error}`);
      return;
    }
    if (res.warnings.length) showToast(res.warnings[0]);
    const apply = (d: MaterialDraft): MaterialDraft => ({ ...d, fluidPoints: res.points });
    if (target === 'form') {
      setDraft((prev) => apply(prev));
    } else {
      setEntries((prev) => {
        const next = [...prev];
        const cur = { ...next[target], draft: apply(next[target].draft) };
        cur.validation = validateMaterialDraft(cur.draft);
        next[target] = cur;
        return next;
      });
    }
    showToast(`已解析 ${res.points.length} 行属性数据`);
  };

  const fluidFileRef = useRef<HTMLInputElement | null>(null);
  const fluidFileTarget = useRef<'form' | number>('form');

  const pickFluidFile = (target: 'form' | number) => {
    fluidFileTarget.current = target;
    fluidFileRef.current?.click();
  };

  /** 流体属性表文件：CSV 直接读文本，Excel 走 xlsx 解析 */
  const onFluidFile = async (file: File) => {
    const target = fluidFileTarget.current;
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      try {
        const parsed = await parseMaterialXlsx(file, 'fluid');
        if (parsed.error) {
          showToast(`属性表解析失败：${parsed.error}`);
          return;
        }
        const pts = parsed.drafts[0]?.fluidPoints || [];
        applyFluidTable({ points: pts, warnings: parsed.warnings || [], error: '' }, target);
      } catch (e) {
        showToast(`Excel 解析失败：${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => applyFluidTable(parseFluidCsv(String(reader.result || '')), target);
    reader.onerror = () => showToast('属性表文件读取失败');
    reader.readAsText(file, 'utf-8');
  };

  /** 批量导入：CSV 与 Excel 共用后续校验链 */
  const queueEntriesFromParsed = (
    parsed: { drafts: MaterialDraft[]; error: string; ignoredCurves: boolean; warnings?: string[] },
    sourceHint: string,
  ) => {
    if (parsed.error) {
      showToast(`解析失败：${parsed.error}`);
      return;
    }
    const added: MaterialEntry[] = [];
    let invalid = 0;
    parsed.drafts.forEach((d) => {
      const validation = validateMaterialDraft(d);
      // 批量导入统一按当前选择的 type 入库（覆盖文件里可能的类型暗示）
      d.type = type;
      const temp = Number(d.temperature);
      const complete =
        type === 'fluid'
          ? Boolean(d.name.trim() && d.grade.trim() && d.fluidPoints?.length)
          : type === 'porous'
            ? Boolean(d.grade.trim())
            : Boolean(d.grade.trim() && d.series.trim() && Number.isFinite(temp));
      if (validation.errors.length) invalid++;
      // 缺必填项的行也加入待入库预览，方便操作者在详情面板里补全后归档
      const fileName = complete
        ? draftFileName(d)
        : `（待补全）${d.grade.trim() || d.name.trim() || '材料'}`;
      added.push({
        id: uid(),
        draft: d,
        validation,
        fileName,
        conflict: complete ? conflictOf(fileName) : false,
      });
    });
    setEntries((prev) => {
      const next = [...prev, ...added];
      if (added.length && detailIdx < 0) {
        // 默认选中最新导入的第一条作为详情
        setTimeout(() => setDetailIdx(next.length - added.length), 0);
      }
      return next;
    });
    showToast(
      `${sourceHint}：解析 ${parsed.drafts.length} 行，加入 ${added.length} 行` +
        (invalid ? `，其中 ${invalid} 行待补全（详情面板中标红项需填写后才能归档）` : '') +
        (parsed.ignoredCurves ? '；曲线需单独上传' : '') +
        (parsed.warnings?.length ? `；${parsed.warnings.length} 行被跳过（${parsed.warnings[0]}）` : '') +
        `，按「${MATERIAL_TYPE_LABEL[type]}」入库`,
    );
  };

  const importCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = () =>
      queueEntriesFromParsed(parseMaterialCsv(String(reader.result || ''), type), 'CSV');
    reader.onerror = () => showToast('文件读取失败');
    reader.readAsText(file, 'utf-8');
  };

  const importXlsx = async (file: File) => {
    try {
      const parsed = await parseMaterialXlsx(file, type);
      queueEntriesFromParsed(parsed, 'Excel');
    } catch (e) {
      showToast(`Excel 解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const downloadTemplate = async (kind: 'csv' | 'xlsx') => {
    if (kind === 'csv') {
      const res = await api.file.save({
        defaultName: `材料库导入模板-${MATERIAL_TYPE_LABEL[type]}.csv`,
        content: materialTemplateCsv(type),
      });
      if (res.ok) showToast('CSV 模板已保存');
      return;
    }
    try {
      const XLSX = await import('xlsx');
      const rows = materialTemplateCsv(type)
        .split(/\r?\n/)
        .map((line) => line.split(','));
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '材料导入');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const res = await api.file.save({
        defaultName: `材料库导入模板-${MATERIAL_TYPE_LABEL[type]}.xlsx`,
        buffer: buf,
      });
      if (res.ok) showToast('Excel 模板已保存');
    } catch (e) {
      showToast(`模板生成失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const readExistingRecord = async (fileName: string) => {
    const file = existing.find((f) => f.name.toLowerCase() === fileName.toLowerCase());
    if (!file) return null;
    const res = await api.db.readText({ fullPath: file.fullPath });
    return res.ok && res.text ? parseMaterialRecord(res.text) : null;
  };

  const archiveAll = async () => {
    if (!entries.length || archiving) return;
    setArchiving(true);
    setError('');
    let ok = 0;
    let skipped = 0;
    let failed = 0;
    const remain: MaterialEntry[] = [];
    try {
      for (const entry of entries) {
        const validation = validateMaterialDraft(entry.draft);
        if (validation.errors.length) {
          failed++;
          remain.push(entry);
          continue;
        }
        if (entry.conflict && strategy === 'skip') {
          skipped++;
          continue;
        }
        const record = buildMaterialRecord(entry.draft, {
          username: user.username,
          displayName: user.displayName,
          previous: entry.conflict ? await readExistingRecord(entry.fileName) : null,
        });
        const res = await api.material.write({
          record,
          fileName: entry.fileName,
          overwrite: strategy === 'overwrite',
        });
        if (res.ok) {
          ok++;
        } else {
          failed++;
          remain.push(entry);
          setError(`归档失败：${entry.fileName} — ${res.message || '未知错误'}`);
        }
      }
      setEntries(remain);
      await refreshExisting();
      showToast(
        `入库完成：成功 ${ok} 条${skipped ? `，跳过 ${skipped} 条` : ''}${failed ? `，失败 ${failed} 条` : ''}`,
      );
    } catch (e) {
      setError(`归档异常：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setArchiving(false);
    }
  };

  const conflictCount = entries.filter((e) => e.conflict).length;
  const warningCount = entries.reduce((n, e) => n + e.validation.warnings.length, 0);

  return (
    <div className="test-page">
      <div className="lib-toolbar">
        <button
          className={type === 'conventional' ? 'btn-primary sm' : 'btn-ghost sm'}
          onClick={() => switchType('conventional')}
          disabled={archiving}
        >
          常规材料
        </button>
        <button
          className={type === 'hyperelastic' ? 'btn-primary sm' : 'btn-ghost sm'}
          onClick={() => switchType('hyperelastic')}
          disabled={archiving}
        >
          超弹性材料
        </button>
        <button
          className={type === 'fluid' ? 'btn-primary sm' : 'btn-ghost sm'}
          onClick={() => switchType('fluid')}
          disabled={archiving}
        >
          流体
        </button>
        <button
          className={type === 'porous' ? 'btn-primary sm' : 'btn-ghost sm'}
          onClick={() => switchType('porous')}
          disabled={archiving}
        >
          多孔介质
        </button>
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
        <label className={busy || archiving ? 'btn-ghost sm disabled' : 'btn-ghost sm'}>
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
        <div className="btn-group sm">
          <button className="btn-ghost sm" onClick={() => downloadTemplate('csv')} disabled={archiving}>
            下载 CSV 模板
          </button>
          <button className="btn-ghost sm" onClick={() => downloadTemplate('xlsx')} disabled={archiving}>
            下载 Excel 模板
          </button>
        </div>
        <span className="lib-count">
          批量导入按当前类型 →
          <span className={type === 'conventional' ? 'tag type-conv' : 'tag type-hyper'} style={{ marginLeft: 6 }}>
            {MATERIAL_TYPE_LABEL[type]}
          </span>
          {type === 'fluid'
            ? ' · 必填：名称、牌号 + 属性表'
            : type === 'porous'
              ? ' · 必填：牌号'
              : ' · 必填仅 3 项'}
        </span>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div
        className="test-page-rows"
        style={{ '--row-ratio': `${(rowRatio * 100).toFixed(2)}%` } as React.CSSProperties}
      >
        <div className="test-page-row">
      <div className="settings-card">
        <div className="pc-head">
          <h3>{MATERIAL_TYPE_LABEL[type]} · 单条录入</h3>
          {type === 'fluid' ? (
            <>
              <span className="tag">名称、牌号、属性表必填</span>
              <span className="tag light">属性表随文件导入：5 列，从第 2 行起读</span>
            </>
          ) : type === 'porous' ? (
            <>
              <span className="tag">牌号必填</span>
              <span className="tag light">孔径与阻力系数选填；批量导入按滤纸列表表头映射，每行一条</span>
            </>
          ) : (
            <>
              <span className="tag">牌号、系列号、温度必填</span>
              <span className="tag light">其余字段选填，留空表示无此参数</span>
            </>
          )}
        </div>

        <div className="mat-form-grid">
          {MATERIAL_GROUP_ORDER.filter((g) => g !== '曲线数据').map((group) => {
            const fields = MATERIAL_FIELDS[type].filter((f) => f.group === group);
            if (!fields.length) return null;
            return (
              <Fragment key={group}>
                <div className="mat-group-title">{group}</div>
                {fields.map((f) => (
                  <label className={f.required ? 'field mat-required' : 'field'} key={f.key}>
                    <FieldLabel label={f.label} unit={f.unit} required={f.required} />
                    <input
                      value={draft[f.key]}
                      placeholder={f.placeholder || '选填'}
                      onChange={(e) => patch(f.key, e.target.value)}
                    />
                  </label>
                ))}
                {group === '标识与来源' && (type === 'conventional' || type === 'hyperelastic') && (
                  <label className="field" key="state">
                    <FieldLabel label="状态" required />
                    <select
                      value={draft.state}
                      onChange={(e) => patchState(e.target.value as MaterialState)}
                    >
                      <option value="wet">{MATERIAL_STATE_LABEL.wet}</option>
                      <option value="dry">{MATERIAL_STATE_LABEL.dry}</option>
                    </select>
                  </label>
                )}
              </Fragment>
            );
          })}

          {type === 'fluid' && (
            <>
              <div className="mat-group-title">流体属性表</div>
              <div className="mat-curve-card">
                <div className="mat-curve-head">
                  <b>温度-物性表</b>
                  <span className={draft.fluidPoints?.length ? 'mat-curve-status ok' : 'mat-curve-status'}>
                    {draft.fluidPoints?.length ? `已导入 ${draft.fluidPoints.length} 行` : '未上传（必填）'}
                  </span>
                </div>
                <div className="mat-curve-actions">
                  <button className="btn-ghost sm" onClick={() => pickFluidFile('form')} disabled={archiving}>
                    上传 CSV / Excel
                  </button>
                  <button
                    className="btn-link"
                    onClick={() => setPasteOpen((prev) => ({ ...prev, fluidTable: !prev.fluidTable }))}
                  >
                    {pasteOpen.fluidTable ? '收起' : '粘贴数据'}
                  </button>
                  {draft.fluidPoints?.length ? (
                    <button
                      className="btn-link danger"
                      onClick={() => setDraft((prev) => ({ ...prev, fluidPoints: null }))}
                    >
                      清空
                    </button>
                  ) : null}
                  <span className="small muted">{fluidSummary(draft.fluidPoints)}</span>
                </div>
                {pasteOpen.fluidTable && (
                  <div className="mat-paste mat-paste-lg">
                    <textarea
                      value={pasteText.fluidTable || ''}
                      onChange={(e) => setPasteText((prev) => ({ ...prev, fluidTable: e.target.value }))}
                      placeholder={'温度(℃),密度(kg/m³),动力粘度(mPa·s),导热系数(W/(m·K)),比热(kJ/(kg·K))\n20,998.2,1.002,0.599,4.182\n40,992.2,0.653,0.631,4.179'}
                    />
                    <button
                      className="btn-ghost sm"
                      onClick={() => applyFluidTable(parseFluidCsv(pasteText.fluidTable || ''), 'form')}
                    >
                      解析粘贴内容
                    </button>
                  </div>
                )}
                {draft.fluidPoints?.length ? <FluidTablePreview points={draft.fluidPoints} /> : null}
                <div className="settings-hint small">
                  表格 5 列：{FLUID_TABLE_HEADER.join('、')}；从第 2 行起按列读取，遇到非数字行停止
                </div>
              </div>
            </>
          )}

          {(type === 'conventional' || type === 'hyperelastic') && (
            <div className="mat-group-title">曲线数据</div>
          )}
          {MATERIAL_CURVE_FIELDS[type].map((c) => {
            const curve = draft[c.key];
            return (
              <div className="mat-curve-card" key={c.key}>
                <div className="mat-curve-head">
                  <b>{c.label}</b>
                  <span className={curve?.points.length ? 'mat-curve-status ok' : 'mat-curve-status'}>
                    {curve?.points.length ? `已导入 ${curve.points.length} 点` : '未上传（选填）'}
                  </span>
                </div>
                <div className="mat-curve-actions">
                  <button className="btn-ghost sm" onClick={() => pickCurveFile(c.key)} disabled={archiving}>
                    上传 CSV
                  </button>
                  <button
                    className="btn-link"
                    onClick={() => setPasteOpen((prev) => ({ ...prev, [c.key]: !prev[c.key] }))}
                  >
                    {pasteOpen[c.key] ? '收起' : '粘贴数据'}
                  </button>
                  {curve?.points.length ? (
                    <button className="btn-link danger" onClick={() => setCurve(c.key, null)}>
                      清空
                    </button>
                  ) : null}
                  <span className="small muted">{curveSummary(curve, c.key)}</span>
                </div>
                {pasteOpen[c.key] && (
                  <div className="mat-paste">
                    <textarea
                      value={pasteText[c.key] || ''}
                      onChange={(e) => setPasteText((prev) => ({ ...prev, [c.key]: e.target.value }))}
                      placeholder={c.key === 'stressStrainCurve' ? '应变(%),应力(MPa)\n0,0\n2,150' : '寿命(cycles),应力(MPa)\n10000,220\n100000,180'}
                    />
                    <button
                      className="btn-ghost sm"
                      onClick={() => applyCurveText(c.key, pasteText[c.key] || '')}
                    >
                      解析粘贴内容
                    </button>
                  </div>
                )}
                {curve?.points.length ? <MaterialCurvePlot curve={curve} kind={c.key} /> : null}
                <div className="settings-hint small">{c.hint}</div>
              </div>
            );
          })}
        </div>

        {existingTemps.length > 0 && (
          <p className="settings-hint small" style={{ marginTop: 10 }}>
            库内「{draft.grade} / {draft.series}」已有温度：{existingTemps.map((t) => `${t} °C`).join('、')}
            ；不同温度将作为独立记录，温度相同才按冲突处理。
          </p>
        )}

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
              setDraft(emptyDraft(type));
              setFormIssues([]);
              setPasteText({});
            }}
            disabled={archiving}
          >
            清空表单
          </button>
        </div>
      </div>

        </div>

        <div
          className="test-page-split"
          onMouseDown={handleRowResize}
          title="按住上下拖动，调节上下区域高度"
        />

        <div className="test-page-row">
      <div className="settings-card">
        <div className="pc-head">
          <h3>待入库预览 ({entries.length})</h3>
          {conflictCount > 0 && <span className="tag light tag-warn">主键冲突 {conflictCount}</span>}
          {warningCount > 0 && <span className="tag light">提示 {warningCount}</span>}
          <label className="partial-check">
            冲突处理：
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as 'overwrite' | 'skip')}
            >
              <option value="overwrite">覆盖并保留历史版本</option>
              <option value="skip">跳过重复记录</option>
            </select>
          </label>
          <button
            className="btn-primary sm"
            onClick={archiveAll}
            disabled={archiving || entries.length === 0}
          >
            {archiving ? '入库中…' : `全部归档到材料库 (${entries.length})`}
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="test-empty">
            <h3>录入材料数据开始归档</h3>
            <p className="settings-hint">
              {type === 'fluid'
                ? '选择「流体」后填写名称与牌号（必填），并上传或粘贴 5 列属性表（温度、密度、动力粘度、导热系数、比热），从第 2 行起按列读取。'
                : type === 'porous'
                  ? '选择「多孔介质」后填写牌号（必填），孔径与 4 项阻力系数选填；也可用「批量导入 CSV / Excel」按滤纸列表表头一次导入多条（每行一条）。'
                  : '在上方选择材料类型，填写牌号、系列号与温度（必填），其余物性、曲线可按实际情况补全。曲线支持 CSV 上传或直接粘贴两列数据；也可用「批量导入 CSV」一次录入多条，曲线需在加入预览后单独上传。'}
              归档文件为「
              {type === 'fluid'
                ? '名称+牌号'
                : type === 'porous'
                  ? '牌号'
                  : `${MATERIAL_TYPE_LABEL[type]}+牌号+系列号+温度℃`}
              .parquet」，存放在
              <span className="mono"> {UNC_MATERIAL_LIB} </span>
              目录。
              {type === 'fluid'
                ? '同一名称 + 牌号视为同一记录。'
                : type === 'porous'
                  ? '同一牌号视为同一记录。'
                  : '同一牌号 + 系列号下的不同温度会分别保存。'}
            </p>
          </div>
        ) : (
          <div className="ts-list-wrap" style={{ marginTop: 8 }}>
            <table className="ts-list">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>类型</th>
                  <th style={{ width: '13%' }}>牌号</th>
                  <th style={{ width: '14%' }}>系列号</th>
                  <th style={{ width: 76 }}>温度</th>
                  <th style={{ width: '11%' }}>供应商</th>
                  <th style={{ width: '15%' }}>曲线</th>
                  <th style={{ width: '13%' }}>状态</th>
                  <th>归档文件名</th>
                  <th style={{ width: 96 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => (
                  <tr
                    key={entry.id}
                    className={detailIdx === idx ? 'active' : ''}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setDetailIdx(idx)}
                  >
                    <td>{MATERIAL_TYPE_LABEL[entry.draft.type]}</td>
                    <td>{entry.draft.type === 'fluid' ? entry.draft.name : entry.draft.grade}</td>
                    <td>{entry.draft.type === 'fluid' ? entry.draft.grade : entry.draft.series || '—'}</td>
                    <td>
                      {entry.draft.type === 'fluid' || entry.draft.type === 'porous'
                        ? '—'
                        : `${entry.draft.temperature} °C`}
                    </td>
                    <td>
                      {entry.draft.type === 'fluid' || entry.draft.type === 'porous'
                        ? '—'
                        : entry.draft.supplier || '—'}
                    </td>
                    <td className="small">
                      {entry.draft.type === 'fluid'
                        ? `属性表 ${entry.draft.fluidPoints?.length || 0} 行`
                        : entry.draft.type === 'porous'
                          ? '—'
                          : `σ-ε ${entry.draft.stressStrainCurve?.points.length || 0} 点 / S-N ${entry.draft.fatigueCurve?.points.length || 0} 点`}
                    </td>
                    <td>
                      {entry.conflict ? (
                        <span className="tag light tag-warn">
                          冲突 · {strategy === 'skip' ? '将跳过' : '将覆盖'}
                        </span>
                      ) : (
                        <span className="tag tag-ok">可入库</span>
                      )}
                      {entry.validation.warnings.length > 0 && (
                        <span className="tag light" style={{ marginTop: 2 }}>
                          {entry.validation.warnings.length} 条提示
                        </span>
                      )}
                    </td>
                    <td className="mono small">{entry.fileName}</td>
                    <td>
                      <button className="btn-link" onClick={() => editEntry(entry.id)} disabled={archiving}>
                        编辑
                      </button>
                      <button className="btn-link danger" onClick={() => removeEntry(entry.id)} disabled={archiving}>
                        移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {entries.some((e) => e.validation.warnings.length > 0) && (
          <p className="settings-hint small" style={{ marginTop: 8 }}>
            提示不阻止入库，例如未提供应力应变曲线时只能做线弹性计算；需要完整校核时请补充曲线后再归档。
          </p>
        )}

        {entries[detailIdx] && (
          <div className="settings-card" style={{ marginTop: 12 }}>
            <div className="pc-head">
              <h3>
                验证 & 修改 ·{' '}
                {entries[detailIdx].draft.type === 'fluid'
                  ? `${entries[detailIdx].draft.name} / ${entries[detailIdx].draft.grade}`
                  : entries[detailIdx].draft.type === 'porous'
                    ? entries[detailIdx].draft.grade
                    : `${entries[detailIdx].draft.grade} / ${entries[detailIdx].draft.series} / ${entries[detailIdx].draft.temperature} °C`}
              </h3>
              <span className={entries[detailIdx].conflict ? 'tag tag-warn' : 'tag tag-ok'}>
                {entries[detailIdx].conflict ? '冲突' : '可入库'}
              </span>
              {entries[detailIdx].validation.errors.length > 0 && (
                <span className="tag tag-danger">{entries[detailIdx].validation.errors.length} 处错误</span>
              )}
              {entries[detailIdx].validation.warnings.length > 0 && (
                <span className="tag light">{entries[detailIdx].validation.warnings.length} 条提示</span>
              )}
              <button className="btn-ghost sm" style={{ marginLeft: 'auto' }} onClick={() => editEntry(entries[detailIdx].id)}>
                在单条表单中编辑
              </button>
            </div>

            <div className="mat-form-grid">
              {MATERIAL_GROUP_ORDER.filter((g) => g !== '曲线数据').map((group) => {
                const fields = MATERIAL_FIELDS[entries[detailIdx].draft.type].filter((f) => f.group === group);
                if (!fields.length) return null;
                return (
                  <Fragment key={group}>
                    <div className="mat-group-title">{group}</div>
                    {fields.map((f) => (
                      <label className={f.required ? 'field mat-required' : 'field'} key={f.key}>
                        <FieldLabel label={f.label} unit={f.unit} required={f.required} />
                        <input
                          value={entries[detailIdx].draft[f.key as keyof MaterialDraft] as string}
                          placeholder={f.placeholder || '选填'}
                          onChange={(e) => {
                            const v = e.target.value;
                            setEntries((prev) => {
                              const next = [...prev];
                              const cur = { ...next[detailIdx], draft: { ...next[detailIdx].draft, [f.key]: v } };
                              cur.validation = validateMaterialDraft(cur.draft);
                              cur.fileName = draftFileName(cur.draft);
                              cur.conflict = existing.some((f0) => f0.name.toLowerCase() === cur.fileName.toLowerCase());
                              next[detailIdx] = cur;
                              return next;
                            });
                          }}
                        />
                      </label>
                    ))}
                    {group === '标识与来源' &&
                      (entries[detailIdx].draft.type === 'conventional' ||
                        entries[detailIdx].draft.type === 'hyperelastic') && (
                      <label className="field" key="state">
                        <FieldLabel label="状态" required />
                        <select
                          value={entries[detailIdx].draft.state}
                          onChange={(e) => {
                            const v = e.target.value as MaterialState;
                            setEntries((prev) => {
                              const next = [...prev];
                              const cur = { ...next[detailIdx], draft: { ...next[detailIdx].draft, state: v } };
                              cur.validation = validateMaterialDraft(cur.draft);
                              cur.fileName = draftFileName(cur.draft);
                              cur.conflict = existing.some((f0) => f0.name.toLowerCase() === cur.fileName.toLowerCase());
                              next[detailIdx] = cur;
                              return next;
                            });
                          }}
                        >
                          <option value="wet">{MATERIAL_STATE_LABEL.wet}</option>
                          <option value="dry">{MATERIAL_STATE_LABEL.dry}</option>
                        </select>
                      </label>
                    )}
                  </Fragment>
                );
              })}

              {entries[detailIdx].draft.type === 'fluid' && (
                <>
                  <div className="mat-group-title">流体属性表</div>
                  <div className="mat-curve-card">
                    <div className="mat-curve-head">
                      <b>温度-物性表</b>
                      <span
                        className={
                          entries[detailIdx].draft.fluidPoints?.length
                            ? 'mat-curve-status ok'
                            : 'mat-curve-status'
                        }
                      >
                        {entries[detailIdx].draft.fluidPoints?.length
                          ? `已导入 ${entries[detailIdx].draft.fluidPoints!.length} 行`
                          : '未上传（必填）'}
                      </span>
                    </div>
                    <div className="mat-curve-actions">
                      <button className="btn-ghost sm" onClick={() => pickFluidFile(detailIdx)} disabled={archiving}>
                        上传 CSV / Excel
                      </button>
                      <button
                        className="btn-link"
                        onClick={() => {
                          const pts = entries[detailIdx].draft.fluidPoints;
                          if (!pts?.length) return;
                          const text = pts
                            .map((p) =>
                              [p.temperature, p.density, p.dynamicViscosity, p.thermalConductivity, p.specificHeat].join(','),
                            )
                            .join('\n');
                          setPasteText((prev) => ({ ...prev, detailFluidTable: text }));
                          setPasteOpen((prev) => ({ ...prev, detailFluidTable: true }));
                        }}
                        disabled={!entries[detailIdx].draft.fluidPoints?.length}
                      >
                        转成粘贴
                      </button>
                      {entries[detailIdx].draft.fluidPoints?.length ? (
                        <button
                          className="btn-link danger"
                          onClick={() => {
                            setEntries((prev) => {
                              const next = [...prev];
                              const cur = { ...next[detailIdx], draft: { ...next[detailIdx].draft, fluidPoints: null } };
                              cur.validation = validateMaterialDraft(cur.draft);
                              next[detailIdx] = cur;
                              return next;
                            });
                          }}
                        >
                          清空
                        </button>
                      ) : null}
                      <span className="small muted">{fluidSummary(entries[detailIdx].draft.fluidPoints)}</span>
                    </div>
                    {pasteOpen.detailFluidTable && (
                      <div className="mat-paste mat-paste-lg">
                        <textarea
                          value={pasteText.detailFluidTable || ''}
                          onChange={(e) => setPasteText((prev) => ({ ...prev, detailFluidTable: e.target.value }))}
                          placeholder={'温度(℃),密度(kg/m³),动力粘度(mPa·s),导热系数(W/(m·K)),比热(kJ/(kg·K))\n20,998.2,1.002,0.599,4.182'}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="btn-ghost sm"
                            onClick={() => applyFluidTable(parseFluidCsv(pasteText.detailFluidTable || ''), detailIdx)}
                          >
                            应用粘贴
                          </button>
                          <button className="btn-link" onClick={() => setPasteOpen((prev) => ({ ...prev, detailFluidTable: false }))}>
                            收起
                          </button>
                        </div>
                      </div>
                    )}
                    {entries[detailIdx].draft.fluidPoints?.length ? (
                      <FluidTablePreview points={entries[detailIdx].draft.fluidPoints!} />
                    ) : null}
                    <div className="settings-hint small">
                      表格 5 列：{FLUID_TABLE_HEADER.join('、')}；从第 2 行起按列读取，遇到非数字行停止
                    </div>
                  </div>
                </>
              )}

              {(entries[detailIdx].draft.type === 'conventional' ||
                entries[detailIdx].draft.type === 'hyperelastic') && (
                <div className="mat-group-title">曲线数据</div>
              )}
              {MATERIAL_CURVE_FIELDS[entries[detailIdx].draft.type].map((c) => {
                const curve = entries[detailIdx].draft[c.key];
                return (
                  <div className="mat-curve-card" key={c.key}>
                    <div className="mat-curve-head">
                      <b>{c.label}</b>
                      <span className={curve?.points.length ? 'mat-curve-status ok' : 'mat-curve-status'}>
                        {curve?.points.length ? `已导入 ${curve.points.length} 点` : '未上传（选填）'}
                      </span>
                    </div>
                    <div className="mat-curve-actions">
                      <button className="btn-ghost sm" onClick={() => pickCurveFile(c.key)} disabled={archiving}>
                        上传 CSV
                      </button>
                      <button
                        className="btn-link"
                        onClick={() => {
                          if (!curve?.points.length) return;
                          const text = curve.points.map((p) => `${p.x},${p.y}`).join('\n');
                          setPasteText((prev) => ({ ...prev, [c.key]: text }));
                          setPasteOpen((prev) => ({ ...prev, [c.key]: true }));
                        }}
                        disabled={!curve?.points.length}
                      >
                        转成粘贴
                      </button>
                      {curve?.points.length ? (
                        <button className="btn-link danger" onClick={() => {
                          setEntries((prev) => {
                            const next = [...prev];
                            const cur = { ...next[detailIdx], draft: { ...next[detailIdx].draft, [c.key]: null } };
                            cur.validation = validateMaterialDraft(cur.draft);
                            next[detailIdx] = cur;
                            return next;
                          });
                        }}>
                          清空
                        </button>
                      ) : null}
                      <span className="small muted">{curveSummary(curve, c.key)}</span>
                    </div>
                    {pasteOpen[c.key] && (
                      <div className="mat-paste">
                        <textarea
                          value={pasteText[c.key] || ''}
                          onChange={(e) => setPasteText((prev) => ({ ...prev, [c.key]: e.target.value }))}
                          placeholder={c.key === 'stressStrainCurve' ? '应变(%),应力(MPa)\n0,0\n2,150' : '寿命(cycles),应力(MPa)\n10000,220\n100000,180'}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="btn-ghost sm"
                            onClick={() => {
                              const res = parseCurveCsv(pasteText[c.key] || '');
                              if (res.error) { showToast(`曲线解析失败：${res.error}`); return; }
                              setEntries((prev) => {
                                const next = [...prev];
                                const cur = { ...next[detailIdx], draft: { ...next[detailIdx].draft, [c.key]: { sourceName: '', points: res.points } } };
                                cur.validation = validateMaterialDraft(cur.draft);
                                next[detailIdx] = cur;
                                return next;
                              });
                              showToast(`已解析 ${res.points.length} 个数据点`);
                            }}
                          >
                            应用粘贴
                          </button>
                          <button className="btn-link" onClick={() => setPasteOpen((prev) => ({ ...prev, [c.key]: false }))}>
                            收起
                          </button>
                        </div>
                      </div>
                    )}
                    {curve?.points.length ? <MaterialCurvePlot curve={curve} kind={c.key} /> : null}
                    <div className="settings-hint small">{c.hint}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
        </div>
      </div>

      <input
        type="file"
        accept=".csv,.txt"
        hidden
        ref={curveInputRef}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onCurveFile(curveTarget.current, file);
        }}
      />

      <input
        type="file"
        accept=".csv,.txt,.xlsx,.xls"
        hidden
        ref={fluidFileRef}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFluidFile(file);
        }}
      />

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
