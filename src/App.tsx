import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type CtrUser, type HistoryEntry, type Project } from './api';
import { getFormula } from './formula/registry';
import type { FormulaSpec } from './formula/types';
import { BRAND } from './branding';
import { IS_STANDARD } from './edition';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { CalculatorPage } from './pages/CalculatorPage';
import { ComparePanel, HistoryPage } from './pages/HistoryPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { TestReportsPage } from './pages/TestReportsPage';
import { TestsSearchPage } from './pages/TestsSearchPage';
import { CaeReportsPage } from './pages/CaeReportsPage';
import { CaeSearchPage } from './pages/CaeSearchPage';
import { LabPage } from './pages/LabPage';
import { DatabasePage } from './pages/DatabasePage';
import { MaterialsImportPage } from './pages/MaterialsImportPage';
import { MaterialsSearchPage } from './pages/MaterialsSearchPage';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';
import { FmeaImportPage } from './pages/FmeaImportPage';
import { FmeaSearchPage } from './pages/FmeaSearchPage';
import { TrainingImportPage } from './pages/TrainingImportPage';
import { TrainingSearchPage } from './pages/TrainingSearchPage';
import { TheoryImportPage } from './pages/TheoryImportPage';
import { TheorySearchPage } from './pages/TheorySearchPage';
import { SettingsPage } from './pages/SettingsPage';

type Page = 'home' | 'projects' | 'library' | 'calc' | 'history' | 'testsImport' | 'testsSearch' | 'lab' | 'caeImport' | 'caeSearch' | 'materialImport' | 'materialSearch' | 'fmeaImport' | 'fmeaSearch' | 'trainingImport' | 'trainingSearch' | 'theoryImport' | 'theorySearch' | 'db' | 'kbe' | 'compare' | 'settings';

interface NavLeaf { key: Page; label: string; icon?: string }
/** 分组可嵌套：如「产品验证」下的「试验报告」子分组 */
interface NavGroup { key: string; label: string; icon: string; children: Array<NavLeaf | NavGroup> }
type NavItem = NavGroup | NavLeaf;

const NAV: NavItem[] = [
  { key: 'home', label: '工作台', icon: '⌂' },
  { key: 'projects', label: '项目管理', icon: '▤' },
  {
    key: 'theory',
    label: '产品理论设计',
    icon: '✎',
    children: [
      { key: 'library', label: '公式库', icon: '∑' },
      { key: 'history', label: '计算记录', icon: '≡' },
    ],
  },
  {
    key: 'validation',
    label: '产品验证',
    icon: '✓',
    children: [
      {
        key: 'reports',
        label: '试验报告',
        icon: '⚗',
        children: [
          { key: 'testsImport', label: '试验报告导入', icon: '⇪' },
          { key: 'testsSearch', label: '试验报告检索', icon: '🔍' },
          { key: 'lab', label: '数据入库与校准', icon: '🧪' },
        ],
      },
      { key: 'virtualValidation', label: '虚拟验证', icon: '◈',
        children: [
          { key: 'caeImport', label: 'CAE报告导入', icon: '⇪' },
          { key: 'caeSearch', label: 'CAE报告检索', icon: '🔍' },
        ],
      },
    ],
  },
  { key: 'db', label: '产品数据库', icon: '🗄' },
  {
    key: 'material',
    label: '材料库',
    icon: '◫',
    children: [
      { key: 'materialImport', label: '材料数据导入', icon: '⇪' },
      { key: 'materialSearch', label: '材料检索', icon: '🔍' },
    ],
  },
  {
    key: 'kbeGroup',
    label: '知识经验库',
    icon: '📚',
    children: [
      {
        key: 'theory',
        label: '知识理论',
        icon: '📖',
        children: [
          { key: 'theoryImport', label: '知识理论导入', icon: '⇪' },
          { key: 'theorySearch', label: '知识理论检索', icon: '🔍' },
        ],
      },
      { key: 'kbe', label: '产品设计库', icon: '📂' },
      {
        key: 'fmea',
        label: 'FMEA库',
        icon: '◈',
        children: [
          { key: 'fmeaImport', label: 'FMEA 导入', icon: '⇪' },
          { key: 'fmeaSearch', label: 'FMEA 检索', icon: '🔍' },
        ],
      },
      {
        key: 'training',
        label: '培训',
        icon: '🎓',
        children: [
          { key: 'trainingImport', label: '培训资料导入', icon: '⇪' },
          { key: 'trainingSearch', label: '培训资料检索', icon: '🔍' },
        ],
      },
    ],
  },
  { key: 'settings', label: '设置', icon: '⚙' },
];

