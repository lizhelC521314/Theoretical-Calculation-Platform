import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CtrUser, type HistoryEntry, type Project } from '../api';
import { listFormulas } from '../formula/registry';
import { UNIT_GROUPS, toSI } from '../formula/units';
import {
  CHECK_OP_LABEL,
  CHECK_STATUS_LABEL,
  COMPLIANCE_LABEL,
  buildCheckPackage,
  checkPackageCsv,
  type CheckCriterion,
  type CheckOp,
  type CheckableRecord,
} from '../formula/projectCheck';

interface Props {
  user: CtrUser;
  projects: Project[];
  currentProject: Project | null;
}

interface CriterionRow {
  formulaId: string;
  output: string;
  op: CheckOp;
  value: string;
  value2: string;
}

/** 结果的显示单位：优先工程习惯单位，与结果区一致 */
function outputUnit(key: string, formulaId: string): string {
  const f = listFormulas().find((x) => x.id === formulaId);
  const o = f?.outputs.find((x) => x.key === key);
  if (!o) return '';
  if (!o.unitGroup) return o.unit;
  return UNIT_GROUPS[o.unitGroup]?.preferred ?? o.unit;
}

/**
 * 项目校核包：批量复核项目下的计算记录
 *
 * 逐条比对「记录快照版本 → 当前公式版本」与「记录输出 → 当前复算输出」，
 * 再按操作者设定的判定准则给出合规结论，可导出 CSV 作为校核留档。
 */
