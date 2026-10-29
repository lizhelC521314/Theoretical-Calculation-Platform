import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormulaSpec } from '../formula/types';
import { DOMAIN_LABEL } from '../formula/types';
import { groupByDomain, searchFormulas, stats } from '../formula/registry';

interface Props {
  onOpen: (f: FormulaSpec) => void;
  initialDomain?: string;
}

/** 公式库：左侧领域导航，右侧公式卡片列表，支持关键词搜索 */
export function LibraryPage({ onOpen, initialDomain }: Props) {
  const [keyword, setKeyword] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>(initialDomain ?? 'all');

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
  const found = useMemo(() => {
    const list = keyword.trim() ? searchFormulas(keyword) : searchFormulas('');
    return domainFilter === 'all' ? list : list.filter((f) => f.domain === domainFilter);
  }, [keyword, domainFilter]);

  const s = useMemo(() => stats(), []);

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
        <div className="side-title">领域导航</div>
        <button
          className={domainFilter === 'all' ? 'side-item active' : 'side-item'}
          onClick={() => setDomainFilter('all')}
        >
          全部公式 <span className="side-count">{s.total}</span>
        </button>
        {groups.map((g) => (
          <button
            key={g.domain}
            className={domainFilter === g.domain ? 'side-item active' : 'side-item'}
            onClick={() => setDomainFilter(g.domain)}
          >
            {DOMAIN_LABEL[g.domain]} <span className="side-count">{g.items.length}</span>
          </button>
        ))}
        <div className="side-note">
          公式库由元数据驱动，后续新增公式后会自动出现在此处，无需升级界面。
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
          <span className="lib-count">共 {found.length} 条</span>
        </div>

        <div className="formula-cards">
          {found.map((f) => (
            <article className="formula-card" key={f.id} onClick={() => onOpen(f)}>
              <header>
                <h4>{f.title}</h4>
                <span className="tag domain">{DOMAIN_LABEL[f.domain]}</span>
              </header>
              <p className="card-summary">{f.summary}</p>
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
          ))}
          {found.length === 0 && <p className="empty-hint">未找到匹配的公式，请调整关键词。</p>}
        </div>
      </section>
    </div>
  );
}
