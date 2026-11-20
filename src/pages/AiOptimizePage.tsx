/**
 * AI · 公式优化
 *
 * 四步流程：选择公式与数据 → 字段映射 → 参数与算法 → 结果与采纳。
 * 计算直接调用 src/ai/calibration 的标定引擎（与命令行脚本、报告同一套算法）。
 * 结果走「草稿 → 审核 → 发布」链路，发布后由 App 注入到编织管公式，默认不覆盖内置系数。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type CtrUser } from '../api';
import type { LabSnapshot } from '../experiment/store';
import { calibrate, evaluateSourceMetrics, type SourceMetrics } from '../ai/calibration/run';
import {
  BRAID_M0_V1,
  BRAID_M1_V1,
  BRAID_STRUCTURE_V1,
} from '../ai/calibration/strategies/braidStructureV1';
import { wovenTubeModel, wovenTubeInputs } from '../ai/calibration/adapters/wovenTube';
import { renderFitChartSvg, renderResidualChartSvg, type ChartPoint } from '../ai/calibration/chart';
import { renderReportMarkdown } from '../ai/calibration/report';
import type {
  CalibrationDataset,
  CalibrationGeometry,
  CalibrationRecord,
  CalibrationRecordStatus,
  CalibrationReport,
  CalibrationStrategy,
} from '../ai/calibration/types';
import { setActiveWovenTubeCalib } from '../domains/acoustics/wovenTubeSilencer';
import HelmholtzOptimizePanel from './HelmholtzOptimizePanel';

interface Props {
  user: CtrUser;
  /** 返回工作台 / 上一级导航 */
  onBack?: () => void;
}

interface LabOption {
  id: string;
  label: string;
  sub: string;
  points: ChartPoint[];
}

interface WorkbookData {
  names: string[];
  sheets: Record<string, (string | number)[][]>;
}

/** 一份已导入的 Excel：原始内容 + 解析后的工作簿 */
interface XlsxFile {
  name: string;
  buffer: ArrayBuffer;
  workbook: WorkbookData;
}

interface AlgoSettings {
  huberDelta: number;
  lambda: number;
  lambdaPeak: number;
  starts: number;
  resamples: number;
  seed: number;
  fast: boolean;
}

const FORMULA_ID = 'acoustics.muffler.wovenTube';
const FORMULA_VERSION = '3.0.0';
/** 联合标定时各数据源曲线的配色（避开模型蓝与频带均值红） */
const SOURCE_COLORS = ['#7f8c8d', '#8e44ad', '#16a085', '#d35400', '#2d3436', '#a0522d', '#607d8b', '#827717'];
/** 导入数据归档目录 */
const TRAIN_CORE = '\\\\10.1.1.245\\ai\\TrainCore';

interface ArchiveState {
  status: 'idle' | 'saving' | 'ok' | 'error';
  dir?: string;
  message?: string;
}

const STATUS_META: Record<CalibrationRecordStatus, { text: string; cls: string }> = {
  draft: { text: '草稿', cls: 'tag' },
  reviewed: { text: '已审核', cls: 'tag tag-ok' },
  released: { text: '已发布', cls: 'tag ai-tag-released' },
  archived: { text: '已归档', cls: 'tag' },
  rejected: { text: '已驳回', cls: 'tag tag-warn' },
};

