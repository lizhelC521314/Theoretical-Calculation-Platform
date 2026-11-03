import { useCallback, useEffect, useState } from 'react';
import { api, type CtrUser, type HistoryEntry, type Project } from './api';
import { getFormula } from './formula/registry';
import type { FormulaSpec } from './formula/types';
import { BRAND } from './branding';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { CalculatorPage } from './pages/CalculatorPage';
import { ComparePanel, HistoryPage } from './pages/HistoryPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { TestReportsPage } from './pages/TestReportsPage';
import { TestsSearchPage } from './pages/TestsSearchPage';
import { LabPage } from './pages/LabPage';
import { DatabasePage } from './pages/DatabasePage';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';
import { SettingsPage } from './pages/SettingsPage';

type Page = 'home' | 'projects' | 'library' | 'calc' | 'history' | 'testsImport' | 'testsSearch' | 'lab' | 'db' | 'kbe' | 'compare' | 'settings';
type NavGroupKey = 'theory' | 'tests';

interface NavLeaf { key: Page; label: string; icon?: string }
interface NavGroup { key: NavGroupKey; label: string; icon: string; children: NavLeaf[] }
type NavItem = NavGroup | NavLeaf;

const NAV: NavItem[] = [
  { key: 'home', label: '工作台', icon: '⌂' },
  { key: 'projects', label: '项目管理', icon: '▤' },
  {
    key: 'theory',
    label: '理论设计',
    icon: '✎',
    children: [
      { key: 'library', label: '公式库', icon: '∑' },
      { key: 'history', label: '计算记录', icon: '≡' },
    ],
  },
  {
    key: 'tests',
    label: '实验报告',
    icon: '⚗',
    children: [
      { key: 'testsImport', label: '实验报告导入', icon: '⇪' },
      { key: 'testsSearch', label: '实验报告检索', icon: '🔍' },
      { key: 'lab', label: '数据入库与校准', icon: '🧪' },
    ],
  },
  { key: 'db', label: '产品数据库', icon: '🗄' },
  { key: 'kbe', label: '知识经验库', icon: '📚' },
  { key: 'settings', label: '设置', icon: '⚙' },
];

/** 某页面是否属于某个父组（决定组级高亮） */
function groupContains(group: NavGroup, p: Page): boolean {
  if (group.key === 'theory') return ['library', 'calc', 'history', 'compare'].includes(p);
  if (group.key === 'tests') return ['testsImport', 'testsSearch', 'lab'].includes(p);
  return false;
}

/** 记住每个用户上次选中的项目 */
function savedProjectId(userId: string): string | null {
  return window.localStorage.getItem(`ctr.currentProject.${userId}`);
}