/** 标准版不提供的导入 / 校准类页面 */
const STANDARD_HIDDEN_PAGES = new Set<Page>(['testsImport', 'lab', 'caeImport', 'materialImport', 'fmeaImport', 'trainingImport', 'theoryImport']);

/** 标准版导航：剔除导入类页面，并把只剩检索项的子分组上提为直接的检索入口 */
function standardNav(items: NavItem[]): NavItem[] {
  const out: NavItem[] = [];
  for (const item of items) {
    if (!('children' in item)) {
      if (!STANDARD_HIDDEN_PAGES.has(item.key)) out.push(item);
      continue;
    }
    const children = standardNav(item.children);
    if (children.length === 0) continue;
    const allLeaves = children.every((c) => !('children' in c));
    if (allLeaves && (item.key === 'reports' || item.key === 'virtualValidation')) {
      out.push(...children);
    } else {
      out.push({ ...item, children });
    }
  }
  return out;
}

const APP_NAV: NavItem[] = IS_STANDARD ? standardNav(NAV) : NAV;

/** 某页面是否属于某个父组（决定组级高亮，支持多级嵌套） */
function groupContains(group: NavGroup, p: Page): boolean {
  return group.children.some((c) => {
    if ('children' in c) return groupContains(c, p);
    if (c.key === p) return true;
    if (c.key === 'library') return p === 'calc';
    if (c.key === 'history') return p === 'compare';
    return false;
  });
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
  // 启动时所有模块分组默认折叠，仅一级入口可见，便于操作者快速定位
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 标准版兜底：隐藏页面（如旧状态残留）统一回到工作台
  useEffect(() => {
    if (IS_STANDARD && STANDARD_HIDDEN_PAGES.has(page)) setPage('home');
  }, [page]);

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
    testsImport: '试验报告导入',
    testsSearch: '试验报告检索',
    lab: '实验数据入库与模型校准',
    caeImport: 'CAE报告导入',
    caeSearch: 'CAE报告检索',
    materialImport: '材料数据导入',
    materialSearch: '材料检索',
    fmeaImport: 'FMEA 导入',
    fmeaSearch: 'FMEA 检索',
    trainingImport: '培训资料导入',
    trainingSearch: '培训资料检索',
    theoryImport: '知识理论导入',
    theorySearch: '知识理论检索',
    db: '产品数据库',
    kbe: '产品设计库',
    compare: '方案对比',
    settings: '设置',
  };

  /** 递归渲染左侧导航（支持「产品验证 → 试验报告」这类二级分组） */
  const renderNavItems = (items: Array<NavLeaf | NavGroup>, depth: number): ReactNode[] =>
    items.map((n): ReactNode => {
      if ('children' in n) {
        const open = expanded.has(n.key);
        const active = groupContains(n, page);
        const base = depth > 0 ? 'nav-item nav-sub' : 'nav-item';
        return (
          <div key={n.key} className="nav-group">
            <button
              className={active ? `${base} active` : base}
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
            {open && renderNavItems(n.children, depth + 1)}
          </div>
        );
      }
      const active = n.key === page || (n.key === 'library' && page === 'calc');
      const cls = `nav-item${depth > 0 ? ' nav-sub' : ''}${depth > 1 ? ' nav-sub-2' : ''}${active ? ' active' : ''}`;
      return (
        <button
          key={n.key}
          className={cls}
          onClick={() => {
            if (n.key === 'library') setLibDomain(undefined);
            setPage(n.key);
          }}
        >
          <span className="nav-icon">{n.icon}</span>
          {n.label}
        </button>
      );
    });

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
        <nav className="sidebar-nav">{renderNavItems(APP_NAV, 0)}</nav>
        <div className="sidebar-footer">
          <div className="sf-version">
            v{BRAND.version}
            {IS_STANDARD ? ' · 标准版' : ''} · {__BUILD_TIME__.slice(0, 16).replace('T', ' ')}
          </div>
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
          {page === 'caeImport' && <CaeReportsPage user={user} currentProject={currentProject} />}
          {page === 'caeSearch' && <CaeSearchPage user={user} />}
          {page === 'materialImport' && <MaterialsImportPage user={user} />}
          {page === 'materialSearch' && <MaterialsSearchPage user={user} />}
          {page === 'fmeaImport' && <FmeaImportPage user={user} />}
          {page === 'fmeaSearch' && <FmeaSearchPage user={user} onOpenImport={() => setPage('fmeaImport')} />}
          {page === 'trainingImport' && <TrainingImportPage user={user} />}
          {page === 'trainingSearch' && <TrainingSearchPage user={user} onOpenImport={() => setPage('trainingImport')} />}
          {page === 'theoryImport' && <TheoryImportPage user={user} />}
          {page === 'theorySearch' && <TheorySearchPage user={user} onOpenImport={() => setPage('theoryImport')} />}
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
