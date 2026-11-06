import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CtrUser } from '../api';
import { MaterialCurvePlot } from '../components/MaterialCurvePlot';
import {
  buildMaterialRecord,
  draftFromRecord,
  MATERIAL_FIELDS,
  MATERIAL_STATE_LABEL,
  MATERIAL_TYPE_LABEL,
  materialCsvFileName,
  materialFileName,
  materialRecordToCsv,
  parseCurveCsv,
  parseMaterialFileName,
  parseMaterialRecord,
  validateMaterialDraft,
  type MaterialCurve,
  type MaterialCurveKey,
  type MaterialDraft,
  type MaterialRecord,
  type MaterialState,
  type MaterialType,
} from '../report/material';
import { UNC_MATERIAL_LIB } from '../report/db';

interface Props {
  user: CtrUser;
}

interface MaterialFile {
  name: string;
  size: number;
  mtime: string;
  fullPath: string;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 材料检索：布局与试验报告检索一致 —— 上方列表（可拖动调高），下方预览选中的材料记录 */
export function MaterialsSearchPage({ user }: Props) {
  const [files, setFiles] = useState<MaterialFile[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | MaterialType>('all');
  const [stateFilter, setStateFilter] = useState<'all' | MaterialState>('all');
  const [tempFilter, setTempFilter] = useState('23'); // 温度筛选默认 23℃
  const [modulusMin, setModulusMin] = useState(''); // 弹性模量 ≥ 输入值
  const [selected, setSelected] = useState<MaterialFile | null>(null);
  const [record, setRecord] = useState<MaterialRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [readBusy, setReadBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // 编辑已导入记录（修正导入错误）
  const [editDraft, setEditDraft] = useState<MaterialDraft | null>(null);
  const [editIssues, setEditIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // 列表区 / 预览区 高度比例（0.15 ~ 0.85，默认 0.4，与试验报告检索一致）
  const [listRatio, setListRatio] = useState<number>(() => {
    const v = window.localStorage.getItem('ctr.materialSearchListRatio');
    const n = v ? Number(v) : 0.4;
    return Number.isFinite(n) && n >= 0.15 && n <= 0.85 ? n : 0.4;
  });

  useEffect(() => {
    window.localStorage.setItem('ctr.materialSearchListRatio', String(listRatio));
  }, [listRatio]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2600);
  };

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const ping = await api.db.ping();
      setReachable(ping.reachable);
      const res = await api.db.list({ libType: 'material' });
      if (res.ok) setFiles(res.files || []);
      else setError(res.message || '读取材料库失败');
    } catch (e) {
      setError(`读取材料库失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 供应商列与弹性模量筛选都需要记录内容（文件名里没有），进入页面后逐批读取并缓存
  const [recCache, setRecCache] = useState<Record<string, MaterialRecord | null>>({});
  const [cacheBusy, setCacheBusy] = useState(false);

  useEffect(() => {
    const todo = files.filter((f) => !(f.fullPath in recCache));
    if (!todo.length) return;
    let cancelled = false;
    setCacheBusy(true);
    (async () => {
      // 每次并发 6 个，避免 UNC 共享目录上同时打开过多文件
      for (let i = 0; i < todo.length; i += 6) {
        const batch = todo.slice(i, i + 6);
        const part = await Promise.all(
          batch.map(async (f) => {
            try {
              const res = await api.db.readText({ fullPath: f.fullPath });
              return [f.fullPath, res.ok && res.text ? parseMaterialRecord(res.text) : null] as const;
            } catch {
              return [f.fullPath, null] as const;
            }
          }),
        );
        if (cancelled) return;
        setRecCache((prev) => {
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
  }, [files, recCache]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const temp = tempFilter.trim() === '' ? null : Number(tempFilter);
    const eMin = modulusMin.trim() === '' ? null : Number(modulusMin);
    return files
      .map((f) => {
        // 记录读回后以记录为准（新命名不含类型/状态段，文件名反解仅作加载前兜底）
        const rec = recCache[f.fullPath];
        const meta = rec
          ? {
              type: rec.type,
              grade: rec.grade,
              series: rec.series,
              supplier: rec.supplier,
              temperature: rec.temperature,
              state: rec.state,
            }
          : parseMaterialFileName(f.name);
        return { file: f, meta };
      })
      .filter((r) => (typeFilter === 'all' ? true : r.meta.type === typeFilter))
      .filter((r) => (stateFilter === 'all' ? true : r.meta.state === stateFilter))
      // 温度：等于操作者输入值（允许 0.01 误差），留空表示不限
      .filter((r) =>
        temp == null || !Number.isFinite(temp)
          ? true
          : r.meta.temperature != null && Math.abs(r.meta.temperature - temp) < 0.01,
      )
      // 弹性模量：≥ 操作者输入值，未记录模量的记录不参与
      .filter((r) => {
        if (eMin == null || !Number.isFinite(eMin)) return true;
        const rec = recCache[r.file.fullPath];
        return rec != null && rec.elasticModulus != null && rec.elasticModulus >= eMin;
      })
      .filter((r) =>
        kw
          ? r.meta.grade.toLowerCase().includes(kw) ||
            r.meta.series.toLowerCase().includes(kw) ||
            r.file.name.toLowerCase().includes(kw)
          : true,
      )
      .sort((a, b) => b.file.mtime.localeCompare(a.file.mtime));
  }, [files, keyword, typeFilter, stateFilter, tempFilter, modulusMin, recCache]);

  const typeOf = (f: MaterialFile) =>
    recCache[f.fullPath]?.type ?? parseMaterialFileName(f.name).type;
  const convCount = files.filter((f) => typeOf(f) === 'conventional').length;
  const hyperCount = files.length - convCount;

  // 预览请求序号：防止快速切换行时，较慢的旧请求覆盖新选中的内容
  const reqSeq = useRef(0);

  /** 单击：读取 Parquet 记录并在下方预览 */
  const selectFile = useCallback(async (f: MaterialFile) => {
    const seq = ++reqSeq.current;
    setSelected(f);
    setRecord(null);
    setEditDraft(null);
    setEditIssues([]);
    setError('');
    setReadBusy(true);
    const stale = () => seq !== reqSeq.current;
    try {
      const res = await api.db.readText({ fullPath: f.fullPath });
      if (stale()) return;
      if (!res.ok || !res.text) {
        setError(`材料记录读取失败：${res.message || '无法读取'}`);
        return;
      }
      const rec = parseMaterialRecord(res.text);
      if (!rec) {
        setError('材料记录格式无法识别');
        return;
      }
      setRecord(rec);
    } catch (e) {
      if (!stale()) setError(`读取失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (!stale()) setReadBusy(false);
    }
  }, []);

  /** 双击：调用系统默认程序打开原文 */
  const openFile = useCallback(async (f: MaterialFile) => {
    const res = await api.app.openPath(f.fullPath);
    if (!res.ok) setError(`无法用本地程序打开：${res.message || '未知错误'}`);
  }, []);

  /** 删除材料记录：二次确认 → 主进程删除 → 刷新列表并清理选中态 */
  const removeFile = useCallback(
    async (f: MaterialFile) => {
      if (!window.confirm(`确定删除该材料记录吗？\n\n${f.name}\n\n删除后无法恢复。`)) return;
      setBusy(true);
      setError('');
      try {
        const res = await api.db.remove({ fullPath: f.fullPath });
        if (res.ok) {
          if (selected?.fullPath === f.fullPath) {
            reqSeq.current += 1; // 使进行中的预览请求失效
            setSelected(null);
            setRecord(null);
            setReadBusy(false);
          }
          showToast('已删除该材料记录');
          await refresh();
        } else {
          setError(`删除失败：${res.message || '未知错误'}`);
        }
      } catch (e) {
        setError(`删除失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [refresh, selected],
  );

  // 列表/预览水平拖动
  const handleListResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = (e.currentTarget.parentElement as HTMLElement) || null;
      if (!container) return;
      const startY = e.clientY;
      const startRatio = listRatio;
      const startH = container.getBoundingClientRect().height;
      const minR = 0.15,
        maxR = 0.85;
      const onMove = (ev: MouseEvent) => {
        const deltaY = ev.clientY - startY;
        const next = startRatio + deltaY / startH;
        setListRatio(Math.min(maxR, Math.max(minR, next)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [listRatio],
  );

  const selectedMeta = selected ? parseMaterialFileName(selected.name) : null;

  // 保存修改后（可能改名）等列表刷新完成，用新文件对象替换选中项，保证头部信息准确
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingPath) return;
    const f = files.find((x) => x.fullPath === pendingPath);
    if (f) {
      setSelected(f);
      setPendingPath(null);
    }
  }, [files, pendingPath]);

  /** 检索处下载格式为 CSV（与 Parquet 同名，扩展名 .csv） */
  const downloadCsv = async () => {
    if (!record) return;
    const res = await api.file.save({
      defaultName: materialCsvFileName(record),
      content: materialRecordToCsv(record),
    });
    if (res.ok) showToast('CSV 已保存');
    else if (!res.canceled) showToast('保存 CSV 失败');
  };

  /** 复制曲线数据到剪贴板（带表头的 CSV 格式，方便粘贴进 Excel） */
  const copyCurveData = useCallback(
    (curve: MaterialCurve | null, header: string) => {
      if (!curve?.points.length) return;
      const text = [header, ...curve.points.map((p) => `${p.x},${p.y}`)].join('\n');
      navigator.clipboard.writeText(text).then(() => showToast('曲线数据已复制')).catch(() => showToast('复制失败'));
    },
    [],
  );

  /** 进入编辑：把记录还原为草稿 */
  const startEdit = () => {
    if (!record) return;
    setEditDraft(draftFromRecord(record));
    setEditIssues([]);
  };

  const patchEdit = (key: keyof MaterialDraft, value: string) => {
    setEditDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const patchEditCurve = (key: MaterialCurveKey, curve: MaterialCurve | null) => {
    setEditDraft((prev) => (prev ? { ...prev, [key]: curve } : prev));
  };

  const editCurveInputRef = useRef<HTMLInputElement | null>(null);
  const editCurveTarget = useRef<MaterialCurveKey>('stressStrainCurve');

  const pickEditCurveFile = (key: MaterialCurveKey) => {
    editCurveTarget.current = key;
    editCurveInputRef.current?.click();
  };

  const onEditCurveFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = parseCurveCsv(String(reader.result || ''));
      if (res.error) {
        showToast(`曲线解析失败：${res.error}`);
        return;
      }
      const key = editCurveTarget.current;
      patchEditCurve(key, { sourceName: file.name, points: res.points });
      showToast(`已解析 ${res.points.length} 个数据点`);
    };
    reader.onerror = () => showToast('曲线文件读取失败');
    reader.readAsText(file, 'utf-8');
  };

  /** 保存修改：校验 → 重算文件名 → 覆写 Parquet（改名时删除旧文件） */
  const saveEdit = async () => {
    if (!editDraft || !record || !selected) return;
    const v = validateMaterialDraft(editDraft);
    if (v.errors.length) {
      setEditIssues(v.errors.map((i) => `${i.field}：${i.message}`));
      showToast('存在校验错误，请先修正');
      return;
    }
    setSaving(true);
    try {
      const next = buildMaterialRecord(editDraft, {
        username: user.username,
        displayName: user.displayName,
        previous: record,
      });
      const hardness =
        next.type === 'hyperelastic' && next.hardness !== null ? String(next.hardness) : '';
      const newName = materialFileName(
        next.grade,
        next.series,
        next.temperature,
        next.supplier,
        hardness,
      );
      const res = await api.material.write({ record: next, fileName: newName, overwrite: true });
      if (!res.ok) {
        setError(`保存失败：${res.message || '未知错误'}`);
        return;
      }
      const oldPath = selected.fullPath;
      if (res.filePath && res.filePath !== oldPath) {
        await api.db.remove({ fullPath: oldPath });
      }
      setRecord(next);
      setRecCache((prev) => ({ ...prev, [(res.filePath || oldPath)]: next, [oldPath]: next }));
      // 等列表刷新完成后按新路径重新定位选中项，刷新头部文件名/大小/时间
      setPendingPath(res.filePath || oldPath);
      setEditDraft(null);
      setEditIssues([]);
      showToast(`已保存修改（第 ${next.revision} 版）`);
      await refresh();
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  /** 批量整理已导入材料的文件名：超弹性材料补入硬度段 */
  const normalizeFileNames = async () => {
    if (
      !window.confirm(
        '将按「牌号+系列号+温度+硬度+供应商」重新命名已导入的超弹性材料文件，常规材料保持不变。\n\n文件较多时可能需要一些时间，是否继续？',
      )
    ) {
      return;
    }
    setBusy(true);
    let renamed = 0;
    let skipped = 0;
    let failed = 0;
    const cacheUpdates: Record<string, MaterialRecord | null> = {};
    try {
      for (const f of files) {
        let rec = recCache[f.fullPath];
        if (rec === undefined) {
          const res = await api.db.readText({ fullPath: f.fullPath });
          rec = res.ok && res.text ? parseMaterialRecord(res.text) : null;
        }
        if (!rec || rec.type !== 'hyperelastic') continue;
        const hardness = rec.hardness !== null ? String(rec.hardness) : '';
        if (!hardness) {
          skipped++;
          continue;
        }
        const expected = materialFileName(
          rec.grade,
          rec.series,
          rec.temperature,
          rec.supplier,
          hardness,
        );
        if (expected === f.name) {
          skipped++;
          continue;
        }
        const res = await api.material.write({ record: rec, fileName: expected, overwrite: false });
        if (!res.ok || !res.filePath) {
          failed++;
          continue;
        }
        await api.db.remove({ fullPath: f.fullPath });
        cacheUpdates[res.filePath] = rec;
        if (selected?.fullPath === f.fullPath) {
          setSelected({ ...f, fullPath: res.filePath, name: expected });
        }
        renamed++;
      }
      if (Object.keys(cacheUpdates).length) {
        setRecCache((prev) => ({ ...prev, ...cacheUpdates }));
      }
      showToast(`文件名整理完成：重命名 ${renamed} 个，跳过 ${skipped} 个，失败 ${failed} 个`);
      await refresh();
    } catch (e) {
      setError(`整理文件名失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="test-search">
      <div className="settings-card">
        <div className="ts-head">
          <h3>材料检索</h3>
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
            <span className="chip">常规材料 {convCount}</span>
            <span className="chip">超弹性 {hyperCount}</span>
            <button className="btn-ghost sm" onClick={refresh} disabled={busy}>
              {busy ? '刷新中…' : '刷新'}
            </button>
            <button
              className="btn-ghost sm"
              onClick={normalizeFileNames}
              disabled={busy || cacheBusy}
              title="为已导入的超弹性材料文件名补入硬度段（牌号+系列号+温度+硬度+供应商）"
            >
              整理文件名
            </button>
          </div>
        </div>
        <div className="ts-toolbar">
          <input
            className="search-input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="输入牌号 / 系列号 / 文件名 关键字过滤"
          />
          <select
            className="tu-project"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | MaterialType)}
          >
            <option value="all">全部类型</option>
            <option value="conventional">常规材料</option>
            <option value="hyperelastic">超弹性材料</option>
          </select>
          <select
            className="tu-project"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as 'all' | MaterialState)}
            title="按湿态 / 干态筛选"
          >
            <option value="all">全部状态</option>
            <option value="wet">湿态</option>
            <option value="dry">干态</option>
          </select>
          <label className="mat-filter-inline" title="温度筛选，留空表示不限">
            <span>温度</span>
            <input
              className="search-input sm"
              type="number"
              step="0.5"
              value={tempFilter}
              onChange={(e) => setTempFilter(e.target.value)}
              placeholder="全部"
            />
            <span className="small muted">℃</span>
          </label>
          <label className="mat-filter-inline" title="弹性模量 ≥ 输入值，留空表示不限">
            <span>弹性模量 ≥</span>
            <input
              className="search-input sm"
              type="number"
              step="100"
              value={modulusMin}
              onChange={(e) => setModulusMin(e.target.value)}
              placeholder="不限"
            />
            <span className="small muted">MPa</span>
          </label>
          {(keyword || stateFilter !== 'all' || tempFilter !== '23' || modulusMin) && (
            <button
              className="btn-link"
              onClick={() => {
                setKeyword('');
                setTypeFilter('all');
                setStateFilter('all');
                setTempFilter('23');
                setModulusMin('');
              }}
            >
              重置筛选
            </button>
          )}
          <span className="lib-count">
            {cacheBusy ? '正在读取材料详情… · ' : ''}筛选结果 {filtered.length} 条 · 双击行可用本地软件打开
          </span>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div
        className="ts-body"
        style={{ gridTemplateRows: `${Math.round(listRatio * 100)}% 6px minmax(0, 1fr)` }}
      >
        <div className="ts-list-wrap">
          <table className="ts-list">
            <thead>
              <tr>
                <th style={{ width: 64 }}>类型</th>
                <th style={{ width: '14%' }}>牌号</th>
                <th style={{ width: '15%' }}>系列号</th>
                <th style={{ width: '12%' }}>供应商</th>
                <th style={{ width: 64 }}>状态</th>
                <th style={{ width: 90 }}>温度</th>
                <th style={{ width: 150 }}>归档时间</th>
                <th style={{ width: 82 }}>大小</th>
                <th>完整文件名</th>
                <th style={{ width: 56 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ file, meta }) => {
                const active = selected?.fullPath === file.fullPath;
                return (
                  <tr
                    key={file.fullPath}
                    className={active ? 'active' : ''}
                    onClick={() => {
                      if (selected?.fullPath !== file.fullPath) selectFile(file);
                    }}
                    onDoubleClick={() => openFile(file)}
                    title="单击预览，双击用本地软件打开"
                  >
                    <td>
                      {meta.type === 'hyperelastic' ? (
                        <span className="type-badge type-hyper">超弹性</span>
                      ) : (
                        <span className="type-badge type-conv">常规</span>
                      )}
                    </td>
                    <td>{meta.grade || '—'}</td>
                    <td>{meta.series || '—'}</td>
                    <td>
                      {meta.supplier ||
                        (recCache[file.fullPath] === undefined ? (
                          <span className="muted small">…</span>
                        ) : (
                          '—'
                        ))}
                    </td>
                    <td>
                      <span className={`state-badge state-${meta.state}`}>
                        {MATERIAL_STATE_LABEL[meta.state]}
                      </span>
                    </td>
                    <td>{meta.temperature == null ? '—' : `${meta.temperature} °C`}</td>
                    <td className="small">{file.mtime}</td>
                    <td className="small">{formatSize(file.size)}</td>
                    <td className="mono">{file.name}</td>
                    <td className="center">
                      <button
                        className="btn-link danger"
                        title="删除该材料记录"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(file);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="center settings-hint">
                    {files.length === 0
                      ? '材料库暂无记录，请先在「材料数据导入」模块录入'
                      : '无匹配结果'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="ts-resizer" onMouseDown={handleListResize} />

        <div className="preview-area">
          {!selected && (
            <div className="preview-empty">
              <div className="pe-icon">🔍</div>
              <div className="pe-title">从上方列表选中一条材料记录</div>
              <div className="pe-sub">
                点击列表行即可在下方预览物性参数与曲线。归档目录：
                <span className="mono"> {UNC_MATERIAL_LIB} </span>。
                {reachable === false && (
                  <span className="pe-warn">
                    浏览器调试模式下无法访问服务器，请在桌面版安装包中使用检索功能。
                  </span>
                )}
              </div>
            </div>
          )}

          {selected && selectedMeta && (
            <>
              <div className="preview-head">
                <h3>{selected.name}</h3>
                <div className="preview-meta">
                  <span className="chip">类型：{MATERIAL_TYPE_LABEL[selectedMeta.type]}</span>
                  <span className="chip">牌号：{selectedMeta.grade || '—'}</span>
                  <span className="chip">系列号：{selectedMeta.series || '—'}</span>
                  <span className="chip">
                    状态：
                    {record
                      ? MATERIAL_STATE_LABEL[record.state === 'dry' ? 'dry' : 'wet']
                      : MATERIAL_STATE_LABEL[selectedMeta.state]}
                  </span>
                  <span className="chip">
                    温度：{selectedMeta.temperature == null ? '—' : `${selectedMeta.temperature} °C`}
                  </span>
                  {record && <span className="chip">版本：第 {record.revision} 版</span>}
                  <span className="chip">
                    {formatSize(selected.size)} · {new Date(selected.mtime).toLocaleString('zh-CN')}
                  </span>
                  <button className="btn-ghost sm" onClick={downloadCsv} disabled={!record}>
                    下载 CSV
                  </button>
                  <button className="btn-ghost sm" onClick={startEdit} disabled={!record || !!editDraft}>
                    编辑
                  </button>
                  <button className="btn-ghost sm" onClick={() => openFile(selected)}>
                    打开文件
                  </button>
                </div>
              </div>

              {readBusy ? (
                <div className="preview-loading">正在读取材料记录…</div>
              ) : !record ? (
                <div className="preview-empty">
                  <div className="pe-icon">📋</div>
                  <div className="pe-title">未能解析该材料记录</div>
                  <div className="pe-sub">文件可能损坏，或不是 ctr-material-v1 格式</div>
                </div>
              ) : editDraft ? (
                <div className="mat-edit-card">
                  <input
                    ref={editCurveInputRef}
                    type="file"
                    accept=".csv,.txt"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onEditCurveFile(f);
                      e.currentTarget.value = '';
                    }}
                  />
                  <div className="mat-edit-grid">
                    {(MATERIAL_FIELDS[editDraft.type] as Array<{ key: string; label: string; unit?: string }>).map(
                      (f) => (
                        <label className="field" key={f.key}>
                          <span className="mat-field-label">
                            <span className="mat-field-name">{f.label}</span>
                            <span className="mat-field-unit">{f.unit ? `（${f.unit}）` : '\u00A0'}</span>
                          </span>
                          <input
                            value={String((editDraft as unknown as Record<string, unknown>)[f.key] ?? '')}
                            onChange={(e) => patchEdit(f.key as keyof MaterialDraft, e.target.value)}
                          />
                        </label>
                      ),
                    )}
                    <label className="field">
                      <span className="mat-field-label">
                        <span className="mat-field-name">状态</span>
                        <span className="mat-field-unit">{'\u00A0'}</span>
                      </span>
                      <select value={editDraft.state} onChange={(e) => patchEdit('state', e.target.value)}>
                        <option value="wet">{MATERIAL_STATE_LABEL.wet}</option>
                        <option value="dry">{MATERIAL_STATE_LABEL.dry}</option>
                      </select>
                    </label>
                  </div>

                  <div className="mat-edit-curves">
                    {(['stressStrainCurve', 'fatigueCurve'] as const).map((key) => (
                      <div className="mat-edit-curve" key={key}>
                        <div className="mat-edit-curve-head">
                          <b>{key === 'stressStrainCurve' ? '应力应变曲线' : '疲劳寿命曲线'}</b>
                          <span className="small muted">
                            {editDraft[key]?.points.length
                              ? `${editDraft[key]!.points.length} 个数据点`
                              : '未提供'}
                          </span>
                          <button className="btn-ghost sm" onClick={() => pickEditCurveFile(key)}>
                            上传曲线 CSV
                          </button>
                          <button
                            className="btn-link danger sm"
                            onClick={() => patchEditCurve(key, null)}
                            disabled={!editDraft[key]?.points.length}
                          >
                            清空
                          </button>
                        </div>
                        {editDraft[key]?.points.length ? (
                          <MaterialCurvePlot curve={editDraft[key]} kind={key} />
                        ) : null}
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
                    <span className="small muted">
                      保存后覆盖原记录并升版；若牌号 / 系列号 / 温度 / 供应商变化，文件名会同步更新
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mat-preview-3col" style={{
                    gridTemplateColumns: record.fatigueCurve?.points.length ? '260px 1fr 1fr' : '260px 1fr',
                  }}>
                    {/* 左：基本信息 */}
                    <div className="mat-preview-col">
                      <div className="mat-preview-col-head">基本信息</div>
                      <div className="mat-preview-col-body">
                        <div className="mat-detail-grid" style={{ gridTemplateColumns: '1fr', gap: 4 }}>
                          <div className="mat-detail-item">
                            <span>状态</span>
                            <b>{MATERIAL_STATE_LABEL[record.state === 'dry' ? 'dry' : 'wet']}</b>
                          </div>
                          {(MATERIAL_FIELDS[record.type] as Array<{ key: string; label: string; unit?: string }>).map((f) => {
                            const value = (record as unknown as Record<string, unknown>)[f.key];
                            return (
                              <div className="mat-detail-item" key={f.key}>
                                <span>{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
                                <b>
                                  {value == null || value === ''
                                    ? '未提供'
                                    : `${String(value)}${f.unit ? ` ${f.unit}` : ''}`}
                                </b>
                              </div>
                            );
                          })}
                          <div className="mat-detail-item">
                            <span>录入人</span>
                            <b>{record.createdByDisplay || record.createdBy || '—'}</b>
                          </div>
                          <div className="mat-detail-item">
                            <span>更新时间</span>
                            <b>{record.updatedAt ? record.updatedAt.replace('T', ' ').slice(0, 19) : '—'}</b>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 中：应力应变曲线 + 数据表 */}
                    <div className="mat-preview-col">
                      <div className="mat-preview-col-head">
                        应力应变曲线
                        <button
                          className="btn-link sm"
                          onClick={() => copyCurveData(record.stressStrainCurve, '应变(%),应力(MPa)')}
                          disabled={!record.stressStrainCurve?.points.length}
                          style={{ marginLeft: 'auto', fontSize: 12 }}
                        >
                          复制数据
                        </button>
                      </div>
                      {record.stressStrainCurve?.points.length ? (
                        <div className="mat-preview-col-body">
                          <MaterialCurvePlot curve={record.stressStrainCurve} kind="stressStrainCurve" />
                          <div className="mat-curve-table-wrap">
                            <table className="mat-curve-table">
                              <thead>
                                <tr><th style={{ width: 56 }}>#</th><th>应变 (%)</th><th>应力 (MPa)</th></tr>
                              </thead>
                              <tbody>
                                {record.stressStrainCurve.points.map((p, i) => (
                                  <tr key={i}>
                                    <td>{i + 1}</td>
                                    <td>{p.x}</td>
                                    <td>{p.y}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <div className="preview-empty" style={{ padding: 30 }}>
                          <div className="pe-sub">该材料未提供应力应变曲线</div>
                        </div>
                      )}
                    </div>

                    {/* 右：疲劳曲线 + 数据表（只有存在才渲染） */}
                    {record.fatigueCurve?.points.length && (
                      <div className="mat-preview-col">
                        <div className="mat-preview-col-head">
                          疲劳寿命曲线
                          <button
                            className="btn-link sm"
                            onClick={() => copyCurveData(record.fatigueCurve, '寿命(cycles),应力(MPa)')}
                            disabled={!record.fatigueCurve?.points.length}
                            style={{ marginLeft: 'auto', fontSize: 12 }}
                          >
                            复制数据
                          </button>
                        </div>
                        <div className="mat-preview-col-body">
                          <MaterialCurvePlot curve={record.fatigueCurve} kind="fatigueCurve" />
                          <div className="mat-curve-table-wrap">
                            <table className="mat-curve-table">
                              <thead>
                                <tr><th style={{ width: 56 }}>#</th><th>寿命 (cycles)</th><th>应力 (MPa)</th></tr>
                              </thead>
                              <tbody>
                                {record.fatigueCurve.points.map((p, i) => (
                                  <tr key={i}>
                                    <td>{i + 1}</td>
                                    <td>{p.x.toLocaleString()}</td>
                                    <td>{p.y}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="settings-hint small" style={{ marginTop: 10 }}>
                    记录文件：<span className="mono">{selected.fullPath}</span> · 当前登录：
                    {user.displayName || user.username}
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
