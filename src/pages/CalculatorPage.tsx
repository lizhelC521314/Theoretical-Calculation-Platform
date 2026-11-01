import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormulaSpec } from '../formula/types';
import { DOMAIN_LABEL } from '../formula/types';
import { UNIT_GROUPS, autoUnit, formatNumber, toSI } from '../formula/units';
import { ParamForm } from '../components/ParamForm';
import { FormulaView } from '../components/FormulaView';
import { ResultPanel } from '../components/ResultPanel';
import { SensitivityChart } from '../components/SensitivityChart';
import { CurveChart } from '../components/CurveChart';
import { api, type CtrUser, type Project } from '../api';

interface Props {
  formula: FormulaSpec;
  user: CtrUser;
  /** 当前绑定项目；null 表示临时计算 */
  project: Project | null;
  onBack: () => void;
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

export function CalculatorPage({ formula, user, project, onBack }: Props) {
  const init = useMemo(() => initialValues(formula), [formula]);
  const [values, setValues] = useState<Record<string, number>>(init.values);
  const [units, setUnits] = useState<Record<string, string>>(init.units);
  const [toast, setToast] = useState('');

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

  /** 输入换算到 SI 并求解 */
  const computed = useMemo(() => {
    const inputsSI: Record<string, number> = {};
    for (const p of formula.inputs) {
      const raw = values[p.key];
      if (typeof raw !== 'number' || Number.isNaN(raw)) return null;
      const unitLabel = p.unitGroup ? units[p.key] ?? p.unit : p.unit;
      inputsSI[p.key] = toSI(raw, p.unitGroup, unitLabel);
    }
    try {
      return { inputsSI, outputsSI: formula.solve(inputsSI) };
    } catch {
      return null;
    }
  }, [formula, values, units]);

  const showToast = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 2400);
  };

  const saveHistory = async () => {
    if (!computed) return;
    await api.history.save({
      userId: user.id,
      username: user.displayName || user.username,
      projectId: project?.id ?? null,
      formulaId: formula.id,
      formulaTitle: formula.title,
      domain: DOMAIN_LABEL[formula.domain],
      inputs: { values, units, inputsSI: computed.inputsSI },
      outputs: computed.outputsSI,
      note: '',
    });
    showToast(project ? `已保存到项目「${project.name}」` : '已保存到计算记录（临时计算）');
  };

  const exportCsv = async () => {
    if (!computed) return;
    const lines: string[] = [];
    lines.push(`公式,${formula.title}`);
    lines.push(`公式编号,${formula.id}`);
    lines.push(`计算人,${user.displayName || user.username}`);
    lines.push(`计算时间,${new Date().toLocaleString('zh-CN')}`);
    lines.push('');
    lines.push('输入参数,符号,数值,单位,SI值');
    for (const p of formula.inputs) {
      const unitLabel = p.unitGroup ? units[p.key] ?? p.unit : p.unit;
      lines.push(`${p.label},${p.symbol},${values[p.key]},${unitLabel},${computed.inputsSI[p.key]}`);
    }
    lines.push('');
    lines.push('输出结果,符号,数值,单位,SI值');
    // 与结果区一致：按 showIf 隐藏未参与计算的逐腔输出（n 为无量纲参数，SI 值与界面值一致）
    const visibleOutputs = formula.outputs.filter(
      (o) =>
        !o.showIf ||
        (Number(computed.inputsSI[o.showIf.key]) >= (o.showIf.min ?? -Infinity) &&
          Number(computed.inputsSI[o.showIf.key]) <= (o.showIf.max ?? Infinity)),
    );
    for (const o of visibleOutputs) {
      const raw = computed.outputsSI[o.key];
      const { value, unit } = o.unitGroup ? autoUnit(raw, o.unitGroup) : { value: raw, unit: o.unit };
      lines.push(`${o.label},${o.symbol},${formatNumber(value, o.digits ?? 6)},${unit},${raw}`);
    }
    lines.push('');
    lines.push('适用条件与假设');
    for (const a of formula.assumptions) lines.push(`"${a}"`);
    const res = await api.file.save({
      defaultName: `${formula.id.replace(/\./g, '_')}_计算记录.csv`,
      content: '\ufeff' + lines.join('\n'),
    });
    if (res.ok) showToast('计算书已导出');
  };

  // 左栏 ↔ 中栏 拖动
  const handleLeftResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX, startW = leftW;
      const minW = 220, maxW = 520;
      const onMove = (ev: MouseEvent) => {
        setLeftW(Math.min(maxW, Math.max(minW, startW + (ev.clientX - startX))));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
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

  // 中栏 ↔ 右栏 拖动
  const handleRightResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX, startW = rightW;
      const minW = 280, maxW = 580;
      const onMove = (ev: MouseEvent) => {
        setRightW(Math.min(maxW, Math.max(minW, startW - (ev.clientX - startX))));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
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
          <button className="btn-ghost" onClick={saveHistory} disabled={!computed}>
            保存到记录
          </button>
          <button className="btn-primary sm" onClick={exportCsv} disabled={!computed}>
            导出计算书
          </button>
        </div>
      </div>

      <div
        className="calc-body"
        style={{ gridTemplateColumns: `${leftW}px 4px minmax(0, 1fr) 4px ${rightW}px` }}
      >
        <div className="calc-col left">
          <ParamForm
            formula={formula}
            values={values}
            units={units}
            onValuesChange={setValues}
            onUnitsChange={handleUnitsChange}
          />
        </div>

        <div className="sidebar-resizer" onMouseDown={handleLeftResize} />

        <div className="calc-col middle">
          <FormulaView formula={formula} values={values} />
        </div>

        <div className="sidebar-resizer" onMouseDown={handleRightResize} />

        <div className="calc-col right">
          <ResultPanel
            formula={formula}
            outputsSI={computed ? computed.outputsSI : null}
            inputsSI={computed ? computed.inputsSI : null}
          />
          {/* 结果 → 结果曲线 → 参数敏感性分析（敏感性分析固定放最后） */}
          {formula.curve && computed && <CurveChart spec={formula.curve} inputsSI={computed.inputsSI} />}
          <SensitivityChart formula={formula} inputsSI={computed ? computed.inputsSI : null} />
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
