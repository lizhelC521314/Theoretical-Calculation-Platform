import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormulaSpec } from '../formula/types';
import { DOMAIN_LABEL, FORMULA_STATUS_LABEL, showIfMatches } from '../formula/types';
import { UNIT_GROUPS, autoUnit, formatNumber, fromSI } from '../formula/units';
import { computeFormula } from '../formula/compute';
import { getFormula } from '../formula/registry';
import { applyLinkTransform, upstreamLinks, type FormulaLink } from '../formula/links';
import { ParamForm } from '../components/ParamForm';
import {
  bindFieldLabel,
  loadMaterialOptions,
  materialOptionLabel,
  resolveBindTemperature,
  type MaterialOption,
} from '../formula/materialBinding';
import { FormulaView } from '../components/FormulaView';
import { ResultPanel } from '../components/ResultPanel';
import { ChainPanel } from '../components/ChainPanel';
import { SensitivityChart } from '../components/SensitivityChart';
import { UncertaintyPanel } from '../components/UncertaintyPanel';
import { BacksolvePanel } from '../components/BacksolvePanel';
import { ExplorePanel } from '../components/ExplorePanel';
import { CurveChart } from '../components/CurveChart';
import { api, type CtrUser, type HistoryEntry, type Project } from '../api';
import { attachCalcRef, buildCalcParams, buildCalcRef, modelOptions, type ModelOption } from '../product/calcRef';
import { MODEL_STATUS_LABEL } from '../product/types';
import { IS_STANDARD } from '../edition';

interface Props {
  formula: FormulaSpec;
  user: CtrUser;
  /** 当前绑定项目；null 表示临时计算 */
  project: Project | null;
  onBack: () => void;
  /** 打开其他公式（组合链路的上/下游跳转） */
  onOpenFormula: (f: FormulaSpec) => void;
}

/** 按公式元数据生成初始参数值与单位选择（单位按输入项各自记录，互不影响） */
function initialValues(formula: FormulaSpec) {
  const values: Record<string, number> = {};
  const units: Record<string, string> = {};
  for (const p of formula.inputs) {
    values[p.key] = p.default ?? 0;
    if (p.unitGroup) {
      const g = UNIT_GROUPS[p.unitGroup];
      const has = g?.units.some((u) => u.label === p.unit);
      units[p.key] = has ? p.unit : g?.units[0].label ?? p.unit;
    }
  }
  return { values, units };
}

