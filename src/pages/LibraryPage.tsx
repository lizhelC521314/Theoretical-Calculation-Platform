import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Domain, FormulaSpec } from '../formula/types';
import { DOMAIN_LABEL, FORMULA_STATUS_LABEL } from '../formula/types';
import { groupByDomain, stats } from '../formula/registry';
import {
  filterFormulas,
  loadFavorites,
  loadRecent,
  saveFavorites,
  toggleFavorite,
  type LibraryScope,
  type LibrarySort,
} from '../formula/library';
import { briefOf } from '../formula/briefs';
import { downstreamLinks, upstreamLinks } from '../formula/links';
import { IS_STANDARD } from '../edition';

interface Props {
  onOpen: (f: FormulaSpec) => void;
  initialDomain?: string;
}

const SCOPE_LABEL: Record<LibraryScope, string> = {
  all: '全部公式',
  favorite: '我的收藏',
  recent: '最近使用',
};

/** 公式库：范围（全部/收藏/最近）+ 领域导航，卡片展示版本、状态与标准依据 */
export function LibraryPage({ onOpen, initialDomain }: Props) {
  const [keyword, setKeyword] = useState('');
  const [domainFilter, setDomainFilter] = useState<Domain | 'all'>(
    (initialDomain as Domain) || 'all',
  );
  const [scope, setScope] = useState<LibraryScope>('all');
  const [sort, setSort] = useState<LibrarySort>('default');
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());
  // 最近使用在进入页面时读取一次：从计算页返回会重新挂载，顺序即为最新
  const [recent] = useState<string[]>(() => loadRecent());

  // 左侧导航宽度
  const [domainSideWidth, setDomainSideWidth] = useState<number>(() => {
    const v = window.localStorage.getItem('ctr.librarySideWidth');
    const n = v ? Number(v) : 220;
    return Number.isFinite(n) && n >= 160 && n <= 360 ? n : 220;
  });
  useEffect(() => {
    window.localStorage.setItem('ctr.librarySideWidth', String(domainSideWidth));
  }, [domainSideWidth]);

  const groups = useMemo(() => groupByDomain(), []);
  const found = useMemo(
    () => filterFormulas({ keyword, domain: domainFilter, scope, sort, favorites, recent }),
    [keyword, domainFilter, scope, sort, favorites, recent],
  );

  const s = useMemo(() => stats(), []);

  const toggleFav = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = toggleFavorite(prev, id);
      saveFavorites(next);
      return next;
    });
  }, []);

  /** 切换领域时回到「全部公式」范围，避免收藏/最近范围与领域叠加后出现空白 */
  const pickDomain = (d: Domain | 'all') => {
    setDomainFilter(d);
    setScope('all');
  };

  const emptyHint =
    scope === 'favorite'
      ? '还没有收藏公式，点击卡片右上角 ★ 即可收藏。'
      : scope === 'recent'
        ? '暂无最近使用记录，打开任意公式后会自动记录。'
        : keyword.trim()
          ? '未找到匹配的公式，请调整关键词。'
          : '该领域暂无公式。';

  const handleSideResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = domainSideWidth;
      const minW = 160, maxW = 360;
      const onMove = (ev: MouseEvent) => {
        const next = Math.min(maxW, Math.max(minW, startW + (ev.clientX - startX)));
        setDomainSideWidth(next);
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
    [domainSideWidth],
  );

  return (
    <div
      className="library-page"
      style={{ gridTemplateColumns: `${domainSideWidth}px 4px minmax(0, 1fr)` }}
    >
      <aside className="library-side">
        <div className="side-title">公式范围</div>
        <button
          className={scope === 'all' ? 'side-item active' : 'side-item'}
          onClick={() => setScope('all')}
        >
          {SCOPE_LABEL.all} <span className="side-count">{s.total}</span>
        </button>
        <button
          className={scope === 'favorite' ? 'side-item active' : 'side-item'}
          onClick={() => setScope('favorite')}
        >
          {SCOPE_LABEL.favorite} <span className="side-count">{favorites.length}</span>
        </button>
        <button
          className={scope === 'recent' ? 'side-item active' : 'side-item'}
          onClick={() => setScope('recent')}
        >
          {SCOPE_LABEL.recent} <span className="side-count">{recent.length}</span>
        </button>

        <div className="side-divider" />
        <div className="side-title">领域导航</div>
        <button
          className={scope === 'all' && domainFilter === 'all' ? 'side-item active' : 'side-item'}
          onClick={() => pickDomain('all')}
        >
          全部领域 <span className="side-count">{s.total}</span>
        </button>
        {groups.map((g) => (
          <button
            key={g.domain}
            className={
              scope === 'all' && domainFilter === g.domain ? 'side-item active' : 'side-item'
            }
            onClick={() => pickDomain(g.domain)}
          >
            {DOMAIN_LABEL[g.domain]} <span className="side-count">{g.items.length}</span>
          </button>
        ))}
        <div className="side-note">
          公式库由元数据驱动，卡片展示版本、状态与标准依据；收藏与最近使用仅保存在本机。
        </div>
      </aside>

      <div className="sidebar-resizer" onMouseDown={handleSideResize} />

      <section className="library-main">
        <div className="lib-toolbar">
          <input
            className="search-input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索公式：压降 / 导热 / 螺栓 / 消声器 / 电池…"
          />
          <select
            className="lib-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as LibrarySort)}
            disabled={scope === 'recent'}
            title={scope === 'recent' ? '最近使用范围按打开时间倒序' : '排序方式'}
          >
            <option value="default">默认排序</option>
            <option value="recent">最近使用优先</option>
            <option value="title">按名称排序</option>
          </select>
          <span className="lib-count">共 {found.length} 条</span>
        </div>

        <div className="formula-cards">
          {found.map((f) => {
            const fav = favorites.includes(f.id);
            const refs = f.standardRefs ?? [];
            const upCount = upstreamLinks(f.id).length;
            const downCount = downstreamLinks(f.id).length;
            return (
              <article className="formula-card" key={f.id} onClick={() => onOpen(f)}>
                <header>
                  <h4>{f.title}</h4>
                  <div className="card-head-right">
                    <span className="tag domain">{DOMAIN_LABEL[f.domain]}</span>
                    <button
                      className={fav ? 'fav-btn active' : 'fav-btn'}
                      title={fav ? '取消收藏' : '收藏该公式'}
                      aria-label={fav ? '取消收藏' : '收藏该公式'}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFav(f.id);
                      }}
                    >
                      {fav ? '★' : '☆'}
                    </button>
                  </div>
                </header>
                <p className="card-summary">{IS_STANDARD ? briefOf(f) : f.summary}</p>
                <div className="card-meta">
                  <span className={`status-badge ${f.status}`}>
                    {FORMULA_STATUS_LABEL[f.status]}
                  </span>
                  <span className="card-ver">v{f.version}</span>
                  {refs.length > 0 && (
                    <span
                      className="card-standard"
                      title={refs
                        .map((r) => [r.code, r.title, r.clause].filter(Boolean).join(' '))
                        .join('\n')}
                    >
                      {refs[0].code}
                      {refs.length > 1 ? ` 等 ${refs.length} 项` : ''}
                    </span>
                  )}
                  {(upCount > 0 || downCount > 0) && (
                    <span className="card-chain" title="与其他公式的结果传递关系">
                      链路 上游 {upCount} · 下游 {downCount}
                    </span>
                  )}
                </div>
                <div className="card-tags">
                  <span className="tag light">{f.subsystem}</span>
                  {f.tags.slice(0, 3).map((t) => (
                    <span className="tag light" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
                <footer>
                  <span className="card-id">{f.id}</span>
                  <span className="card-action">打开计算 →</span>
                </footer>
              </article>
            );
          })}
          {found.length === 0 && <p className="empty-hint">{emptyHint}</p>}
        </div>
      </section>
    </div>
  );
}
