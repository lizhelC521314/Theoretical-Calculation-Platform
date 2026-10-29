import { useEffect, useMemo, useState } from 'react';
import { api, type CtrUser, type HistoryEntry, type Project } from '../api';
import { formatNumber } from '../formula/units';
import { exportReport } from '../report/exportReport';

interface Props {
  user: CtrUser;
  projects: Project[];
  onReopen: (formulaId: string) => void;
  onOpenCompare: (a: HistoryEntry, b: HistoryEntry) => void;
}

export function HistoryPage({ user, projects, onReopen, onOpenCompare }: Props) {
  const [list, setList] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  /** 项目筛选：'all' 全部；'temp' 未绑定；其余为项目 ID */
  const [projFilter, setProjFilter] = useState('all');
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = async () => setList(await api.history.list(user.id));

  useEffect(() => {
    load();
  }, [user.id]);

  const projectName = (id: string | null) =>
    id == null ? '临时计算' : projects.find((p) => p.id === id)?.name ?? '（项目已删除）';

  const filtered = useMemo(
    () =>
      list.filter((h) => {
        if (projFilter === 'temp' && h.projectId != null) return false;
        if (projFilter !== 'all' && projFilter !== 'temp' && h.projectId !== projFilter) return false;
        return (h.formulaTitle + h.formulaId).toLowerCase().includes(keyword.toLowerCase());
      }),
    [list, keyword, projFilter],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const remove = async (id: string) => {
    await api.history.remove(id);
    setSelected((prev) => prev.filter((x) => x !== id));
    load();
  };

  const compareItems = selected
    .map((id) => list.find((h) => h.id === id))
    .filter((x): x is HistoryEntry => !!x);

  const showToast = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 2400);
  };

  /** 导出当前筛选集合：选中具体项目 → 项目计算书；临时 → 临时计算书；全部 → 按临时计算书命名 */
  const doExport = async (format: 'docx' | 'pdf') => {
    if (filtered.length === 0) {
      showToast('当前筛选下没有计算记录');
      return;
    }
    const project =
      projFilter !== 'all' && projFilter !== 'temp'
        ? projects.find((p) => p.id === projFilter) ?? null
        : null;
    setExporting(true);
    try {
      const res = await exportReport(filtered, project, user, format);
      if (res.ok) showToast(format === 'docx' ? 'Word 计算书已导出' : 'PDF 计算书已导出');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="history-page">
      <div className="lib-toolbar">
        <select className="project-filter" value={projFilter} onChange={(e) => setProjFilter(e.target.value)}>
          <option value="all">全部记录</option>
          <option value="temp">临时计算（未绑定项目）</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              项目：{p.name}
            </option>
          ))}
        </select>
        <input
          className="search-input"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索历史记录：公式名称或编号"
        />
        <span className="lib-count">共 {filtered.length} 条</span>
        <button
          className="btn-primary sm"
          disabled={compareItems.length !== 2}
          onClick={() => onOpenCompare(compareItems[0], compareItems[1])}
        >
          对比所选两项
        </button>
        <button className="btn-ghost" disabled={exporting || filtered.length === 0} onClick={() => doExport('docx')}>
          导出 Word 计算书
        </button>
        <button className="btn-ghost" disabled={exporting || filtered.length === 0} onClick={() => doExport('pdf')}>
          导出 PDF 计算书
        </button>
      </div>

      <div className="history-list">
        {filtered.map((h) => (
          <div className={selected.includes(h.id) ? 'history-item selected' : 'history-item'} key={h.id}>
            <div className="hi-check">
              <input type="checkbox" checked={selected.includes(h.id)} onChange={() => toggle(h.id)} />
            </div>
            <div className="hi-main">
              <div className="hi-title">{h.formulaTitle}</div>
              <div className="hi-meta">
                <span className={h.projectId ? 'tag domain' : 'tag light'}>{projectName(h.projectId)}</span>
                {h.domain} · {h.formulaId} · {new Date(h.createdAt).toLocaleString('zh-CN')}
              </div>
            </div>
            <div className="hi-actions">
              <button className="btn-link" onClick={() => onReopen(h.formulaId)}>
                重新计算
              </button>
              <button className="btn-link danger" onClick={() => remove(h.id)}>
                删除
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="empty-hint">暂无计算记录。进入公式库完成一次计算并点击“保存到记录”即可归档。</p>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/** 两个历史方案的结果对比 */
export function ComparePanel({ a, b, onBack }: { a: HistoryEntry; b: HistoryEntry; onBack: () => void }) {
  const keys = Array.from(new Set([...Object.keys(a.outputs), ...Object.keys(b.outputs)]));
  return (
    <div className="compare-panel">
      <button className="btn-back" onClick={onBack}>
        ← 返回记录列表
      </button>
      <h3>方案对比</h3>
      <div className="compare-heads">
        <div className="compare-col">
          <div className="ch-title">方案 A · {a.formulaTitle}</div>
          <div className="ch-sub">{new Date(a.createdAt).toLocaleString('zh-CN')}</div>
        </div>
        <div className="compare-col">
          <div className="ch-title">方案 B · {b.formulaTitle}</div>
          <div className="ch-sub">{new Date(b.createdAt).toLocaleString('zh-CN')}</div>
        </div>
      </div>
      <table className="compare-table">
        <thead>
          <tr>
            <th>结果项</th>
            <th>方案 A</th>
            <th>方案 B</th>
            <th>差异</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const va = a.outputs[k];
            const vb = b.outputs[k];
            const na = typeof va === 'number' ? va : NaN;
            const nb = typeof vb === 'number' ? vb : NaN;
            const diff = Number.isFinite(na) && Number.isFinite(nb) && na !== 0 ? ((nb - na) / na) * 100 : NaN;
            return (
              <tr key={k}>
                <td>{k}</td>
                <td>{Number.isFinite(na) ? formatNumber(na, 6) : '—'}</td>
                <td>{Number.isFinite(nb) ? formatNumber(nb, 6) : '—'}</td>
                <td className={Number.isFinite(diff) ? (diff > 0 ? 'up' : 'down') : ''}>
                  {Number.isFinite(diff) ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
