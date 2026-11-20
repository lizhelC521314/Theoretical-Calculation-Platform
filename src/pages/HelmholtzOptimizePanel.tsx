/**
 * 赫姆霍兹消音器 · AI 公式优化（中心频率 f0 标量对标）
 *
 * 依据《赫姆霍兹消音器中心频率公式自动优化实施方案》：
 *   H0 基准（δout=ψd，ψ=0.75，不标定，仅对照基线）
 *   H1 有效长度标定（δ_total，单参数；单点只能标定，不能发布为默认）
 *   H2 偏心/开口/插入修正（C0/ke/kh/kA，需 ≥6 独立工况）
 *   H3 模态耦合、H4 GP 残差（占位限域，不可运行）
 *
 * 与编织管 AiOptimizePage 共用同一套「草稿 → 审核 → 发布」记录存储（api.ai.*），
 * 记录按 formulaId 隔离，互不干扰。发布后由本组件 + App.tsx 注入到 helmholtzMuffler。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type CtrUser } from '../api';
import { calibrateScalar, type ScalarSample } from '../ai/calibration/runScalar';
import {
  HELMHOLTZ_MODEL_OPTIONS,
  HELMHOLTZ_H1_V1,
  type HelmholtzModelOption,
} from '../ai/calibration/strategies/helmholtzV1';
import {
  helmholtzInputs,
  helmholtzScalarModel,
  paramsToHelmholtzCalib,
} from '../ai/calibration/adapters/helmholtz';
import {
  evalHelmholtzSummary,
  getActiveHelmholtzCalib,
  setActiveHelmholtzCalib,
} from '../domains/acoustics/helmholtzMuffler';
import type {
  CalibrationRecord,
  CalibrationRecordStatus,
  CalibrationReport,
} from '../ai/calibration/types';

const FORMULA_ID = 'acoustics.muffler.helmholtz';
const FORMULA_VERSION = '3.0.0';
const H1_ACCEPT_RMSE_PCT = 5; // 实施方案 §9：H1 中心频率相对误差 ≤5%

/** 显示口径几何（mm / L / ℃ / mm²），与 helmholtzInputs 的输入契约一致 */
interface HGeom {
  D: number; // mm 主管内径
  d: number; // mm 颈部直径
  lc: number; // mm 颈部总长 Lt
  h: number; // mm 插入深度
  V: number; // L 净腔体容积
  t: number; // ℃ 温度
  e: number; // mm 偏心距
  am: number; // mm² 相贯开口面积
}

const DEFAULT_GEOM: HGeom = { D: 60, d: 25.09, lc: 62, h: 59.5, V: 1.5, t: 20, e: 12.5, am: 810.871 };

/** 一个标量样本 = 一个工况的几何 + 目标中心频率（实测 / CAE） */
interface HSample {
  id: string;
  label: string;
  geom: HGeom;
  target: number; // Hz
}

const STATUS_META: Record<CalibrationRecordStatus, { text: string; cls: string }> = {
  draft: { text: '草稿', cls: 'tag-draft' },
  reviewed: { text: '审核通过', cls: 'tag-reviewed' },
  released: { text: '已发布', cls: 'tag-released' },
  archived: { text: '已归档', cls: 'tag-archived' },
  rejected: { text: '已驳回', cls: 'tag-rejected' },
};

const fmt = (x: number | undefined | null, digits = 3): string => {
  if (x === undefined || x === null || !Number.isFinite(x)) return '—';
  return Number(x).toFixed(digits);
};

