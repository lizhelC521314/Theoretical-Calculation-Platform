import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CtrUser } from '../api';
import { IS_STANDARD } from '../edition';
import { PdfViewer } from '../components/PdfViewer';
import { archiveCaeFileName, archiveDateInRange, parseCaeArchiveName } from '../report/db';

interface Props {
  user: CtrUser;
}

interface DbFile {
  name: string;
  size: number;
  mtime: string;
  fullPath: string;
}

function isPdf(f: DbFile): boolean {
  return /\.pdf$/i.test(f.name);
}

/** 编辑态：CAE 元数据各字段（date 为 input[type=date] 需要的 YYYY-MM-DD） */
interface EditState {
  customer: string;
  project: string;
  caeItem: string;
  flow: string;
  flowUnit: string;
  product: string;
  version: string;
  date: string;
}

/** 从 CAE 归档文件名解析出的元数据 → 编辑表单初始值 */
function metaToEdit(p: ReturnType<typeof parseCaeArchiveName>): EditState {
  return {
    customer: p.customer,
    project: p.project,
    caeItem: p.caeItem,
    flow: p.flow,
    flowUnit: p.flowUnit,
    product: p.product,
    version: p.version,
    date: /^\d{8}$/.test(p.date)
      ? `${p.date.slice(0, 4)}-${p.date.slice(4, 6)}-${p.date.slice(6, 8)}`
      : '',
  };
}

