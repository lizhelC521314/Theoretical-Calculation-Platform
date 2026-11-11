import { Fragment, useEffect, useMemo, useState } from 'react';
import { showIfMatches, type FormulaSpec } from '../formula/types';
import { autoUnit, formatNumber, fromSI } from '../formula/units';
import {
  runUncertainty,
  type OutputUncertainty,
  type UncertaintyDist,
  type UncertaintyResult,
} from '../formula/uncertainty';

interface Props {
  formula: FormulaSpec;
  /** 当前 SI 输入；为 null 时（输入不完整 / 校验未通过）不可运行 */
  inputsSI: Record<string, number> | null;
}

interface Cfg {
  enabled: boolean;
  /** 相对不确定度（±比例） */
  rel: number;
  dist: UncertaintyDist;
}

const fmt = (v: number) => (Number.isFinite(v) ? formatNumber(v, 4) : '—');

/** 把输出列统一换算到与均值相同的显示单位 */
function toDisplay(o: OutputUncertainty) {
  if (!o.unitGroup) {
    return {
      unit: o.unit,
      mean: fmt(o.mean),
      std: fmt(o.std),
      p5: fmt(o.p5),
      p95: fmt(o.p95),
      low: fmt(o.low),
      high: fmt(o.high),
    };
  }
  const { unit } = autoUnit(o.mean, o.unitGroup);
  const c = (v: number) => (Number.isFinite(v) ? fmt(fromSI(v, o.unitGroup!, unit)) : '—');
  return {
    unit,
    mean: c(o.mean),
    std: c(o.std),
    p5: c(o.p5),
    p95: c(o.p95),
    low: c(o.low),
    high: c(o.high),
  };
}

/**
 * 不确定性分析面板：为输入设置相对不确定度后做蒙特卡洛抽样，
 * 输出统计量（均值/标准差/分位数）与包络区间，并给出主要影响因子。
 */
export function UncertaintyPanel({ formula, inputsSI }: Props) {
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState(2000);
  const [cfg, setCfg] = useState<Record<string, Cfg>>({});
  const [result, setResult] = useState<UncertaintyResult | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const visibleNumeric = useMemo(
    () =>
      formula.inputs.filter(
        (p) => p.kind !== 'select' && showIfMatches(p.showIf, inputsSI ?? {}),
      ),
    [formula, inputsSI],
  );

  // 切换公式：重置配置与结果，默认全部不勾选（避免一次扰动几十个参数）
  useEffect(() => {
    const init: Record<string, Cfg> = {};
    for (const p of formula.inputs) {
      if (p.kind !== 'select') init[p.key] = { enabled: false, rel: 0.05, dist: 'uniform' };
    }
    setCfg(init);
    setResult(null);
    setError('');
  }, [formula.id]);

  const update = (key: string, patch: Partial<Cfg>) =>
    setCfg((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { enabled: false, rel: 0.05, dist: 'uniform' }), ...patch } }));

  const run = () => {
    if (!inputsSI) return;
    const specs = visibleNumeric
      .filter((p) => cfg[p.key]?.enabled)
      .map((p) => ({ key: p.key, rel: cfg[p.key].rel, dist: cfg[p.key].dist }));
    if (specs.length === 0) {
      setError('请至少勾选一个输入并设置大于 0 的不确定度');
      setResult(null);
      return;
    }
    setRunning(true);
    setError('');
    try {
      const r = runUncertainty(formula, inputsSI, specs, { samples });
      setResult(r);
      if (r.failed === samples) setError('全部样本求解失败，请检查输入是否落在适用范围内');
    } catch (e) {
      setError('分析失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="result-block unc-block">
      <div className="unc-head">
        <h3 className="panel-title">不确定性分析</h3>
        <button className="btn-link" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开'}
        </button>
      </div>

      {open && (
        <>
          <p className="unc-hint">
            勾选需要扰动的输入并设置相对不确定度（±%），按所选分布抽样后统计输出范围。
            包络区间由输入极值全组合求得，适用于单调段内的设计判断。
          </p>

          <div className="unc-inputs">
            {visibleNumeric.map((p) => {
              const c = cfg[p.key] ?? { enabled: false, rel: 0.05, dist: 'uniform' as UncertaintyDist };
              return (
                <div className="unc-row" key={p.key}>
                  <label className="unc-check">
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      onChange={(e) => update(p.key, { enabled: e.target.checked })}
                    />
                    <span>{p.label}</span>
                  </label>
                  <span className="unc-pm">±</span>
                  <input
                    className="unc-rel"
                    type="number"
                    step="0.5"
                    min="0"
                    max="50"
                    value={Number((c.rel * 100).toFixed(3))}
                    onChange={(e) => {
                      const pct = Math.min(50, Math.max(0, Number(e.target.value) || 0));
                      update(p.key, { rel: pct / 100 });
                    }}
                  />
                  <span className="unc-pct">%</span>
                  <select
                    className="unc-dist"
                    value={c.dist}
                    onChange={(e) => update(p.key, { dist: e.target.value as UncertaintyDist })}
                  >
                    <option value="uniform">均匀</option>
                    <option value="normal">正态（3σ）</option>
                  </select>
                </div>
              );
            })}
            {visibleNumeric.length === 0 && <p className="empty-hint">当前没有可扰动的数值输入</p>}
          </div>

          <div className="unc-run">
            <select value={samples} onChange={(e) => setSamples(Number(e.target.value))}>
              <option value={1000}>1000 次抽样</option>
              <option value={2000}>2000 次抽样</option>
              <option value={5000}>5000 次抽样</option>
            </select>
            <button className="btn-primary sm" onClick={run} disabled={running || !inputsSI}>
              {running ? '计算中…' : '运行分析'}
            </button>
            {!inputsSI && <span className="bind-hint">请先补全输入参数</span>}
          </div>

          {error && <div className="bind-error">{error}</div>}

          {result && (
            <>
              <p className="unc-summary">
                抽样 {result.samples} 次 · 失败 {result.failed} 次 · 扰动参数{' '}
                {result.active.map((a) => `${a.label} ±${(a.rel * 100).toFixed(1)}%`).join('、')}
              </p>
              <table className="unc-table">
                <thead>
                  <tr>
                    <th>结果项</th>
                    <th>单位</th>
                    <th>均值</th>
                    <th>标准差</th>
                    <th>P5</th>
                    <th>P95</th>
                    <th>区间下限</th>
                    <th>区间上限</th>
                    <th>变异系数</th>
                  </tr>
                </thead>
                <tbody>
                  {result.outputs.map((o) => {
                    const d = toDisplay(o);
                    return (
                      <Fragment key={o.key}>
                        <tr>
                          <td>{o.label}</td>
                          <td>{d.unit}</td>
                          <td>{d.mean}</td>
                          <td>{d.std}</td>
                          <td>{d.p5}</td>
                          <td>{d.p95}</td>
                          <td>{d.low}</td>
                          <td>{d.high}</td>
                          <td>{Number.isFinite(o.cov) ? `${(o.cov * 100).toFixed(1)}%` : '—'}</td>
                        </tr>
                        {o.influence.length > 0 && (
                          <tr className="unc-influence">
                            <td colSpan={9}>
                              主要影响：
                              {o.influence
                                .map((x) => `${x.label} ${x.score.toFixed(2)}`)
                                .join(' · ')}
                              {o.envelope === 'samples' && '（区间为样本包络）'}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {result.outputs.length === 0 && (
                <p className="empty-hint">没有可统计的输出结果</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
