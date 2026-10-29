import type { FormulaSpec } from '../formula/types';
import { autoUnit, formatNumber } from '../formula/units';

interface Props {
  formula: FormulaSpec;
  /** SI 单位下的输出结果；为 null 表示输入不完整 */
  outputsSI: Record<string, number> | null;
  /** 原始 SI 输入，用于敏感性分析 */
  inputsSI: Record<string, number> | null;
  onSensitivity?: (key: string) => void;
  sensitivityKey?: string | null;
}

export function ResultPanel({ formula, outputsSI, onSensitivity, sensitivityKey }: Props) {
  if (!outputsSI) {
    return (
      <div className="result-block">
        <h3 className="panel-title">计算结果</h3>
        <p className="empty-hint">请填写完整输入参数</p>
      </div>
    );
  }

  const rows = formula.outputs.map((o) => {
    const raw = outputsSI[o.key];
    const num = typeof raw === 'number' ? raw : NaN;
    const { value, unit } = o.unitGroup ? autoUnit(num, o.unitGroup) : { value: num, unit: o.unit };
    return {
      ...o,
      display: formatNumber(value, o.digits ?? 4),
      unit,
    };
  });

  const hasGroup = formula.outputs.some((o) => o.group);

  return (
    <div className="result-block">
      <h3 className="panel-title">计算结果</h3>

      {hasGroup ? (
        // 按 group 分区渲染：每个分区里 primary 输出用主卡片，其余用普通行
        (() => {
          const groups = new Map<string, typeof rows>();
          for (const r of rows) {
            const g = r.group ?? '';
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g)!.push(r);
          }
          return [...groups.entries()].map(([groupName, groupRows]) => {
            const primaries = groupRows.filter((r) => r.primary);
            const rest = groupRows.filter((r) => !r.primary);
            return (
              <div className="result-group" key={groupName || '_ungrouped'}>
                {groupName && <div className="result-group-title">{groupName}</div>}
                {primaries.length > 0 && (
                  <div className="result-primary-grid">
                    {primaries.map((r) => (
                      <div key={r.key} className="result-card primary">
                        <div className="result-label">
                          {r.symbol} · {r.label}
                        </div>
                        <div className="result-value">
                          {r.display} <span className="result-unit">{r.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {rest.length > 0 && (
                  <div className="result-rows">
                    {rest.map((r) => (
                      <div key={r.key} className="result-row" onClick={() => onSensitivity?.(r.key)}>
                        <span className="rr-label">
                          {r.symbol} · {r.label}
                        </span>
                        <span className="rr-value">
                          {r.display} <span className="result-unit">{r.unit}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          });
        })()
      ) : (
        // 无 group：保持原逻辑，所有 primary 卡片集中在顶部
        <>
          <div className="result-primary-grid">
            {rows
              .filter((r) => r.primary)
              .map((r) => (
                <div key={r.key} className="result-card primary">
                  <div className="result-label">
                    {r.symbol} · {r.label}
                  </div>
                  <div className="result-value">
                    {r.display} <span className="result-unit">{r.unit}</span>
                  </div>
                </div>
              ))}
          </div>
          <div className="result-rows">
            {rows
              .filter((r) => !r.primary)
              .map((r) => (
                <div key={r.key} className="result-row" onClick={() => onSensitivity?.(r.key)}>
                  <span className="rr-label">
                    {r.symbol} · {r.label}
                  </span>
                  <span className="rr-value">
                    {r.display} <span className="result-unit">{r.unit}</span>
                  </span>
                </div>
              ))}
          </div>
        </>
      )}

      <p className="result-note">
        结果为理论计算值，未包含接触热阻、污垢、公差与制造偏差等因素，工程设计请结合余量系数与仿真/试验结果综合判断。
        {sensitivityKey && <span className="sens-tip">（点击行可对该结果做参数敏感性分析）</span>}
      </p>
    </div>
  );
}
