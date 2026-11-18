/**
 * 页面懒加载登记表
 *
 * 目的：App.tsx 不再静态引入全部页面，首屏只加载登录与框架，
 * 其余页面按导航访问时再拉取各自的 chunk。
 *
 * 新增页面时：在此追加一行 lazy 包装，并在 App.tsx 中按需渲染即可。
 * 同一文件导出多个页面时（如 KbeDocPage）会共享同一个 chunk，不会重复打包。
 */
import { lazy } from 'react';

export const HomePage = lazy(() => import('./HomePage').then((m) => ({ default: m.HomePage })));

export const LibraryPage = lazy(() => import('./LibraryPage').then((m) => ({ default: m.LibraryPage })));

export const CalculatorPage = lazy(() =>
  import('./CalculatorPage').then((m) => ({ default: m.CalculatorPage })),
);

export const HistoryPage = lazy(() => import('./HistoryPage').then((m) => ({ default: m.HistoryPage })));

export const ComparePanel = lazy(() => import('./HistoryPage').then((m) => ({ default: m.ComparePanel })));

export const ProjectsPage = lazy(() => import('./ProjectsPage').then((m) => ({ default: m.ProjectsPage })));

export const ProjectCheckPage = lazy(() =>
  import('./ProjectCheckPage').then((m) => ({ default: m.ProjectCheckPage })),
);

export const TestReportsPage = lazy(() =>
  import('./TestReportsPage').then((m) => ({ default: m.TestReportsPage })),
);

export const TestsSearchPage = lazy(() =>
  import('./TestsSearchPage').then((m) => ({ default: m.TestsSearchPage })),
);

export const CaeReportsPage = lazy(() =>
  import('./CaeReportsPage').then((m) => ({ default: m.CaeReportsPage })),
);

export const CaeSearchPage = lazy(() => import('./CaeSearchPage').then((m) => ({ default: m.CaeSearchPage })));

export const LabPage = lazy(() => import('./LabPage').then((m) => ({ default: m.LabPage })));

export const DatabasePage = lazy(() => import('./DatabasePage').then((m) => ({ default: m.DatabasePage })));

export const MaterialsImportPage = lazy(() =>
  import('./MaterialsImportPage').then((m) => ({ default: m.MaterialsImportPage })),
);

export const MaterialsSearchPage = lazy(() =>
  import('./MaterialsSearchPage').then((m) => ({ default: m.MaterialsSearchPage })),
);

export const FmeaImportPage = lazy(() => import('./FmeaImportPage').then((m) => ({ default: m.FmeaImportPage })));

export const FmeaSearchPage = lazy(() => import('./FmeaSearchPage').then((m) => ({ default: m.FmeaSearchPage })));

export const TrainingImportPage = lazy(() =>
  import('./TrainingImportPage').then((m) => ({ default: m.TrainingImportPage })),
);

export const TrainingSearchPage = lazy(() =>
  import('./TrainingSearchPage').then((m) => ({ default: m.TrainingSearchPage })),
);

export const TheoryImportPage = lazy(() =>
  import('./TheoryImportPage').then((m) => ({ default: m.TheoryImportPage })),
);

export const TheorySearchPage = lazy(() =>
  import('./TheorySearchPage').then((m) => ({ default: m.TheorySearchPage })),
);

export const KbeDocImportPage = lazy(() => import('./KbeDocPage').then((m) => ({ default: m.KbeDocImportPage })));

export const KbeDocSearchPage = lazy(() => import('./KbeDocPage').then((m) => ({ default: m.KbeDocSearchPage })));

export const ProductLibraryPage = lazy(() =>
  import('./ProductLibraryPage').then((m) => ({ default: m.ProductLibraryPage })),
);

export const SettingsPage = lazy(() => import('./SettingsPage').then((m) => ({ default: m.SettingsPage })));

export const AiOptimizePage = lazy(() =>
  import('./AiOptimizePage').then((m) => ({ default: m.AiOptimizePage })),
);

/** 页面 chunk 加载中的占位，避免切换导航时出现空白闪烁 */
export function PageLoading() {
  return <div className="page-loading">页面加载中…</div>;
}
