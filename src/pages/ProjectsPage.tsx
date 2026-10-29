import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, composeProjectName, type CtrUser, type HistoryEntry, type Project } from '../api';
import { archiveSummaryExcel, exportReport, type ReportFormat } from '../report/exportReport';

interface Props {
  user: CtrUser;
  projects: Project[];
  currentProject: Project | null;
  onSelectProject: (p: Project | null) => void;
  onProjectsChange: () => void;
}

/** 项目管理：新建 / 切换当前项目 / 删除 / 按项目导出设计计算书 */
export function ProjectsPage({ user, projects, currentProject, onSelectProject, onProjectsChange }: Props) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [customer, setCustomer] = useState('');
  const [code, setCode] = useState('');
  const [version, setVersion] = useState('V1.0');
  const [product, setProduct] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState('');

  const loadHistory = useCallback(async () => setHistory(await api.history.list(user.id)), [user.id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const countOf = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const h of history) m.set(h.projectId, (m.get(h.projectId) ?? 0) + 1);
    return m;
  }, [history]);

  const showToast = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 2400);
  };

  const create = async () => {
    setError('');
    const res = await api.project.create({ userId: user.id, customer, code, version, product, description });
    if (!res.ok || !res.project) {
      setError(res.message ?? '创建失败');
      return;
    }
    setCustomer('');
    setCode('');
    setVersion('V1.0');
    setProduct('');
    setDescription('');
    onProjectsChange();
    onSelectProject(res.project);
    showToast(`项目「${res.project.name}」已创建并设为当前项目`);
  };

  const remove = async (p: Project) => {
    if (!window.confirm(`确定删除项目「${p.name}」？其下 ${countOf.get(p.id) ?? 0} 条计算记录将转为未绑定状态。`)) return;
    await api.project.remove(p.id);
    if (currentProject?.id === p.id) onSelectProject(null);
    onProjectsChange();
    loadHistory();
    showToast('项目已删除');
  };

  const doExport = async (project: Project | null, format: ReportFormat) => {
    const records = history.filter((h) => h.projectId === (project?.id ?? null));
    if (records.length === 0) {
      showToast('该项目下暂无计算记录，无法导出');
      return;
    }
    setExporting(`${project?.id ?? 'temp'}-${format}`);
    try {
      const res = await exportReport(records, project, user, format);
      if (res.ok) showToast(format === 'docx' ? 'Word 计算书已导出' : 'PDF 计算书已导出');
    } finally {
      setExporting('');
    }
  };

  /** 归档计算汇总 Excel 到服务器产品数据库 */
  const doArchive = async (project: Project | null) => {
    const records = history.filter((h) => h.projectId === (project?.id ?? null));
    if (records.length === 0) {
      showToast('该项目下暂无计算记录');
      return;
    }
    setExporting(`${project?.id ?? 'temp'}-archive`);
    try {
      const res = await archiveSummaryExcel(records, project, user);
      if (res.ok) showToast('已归档到产品数据库');
      else showToast(`归档失败：${res.message || '请检查 UNC 路径'}`);
    } finally {
      setExporting('');
    }
  };

  const tempCount = countOf.get(null) ?? 0;

  return (
    <div className="projects-page">
      <div className="settings-card project-create">
        <h3>新建项目</h3>
        <label className="field">
          <span>客户 *</span>
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="如：长安汽车" />
        </label>
        <label className="field">
          <span>项目代号 *</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如：CS75-2025" />
        </label>
        <div className="project-preview">
          <span className="pp-label">项目名称：</span>
          <span className="pp-name">{composeProjectName(customer, code) || '（请填写客户与项目代号）'}</span>
        </div>
        <label className="field">
          <span>产品名称</span>
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="如：空气滤清器总成" />
        </label>
        <label className="field">
          <span>产品版本</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="如：V1.0" />
        </label>
        <label className="field">
          <span>项目说明</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="选填" />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button className="btn-primary sm" onClick={create} disabled={!customer.trim() || !code.trim()}>
          创建并设为当前项目
        </button>
        <p className="settings-hint">创建项目后，所有「保存到记录」的计算会自动绑定当前项目；未选择项目时的计算归入临时计算。</p>
      </div>

      <div className="project-list">
        {projects.map((p) => {
          const n = countOf.get(p.id) ?? 0;
          const active = currentProject?.id === p.id;
          return (
            <div className={active ? 'settings-card project-card active' : 'settings-card project-card'} key={p.id}>
              <div className="pc-head">
                <h3>{p.name}</h3>
                {p.version && <span className="tag light">{p.version}</span>}
                {active && <span className="tag domain">当前项目</span>}
              </div>
              {p.product && <div className="kv"><span>产品名称</span><b>{p.product}</b></div>}
              <div className="kv"><span>计算记录</span><b>{n} 条</b></div>
              <div className="kv"><span>创建时间</span><b>{new Date(p.createdAt).toLocaleDateString('zh-CN')}</b></div>
              {p.description && <p className="settings-hint">{p.description}</p>}
              <div className="pc-actions">
                {!active && (
                  <button className="btn-ghost" onClick={() => onSelectProject(p)}>
                    设为当前项目
                  </button>
                )}
                <button className="btn-primary sm" disabled={n === 0 || exporting === `${p.id}-docx`} onClick={() => doExport(p, 'docx')}>
                  导出 Word
                </button>
                <button className="btn-primary sm" disabled={n === 0 || exporting === `${p.id}-pdf`} onClick={() => doExport(p, 'pdf')}>
                  导出 PDF
                </button>
                <button className="btn-ghost" disabled={n === 0 || exporting === `${p.id}-archive`} onClick={() => doArchive(p)}>
                  归档到数据库
                </button>
                <button className="btn-link danger" onClick={() => remove(p)}>
                  删除
                </button>
              </div>
            </div>
          );
        })}

        <div className="settings-card project-card">
          <div className="pc-head">
            <h3>临时计算</h3>
            {!currentProject && <span className="tag">当前状态</span>}
          </div>
          <div className="kv"><span>未绑定项目的记录</span><b>{tempCount} 条</b></div>
          <p className="settings-hint">未建立项目时的计算记录归入此处，导出文件名为「日期 + 临时计算书」。</p>
          <div className="pc-actions">
            {currentProject && (
              <button className="btn-ghost" onClick={() => onSelectProject(null)}>
                切换为临时计算
              </button>
            )}
            <button className="btn-primary sm" disabled={tempCount === 0 || exporting === 'temp-docx'} onClick={() => doExport(null, 'docx')}>
              导出 Word
            </button>
            <button className="btn-primary sm" disabled={tempCount === 0 || exporting === 'temp-pdf'} onClick={() => doExport(null, 'pdf')}>
              导出 PDF
            </button>
            <button className="btn-ghost" disabled={tempCount === 0 || exporting === 'temp-archive'} onClick={() => doArchive(null)}>
              归档到数据库
            </button>
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