export function App() {
  const [user, setUser] = useState<CtrUser | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [formula, setFormula] = useState<FormulaSpec | null>(null);
  const [compare, setCompare] = useState<{ a: HistoryEntry; b: HistoryEntry } | null>(null);
  const [libDomain, setLibDomain] = useState<string | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [expanded, setExpanded] = useState<Set<NavGroupKey>>(new Set(['theory']));

  // 侧边栏可拖动宽度
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const v = window.localStorage.getItem('ctr.sidebarWidth');
    const n = v ? Number(v) : 216;
    return Number.isFinite(n) && n >= 160 && n <= 420 ? n : 216;
  });

  useEffect(() => {
    window.localStorage.setItem('ctr.sidebarWidth', String(sidebarWidth));
  }, [sidebarWidth]);

  const refreshProjects = useCallback(async () => {
    if (!user) return;
    const list = await api.project.list(user.id);
    setProjects(list);
    const keep = list.find((p) => p.id === savedProjectId(user.id));
    setCurrentProject((prev) => keep ?? (prev && list.find((p) => p.id === prev.id)) ?? null);
  }, [user]);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const selectProject = useCallback(
    (p: Project | null) => {
      setCurrentProject(p);
      if (user) {
        if (p) window.localStorage.setItem(`ctr.currentProject.${user.id}`, p.id);
        else window.localStorage.removeItem(`ctr.currentProject.${user.id}`);
      }
    },
    [user],
  );

  const openFormula = useCallback((f: FormulaSpec) => {
    setFormula(f);
    setPage('calc');
  }, []);

  const openById = useCallback((id: string) => {
    const f = getFormula(id);
    if (f) openFormula(f);
  }, [openFormula]);

  // 侧边栏宽度拖动
  const handleSidebarResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      const minW = 160, maxW = 420;
      const onMove = (ev: MouseEvent) => {
        const next = Math.min(maxW, Math.max(minW, startW + (ev.clientX - startX)));
        setSidebarWidth(next);
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
    [sidebarWidth],
  );

  useEffect(() => {
    if (!user) return;
    // 未授权时仅提示，不阻断使用（试用模式），授权策略可在设置页激活
    window.document.title = `${BRAND.productName} - ${BRAND.companyShort}`;
  }, [user]);

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  const pageTitle: Record<Page, string> = {
    home: '工作台',
    projects: '项目管理',
    library: '公式库',
    calc: formula?.title ?? '计算',
    history: '计算记录',
    testsImport: '实验报告导入',
    testsSearch: '实验报告检索',
    lab: '实验数据入库与模型校准',
    db: '产品数据库',
    kbe: '知识经验库',
    compare: '方案对比',
    settings: '设置',
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <div className="sidebar-brand">
          <img src={BRAND.logoUrl} alt="LOGO" />
          <div className="sb-text">
            <div className="sb-company">{BRAND.companyShort}</div>
            <div className="sb-product">{BRAND.productShort}</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((n) => {
            if ('children' in n) {
              const isActive = groupContains(n, page);
              const open = expanded.has(n.key);
              return (
                <div key={n.key} className="nav-group">
                  <button
                    className={isActive ? 'nav-item active' : 'nav-item'}
                    onClick={() => {
                      const next = new Set(expanded);
                      if (next.has(n.key)) next.delete(n.key);
                      else next.add(n.key);
                      setExpanded(next);
                    }}
                  >
                    <span className="nav-icon">{n.icon}</span>
                    {n.label}
                    <span className={open ? 'nav-chev open' : 'nav-chev'}>›</span>
                  </button>
                  {open &&
                    n.children.map((c) => (
                      <button
                        key={c.key}
                        className={page === c.key || (c.key === 'library' && page === 'calc') ? 'nav-item active nav-sub' : 'nav-item nav-sub'}
                        onClick={() => {
                          if (c.key === 'library') setLibDomain(undefined);
                          setPage(c.key);
                        }}
                      >
                        <span className="nav-icon">{c.icon}</span>
                        {c.label}
                      </button>
                    ))}
                </div>
              );
            }
            return (
              <button
                key={n.key}
                className={page === n.key ? 'nav-item active' : 'nav-item'}
                onClick={() => setPage(n.key)}
              >
                <span className="nav-icon">{n.icon}</span>
                {n.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="sf-version">v{BRAND.version}</div>
          <div className="sf-copy">{BRAND.companyName}</div>
        </div>
      </aside>
      <div className="sidebar-resizer" onMouseDown={handleSidebarResize} />

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-title">{pageTitle[page]}</div>
          <div className="topbar-user">
            <span className="tu-project-label">当前项目</span>
            <select
              className="tu-project"
              value={currentProject?.id ?? ''}
              onChange={(e) => {
                const p = projects.find((x) => x.id === e.target.value) ?? null;
                selectProject(p);
              }}
            >
              <option value="">（临时计算）</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="tu-name">{user.displayName || user.username}</span>
            <span className="tu-role">{user.role === 'admin' ? '管理员' : '工程师'}</span>
            <button className="btn-link" onClick={() => setUser(null)}>
              退出
            </button>
          </div>
        </header>

        <main className="content">
          {page === 'home' && (
            <HomePage
              user={user}
              onOpenLibrary={(d) => {
                setLibDomain(d);
                setPage('library');
              }}
              onReopen={openById}
            />
          )}
          {page === 'projects' && (
            <ProjectsPage
              user={user}
              projects={projects}
              currentProject={currentProject}
              onSelectProject={selectProject}
              onProjectsChange={refreshProjects}
            />
          )}
          {page === 'library' && (
            <LibraryPage key={libDomain ?? 'all'} onOpen={openFormula} initialDomain={libDomain} />
          )}
          {page === 'calc' && formula && (
            <CalculatorPage formula={formula} user={user} project={currentProject} onBack={() => setPage('library')} />
          )}
          {page === 'history' && (
            <HistoryPage
              user={user}
              projects={projects}
              onReopen={openById}
              onOpenCompare={(a, b) => {
                setCompare({ a, b });
                setPage('compare');
              }}
            />
          )}
          {page === 'testsImport' && <TestReportsPage user={user} currentProject={currentProject} />}
          {page === 'testsSearch' && <TestsSearchPage user={user} />}
          {page === 'lab' && <LabPage user={user} />}
          {page === 'db' && <DatabasePage user={user} />}
          {page === 'kbe' && <KnowledgeBasePage user={user} />}
          {page === 'compare' && compare && (
            <ComparePanel a={compare.a} b={compare.b} onBack={() => setPage('history')} />
          )}
          {page === 'settings' && <SettingsPage user={user} />}
        </main>
      </div>
    </div>
  );
}