const newId = () => `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

interface Props {
  user: CtrUser;
  onBack?: () => void;
}

const GEOM_FIELDS: Array<{ key: keyof HGeom; label: string; step: number }> = [
  { key: 'D', label: '主管内径 D（mm）', step: 0.1 },
  { key: 'd', label: '颈部直径 d（mm）', step: 0.01 },
  { key: 'lc', label: '颈部总长 Lt（mm）', step: 0.1 },
  { key: 'h', label: '插入深度 h（mm）', step: 0.1 },
  { key: 'V', label: '净腔体容积 V（L）', step: 0.01 },
  { key: 't', label: '温度 t（℃）', step: 1 },
  { key: 'e', label: '偏心距 e（mm）', step: 0.1 },
  { key: 'am', label: '开口面积 Am（mm²）', step: 0.01 },
];

export default function HelmholtzOptimizePanel({ user }: Props) {
  const [step, setStep] = useState(1);
  const [modelKey, setModelKey] = useState<string>('H1');
  const [samples, setSamples] = useState<HSample[]>([
    { id: newId(), label: '当前工况（CAE）', geom: { ...DEFAULT_GEOM }, target: 119 },
  ]);
  /** 多样本时是否自动留出最后 30% 作独立验证集（否则只能"标定"不能发布） */
  const [holdoutOn, setHoldoutOn] = useState(true);
  /** 本次标定的训练 / 留出样本划分，用于结果页对齐样本标签 */
  const [split, setSplit] = useState<{ train: HSample[]; holdout: HSample[] } | null>(null);
  const [fast, setFast] = useState(true);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [baseline, setBaseline] = useState<
    Array<{ id: string; label: string; target: number; f0: number; leff: number; vc: number }> | null
  >(null);

  const [records, setRecords] = useState<CalibrationRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const opt: HelmholtzModelOption = useMemo(
    () => HELMHOLTZ_MODEL_OPTIONS.find((o) => o.key === modelKey) ?? HELMHOLTZ_MODEL_OPTIONS[1],
    [modelKey],
  );

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 2600);
  };

  /* ---------- 载入历史记录 + 恢复已发布系数 ---------- */
  useEffect(() => {
    api.ai
      .listCalibrations()
      .then((list) => {
        const mine = list.filter((r) => r.formulaId === FORMULA_ID);
        setRecords(mine);
        const released = mine.find((r) => r.status === 'released');
        if (released) {
          const map: Record<string, number> = {};
          for (const p of released.params) map[p.key] = p.value;
          setActiveHelmholtzCalib(paramsToHelmholtzCalib(map));
        }
      })
      .catch(() => undefined);
  }, []);

  const activeRecord = activeId ? records.find((r) => r.id === activeId) : undefined;

  /* ---------- 模型版本切换 ---------- */
  const selectModel = (key: string) => {
    setModelKey(key);
    setReport(null);
    setBaseline(null);
    setSplit(null);
    setRunError('');
    setStep(1);
  };

  /* ---------- 样本编辑 ---------- */
  const updateSample = (id: string, patch: Partial<HSample>) =>
    setSamples((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const updateSampleGeom = (id: string, key: keyof HGeom, value: number) =>
    setSamples((prev) =>
      prev.map((s) => (s.id === id ? { ...s, geom: { ...s.geom, [key]: value } } : s)),
    );
  const addSample = () =>
    setSamples((prev) => {
      const last = prev[prev.length - 1];
      return [
        ...prev,
        {
          id: newId(),
          label: `工况 ${prev.length + 1}`,
          geom: { ...(last?.geom ?? DEFAULT_GEOM) },
          target: last?.target ?? 120,
        },
      ];
    });
  const removeSample = (id: string) => setSamples((prev) => prev.filter((s) => s.id !== id));

  /* ---------- H0 基线计算（不标定） ---------- */
  const computeBaseline = () => {
    const rows = samples.map((s) => {
      const r = evalHelmholtzSummary(helmholtzInputs(s.geom));
      return { id: s.id, label: s.label, target: s.target, f0: r.f0, leff: r.lEff, vc: r.Vc };
    });
    setBaseline(rows);
    setReport(null);
    setSplit(null);
    setStep(2);
  };

  /* ---------- 运行标量标定（H1 / H2） ---------- */
  const runCalibration = async () => {
    if (!opt.runnable) return;
    const valid = samples.filter((s) => s.target > 0 && s.geom.d > 0 && s.geom.V > 0);
    if (valid.length === 0) {
      setRunError('至少需要一个目标 f0 > 0 且几何有效的样本');
      return;
    }
    // 多样本时按行序留出最后 30% 作独立验证集（训练集至少保留 2 个）
    let train = valid;
    let holdout: HSample[] = [];
    if (holdoutOn && valid.length >= 3) {
      const ratio = 1 - (opt.strategy.validation.trainRatio ?? 0.7);
      const k = Math.min(valid.length - 2, Math.max(1, Math.round(valid.length * ratio)));
      if (k > 0) {
        train = valid.slice(0, valid.length - k);
        holdout = valid.slice(valid.length - k);
      }
    }
    const toScalar = (s: HSample): ScalarSample => ({
      inputs: helmholtzInputs(s.geom),
      target: s.target,
      groupId: s.id,
    });
    setRunning(true);
    setRunError('');
    try {
      // H1：用首个样本几何的 0.75d 覆盖初值（实施方案 §6），保持 [min,max] 范围
      let strategy = opt.strategy;
      if (modelKey === 'H1' && train[0]) {
        const d0 = Math.max(1e-6, train[0].geom.d / 1000);
        const init = Math.min(0.03, Math.max(0, 0.75 * d0));
        strategy = {
          ...HELMHOLTZ_H1_V1,
          params: HELMHOLTZ_H1_V1.params.map((p) =>
            p.key === 'delta_total' ? { ...p, initial: init } : p,
          ),
        };
      }
      // 让 UI 先画出"运行中"
      await new Promise((r) => setTimeout(r, 0));
      const rep = await calibrateScalar({
        strategy,
        samples: train.map(toScalar),
        holdout: holdout.length > 0 ? holdout.map(toScalar) : undefined,
        model: helmholtzScalarModel,
        formulaVersion: FORMULA_VERSION,
        fast,
        targetLabel: '中心频率 f0',
        targetUnit: 'Hz',
      });
      setReport(rep);
      setBaseline(null);
      setSplit(holdout.length > 0 ? { train, holdout } : null);
      setStep(2);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  /* ---------- 记录保存 / 发布 ---------- */
  const saveRecords = async (next: CalibrationRecord[]) => {
    const res = await api.ai.saveCalibrations(next);
    if (!res.ok) {
      showToast(res.message ?? '保存失败');
      return false;
    }
    setRecords(next);
    return true;
  };

  const buildRecord = (status: CalibrationRecordStatus): CalibrationRecord | null => {
    if (!report) return null;
    const now = new Date().toISOString();
    const actor = user.displayName || user.username;
    const firstInputs = report.bands.find((b) => b.included) ? report.dataset.inputs : {};
    const s0 = split?.train[0] ?? samples[0];
    const record: CalibrationRecord = {
      id: activeRecord?.id ?? `cal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      formulaId: report.formula.id,
      formulaVersion: report.formula.version,
      strategyId: report.strategy.id,
      strategyVersion: report.strategy.version,
      datasetId: report.dataset.id,
      datasetHash: report.dataset.hash,
      source: 'xlsx',
      geometry: s0
        ? ({ D: s0.geom.D, L: s0.geom.lc, t: s0.geom.t, fp: s0.geom.d } as never)
        : ({} as never),
      inputs: firstInputs,
      params: report.params,
      metrics: report.metrics,
      warnings: report.warnings,
      report,
      note: `${note}（样本 ${report.bands.filter((b) => b.included).length} 个${
        split?.holdout.length ? `，留出验证 ${split.holdout.length} 个` : ''
      }）`,
      status,
      createdBy: activeRecord?.createdBy ?? actor,
      createdAt: activeRecord?.createdAt ?? now,
    };
    if (status === 'reviewed' || status === 'released') {
      record.reviewedBy = activeRecord?.reviewedBy ?? actor;
      record.reviewedAt = activeRecord?.reviewedAt ?? now;
    }
    if (status === 'released') {
      record.releasedBy = actor;
      record.releasedAt = now;
    }
    return record;
  };

  const upsert = async (status: CalibrationRecordStatus) => {
    const record = buildRecord(status);
    if (!record) return;
    let next = activeRecord
      ? records.map((r) => (r.id === record.id ? record : r))
      : [record, ...records];
    if (status === 'released') {
      next = next.map((r) =>
        r.id !== record.id && r.formulaId === FORMULA_ID && r.status === 'released'
          ? { ...r, status: 'archived' as CalibrationRecordStatus }
          : r,
      );
      const map: Record<string, number> = {};
      for (const p of record.params) map[p.key] = p.value;
      setActiveHelmholtzCalib(paramsToHelmholtzCalib(map));
    }
    if (await saveRecords(next)) {
      setActiveId(record.id);
      showToast(
        status === 'draft'
          ? '已保存草稿'
          : status === 'reviewed'
            ? '已标记审核通过，可发布'
            : '已发布，后续赫姆霍兹计算使用新系数',
      );
    }
  };

  const setRecordStatus = async (record: CalibrationRecord, status: CalibrationRecordStatus) => {
    const next = records.map((r) =>
      r.id === record.id
        ? { ...r, status, reviewedBy: user.displayName || user.username, reviewedAt: new Date().toISOString() }
        : r,
    );
    if (await saveRecords(next)) showToast('状态已更新');
  };

  const viewRecord = (record: CalibrationRecord) => {
    setReport(record.report);
    setActiveId(record.id);
    setNote(record.note);
    setSplit(null);
    setModelKey(
      HELMHOLTZ_MODEL_OPTIONS.find((o) => o.strategy.id === record.strategyId)?.key ?? 'H1',
    );
    setStep(2);
  };

  const removeRecord = async (record: CalibrationRecord) => {
    const next = records.filter((r) => r.id !== record.id);
    if (await saveRecords(next)) {
      if (activeId === record.id) setActiveId(null);
      showToast('已删除');
    }
  };

  /* ---------- Excel 导入：每行一个工况（几何 + 目标 f0）→ 样本 ---------- */
  const importExcel = async (file: File) => {
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const first = wb.SheetNames[0];
      if (!first) throw new Error('工作簿为空');
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[first], {
        header: 1,
        blankrows: false,
      }) as (string | number)[][];
      if (rows.length < 2) throw new Error('数据不足（需表头 + 至少一行）');
      // 自动定位表头行：含 f0/中心频率 的行
      let hRow = 0;
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        if ((rows[i] ?? []).some((c) => /f0|中心频率|center.*freq/i.test(String(c)))) {
          hRow = i;
          break;
        }
      }
      const header = (rows[hRow] ?? []).map((c) => String(c).trim().toLowerCase());
      const col = (re: RegExp) => header.findIndex((h) => re.test(h));
      const iD = col(/内径|^d$|\bd\b.*内/);
      const id = col(/颈部|喉径|^d$/);
      const ilc = col(/总长|lt|喉长|^lc$/);
      const ih = col(/插入|^h$/);
      const iV = col(/体积|容积|腔体|^v$/);
      const it = col(/温度|^t$/);
      const ie = col(/偏心|^e$/);
      const iam = col(/开口|am|相贯/);
      const if0 = col(/f0|中心频率|center/);
      const num = (r: (string | number)[], i: number, fallback: number): number => {
        if (i < 0) return fallback;
        const raw = r[i];
        if (raw === undefined || raw === null || raw === '') return fallback;
        const v = Number(raw);
        return Number.isFinite(v) ? v : fallback;
      };
      const imported: HSample[] = [];
      let skipped = 0;
      for (let r = hRow + 1; r < rows.length; r++) {
        const row = rows[r] ?? [];
        const f0 = num(row, if0, NaN);
        if (!Number.isFinite(f0) || f0 <= 0) {
          skipped++;
          continue;
        }
        imported.push({
          id: newId(),
          label: `${file.name}#${r - hRow}`,
          target: f0,
          geom: {
            D: num(row, iD, DEFAULT_GEOM.D),
            d: num(row, id, DEFAULT_GEOM.d),
            lc: num(row, ilc, DEFAULT_GEOM.lc),
            h: num(row, ih, DEFAULT_GEOM.h),
            V: num(row, iV, DEFAULT_GEOM.V),
            t: num(row, it, DEFAULT_GEOM.t),
            e: num(row, ie, DEFAULT_GEOM.e),
            am: num(row, iam, DEFAULT_GEOM.am),
          },
        });
      }
      if (imported.length === 0) throw new Error('未识别到有效 f0 数据列');
      setSamples(imported);
      setSplit(null);
      setReport(null);
      setBaseline(null);
      showToast(`已导入 ${imported.length} 个样本${skipped > 0 ? `，跳过 ${skipped} 行（无有效 f0）` : ''}`);
    } catch (err) {
      showToast(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /* ---------- 下载 Excel 模板：表头 + 当前首行样本 ---------- */
  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const header = [
      '主管内径 D',
      '颈部直径 d',
      '颈部总长 Lt',
      '插入深度 h',
      '净腔体体积 V',
      '温度 t',
      '偏心距 e',
      '开口面积 Am',
      '目标 f0 (Hz)',
    ];
    const s0 = samples[0];
    const g = s0?.geom ?? DEFAULT_GEOM;
    const row = [g.D, g.d, g.lc, g.h, g.V, g.t, g.e, g.am, s0?.target ?? 119];
    const ws = XLSX.utils.aoa_to_sheet([header, row]);
    ws['!cols'] = header.map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '样本');
    XLSX.writeFile(wb, '赫姆霍兹样本模板.xlsx');
  };

  /* ---------- 派生展示数据 ---------- */
  const activeCalib = getActiveHelmholtzCalib();
  const sampleRows = useMemo(() => {
    if (!report) return [];
    const paramMap: Record<string, number> = {};
    for (const p of report.params) paramMap[p.key] = p.value;
    const rows = split?.train ?? samples;
    return report.bands
      .filter((b) => b.included)
      .map((b, i) => {
        const s = rows[i];
        return {
          id: s?.id ?? b.center,
          label: s?.label ?? `样本 ${i + 1}`,
          target: b.test,
          model: b.model,
          residual: b.model - b.test,
          relPct: b.test ? ((b.model - b.test) / b.test) * 100 : 0,
          derived: s
            ? (() => {
                const d = helmholtzInputs(s.geom);
                return evalHelmholtzSummary(d, paramsToHelmholtzCalib(paramMap));
              })()
            : null,
        };
      });
  }, [report, samples, split]);

  /** 留出验证样本的逐条偏差（用标定后参数重算） */
  const holdoutRows = useMemo(() => {
    if (!report || !split) return [];
    const paramMap: Record<string, number> = {};
    for (const p of report.params) paramMap[p.key] = p.value;
    return split.holdout.map((s) => {
      const f0 = evalHelmholtzSummary(
        helmholtzInputs(s.geom),
        paramsToHelmholtzCalib(paramMap),
      ).f0;
      return {
        id: s.id,
        label: s.label,
        target: s.target,
        model: f0,
        relPct: s.target ? ((f0 - s.target) / s.target) * 100 : 0,
      };
    });
  }, [report, split]);

  const canRelease = !!report && report.validation.status === 'validated' && report.metrics.rmse <= H1_ACCEPT_RMSE_PCT;
  const releaseHint = !report
    ? ''
    : report.validation.status !== 'validated'
      ? samples.length >= 3
        ? '本次未使用独立验证集：请勾选「自动留出 30% 作独立验证」后重跑，或补充独立工况，方可发布（实施方案 §9）。'
        : '单点 / 无独立验证集：只能"标定"，不能发布为默认（实施方案 §9）。请增加 ≥2 个独立工况做验证。'
      : report.metrics.rmse > H1_ACCEPT_RMSE_PCT
        ? `RMSE ${fmt(report.metrics.rmse, 2)}% > ${H1_ACCEPT_RMSE_PCT}%，未达验收，不可发布。`
        : '';

  return (
    <div className="ai-page">
      {toast && <div className="ai-toast">{toast}</div>}

      {/* 步骤标签 */}
      <div className="ai-step-tabs">
        {[
          ['1', '样本数据'],
          ['2', '结果与记录'],
        ].map(([n, label]) => (
          <button
            key={n}
            className={`ai-tab${step === Number(n) ? ' active' : ''}`}
            onClick={() => setStep(Number(n))}
          >
            <b>{n}</b>
            {label}
          </button>
        ))}
      </div>

      {/* Step 1: 公式 + 模型版本 + 样本数据（几何与目标 f0 同表） */}
      {step === 1 && (
        <section className="settings-card">
          <div className="ai-sub-title">公式</div>
          <div className="kv">
            <span>公式</span>
            <b className="mono">
              {FORMULA_ID} · v{FORMULA_VERSION}
            </b>
          </div>
          {activeCalib.deltaTotal !== undefined || activeCalib.C0 !== undefined ? (
            <p className="settings-hint">
              当前已激活标定系数：
              {activeCalib.deltaTotal !== undefined && ` δ_total=${fmt(activeCalib.deltaTotal * 1000, 2)}mm`}
              {activeCalib.C0 !== undefined && ` C0=${fmt(activeCalib.C0, 3)}`}
              {activeCalib.ke !== undefined && ` ke=${fmt(activeCalib.ke, 3)}`}
              {activeCalib.kh !== undefined && ` kh=${fmt(activeCalib.kh, 3)}`}
              {activeCalib.kA !== undefined && ` kA=${fmt(activeCalib.kA, 3)}`}
              （未发布时不生效）
            </p>
          ) : (
            <p className="settings-hint">当前无已发布标定系数，公式按 H0 基准（δout=ψd，ψ=0.75）计算。</p>
          )}

          <div className="ai-sub-title">模型版本（依据实施方案第 3、4 节）</div>
          <div className="ai-model-tabs">
            {HELMHOLTZ_MODEL_OPTIONS.map((o) => (
              <button
                key={o.key}
                className={`ai-tab${modelKey === o.key ? ' active' : ''}${o.runnable ? '' : ' limited'}`}
                onClick={() => selectModel(o.key)}
                title={o.note}
              >
                {o.label}
                <span className="ai-tag">{o.status}</span>
              </button>
            ))}
          </div>
          <p className="settings-hint">{opt.note}</p>

          <div className="ai-sub-title">样本数据（每行一个样本：几何 + 实测 / CAE 中心频率 f0）</div>
          <p className="settings-hint">
            Excel 表头需包含：主管内径 D、颈部直径 d、颈部总长 Lt、插入深度 h、净腔体体积 V、温度 t、偏心距 e、
            开口面积 Am、目标 f0（Hz）；每行一个样本，可一次导入多个样本联合优化。
          </p>
          <div className="ai-actions">
            <button className="btn-ghost sm" onClick={() => fileRef.current?.click()}>
              导入 Excel…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importExcel(f);
                e.target.value = '';
              }}
            />
            <button className="btn-ghost sm" onClick={downloadTemplate}>
              下载模板
            </button>
            <button className="btn-ghost sm" onClick={addSample}>
              + 添加工况
            </button>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} />
              <span>快速模式（跳过 bootstrap，调试用）</span>
            </label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={holdoutOn}
                onChange={(e) => setHoldoutOn(e.target.checked)}
              />
              <span>自动留出 30% 作独立验证（≥3 个样本时生效）</span>
            </label>
          </div>

          <div className="ai-sample-scroll">
            <table className="ai-table">
              <thead>
                <tr>
                  <th>标签</th>
                  {GEOM_FIELDS.map((f) => (
                    <th className="num" key={f.key}>
                      {f.label.split('（')[0]}
                    </th>
                  ))}
                  <th className="num">目标 f0 (Hz)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <input
                        value={s.label}
                        onChange={(e) => updateSample(s.id, { label: e.target.value })}
                        style={{ width: 120 }}
                      />
                    </td>
                    {GEOM_FIELDS.map((f) => (
                      <td key={f.key}>
                        <input
                          type="number"
                          step={f.step}
                          value={s.geom[f.key]}
                          onChange={(e) => updateSampleGeom(s.id, f.key, Number(e.target.value))}
                          style={{ width: 72 }}
                        />
                      </td>
                    ))}
                    <td>
                      <input
                        type="number"
                        step={0.1}
                        value={s.target}
                        onChange={(e) => updateSample(s.id, { target: Number(e.target.value) })}
                        style={{ width: 80 }}
                      />
                    </td>
                    <td>
                      <button className="btn-ghost sm" onClick={() => removeSample(s.id)} disabled={samples.length <= 1}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ai-actions">
            {modelKey === 'H0' ? (
              <button className="btn-primary sm" onClick={computeBaseline} disabled={samples.length === 0}>
                计算 H0 基线
              </button>
            ) : opt.runnable ? (
              <button
                className="btn-primary sm"
                onClick={runCalibration}
                disabled={running || samples.length === 0}
              >
                {running ? '标定中…' : `开始 ${modelKey} 标定（${samples.length} 个样本）`}
              </button>
            ) : (
              <button className="btn-primary sm" disabled title={opt.note}>
                {modelKey} 不可运行（{opt.status}）
              </button>
            )}
          </div>
          {runError && <p className="settings-hint" style={{ color: '#c0392b' }}>{runError}</p>}
        </section>
      )}

      {/* Step 2: 结果与记录 */}
      {step === 2 && (
        <>
          {/* H0 基线视图 */}
          {baseline && (
            <section className="settings-card">
              <h3>H0 基线对照（δout=ψd，ψ=0.75，未标定）</h3>
              <table className="ai-table">
                <thead>
                  <tr>
                    <th>工况</th>
                    <th className="num">目标 f0 (Hz)</th>
                    <th className="num">H0 模型 f0 (Hz)</th>
                    <th className="num">相对误差</th>
                    <th className="num">leff (mm)</th>
                    <th className="num">Vc (L)</th>
                  </tr>
                </thead>
                <tbody>
                  {baseline.map((b) => (
                    <tr key={b.id}>
                      <td>{b.label}</td>
                      <td className="num">{fmt(b.target, 1)}</td>
                      <td className="num">{fmt(b.f0, 2)}</td>
                      <td className={`num${Math.abs(((b.f0 - b.target) / b.target) * 100) > 5 ? ' bad' : ''}`}>
                        {fmt(((b.f0 - b.target) / b.target) * 100, 2)}%
                      </td>
                      <td className="num">{fmt(b.leff * 1000, 2)}</td>
                      <td className="num">{fmt(b.vc * 1000, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="settings-hint">
                H0 仅作口径对照，不产生标定系数。当前工况 H0 ≈ 109.3 Hz（ψ=0.75）；若偏差大，请先核对长度/体积/开口三口径（实施方案 §2）。
              </p>
            </section>
          )}

          {/* 标定结果 */}
          {report && (
            <>
              <section className="settings-card">
                <h3>
                  标定结果 · {modelKey}
                  {activeRecord && (
                    <span className={STATUS_META[activeRecord.status].cls} style={{ marginLeft: 8 }}>
                      {STATUS_META[activeRecord.status].text}
                    </span>
                  )}
                </h3>
                <div className="ai-metrics">
                  {[
                    ['相对误差 RMSE', `${fmt(report.metrics.rmse, 3)}%`, report.metrics.rmse <= H1_ACCEPT_RMSE_PCT],
                    ['相对误差 MAE', `${fmt(report.metrics.mae, 3)}%`, report.metrics.mae <= H1_ACCEPT_RMSE_PCT],
                    ['最大单样本误差', `${fmt(report.metrics.maxAbsBandErr, 3)}%`, report.metrics.maxAbsBandErr <= 10],
                    ['样本数（训练）', String(report.bands.filter((b) => b.included).length), true],
                    ['条件数', fmt(report.diagnostics.conditionNumber, 2), report.diagnostics.conditionNumber < 1e8],
                    ['验证', report.validation.status === 'validated' ? '独立验证通过' : '仅标定（未验证）', report.validation.status === 'validated'],
                  ].map(([label, value, pass]) => (
                    <div className={`ai-metric${pass ? '' : ' bad'}`} key={String(label)}>
                      <div className="k">{label}</div>
                      <div className="v">{value}</div>
                    </div>
                  ))}
                </div>
                {report.validation.status === 'validated' && (
                  <p className="settings-hint">
                    {report.validation.note}：训练 RMSE {fmt(report.validation.trainRmse, 3)}%，留出 RMSE{' '}
                    {fmt(report.validation.holdoutRmse, 3)}%
                  </p>
                )}
                {report.warnings.length > 0 && (
                  <ul style={{ color: '#b7791f', marginTop: 8 }}>
                    {report.warnings.map((w, i) => (
                      <li key={i} className="small">{w}</li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="settings-card">
                <h3>训练样本 f0 对标</h3>
                <table className="ai-table">
                  <thead>
                    <tr>
                      <th>工况</th>
                      <th className="num">目标 f0 (Hz)</th>
                      <th className="num">模型 f0 (Hz)</th>
                      <th className="num">残差 (Hz)</th>
                      <th className="num">相对误差</th>
                      <th className="num">leff (mm)</th>
                      <th className="num">Vc (L)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sampleRows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.label}</td>
                        <td className="num">{fmt(r.target, 2)}</td>
                        <td className="num">{fmt(r.model, 3)}</td>
                        <td className="num">{fmt(r.residual, 3)}</td>
                        <td className={`num${Math.abs(r.relPct) > 5 ? ' bad' : ''}`}>{fmt(r.relPct, 3)}%</td>
                        <td className="num">{r.derived ? fmt(r.derived.lEff * 1000, 2) : '—'}</td>
                        <td className="num">{r.derived ? fmt(r.derived.Vc * 1000, 3) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {holdoutRows.length > 0 && (
                <section className="settings-card">
                  <h3>留出验证样本（未参与标定）</h3>
                  <table className="ai-table">
                    <thead>
                      <tr>
                        <th>工况</th>
                        <th className="num">目标 f0 (Hz)</th>
                        <th className="num">模型 f0 (Hz)</th>
                        <th className="num">相对误差</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdoutRows.map((r) => (
                        <tr key={r.id}>
                          <td>{r.label}</td>
                          <td className="num">{fmt(r.target, 2)}</td>
                          <td className="num">{fmt(r.model, 3)}</td>
                          <td className={`num${Math.abs(r.relPct) > H1_ACCEPT_RMSE_PCT ? ' bad' : ''}`}>
                            {fmt(r.relPct, 3)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="settings-hint">
                    按行序留出最后 30% 样本作独立验证；发布门槛按训练 RMSE 判定。
                  </p>
                </section>
              )}

              <section className="settings-card">
                <h3>标定参数</h3>
                <table className="ai-table">
                  <thead>
                    <tr>
                      <th>参数</th>
                      <th className="num">初值</th>
                      <th className="num">估值</th>
                      <th className="num">95% CI</th>
                      <th className="num">标准误</th>
                      <th>贴边</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.params.map((p) => (
                      <tr key={p.key}>
                        <td>
                          <div className="mono">{p.key}</div>
                          <div className="small">{p.label}</div>
                        </td>
                        <td className="num">{fmt(p.initial, 4)}</td>
                        <td className="num"><b>{fmt(p.value, 5)}</b></td>
                        <td className="num small">
                          [{fmt(p.ci95?.[0], 5)}, {fmt(p.ci95?.[1], 5)}]
                        </td>
                        <td className="num">{fmt(p.stdErr, 5)}</td>
                        <td className={p.atBound ? 'bad' : ''}>{p.atBound ? '是 ⚠' : '否'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="settings-card">
                <h3>保存与发布</h3>
                <textarea
                  placeholder="备注（工况来源 / 数据口径 / 审核意见）"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ width: '100%', minHeight: 56 }}
                />
                {releaseHint && <p className="settings-hint" style={{ color: '#b7791f' }}>{releaseHint}</p>}
                <div className="ai-actions">
                  <button className="btn-ghost sm" onClick={() => upsert('draft')}>
                    保存草稿
                  </button>
                  <button className="btn-ghost sm" onClick={() => upsert('reviewed')}>
                    标记审核通过
                  </button>
                  <button
                    className="btn-primary sm"
                    onClick={() => upsert('released')}
                    disabled={!canRelease}
                    title={releaseHint || '发布后将设为默认系数'}
                  >
                    发布为默认
                  </button>
                </div>
                <p className="settings-hint">
                  发布后系数注入到赫姆霍兹公式，后续计算自动采用；可在下方历史记录一键回退。
                </p>
              </section>
            </>
          )}

          {!report && !baseline && (
            <section className="settings-card">
              <p className="settings-hint">尚无结果，请返回第 1 步计算基线或开始标定。</p>
            </section>
          )}

          {/* 历史记录 */}
          <section className="settings-card">
            <h3>历史记录（草稿 → 审核 → 发布，同公式仅一个发布）</h3>
            {records.length === 0 ? (
              <p className="settings-hint">暂无记录。</p>
            ) : (
              <table className="ai-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>状态</th>
                    <th className="num">RMSE%</th>
                    <th>关键参数</th>
                    <th>创建</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => {
                    const meta = STATUS_META[r.status];
                    const keyParams = r.params
                      .slice(0, 4)
                      .map((p) => `${p.key}=${fmt(p.value, 4)}`)
                      .join('  ');
                    return (
                      <tr key={r.id} className={activeId === r.id ? 'ai-row-active' : ''}>
                        <td className="mono">
                          {HELMHOLTZ_MODEL_OPTIONS.find((o) => o.strategy.id === r.strategyId)?.key ?? '?'} · {r.strategyId}
                        </td>
                        <td>
                          <span className={meta.cls}>{meta.text}</span>
                        </td>
                        <td className={`num${r.metrics.rmse > H1_ACCEPT_RMSE_PCT ? ' bad' : ''}`}>{fmt(r.metrics.rmse, 3)}</td>
                        <td className="mono small">{keyParams}</td>
                        <td className="small">{r.createdBy} · {r.createdAt.slice(0, 10)}</td>
                        <td>
                          <button className="btn-ghost sm" onClick={() => viewRecord(r)}>加载</button>
                          {r.status !== 'released' && (
                            <button className="btn-ghost sm" onClick={() => setRecordStatus(r, 'archived')}>归档</button>
                          )}
                          <button className="btn-ghost sm" onClick={() => removeRecord(r)}>删除</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
