import katex from 'katex';
import { useMemo } from 'react';
import type { FormulaSpec } from '../formula/types';
import { DOMAIN_LABEL } from '../formula/types';

function renderTex(tex: string): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: true });
  } catch {
    return `<code>${tex}</code>`;
  }
}

/** 公式展示区：LaTeX 主公式、符号说明、示意图、适用条件 */
export function FormulaView({
  formula,
  values,
}: {
  formula: FormulaSpec;
  /** 当前输入值（界面单位），用于按 showIf 隐藏未参与计算的逐腔符号行；不传则全部显示 */
  values?: Record<string, number>;
}) {
  // 与 ParamForm 相同的 showIf 求值：参数值落在 [min, max] 区间才显示该行
  const visible = (s?: { key: string; min?: number; max?: number }) =>
    !values ||
    !s ||
    (Number(values[s.key]) >= (s.min ?? -Infinity) && Number(values[s.key]) <= (s.max ?? Infinity));

  const rendered = useMemo(
    () =>
      formula.latex
        .filter((l) => visible(l.showIf))
        .map((l) => ({ ...l, html: renderTex(l.tex) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formula, values],
  );

  return (
    <div className="formula-view">
      <div className="fv-head">
        <h2>{formula.title}</h2>
        <div className="fv-meta">
          <span className="tag domain">{DOMAIN_LABEL[formula.domain]}</span>
        </div>
        <p className="fv-summary">{formula.summary}</p>
      </div>

      {formula.diagram && (
        <div className="fv-diagram">
          <div className="fv-section-title">计算模型示意</div>
          <div className="diagram-box" dangerouslySetInnerHTML={{ __html: formula.diagram }} />
        </div>
      )}

      <div className="fv-section-title">理论公式</div>
      <div className="fv-latex-list">
        {rendered.map((l) => (
          <div className="latex-item" key={l.label}>
            <div className="latex-label">{l.label}</div>
            <div className="latex-body" dangerouslySetInnerHTML={{ __html: l.html }} />
          </div>
        ))}
      </div>

      <div className="fv-section-title">符号说明</div>
      <table className="symbol-table">
        <thead>
          <tr>
            <th>符号</th>
            <th>含义</th>
            <th>单位</th>
          </tr>
        </thead>
        <tbody>
          {formula.inputs.filter((p) => visible(p.showIf)).map((p) => (
            <tr key={'i' + p.key}>
              <td className="sym">{p.symbol}</td>
              <td>
                {p.label}
                <span className="sym-role">（输入）</span>
              </td>
              <td>{p.unitGroup ? p.unit : p.unit}</td>
            </tr>
          ))}
          {formula.outputs.filter((o) => visible(o.showIf)).map((o) => (
            <tr key={'o' + o.key}>
              <td className="sym">{o.symbol}</td>
              <td>
                {o.label}
                <span className="sym-role">（输出）</span>
              </td>
              <td>{o.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="assumption-box">
        <div className="assumption-title">适用条件与假设</div>
        <ul>
          {formula.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>

      <div className="fv-desc">{formula.description}</div>
    </div>
  );
}