/** 输入防抖：击键只更新输入框，计算与图表延后到停顿后再跑，避免每次按键触发整链重算 */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** 历史记录时间戳（UTC ISO）转本地时间显示 */
function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.replace('T', ' ').slice(0, 16);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function CalculatorPage({ formula, user, project, onBack, onOpenFormula }: Props) {
  const init = useMemo(() => initialValues(formula), [formula]);
  const [values, setValues] = useState<Record<string, number>>(init.values);
  const [units, setUnits] = useState<Record<string, string>>(init.units);
  /** 材料库候选：undefined = 加载中 / 未加载，空数组 = 不可用 */
  const [materials, setMaterials] = useState<MaterialOption[] | undefined>(undefined);
  /** 可绑定参数 → 已选材料文件路径 */
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [toast, setToast] = useState('');
  /** 存入产品型号：选择面板、候选型号与写入状态 */
  const [savePanel, setSavePanel] = useState(false);
  const [modelOpts, setModelOpts] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [savingModel, setSavingModel] = useState(false);

  // 仅当公式声明了材料绑定时才读取材料库（网络共享目录，避免无谓等待）
  const hasBind = useMemo(() => formula.inputs.some((p) => p.bind), [formula]);
  useEffect(() => {
    setBindings({});
    if (!hasBind) return;
    let alive = true;
    setMaterials(undefined);
    loadMaterialOptions().then((list) => {
      if (alive) setMaterials(list);
    });
    return () => {
      alive = false;
    };
  }, [formula, hasBind]);

  /** 组合链路：上游公式 id → 最近一次保存的计算记录 */
  const [chainRecords, setChainRecords] = useState<Record<string, HistoryEntry>>({});
  const upstreamIds = useMemo(
    () => [...new Set(upstreamLinks(formula.id).map((l) => l.from))],
    [formula],
  );
  useEffect(() => {
    if (upstreamIds.length === 0) {
      setChainRecords({});
      return;
    }
    let alive = true;
    api.history
      .list(user.id)
      .then((list) => {
        if (!alive) return;
        const pick: Record<string, HistoryEntry> = {};
        for (const id of upstreamIds) {
          const candidates = list.filter((h) => h.formulaId === id);
          // 优先当前项目内的记录，其次回落到该用户全部记录
          const inProject = project ? candidates.filter((h) => h.projectId === project.id) : [];
          const rec = (inProject.length ? inProject : candidates).sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          )[0];
          if (rec) pick[id] = rec;
        }
        setChainRecords(pick);
      })
      .catch(() => {
        if (alive) setChainRecords({});
      });
    return () => {
      alive = false;
    };
  }, [upstreamIds, user.id, project?.id]);

  // ---------- 引用其他公式的历史计算记录（refRecord） ----------
  /** 当前公式实际引用的公式 id（如赫姆霍兹消音器记录） */
  const refFormulaIds = useMemo(
    () => [...new Set(formula.inputs.filter((p) => p.refRecord).map((p) => p.refRecord!.formulaId))],
    [formula],
  );
  /** 各引用公式的当前用户记录（按时间倒序） */
  const [refRecords, setRefRecords] = useState<Record<string, HistoryEntry[]>>({});
  const refToastRef = useRef('');
  useEffect(() => {
    refToastRef.current = '';
    if (refFormulaIds.length === 0) {
      setRefRecords({});
      return;
    }
    let alive = true;
    api.history
      .list(user.id)
      .then((list) => {
        if (!alive) return;
        const pick: Record<string, HistoryEntry[]> = {};
        for (const id of refFormulaIds) {
          pick[id] = list
            .filter((h) => h.formulaId === id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        }
        setRefRecords(pick);
      })
      .catch(() => {
        if (alive) setRefRecords({});
      });
    return () => {
      alive = false;
    };
  }, [refFormulaIds, user.id]);

  /** 记录下拉选项：value 取记录创建时间戳（跨保存稳定），label 带 f0 便于识别 */
  const selectOptions = useMemo(() => {
    const defs = formula.inputs.filter((p) => p.refRecord);
    if (defs.length === 0) return undefined;
    const out: Record<string, { value: number; label: string }[]> = {};
    for (const p of defs) {
      const list = refRecords[p.refRecord!.formulaId];
      const outDef = p.refRecord!.labelOutput;
      out[p.key] = [
        { value: 0, label: list && list.length === 0 ? '未选择（暂无已保存的记录）' : '未选择' },
        ...(list ?? []).map((h) => {
          const val = outDef ? Number((h.outputs as Record<string, unknown>)?.[outDef.key]) : NaN;
          const t = formatLocalTime(h.createdAt);
          const summary = outDef && Number.isFinite(val)
            ? ` · ${outDef.name}=${val.toFixed(1)}${outDef.unit ? ` ${outDef.unit}` : ''}`
            : '';
          return {
            value: Date.parse(h.createdAt),
            label: `${t}${summary}`,
          };
        }),
      ];
    }
    return out;
  }, [formula, refRecords]);

  /** 选中记录后回填派生快照；记录失效时清空快照（solve 自动回退内置公式）并提示 */
  useEffect(() => {
    const defs = formula.inputs.filter((p) => p.refRecord);
    if (defs.length === 0) return;
    const patch: Record<string, number> = {};
    for (const p of defs) {
      const ts = values[p.key] ?? 0;
      const list = refRecords[p.refRecord!.formulaId];
      if (!list) continue; // 尚未加载完成，不做失效判断
      const rec = ts > 0 ? list.find((h) => Date.parse(h.createdAt) === ts) : undefined;
      let snap: Record<string, number> | null = null;
      if (rec) {
        const si = (rec.inputs as { inputsSI?: Record<string, number> })?.inputsSI;
        snap = si ? p.refRecord!.derive(si) : null;
      } else if (ts > 0) {
        const token = `${p.key}:${ts}`;
        if (refToastRef.current !== token) {
          refToastRef.current = token;
          showToast(`「${p.label}」引用的记录已失效，已回退为内置公式`);
        }
      }
      for (const [rk, target] of Object.entries(p.refRecord!.snapshot)) {
        const val = snap?.[rk];
        const next = Number.isFinite(val) ? (val as number) : 0;
        if (values[target] !== next) patch[target] = next;
      }
    }
    if (Object.keys(patch).length > 0) setValues((prev) => ({ ...prev, ...patch }));
  }, [values, refRecords, formula]);

  // 三栏宽度持久化
  const [leftW, setLeftW] = useState<number>(() => {
    const v = window.localStorage.getItem('ctr.calcLeftWidth');
    const n = v ? Number(v) : 340;
    return Number.isFinite(n) && n >= 220 && n <= 520 ? n : 340;
  });
  const [rightW, setRightW] = useState<number>(() => {
    const v = window.localStorage.getItem('ctr.calcRightWidth');
    const n = v ? Number(v) : 400;
    return Number.isFinite(n) && n >= 280 && n <= 580 ? n : 400;
  });
  useEffect(() => { window.localStorage.setItem('ctr.calcLeftWidth', String(leftW)); }, [leftW]);
  useEffect(() => { window.localStorage.setItem('ctr.calcRightWidth', String(rightW)); }, [rightW]);

  useEffect(() => {
    const next = initialValues(formula);
    setValues(next.values);
    setUnits(next.units);
    setToast('');
  }, [formula]);

  // 温度单位切换时同步换算该输入的值（℃ ↔ K 为平移关系，不能按倍率换算）
  const handleUnitsChange = useCallback(
    (next: Record<string, string>) => {
      const changed = Object.keys(next).find((k) => units[k] !== next[k]);
      const p = formula.inputs.find((x) => x.key === changed);
      if (p?.unitGroup === 'temperature' && changed) {
        const from = units[changed];
        setValues((prev) => {
          const out = { ...prev };
          const v = out[changed];
          if (typeof v === 'number' && !Number.isNaN(v)) {
            out[changed] = from === '℃' ? v + 273.15 : v - 273.15;
          }
          return out;
        });
      }
      setUnits(next);
    },
    [formula, units],
  );

  /**
   * 输入校验 + 换算到 SI 并求解（统一入口，见 formula/compute.ts）。
   * 基于防抖后的输入：输入框即时响应，结果区与图表在停顿后刷新。
   * 保存/导出走 computeCurrent()，始终读取当前输入，不会写出滞后值。
   */
  const calcValues = useDebounced(values, 150);
  const calcUnits = useDebounced(units, 150);
  const computed = useMemo(
    () => computeFormula(formula, calcValues, calcUnits),
    [formula, calcValues, calcUnits],
  );

  /** 立即按当前输入求解：保存/导出前调用，避免防抖窗口内写出上一组参数 */
  const computeCurrent = () => computeFormula(formula, values, units);

  const showToast = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 2400);
  };

  /** 反算结果回填：写入显示值；手工填入即视为脱离材料绑定（与 ParamForm 行为一致） */
  const applyBacksolve = (key: string, displayValue: number) => {
    setValues((prev) => ({ ...prev, [key]: displayValue }));
    setBindings((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const p = formula.inputs.find((x) => x.key === key);
    showToast(`${p?.label ?? key} 已按反算值回填`);
  };

  /** 组合链路：把上游最近一次保存的输出按链路变换带入当前输入 */
  const applyLink = (link: FormulaLink) => {
    const raw = chainRecords[link.from]?.outputs?.[link.output];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      showToast('上游公式尚无可用结果，请先完成并保存上游计算');
      return;
    }
    const si = applyLinkTransform(link, raw);
    const p = formula.inputs.find((x) => x.key === link.input);
    if (!p || !Number.isFinite(si)) {
      showToast('链路值无法带入，请检查上游结果');
      return;
    }
    const unitLabel = p.unitGroup ? units[p.key] ?? p.unit : p.unit;
    const v = p.unitGroup ? fromSI(si, p.unitGroup, unitLabel) : si;
    setValues((prev) => ({ ...prev, [p.key]: Number(v.toPrecision(6)) }));
    // 带入即脱离材料绑定，避免下次温度变化时覆盖链路值
    setBindings((prev) => {
      if (!(p.key in prev)) return prev;
      const next = { ...prev };
      delete next[p.key];
      return next;
    });
    const from = getFormula(link.from);
    const outLabel = from?.outputs.find((o) => o.key === link.output)?.label ?? link.output;
    showToast(`${from?.title ?? link.from} 的「${outLabel}」已带入 ${p.label}`);
  };

  /** 材料绑定明细：记录哪个输入取自哪条材料的哪个物性，用于历史追溯与计算书导出 */
  const bindingDetails = useMemo(() => {
    const rows: Array<{ key: string; fieldLabel: string; material: string; filePath: string }> = [];
    for (const [key, filePath] of Object.entries(bindings)) {
      if (!filePath) continue;
      const p = formula.inputs.find((x) => x.key === key);
      const opt = materials?.find((m) => m.filePath === filePath);
      if (!p?.bind || !opt) continue;
      const temp = resolveBindTemperature(p.bind, formula.inputs, values, units);
      rows.push({
        key,
        fieldLabel: bindFieldLabel(opt.rec, p.bind.field, temp),
        material: materialOptionLabel(opt.rec),
        filePath,
      });
    }
    return rows;
  }, [bindings, formula, materials, values, units]);

  const saveHistory = async () => {
    const current = computeCurrent();
    if (!current.ok || !current.inputsSI || !current.outputsSI) {
      showToast('输入参数不完整，请检查后重试');
      return;
    }
    await api.history.save(historyPayload(current));
    showToast(project ? `已保存到项目「${project.name}」` : '已保存到计算记录（临时计算）');
  };

  /** 计算记录的公共载荷：保存记录与存入型号共用，保证两者内容一致 */
  const historyPayload = (c: ReturnType<typeof computeFormula> = computed) => ({
    userId: user.id,
    username: user.displayName || user.username,
    projectId: project?.id ?? null,
    formulaId: formula.id,
    formulaTitle: formula.title,
    formulaVersion: formula.version,
    formulaStatus: formula.status,
    domain: DOMAIN_LABEL[formula.domain],
    inputs: { values, units, inputsSI: c.inputsSI ?? {}, materialBindings: bindingDetails },
    outputs: c.outputsSI ?? {},
    note: '',
  });

  /** 存入产品型号：先落一条计算记录，再把记录快照与输出参数挂到型号上 */
  const saveToModel = async () => {
    const current = computeCurrent();
    if (!current.ok || !current.inputsSI || !current.outputsSI) {
      showToast('输入参数不完整，请检查后重试');
      return;
    }
    const target = modelOpts.find((m) => m.id === selectedModel);
    if (!target) {
      showToast('请选择要存入的产品型号');
      return;
    }
    if (target.status === 'obsolete') {
      showToast('该型号已停产，不能再存入计算记录');
      return;
    }
    // 已发布型号的基线已固化，存入新计算属于设计变更，需退回草稿重新走发布门禁
    const demote = target.status === 'released';
    if (
      demote &&
      !window.confirm(
        `型号 ${target.id} 当前为「已发布」，已发布基线不会被自动更新。\n存入后该型号将退回「草稿」状态，需重新通过发布门禁才能再次发布。是否继续？`,
      )
    ) {
      return;
    }
    setSavingModel(true);
    try {
      const res = await api.history.save(historyPayload(current));
      const store = await api.product.get();
      const model = store?.models.find((m) => m.id === target.id);
      if (!store || !model) {
        showToast('读取产品定义库失败，请重试');
        return;
      }
      const ref = buildCalcRef(res.entry);
      const params = buildCalcParams(formula.outputs, ref, model.params.map((p) => p.key));
      const next = {
        ...store,
        models: store.models.map((m) =>
          m.id === model.id ? { ...attachCalcRef(m, ref, params), status: demote ? 'draft' : m.status } : m,
        ),
      };
      const saved = await api.product.set(next);
      if (!saved.ok) {
        showToast('写入产品定义库失败');
        return;
      }
      if (demote) setModelOpts((prev) => prev.map((m) => (m.id === target.id ? { ...m, status: 'draft' } : m)));
      setSavePanel(false);
      const head = params.length
        ? `已存入 ${target.id}，新增 ${params.length} 个关键参数`
        : `已存入 ${target.id}（参数已存在，仅追加计算记录）`;
      showToast(`${head}${demote ? '；型号已退回草稿，需重新发布' : ''}`);
    } finally {
      setSavingModel(false);
    }
  };

  /** 打开型号选择面板时再读产品定义库，避免每次进入计算页都读盘 */
  const openSavePanel = async () => {
    setSavePanel(true);
    const store = await api.product.get();
    const opts = modelOptions(store);
    setModelOpts(opts);
    if (!selectedModel) {
      const first = opts.find((m) => m.status !== 'obsolete');
      if (first) setSelectedModel(first.id);
    }
  };

  const exportCsv = async () => {
    const current = computeCurrent();
    if (!current.ok || !current.inputsSI || !current.outputsSI) {
      showToast('输入参数不完整，请检查后重试');
      return;
    }
    const inputsSI = current.inputsSI;
    const outputsSI = current.outputsSI;
    const lines: string[] = [];
    lines.push(`公式,${formula.title}`);
    lines.push(`公式编号,${formula.id}`);
    lines.push(`公式版本,v${formula.version}（${FORMULA_STATUS_LABEL[formula.status]}）`);
    lines.push(`计算人,${user.displayName || user.username}`);
    lines.push(`计算时间,${new Date().toLocaleString('zh-CN')}`);
    lines.push('');
    lines.push('输入参数,符号,数值,单位,SI值');
    for (const p of formula.inputs) {
      const unitLabel = p.unitGroup ? units[p.key] ?? p.unit : p.unit;
      lines.push(`${p.label},${p.symbol},${values[p.key]},${unitLabel},${inputsSI[p.key]}`);
    }
    lines.push('');
    if (bindingDetails.length) {
      lines.push('材料绑定,参数,物性字段,材料（牌号 · 系列号 · 温度）');
      for (const b of bindingDetails) {
        const p = formula.inputs.find((x) => x.key === b.key);
        lines.push(`${p?.label ?? b.key},${b.fieldLabel},${b.material}`);
      }
      lines.push('');
    }
    lines.push('输出结果,符号,数值,单位,SI值');
    // 与结果区一致：按 showIf 隐藏未参与计算的输出（参数均为无量纲/个数，SI 值与界面值一致）
    const visibleOutputs = formula.outputs.filter((o) => showIfMatches(o.showIf, inputsSI));
    for (const o of visibleOutputs) {
      const raw = outputsSI[o.key];
      const { value, unit } = o.unitGroup ? autoUnit(raw, o.unitGroup) : { value: raw, unit: o.unit };
      lines.push(`${o.label},${o.symbol},${formatNumber(value, o.digits ?? 3)},${unit},${raw}`);
    }
    lines.push('');
    if (formula.standardRefs && formula.standardRefs.length) {
      lines.push('标准依据');
      for (const s of formula.standardRefs) {
        lines.push(`${s.code},${s.title}${s.clause ? `,${s.clause}` : ''}`);
      }
      lines.push('');
    }
    lines.push('适用条件与假设');
    for (const a of formula.assumptions) lines.push(`"${a}"`);
    const res = await api.file.save({
      defaultName: `${formula.id.replace(/\./g, '_')}_计算记录.csv`,
      content: '\ufeff' + lines.join('\n'),
    });
    if (res.ok) showToast('计算书已导出');
  };

  // 左栏 ↔ 中栏 拖动（rAF 合并高频 mousemove）
  const handleLeftResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX, startW = leftW;
      const minW = 220, maxW = 520;
      let pending = startW;
      let raf = 0;
      const onMove = (ev: MouseEvent) => {
        pending = Math.min(maxW, Math.max(minW, startW + (ev.clientX - startX)));
        if (raf) return;
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          setLeftW(pending);
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (raf) {
          window.cancelAnimationFrame(raf);
          raf = 0;
        }
        setLeftW(pending);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [leftW],
  );

  // 中栏 ↔ 右栏 拖动（rAF 合并高频 mousemove）
  const handleRightResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX, startW = rightW;
      const minW = 280, maxW = 580;
      let pending = startW;
      let raf = 0;
      const onMove = (ev: MouseEvent) => {
        pending = Math.min(maxW, Math.max(minW, startW - (ev.clientX - startX)));
        if (raf) return;
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          setRightW(pending);
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (raf) {
          window.cancelAnimationFrame(raf);
          raf = 0;
        }
        setRightW(pending);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [rightW],
  );

  return (
    <div className="calc-page">
      <div className="calc-toolbar">
        <button className="btn-back" onClick={onBack}>
          ← 返回公式库
        </button>
        <div className="calc-title">
          {formula.title}
          <span className="tag domain">{DOMAIN_LABEL[formula.domain]}</span>
        </div>
        <div className="calc-actions">
          <button className="btn-ghost" onClick={saveHistory} disabled={!computed.ok}>
            保存到记录
          </button>
          <button
            className="btn-ghost"
            onClick={() => (savePanel ? setSavePanel(false) : void openSavePanel())}
            disabled={!computed.ok}
          >
            存入产品型号
          </button>
          <button className="btn-primary sm" onClick={exportCsv} disabled={!computed.ok}>
            导出计算书
          </button>
        </div>
      </div>

      {savePanel && (
        <div className="calc-save-model">
          <span className="csm-label">存入产品型号</span>
          <select
            className="tu-project"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            {modelOpts.length === 0 && <option value="">产品定义库中还没有型号</option>}
            {modelOpts.map((m) => (
              <option key={m.id} value={m.id} disabled={m.status === 'obsolete'}>
                {m.familyName} / {m.id} · {m.name}（{MODEL_STATUS_LABEL[m.status]}）
              </option>
            ))}
          </select>
          <button
            className="btn-primary sm"
            onClick={saveToModel}
            disabled={savingModel || !selectedModel || !computed.ok}
          >
            {savingModel ? '写入中…' : '确认存入'}
          </button>
          <button className="btn-ghost sm" onClick={() => setSavePanel(false)}>
            取消
          </button>
          <span className="csm-hint">
            {modelOpts.length === 0
              ? '请先到「知识理论 → 产品定义库」创建产品族与型号'
              : '存入会追加一条计算记录并补充关键参数；结论为「待判定」，需到型号「计算与校核」页确认；已发布型号会退回草稿'}
          </span>
        </div>
      )}

      <div
        className="calc-body"
        style={{
          gridTemplateColumns: IS_STANDARD
            ? `${leftW}px 4px minmax(0, 1fr)`
            : `${leftW}px 4px minmax(0, 1fr) 4px ${rightW}px`,
        }}
      >
        <div className="calc-col left">
          <ParamForm
            formula={formula}
            values={values}
            units={units}
            onValuesChange={setValues}
            onUnitsChange={handleUnitsChange}
            materials={materials}
            bindings={bindings}
            onBindingsChange={setBindings}
            selectOptions={selectOptions}
          />
        </div>

        <div className="sidebar-resizer" onMouseDown={handleLeftResize} />

        {/* 标准版不展示公式说明栏，保留「参数输入 — 计算结果」两栏 */}
        {!IS_STANDARD && (
          <>
            <div className="calc-col middle">
              <FormulaView formula={formula} values={calcValues} />
            </div>

            <div className="sidebar-resizer" onMouseDown={handleRightResize} />
          </>
        )}

        <div className="calc-col right">
          {IS_STANDARD && formula.diagram && (
            <div className="result-block calc-diagram">
              <h3 className="panel-title">计算简图</h3>
              <div className="diagram-box" dangerouslySetInnerHTML={{ __html: formula.diagram }} />
            </div>
          )}
          <ResultPanel
            formula={formula}
            outputsSI={computed.ok ? computed.outputsSI ?? null : null}
            inputsSI={computed.ok ? computed.inputsSI ?? null : null}
            issues={computed.issues}
          />
          <ChainPanel
            formula={formula}
            records={chainRecords}
            onApply={applyLink}
            onOpen={(id) => {
              const target = getFormula(id);
              if (target) onOpenFormula(target);
            }}
          />
          {/* 结果 → 结果曲线 → 参数敏感性分析；兄弟组件使用不同 key，避免 React 重复/遗漏子节点 */}
          {formula.curve && computed.ok && computed.inputsSI && (
            <CurveChart key={`curve-${formula.id}`} spec={formula.curve} inputsSI={computed.inputsSI} />
          )}
          <SensitivityChart
            key={`sensitivity-${formula.id}`}
            formula={formula}
            inputsSI={computed.ok ? computed.inputsSI ?? null : null}
          />
          <UncertaintyPanel formula={formula} inputsSI={computed.ok ? computed.inputsSI ?? null : null} />
          <BacksolvePanel
            formula={formula}
            inputsSI={computed.ok ? computed.inputsSI ?? null : null}
            units={units}
            onApply={applyBacksolve}
          />
          <ExplorePanel
            formula={formula}
            inputsSI={computed.ok ? computed.inputsSI ?? null : null}
            units={units}
          />
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
