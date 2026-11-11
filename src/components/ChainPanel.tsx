/**
 * 组合链路面板：展示本公式与上下游公式的结果传递关系，
 * 上游取「最近一次保存的计算记录」，按链路声明的变换带入到当前输入。
 */
import type { HistoryEntry } from '../api';
import type { FormulaSpec } from '../formula/types';
import {
  LINK_PHYSICS,
  LINK_TRANSFORM_LABEL,
  downstreamLinks,
  linkEnds,
  upstreamLinks,
  type FormulaLink,
} from '../formula/links';
import { autoUnit, formatNumber } from '../formula/units';

interface Props {
  formula: FormulaSpec;
  /** 上游公式 id → 最近一次保存的记录 */
  records: Record<string, HistoryEntry>;
  onApply: (link: FormulaLink) => void;
  onOpen: (formulaId: string) => void;
}

/** 上游输出值的展示文本（按输出单位分组自动换单位） */
function outputText(link: FormulaLink, rec: HistoryEntry | undefined): string | null {
  const raw = rec?.outputs?.[link.output];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const out = linkEnds(link).from?.outputs.find((o) => o.key === link.output);
  const disp = out?.unitGroup ? autoUnit(raw, out.unitGroup) : { value: raw, unit: out?.unit ?? '' };
  return `${formatNumber(disp.value, out?.digits ?? 3)} ${disp.unit}`.trim();
}

export function ChainPanel({ formula, records, onApply, onOpen }: Props) {
  const ups = upstreamLinks(formula.id);
  const downs = downstreamLinks(formula.id);
  if (ups.length === 0 && downs.length === 0) return null;

  // 按上游公式分组，避免同一来源的多个输出重复显示记录时间
  const groups = new Map<string, FormulaLink[]>();
  for (const l of ups) {
    const arr = groups.get(l.from);
    if (arr) arr.push(l);
    else groups.set(l.from, [l]);
  }

  return (
    <div className="result-block chain-block">
      <h3 className="panel-title">组合链路</h3>

      <details className="chain-physics">
        <summary>物理依据 · {LINK_PHYSICS.model}</summary>
        <div className="chain-physics-body">
          {LINK_PHYSICS.equations.map((e) => (
            <div className="chain-eq" key={e.label}>
              <span className="chain-eq-label">{e.label}</span>
              <code className="chain-eq-text">{e.text}</code>
            </div>
          ))}
          <p className="chain-physics-summary">{LINK_PHYSICS.summary}</p>
          <ul className="chain-conds">
            {LINK_PHYSICS.conditions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </details>

      {ups.length > 0 && (
        <div className="chain-group">
          <div className="chain-label">上游结果</div>
          {[...groups.entries()].map(([fromId, links]) => {
            const rec = records[fromId];
            const fromTitle = linkEnds(links[0]).from?.title ?? fromId;
            return (
              <div className="chain-source" key={fromId}>
                <div className="chain-source-head">
                  <button className="chain-src" onClick={() => onOpen(fromId)}>
                    {fromTitle}
                  </button>
                  <span className="chain-time">
                    {rec ? new Date(rec.createdAt).toLocaleString('zh-CN') : '尚无保存结果'}
                  </span>
                </div>
                {links.map((l) => {
                  const text = outputText(l, rec);
                  const target = formula.inputs.find((i) => i.key === l.input);
                  const outLabel =
                    linkEnds(l).from?.outputs.find((o) => o.key === l.output)?.label ?? l.output;
                  return (
                    <div className="chain-row" key={`${l.output}-${l.input}`}>
                      <div className="chain-main">
                        <span className="chain-out">
                          {outLabel} = {text ?? '—'}
                        </span>
                        <span className="chain-target">
                          → 带入「{target?.label ?? l.input}」
                        </span>
                        <span className="chain-note">
                          {LINK_TRANSFORM_LABEL[l.transform]}：{l.note}
                        </span>
                        {l.derivation && (
                          <span className="chain-derive">{l.derivation}</span>
                        )}
                      </div>
                      <div className="chain-actions">
                        <button
                          className="btn-ghost sm"
                          disabled={!text}
                          onClick={() => onApply(l)}
                          title={text ? '按上游最近一次保存结果带入' : '请先完成并保存上游计算'}
                        >
                          带入
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {downs.length > 0 && (
        <div className="chain-group">
          <div className="chain-label">下游可接</div>
          {downs.map((l) => {
            const toTitle = linkEnds(l).to?.title ?? l.to;
            const outLabel =
              formula.outputs.find((o) => o.key === l.output)?.label ?? l.output;
            const inLabel = linkEnds(l).to?.inputs.find((i) => i.key === l.input)?.label ?? l.input;
            return (
              <div className="chain-row" key={`${l.to}-${l.input}`}>
                <div className="chain-main">
                  <button className="chain-src" onClick={() => onOpen(l.to)}>
                    {toTitle}
                  </button>
                  <span className="chain-target">
                    {outLabel} → {inLabel}
                  </span>
                  <span className="chain-note">{LINK_TRANSFORM_LABEL[l.transform]}</span>
                  {l.derivation && <span className="chain-derive">{l.derivation}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="chain-hint">
        带入值取上游最近一次保存结果（优先当前项目），带入后仍可手工修改；链路变换按各公式自身定义执行。
      </div>
    </div>
  );
}
