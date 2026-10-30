import { useCallback, useEffect, useState } from 'react';
import { api, type CtrUser } from '../api';
import { UNC_CALC_LIB } from '../report/db';

interface Props { user: CtrUser; }
type Tab = 'theory' | 'design' | 'fmea';

interface DbFile { name: string; size: number; mtime: string; fullPath: string; }

function parseArchiveName(name: string) {
  const stem = name.replace(/\.xlsx$/i, '');
  const parts = stem.split('+');
  return { project: parts[0] || '', product: parts[1] || '', version: parts[2] || '', date: parts[3] || '' };
}

/** 知识经验库：三个子库的浏览与文件卡片，结构与产品数据库页同构 */
export function KnowledgeBasePage({ user }: Props) {
  const [tab, setTab] = useState<Tab>('theory');
  const [ping, setPing] = useState<{ reachable: boolean; kbeRoot: string; kbeTheory: string; kbeDesign: string; kbeFmea: string } | null>(null);
  const [files, setFiles] = useState<DbFile[]>([]);
  const [toast, setToast] = useState('');

  /** 双击文件卡片：调用系统默认程序打开原文 */
  const openFile = useCallback(async (f: DbFile) => {
    const res = await api.app.openPath(f.fullPath);
    if (!res.ok) setToast(`无法打开：${res.message || '未知错误'}`);
  }, []);

  const refresh = useCallback(async () => {
    const pingRes = await api.db.ping();
    setPing({
      reachable: pingRes.reachable,
      kbeRoot: pingRes.kbeRoot,
      kbeTheory: pingRes.kbeTheory,
      kbeDesign: pingRes.kbeDesign,
      kbeFmea: pingRes.kbeFmea,
    });
    const res = await api.db.list({ libType: tab });
    if (res.ok) setFiles(res.files || []);
  }, [tab]);

  useEffect(() => { refresh(); }, [refresh]);

  const tabs: { key: Tab; label: string; dir: string }[] = [
    { key: 'theory', label: '理论知识库', dir: ping?.kbeTheory ?? '' },
    { key: 'design', label: '产品设计库', dir: ping?.kbeDesign ?? '' },
    { key: 'fmea', label: 'FMEA 库', dir: ping?.kbeFmea ?? '' },
  ];

  return (
    <div className="db-page">
      <div className="settings-card">
        <h3>知识经验库</h3>
        <div className="kv">
          <span>服务器</span>
          <b>{ping === null ? '检测中…' : ping.reachable ? '可达' : '不可达，请检查网络或 UNC 路径'}</b>
        </div>
        <div className="kv"><span>产品数据库根</span><b style={{ fontSize: 12 }}>{UNC_CALC_LIB.replace(/\\Theoretical Calculation Library$/, '')}</b></div>
        <div className="kv"><span>知识经验库根</span><b style={{ fontSize: 12 }}>{ping?.kbeRoot || '\\\\10.1.1.245\\Knowledge & Experience Base'}</b></div>
        <div className="kv"><span>当前登录</span><b>{user.displayName || user.username}</b></div>
        <div className="db-stats">
          <span className="chip">理论知识库 {tab === 'theory' ? files.length : '—'}</span>
          <span className="chip">产品设计库 {tab === 'design' ? files.length : '—'}</span>
          <span className="chip">FMEA 库 {tab === 'fmea' ? files.length : '—'}</span>
          <button className="btn-ghost sm" onClick={refresh}>刷新</button>
        </div>
      </div>

      <div className="lib-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {ping && (
        <div className="settings-card kv" style={{ marginTop: 12 }}>
          <span>当前库路径</span>
          <b style={{ fontSize: 12, color: 'var(--muted)' }}>{tabs.find((t) => t.key === tab)?.dir}</b>
        </div>
      )}

      <div className="file-list">
        {files.length === 0 && (
          <div className="settings-card">
            <h3>暂无归档文件</h3>
            <p className="settings-hint">
              当前子库还没有内容。产品数据库下的归档路径：
              理论计算 → 计算库；实验测试 → 实验库；可信资产 → 可信资产库。
              本模块先作为知识库根目录浏览入口，后续可按子库类型归档 Word / PDF / Excel 经验文档。
            </p>
          </div>
        )}
        {files.map((f) => {
          const p = parseArchiveName(f.name);
          return (
            <div
              className="settings-card file-card"
              key={f.fullPath}
              title="双击用本地软件打开"
              onDoubleClick={() => openFile(f)}
            >
              <div className="pc-head">
                <h3>{f.name}</h3>
                {p.version && <span className="tag light">{p.version}</span>}
              </div>
              <div className="kv"><span>项目</span><b>{p.project || '—'}</b></div>
              <div className="kv"><span>产品</span><b>{p.product || '—'}</b></div>
              <div className="kv"><span>日期</span><b>{p.date || '—'}</b></div>
              <div className="kv"><span>大小</span><b>{(f.size / 1024).toFixed(1)} KB · {new Date(f.mtime).toLocaleString('zh-CN')}</b></div>
            </div>
          );
        })}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