const columnLetter = (i: number): string => {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

/** 数据指纹（界面用；与命令行报告的原始文件 SHA256 区分） */
function hashPoints(points: ChartPoint[]): string {
  const s = points.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(';');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a-${h.toString(16).padStart(8, '0')}`;
}

/** 曲线抽稀：原始 1.5 Hz 分辨率的数千点只用于展示，保留形状即可 */
function decimate(points: ChartPoint[], max = 1200): ChartPoint[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: ChartPoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/** 按列映射解析一个工作表的有效点（x = 频率，y = TL） */
function parseSheetPoints(
  workbook: WorkbookData,
  sheetName: string,
  startRow: number,
  xCol: number,
  yCol: number,
): { pts: ChartPoint[]; skipped: number } {
  const rows = workbook.sheets[sheetName] ?? [];
  const pts: ChartPoint[] = [];
  let skipped = 0;
  for (let i = Math.max(0, startRow - 1); i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rawX = row[xCol];
    const rawY = row[yCol];
    if (
      rawX === undefined ||
      rawX === null ||
      rawX === '' ||
      rawY === undefined ||
      rawY === null ||
      rawY === ''
    ) {
      skipped++;
      continue;
    }
    const x = Number(rawX);
    const y = Number(rawY);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0) {
      skipped++;
      continue;
    }
    pts.push({ x, y });
  }
  return { pts, skipped };
}

/** 频率范围（Hz），无有效点时返回 null */
function pointsRange(points: ChartPoint[]): { lo: number; hi: number } | null {
  if (points.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (p.x < lo) lo = p.x;
    if (p.x > hi) hi = p.x;
  }
  return { lo, hi };
}

/** 联合数据集组数：id 形如 joint(N)，单数据集返回 0 */
function jointGroups(id: string): number {
  const m = /^joint\((\d+)\)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** 数据集展示文案：联合数据额外标注组数 */
function datasetTitle(
  ds: { id: string; points: number },
  sources?: Array<{ id: string; points: number }>,
): string {
  const n = sources?.length ?? jointGroups(ds.id);
  return n > 1 ? `${ds.id}（${n} 组联合，共 ${ds.points} 点）` : `${ds.id}（${ds.points} 点）`;
}

const fmt = (v: number | undefined, d = 3) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** 取参数最优值（非标定参数用策略初值补全） */
function fitValues(
  r: CalibrationReport,
  strategy: CalibrationStrategy,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const p of r.params) map[p.key] = p.value;
  for (const p of strategy.params) if (!(p.key in map)) map[p.key] = p.initial;
  return map;
}

/** M0 / M1 / M2 模型版本 → 策略 */
const MODEL_STRATEGIES: Record<'M0' | 'M1' | 'M2', CalibrationStrategy> = {
  M0: BRAID_M0_V1,
  M1: BRAID_M1_V1,
  M2: BRAID_STRUCTURE_V1,
};

export function AiOptimizePage({ user, onBack }: Props) {
  const [step, setStep] = useState(1);
  const [toast, setToast] = useState('');
  const [formulaId, setFormulaId] = useState<
    'acoustics.muffler.wovenTube' | 'acoustics.muffler.helmholtz'
  >('acoustics.muffler.wovenTube');

  /* ---------- 数据源 ---------- */
  const [source, setSource] = useState<'lab' | 'xlsx'>('lab');
  const [labOptions, setLabOptions] = useState<LabOption[]>([]);
  const [labLoading, setLabLoading] = useState(false);
  const [labError, setLabError] = useState('');
  const [labIds, setLabIds] = useState<string[]>([]);
  const [xlsxFiles, setXlsxFiles] = useState<XlsxFile[]>([]);
  const [fileError, setFileError] = useState('');
  const [archive, setArchive] = useState<ArchiveState>({ status: 'idle' });
  const archivedSig = useRef('');
  const [sheet, setSheet] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [startRow, setStartRow] = useState(2);
  const [xCol, setXCol] = useState(0);
  const [yCol, setYCol] = useState(1);

  /* ---------- 公式输入与算法 ---------- */
  const [geometry, setGeometry] = useState<CalibrationGeometry>({ D: 50, L: 300, t: 2.7, fp: 1400 });
  const [modelVersion, setModelVersion] = useState<'M0' | 'M1' | 'M2'>('M0');
  const baseStrategy = MODEL_STRATEGIES[modelVersion];
  const [minHz, setMinHz] = useState(baseStrategy.bands.minHz);
  const [maxHz, setMaxHz] = useState(baseStrategy.bands.maxHz);
  const [paramOn, setParamOn] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const p of baseStrategy.params) m[p.key] = p.role === 'tunable';
    return m;
  });
  const [paramInit, setParamInit] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const p of baseStrategy.params) m[p.key] = p.initial;
    return m;
  });
  const [algo, setAlgo] = useState<AlgoSettings>({
    huberDelta: 2,
    lambda: 1e-3,
    lambdaPeak: 0.1,
    starts: 12,
    resamples: 1000,
    seed: 20261118,
    fast: false,
  });

  /* ---------- 运行与记录 ---------- */
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [runError, setRunError] = useState('');
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [rawPoints, setRawPoints] = useState<ChartPoint[]>([]);
  const [records, setRecords] = useState<CalibrationRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  /* 分阶段拟合结果 */
  const [phaseReports, setPhaseReports] = useState<CalibrationReport[] | null>(null);
  const [phaseProgress, setPhaseProgress] = useState<{ i: number; total: number; name: string } | null>(
    null,
  );

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 2600);
  };

  /* ---------- 载入实验库与历史记录 ---------- */
  const loadLab = () => {
    setLabLoading(true);
    setLabError('');
    api.lab
      .get()
      .then((snap) => {
        const data = (snap ?? null) as LabSnapshot | null;
        const options: LabOption[] = [];
        for (const exp of data?.experiments ?? []) {
          for (const curve of exp.curves ?? []) {
            if (!/tl|传递损失|transmission/i.test(curve.quantity)) continue;
            const pts = curve.points
              .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 0)
              .map((p) => ({ x: p.x, y: p.y }));
            if (pts.length < 10) continue;
            options.push({
              id: `${exp.reportId}::${curve.quantity}`,
              label: `${exp.meta.productModel || exp.meta.productFamily || exp.reportId} · ${curve.quantity}`,
              sub: `${exp.reportId} · ${pts.length} 点 · ${curve.unit}`,
              points: pts,
            });
          }
        }
        setLabOptions(options);
      })
      .catch(() => setLabError('读取实验库失败'))
      .finally(() => setLabLoading(false));
  };

  useEffect(() => {
    loadLab();
    api.ai
      .listCalibrations()
      .then((list) => setRecords(list))
      .catch(() => undefined);
  }, []);

  /* ---------- 解析数据 ---------- */
  /** 已选中的实验库曲线（保持选择顺序） */
  const labSelected = useMemo(
    () => labIds.map((id) => labOptions.find((o) => o.id === id)).filter((o): o is LabOption => !!o),
    [labIds, labOptions],
  );

  /** 预览与归档仍按第一条数据源展示 */
  const workbook = xlsxFiles[0]?.workbook ?? null;
  const fileName = xlsxFiles[0]?.name ?? '';

  /** 每个已导入文件按当前列映射解析（列映射对所有文件统一生效） */
  const parsedFiles = useMemo(
    () =>
      xlsxFiles.map((f) => ({
        name: f.name,
        ...parseSheetPoints(f.workbook, sheet, startRow, xCol, yCol),
      })),
    [xlsxFiles, sheet, startRow, xCol, yCol],
  );

  const parsed = useMemo(() => {
    if (source !== 'xlsx' || !workbook || !sheet) return { pts: [] as ChartPoint[], skipped: 0 };
    return parseSheetPoints(workbook, sheet, startRow, xCol, yCol);
  }, [source, workbook, sheet, startRow, xCol, yCol]);

  const points = source === 'lab' ? labSelected[0]?.points ?? [] : parsed.pts;

  const dataRange = useMemo(() => pointsRange(points), [points]);

  /** 列映射与文件结构不匹配的告警（例如某文件缺少所选工作表） */
  const mappingWarnings = useMemo(() => {
    if (source !== 'xlsx' || !sheet) return [] as string[];
    return xlsxFiles
      .filter((f) => !f.workbook.names.includes(sheet))
      .map((f) => `${f.name}：缺少工作表「${sheet}」，已跳过`);
  }, [source, xlsxFiles, sheet]);

  const colCount = useMemo(() => {
    if (!workbook || !sheet) return 0;
    const rows = workbook.sheets[sheet] ?? [];
    return rows.slice(0, 30).reduce((m, r) => Math.max(m, r.length), 0);
  }, [workbook, sheet]);

  const headerText = (i: number): string => {
    if (!workbook || !sheet) return '';
    const v = workbook.sheets[sheet]?.[headerRow - 1]?.[i];
    return v === undefined || v === null ? '' : String(v).trim();
  };

  /* ---------- 选择 Excel ---------- */
  /** 读取单个文件并解析为工作簿（不做列映射） */
  const parseExcelFile = async (file: File): Promise<XlsxFile> => {
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheets: Record<string, (string | number)[][]> = {};
    for (const name of wb.SheetNames) {
      sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], {
        header: 1,
        blankrows: false,
      }) as (string | number)[][];
    }
    return { name: file.name, buffer, workbook: { names: wb.SheetNames, sheets } };
  };

  const pickExcels = async (files: File[]) => {
    setFileError('');
    setArchive({ status: 'idle' });
    archivedSig.current = '';
    const ok: XlsxFile[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        ok.push(await parseExcelFile(file));
      } catch (err) {
        errors.push(`${file.name}：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (ok.length === 0) {
      if (errors.length > 0) setFileError(`读取失败：${errors.join('；')}`);
      return;
    }
    // 首次导入时按第一个文件自动识别表头（含 频率/freq/Hz 的行）与 TL 列
    let targetSheet = sheet;
    if (xlsxFiles.length === 0) {
      const first = ok[0].workbook.names[0] ?? '';
      targetSheet = first;
      setSheet(first);
      const rows = ok[0].workbook.sheets[first] ?? [];
      let hRow = 1;
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        if ((rows[i] ?? []).some((c) => /频率|frequency|\bhz\b/i.test(String(c)))) {
          hRow = i + 1;
          break;
        }
      }
      const header = rows[hRow - 1] ?? [];
      let xi = 0;
      let yi = 1;
      header.forEach((c, i) => {
        const t = String(c);
        if (/频率|frequency|\bhz\b/i.test(t)) xi = i;
        if (/^tl\b|传递损失|transmission/i.test(t.trim())) yi = i;
      });
      setHeaderRow(hRow);
      setStartRow(hRow + 1);
      setXCol(xi);
      setYCol(yi);
      if (yi === xi) setYCol(xi === 0 ? 1 : 0);
    }
    // 结构需一致：缺少当前工作表的文件跳过并给出原因
    const usable = ok.filter((f) => {
      if (!targetSheet || f.workbook.names.includes(targetSheet)) return true;
      errors.push(`${f.name}：缺少工作表「${targetSheet}」`);
      return false;
    });
    if (usable.length > 0) {
      // 同名文件覆盖旧项，避免重复导入
      setXlsxFiles((prev) => {
        const map = new Map(prev.map((x) => [x.name, x]));
        for (const f of usable) map.set(f.name, f);
        return Array.from(map.values());
      });
    }
    if (errors.length > 0) setFileError(`以下文件解析失败已跳过：${errors.join('；')}`);
  };

  const removeXlsx = (name: string) => {
    setXlsxFiles((prev) => prev.filter((f) => f.name !== name));
    setArchive({ status: 'idle' });
    archivedSig.current = '';
    setFileError('');
  };

  const toggleLab = (id: string) => {
    setLabIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /* ---------- 组装策略与数据集 ---------- */
  const strategy: CalibrationStrategy = useMemo(
    () => ({
      ...baseStrategy,
      bands: { ...baseStrategy.bands, minHz, maxHz },
      objective: {
        ...baseStrategy.objective,
        huberDelta: algo.huberDelta,
        lambda: algo.lambda,
        lambdaPeak: algo.lambdaPeak,
      },
      optimizer: { ...baseStrategy.optimizer, starts: algo.starts },
      uncertainty: { ...baseStrategy.uncertainty, resamples: algo.resamples },
      params: baseStrategy.params.map((p) =>
        p.key in paramOn
          ? {
              ...p,
              role: paramOn[p.key] ? ('tunable' as const) : ('fixed' as const),
              initial: paramInit[p.key] ?? p.initial,
            }
          : { ...p, initial: p.key === 'f_p' ? geometry.fp : p.initial },
      ),
    }),
    [baseStrategy, minHz, maxHz, algo, paramOn, paramInit, geometry.fp],
  );

  /** 每个数据源各自一条 CalibrationDataset（inputs 共用页面顶部几何） */
  const datasets: CalibrationDataset[] = useMemo(() => {
    const inputs = wovenTubeInputs(geometry);
    const make = (id: string, pts: ChartPoint[]): CalibrationDataset => ({
      id,
      formulaId: FORMULA_ID,
      quantity: 'TL',
      unit: 'dB',
      inputs,
      points: pts.map((p) => ({ f: p.x, y: p.y })),
      groupId: `${id}@L${geometry.L}`,
      hash: hashPoints(pts),
    });
    const list: CalibrationDataset[] = [];
    if (source === 'lab') {
      for (const o of labSelected) {
        if (o.points.length < 10) continue;
        list.push(make(o.id, o.points));
      }
    } else {
      for (const f of parsedFiles) {
        if (f.pts.length < 10) continue;
        list.push(make(f.name, f.pts));
      }
    }
    return list;
  }, [source, labSelected, parsedFiles, geometry]);

  /** 联合数据集：多个数据源时合并点集，id 记为 joint(N) */
  const dataset: CalibrationDataset = useMemo(() => {
    const list = datasets;
    if (list.length === 0) {
      const sourceName =
        source === 'lab' ? labIds[0] ?? 'lab-curve' : fileName || 'excel';
      return {
        id: sourceName,
        formulaId: FORMULA_ID,
        quantity: 'TL',
        unit: 'dB',
        inputs: wovenTubeInputs(geometry),
        points: [],
        groupId: `${sourceName}@L${geometry.L}`,
        hash: hashPoints([]),
      };
    }
    if (list.length === 1) return list[0];
    const merged = list.flatMap((d) => d.points);
    return {
      id: `joint(${list.length})`,
      formulaId: FORMULA_ID,
      quantity: 'TL',
      unit: 'dB',
      inputs: wovenTubeInputs(geometry),
      points: merged,
      groupId: list.map((d) => d.groupId).join('+'),
      hash: hashPoints(merged.map((p) => ({ x: p.f, y: p.y }))),
      sources: list.map((d) => ({ id: d.id, points: d.points.length })),
    };
  }, [datasets, source, labIds, fileName, geometry]);

  /** 联合后的总点数（runnable / 步骤跳转均以它为准） */
  const totalPoints = dataset.points.length;

  /* ---------- 归档导入数据到共享盘 ---------- */
  const archiveDataset = async () => {
    if (source !== 'xlsx' || parsedFiles.length === 0) return;
    // 按当前列映射逐文件解析，点数不足 / 缺少工作表的文件不归档
    const entries = xlsxFiles
      .map((f, i) => ({ file: f, parsed: parsedFiles[i] }))
      .filter((e) => e.parsed && e.parsed.pts.length > 0);
    if (entries.length === 0) return;
    const sig = [
      ...entries.map((e) => `${hashPoints(e.parsed.pts)}|${e.file.name}`),
      sheet,
      headerRow,
      startRow,
      xCol,
      yCol,
      geometry.D,
      geometry.L,
      geometry.t,
      geometry.fp,
    ].join('|');
    if (archivedSig.current === sig) return;
    setArchive({ status: 'saving' });
    try {
      let dir = '';
      for (const { file, parsed: p } of entries) {
        const res = await api.ai.saveTrainingData({
          fileName: file.name || `dataset-${Date.now()}.xlsx`,
          buffer: file.buffer,
          csv: p.pts.map((q) => `${q.x},${q.y}`),
          meta: {
            formulaId: FORMULA_ID,
            formulaVersion: FORMULA_VERSION,
            source: 'xlsx',
            originalFileName: file.name,
            sheet,
            headerRow,
            startRow,
            xColumn: columnLetter(xCol),
            xHeader: headerText(xCol),
            yColumn: columnLetter(yCol),
            yHeader: headerText(yCol),
            pointCount: p.pts.length,
            frequencyRange: pointsRange(p.pts),
            geometryMm: { ...geometry },
            dataHash: hashPoints(p.pts),
            operator: user.displayName || user.username,
          },
        });
        if (!res.ok) {
          setArchive({ status: 'error', message: `${file.name}：${res.message ?? '归档失败'}` });
          return;
        }
        dir = res.dir ?? dir;
      }
      archivedSig.current = sig;
      setArchive({ status: 'ok', dir });
      showToast(
        entries.length > 1 ? `已归档 ${entries.length} 个文件到 TrainCore` : '导入数据已归档到 TrainCore',
      );
    } catch (err) {
      setArchive({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  /* ---------- 运行 ---------- */
  const runnable = totalPoints >= 10 && Object.values(paramOn).some(Boolean);

  const run = () => {
    if (!runnable) return;
    setRunError('');
    setReport(null);
    setActiveId(null);
    setStep(4);
    setRunning(true);
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 200);
    // 让「计算中」先绘制出来，再执行同步优化
    window.setTimeout(() => {
      try {
        const next = calibrate({
          strategy,
          dataset,
          model: wovenTubeModel,
          formulaVersion: FORMULA_VERSION,
          seed: algo.seed,
          fast: algo.fast,
        });
        setReport(next);
        setRawPoints(points);
      } catch (err) {
        setRunError(`标定失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        window.clearInterval(timer);
        setElapsed(Date.now() - started);
        setRunning(false);
      }
    }, 60);
  };

  /* ---------- 分阶段拟合 M0 → M1 → M2 ---------- */
  const PHASE_CONFIG: Array<{
    name: string;
    strategy: CalibrationStrategy;
    /** 从上一阶段继承初值的参数 key */
    inheritKeys: string[];
  }> = [
    {
      name: 'M0 基线（C_R / A_L / B_L）',
      strategy: BRAID_M0_V1,
      inheritKeys: [],
    },
    {
      name: 'M1 端部修正（放开 ε_L）',
      strategy: BRAID_M1_V1,
      inheritKeys: ['C_R', 'A_L', 'B_L'],
    },
    {
      name: 'M2 高频饱和（放开 a_HF / f_s）',
      strategy: BRAID_STRUCTURE_V1,
      inheritKeys: ['C_R', 'A_L', 'B_L', 'epsilon_L'],
    },
  ];

  const runPhaseFitting = () => {
    if (!runnable) return;
    setRunError('');
    setPhaseReports(null);
    setReport(null);
    setRawPoints(points);
    setStep(4);
    setRunning(true);
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 200);
    setPhaseProgress({ i: 0, total: PHASE_CONFIG.length, name: PHASE_CONFIG[0].name });

    window.setTimeout(() => {
      try {
        const results: CalibrationReport[] = [];
        let prevParams: Record<string, number> = {};
        for (let i = 0; i < PHASE_CONFIG.length; i++) {
          const cfg = PHASE_CONFIG[i];
          setPhaseProgress({ i: i + 1, total: PHASE_CONFIG.length, name: cfg.name });
          // 从上一阶段继承初值
          const strat: CalibrationStrategy = {
            ...cfg.strategy,
            bands: { ...cfg.strategy.bands, minHz: cfg.strategy.bands.minHz, maxHz: cfg.strategy.bands.maxHz },
            objective: {
              ...cfg.strategy.objective,
              huberDelta: algo.huberDelta,
              lambda: algo.lambda,
              lambdaPeak: algo.lambdaPeak,
            },
            optimizer: { ...cfg.strategy.optimizer, starts: algo.starts },
            uncertainty: { ...cfg.strategy.uncertainty, resamples: algo.resamples },
            params: cfg.strategy.params.map((p) => ({
              ...p,
              initial:
                cfg.inheritKeys.includes(p.key) && prevParams[p.key] !== undefined
                  ? prevParams[p.key]
                  : p.initial,
            })),
          };
          const rep = calibrate({
            strategy: strat,
            dataset,
            model: wovenTubeModel,
            formulaVersion: FORMULA_VERSION,
            seed: algo.seed + i,
            fast: algo.fast,
          });
          results.push(rep);
          // 提取 tunable 参数最优值作为下一阶段初值
          const nextParams: Record<string, number> = { ...prevParams };
          for (const p of rep.params) nextParams[p.key] = p.value;
          prevParams = nextParams;
        }
        setPhaseReports(results);
        // 默认展示最后一阶段（M2）
        setReport(results[results.length - 1]);
      } catch (err) {
        setRunError(`分阶段拟合失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        window.clearInterval(timer);
        setElapsed(Date.now() - started);
        setRunning(false);
        setPhaseProgress(null);
      }
    }, 60);
  };

  /* ---------- 升级到下一模型（M0→M1→M2） ---------- */
  const NEXT_MODEL: Record<'M0' | 'M1' | 'M2', 'M1' | 'M2' | null> = {
    M0: 'M1',
    M1: 'M2',
    M2: null,
  };
  const CURRENT_MODEL_FROM_REPORT = (): 'M0' | 'M1' | 'M2' => {
    if (!report) return modelVersion;
    const keys = new Set(report.params.map((p) => p.key));
    if (keys.has('f_s')) return 'M2';
    if (keys.has('epsilon_L')) return 'M1';
    return 'M0';
  };
  const upgradeToNextModel = () => {
    if (!report) return;
    const cur = CURRENT_MODEL_FROM_REPORT();
    const next = NEXT_MODEL[cur];
    if (!next) {
      showToast('M2 已是最高模型，无法继续升级');
      return;
    }
    // 把当前报告的所有参数最优值作为下一阶段的初值
    const curParamMap: Record<string, number> = {};
    for (const p of report.params) curParamMap[p.key] = p.value;
    const s = MODEL_STRATEGIES[next];
    const on: Record<string, boolean> = {};
    const init: Record<string, number> = {};
    for (const p of s.params) {
      on[p.key] = p.role === 'tunable';
      init[p.key] = curParamMap[p.key] ?? p.initial; // 继承已有参数，新参数保留默认初值
    }
    setModelVersion(next);
    setMinHz(s.bands.minHz);
    setMaxHz(s.bands.maxHz);
    setParamOn(on);
    setParamInit(init);
    setActiveId(null);
    setReport(null);
    setRunError('');
    setStep(3);
    showToast(`已切换到 ${next}，上一阶段参数已灌为初值，可直接点「开始优化」`);
  };

  /* ---------- 图形 ---------- */
  const fitSvg = useMemo(() => {
    if (!report) return '';
    const params = fitValues(report, strategy);
    const base = decimate(rawPoints);
    const modelCurve = base.map((p) => ({
      x: p.x,
      y: wovenTubeModel(report.dataset.inputs, params, [p.x])[0],
    }));
    // 联合标定时逐条绘制实测曲线，便于对比各样件/工况
    const measuredSeries =
      datasets.length > 1
        ? datasets.map((d, i) => ({
            name: d.id,
            points: decimate(d.points.map((p) => ({ x: p.f, y: p.y }))),
            color: SOURCE_COLORS[i % SOURCE_COLORS.length],
          }))
        : undefined;
    return renderFitChartSvg(report, {
      measured: measuredSeries ? undefined : base,
      measuredSeries,
      model: modelCurve.filter((p) => Number.isFinite(p.y)),
    });
  }, [report, rawPoints, strategy, datasets]);

  const residualSvg = useMemo(() => (report ? renderResidualChartSvg(report) : ''), [report]);

  /** 仅当报告对应当前选择时才附带 sources，避免查看历史记录时串用 */
  const reportSources =
    report && report.dataset.id === dataset.id && report.dataset.hash === dataset.hash
      ? dataset.sources
      : undefined;

  /** 联合标定：用同一套最优参数逐条复算各数据源指标，便于发现偏离的样件/工况 */
  const sourceMetrics = useMemo(() => {
    if (!report || !reportSources || datasets.length < 2) return [] as SourceMetrics[];
    const params: Record<string, number> = {};
    for (const p of report.params) params[p.key] = p.value;
    return datasets
      .map((d) => evaluateSourceMetrics(d, strategy, params, wovenTubeModel))
      .filter((m): m is SourceMetrics => m != null);
  }, [report, reportSources, datasets, strategy]);

  /* ---------- 记录持久化 ---------- */
  const saveRecords = async (next: CalibrationRecord[]) => {
    const res = await api.ai.saveCalibrations(next);
    if (!res.ok) {
      showToast(res.message ?? '保存失败');
      return false;
    }
    setRecords(next);
    return true;
  };

  const buildRecord = (status: CalibrationRecordStatus, base?: CalibrationRecord): CalibrationRecord | null => {
    if (!report) return null;
    const now = new Date().toISOString();
    const actor = user.displayName || user.username;
    const record: CalibrationRecord = {
      id: base?.id ?? `cal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      formulaId: report.formula.id,
      formulaVersion: report.formula.version,
      strategyId: report.strategy.id,
      strategyVersion: report.strategy.version,
      datasetId: report.dataset.id,
      datasetHash: report.dataset.hash,
      source,
      geometry,
      inputs: report.dataset.inputs,
      params: report.params,
      metrics: report.metrics,
      warnings: report.warnings,
      report,
      note,
      status,
      createdBy: base?.createdBy ?? actor,
      createdAt: base?.createdAt ?? now,
      reviewedBy: base?.reviewedBy,
      reviewedAt: base?.reviewedAt,
      releasedBy: base?.releasedBy,
      releasedAt: base?.releasedAt,
    };
    if (status === 'reviewed') {
      record.reviewedBy = actor;
      record.reviewedAt = now;
    }
    if (status === 'released') {
      record.releasedBy = actor;
      record.releasedAt = now;
      if (!record.reviewedBy) {
        record.reviewedBy = actor;
        record.reviewedAt = now;
      }
    }
    return record;
  };

  const upsert = async (status: CalibrationRecordStatus) => {
    const base = activeId ? records.find((r) => r.id === activeId) : undefined;
    const record = buildRecord(status, base);
    if (!record) return;
    let next = base ? records.map((r) => (r.id === record.id ? record : r)) : [record, ...records];
    if (status === 'released') {
      next = next.map((r) =>
        r.id !== record.id && r.formulaId === record.formulaId && r.status === 'released'
          ? { ...r, status: 'archived' as CalibrationRecordStatus }
          : r,
      );
      const getv = (key: string) => record.params.find((p) => p.key === key)?.value;
      const CR = getv('C_R');
      const AL = getv('A_L');
      const BL = getv('B_L');
      if ([CR, AL, BL].every((v) => typeof v === 'number')) {
        setActiveWovenTubeCalib({
          CR: CR as number,
          AL: AL as number,
          BL: BL as number,
          epsilonL: typeof getv('epsilon_L') === 'number' ? (getv('epsilon_L') as number) : 0,
          aHF: typeof getv('a_HF') === 'number' ? (getv('a_HF') as number) : 0,
          fS: typeof getv('f_s') === 'number' ? (getv('f_s') as number) : 0,
        });
      }
    }
    if (await saveRecords(next)) {
      setActiveId(record.id);
      showToast(
        status === 'draft'
          ? '已保存草稿'
          : status === 'reviewed'
            ? '已标记审核通过，可发布'
            : '已发布，后续计算使用新系数',
      );
    }
  };

  const setRecordStatus = async (record: CalibrationRecord, status: CalibrationRecordStatus) => {
    const now = new Date().toISOString();
    const actor = user.displayName || user.username;
    let next = records.map((r) =>
      r.id === record.id
        ? {
            ...r,
            status,
            reviewedBy: status === 'reviewed' || status === 'released' ? actor : r.reviewedBy,
            reviewedAt: status === 'reviewed' || status === 'released' ? now : r.reviewedAt,
            releasedBy: status === 'released' ? actor : r.releasedBy,
            releasedAt: status === 'released' ? now : r.releasedAt,
          }
        : r,
    );
    if (status === 'released') {
      next = next.map((r) =>
        r.id !== record.id && r.formulaId === record.formulaId && r.status === 'released'
          ? { ...r, status: 'archived' as CalibrationRecordStatus }
          : r,
      );
      const getv = (key: string) => record.params.find((p) => p.key === key)?.value;
      const CR = getv('C_R');
      const AL = getv('A_L');
      const BL = getv('B_L');
      if ([CR, AL, BL].every((v) => typeof v === 'number')) {
        setActiveWovenTubeCalib({
          CR: CR as number,
          AL: AL as number,
          BL: BL as number,
          epsilonL: typeof getv('epsilon_L') === 'number' ? (getv('epsilon_L') as number) : 0,
          aHF: typeof getv('a_HF') === 'number' ? (getv('a_HF') as number) : 0,
          fS: typeof getv('f_s') === 'number' ? (getv('f_s') as number) : 0,
        });
      }
    }
    if (await saveRecords(next)) {
      showToast(status === 'released' ? '已发布' : '已更新记录状态');
    }
  };

  const viewRecord = (record: CalibrationRecord) => {
    setReport(record.report);
    setGeometry(record.geometry);
    setSource(record.source);
    setNote(record.note);
    setActiveId(record.id);
    setRawPoints([]);
    setRunError('');
    setStep(4);
  };

  const removeRecord = async (record: CalibrationRecord) => {
    if (!window.confirm('确定删除该标定记录？已发布的记录删除后，软件将回到内置默认系数。')) return;
    const next = records.filter((r) => r.id !== record.id);
    if (await saveRecords(next)) {
      if (activeId === record.id) setActiveId(null);
      if (record.status === 'released') setActiveWovenTubeCalib(null);
      showToast('记录已删除');
    }
  };

  /* ---------- 导出 ---------- */
  const saveFile = async (name: string, content: string) => {
    const res = await api.file.save({ defaultName: name, content, encoding: 'utf8' });
    if (res.ok) showToast(`已保存：${res.filePath ?? name}`);
    else if (!res.canceled) showToast(res.message ?? '保存失败');
  };

  const exportChartHtml = () => {
    if (!report) return;
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>编织管标定图形</title>
<style>body{margin:0;padding:24px;background:#f5f7fa;font-family:'Microsoft YaHei',sans-serif;color:#1f2937}
h1{font-size:18px;margin:0 0 6px}p{font-size:12.5px;color:#64748b;margin:0 0 16px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:14px}
svg{width:100%;height:auto}</style></head><body>
<h1>编织管传递损失模型 — 标定图形</h1>
<p>数据集：${datasetTitle(report.dataset, reportSources)} · 参数：${report.params
      .map((p) => `${p.key}=${fmt(p.value, 4)}`)
      .join('，')} · 生成时间：${new Date().toLocaleString()}</p>
<div class="card">${fitSvg}</div><div class="card">${residualSvg}</div>
</body></html>`;
    saveFile(`编织管标定图形-${stamp()}.html`, html);
  };

  /* ---------- 视图辅助 ---------- */
  const canGo = (n: number) => n === 1 || (n <= 3 ? totalPoints > 0 : !!report);
  const publishBlocked = report
    ? report.optimizer.multiSolution
      ? '存在多解，不建议发布'
      : report.diagnostics.activeConstraints.length > 0
        ? `参数贴边（${report.diagnostics.activeConstraints.join('、')}），不建议发布`
        : ''
    : '';
  const activeRecord = records.find((r) => r.id === activeId);
  /** 已发布 / 已归档的版本不再允许通过「草稿 / 审核」按钮降级 */
  const lockedRecord = activeRecord?.status === 'released' || activeRecord?.status === 'archived';

  /* ---------- 公式选择器（编织管 TL / 赫姆霍兹 f0） ---------- */
  const formulaSelector = (
    <div className="ai-formula-select">
      <label htmlFor="ai-formula-kind">公式</label>
      <select
        id="ai-formula-kind"
        value={formulaId}
        onChange={(e) => setFormulaId(e.target.value as typeof formulaId)}
      >
        <option value="acoustics.muffler.wovenTube">编织管消音器 · TL 曲线</option>
        <option value="acoustics.muffler.helmholtz">赫姆霍兹消音器 · f0 标量</option>
      </select>
    </div>
  );

  if (formulaId === 'acoustics.muffler.helmholtz') {
    return (
      <div className="ai-page">
        <div className="ai-hero">
          <div>
            <h2>AI 公式优化 · 赫姆霍兹</h2>
            <p>
              用实测 / CAE 中心频率 f0 标定赫姆霍兹模型系数。依据《赫姆霍兹消音器中心频率公式自动优化实施方案》：
              H0 基线对照、H1 有效长度 δ_total 单点标定、H2 偏心/开口/插入修正；标量相对误差目标，
              先核对长度 / 体积 / 开口三口径再优化。
            </p>
          </div>
          <div className="ai-hero-tags">
            <span className="tag">赫姆霍兹 f0</span>
            <span className="tag">标量标定</span>
            <span className="tag">草稿 → 审核 → 发布</span>
          </div>
        </div>
        {formulaSelector}
        <HelmholtzOptimizePanel user={user} onBack={onBack} />
      </div>
    );
  }

  return (
    <div className="ai-page">
      <div className="ai-hero">
        <div>
          <h2>AI 公式优化</h2>
          <p>
            用实测传递损失曲线自动辨识编织管模型系数。依据《编织管传递损失公式自动优化实施方案_M4》分三阶段：
            M0 基线（C_R/A_L/B_L）、M1 端部修正（ε_L）、M2 高频泄漏饱和（a_HF/f_s）；有效 1/3 倍频带、Huber 稳健损失、
            多起点 Nelder-Mead、JᵀJ 协方差 + 分块 bootstrap。
          </p>
        </div>
        <div className="ai-hero-tags">
          <span className="tag">编织管 TL</span>
          <span className="tag">M4 实施方案</span>
          <span className="tag">草稿 → 审核 → 发布</span>
        </div>
      </div>

      {formulaSelector}

      <div className="ai-steps">
        {[
          { n: 1, t: '选择公式与数据', d: '实验库 / Excel' },
          { n: 2, t: '字段映射', d: '频率、TL 与几何' },
          { n: 3, t: '参数与算法', d: '标定对象与权重' },
          { n: 4, t: '结果与采纳', d: '图形、指标、发布' },
        ].map((s) => (
          <button
            key={s.n}
            className={`ai-step${step === s.n ? ' active' : ''}${step > s.n ? ' done' : ''}`}
            disabled={!canGo(s.n)}
            onClick={() => canGo(s.n) && setStep(s.n)}
          >
            <span className="ai-step-no">{step > s.n ? '✓' : s.n}</span>
            <span>
              <b>{s.t}</b>
              <i>{s.d}</i>
            </span>
          </button>
        ))}
      </div>

      {step === 1 && (
        <section className="settings-card">
          <h3>选择公式与数据</h3>
          <div className="ai-formula-row">
            <div>
              <div className="ai-formula-name">编织管消音器 · 传递损失 TL</div>
              <div className="ai-formula-meta">
                {FORMULA_ID} · v{FORMULA_VERSION} · 策略 {baseStrategy.id}/{baseStrategy.version} · 可标定参数{' '}
                {baseStrategy.params.filter((p) => p.role === 'tunable').map((p) => p.key).join(' / ')}
              </div>
            </div>
            <span className="tag tag-ok">M4 分阶段标定</span>
          </div>

          <div className="ai-sub-title">模型版本（依据 M4 实施方案第 4 节）</div>
          <div className="ai-tabs">
            {([
              ['M0', '基线标定', 'C_R / A_L / B_L 三参数，频带 20~5000 Hz'],
              ['M1', '端部修正', '在 M0 基础上放开 ε_L（有效长度修正），频带 100~2000 Hz'],
              ['M2', '高频饱和', '在 M1 基础上放开 a_HF / f_s（高频泄漏饱和补偿），频带 100~2000 Hz'],
            ] as const).map(([ver, label, tip]) => (
              <button
                key={ver}
                className={`ai-tab${modelVersion === ver ? ' active' : ''}`}
                onClick={() => {
                  setModelVersion(ver);
                  const s = MODEL_STRATEGIES[ver];
                  setMinHz(s.bands.minHz);
                  setMaxHz(s.bands.maxHz);
                  const on: Record<string, boolean> = {};
                  const init: Record<string, number> = {};
                  for (const p of s.params) {
                    on[p.key] = p.role === 'tunable';
                    init[p.key] = p.initial;
                  }
                  setParamOn(on);
                  setParamInit(init);
                }}
              >
                <b>{ver}</b> · {label}
                <span className="ai-tab-tip">{tip}</span>
              </button>
            ))}
          </div>

          <div className="ai-tabs">
            <button
              className={`ai-tab${source === 'lab' ? ' active' : ''}`}
              onClick={() => setSource('lab')}
            >
              实验库已入库曲线
            </button>
            <button
              className={`ai-tab${source === 'xlsx' ? ' active' : ''}`}
              onClick={() => setSource('xlsx')}
            >
              导入 Excel
            </button>
          </div>

          {source === 'lab' ? (
            <div>
              <div className="ai-row">
                <span className="settings-hint">
                  从「数据入库与校准」已入库的 TL 曲线中选择；几何参数在下一步填写。
                </span>
                <button className="btn-ghost sm" onClick={loadLab} disabled={labLoading}>
                  {labLoading ? '读取中…' : '刷新'}
                </button>
              </div>
              {labError && <div className="ai-error">{labError}</div>}
              {!labLoading && labOptions.length === 0 && !labError && (
                <p className="settings-hint">
                  实验库中暂无 TL 曲线。可先在「产品验证 → 数据入库与校准」入库，或改用导入 Excel。
                </p>
              )}
              <div className="ai-source-list">
                {labOptions.map((o) => (
                  <button
                    key={o.id}
                    className={`ai-source${labIds.includes(o.id) ? ' active' : ''}`}
                    onClick={() => toggleLab(o.id)}
                  >
                    <span className="ai-source-name">{o.label}</span>
                    <span className="ai-source-meta">{o.sub}</span>
                    {labIds.includes(o.id) && <span className="tag tag-ok">已选择</span>}
                  </button>
                ))}
              </div>
              {labSelected.length > 0 && (
                <p className="settings-hint">
                  已选 {labSelected.length} 条曲线，共{' '}
                  {labSelected.reduce((n, o) => n + o.points.length, 0)} 点。
                </p>
              )}
            </div>
          ) : (
            <div>
              <div className="ai-row">
                <label className="btn-primary sm ai-file">
                  {xlsxFiles.length > 0 ? '继续添加 Excel' : '选择 Excel 文件'}
                  <input
                    type="file"
                    multiple
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => {
                      const fs = Array.from(e.target.files ?? []);
                      if (fs.length > 0) void pickExcels(fs);
                      e.target.value = '';
                    }}
                  />
                </label>
                <span className="ai-source-meta">
                  {xlsxFiles.length > 0
                    ? `共 ${xlsxFiles.length} 个文件`
                    : '支持 .xlsx / .xls / .csv，可多选'}
                </span>
              </div>
              <p className="settings-hint">
                多个文件需结构相同（工作表与列名一致）；导入的原始文件与映射后的数据会归档到{' '}
                {TRAIN_CORE}（桌面客户端）。
              </p>
              {fileError && <div className="ai-error">{fileError}</div>}
              {mappingWarnings.map((w) => (
                <div className="ai-error" key={w}>
                  {w}
                </div>
              ))}
              {xlsxFiles.length > 0 && (
                <div className="ai-source-list">
                  {xlsxFiles.map((f) => {
                    const p = parsedFiles.find((x) => x.name === f.name);
                    return (
                      <div className="ai-source" key={f.name}>
                        <span className="ai-source-name">{f.name}</span>
                        <span className="ai-source-meta">
                          {p && p.pts.length > 0
                            ? `${p.pts.length} 点${p.skipped > 0 ? ` · 跳过 ${p.skipped} 行` : ''}`
                            : '未能解析（检查工作表 / 列映射）'}
                          {p && p.pts.length > 0 && p.pts.length < 10 ? ' · 少于 10 点，未参与' : ''}
                        </span>
                        <button className="btn-link danger" onClick={() => removeXlsx(f.name)}>
                          移除
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {workbook && (
                <div className="ai-grid4 ai-mapping">
                  <label className="field">
                    <span>工作表</span>
                    <select value={sheet} onChange={(e) => setSheet(e.target.value)}>
                      {workbook.names.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>表头行</span>
                    <input
                      type="number"
                      min={1}
                      value={headerRow}
                      onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value)))}
                    />
                  </label>
                  <label className="field">
                    <span>数据起始行</span>
                    <input
                      type="number"
                      min={1}
                      value={startRow}
                      onChange={(e) => setStartRow(Math.max(1, Number(e.target.value)))}
                    />
                  </label>
                  <label className="field">
                    <span>频率列</span>
                    <select value={xCol} onChange={(e) => setXCol(Number(e.target.value))}>
                      {Array.from({ length: colCount }).map((_, i) => (
                        <option key={i} value={i}>
                          {columnLetter(i)}
                          {headerText(i) ? `（${headerText(i)}）` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>TL 列</span>
                    <select value={yCol} onChange={(e) => setYCol(Number(e.target.value))}>
                      {Array.from({ length: colCount }).map((_, i) => (
                        <option key={i} value={i}>
                          {columnLetter(i)}
                          {headerText(i) ? `（${headerText(i)}）` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {workbook && (
                <div className="ai-preview">
                  <div className="ai-preview-head">
                    数据预览（前 4 行）
                    <span>
                      有效 {parsed.pts.length} 点
                      {parsed.skipped > 0 ? ` · 跳过 ${parsed.skipped} 行` : ''}
                    </span>
                  </div>
                  <table className="ai-table">
                    <tbody>
                      {(workbook.sheets[sheet] ?? []).slice(Math.max(0, headerRow - 1), headerRow + 3).map((row, ri) => (
                        <tr key={ri} className={ri === 0 ? 'ai-preview-header' : ''}>
                          {Array.from({ length: Math.min(colCount, 6) }).map((_, ci) => (
                            <td key={ci} className={ci === xCol || ci === yCol ? 'ai-preview-key' : ''}>
                              {row[ci] === undefined || row[ci] === null ? '' : String(row[ci])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="ai-actions">
            <span className="settings-hint">
              {totalPoints > 0
                ? dataset.sources
                  ? `当前数据：${dataset.sources.length} 组联合，共 ${totalPoints} 点`
                  : `当前数据：${totalPoints} 点，${fmt(dataRange?.lo, 1)}~${fmt(dataRange?.hi, 1)} Hz`
                : '请选择数据后再继续'}
            </span>
            <button className="btn-primary sm" disabled={totalPoints < 10} onClick={() => setStep(2)}>
              下一步：字段映射
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="settings-card">
          <h3>字段映射与公式输入</h3>
          <div className="ai-grid2">
            <div>
              <div className="kv">
                <span>数据来源</span>
                <b>
                  {source === 'lab'
                    ? labSelected.length > 1
                      ? `实验库 · ${labSelected.length} 条曲线`
                      : labSelected[0]?.label ?? '实验库'
                    : datasets.length > 1
                      ? `Excel · ${datasets.length} 个文件`
                      : fileName || 'Excel'}
                </b>
              </div>
              <div className="kv">
                <span>频率列 → 自变量</span>
                <b>{source === 'lab' ? '自动（曲线 x）' : `${columnLetter(xCol)}${headerText(xCol) ? `（${headerText(xCol)}）` : ''}`}</b>
              </div>
              <div className="kv">
                <span>TL 列 → 因变量</span>
                <b>{source === 'lab' ? '自动（曲线 y）' : `${columnLetter(yCol)}${headerText(yCol) ? `（${headerText(yCol)}）` : ''}`}</b>
              </div>
              <div className="kv">
                <span>有效点数</span>
                <b>
                  {totalPoints} 点
                  {dataset.sources ? `（${dataset.sources.length} 组联合）` : ''}
                </b>
              </div>
              <div className="kv">
                <span>频率范围</span>
                <b>
                  {fmt(dataRange?.lo, 1)} ~ {fmt(dataRange?.hi, 1)} Hz
                </b>
              </div>
              <div className="kv">
                <span>数据指纹</span>
                <b className="mono small">{dataset.hash}</b>
              </div>
            </div>
            <div>
              <div className="ai-grid2 ai-geometry">
                {(
                  [
                    ['D', '内径 D（mm）', 0.1],
                    ['L', '长度 L（mm）', 0.1],
                    ['t', '壁厚 t（mm）', 0.01],
                    ['fp', '孔隙度 f_p（Hz）', 1],
                  ] as const
                ).map(([key, label, stepv]) => (
                  <label className="field" key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      step={stepv}
                      value={geometry[key]}
                      onChange={(e) => setGeometry({ ...geometry, [key]: Number(e.target.value) })}
                    />
                  </label>
                ))}
              </div>
              <p className="settings-hint">
                几何参数将按 SI 换算后传给公式；f_p 作为供应商给定参数（不参与优化），可做 ±10% 敏感性检查。
              </p>
            </div>
          </div>
          <div className="ai-actions">
            <button className="btn-ghost sm" onClick={() => setStep(1)}>
              上一步
            </button>
            <button
              className="btn-primary sm"
              disabled={!(geometry.D > 0 && geometry.L > 0 && geometry.t > 0 && geometry.fp > 0)}
              onClick={() => {
                void archiveDataset();
                setStep(3);
              }}
            >
              下一步：参数与算法
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="settings-card">
          <h3>参数与算法</h3>
          {source === 'xlsx' && (
            <div className={`ai-archive${archive.status === 'error' ? ' error' : ''}`}>
              {archive.status === 'idle' && <span>导入数据将归档到 {TRAIN_CORE}</span>}
              {archive.status === 'saving' && <span>正在归档导入数据到 {TRAIN_CORE} …</span>}
              {archive.status === 'ok' && <span>导入数据已归档：{archive.dir}</span>}
              {archive.status === 'error' && <span>归档失败：{archive.message}</span>}
              {archive.status === 'error' && (
                <button className="btn-ghost sm" onClick={() => void archiveDataset()}>
                  重试归档
                </button>
              )}
            </div>
          )}
          <div className="ai-grid2">
            <div>
              <div className="ai-sub-title">
                标定参数（{baseStrategy.params.filter((p) => p.role === 'tunable').length} 可调 /{' '}
                {baseStrategy.params.filter((p) => p.role !== 'tunable').length} 固定）
              </div>
              <table className="ai-table">
                <thead>
                  <tr>
                    <th>参数</th>
                    <th>说明</th>
                    <th>参与标定</th>
                    <th className="num">初值</th>
                  </tr>
                </thead>
                <tbody>
                  {baseStrategy.params.map((p) => {
                    const disabled = p.role !== 'tunable';
                    const fixedVal =
                      p.key === 'f_p'
                        ? geometry.fp
                        : p.key === 'f_c'
                          ? geometry.fp
                          : p.initial;
                    return (
                      <tr key={p.key} className={disabled ? 'ai-row-fixed' : ''}>
                        <td className="mono">{p.key}</td>
                        <td>
                          {p.label}
                          <span className="ai-cell-tip">
                            {p.role === 'supplier'
                              ? '供应商给定'
                              : p.role === 'fixed'
                                ? '固定（方案指定）'
                                : `${p.transform === 'log' ? 'ln 变换' : 'scale 变换'} · 范围 [${fmt(p.min, p.min !== undefined ? 2 : 0)}, ${fmt(p.max, p.max !== undefined ? 2 : 0)}]`}
                          </span>
                        </td>
                        <td>
                          {disabled ? (
                            <span className="ai-disabled">—</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={!!paramOn[p.key]}
                              onChange={(e) => setParamOn({ ...paramOn, [p.key]: e.target.checked })}
                            />
                          )}
                        </td>
                        <td className="num">
                          {disabled ? (
                            <span>{fmt(fixedVal, 4)}</span>
                          ) : (
                            <input
                              type="number"
                              step={Math.abs(p.initial) > 10 ? 0.1 : 0.01}
                              value={paramInit[p.key] ?? p.initial}
                              onChange={(e) =>
                                setParamInit({ ...paramInit, [p.key]: Number(e.target.value) })
                              }
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="settings-hint">
                参数归一化（C_R 取 ln、其余按尺度缩放）已内置，避免量级差异导致步长失衡。
                切换模型版本会自动同步上表的参数行与勾选状态。
              </p>
            </div>
            <div>
              <div className="ai-sub-title">算法设置</div>
              <div className="ai-grid2">
                <label className="field">
                  <span>有效频带下限（Hz）</span>
                  <input type="number" value={minHz} onChange={(e) => setMinHz(Number(e.target.value))} />
                </label>
                <label className="field">
                  <span>有效频带上限（Hz）</span>
                  <input type="number" value={maxHz} onChange={(e) => setMaxHz(Number(e.target.value))} />
                </label>
                <label className="field">
                  <span>Huber δ（dB）</span>
                  <input
                    type="number"
                    step={0.1}
                    value={algo.huberDelta}
                    onChange={(e) => setAlgo({ ...algo, huberDelta: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>正则 λ</span>
                  <input
                    type="number"
                    step={0.0001}
                    value={algo.lambda}
                    onChange={(e) => setAlgo({ ...algo, lambda: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>峰值惩罚 λ_p</span>
                  <input
                    type="number"
                    step={0.01}
                    value={algo.lambdaPeak}
                    onChange={(e) => setAlgo({ ...algo, lambdaPeak: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>多起点数</span>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={algo.starts}
                    onChange={(e) => setAlgo({ ...algo, starts: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>Bootstrap 次数</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={algo.resamples}
                    onChange={(e) => setAlgo({ ...algo, resamples: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>随机种子</span>
                  <input type="number" value={algo.seed} onChange={(e) => setAlgo({ ...algo, seed: Number(e.target.value) })} />
                </label>
              </div>
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={algo.fast}
                  onChange={(e) => setAlgo({ ...algo, fast: e.target.checked })}
                />
                快速模式（跳过 bootstrap 与 f_p 敏感性，仅用于界面调试）
              </label>
              <p className="settings-hint">
                起点 = 1 个上一版初值 + {Math.max(0, algo.starts - 1)} 个拉丁超立方采样；&lt;100 Hz 频带权重 0.3。
              </p>
            </div>
          </div>
          <div className="ai-actions">
            <button className="btn-ghost sm" onClick={() => setStep(2)}>
              上一步
            </button>
            <span className="settings-hint">
              {runnable ? '预计数秒完成（12 起点 + 1000 次 bootstrap）' : '至少保留一个可标定参数'}
            </span>
            <button className="btn-ghost sm" disabled={!runnable} onClick={runPhaseFitting}>
              执行全流程 M0 → M1 → M2
            </button>
            <button className="btn-primary sm" disabled={!runnable} onClick={run}>
              开始优化（当前模型）
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <div>
          {running && (
            <section className="settings-card">
              <h3>
                {phaseProgress ? `分阶段拟合（${phaseProgress.i}/${phaseProgress.total}）` : '正在优化…'}
              </h3>
              {phaseProgress && (
                <p className="settings-hint">当前阶段：<b>{phaseProgress.name}</b></p>
              )}
              <div className="ai-progress">
                <i
                  style={{
                    width: `${
                      phaseProgress
                        ? Math.min(
                            96,
                            ((phaseProgress.i - 1 + Math.min(elapsed / 5000, 1)) /
                              phaseProgress.total) *
                              100,
                          )
                        : Math.min(96, 8 + elapsed / 60)
                    }%`,
                  }}
                />
              </div>
              <p className="settings-hint">
                已用时 {(elapsed / 1000).toFixed(1)} s，完成后自动显示结果。
              </p>
            </section>
          )}

          {runError && <div className="ai-error">{runError}</div>}

          {!running && !report && !runError && (
            <section className="settings-card">
              <p className="settings-hint">尚无结果，请返回第 3 步开始优化。</p>
            </section>
          )}

          {phaseReports && phaseReports.length > 0 && (
            <section className="settings-card">
              <h3>分阶段结果对比</h3>
              <table className="ai-table">
                <thead>
                  <tr>
                    <th>阶段</th>
                    <th>策略</th>
                    <th>频带</th>
                    <th className="num">RMSE (dB)</th>
                    <th className="num">MAE</th>
                    <th className="num">最大带误差</th>
                    <th className="num">峰值偏差</th>
                    <th>参数</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {phaseReports.map((rep, idx) => {
                    const cur = report && report.strategy.id === rep.strategy.id && report.dataset.id === rep.dataset.id;
                    const phaseName = ['M0', 'M1', 'M2'][idx] ?? `阶段${idx + 1}`;
                    const bandsDesc = `${rep.bands.filter((b) => b.included).length} 个有效带`;
                    return (
                      <tr key={idx} className={cur ? 'ai-row-active' : ''}>
                        <td className="mono">
                          <b>{phaseName}</b>
                        </td>
                        <td>{rep.strategy.id}</td>
                        <td>{bandsDesc}</td>
                        <td className={`num${rep.metrics.rmse > 1.5 ? ' bad' : ''}`}>
                          {fmt(rep.metrics.rmse, 3)}
                        </td>
                        <td className={`num${rep.metrics.mae > 1 ? ' bad' : ''}`}>
                          {fmt(rep.metrics.mae, 3)}
                        </td>
                        <td className={`num${rep.metrics.maxAbsBandErr > 3 ? ' bad' : ''}`}>
                          {fmt(rep.metrics.maxAbsBandErr, 3)}
                        </td>
                        <td className={`num${rep.metrics.peakFreqDevPct > 5 ? ' bad' : ''}`}>
                          {fmt(rep.metrics.peakFreqDevPct, 1)}%
                        </td>
                        <td className="mono small">
                          {rep.params.map((p) => `${p.key}=${fmt(p.value, 4)}`).join('，')}
                        </td>
                        <td>
                          <button
                            className="btn-ghost sm"
                            disabled={!!cur}
                            onClick={() => {
                              setReport(rep);
                              setRawPoints(points);
                              setActiveId(null);
                            }}
                          >
                            {cur ? '当前' : '加载'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="settings-hint">
                点「加载」将该阶段结果设为当前报告，可查看图形、导出或发布。
              </p>
            </section>
          )}

          {report && (
            <>
              <section className="settings-card">
                <h3>
                  标定结果
                  {activeRecord && (
                    <span className={STATUS_META[activeRecord.status].cls}>
                      {STATUS_META[activeRecord.status].text}
                    </span>
                  )}
                </h3>
                <div className="ai-metrics">
                  {[
                    ['RMSE', `${fmt(report.metrics.rmse, 2)} dB`, report.metrics.rmse <= 1.5],
                    ['MAE', `${fmt(report.metrics.mae, 2)} dB`, report.metrics.mae <= 1.0],
                    ['最大单带误差', `${fmt(report.metrics.maxAbsBandErr, 2)} dB`, report.metrics.maxAbsBandErr <= 3],
                    ['峰值频率偏差', `${fmt(report.metrics.peakFreqDevPct, 1)}%`, report.metrics.peakFreqDevPct <= 5],
                    ['条件数', fmt(report.diagnostics.conditionNumber, 2), report.diagnostics.conditionNumber < 1e8],
                  ].map(([label, value, pass]) => (
                    <div className={`ai-metric${pass ? '' : ' bad'}`} key={String(label)}>
                      <div className="k">{label}</div>
                      <div className="v">{value}</div>
                    </div>
                  ))}
                </div>
                {sourceMetrics.length > 1 && (
                  <div className="ai-source-metrics">
                    <p className="settings-hint">
                      各数据源指标（固定联合最优参数后逐条复算，超出阈值的数值标红）
                    </p>
                    <table className="ai-table">
                      <thead>
                        <tr>
                          <th>数据源</th>
                          <th className="num">点数</th>
                          <th className="num">有效频带</th>
                          <th className="num">RMSE (dB)</th>
                          <th className="num">MAE (dB)</th>
                          <th className="num">最大单带误差 (dB)</th>
                          <th className="num">峰值频率偏差 (%)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sourceMetrics.map((m) => (
                          <tr key={m.id}>
                            <td>{m.id}</td>
                            <td className="num">{m.points}</td>
                            <td className="num">{m.bands}</td>
                            <td className={`num${m.rmse <= 1.5 ? '' : ' bad'}`}>{fmt(m.rmse, 2)}</td>
                            <td className={`num${m.mae <= 1.0 ? '' : ' bad'}`}>{fmt(m.mae, 2)}</td>
                            <td className={`num${m.maxAbsBandErr <= 3 ? '' : ' bad'}`}>
                              {fmt(m.maxAbsBandErr, 2)}
                            </td>
                            <td
                              className={`num${
                                !Number.isFinite(m.peakFreqDevPct) || m.peakFreqDevPct <= 5 ? '' : ' bad'
                              }`}
                            >
                              {Number.isFinite(m.peakFreqDevPct) ? fmt(m.peakFreqDevPct, 1) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="settings-hint">
                  数据集 {datasetTitle(report.dataset, reportSources)}· 有效频带{' '}
                  {report.bands.filter((b) => b.included).length} 个 · 目标 J = {fmt(report.objective.J, 4)} ·
                  参数 {report.params.map((p) => `${p.key}=${fmt(p.value, 4)}`).join('，')}
                </p>
              </section>

              <section className="settings-card">
                <h3>拟合曲线</h3>
                <div className="ai-chart" dangerouslySetInnerHTML={{ __html: fitSvg }} />
              </section>

              <section className="settings-card">
                <h3>逐带残差</h3>
                <div className="ai-chart" dangerouslySetInnerHTML={{ __html: residualSvg }} />
              </section>

              <section className="settings-card">
                <h3>参数估计</h3>
                <table className="ai-table">
                  <thead>
                    <tr>
                      <th>参数</th>
                      <th className="num">初值</th>
                      <th className="num">估计值</th>
                      <th className="num">标准误</th>
                      <th className="num">95% CI（解析）</th>
                      <th className="num">95% CI（bootstrap）</th>
                      <th>贴边</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.params.map((p) => (
                      <tr key={p.key}>
                        <td>
                          <span className="mono">{p.key}</span>
                          <span className="ai-cell-tip">{p.label}</span>
                        </td>
                        <td className="num">{fmt(p.initial, 4)}</td>
                        <td className="num">
                          <b>{fmt(p.value, 4)}</b>
                        </td>
                        <td className="num">{fmt(p.stdErr, 4)}</td>
                        <td className="num">
                          [{fmt(p.ci95[0], 4)}, {fmt(p.ci95[1], 4)}]
                        </td>
                        <td className="num">
                          {p.ciBootstrap ? `[${fmt(p.ciBootstrap[0], 4)}, ${fmt(p.ciBootstrap[1], 4)}]` : '—'}
                        </td>
                        <td>{p.atBound ? <span className="tag tag-warn">是</span> : '否'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.sensitivity.length > 0 && (
                  <p className="settings-hint">
                    f_p 敏感性：
                    {report.sensitivity
                      .map((s) => `${s.fpScale}× → RMSE ${fmt(s.rmse, 2)} dB`)
                      .join('；')}
                    。验证状态：
                    {report.validation.status === 'validated' ? '已验证' : '仅标定（单工况，不声明验证）'}。
                  </p>
                )}
              </section>

              <section className="settings-card">
                <h3>告警与采纳</h3>
                {report.warnings.length === 0 ? (
                  <p className="settings-hint">无告警。</p>
                ) : (
                  <ul className="ai-warnings">
                    {report.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                <label className="field ai-note">
                  <span>采纳说明（写入标定记录）</span>
                  <input
                    type="text"
                    placeholder="例如：基于 test1.xlsx 复标，作为 v3.1 候选系数"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <div className="ai-actions ai-actions-wrap">
                  {onBack && step === 4 && (
                    <button className="btn-ghost sm" onClick={onBack} title="回到工作台">
                      ← 返回工作台
                    </button>
                  )}
                  {step === 4 && report && (
                    <button className="btn-ghost sm" onClick={() => setStep(3)} title="回到参数与算法">
                      ← 回到步骤 3（参数 / 算法）
                    </button>
                  )}
                  {(() => {
                    const cur = CURRENT_MODEL_FROM_REPORT();
                    const next = NEXT_MODEL[cur];
                    if (!next) {
                      return (
                        <button className="btn-ghost sm" disabled title="M2 已是最高模型">
                          M2 · 已是最高模型
                        </button>
                      );
                    }
                    return (
                      <button className="btn-primary sm" onClick={upgradeToNextModel}>
                        升级到 {next}（继承当前参数）
                      </button>
                    );
                  })()}
                  <button className="btn-ghost sm" disabled={lockedRecord} onClick={() => upsert('draft')}>
                    保存草稿
                  </button>
                  <button className="btn-primary sm" disabled={lockedRecord} onClick={() => upsert('reviewed')}>
                    标记审核通过
                  </button>
                  <button
                    className="btn-primary sm"
                    disabled={!!publishBlocked || activeRecord?.status !== 'reviewed'}
                    title={
                      activeRecord?.status === 'released'
                        ? '该版本已发布'
                        : activeRecord?.status !== 'reviewed'
                          ? '请先保存并标记审核通过'
                          : ''
                    }
                    onClick={() => upsert('released')}
                  >
                    发布为生效系数
                  </button>
                  <button className="btn-ghost sm" onClick={exportChartHtml}>
                    导出图形（HTML）
                  </button>
                  <button
                    className="btn-ghost sm"
                    onClick={() =>
                      saveFile(`编织管标定报告-${stamp()}.md`, renderReportMarkdown(report))
                    }
                  >
                    导出报告（MD）
                  </button>
                  <button
                    className="btn-ghost sm"
                    onClick={() =>
                      saveFile(`编织管标定结果-${stamp()}.json`, JSON.stringify(report, null, 2))
                    }
                  >
                    导出数据（JSON）
                  </button>
                </div>
                {publishBlocked && <div className="ai-error">{publishBlocked}</div>}
                {lockedRecord && (
                  <p className="settings-hint">
                    当前查看的是已发布 / 已归档版本，状态不可回退；如需新版本请重新运行标定。
                  </p>
                )}
                <p className="settings-hint">
                  「发布」后同一公式只保留一个生效版本，软件计算与计算书将使用新系数；未发布时仍用内置默认值
                  C_R=0.4210012、A_L=30.4643、B_L=−26.131。
                </p>
              </section>
            </>
          )}

          <section className="settings-card">
            <h3>
              标定记录
              <span className="ai-hint">草稿 → 审核 → 发布；发布版本随软件启动加载</span>
            </h3>
            {records.length === 0 ? (
              <p className="settings-hint">暂无记录。</p>
            ) : (
              <table className="ai-table">
                <thead>
                  <tr>
                    <th>创建时间</th>
                    <th>数据集</th>
                    <th>参数</th>
                    <th>RMSE</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className={r.id === activeId ? 'ai-row-active' : ''}>
                      <td>{new Date(r.createdAt).toLocaleString()}</td>
                      <td>
                        {r.datasetId}
                        <span className="ai-cell-tip">
                          {r.source === 'lab' ? '实验库' : 'Excel'} · D{r.geometry.D}/L{r.geometry.L}/t{r.geometry.t}
                        </span>
                      </td>
                      <td className="mono small">
                        {r.params.map((p) => `${p.key}=${fmt(p.value, 4)}`).join('，')}
                      </td>
                      <td className="num">{fmt(r.metrics.rmse, 2)} dB</td>
                      <td>
                        <span className={STATUS_META[r.status].cls}>{STATUS_META[r.status].text}</span>
                      </td>
                      <td className="ai-row-actions">
                        <button className="btn-link" onClick={() => viewRecord(r)}>
                          查看
                        </button>
                        {r.status === 'draft' && (
                          <button className="btn-link" onClick={() => setRecordStatus(r, 'reviewed')}>
                            审核
                          </button>
                        )}
                        {r.status === 'reviewed' && (
                          <button
                            className="btn-link"
                            disabled={r.report.optimizer.multiSolution || r.report.diagnostics.activeConstraints.length > 0}
                            title={
                              r.report.optimizer.multiSolution || r.report.diagnostics.activeConstraints.length > 0
                                ? '存在多解或参数贴边，不建议发布'
                                : ''
                            }
                            onClick={() => setRecordStatus(r, 'released')}
                          >
                            发布
                          </button>
                        )}
                        <button className="btn-link danger" onClick={() => removeRecord(r)}>
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