export function ProjectCheckPage({ user, projects, currentProject }: Props) {
  const [projectId, setProjectId] = useState<string | null>(currentProject?.id ?? null);
  const [records, setRecords] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CriterionRow[]>([]);
  const [tolerance, setTolerance] = useState('0.01');
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);

  const formulas = useMemo(() => listFormulas(), []);
  const project = projects.find((p) => p.id === projectId) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.history.list(user.id);
      setRecords(all.filter((h) => h.projectId === projectId));
    } finally {
      setLoading(false);
    }
  }, [user.id, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 2400);
  };

  // 只列出记录实际用到的公式，避免准则下拉框过长
  const usedFormulas = useMemo(() => {
    const ids = new Set(records.map((r) => r.formulaId));
    return formulas.filter((f) => ids.has(f.id));
  }, [records, formulas]);

  const parsed = useMemo(() => {
    const list: CheckCriterion[] = [];
    const bad: string[] = [];
    for (const r of rows) {
      const f = formulas.find((x) => x.id === r.formulaId);
      const o = f?.outputs.find((x) => x.key === r.output);
      if (!f || !o) continue;
      const unit = outputUnit(r.output, r.formulaId);
      const v = Number(r.value);
      if (!Number.isFinite(v)) {
        bad.push(`${f.title} · ${o.label} 的限值不是数值`);
        continue;
      }
      const c: CheckCriterion = {
        formulaId: r.formulaId,
        output: r.output,
        op: r.op,
        value: toSI(v, o.unitGroup, unit),
      };
      if (r.op === 'between') {
        const v2 = Number(r.value2);
        if (!Number.isFinite(v2)) {
          bad.push(`${f.title} · ${o.label} 的区间上限不是数值`);
          continue;
        }
        c.value2 = toSI(v2, o.unitGroup, unit);
      }
      list.push(c);
    }
    const tol = Number(tolerance);
    return { list, bad, tol: Number.isFinite(tol) && tol > 0 ? tol / 100 : 0.000001 };
  }, [rows, formulas, tolerance]);

  const result = useMemo(
    () =>
      buildCheckPackage(
        records as unknown as CheckableRecord[],
        formulas,
        parsed.list,
        parsed.tol,
      ),
    [records, formulas, parsed],
  );

  const addRow = () => {
    const f = usedFormulas[0];
    if (!f) return;
    setRows((prev) => [
      ...prev,
      { formulaId: f.id, output: f.outputs[0].key, op: 'le', value: '', value2: '' },
    ]);
  };

  const updateRow = (i: number, patch: Partial<CriterionRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const doExport = async () => {
    if (result.items.length === 0) {
      showToast('当前项目没有可校核的记录');
      return;
    }
    setExporting(true);
    try {
      const csv = checkPackageCsv(
        result,
        {
          projectName: project?.name ?? '临时计算',
          user: user.displayName || user.username,
          time: new Date().toLocaleString('zh-CN'),
        },
        parsed.list,
        formulas,
      );
      const res = await api.file.save({
        defaultName: `${(project?.name ?? '临时计算').replace(/\s+/g, '_')}_项目校核包.csv`,
        content: '\ufeff' + csv,
      });
      if (res.ok) showToast('校核包已导出');
    } finally {
      setExporting(false);
    }
  };

  const s = result.summary;

  return (
    <div className="check-page">
      <div className="settings-card check-head">
        <div className="check-title">
          <h3>项目校核包</h3>
          <p className="settings-hint">
            对项目下的计算记录做版本核对与复算核对，并按判定准则给出合规结论。
            仅比对「当前公式库」与「记录快照」，不会修改任何历史记录。
          </p>
        </div>
        <label className="field check-select">
          <span>项目</span>
          <select
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value || null)}
          >
            <option value="">临时计算（未绑定项目）</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.version ? `（${p.version}）` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="check-actions">
          <button className="btn-ghost" onClick={load} disabled={loading}>
            {loading ? '读取中…' : '重新读取记录'}
          </button>
          <button
            className="btn-primary sm"
            onClick={doExport}
            disabled={exporting || result.items.length === 0}
          >
            {exporting ? '导出中…' : '导出校核包 CSV'}
          </button>
        </div>
      </div>

      <div className="check-summary">
        <div className="check-stat">
          <b>{s.total}</b>
          <span>记录总数</span>
        </div>
        <div className="check-stat ok">
          <b>{s.ok}</b>
          <span>复算一致</span>
        </div>
        <div className="check-stat stale">
          <b>{s.stale}</b>
          <span>公式升版</span>
        </div>
        <div className="check-stat changed">
          <b>{s.changed}</b>
          <span>复算不符</span>
        </div>
        <div className="check-stat failed">
          <b>{s.failed}</b>
          <span>无法复算</span>
        </div>
        <div className="check-stat">
          <b>
            {s.pass} / {s.fail}
          </b>
          <span>合规通过 / 不通过</span>
        </div>
      </div>

      <div className="settings-card check-criteria">
        <div className="check-criteria-head">
          <h3>判定准则</h3>
          <div className="check-actions">
            <label className="field inline">
              <span>复算容差</span>
              <input
                className="unc-rel"
                type="number"
                step="0.001"
                min="0"
                value={tolerance}
                onChange={(e) => setTolerance(e.target.value)}
              />
              <span className="unc-pct">%</span>
            </label>
            <button className="btn-link" onClick={addRow} disabled={usedFormulas.length === 0}>
              + 添加准则
            </button>
          </div>
        </div>
        {rows.length === 0 && (
          <p className="settings-hint">
            未设置准则时只做版本与复算核对，合规一律记为「未判定」。准则按「公式 + 结果」匹配，
            只对同一公式的记录生效。
          </p>
        )}
        {rows.map((r, i) => {
          const f = formulas.find((x) => x.id === r.formulaId);
          const unit = outputUnit(r.output, r.formulaId);
          return (
            <div className="check-criterion-row" key={`${r.formulaId}-${i}`}>
              <select
                value={r.formulaId}
                onChange={(e) => {
                  const nf = formulas.find((x) => x.id === e.target.value);
                  updateRow(i, {
                    formulaId: e.target.value,
                    output: nf?.outputs[0]?.key ?? '',
                  });
                }}
              >
                {usedFormulas.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
              <select
                value={r.output}
                onChange={(e) => updateRow(i, { output: e.target.value })}
              >
                {(f?.outputs ?? []).map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.symbol} {o.label}
                  </option>
                ))}
              </select>
              <select value={r.op} onChange={(e) => updateRow(i, { op: e.target.value as CheckOp })}>
                {(Object.keys(CHECK_OP_LABEL) as CheckOp[]).map((op) => (
                  <option key={op} value={op}>
                    {CHECK_OP_LABEL[op]}
                  </option>
                ))}
              </select>
              <input
                className="unc-rel"
                type="number"
                placeholder="限值"
                value={r.value}
                onChange={(e) => updateRow(i, { value: e.target.value })}
              />
              {r.op === 'between' && (
                <>
                  <span className="unc-pct">~</span>
                  <input
                    className="unc-rel"
                    type="number"
                    placeholder="上限"
                    value={r.value2}
                    onChange={(e) => updateRow(i, { value2: e.target.value })}
                  />
                </>
              )}
              <span className="unc-pct">{unit}</span>
              <button
                className="btn-link danger"
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              >
                删除
              </button>
            </div>
          );
        })}
        {parsed.bad.length > 0 && <div className="bind-error">{parsed.bad.join('；')}</div>}
      </div>

      <div className="settings-card check-table-wrap">
        {result.items.length === 0 ? (
          <p className="empty-hint">
            {loading ? '正在读取计算记录…' : '该项目下暂无计算记录，先在公式库中完成计算并保存到项目。'}
          </p>
        ) : (
          <table className="check-table">
            <thead>
              <tr>
                <th>公式</th>
                <th>记录时间</th>
                <th>版本</th>
                <th>复算</th>
                <th>合规</th>
                <th>偏差 / 说明</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((it) => {
                const changed = it.diffs.filter((d) => d.rel > parsed.tol).slice(0, 3);
                return (
                  <tr key={it.recordId}>
                    <td>
                      <div className="check-name">{it.formulaTitle}</div>
                      <div className="check-id">{it.formulaId}</div>
                    </td>
                    <td>{new Date(it.createdAt).toLocaleString('zh-CN')}</td>
                    <td>
                      <div>{it.recordedVersion ? `记录 v${it.recordedVersion}` : '记录 v—'}</div>
                      <div className="check-id">
                        {it.currentVersion ? `当前 v${it.currentVersion}` : '已移出公式库'}
                      </div>
                    </td>
                    <td>
                      <span className={`check-badge ${it.status}`}>
                        {CHECK_STATUS_LABEL[it.status]}
                      </span>
                    </td>
                    <td>
                      <span className={`check-badge c-${it.compliance}`}>
                        {COMPLIANCE_LABEL[it.compliance]}
                      </span>
                    </td>
                    <td className="check-note">
                      {changed.length > 0 && (
                        <div className="check-diffs">
                          {changed.map((d) => (
                            <div key={d.key}>
                              {d.label}：{Number(d.recorded.toPrecision(5))} →{' '}
                              {Number(d.current.toPrecision(5))}（
                              {(d.rel * 100).toFixed(2)}%）
                            </div>
                          ))}
                        </div>
                      )}
                      {it.violations.map((v, i) => (
                        <div className="check-violation" key={`v${i}`}>
                          {v}
                        </div>
                      ))}
                      {it.messages.map((m, i) => (
                        <div key={`m${i}`}>{m}</div>
                      ))}
                      {changed.length === 0 && it.violations.length === 0 && it.messages.length === 0 && (
                        <span className="check-id">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
