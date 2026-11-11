import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CtrUser } from '../api';
import { IS_STANDARD } from '../edition';
import { FmeaImageCell, FmeaImageInput } from '../components/FmeaImageInput';
import {
  addFmeaCitation,
  classCode,
  deriveDesignGuide,
  deriveRiskLevel,
  draftFromRecord,
  expandFmeaTerms,
  fmeaCardText,
  fmeaCsvFileName,
  fmeaRecordToCsv,
  fmeaRpn,
  FMEA_FIELDS,
  FMEA_IMAGE_FIELDS,
  parseFmeaRecord,
  productMajorOf,
  productMinorOf,
  scoreFmeaRecord,
  similarFmeaRecords,
  validateFmeaDraft,
  yearFromDate,
  type FmeaDraft,
  type FmeaRecord,
  type RiskLevel,
} from '../report/fmea';

interface Props {
  user: CtrUser;
  /** 跳到导入页（标准版不提供） */
  onOpenImport?: () => void;
}

interface FmeaFile {
  name: string;
  size: number;
  mtime: string;
  fullPath: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

type SortBy = 'relevance' | 'risk' | 'latest' | 'cited';

/** 年份：编号优先，其次记录时间 */
function recordYear(rec: FmeaRecord): number {
  const m = rec.id.match(/FM-(\d{4})/i);
  return m ? Number(m[1]) : yearFromDate(rec.recordDate);
}

/** 老数据没有风险等级时按后果即时判定，不写回文件 */
function riskOf(rec: FmeaRecord): RiskLevel {
  return rec.riskLevel || deriveRiskLevel(rec);
}

const RISK_RANK: Record<string, number> = { 高: 0, 中: 1, 低: 2, '': 3 };

function riskClass(level: RiskLevel): string {
  return level === '高' ? 'high' : level === '低' ? 'low' : 'mid';
}

function shortText(text: string, max = 60): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 把「原因 / 后果」拆成短句，最多 3 条，便于一屏读完 */
function bullets(text: string, max = 3): string[] {
  return String(text || '')
    .split(/[\n；;。]/)
    .map((s) => s.replace(/^\s*\d+[.、)]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 关键词高亮（同义词命中同样标黄） */
function highlight(text: string, terms: string[]) {
  if (!text || terms.length === 0) return text;
  const words = Array.from(new Set(terms.filter(Boolean))).sort((a, b) => b.length - a.length);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark className="fmea-hl" key={i}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/**
 * FMEA库检索（P1：分面筛选 + 同义词搜索 + 风险排序 + 一屏失效链）
 * 左侧四行卡片快速扫读，右侧摘要条、一句话结论、失效链、设计规避、措施与引用记录一屏展开。
 */
export function FmeaSearchPage({ user, onOpenImport }: Props) {
  const [files, setFiles] = useState<FmeaFile[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [cache, setCache] = useState<Record<string, FmeaRecord | null>>({});
  const [cacheBusy, setCacheBusy] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [systemFilter, setSystemFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [sortBy, setSortBy] = useState<SortBy>('relevance');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<FmeaDraft | null>(null);
  const [editIssues, setEditIssues] = useState<string[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [citeProjectId, setCiteProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const ping = await api.db.ping();
      setReachable(ping.reachable);
      const res = await api.db.list({ libType: 'fmea' });
      if (res.ok) setFiles(res.files || []);
      else setError(res.message || '读取 FMEA 库失败');
    } catch (e) {
      setError(`读取 FMEA 库失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 引用到项目需要项目列表
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.project.list(user.id);
        if (!cancelled) setProjects((list || []).map((p) => ({ id: p.id, name: p.name })));
      } catch {
        // 项目列表读取失败不影响检索
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  // 文件名之外的信息都在 Parquet 里，进页面后分批读取并缓存（每次 6 个，避免 UNC 并发过多）
  useEffect(() => {
    const todo = files.filter((f) => !(f.fullPath in cache));
    if (!todo.length) return;
    let cancelled = false;
    setCacheBusy(true);
    (async () => {
      for (let i = 0; i < todo.length; i += 6) {
        const batch = todo.slice(i, i + 6);
        const part = await Promise.all(
          batch.map(async (f) => {
            try {
              const res = await api.db.readText({ fullPath: f.fullPath });
              return [f.fullPath, res.ok && res.text ? parseFmeaRecord(res.text) : null] as const;
            } catch {
              return [f.fullPath, null] as const;
            }
          }),
        );
        if (cancelled) return;
        setCache((prev) => {
          const next = { ...prev };
          part.forEach(([k, v]) => {
            next[k] = v;
          });
          return next;
        });
      }
      if (!cancelled) setCacheBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [files, cache]);

  const loaded = useMemo(
    () =>
      files
        .map((file) => ({ file, rec: cache[file.fullPath] }))
        .filter((x): x is { file: FmeaFile; rec: FmeaRecord } => !!x.rec),
    [files, cache],
  );

  /** 分面计数：按出现次数排序，便于快速判断库内主要系统与产品大类 */
  const facetCounts = useCallback((get: (rec: FmeaRecord) => string) => {
    const map = new Map<string, number>();
    for (const { rec } of loaded) {
      const key = get(rec).trim() || '未填写';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
  }, [loaded]);

  const systems = useMemo(() => facetCounts((r) => r.system), [facetCounts]);
  const products = useMemo(() => facetCounts((r) => r.productCategory), [facetCounts]);
  const categories = useMemo(() => facetCounts((r) => r.failureCategory), [facetCounts]);
  const riskCounts = useMemo(() => facetCounts((r) => riskOf(r)), [facetCounts]);
  const years = useMemo(
    () => Array.from(new Set(loaded.map((x) => recordYear(x.rec)))).sort((a, b) => b - a),
    [loaded],
  );

  const query = keyword.trim();
  const queryTerms = useMemo(() => (query ? expandFmeaTerms(query) : []), [query]);

  const filtered = useMemo(() => {
    const scored = loaded.map(({ file, rec }) => {
      const hit = query ? scoreFmeaRecord(rec, query) : { score: 0, terms: [] as string[] };
      return { file, rec, score: hit.score, risk: riskOf(rec), year: recordYear(rec) };
    });
    const list = scored
      .filter((x) => (!query ? true : x.score > 0))
      .filter((x) => (systemFilter === 'all' ? true : (x.rec.system.trim() || '未填写') === systemFilter))
      .filter((x) => (productFilter === 'all' ? true : (x.rec.productCategory.trim() || '未填写') === productFilter))
      .filter((x) =>
        categoryFilter === 'all' ? true : (x.rec.failureCategory.trim() || '未填写') === categoryFilter,
      )
      .filter((x) => (riskFilter === 'all' ? true : x.risk === riskFilter))
      .filter((x) => (yearFilter === 'all' ? true : x.year === Number(yearFilter)));

    return list.sort((a, b) => {
      if (sortBy === 'risk') {
        return (RISK_RANK[a.risk] ?? 3) - (RISK_RANK[b.risk] ?? 3) || b.year - a.year;
      }
      if (sortBy === 'cited') {
        return b.rec.citations.length - a.rec.citations.length || b.year - a.year;
      }
      if (sortBy === 'latest') {
        return b.year - a.year || b.rec.id.localeCompare(a.rec.id);
      }
      if (query) return b.score - a.score || (RISK_RANK[a.risk] ?? 3) - (RISK_RANK[b.risk] ?? 3);
      return b.year - a.year || b.rec.id.localeCompare(a.rec.id);
    });
  }, [loaded, query, systemFilter, productFilter, categoryFilter, riskFilter, yearFilter, sortBy]);

  /** 产品结构树：系统 → 大类 → 小类 → 紧相关的 FMEA 案例（默认只展开系统） */
  const tree = useMemo(() => {
    const systems = new Map<
      string,
      {
        label: string;
        count: number;
        majors: Map<
          string,
          { label: string; count: number; minors: Map<string, { label: string; items: typeof filtered }> }
        >;
      }
    >();
    const systemLabel = (rec: FmeaRecord) => {
      const v = (rec.system || '').trim();
      if (!v) return '未分类系统';
      if (v === '自定义') return '自定义';
      return v;
    };
    for (const item of filtered) {
      const sys = systemLabel(item.rec);
      const major = productMajorOf(item.rec);
      const minor = productMinorOf(item.rec) || '未细分';
      let s = systems.get(sys);
      if (!s) {
        s = { label: sys, count: 0, majors: new Map() };
        systems.set(sys, s);
      }
      s.count++;
      let m = s.majors.get(major);
      if (!m) {
        m = { label: major, count: 0, minors: new Map() };
        s.majors.set(major, m);
      }
      m.count++;
      let mn = m.minors.get(minor);
      if (!mn) {
        mn = { label: minor, items: [] };
        m.minors.set(minor, mn);
      }
      mn.items.push(item);
    }
    const labelRank = (k: string) => {
      if (k === '未分类系统') return 2;
      if (k === '自定义') return 3;
      return 1; // 固定选项排前面
    };
    return Array.from(systems.entries())
      .sort((a, b) => labelRank(a[0]) - labelRank(b[0]) || a[0].localeCompare(b[0], 'zh'))
      .map(([sysKey, s]) => ({
        key: sysKey,
        label: s.label,
        count: s.count,
        majors: Array.from(s.majors.entries())
          .sort((a, b) => classCode(a[0]).localeCompare(classCode(b[0])) || a[0].localeCompare(b[0], 'zh'))
          .map(([mk, m]) => ({
            key: mk,
            label: m.label,
            count: m.count,
            minors: Array.from(m.minors.entries())
              .sort((a, b) => classCode(a[0]).localeCompare(classCode(b[0])) || a[0].localeCompare(b[0], 'zh'))
              .map(([nk, n]) => ({ key: nk, label: n.label, items: n.items })),
          })),
      }));
  }, [filtered]);

  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set());

  const toggleNode = (key: string) =>
    setOpenNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const collapseAll = () => setOpenNodes(new Set());
  const expandAll = () => {
    const next = new Set<string>();
    tree.forEach((sys) => {
      next.add(`system|${sys.key}`);
      sys.majors.forEach((m) => {
        next.add(`major|${sys.key}|${m.key}`);
        m.minors.forEach((mn) => next.add(`minor|${sys.key}|${m.key}|${mn.key}`));
      });
    });
    setOpenNodes(next);
  };

  const selected = selectedPath ? loaded.find((x) => x.file.fullPath === selectedPath) ?? null : null;
  const record = selected?.rec ?? null;

  // 列表刷新后（如升版保存）保持选中
  useEffect(() => {
    if (!selectedPath) return;
    if (!files.some((f) => f.fullPath === selectedPath)) setSelectedPath(null);
  }, [files, selectedPath]);

  /** 有查询词或筛选条件时，自动展开所有命中记录所在的层级（系统→大类→小类），
   *  避免用户手动一层层点开才能看到检索结果；保留已手动展开的节点不关闭 */
  useEffect(() => {
    const hasFilterNow =
      !!query ||
      systemFilter !== 'all' ||
      productFilter !== 'all' ||
      categoryFilter !== 'all' ||
      riskFilter !== 'all' ||
      yearFilter !== 'all';
    if (!hasFilterNow) return;
    const next = new Set(openNodes);
    for (const item of filtered) {
      const rec = item.rec;
      const sys = (rec.system || '').trim() || '未分类系统';
      const major = productMajorOf(rec);
      const minor = productMinorOf(rec) || '未细分';
      next.add(`system|${sys}`);
      next.add(`major|${sys}|${major}`);
      next.add(`minor|${sys}|${major}|${minor}`);
    }
    if (next.size !== openNodes.size) setOpenNodes(next);
  }, [filtered, query, systemFilter, productFilter, categoryFilter, riskFilter, yearFilter, openNodes]);

  // 所选项目默认取第一个，减少一次操作
  useEffect(() => {
    if (!citeProjectId && projects.length) setCiteProjectId(projects[0].id);
  }, [projects, citeProjectId]);

  const patchCache = useCallback((fullPath: string, rec: FmeaRecord) => {
    setCache((prev) => ({ ...prev, [fullPath]: rec }));
  }, []);

  /** 引用到当前项目：写入引用记录，形成「被哪些项目引用」的可追溯链路 */
  const citeToProject = async () => {
    if (!record || !selected) return;
    const project = projects.find((p) => p.id === citeProjectId);
    if (!project) {
      showToast('请先在「项目管理」中创建项目');
      return;
    }
    setSaving(true);
    try {
      const next = addFmeaCitation(record, {
        projectId: project.id,
        projectName: project.name,
        username: user.username,
        displayName: user.displayName,
        at: new Date().toISOString(),
      });
      const res = await api.fmea.write({
        record: next,
        fileName: selected.file.name,
        overwrite: true,
      });
      if (!res.ok) {
        setError(`记录引用失败：${res.message || '未知错误'}`);
        return;
      }
      patchCache(selected.file.fullPath, next);
      showToast(`已引用到「${project.name}」`);
    } finally {
      setSaving(false);
    }
  };

  const copyCard = async () => {
    if (!record) return;
    try {
      await navigator.clipboard.writeText(fmeaCardText(record));
      showToast('卡片内容已复制，可直接粘贴到设计说明或邮件');
    } catch {
      showToast('复制失败，请检查剪贴板权限');
    }
  };

  const downloadCsv = async () => {
    if (!record) return;
    const res = await api.file.save({
      defaultName: fmeaCsvFileName(record),
      content: fmeaRecordToCsv(record),
    });
    if (res.ok) showToast('CSV 已保存');
    else if (!res.canceled) showToast('保存 CSV 失败');
  };

  const removeRecord = async (file: FmeaFile) => {
    if (!window.confirm(`确定删除这条 FMEA 记录吗？\n\n${file.name}\n\n删除后无法恢复。`)) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.db.remove({ fullPath: file.fullPath });
      if (!res.ok) {
        setError(`删除失败：${res.message || '未知错误'}`);
        return;
      }
      if (selectedPath === file.fullPath) {
        setSelectedPath(null);
        setEditDraft(null);
      }
      setCache((prev) => {
        const next = { ...prev };
        delete next[file.fullPath];
        return next;
      });
      showToast('已删除该 FMEA 记录');
      await refresh();
    } catch (e) {
      setError(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    if (!record) return;
    setEditDraft(draftFromRecord(record));
    setEditIssues([]);
  };

  const saveEdit = async () => {
    if (!editDraft || !record || !selected) return;
    const v = validateFmeaDraft(editDraft);
    if (v.errors.length) {
      setEditIssues(v.errors.map((i) => i.message));
      return;
    }
    setSaving(true);
    try {
      const next = buildFmeaRecordSafe(editDraft, record, user);
      const res = await api.fmea.write({
        record: next,
        fileName: selected.file.name,
        overwrite: true,
      });
      if (!res.ok) {
        setError(`保存失败：${res.message || '未知错误'}`);
        return;
      }
      patchCache(selected.file.fullPath, next);
      setEditDraft(null);
      setEditIssues([]);
      showToast(`已保存修改（第 ${next.revision} 版）`);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const resetFilters = () => {
    setKeyword('');
    setSystemFilter('all');
    setProductFilter('all');
    setCategoryFilter('all');
    setRiskFilter('all');
    setYearFilter('all');
  };
  const hasFilter =
    !!query ||
    systemFilter !== 'all' ||
    productFilter !== 'all' ||
    categoryFilter !== 'all' ||
    riskFilter !== 'all' ||
    yearFilter !== 'all';

  return (
    <div className="test-search fmea-page">
      <div className="settings-card">
        <div className="ts-head">
          <h3>FMEA库</h3>
          <div className="ts-status">
            <span>
              服务器状态：
              {reachable === null ? (
                '检测中…'
              ) : reachable ? (
                <b className="ok">可达</b>
              ) : (
                <b className="warn">不可达（浏览器调试模式无法访问 UNC 路径）</b>
              )}
            </span>
            <span className="chip">案例 {loaded.length}</span>
            {cacheBusy && <span className="chip">读取中…</span>}
            <button className="btn-ghost sm" onClick={refresh} disabled={busy}>
              {busy ? '刷新中…' : '刷新'}
            </button>
            {!IS_STANDARD && onOpenImport && (
              <button className="btn-primary sm" onClick={onOpenImport}>
                导入新案例
              </button>
            )}
          </div>
        </div>
        <div className="ts-toolbar">
          <input
            className="search-input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索失效模式 / 部件 / 材料 / 措施，支持同义词：漏油→泄漏、裂纹→开裂"
          />
          <select className="tu-project" value={systemFilter} onChange={(e) => setSystemFilter(e.target.value)}>
            <option value="all">全部系统（{loaded.length}）</option>
            {systems.map(([m, n]) => (
              <option key={m} value={m}>
                {m}（{n}）
              </option>
            ))}
          </select>
          <select className="tu-project" value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
            <option value="all">全部产品</option>
            {products.map(([p, n]) => (
              <option key={p} value={p}>
                {p}（{n}）
              </option>
            ))}
          </select>
          <select className="tu-project" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">全部失效分类</option>
            {categories.map(([c, n]) => (
              <option key={c} value={c}>
                {c}（{n}）
              </option>
            ))}
          </select>
          <select className="tu-project" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="all">全部年份</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y} 年
              </option>
            ))}
          </select>
          <select className="tu-project" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="relevance">按相关度</option>
            <option value="risk">按风险等级</option>
            <option value="latest">按最新</option>
            <option value="cited">按被引用</option>
          </select>
          {hasFilter && (
            <button className="btn-link" onClick={resetFilters}>
              重置筛选
            </button>
          )}
          <span className="lib-count">筛选结果 {filtered.length} 条</span>
        </div>
        <div className="fmea-risk-filter">
          <span className="fmea-risk-label">风险：</span>
          {[
            ['all', `全部（${loaded.length}）`],
            ...riskCounts.map(([r, n]) => [r, `${r}风险（${n}）`] as [string, string]),
          ].map(([value, label]) => (
            <button
              key={value}
              className={riskFilter === value ? 'fmea-risk-chip active' : 'fmea-risk-chip'}
              onClick={() => setRiskFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="fmea-body">
        <div className="fmea-tree-card fmea-tree-left">
          <div className="fmea-tree-head">
            <h3>FMEA 目录</h3>
            <span className="small muted">默认只显示大类，逐级展开</span>
            <span className="lib-count">
              {filtered.length} 条{hasFilter ? '（筛选后）' : ''}
            </span>
            {openNodes.size > 0 ? (
              <button className="btn-link" onClick={collapseAll}>
                全部折叠
              </button>
            ) : tree.length > 0 ? (
              <button className="btn-link" onClick={expandAll}>
                全部展开
              </button>
            ) : null}
          </div>
          {tree.length === 0 && (
            <div className="empty-hint">
              {files.length === 0
                ? IS_STANDARD
                  ? 'FMEA库暂无记录，请联系管理员导入'
                  : 'FMEA库暂无记录。到「FMEA 导入」把技术中心的案例表导入即可'
                : '没有匹配的案例。试试：开裂 / 漏油 / 卡扣 / PP-T20，或清除筛选条件'}
            </div>
          )}
          <div className="fmea-tree fmea-tree-root">
            {tree.map((sys) => {
              const sysKey = `system|${sys.key}`;
              const sysOpen = openNodes.has(sysKey);
              return (
                <div className="fmea-tree-system" key={sys.key}>
                  <button
                    className="fmea-tree-row system"
                    onClick={() => toggleNode(sysKey)}
                    title={sys.label}
                  >
                    <span className="fmea-tree-chev">{sysOpen ? '▾' : '▸'}</span>
                    <span className="fmea-tree-label fmea-tree-sys-label">{sys.label}</span>
                    <span className="fmea-tree-count">{sys.count}</span>
                  </button>
                  {sysOpen &&
                    sys.majors.map((major) => {
                      const majorKey = `major|${sys.key}|${major.key}`;
                      const majorOpen = openNodes.has(majorKey);
                      return (
                        <div className="fmea-tree-major" key={major.key}>
                          <button
                            className="fmea-tree-row major"
                            onClick={() => toggleNode(majorKey)}
                            title={major.label}
                          >
                            <span className="fmea-tree-chev">{majorOpen ? '▾' : '▸'}</span>
                            <span className="fmea-tree-code">{classCode(major.key)}</span>
                            <span className="fmea-tree-label">{major.label.replace(/^[A-J]\s*/, '')}</span>
                            <span className="fmea-tree-count">{major.count}</span>
                          </button>
                          {majorOpen &&
                            major.minors.map((minor) => {
                              const minorKey = `minor|${sys.key}|${major.key}|${minor.key}`;
                              const minorOpen = openNodes.has(minorKey);
                              return (
                                <div className="fmea-tree-minor-wrap" key={minor.key}>
                                  <button
                                    className="fmea-tree-row minor"
                                    onClick={() => toggleNode(minorKey)}
                                    title={minor.label}
                                  >
                                    <span className="fmea-tree-chev">{minorOpen ? '▾' : '▸'}</span>
                                    <span className="fmea-tree-code">{classCode(minor.key)}</span>
                                    <span className="fmea-tree-label">{minor.label.replace(/^[A-J]\d{2}\s*/, '')}</span>
                                    <span className="fmea-tree-count">{minor.items.length}</span>
                                  </button>
                                  {minorOpen && (
                                    <div className="fmea-tree-items">
                                      {minor.items.map(({ file, rec, risk }) => {
                                        const isSelected = selectedPath === file.fullPath;
                                        const isMatched =
                                          !!query ||
                                          systemFilter !== 'all' ||
                                          productFilter !== 'all' ||
                                          categoryFilter !== 'all' ||
                                          riskFilter !== 'all' ||
                                          yearFilter !== 'all';
                                        const cls = ['fmea-tree-item'];
                                        if (isSelected) cls.push('active');
                                        if (isMatched) cls.push('matched');
                                        return (
                                          <button
                                            key={file.fullPath}
                                            className={cls.join(' ')}
                                            onClick={() => {
                                              setSelectedPath(file.fullPath);
                                              setEditDraft(null);
                                              setEditIssues([]);
                                            }}
                                            title={`${rec.failureMode}  —  点击查看详情`}
                                          >
                                            <span className={`fmea-risk ${riskClass(risk)}`}>{risk || '未分级'}</span>
                                            {rec.failureCode && <span className="fmea-code">{classCode(rec.failureCode)}</span>}
                                            <span className="fmea-tree-item-mode">
                                              {highlight(shortText(rec.failureMode, 44), queryTerms)}
                                            </span>
                                            <span className="fmea-tree-item-meta">
                                              {rec.machine || '通用'} · {rec.id} · {recordYear(rec)}年
                                            </span>
                                            {rec.citations.length > 0 && (
                                              <span className="fmea-use small">引用{rec.citations.length}</span>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>

        <div className="fmea-detail fmea-detail-right">
          {!record && !editDraft && (
            <div className="preview-empty">
              <div className="pe-icon">◫</div>
              <div className="pe-title">从左侧目录选择一条 FMEA</div>
              <div className="pe-sub">
                每条案例按「一句话结论 → 失效链 → 设计规避 → 措施与验证」一屏展开，可引用到当前项目留痕。
              </div>
            </div>
          )}

          {record && !editDraft && (
            <>
              <div className="fmea-detail-head">
                <h3>
                  {record.machine || '通用'} · {record.part || '未分类'}
                </h3>
                <div className="preview-meta">
                  <span className="chip">{record.id}</span>
                  <button className="btn-ghost sm" onClick={copyCard}>
                    复制卡片
                  </button>
                  <button className="btn-ghost sm" onClick={downloadCsv}>
                    下载 CSV
                  </button>
                  {!IS_STANDARD && (
                    <button className="btn-ghost sm" onClick={startEdit} disabled={saving}>
                      编辑
                    </button>
                  )}
                  <button
                    className="btn-link danger sm"
                    onClick={() => selected && removeRecord(selected.file)}
                    disabled={busy}
                  >
                    删除
                  </button>
                </div>
              </div>

              <div className="fmea-summary">
                <span className={`fmea-risk ${riskClass(riskOf(record))}`}>
                  {riskOf(record) || '未分级'}风险
                </span>
                {record.system && record.system !== '自定义' && <span className="chip">系统：{record.system}</span>}
                <span className="chip">
                  产品分类：{productMajorOf(record)}
                  {productMinorOf(record) ? ` / ${productMinorOf(record)}` : ''}
                </span>
                {record.failureCode && <span className="fmea-code">{record.failureCode}</span>}
                {record.causeCode && <span className="fmea-code cause">{record.causeCode}</span>}
                {record.failureCategory && <span className="fmea-cat">{record.failureCategory}</span>}
                {record.causeCategory && <span className="fmea-cat">原因：{record.causeCategory}</span>}
                {record.material && <span className="chip">材料：{record.material}</span>}
                {record.owner && <span className="chip">责任人：{record.owner}</span>}
                {record.recordDate && <span className="chip">记录时间：{record.recordDate}</span>}
                {(record.severity || record.occurrence || record.detection) && (
                  <span className="chip">
                    S/O/D：{record.severity || '—'}/{record.occurrence || '—'}/{record.detection || '—'}
                    {fmeaRpn(record) !== null ? ` · RPN ${fmeaRpn(record)}` : ''}
                  </span>
                )}
                <span className="chip">被引用 {record.citations.length} 次</span>
                <span className="fmea-cite">
                  <select
                    className="tu-project"
                    value={citeProjectId}
                    onChange={(e) => setCiteProjectId(e.target.value)}
                    disabled={!projects.length || saving}
                  >
                    {projects.length === 0 && <option value="">暂无项目</option>}
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-primary sm"
                    onClick={citeToProject}
                    disabled={saving || !projects.length}
                  >
                    引用到当前项目
                  </button>
                </span>
              </div>

              {record.conclusion && (
                <div className="fmea-conclusion">
                  <span className="fmea-conclusion-label">一句话结论</span>
                  <p>{record.conclusion}</p>
                </div>
              )}

              <div className="fmea-chain">
                <div className="fmea-chain-cell cause">
                  <div className="fmea-chain-label">① 失效起因 / 机理</div>
                  <ul className="fmea-bullets">
                    {(bullets(record.failureCause).length ? bullets(record.failureCause) : ['未填写']).map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
                <div className="fmea-arrow">→</div>
                <div className="fmea-chain-cell mode">
                  <div className="fmea-chain-label">② 失效模式</div>
                  <div className="fmea-chain-text">{record.failureMode}</div>
                  <FmeaImageCell value={record.failureModeImage} />
                </div>
                <div className="fmea-arrow">→</div>
                <div className="fmea-chain-cell effect">
                  <div className="fmea-chain-label">③ 失效后果</div>
                  <ul className="fmea-bullets">
                    {(bullets(record.failureEffect).length ? bullets(record.failureEffect) : ['未填写']).map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="fmea-block ok">
                <h4>设计规避</h4>
                <ul className="fmea-bullets">
                  {(bullets(deriveDesignGuide(record), 4).length
                    ? bullets(deriveDesignGuide(record), 4)
                    : ['暂无设计规避建议']
                  ).map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>

              <div className="fmea-block">
                <h4>措施与验证</h4>
                <table className="fmea-table">
                  <thead>
                    <tr>
                      <th>建议措施</th>
                      <th>措施类型</th>
                      <th>验证状态</th>
                      <th>责任人</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        {record.action}
                        <FmeaImageCell value={record.actionImage} />
                      </td>
                      <td>{record.measureType || '—'}</td>
                      <td>{record.verificationStatus || '未验证'}</td>
                      <td>{record.owner || '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {record.remark && (
                <div className="fmea-block">
                  <h4>备注</h4>
                  <p>{record.remark}</p>
                </div>
              )}

              {record.citations.length > 0 && (
                <div className="fmea-block">
                  <h4>引用记录</h4>
                  <ul className="fmea-cites">
                    {record.citations
                      .slice()
                      .reverse()
                      .map((c, i) => (
                        <li key={`${c.projectId}-${c.at}-${i}`}>
                          <b>{c.projectName || '未命名项目'}</b>
                          <span>
                            {c.displayName || c.username || '—'} · {c.at ? c.at.replace('T', ' ').slice(0, 16) : '—'}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {(() => {
                const sims = similarFmeaRecords(record, loaded.map((x) => x.rec), 4);
                if (sims.length === 0) return null;
                return (
                  <div className="fmea-block">
                    <h4>相似案例</h4>
                    <div className="fmea-similar">
                      {sims.map((s) => {
                        const target = loaded.find((x) => x.rec.id === s.id);
                        return (
                          <button
                            key={s.id}
                            className="fmea-sim-item"
                            onClick={() => {
                              if (!target) return;
                              setSelectedPath(target.file.fullPath);
                              setEditDraft(null);
                              setEditIssues([]);
                            }}
                          >
                            <span className={`fmea-risk ${riskClass(riskOf(s))}`}>{riskOf(s) || '未分级'}</span>
                            <span className="fmea-sim-mode">{shortText(s.failureMode, 34)}</span>
                            <span className="fmea-sim-meta">
                              {s.machine || '通用'} · {s.part || '未分类'}
                            </span>
                            <span className="fmea-sim-id">{s.id}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              <div className="fmea-detail-foot">
                <span>来源：{record.sourceSheet || '手工录入'}</span>
                <span>录入：{record.createdByDisplay || record.createdBy || '—'}</span>
                <span>版本：第 {record.revision} 版</span>
                <span>更新：{record.updatedAt ? record.updatedAt.replace('T', ' ').slice(0, 19) : '—'}</span>
                {record.useCount > 0 && <span>历史取用 {record.useCount} 次</span>}
              </div>
            </>
          )}

          {record && editDraft && (
            <div className="fmea-edit">
              <div className="fmea-edit-head">
                <h3>修改 {record.id}</h3>
                <span className="small muted">保存后覆盖原卡片并升版，编号不变</span>
              </div>
              <div className="fmea-form-grid">
                {FMEA_FIELDS.map((f) => {
                  const val = editDraft![f.key];
                  const opts = f.options;
                  const isCustom = f.allowCustom && opts && !opts.includes(val) && val !== '';
                  return (
                    <label className={f.multiline ? 'field full' : 'field'} key={f.key}>
                      <span className="mat-field-label">
                        <span className="mat-field-name">{f.label}</span>
                        <span className="mat-field-unit">{f.hint || '\u00A0'}</span>
                      </span>
                      {opts ? (
                        <>
                          <select
                            value={isCustom ? opts[opts.length - 1] : val}
                            onChange={(e) => {
                              const sel = e.target.value;
                              setEditDraft((prev) => {
                                if (!prev) return prev;
                                if (f.allowCustom && sel === '自定义') {
                                  return { ...prev, [f.key]: val && !opts.includes(val) ? val : '' };
                                }
                                return { ...prev, [f.key]: sel };
                              });
                            }}
                          >
                            <option value="">未填写</option>
                            {opts.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                          {f.allowCustom && (isCustom || val === '') && (
                            <input
                              className="mat-custom-input"
                              placeholder="自定义系统名称，如 燃油系统 / 进气歧管系统"
                              value={isCustom ? val : ''}
                              onChange={(e) =>
                                setEditDraft((prev) => (prev ? { ...prev, [f.key]: e.target.value } : prev))
                              }
                            />
                          )}
                        </>
                      ) : f.multiline ? (
                        <textarea
                          rows={3}
                          value={val}
                          onChange={(e) =>
                            setEditDraft((prev) => (prev ? { ...prev, [f.key]: e.target.value } : prev))
                          }
                        />
                      ) : (
                        <input
                          value={val}
                          onChange={(e) =>
                            setEditDraft((prev) => (prev ? { ...prev, [f.key]: e.target.value } : prev))
                          }
                        />
                      )}
                    </label>
                  );
                })}
                {FMEA_IMAGE_FIELDS.map((f) => (
                  <div className="field image" key={f.key}>
                    <FmeaImageInput
                      label={f.label}
                      value={editDraft![f.key]}
                      onChange={(v) =>
                        setEditDraft((prev) => (prev ? { ...prev, [f.key]: v } : prev))
                      }
                      placeholder="导入或 Ctrl+V 粘贴"
                    />
                  </div>
                ))}
              </div>
              {editIssues.length > 0 && (
                <div className="mat-edit-issues">
                  {editIssues.map((m) => (
                    <div key={m}>· {m}</div>
                  ))}
                </div>
              )}
              <div className="mat-edit-actions">
                <button className="btn-primary sm" onClick={saveEdit} disabled={saving}>
                  {saving ? '保存中…' : '保存修改'}
                </button>
                <button
                  className="btn-ghost sm"
                  onClick={() => {
                    setEditDraft(null);
                    setEditIssues([]);
                  }}
                  disabled={saving}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

/** 升版保存（保留引用记录与创建信息），单独抽出便于失败时提示 */
function buildFmeaRecordSafe(draft: FmeaDraft, previous: FmeaRecord, user: CtrUser): FmeaRecord {
  return {
    ...previous,
    ...draft,
    updatedAt: new Date().toISOString(),
    updatedBy: user.username,
    revision: previous.revision + 1,
  };
}
