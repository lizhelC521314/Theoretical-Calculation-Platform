import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CtrUser } from '../api';
import { parseArchiveName } from '../report/db';

interface Props {
  user: CtrUser;
}

interface DbFile {
  name: string;
  size: number;
  mtime: string;
  fullPath: string;
}

interface TestItem {
  name: string;
  conditionText: string;
  resultText: string;
}

/** 解析实验测试表 xlsx 的行，得到测试项列表 */
function parseTestRows(rows: unknown[][]): TestItem[] {
  if (!Array.isArray(rows) || rows.length <= 3) return [];
  const rows2 = rows.slice(3);
  const out: TestItem[] = [];
  let curName = '';
  let curConds: string[] = [];
  let curResults: string[] = [];

  const flush = () => {
    if (!curName) return;
    out.push({
      name: curName,
      conditionText: curConds.join('；'),
      resultText: curResults.join('；'),
    });
  };

  for (const r of rows2) {
    const cells = (r || []).map((c) => (c == null ? '' : String(c)));
    const [, name, cName, cVal, rName, rVal] = cells;
    if (name) {
      flush();
      curName = name;
      curConds = cName && cVal ? [`${cName}=${cVal}`] : [];
      curResults = rName && rVal ? [`${rName}=${rVal}`] : [];
    } else {
      if (cName && cVal) curConds.push(`${cName}=${cVal}`);
      if (rName && rVal) curResults.push(`${rName}=${rVal}`);
    }
  }
  flush();
  return out;
}

function isPdf(f: DbFile): boolean {
  return /\.pdf$/i.test(f.name);
}

