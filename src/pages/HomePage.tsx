import { useEffect, useMemo, useState } from 'react';
import { api, type CtrUser, type HistoryEntry } from '../api';
import { BRAND } from '../branding';
import { DOMAIN_LABEL } from '../formula/types';
import { groupByDomain, stats } from '../formula/registry';

interface Props {
  user: CtrUser;
  onOpenLibrary: (domain?: string) => void;
  onReopen: (formulaId: string) => void;
}

export function HomePage({ user, onOpenLibrary, onReopen }: Props) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    api.history.list(user.id).then(setHistory);
  }, [user.id]);

  const s = useMemo(() => stats(), []);
  const groups = useMemo(() => groupByDomain(), []);

  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: HistoryEntry[] = [];
    for (const h of history) {
      if (seen.has(h.formulaId)) continue;
      seen.add(h.formulaId);
      out.push(h);
      if (out.length >= 4) break;
    }
    return out;
  }, [history]);

  return (
    <div className="home-page">
      <div className="home-hero">
        <div>
          <h1>
            {user.displayName || user.username}，欢迎使用 {BRAND.productShort}
          </h1>
          <p>
            选择领域与公式，输入设计参数即可得到理论计算值、公式依据与适用条件。所有计算均记录在本机，
            可随时回看、对比与导出计算书。
          </p>
        </div>
        <img className="home-logo" src={BRAND.logoUrl} alt="公司 LOGO" />
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-value">{s.total}</div>
          <div className="stat-label">已集成公式</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{s.domainCount}</div>
          <div className="stat-label">覆盖领域</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{history.length}</div>
          <div className="stat-label">我的计算记录</div>
        </div>
        <div className="stat-card highlight" onClick={() => onOpenLibrary()}>
          <div className="stat-value">→</div>
          <div className="stat-label">进入公式库</div>
        </div>
      </div>

      <h2 className="section-title">按领域浏览</h2>
      <div className="domain-grid">
        {groups.map((g) => (
          <div className="domain-card" key={g.domain} onClick={() => onOpenLibrary(g.domain)}>
            <div className="dc-name">{DOMAIN_LABEL[g.domain]}</div>
            <div className="dc-count">{g.items.length} 个公式</div>
            <div className="dc-samples">
              {g.items.slice(0, 3).map((f) => (
                <span key={f.id}>{f.title}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h2 className="section-title">最近使用</h2>
      {recent.length === 0 ? (
        <p className="empty-hint">还没有计算记录。从上方领域进入公式库开始第一次计算。</p>
      ) : (
        <div className="recent-list">
          {recent.map((h) => (
            <div className="recent-item" key={h.id} onClick={() => onReopen(h.formulaId)}>
              <div className="ri-title">{h.formulaTitle}</div>
              <div className="ri-meta">
                {h.domain} · {new Date(h.createdAt).toLocaleString('zh-CN')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
