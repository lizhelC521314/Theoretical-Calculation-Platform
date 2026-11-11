import { useCallback, useEffect, useState } from 'react';
import { api, type CtrUser } from '../api';
import { UNC_CALC_LIB } from '../report/db';

interface Props { user: CtrUser; }

interface DbFile { name: string; size: number; mtime: string; fullPath: string; }

/** 知识经验库分类：四类文档直接浏览共享目录（型号设计档案已并入产品数据库） */
type KbeCat = 'standards' | 'guidelines' | 'lessons' | 'papers';

const CATS: Array<{ key: KbeCat; label: string; hint: string }> = [
  { key: 'standards', label: '标准&规范', hint: '国家 / 行业 / 企业标准与规范原文' },
  { key: 'guidelines', label: '设计指南', hint: '设计手册、选型指南与设计方法' },
  { key: 'lessons', label: '经验教训', hint: '问题复盘、失效案例与改进措施' },
  { key: 'papers', label: '论文/专利', hint: '技术论文与专利文献' },
];

/** 知识经验库：标准&规范 / 设计指南 / 经验教训 / 论文专利（共享目录浏览） */
export function KnowledgeBasePage({ user }: Props) {
  const [cat, setCat] = useState<KbeCat>('standards');
  const [ping, setPing] = useState<{ reachable: boolean; kbeRoot: string } | null>(null);
  const [dir, setDir] = useState('');
  const [missing, setMissing] = useState(false);
  const [files, setFiles] = useState<DbFile[]>([]);
  const [toast, setToast] = useState('');

  /** 双击文件卡片：调用系统默认程序打开原文 */
  const openFile = useCallback(async (f: DbFile) => {
    const res = await api.app.openPath(f.fullPath);
    if (!res.ok) setToast(`无法打开：${res.message || '未知错误'}`);
  }, []);

  const refresh = useCallback(async () => {
    const pingRes = await api.db.ping();
    setPing({ reachable: pingRes.reachable, kbeRoot: pingRes.kbeRoot });

    const res = await api.kbe.browse({ category: cat });
    setDir(res.dir || '');
    setMissing(res.exists === false);
    setFiles(res.ok ? res.files || [] : []);
    if (!res.ok) setToast(res.message || '无法读取该分类目录');
  }, [cat]);

  useEffect(() => { refresh(); }, [refresh]);

  const current = CATS.find((c) => c.key === cat)!;

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
          <span className="chip">{current.label} {files.length}</span>
          <button className="btn-ghost sm" onClick={refresh}>刷新</button>
        </div>
      </div>

      <div className="lib-tabs">
        {CATS.map((c) => (
          <button
            key={c.key}
            className={`tab-btn${cat === c.key ? ' active' : ''}`}
            onClick={() => { setCat(c.key); setToast(''); }}
            title={c.hint}
          >
            {c.label}
          </button>
        ))}
      </div>

      {dir && (
        <div className="settings-card kv" style={{ marginTop: 12 }}>
          <span>当前库路径</span>
          <b style={{ fontSize: 12, color: 'var(--muted)' }}>{dir}</b>
        </div>
      )}

      <div className="file-list">
        {files.length === 0 && (
          <div className="settings-card">
            <h3>{missing ? '目录尚未创建' : '暂无文件'}</h3>
            <p className="settings-hint">
              {missing
                ? `共享目录可达，但「${current.label}」目录缺失，请管理员在 \\\\10.1.1.245\\Knowledge & Experience Base 下创建后刷新。`
                : `「${current.label}」还没有内容。${current.hint}；把文件放入该目录后点「刷新」即可在此浏览，双击用本地软件打开。`}
            </p>
          </div>
        )}
        {files.map((f) => {
          const ext = f.name.includes('.') ? f.name.split('.').pop()!.toUpperCase() : '';
          return (
            <div
              className="settings-card file-card"
              key={f.fullPath}
              title="双击用本地软件打开"
              onDoubleClick={() => openFile(f)}
            >
              <div className="pc-head">
                <h3>{f.name}</h3>
                {ext && <span className="tag light">{ext}</span>}
              </div>
              <div className="kv"><span>大小</span><b>{(f.size / 1024).toFixed(1)} KB · {new Date(f.mtime).toLocaleString('zh-CN')}</b></div>
            </div>
          );
        })}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