export function TestsSearchPage({ user: _user }: Props) {
  const [files, setFiles] = useState<DbFile[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<DbFile | null>(null);
  const [items, setItems] = useState<TestItem[]>([]);
  const [pdfText, setPdfText] = useState('');
  const [pdfFileUrl, setPdfFileUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [readBusy, setReadBusy] = useState(false);
  const [error, setError] = useState('');

  // 列表区 / 预览区 高度比例（0.15 ~ 0.85，默认 0.4）
  const [listRatio, setListRatio] = useState<number>(() => {
    const v = window.localStorage.getItem('ctr.searchListRatio');
    const n = v ? Number(v) : 0.4;
    return Number.isFinite(n) && n >= 0.15 && n <= 0.85 ? n : 0.4;
  });

  useEffect(() => {
    window.localStorage.setItem('ctr.searchListRatio', String(listRatio));
  }, [listRatio]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const ping = await api.db.ping();
      setReachable(ping.reachable);
      const res = await api.db.list({ libType: 'test' });
      if (res.ok) setFiles(res.files || []);
      else setError(res.message || '读取实验库失败');
    } catch (e) {
      setError(`读取实验库失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return files;
    return files.filter((f) => {
      const p = parseArchiveName(f.name);
      return (
        f.name.toLowerCase().includes(k) ||
        p.customer.toLowerCase().includes(k) ||
        p.project.toLowerCase().includes(k) ||
        p.product.toLowerCase().includes(k) ||
        p.version.toLowerCase().includes(k)
      );
    });
  }, [files, keyword]);

  const xlsxCount = files.filter((f) => !isPdf(f)).length;
  const pdfCount = files.filter((f) => isPdf(f)).length;

  // 预览请求序号：防止快速切换行时，较慢的旧请求覆盖新选中的内容（"选中后不能立即显示"的根因）
  const reqSeq = useRef(0);

  const selectFile = useCallback(async (f: DbFile) => {
    const seq = ++reqSeq.current;
    setSelected(f);
    setItems([]);
    setPdfText('');
    setPdfFileUrl('');
    setError('');
    setReadBusy(true);
    const stale = () => seq !== reqSeq.current;
    try {
      if (isPdf(f)) {
        // 1) 优先尝试提取文字层（文字版 PDF）
        const textRes = await api.pdf.extractText(f.fullPath);
        if (stale()) return;
        const hasText = textRes.ok && typeof textRes.text === 'string' && textRes.text.trim().length > 0;
        if (hasText) {
          setPdfText(textRes.text!);
        } else {
          // 2) 文字层为空 → 扫描版/图片型 PDF → 主进程拷贝到临时目录返回 file:// URL
          const dataRes = await api.db.pdfData(f.fullPath);
          if (stale()) return;
          if (dataRes.ok && dataRes.fileUrl) {
            setPdfFileUrl(dataRes.fileUrl);
          } else {
            setError(`PDF 无法预览：${dataRes.message || textRes.message || '文件读取失败'}`);
          }
        }
      } else {
        // XLSX：db:read 解析 Excel 行 → parseTestRows 还原测试项
        const res = await api.db.read({ fullPath: f.fullPath });
        if (stale()) return;
        if (res.ok) {
          setItems(parseTestRows(res.rows || []));
        } else {
          setError(`实验测试表读取失败：${res.message || '无法读取'}`);
        }
      }
    } catch (e) {
      if (!stale()) setError(`读取失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (!stale()) setReadBusy(false);
    }
  }, []);

  /** 双击：调用系统默认程序（如 Acrobat / Excel / WPS）打开原文 */
  const openFile = useCallback(async (f: DbFile) => {
    const res = await api.app.openPath(f.fullPath);
    if (!res.ok) setError(`无法用本地程序打开：${res.message || '未知错误'}`);
  }, []);

  /** 删除归档报告：二次确认 → 主进程删除 → 刷新列表并清理选中态 */
  const removeFile = useCallback(
    async (f: DbFile) => {
      if (!window.confirm(`确定删除该实验报告吗？\n\n${f.name}\n\n删除后无法恢复。`)) return;
      setBusy(true);
      setError('');
      try {
        const res = await api.db.remove({ fullPath: f.fullPath });
        if (res.ok) {
          if (selected?.fullPath === f.fullPath) {
            reqSeq.current += 1; // 使进行中的预览请求失效
            setSelected(null);
            setItems([]);
            setPdfText('');
            setPdfFileUrl('');
            setReadBusy(false);
          }
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
  const handleListResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = (e.currentTarget.parentElement as HTMLElement) || null;
    if (!container) return;
    const startY = e.clientY;
    const startRatio = listRatio;
    const startH = container.getBoundingClientRect().height;
    const minR = 0.15, maxR = 0.85;
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
  }, [listRatio]);

  const selectedMeta = selected ? parseArchiveName(selected.name) : null;
  const selectedIsPdf = selected ? isPdf(selected) : false;

  return (
    <div className="test-search">
      <div className="settings-card">
        <div className="ts-head">
          <h3>实验报告检索</h3>
          <div className="ts-status">
            <span>
              服务器状态：
              {reachable === null ? '检测中…' : reachable ? (
                <b className="ok">可达</b>
              ) : (
                <b className="warn">不可达（浏览器调试模式无法访问 UNC 路径）</b>
              )}
            </span>
            <span className="chip">XLSX {xlsxCount}</span>
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
            placeholder="输入客户 / 项目 / 产品 / 版本 / 文件名 关键字过滤"
          />
          {keyword && (
            <button className="btn-link" onClick={() => setKeyword('')}>
              清除
            </button>
          )}
          <span className="lib-count">筛选结果 {filtered.length} 份 · 双击行可用本地软件打开</span>
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
                <th style={{ width: '14%' }}>客户</th>
                <th style={{ width: '14%' }}>项目</th>
                <th style={{ width: '12%' }}>产品</th>
                <th style={{ width: '7%' }}>版本</th>
                <th style={{ width: '9%' }}>日期</th>
                <th style={{ width: '9%' }}>大小</th>
                <th>完整文件名</th>
                <th style={{ width: 56 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const p = parseArchiveName(f.name);
                const isP = isPdf(f);
                const active = selected?.fullPath === f.fullPath;
                return (
                  <tr
                    key={f.fullPath}
                    className={active ? 'active' : ''}
                    onClick={() => {
                      if (selected?.fullPath !== f.fullPath) selectFile(f);
                    }}
                    onDoubleClick={() => openFile(f)}
                    title="单击预览，双击用本地软件打开"
                  >
                    <td>
                      {isP ? (
                        <span className="type-badge type-pdf">PDF</span>
                      ) : (
                        <span className="type-badge type-xlsx">XLSX</span>
                      )}
                    </td>
                    <td>{p.customer || '—'}</td>
                    <td>{p.project || '—'}</td>
                    <td>{p.product || '—'}</td>
                    <td>{p.version || '—'}</td>
                    <td>{p.date || '—'}</td>
                    <td>{(f.size / 1024).toFixed(1)} KB</td>
                    <td className="mono">{f.name}</td>
                    <td className="center">
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
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="center settings-hint">
                    {files.length === 0 ? '实验库暂无归档报告，请先在「实验报告导入」模块归档' : '无匹配结果'}
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
              <div className="pe-title">从上方列表选中一份实验报告</div>
              <div className="pe-sub">
                点击列表行即可预览。文字版 PDF 显示文字层内容，图片版（扫描件）PDF 显示原文页面，XLSX 归档解析测试项明细。
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
                <div className="preview-meta">
                  {selectedMeta.customer && <span className="chip">客户：{selectedMeta.customer}</span>}
                  <span className="chip">项目：{selectedMeta.project || '—'}</span>
                  <span className="chip">产品：{selectedMeta.product || '—'}</span>
                  <span className="chip">版本：{selectedMeta.version || '—'}</span>
                  <span className="chip">日期：{selectedMeta.date || '—'}</span>
                  <span className="chip">
                    {(selected.size / 1024).toFixed(1)} KB · {new Date(selected.mtime).toLocaleString('zh-CN')}
                  </span>
                </div>
              </div>

              {readBusy ? (
                <div className="preview-loading">
                  {selectedIsPdf ? '正在从 PDF 提取文字内容…' : '正在读取实验测试表…'}
                </div>
              ) : selectedIsPdf ? (
                pdfText ? (
                  <pre className="pdf-preview">{pdfText}</pre>
                ) : pdfFileUrl ? (
                  <iframe
                    className="pdf-frame"
                    src={pdfFileUrl}
                    title={selected.name}
                  />
                ) : (
                  <div className="preview-empty">
                    <div className="pe-icon">📄</div>
                    <div className="pe-title">该 PDF 无法预览</div>
                    <div className="pe-sub">
                      {error || '文件读取失败，请检查服务器连通性或文件权限。'}
                    </div>
                  </div>
                )
              ) : items.length === 0 ? (
                <div className="preview-empty">
                  <div className="pe-icon">📋</div>
                  <div className="pe-title">该报告未解析到测试项</div>
                  <div className="pe-sub">可能是 Excel 格式与预期不符（需要前 3 行信息行 + 表头）</div>
                </div>
              ) : (
                <table className="test-table">
                  <thead>
                    <tr>
                      <th style={{ width: 56 }}>序号</th>
                      <th style={{ width: '24%' }}>测试项目</th>
                      <th>测试条件</th>
                      <th>测试结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i}>
                        <td className="center">{i + 1}</td>
                        <td className="read-only">{it.name}</td>
                        <td className="read-only">{it.conditionText || '—'}</td>
                        <td className="read-only">{it.resultText || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
