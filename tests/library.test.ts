import { describe, expect, it } from 'vitest';
import { listFormulas, searchFormulas } from '../src/formula/registry';
import {
  filterFormulas,
  loadFavorites,
  loadRecent,
  pushRecent,
  RECENT_LIMIT,
  toggleFavorite,
} from '../src/formula/library';

/** P2 公式库：检索范围、排序与个人化偏好 */
describe('公式库检索与偏好', () => {
  const all = listFormulas();
  const [first, second] = all;

  it('收藏切换：新增追加、再次点击移除，顺序不变', () => {
    expect(toggleFavorite([], 'a')).toEqual(['a']);
    expect(toggleFavorite(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleFavorite(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('最近使用：去重置顶并限制保留条数', () => {
    let ids: string[] = [];
    for (const id of ['a', 'b', 'c', 'a']) ids = pushRecent(ids, id);
    expect(ids).toEqual(['a', 'c', 'b']);

    let many: string[] = [];
    for (let i = 0; i < RECENT_LIMIT + 3; i++) many = pushRecent(many, `f${i}`);
    expect(many).toHaveLength(RECENT_LIMIT);
    expect(many[0]).toBe(`f${RECENT_LIMIT + 2}`);
  });

  it('关键词 + 领域可叠加筛选', () => {
    expect(filterFormulas({ keyword: '消声器' }).map((f) => f.id)).toEqual(
      searchFormulas('消声器').map((f) => f.id),
    );

    const acoustics = filterFormulas({ domain: 'acoustics' });
    expect(acoustics.length).toBeGreaterThan(0);
    expect(acoustics.every((f) => f.domain === 'acoustics')).toBe(true);

    const both = filterFormulas({ domain: 'acoustics', keyword: '消声器' });
    expect(both.every((f) => f.domain === 'acoustics')).toBe(true);
    expect(both.length).toBeLessThanOrEqual(acoustics.length);
  });

  it('收藏范围只保留已收藏公式', () => {
    const ids = filterFormulas({ scope: 'favorite', favorites: [first.id] }).map((f) => f.id);
    expect(ids).toEqual([first.id]);
    expect(filterFormulas({ scope: 'favorite', favorites: [] })).toEqual([]);
  });

  it('最近使用范围按打开时间倒序', () => {
    const ids = filterFormulas({ scope: 'recent', recent: [second.id, first.id] }).map((f) => f.id);
    expect(ids).toEqual([second.id, first.id]);
    // 未使用过的公式不出现在最近使用中
    expect(filterFormulas({ scope: 'recent', recent: [first.id] })).toHaveLength(1);
  });

  it('排序：最近使用优先与按名称', () => {
    const recentFirst = filterFormulas({ sort: 'recent', recent: [second.id] }).map((f) => f.id);
    expect(recentFirst[0]).toBe(second.id);
    expect(recentFirst).toHaveLength(all.length);

    const byTitle = filterFormulas({ sort: 'title' }).map((f) => f.title);
    const expected = [...all.map((f) => f.title)].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    expect(byTitle).toEqual(expected);
  });

  it('默认返回注册表顺序；无 window 环境下偏好读取为空', () => {
    expect(filterFormulas().map((f) => f.id)).toEqual(all.map((f) => f.id));
    expect(loadFavorites()).toEqual([]);
    expect(loadRecent()).toEqual([]);
  });
});