/** CAE 报告检索：列表 + 关键字过滤 + 内置 PDF 预览 */
export function CaeSearchPage({ user: _user }: Props) {
  const [files, setFiles] = useState<DbFile[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [keyword, setKeyword] = useState('');
  const [productFilter, setProductFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<DbFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  /** 元数据编辑态：非 null 时预览区头部切换为编辑表单 */
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);

  // 上方列表 / 下方预览 的高度比例（0.15 ~ 0.85，默认 0.4）
  const [listRatio, setListRatio] = useState<number>(() => {
    const v = window.localStorage.getItem('ctr.caeSearchListRatio');
    const n = v ? Number(v) : 0.4;
    return Number.isFinite(n) && n >= 0.15 && n <= 0.85 ? n : 0.4;
  });

  useEffect(() => {
    window.localStorage.setItem('ctr.caeSearchListRatio', String(listRatio));
  }, [listRatio]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const ping = await api.db.ping();
      setReachable(ping.reachable);
      const res = await api.db.list({ libType: 'cae' });
      if (res.ok) setFiles(res.files || []);
      else setError(res.message || '读取 CAE 库失败');
    } catch (e) {
      setError(`读取 CAE 库失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const productOptions = useMemo(() => {
    const set = new Set<string>();
    files.forEach((f) => {
      const p = parseCaeArchiveName(f.name).product.trim();
      if (p) set.add(p);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [files]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    // 只填一侧日期时按单日处理（某一天）；填两侧则按时间段筛选
    const from = dateFrom || dateTo;
    const to = dateTo || dateFrom;
    return files.filter((f) => {
      const p = parseCaeArchiveName(f.name);
      if (productFilter !== 'all' && p.product.trim() !== productFilter) return false;
      if ((from || to) && !archiveDateInRange(p.date, from, to)) return false;
      if (!k) return true;
      return (
        f.name.toLowerCase().includes(k) ||
        p.customer.toLowerCase().includes(k) ||
        p.project.toLowerCase().includes(k) ||
        p.caeItem.toLowerCase().includes(k) ||
        `${p.flow}${p.flowUnit}`.toLowerCase().includes(k) ||
        p.product.toLowerCase().includes(k) ||
        p.version.toLowerCase().includes(k)
      );
    });
  }, [files, keyword, productFilter, dateFrom, dateTo]);

  const pdfCount = files.filter((f) => isPdf(f)).length;

  /** 双击：调用系统默认程序（如 Acrobat / 浏览器）打开原文 */
  const openFile = useCallback(async (f: DbFile) => {
    const res = await api.app.openPath(f.fullPath);
    if (!res.ok) setError(`无法用本地程序打开：${res.message || '未知错误'}`);
  }, []);

  /** 导出报告原件副本：另存归档文件到用户指定位置 */
  const exportFile = useCallback(async (f: DbFile) => {
    setError('');
    try {
      const res = await api.file.copyOut({ srcPath: f.fullPath, defaultName: f.name });
      if (res.ok) {
        setToast(`已导出到 ${res.filePath}`);
        window.setTimeout(() => setToast(''), 4000);
      } else if (!res.canceled) {
        setError(`导出失败：${res.message || '未知错误'}`);
      }
    } catch (e) {
      setError(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  /** 删除归档报告：二次确认 → 主进程删除 → 刷新列表并清理选中态 */
  const removeFile = useCallback(
    async (f: DbFile) => {
      if (!window.confirm(`确定删除该 CAE 报告吗？\n\n${f.name}\n\n删除后无法恢复。`)) return;
      setBusy(true);
      setError('');
      try {
        const res = await api.db.remove({ fullPath: f.fullPath });
        if (res.ok) {
          if (selected?.fullPath === f.fullPath) setSelected(null);
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

  /** 进入编辑态：列表按钮或预览区按钮触发；未选中该行时先选中 */
  const startEditFor = useCallback(
    (f: DbFile) => {
      if (selected?.fullPath !== f.fullPath) setSelected(f);
      setError('');
      setEditing(metaToEdit(parseCaeArchiveName(f.name)));
    },
    [selected],
  );

  /** 保存编辑：按 CAE 归档命名规则生成新文件名 → 主进程同目录重命名 → 刷新列表并更新选中态 */
  const saveEdit = useCallback(async () => {
    if (!editing || !selected) return;
    // 项目/产品/客户/仿真项目均为文件名必需段，空值会产生「未命名」段
    if (!editing.project.trim() || !editing.product.trim()) {
      setError('项目和产品不能为空');
      return;
    }
    if (!editing.customer.trim() || !editing.caeItem.trim()) {
      setError('客户和仿真项目不能为空');
      return;
    }
    const newName = archiveCaeFileName(
      editing.customer,
      editing.project,
      editing.caeItem,
      editing.product,
      editing.version,
      editing.date,
      editing.flow,
      editing.flowUnit,
    );
    if (newName === selected.name) {
      setEditing(null);
      return;
    }
    setSaveBusy(true);
    setError('');
    try {
      const res = await api.db.rename({ fullPath: selected.fullPath, newName });
      if (res.ok) {
        setSelected({ ...selected, name: res.name || newName, fullPath: res.fullPath || selected.fullPath });
        setEditing(null);
        await refresh();
        setToast(`已保存，文件重命名为：${res.name || newName}`);
        window.setTimeout(() => setToast(''), 4000);
      } else {
        setError(`保存失败：${res.message || '未知错误'}`);
      }
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaveBusy(false);
    }
  }, [editing, selected, refresh]);

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

  const selectedMeta = selected ? parseCaeArchiveName(selected.name) : null;

  /** 编辑表单字段变更 */
  const patch = (k: keyof EditState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditing((prev) => (prev ? { ...prev, [k]: e.target.value } : prev));

  /** 保存前预览：按当前编辑值实时拼出的新归档文件名 */
  const editPreviewName =
    editing && selected
      ? archiveCaeFileName(
          editing.customer,
          editing.project,
          editing.caeItem,
          editing.product,
          editing.version,
          editing.date,
          editing.flow,
          editing.flowUnit,
        )
      : '';

  return (
    <div className="test-search">
      <div className="settings-card">
        <div className="ts-head">
          <h3>CAE 报告检索</h3>
          <div className="ts-status">
            <span>
              服务器状态：
              {reachable === null ? '检测中…' : reachable ? (
                <b className="ok">可达</b>
              ) : (
                <b className="warn">不可达（浏览器调试模式无法访问 UNC 路径）</b>
              )}
            </span>
            <span className="chip">PDF {pdfCount}</span>
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
            placeholder="输入客户 / 项目 / 仿真项目 / 产品 / 版本 / 文件名 关键字过滤"
          />
          <label className="ts-filter-inline" title="按产品筛选">
            <span>产品</span>
            <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
              <option value="all">全部产品</option>
              {productOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="ts-filter-inline" title="只填开始或结束日期表示某一天，两侧都填表示时间段">
            <span>日期</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span>至</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          {(keyword || productFilter !== 'all' || dateFrom || dateTo) && (
            <button
              className="btn-link"
              onClick={() => {
                setKeyword('');
                setProductFilter('all');
                setDateFrom('');
                setDateTo('');
              }}
            >
              重置筛选
            </button>
          )}
          <span className="lib-count">
            筛选结果 {filtered.length} 份 ·{' '}
            {IS_STANDARD ? '双击预览（禁止外部程序打开）' : '双击行可用本地软件打开'}
          </span>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      <div
        className="ts-body"
        style={{ gridTemplateRows: `${Math.round(listRatio * 100)}% 6px minmax(0, 1fr)` }}
      >
        <div className="ts-list-wrap">
          <table className="ts-list">
            <thead>
              <tr>
                <th style={{ width: 64 }}>类型</th>
                <th style={{ width: '11%' }}>客户</th>
                <th style={{ width: '12%' }}>项目</th>
                <th style={{ width: '14%' }}>仿真项目</th>
                <th style={{ width: '8%' }}>流量</th>
                <th style={{ width: '10%' }}>产品</th>
                <th style={{ width: '7%' }}>版本</th>
                <th style={{ width: '8%' }}>日期</th>
                <th style={{ width: '8%' }}>大小</th>
                <th>完整文件名</th>
                <th style={{ width: 150 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const p = parseCaeArchiveName(f.name);
                const active = selected?.fullPath === f.fullPath;
                return (
                  <tr
                    key={f.fullPath}
                    className={active ? 'active' : ''}
                    onClick={() => {
                      if (selected?.fullPath !== f.fullPath) {
                        setSelected(f);
                        setEditing(null); // 切换选中文件时退出编辑态
                      }
                    }}
                    onDoubleClick={() => openFile(f)}
                    title={IS_STANDARD ? '单击预览，双击预览（禁止外部程序打开）' : '单击预览，双击用本地软件打开'}
                  >
                    <td>
                      {isPdf(f) ? (
                        <span className="type-badge type-pdf">PDF</span>
                      ) : (
                        <span className="type-badge type-xlsx">FILE</span>
                      )}
                    </td>
                    <td>{p.customer || '—'}</td>
                    <td>{p.project || '—'}</td>
                    <td>{p.caeItem || '—'}</td>
                    <td>{p.flow ? `${p.flow} ${p.flowUnit || ''}`.trim() : '—'}</td>
                    <td>{p.product || '—'}</td>
                    <td>{p.version || '—'}</td>
                    <td>{p.date || '—'}</td>
                    <td>{(f.size / 1024).toFixed(1)} KB</td>
                    <td className="mono">{f.name}</td>
                    <td className="center">
                      {!IS_STANDARD && (
                        <button
                          className="btn-link"
                          title="编辑元数据（重命名归档文件）"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditFor(f);
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          编辑
                        </button>
                      )}
                      <button
                        className="btn-link"
                        title="导出报告副本"
                        onClick={(e) => {
                          e.stopPropagation();
                          exportFile(f);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        导出
                      </button>
                      {!IS_STANDARD && (
                        <button
                          className="btn-link danger"
                          title="删除该报告"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(f);
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          删除
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="center settings-hint">
                    {files.length === 0
                      ? IS_STANDARD
                        ? 'CAE 库暂无归档报告，请联系管理员导入'
                        : 'CAE 库暂无归档报告，请先在「CAE 报告导入」模块归档'
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
              <div className="pe-title">从上方列表选中一份 CAE 报告</div>
              <div className="pe-sub">
                点击列表行即可预览，报告以 PDF 原文呈现。
                {reachable === false && (
                  <span className="pe-warn">浏览器调试模式下无法访问服务器，请在桌面版安装包中使用检索功能。</span>
                )}
              </div>
            </div>
          )}

          {selected && selectedMeta && (
            <>
              <div className="preview-head">
                <h3>{selected.name}</h3>
                {editing ? (
                  <div className="edit-meta">
                    <div className="em-grid">
                      <label>
                        客户
                        <input value={editing.customer} onChange={patch('customer')} placeholder="必填" />
                      </label>
                      <label>
                        项目
                        <input value={editing.project} onChange={patch('project')} placeholder="必填" />
                      </label>
                      <label>
                        仿真项目
                        <input value={editing.caeItem} onChange={patch('caeItem')} placeholder="必填，如 CFD 流阻" />
                      </label>
                      <label>
                        流量
                        <input value={editing.flow} onChange={patch('flow')} placeholder="可空，如 370 或 260/240" />
                      </label>
                      <label>
                        流量单位
                        <select value={editing.flowUnit} onChange={patch('flowUnit')}>
                          <option value="">无</option>
                          <option value="kg/h">kg/h</option>
                          <option value="m³/h">m³/h</option>
                        </select>
                      </label>
                      <label>
                        产品
                        <input value={editing.product} onChange={patch('product')} placeholder="必填" />
                      </label>
                      <label>
                        版本
                        <input value={editing.version} onChange={patch('version')} placeholder="默认 V0" />
                      </label>
                      <label>
                        日期
                        <input type="date" value={editing.date} onChange={patch('date')} />
                      </label>
                    </div>
                    <div className="em-actions">
                      <button className="btn-primary sm" onClick={saveEdit} disabled={saveBusy}>
                        {saveBusy ? '保存中…' : '保存'}
                      </button>
                      <button className="btn-ghost sm" onClick={() => setEditing(null)} disabled={saveBusy}>
                        取消
                      </button>
                      <span className="settings-hint">仅修改元数据（重命名归档文件），不改动文件内容</span>
                    </div>
                    <div className="settings-hint em-preview">保存后文件名为：{editPreviewName}</div>
                  </div>
                ) : (
                  <div className="preview-meta">
                    {selectedMeta.customer && <span className="chip">客户：{selectedMeta.customer}</span>}
                    <span className="chip">项目：{selectedMeta.project || '—'}</span>
                    {selectedMeta.caeItem && <span className="chip">仿真项目：{selectedMeta.caeItem}</span>}
                    {selectedMeta.flow && (
                      <span className="chip">
                        流量：{selectedMeta.flow} {selectedMeta.flowUnit}
                      </span>
                    )}
                    <span className="chip">产品：{selectedMeta.product || '—'}</span>
                    <span className="chip">版本：{selectedMeta.version || '—'}</span>
                    <span className="chip">日期：{selectedMeta.date || '—'}</span>
                    <span className="chip">
                      {(selected.size / 1024).toFixed(1)} KB · {new Date(selected.mtime).toLocaleString('zh-CN')}
                    </span>
                    {!IS_STANDARD && (
                      <button className="btn-ghost sm" onClick={() => startEditFor(selected)}>
                        编辑元数据
                      </button>
                    )}
                  </div>
                )}
              </div>

              {isPdf(selected) ? (
                <PdfViewer filePath={selected.fullPath} />
              ) : (
                <div className="preview-empty">
                  <div className="pe-icon">📄</div>
                  <div className="pe-title">该文件暂不支持内置预览</div>
                  <div className="pe-sub">双击列表行可用本地软件打开查看</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
