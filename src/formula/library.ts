/**
 * 公式库检索与个人化偏好（收藏 / 最近使用）
 *
 * 与界面解耦的纯函数便于单元测试；localStorage 读写集中在此封装，
 * 在无 window 的环境（单元测试）下自动降级为空列表。
 */
import type { Domain, FormulaSpec } from './types';
import { searchFormulas } from './registry';

/** 检索范围：全部 / 我的收藏 / 最近使用 */
export type LibraryScope = 'all' | 'favorite' | 'recent';

/** 排序方式：注册表默认（领域 + 名称）/ 最近使用优先 / 名称 */
export type LibrarySort = 'default' | 'recent' | 'title';

export const FAVORITES_KEY = 'ctr.formulaFavorites';
export const RECENT_KEY = 'ctr.formulaRecent';
/** 最近使用保留条数 */
export const RECENT_LIMIT = 8;

export interface LibraryQuery {
  keyword?: string;
  domain?: Domain | 'all';
  scope?: LibraryScope;
  sort?: LibrarySort;
  favorites?: string[];
  recent?: string[];
}

/** 切换收藏：已收藏则移除，未收藏追加到末尾 */
export function toggleFavorite(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** 最近使用：去重后置顶，超出上限截断 */
export function pushRecent(ids: string[], id: string, limit = RECENT_LIMIT): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, limit);
}

function readList(key: string): string[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key: string, ids: string[]): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* 存储不可用时静默忽略，不阻断浏览 */
  }
}

export function loadFavorites(): string[] {
  return readList(FAVORITES_KEY);
}

export function saveFavorites(ids: string[]): void {
  writeList(FAVORITES_KEY, ids);
}

export function loadRecent(): string[] {
  return readList(RECENT_KEY);
}

export function saveRecent(ids: string[]): void {
  writeList(RECENT_KEY, ids);
}

/** 打开公式时记录最近使用（计算页入口调用） */
export function recordRecent(id: string): void {
  saveRecent(pushRecent(loadRecent(), id));
}

/**
 * 公式库检索：关键词 → 领域 → 范围（全部/收藏/最近）→ 排序。
 * 「最近使用」范围按打开时间倒序，忽略排序设置。
 */
export function filterFormulas(q: LibraryQuery = {}): FormulaSpec[] {
  let list = searchFormulas(q.keyword ?? '');
  if (q.domain && q.domain !== 'all') list = list.filter((f) => f.domain === q.domain);

  const favorites = q.favorites ?? [];
  const recent = q.recent ?? [];

  if (q.scope === 'favorite') list = list.filter((f) => favorites.includes(f.id));
  if (q.scope === 'recent') {
    const rank = new Map(recent.map((id, i) => [id, i]));
    return list
      .filter((f) => rank.has(f.id))
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  }

  if (q.sort === 'recent') {
    const rank = new Map(recent.map((id, i) => [id, i]));
    return [...list].sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  if (q.sort === 'title') {
    return [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
  }
  return list;
}
