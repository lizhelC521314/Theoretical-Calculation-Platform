import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CtrUser } from '../api';
import { IS_STANDARD } from '../edition';
import { FmeaImageCell, FmeaImageInput } from '../components/FmeaImageInput';
import { computeAp } from '../report/fmeaRatings';
import {
  addFmeaCitation,
  allowedNextStatuses,
  AP_META,
  apDelta,
  applyMasterVocabulary,
  buildWorksheet,
  classCode,
  deriveDesignGuide,
  deriveRiskLevel,
  draftFromRecord,
  expandFmeaTerms,
  FMEA_STATUS_META,
  fmeaCardText,
  fmeaCsvFileName,
  fmeaRecordToCsv,
  fmeaRpn,
  FMEA_FIELDS,
  FMEA_IMAGE_FIELDS,
  hasAfterRatings,
  hasBeforeRatings,
  parseFmeaRecord,
  productMajorOf,
  productMinorOf,
  scoreFmeaRecord,
  similarFmeaRecords,
  statusMeta,
  tryTransitStatus,
  validateFmeaDraft,
  worksheetToCsv,
  yearFromDate,
  type ApLevel,
  type FmeaDraft,
  type FmeaRecord,
  type FmeaStatus,
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
 * 触发 CSV 下载（自动加 BOM，Excel 打开中文不乱码）
 */
function downloadCsvBlob(text: string, fileName: string) {
  const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  const [apFilter, setApFilter] = useState<'all' | ApLevel | '未评分'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | FmeaStatus>('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [view, setView] = useState<'tree' | 'worksheet'>('tree');
  const [openSys, setOpenSys] = useState<Record<string, boolean>>({}); // 工作表系统展开状态
  const [openFam, setOpenFam] = useState<Record<string, boolean>>({}); // 工作表 family 展开状态
  const [wsSelected, setWsSelected] = useState<string[]>([]); // 工作表多选（记录 id）
  const [wsBusy, setWsBusy] = useState(false); // 批量状态推进执行中
  /** 词表归并预览（确认弹窗）：列出将变更的主词 */
  const [mergePreview, setMergePreview] = useState<{
    label: string;
    recs: FmeaRecord[];
    items: Array<{
      id: string;
      part: string;
      selected: boolean;
      mode?: { from: string; to: string };
      cause?: { from: string; to: string };
      effect?: { from: string; to: string };
    }>;
    unmatched: number;
  } | null>(null);
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
  const apCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const { rec } of loaded) {
      const k = rec.apLevel || '未评分';
      map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const rank = (k: string) => (k === 'H' ? 0 : k === 'M' ? 1 : k === 'L' ? 2 : 3);
      return rank(a[0]) - rank(b[0]) || b[1] - a[1];
    });
  }, [loaded]);

  /** 状态分布：固定按 草稿→评审中→已发布→已归档 顺序展示 */
  const statusCounts = useMemo(() => {
    const map = new Map<FmeaStatus, number>();
    for (const { rec } of loaded) {
      const k = (rec.status || 'draft') as FmeaStatus;
      map.set(k, (map.get(k) || 0) + 1);
    }
    return (['draft', 'review', 'published', 'archived'] as FmeaStatus[])
      .map((s) => [s, map.get(s) || 0] as [FmeaStatus, number])
      .filter(([, n]) => n > 0);
  }, [loaded]);

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
      .filter((x) =>
        apFilter === 'all' ? true : apFilter === '未评分' ? !x.rec.apLevel : x.rec.apLevel === apFilter,
      )
      .filter((x) => (statusFilter === 'all' ? true : (x.rec.status || 'draft') === statusFilter))
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
  }, [loaded, query, systemFilter, productFilter, categoryFilter, riskFilter, apFilter, statusFilter, yearFilter, sortBy]);

  // 项目 FMEA 工作表：从 filtered 记录聚合（系统→产品族→部件 + AP 汇总）
  const worksheet = useMemo(
    () => buildWorksheet(filtered.map((x) => x.rec)),
    [filtered],
  );

  const wsSelectedSet = useMemo(() => new Set(wsSelected), [wsSelected]);

  /** 当前勾选条目中，各目标状态可推进的数量（用于按钮可用性与计数） */
  const wsBatchTargets = useMemo(() => {
    const counts: Record<FmeaStatus, number> = { draft: 0, review: 0, published: 0, archived: 0 };
    for (const id of wsSelected) {
      const entry = loaded.find((x) => x.rec.id === id);
      if (!entry) continue;
      for (const t of allowedNextStatuses((entry.rec.status || 'draft') as FmeaStatus)) counts[t]++;
    }
    return counts;
  }, [wsSelected, loaded]);

  // 展开全部系统（首次进入工作表时）
  useEffect(() => {
    if (view !== 'worksheet') return;
    const init: Record<string, boolean> = {};
    for (const sg of worksheet.systems) {
      init[sg.systemKey] = true;
      for (const fg of sg.families) init[`${sg.systemKey}>>${fg.majorKey}`] = true;
    }
    setOpenSys(init);
    setOpenFam(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

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
      apFilter !== 'all' ||
      statusFilter !== 'all' ||
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
  }, [filtered, query, systemFilter, productFilter, categoryFilter, riskFilter, apFilter, statusFilter, yearFilter, openNodes]);

  // 所选项目默认取第一个，减少一次操作
  useEffect(() => {
    if (!citeProjectId && projects.length) setCiteProjectId(projects[0].id);
  }, [projects, citeProjectId]);

  const patchCache = useCallback((fullPath: string, rec: FmeaRecord) => {
    setCache((prev) => ({ ...prev, [fullPath]: rec }));
  }, []);

  /** 工作表多选：切换单条 */
  const toggleWsSelected = (id: string) =>
    setWsSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** 批量切换某一组（按部件表格） */
  const toggleWsGroup = (ids: string[]) => {
    setWsSelected((prev) => {
      const allIn = ids.length > 0 && ids.every((id) => prev.includes(id));
      return allIn ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]));
    });
  };

  /** 批量导出所选条目为 CSV（保持工作表分组顺序，含中文+英文双表头） */
  const exportSelectedCsv = () => {
    const ids = new Set(wsSelected);
    const rows = filtered.filter((x) => ids.has(x.rec.id)).map((x) => x.rec);
    if (!rows.length) {
      showToast('请先勾选条目');
      return;
    }
    downloadCsvBlob(
      worksheetToCsv(buildWorksheet(rows)),
      `FMEA-所选${rows.length}条-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    showToast(`已导出所选 ${rows.length} 条`);
  };

  /**
   * 打开词表归并预览：先算出会变更的主词，用户确认后才写盘。
   */
  const openMergePreview = (label: string, recs: FmeaRecord[]) => {
    if (wsBusy || recs.length === 0) return;
    let unmatched = 0;
    const items: NonNullable<typeof mergePreview>['items'] = [];
    for (const rec of recs) {
      const { record, changedFields } = applyMasterVocabulary(rec);
      if (!changedFields.length) {
        if (!record.failureModeMaster) unmatched++;
        continue;
      }
      items.push({
        id: rec.id,
        part: rec.part || rec.productSubCategory || rec.system || '未分类',
        selected: true,
        mode: changedFields.includes('failureModeMaster')
          ? { from: rec.failureModeMaster || rec.failureMode, to: record.failureModeMaster }
          : undefined,
        cause: changedFields.includes('failureCauseMaster')
          ? { from: rec.failureCauseMaster || rec.failureCause, to: record.failureCauseMaster }
          : undefined,
        effect: changedFields.includes('failureEffectMaster')
          ? { from: rec.failureEffectMaster || rec.failureEffect, to: record.failureEffectMaster }
          : undefined,
      });
    }
    setMergePreview({ label, recs, items, unmatched });
  };

  /** 勾选 / 取消勾选预览中的某条变更 */
  const toggleMergeItem = (id: string) => {
    setMergePreview((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((it) => (it.id === id ? { ...it, selected: !it.selected } : it)),
          }
        : prev,
    );
  };

  /** 全选 / 全不选 */
  const setAllMergeSelected = (selected: boolean) => {
    setMergePreview((prev) =>
      prev ? { ...prev, items: prev.items.map((it) => ({ ...it, selected })) } : prev,
    );
  };

  /**
   * 只应用勾选的归并项：逐条合并所选字段的变更，未勾选的字段保持原值。
   */
  const confirmMergeSelection = async () => {
    const p = mergePreview;
    if (!p) return;
    const picked = p.items.filter((it) => it.selected);
    setMergePreview(null);
    if (!picked.length) return;

    const targets: Array<{ rec: FmeaRecord; next: FmeaRecord }> = [];
    for (const it of picked) {
      const rec = p.recs.find((r) => r.id === it.id);
      if (!rec) continue;
      const next: FmeaRecord = { ...rec };
      if (it.mode) next.failureModeMaster = it.mode.to as typeof rec.failureModeMaster;
      if (it.cause) next.failureCauseMaster = it.cause.to as typeof rec.failureCauseMaster;
      if (it.effect) next.failureEffectMaster = it.effect.to as typeof rec.failureEffectMaster;
      targets.push({ rec, next });
    }

    setWsBusy(true);
    let changed = 0;
    let failed = 0;
    try {
      for (const { next } of targets) {
        const entry = loaded.find((x) => x.rec.id === next.id);
        if (!entry) continue;
        const toWrite: FmeaRecord = {
          ...next,
          updatedAt: new Date().toISOString(),
          updatedBy: user.username,
        };
        const wr = await api.fmea.write({
          record: toWrite,
          fileName: entry.file.name,
          overwrite: true,
        });
        if (!wr.ok) {
          failed++;
          continue;
        }
        patchCache(entry.file.fullPath, toWrite);
        changed++;
      }
    } catch (e) {
      showToast(`词表归并中断：${e instanceof Error ? e.message : String(e)}`);
    }
    setWsBusy(false);
    if (changed) await refresh();
    if (changed) {
      showToast(`词表归并完成：应用 ${changed} 条` + (failed ? `，${failed} 条保存失败` : ''));
    } else if (failed) {
      showToast(`词表归并失败 ${failed} 条`);
    } else {
      showToast('未应用任何归并');
    }
  };

  /**
   * 批量状态推进：逐条校验转换规则，只推进当前状态允许的条目，
   * 不允许的计入跳过数，最后统一提示并刷新。
   */
  const batchTransit = async (target: FmeaStatus) => {
    if (!wsSelected.length || wsBusy) return;
    setWsBusy(true);
    const actor = user.displayName || user.username;
    let okCount = 0;
    let skipCount = 0;
    let wrote = false;
    try {
      for (const id of wsSelected) {
        const entry = loaded.find((x) => x.rec.id === id);
        if (!entry) {
          skipCount++;
          continue;
        }
        const current = (entry.rec.status || 'draft') as FmeaStatus;
        const res = tryTransitStatus(current, target, actor, '批量操作');
        if (!res.ok) {
          skipCount++;
          continue;
        }
        const updated: FmeaRecord = {
          ...entry.rec,
          status: res.newStatus,
          statusHistory: [...(entry.rec.statusHistory || []), res.entry],
          updatedAt: new Date().toISOString(),
          updatedBy: user.username,
        };
        const wr = await api.fmea.write({
          record: updated,
          fileName: entry.file.name,
          overwrite: true,
        });
        if (!wr.ok) {
          skipCount++;
          continue;
        }
        patchCache(entry.file.fullPath, updated);
        wrote = true;
        okCount++;
      }
    } catch (e) {
      showToast(`批量操作中断：${e instanceof Error ? e.message : String(e)}`);
    }
    setWsBusy(false);
    setWsSelected([]);
    if (okCount) {
      showToast(
        `已批量转为「${FMEA_STATUS_META[target].label}」${okCount} 条` +
          (skipCount ? `，跳过 ${skipCount} 条（当前状态不允许）` : ''),
      );
    } else {
      showToast(skipCount ? '所选条目当前状态均不允许该操作' : '请先勾选条目');
    }
    if (wrote) await refresh();
  };

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
    setApFilter('all');
    setStatusFilter('all');
    setYearFilter('all');
  };
  const hasFilter =
    !!query ||
    systemFilter !== 'all' ||
    productFilter !== 'all' ||
    categoryFilter !== 'all' ||
    riskFilter !== 'all' ||
    apFilter !== 'all' ||
    statusFilter !== 'all' ||
    yearFilter !== 'all';

  return (
    <div className={`test-search fmea-page view-${view}`}>
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
          {/* 树视图 / 工作表视图切换 */}
          <div className="fmea-view-switch">
            <button
              type="button"
              className={view === 'tree' ? 'active' : ''}
              onClick={() => setView('tree')}
              title="左侧树 + 右侧详情"
            >
              树
            </button>
            <button
              type="button"
              className={view === 'worksheet' ? 'active' : ''}
              onClick={() => setView('worksheet')}
              title="项目 FMEA 工作表"
            >
              工作表
            </button>
          </div>
          {view === 'worksheet' && (
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                downloadCsvBlob(
                  worksheetToCsv(worksheet),
                  `FMEA-工作表-${new Date().toISOString().slice(0, 10)}.csv`,
                );
                showToast(`已导出 ${filtered.length} 条（含中文+英文双表头）`);
              }}
            >
              导出全部（{filtered.length}）
            </button>
          )}
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
        <div className="fmea-ap-filter">
          <span className="fmea-ap-label">AP 优先级：</span>
          {[
            { key: 'all', label: `全部（${loaded.length}）`, hint: '' },
            ...apCounts.map(([k, n]) => ({
              key: k,
              label: `${k === '未评分' ? '未评分' : k}（${n}）`,
              hint: k === '未评分' ? '缺失 S/O/D 评分，无法自动算 AP' : AP_META[k as ApLevel]?.hint || '',
            })),
          ].map((opt) => (
            <button
              key={opt.key}
              className={apFilter === opt.key ? 'fmea-ap-chip active' : 'fmea-ap-chip'}
              onClick={() => setApFilter(opt.key as ApLevel | '未评分' | 'all')}
              title={opt.hint || undefined}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="fmea-status-filter">
          <span className="fmea-status-filter-label">状态：</span>
          <button
            className={`fmea-status-chip fmea-status-all ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
            title="不限状态"
          >
            全部（{loaded.length}）
          </button>
          {statusCounts.map(([s, n]) => (
            <button
              key={s}
              className={`fmea-status-chip fmea-status-${s} ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(s)}
              title={FMEA_STATUS_META[s].hint}
            >
              {FMEA_STATUS_META[s].label}（{n}）
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
                          <div
                            className="fmea-tree-row major"
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleNode(majorKey)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleNode(majorKey);
                              }
                            }}
                            title={major.label}
                          >
                            <span className="fmea-tree-chev">{majorOpen ? '▾' : '▸'}</span>
                            <span className="fmea-tree-code">{classCode(major.key)}</span>
                            <span className="fmea-tree-label">{major.label.replace(/^[A-J]\s*/, '')}</span>
                            <button
                              type="button"
                              className="fmea-tree-act"
                              disabled={wsBusy}
                              title="预览并归并本产品族条目的标准主词"
                              onClick={(e) => {
                                e.stopPropagation();
                                openMergePreview(
                                  major.label,
                                  major.minors.flatMap((m) => m.items.map((i) => i.rec)),
                                );
                              }}
                            >
                              归并
                            </button>
                            <span className="fmea-tree-count">{major.count}</span>
                          </div>
                          {majorOpen &&
                            major.minors.map((minor) => {
                              const minorKey = `minor|${sys.key}|${major.key}|${minor.key}`;
                              const minorOpen = openNodes.has(minorKey);
                              return (
                                <div className="fmea-tree-minor-wrap" key={minor.key}>
                                  <div
                                    className="fmea-tree-row minor"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => toggleNode(minorKey)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        toggleNode(minorKey);
                                      }
                                    }}
                                    title={minor.label}
                                  >
                                    <span className="fmea-tree-chev">{minorOpen ? '▾' : '▸'}</span>
                                    <span className="fmea-tree-code">{classCode(minor.key)}</span>
                                    <span className="fmea-tree-label">{minor.label.replace(/^[A-J]\d{2}\s*/, '')}</span>
                                    <button
                                      type="button"
                                      className="fmea-tree-act"
                                      disabled={wsBusy}
                                      title="预览并归并本部件小类条目的标准主词"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openMergePreview(
                                          minor.label,
                                          minor.items.map((i) => i.rec),
                                        );
                                      }}
                                    >
                                      归并
                                    </button>
                                    <span className="fmea-tree-count">{minor.items.length}</span>
                                  </div>
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
                                          apFilter !== 'all' ||
                                          statusFilter !== 'all' ||
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
                                            {rec.apLevel && (
                                              <span className={`fmea-ap ${rec.apLevel}`} title={AP_META[rec.apLevel as ApLevel]?.hint}>
                                                AP {rec.apLevel}
                                              </span>
                                            )}
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
          {/* 工作表视图：占满右栏，从 filtered 数据聚合 */}
          {view === 'worksheet' ? (
            <>
              <div className="fmea-worksheet-summary">
                <div className="ws-sum-card">
                  <div className="ws-sum-num">{worksheet.summary.totalRecords}</div>
                  <div className="ws-sum-lbl">条目数</div>
                </div>
                <div className="ws-sum-card">
                  <div className="ws-sum-num green">{worksheet.summary.published}</div>
                  <div className="ws-sum-lbl">已发布</div>
                </div>
                <div className="ws-sum-card">
                  <div className="ws-sum-num blue">{worksheet.summary.review}</div>
                  <div className="ws-sum-lbl">评审中</div>
                </div>
                <div className="ws-sum-card">
                  <div className="ws-sum-num orange">{worksheet.summary.draft}</div>
                  <div className="ws-sum-lbl">草稿</div>
                </div>
                <div className="ws-sum-card">
                  <div className="ws-sum-num red">{worksheet.summary.h}</div>
                  <div className="ws-sum-lbl">AP H</div>
                </div>
                <div className="ws-sum-card">
                  <div className="ws-sum-num amber">{worksheet.summary.m}</div>
                  <div className="ws-sum-lbl">AP M</div>
                </div>
                <div className="ws-sum-card">
                  <div className="ws-sum-num green">{worksheet.summary.l}</div>
                  <div className="ws-sum-lbl">AP L</div>
                </div>
              </div>

              {/* 批量状态推进工具条 */}
              <div className="ws-batchbar">
                <label className="ws-check-all">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((x) => wsSelectedSet.has(x.rec.id))}
                    onChange={(e) => {
                      const ids = filtered.map((x) => x.rec.id);
                      if (e.target.checked) {
                        toggleWsGroup(ids);
                      } else {
                        setWsSelected((prev) => prev.filter((id) => !ids.includes(id)));
                      }
                    }}
                    disabled={filtered.length === 0 || wsBusy}
                  />
                  全选当前结果
                </label>
                <span className="ws-batch-count">
                  已选 <b>{wsSelected.length}</b> 条
                </span>
                {([
                  ['review', '提交评审'],
                  ['published', '发布'],
                  ['draft', '打回草稿'],
                  ['archived', '归档作废'],
                ] as Array<[FmeaStatus, string]>).map(([target, label]) => {
                  const n = wsBatchTargets[target];
                  return (
                    <button
                      key={target}
                      type="button"
                      className={`btn-ghost sm fmea-transit-btn to-${target}`}
                      disabled={wsBusy || n === 0}
                      title={n === 0 ? '所选条目当前状态不允许该操作' : `将 ${n} 条转为「${FMEA_STATUS_META[target].label}」`}
                      onClick={() => batchTransit(target)}
                    >
                      {label}（{n}）
                    </button>
                  );
                })}
                {wsSelected.length > 0 && (
                  <button
                    type="button"
                    className="btn-ghost sm"
                    onClick={exportSelectedCsv}
                    disabled={wsBusy}
                    title="导出当前勾选的条目（工作表分组格式）"
                  >
                    导出所选（{wsSelected.length}）
                  </button>
                )}
                {wsSelected.length > 0 && (
                  <button
                    type="button"
                    className="btn-link sm"
                    onClick={() => setWsSelected([])}
                    disabled={wsBusy}
                  >
                    清空选择
                  </button>
                )}
                {wsBusy && <span className="ws-busy">处理中…</span>}
              </div>

              {worksheet.systems.length === 0 && (
                <div className="preview-empty">
                  <div className="pe-icon">⊟</div>
                  <div className="pe-title">当前筛选下没有 FMEA 条目</div>
                  <div className="pe-sub">试试清除筛选，或先到「FMEA导入」页批量入库。</div>
                </div>
              )}

              {worksheet.systems.map((sg) => {
                const sysOpen = openSys[sg.systemKey] !== false;
                return (
                  <div key={sg.systemKey} className="fmea-worksheet-system">
                    <button
                      type="button"
                      className="ws-sys-head"
                      onClick={() => setOpenSys((prev) => ({ ...prev, [sg.systemKey]: !sysOpen }))}
                    >
                      <span className="ws-chev">{sysOpen ? '▾' : '▸'}</span>
                      <span className="ws-sys-name">{sg.systemLabel}</span>
                      <span className="ws-sys-count">{sg.totalRows} 条</span>
                      <span className="ws-ap-bar">
                        <span className="h" style={{ width: `${(sg.h / Math.max(sg.totalRows, 1)) * 100}%` }} />
                        <span className="m" style={{ width: `${(sg.m / Math.max(sg.totalRows, 1)) * 100}%` }} />
                        <span className="l" style={{ width: `${(sg.l / Math.max(sg.totalRows, 1)) * 100}%` }} />
                        <span className="u" style={{ width: `${(sg.unknown / Math.max(sg.totalRows, 1)) * 100}%` }} />
                      </span>
                      <span className="ws-ap-label">
                        H {sg.h} · M {sg.m} · L {sg.l}
                        {sg.unknown > 0 && <span className="u"> · 未知 {sg.unknown}</span>}
                      </span>
                    </button>
                    {sysOpen &&
                      sg.families.map((fg) => {
                        const famKey = `${sg.systemKey}>>${fg.majorKey}`;
                        const famOpen = openFam[famKey] !== false;
                        return (
                          <div key={fg.majorKey} className="ws-fam">
                            <div className="ws-fam-head">
                              <button
                                type="button"
                                className="ws-fam-toggle"
                                onClick={() => setOpenFam((prev) => ({ ...prev, [famKey]: !famOpen }))}
                              >
                                <span className="ws-chev">{famOpen ? '▾' : '▸'}</span>
                                <span className="ws-fam-code">{fg.majorKey.split(' ')[0]}</span>
                                <span className="ws-fam-name">{fg.majorLabel}</span>
                                <span className="ws-fam-count">{fg.totalRows}</span>
                                <span className="ws-ap-mini">
                                  <span className="h">{fg.h}</span>
                                  <span className="m">{fg.m}</span>
                                  <span className="l">{fg.l}</span>
                                </span>
                              </button>
                              <button
                                type="button"
                                className="btn-ghost sm ws-fam-act"
                                disabled={wsBusy}
                                title="预览并归并本产品族下所有条目的失效模式/原因/后果主词（不改原文）"
                                onClick={() =>
                                  openMergePreview(
                                    fg.majorLabel,
                                    fg.parts.flatMap((p) => p.rows.map((r) => r.rec)),
                                  )
                                }
                              >
                                词表归并
                              </button>
                            </div>
                            {famOpen && (
                              <div className="ws-parts">
                                {fg.parts.map((pg) => (
                                  <div key={pg.partKey} className="ws-part">
                                    <div className="ws-part-head">
                                      <span className="ws-part-name">{pg.part}</span>
                                      <span className="ws-part-count">{pg.rows.length} 条</span>
                                      <span className="ws-ap-mini">
                                        <span className="h">{pg.h}</span>
                                        <span className="m">{pg.m}</span>
                                        <span className="l">{pg.l}</span>
                                        {pg.unknown > 0 && <span className="u">{pg.unknown}</span>}
                                      </span>
                                      <button
                                        type="button"
                                        className="btn-link sm ws-part-act"
                                        disabled={wsBusy}
                                        title={`预览并归并「${pg.part}」下所有条目的主词（不改原文）`}
                                        onClick={() =>
                                          openMergePreview(
                                            pg.part,
                                            pg.rows.map((r) => r.rec),
                                          )
                                        }
                                      >
                                        归并
                                      </button>
                                    </div>
                                    <table className="ws-table">
                                      <thead>
                                        <tr>
                                          <th style={{ width: 30 }}>
                                            <input
                                              type="checkbox"
                                              checked={
                                                pg.rows.length > 0 &&
                                                pg.rows.every(({ rec }) => wsSelectedSet.has(rec.id))
                                              }
                                              onChange={() => toggleWsGroup(pg.rows.map(({ rec }) => rec.id))}
                                              disabled={wsBusy}
                                              title="全选本部件"
                                            />
                                          </th>
                                          <th style={{ width: 70 }}>编号</th>
                                          <th style={{ width: 50 }}>状态</th>
                                          <th style={{ width: 46 }}>AP</th>
                                          <th style={{ width: 26 }}>S</th>
                                          <th style={{ width: 26 }}>O</th>
                                          <th style={{ width: 26 }}>D</th>
                                          <th>失效模式</th>
                                          <th>失效原因</th>
                                          <th style={{ width: 50 }}>风险</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {pg.rows.map(({ rec }) => (
                                          <tr
                                            key={rec.id}
                                            className={`ws-row${wsSelectedSet.has(rec.id) ? ' ws-row-selected' : ''}`}
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => {
                                              const entry = loaded.find((x) => x.rec.id === rec.id);
                                              if (entry) {
                                                setView('tree');
                                                setSelectedPath(entry.file.fullPath);
                                              }
                                            }}
                                          >
                                            <td onClick={(e) => e.stopPropagation()}>
                                              <input
                                                type="checkbox"
                                                checked={wsSelectedSet.has(rec.id)}
                                                onChange={() => toggleWsSelected(rec.id)}
                                                disabled={wsBusy}
                                              />
                                            </td>
                                            <td className="ws-id">{rec.id}</td>
                                            <td>
                                              <span className={`fmea-status-chip sm fmea-status-${rec.status}`}>
                                                {FMEA_STATUS_META[rec.status as FmeaStatus]?.label || rec.status}
                                              </span>
                                            </td>
                                            <td>
                                              {rec.apLevel ? (
                                                <span className={`fmea-ap ${rec.apLevel}`}>AP {rec.apLevel}</span>
                                              ) : (
                                                <span className="ws-u">—</span>
                                              )}
                                            </td>
                                            <td>{rec.severity || '—'}</td>
                                            <td>{rec.occurrence || '—'}</td>
                                            <td>{rec.detection || '—'}</td>
                                            <td>{rec.failureMode}</td>
                                            <td>{rec.failureCause}</td>
                                            <td>
                                              <span className={`fmea-risk ${rec.riskLevel || '未分级'}`}>
                                                {rec.riskLevel || '未分级'}
                                              </span>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </>
          ) : (
            <>
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

              {/* 结构树定位条：一眼看清本案例在产品族五层结构中的位置 */}
              <div className="fmea-breadcrumb">
                <span className="fmea-bc-label">位置：</span>
                <span className="fmea-bc-crumb">{record.system && record.system !== '自定义' ? record.system : '进气系统'}</span>
                <span className="fmea-bc-sep">›</span>
                <span className="fmea-bc-crumb">
                  {productMajorOf(record) || '未分类'}
                </span>
                {productMinorOf(record) && (
                  <>
                    <span className="fmea-bc-sep">›</span>
                    <span className="fmea-bc-crumb">{productMinorOf(record)}</span>
                  </>
                )}
                <span className="fmea-bc-sep">›</span>
                <span className="fmea-bc-curr">{record.part || '未分类部件'}</span>
              </div>

              <div className="fmea-summary">
                {/* 状态 tag（四级着色） */}
                <span
                  className={`fmea-status-chip fmea-status-${record.status}`}
                  title={FMEA_STATUS_META[record.status as FmeaStatus]?.hint || ''}
                >
                  {statusMeta(record.status as FmeaStatus)?.label || record.status}
                </span>
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
                {record.apLevel && (
                  <span className={`fmea-ap ${record.apLevel}`} title={AP_META[record.apLevel as ApLevel]?.hint}>
                    AP {record.apLevel} · {AP_META[record.apLevel as ApLevel]?.fullLabel}
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

              {/* 措施前后对比区：同时有 before 与 after S/O/D 时才展示 */}
              {(() => {
                const hasBefore = hasBeforeRatings(record);
                const hasAfter = hasAfterRatings(record);
                if (!hasBefore || !hasAfter) {
                  // 措施实际做了但没留痕评分时，只显示实际措施 vs 建议措施
                  if (!record.measureActual) return null;
                  return (
                    <div className="fmea-block">
                      <h4>措施落地对比</h4>
                      <table className="fmea-table">
                        <thead>
                          <tr>
                            <th>建议措施</th>
                            <th>实际采取的措施</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>{record.action || '—'}</td>
                            <td>{record.measureActual}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                }
                // 完整对比
                const bS = Number(record.severityBefore);
                const bO = Number(record.occurrenceBefore);
                const bD = Number(record.detectionBefore);
                const bRpn = bS * bO * bD;
                const bAp: ApLevel = computeAp(bS, bO, bD);
                const bRisk: RiskLevel = bAp === 'H' ? '高' : bAp === 'M' ? '中' : '低';
                const aS = Number(record.severity);
                const aO = Number(record.occurrence);
                const aD = Number(record.detection);
                const aRpn = aS * aO * aD;
                const aAp = (record.apLevel || computeAp(aS, aO, aD)) as ApLevel;
                const aRisk: RiskLevel = aAp === 'H' ? '高' : aAp === 'M' ? '中' : '低';
                const delta = apDelta(bAp, aAp);
                const rpnDelta = bRpn - aRpn; // 正数表示改善
                const fmtDelta = (before: number, after: number) => {
                  if (after === before) return null;
                  return {
                    label: after < before ? '↓' : after > before ? '↑' : '→',
                    cls: after < before ? 'improve' : after > before ? 'regress' : '',
                  };
                };
                return (
                  <div className="fmea-block fmea-compare-block">
                    <h4>
                      措施前后对比
                      {delta !== 'unknown' && delta !== 'same' && (
                        <span className={`fmea-compare-badge ${delta}`}>
                          {delta === 'improve' ? '✓ 风险降低' : '⚠ 风险恶化'}
                        </span>
                      )}
                    </h4>
                    <table className="fmea-table fmea-compare-table">
                      <thead>
                        <tr>
                          <th></th>
                          <th className="col-before">措施前</th>
                          <th>↓</th>
                          <th className="col-after">措施后</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="row-label">S 严重度</td>
                          <td className="col-before">{bS}</td>
                          <td className={`delta ${fmtDelta(bS, aS)?.cls}`}>{fmtDelta(bS, aS)?.label || '—'}</td>
                          <td className="col-after">{aS}</td>
                        </tr>
                        <tr>
                          <td className="row-label">O 频度</td>
                          <td className="col-before">{bO}</td>
                          <td className={`delta ${fmtDelta(bO, aO)?.cls}`}>{fmtDelta(bO, aO)?.label || '—'}</td>
                          <td className="col-after">{aO}</td>
                        </tr>
                        <tr>
                          <td className="row-label">D 探测度</td>
                          <td className="col-before">{bD}</td>
                          <td className={`delta ${fmtDelta(bD, aD)?.cls}`}>{fmtDelta(bD, aD)?.label || '—'}</td>
                          <td className="col-after">{aD}</td>
                        </tr>
                        <tr className="row-ap">
                          <td className="row-label">AP 优先级</td>
                          <td className="col-before">
                            <span className={`fmea-ap ${bAp}`}>AP {bAp} · {AP_META[bAp].fullLabel}</span>
                          </td>
                          <td className={`delta ${delta === 'improve' ? 'improve' : delta === 'regress' ? 'regress' : ''}`}>
                            {delta === 'improve' ? '✓' : delta === 'regress' ? '⚠' : '→'}
                          </td>
                          <td className="col-after">
                            <span className={`fmea-ap ${aAp}`}>AP {aAp} · {AP_META[aAp].fullLabel}</span>
                          </td>
                        </tr>
                        <tr>
                          <td className="row-label">RPN</td>
                          <td className="col-before">{bRpn}</td>
                          <td className={`delta ${rpnDelta > 0 ? 'improve' : rpnDelta < 0 ? 'regress' : ''}`}>
                            {rpnDelta > 0 ? `↓ ${rpnDelta}` : rpnDelta < 0 ? `↑ ${-rpnDelta}` : '—'}
                          </td>
                          <td className="col-after">{aRpn}</td>
                        </tr>
                        <tr>
                          <td className="row-label">风险等级</td>
                          <td className={`col-before risk-${bRisk}`}>{bRisk}</td>
                          <td className="delta">—</td>
                          <td className={`col-after risk-${aRisk}`}>{aRisk}</td>
                        </tr>
                      </tbody>
                    </table>

                    <div className="fmea-compare-measures">
                      <div className="fmea-measure-col">
                        <div className="fmea-measure-label">建议措施</div>
                        <div className="fmea-measure-body">{record.action || '—'}</div>
                      </div>
                      <div className="fmea-measure-col">
                        <div className="fmea-measure-label">实际采取的措施</div>
                        <div className="fmea-measure-body">{record.measureActual || '（未回填，可在编辑页补充）'}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

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
                    <h4>相似案例 <span className="fmea-similar-hint">按产品族 / 失效编码 / AP 级别排序</span></h4>
                    <div className="fmea-similar">
                      {sims.map(({ record: s, hits }) => {
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
                            <div className="fmea-sim-head">
                              <span className={`fmea-risk ${riskClass(riskOf(s))}`}>{riskOf(s) || '未分级'}</span>
                              {s.apLevel && (
                                <span className={`fmea-ap ${s.apLevel}`} title={AP_META[s.apLevel as ApLevel]?.hint}>
                                  AP {s.apLevel}
                                </span>
                              )}
                              <span className="fmea-sim-id">{s.id}</span>
                            </div>
                            <div className="fmea-sim-mode">{shortText(s.failureMode, 44)}</div>
                            <div className="fmea-sim-hits">
                              {hits.slice(0, 3).map((h) => (
                                <span key={h} className="fmea-sim-hit-chip">{h}</span>
                              ))}
                              {hits.length > 3 && <span className="fmea-sim-more">+{hits.length - 3}</span>}
                            </div>
                            <div className="fmea-sim-meta">
                              {s.machine || '通用'} · {productMinorOf(s) || s.part || '未分类'}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 状态转换面板 + 历史时间线 */}
              {(() => {
                const currentStatus = (record.status || 'draft') as FmeaStatus;
                const nextList = allowedNextStatuses(currentStatus);
                const now = new Date();
                const handleTransit = async (target: FmeaStatus, note?: string) => {
                  const res = tryTransitStatus(currentStatus, target, user.displayName || user.username, note);
                  if (!res.ok) {
                    showToast(`状态转换失败：${res.reason}`);
                    return;
                  }
                  const updated: FmeaRecord = {
                    ...record,
                    status: res.newStatus,
                    statusHistory: [...(record.statusHistory || []), res.entry],
                    updatedAt: now.toISOString(),
                    updatedBy: user.username,
                  };
                  try {
                    const saveRes = await api.fmea.write({
                      record: updated,
                      fileName: record.id + '.parquet',
                      overwrite: true,
                    });
                    if (saveRes.ok) {
                      showToast(`已转为「${FMEA_STATUS_META[res.newStatus].label}」`);
                      patchCache(selected!.file.fullPath, updated);
                      await refresh();
                    } else {
                      showToast(`保存失败：${saveRes.message || ''}`);
                    }
                  } catch (e) {
                    showToast(`保存失败：${e instanceof Error ? e.message : String(e)}`);
                  }
                };
                // 转换按钮上的简短描述
                const nextActionLabel: Record<FmeaStatus, string> = {
                  review:    '提交评审',
                  published: '发布',
                  draft:     '打回草稿',
                  archived:  '归档作废',
                };
                return (
                  <div className="fmea-block">
                    <h4>
                      状态流转
                      <span className="fmea-status-chain">
                        <span className={`fmea-status-chip sm fmea-status-draft`}>草稿</span>
                        <span className="fmea-arrow">→</span>
                        <span className={`fmea-status-chip sm fmea-status-review`}>评审</span>
                        <span className="fmea-arrow">→</span>
                        <span className={`fmea-status-chip sm fmea-status-published`}>发布</span>
                        <span className="fmea-arrow">→</span>
                        <span className={`fmea-status-chip sm fmea-status-archived`}>归档</span>
                      </span>
                    </h4>

                    {/* 转换按钮 */}
                    <div className="fmea-transit-row">
                      <span className="fmea-transit-current">
                        当前：<span className={`fmea-status-chip fmea-status-${currentStatus}`}>{statusMeta(currentStatus).label}</span>
                      </span>
                      {nextList.map((ns) => (
                        <button
                          key={ns}
                          type="button"
                          className={`btn-ghost sm fmea-transit-btn to-${ns}`}
                          onClick={() => handleTransit(ns)}
                          title={`${FMEA_STATUS_META[currentStatus].label} → ${FMEA_STATUS_META[ns].label}`}
                        >
                          {nextActionLabel[ns as FmeaStatus] || FMEA_STATUS_META[ns].label}
                        </button>
                      ))}
                    </div>

                    {/* 状态历史时间线（倒序，最新在上） */}
                    {record.statusHistory && record.statusHistory.length > 0 && (
                      <div className="fmea-status-history">
                        <ul>
                          {[...record.statusHistory].reverse().map((h, idx) => (
                            <li key={`${h.at}-${idx}`} className="fmea-status-h-item">
                              <span className={`fmea-status-dot fmea-status-${h.to}`}></span>
                              <span className="fmea-status-desc">
                                <span className={`fmea-status-chip sm fmea-status-${h.from}`}>{FMEA_STATUS_META[h.from]?.label || h.from}</span>
                                <span className="fmea-arrow">→</span>
                                <span className={`fmea-status-chip sm fmea-status-${h.to}`}>{FMEA_STATUS_META[h.to]?.label || h.to}</span>
                              </span>
                              <span className="fmea-status-by">{h.by}</span>
                              {h.note && <span className="fmea-status-note">「{h.note}」</span>}
                              <span className="fmea-status-at">{h.at?.replace('T', ' ').slice(0, 19)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
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
                  const rawVal = editDraft![f.key];
                  const val = String(rawVal ?? '');
                  const opts = f.options;
                  const isCustom = !!(f.allowCustom && opts && !opts.includes(val) && val);
                  return (
                    <label className={f.multiline ? 'field full' : 'field'} key={f.key}>
                      <span className="mat-field-label">
                        <span className="mat-field-name">{f.label}</span>
                        <span className="mat-field-unit">{f.hint || '\u00A0'}</span>
                      </span>
                      {opts ? (
                        <>
                          <select
                            value={isCustom ? (opts ? opts[opts.length - 1] : '') : val}
                            onChange={(e) => {
                              const sel = e.target.value;
                              setEditDraft((prev) => {
                                if (!prev) return prev;
                                if (f.allowCustom && opts && sel === '自定义') {
                                  return { ...prev, [f.key]: isCustom ? val : '' };
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
                          {f.allowCustom && (isCustom || !val) && (
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
                      value={String(editDraft![f.key] ?? '')}
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
          </>
          )}
        </div>
      </div>

      {/* 词表归并预览确认弹窗（树视图 / 工作表视图共用） */}
      {mergePreview && (
        <div className="fmea-modal-mask" onClick={() => setMergePreview(null)}>
          <div className="fmea-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fmea-modal-head">
              <h4>词表归并预览 · {mergePreview.label}</h4>
              <button className="btn-link sm" onClick={() => setMergePreview(null)}>
                关闭
              </button>
            </div>
            <p className="fmea-modal-tip">
              共 {mergePreview.recs.length} 条，识别出 <b>{mergePreview.items.length}</b> 条可归并，已选{' '}
              <b>{mergePreview.items.filter((it) => it.selected).length}</b> 条
              {mergePreview.unmatched > 0 && `；${mergePreview.unmatched} 条无法匹配标准词（保留原值）`}
              。原始描述不会被改写。
            </p>
            {mergePreview.items.length > 0 && (
              <div className="fmea-merge-actions">
                <label className="fmea-merge-selectall">
                  <input
                    type="checkbox"
                    checked={mergePreview.items.every((it) => it.selected)}
                    onChange={(e) => setAllMergeSelected(e.target.checked)}
                  />
                  全选
                </label>
                <button className="btn-link sm" onClick={() => setAllMergeSelected(false)}>
                  全不选
                </button>
                <span className="fmea-merge-hint">未勾选的变更不会写入</span>
              </div>
            )}
            {mergePreview.items.length === 0 ? (
              <p className="fmea-modal-empty">没有需要归并的主词，全部条目已是标准词或无法匹配。</p>
            ) : (
              <div className="fmea-merge-list">
                {mergePreview.items.slice(0, 200).map((it) => (
                  <div
                    key={it.id}
                    className={`fmea-merge-row${it.selected ? '' : ' off'}`}
                    onClick={() => toggleMergeItem(it.id)}
                  >
                    <div className="fmea-merge-id">
                      <input
                        type="checkbox"
                        checked={it.selected}
                        onChange={() => toggleMergeItem(it.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      {it.id}
                      <span className="fmea-merge-part">{it.part}</span>
                    </div>
                    {it.mode && (
                      <div className="fmea-merge-field">
                        <i>模式</i>
                        <span className="from">{it.mode.from}</span>
                        <span className="arrow">→</span>
                        <b className="to">{it.mode.to}</b>
                      </div>
                    )}
                    {it.cause && (
                      <div className="fmea-merge-field">
                        <i>原因</i>
                        <span className="from">{it.cause.from}</span>
                        <span className="arrow">→</span>
                        <b className="to">{it.cause.to}</b>
                      </div>
                    )}
                    {it.effect && (
                      <div className="fmea-merge-field">
                        <i>后果</i>
                        <span className="from">{it.effect.from}</span>
                        <span className="arrow">→</span>
                        <b className="to">{it.effect.to}</b>
                      </div>
                    )}
                  </div>
                ))}
                {mergePreview.items.length > 200 && (
                  <p className="fmea-modal-empty">仅显示前 200 条，确认后仍会归并全部条目。</p>
                )}
              </div>
            )}
            <div className="fmea-modal-foot">
              <button className="btn-ghost sm" onClick={() => setMergePreview(null)}>
                取消
              </button>
              <button
                className="btn-primary sm"
                disabled={mergePreview.items.every((it) => !it.selected) || wsBusy}
                onClick={() => void confirmMergeSelection()}
              >
                确认归并（{mergePreview.items.filter((it) => it.selected).length}）
              </button>
            </div>
          </div>
        </div>
      )}

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
