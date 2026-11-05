import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CtrUser } from '../api';
import { MaterialCurvePlot } from '../components/MaterialCurvePlot';
import {
  MATERIAL_FIELDS,
  MATERIAL_TYPE_LABEL,
  materialCsvFileName,
  materialRecordToCsv,
  parseMaterialFileName,
  parseMaterialRecord,
  type MaterialCurve,
  type MaterialRecord,
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
  const [selected, setSelected] = useState<MaterialFile | null>(null);
  const [record, setRecord] = useState<MaterialRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [readBusy, setReadBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

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

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return files
      .map((f) => ({ file: f, meta: parseMaterialFileName(f.name) }))
      .filter((r) => (typeFilter === 'all' ? true : r.meta.type === typeFilter))
      .filter((r) =>
        kw
          ? r.meta.grade.toLowerCase().includes(kw) ||
            r.meta.series.toLowerCase().includes(kw) ||
            r.file.name.toLowerCase().includes(kw)
          : true,
      )
      .sort((a, b) => b.file.mtime.localeCompare(a.file.mtime));
  }, [files, keyword, typeFilter]);

  const convCount = files.filter((f) => parseMaterialFileName(f.name).type === 'conventional').length;
  const hyperCount = files.length - convCount;

  // 预览请求序号：防止快速切换行时，较慢的旧请求覆盖新选中的内容
  const reqSeq = useRef(0);

  /** 单击：读取 Parquet 记录并在下方预览 */
  const selectFile = useCallback(async (f: MaterialFile) => {
    const seq = ++reqSeq.current;
    setSelected(f);
    setRecord(null);
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
          {keyword && (
            <button className="btn-link" onClick={() => setKeyword('')}>
              清除
            </button>
          )}
          <span className="lib-count">筛选结果 {filtered.length} 条 · 双击行可用本地软件打开</span>
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
                  <td colSpan={8} className="center settings-hint">
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
                    温度：{selectedMeta.temperature == null ? '—' : `${selectedMeta.temperature} °C`}
                  </span>
                  {record && <span className="chip">版本：第 {record.revision} 版</span>}
                  <span className="chip">
                    {formatSize(selected.size)} · {new Date(selected.mtime).toLocaleString('zh-CN')}
                  </span>
                  <button className="btn-ghost sm" onClick={downloadCsv} disabled={!record}>
                    下载 CSV
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
                        <>
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
                        </>
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
                        <>
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
                        </>
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
