import { useEffect, useState } from 'react';
import { api, type BackupFile, type CtrUser, type LicenseInfo } from '../api';
import { BRAND } from '../branding';
import { EDITION_LABEL, IS_STANDARD } from '../edition';

export function SettingsPage({ user }: { user: CtrUser }) {
  const [lic, setLic] = useState<LicenseInfo | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [appInfo, setAppInfo] = useState<{ version: string; dataDir: string } | null>(null);

  // 本地数据备份
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');

  const loadBackups = async () => {
    try {
      const res = await api.maintenance.backups();
      setBackups(res.files || []);
    } catch (e) {
      setBackupMsg(`读取备份列表失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const backupNow = async () => {
    setBackupBusy(true);
    setBackupMsg('');
    try {
      const res = await api.maintenance.backupNow();
      setBackupMsg(res.ok ? '备份完成' : res.message || '备份失败');
      await loadBackups();
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreBackup = async (name: string) => {
    if (!window.confirm(`确定用「${name}」覆盖当前数据？\n恢复前会自动备份当前数据，恢复后需重启软件。`)) return;
    setBackupBusy(true);
    setBackupMsg('');
    try {
      const res = await api.maintenance.restore(name);
      setBackupMsg(res.ok ? res.message || '恢复完成，请重启软件' : res.message || '恢复失败');
      await loadBackups();
    } finally {
      setBackupBusy(false);
    }
  };

  const sizeText = (n: number) =>
    n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

  // 审批服务端（李华东电脑）状态
  const [approvalStatus, setApprovalStatus] = useState<{
    enabled: boolean;
    port: number;
    isApprovalAdmin: boolean;
    serverRunning: boolean;
    ips: string[];
    clientHost: string;
    clientPort: string;
    /** 解密账号默认 IP（用于「恢复默认」） */
    defaultHost: string;
    tokenTtlMin: number;
  } | null>(null);
  const [serverMsg, setServerMsg] = useState('');

  // 审批客户端（标准版导出方）配置
  const [clientHost, setClientHost] = useState('');
  const [clientPort, setClientPort] = useState('39125');
  const [clientMsg, setClientMsg] = useState('');
  const [testing, setTesting] = useState(false);

  // 手动解密
  const [manualToken, setManualToken] = useState('');
  const [decMsg, setDecMsg] = useState('');
  const [decrypting, setDecrypting] = useState(false);

  // 待办审批（李华东电脑）
  const [pending, setPending] = useState<
    { requestId: string; fileName: string; operator: string; createdAt: number }[]
  >([]);
  const [pendingRefresh, setPendingRefresh] = useState(0);

  useEffect(() => {
    api.license.info().then(setLic);
    api.app.info().then(setAppInfo);
    if (IS_STANDARD) {
      api.approval.status(user.username).then((s) => {
        setApprovalStatus(s);
        setClientHost(s.clientHost);
        setClientPort(String(s.clientPort || 39125));
      });
    }
  }, [user.username]);

  useEffect(() => {
    if (IS_STANDARD && approvalStatus?.isApprovalAdmin && approvalStatus.serverRunning) {
      api.approval.listPending().then(setPending).catch(() => {});
    }
  }, [pendingRefresh, approvalStatus?.serverRunning, approvalStatus?.isApprovalAdmin]);

  // 审批服务允许访问的网段
  const [cidrText, setCidrText] = useState('');
  const [cidrMsg, setCidrMsg] = useState('');

  useEffect(() => {
    api.approval
      .getServerConfig()
      .then((res) => {
        if (res.ok) setCidrText(res.allowedCidrs || res.effectiveCidrs.join(','));
      })
      .catch(() => {});
  }, []);

  const saveCidrs = async () => {
    setCidrMsg('');
    const res = await api.approval.setAllowedCidrs({ cidrs: cidrText });
    if (res.ok) {
      setCidrText((res.cidrs || []).join(','));
      setCidrMsg(`已保存并生效：${(res.cidrs || []).join(', ')}`);
    } else {
      setCidrMsg(res.message || '保存失败');
    }
  };

  // 审批服务运行期间每 3 秒自动刷新待办，李华东无需手动点「刷新待办」
  useEffect(() => {
    if (!IS_STANDARD || !approvalStatus?.isApprovalAdmin || !approvalStatus?.serverRunning) return;
    const timer = window.setInterval(() => {
      api.approval.listPending().then(setPending).catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [approvalStatus?.isApprovalAdmin, approvalStatus?.serverRunning]);

  const activate = async () => {
    const res = await api.license.activate(code);
    setMsg(res.ok ? '授权成功' : res.message ?? '授权失败');
    if (res.ok) api.license.info().then(setLic);
  };

  const startServer = async () => {
    setServerMsg('启动中...');
    const res = await api.approval.startServer();
    if (res.ok) {
      setServerMsg(`审批服务已启动（端口 ${res.port}）。局域网 IP：${res.ips?.join(', ') ?? '—'}`);
      api.approval.status(user.username).then(setApprovalStatus);
      setPendingRefresh((v) => v + 1);
    } else {
      setServerMsg(res.message ?? '审批服务启动失败');
    }
  };

  const stopServer = async () => {
    const res = await api.approval.stopServer();
    setServerMsg(res.ok ? '审批服务已停止' : (res.message ?? '停止失败'));
    api.approval.status(user.username).then(setApprovalStatus);
  };

  const saveClient = async () => {
    if (!clientHost.trim()) {
      setClientMsg('审批服务 IP 不能为空');
      return;
    }
    const res = await api.approval.saveClientConfig({ hostname: clientHost.trim(), port: Number(clientPort) });
    setClientMsg(res.ok ? '审批服务地址已保存' : (res.message ?? '保存失败'));
  };

  /** 测试与李华东审批服务的连通性（不影响已保存配置） */
  const testConnection = async () => {
    if (!clientHost.trim()) {
      setClientMsg('请先填写李华东电脑的 IP 地址');
      return;
    }
    setTesting(true);
    setClientMsg('正在测试连接…');
    try {
      const res = await api.approval.testConnection({ hostname: clientHost.trim(), port: Number(clientPort) });
      setClientMsg(res.message ?? (res.ok ? '连接成功' : '连接失败'));
    } catch (e) {
      setClientMsg(`测试失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const doDecrypt = async () => {
    if (!manualToken.trim()) {
      setDecMsg('请输入解密令牌');
      return;
    }
    setDecrypting(true);
    setDecMsg('');
    try {
      const res = await api.approval.decryptWithToken({ token: manualToken.trim() });
      if (res.ok) {
        setDecMsg(`已解密：${res.filePath}`);
        setManualToken('');
      } else if (!res.canceled) {
        setDecMsg(res.message ?? '解密失败');
      }
    } catch (e) {
      setDecMsg(`解密失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDecrypting(false);
    }
  };

  const resolveRequest = async (requestId: string, action: 'approve' | 'reject') => {
    const res = await api.approval.resolve({ requestId, action });
    if (res.ok) {
      setPending((list) => list.filter((r) => r.requestId !== requestId));
      setPendingRefresh((v) => v + 1);
    }
  };

  return (
    <div className="settings-page">
      <section className="settings-card">
        <h3>当前用户</h3>
        <div className="kv">
          <span>用户名</span>
          <b>{user.username}</b>
        </div>
        <div className="kv">
          <span>姓名</span>
          <b>{user.displayName}</b>
        </div>
        <div className="kv">
          <span>角色</span>
          <b>{user.role === 'admin' ? '管理员' : '工程师'}</b>
        </div>
        {IS_STANDARD && approvalStatus?.isApprovalAdmin && (
          <p className="settings-hint">您是审批人（李华东），可在本页启动审批服务并处理待办请求。</p>
        )}
      </section>

      <section className="settings-card">
        <h3>软件授权</h3>
        <div className="kv">
          <span>状态</span>
          <b className={lic?.activated ? 'ok' : 'warn'}>
            {lic?.activated ? '已授权' : '未授权（试用模式）'}
          </b>
        </div>
        <div className="kv">
          <span>机器码</span>
          <b className="mono">{lic?.machineCode ?? '读取中…'}</b>
        </div>
        {!lic?.activated && (
          <div className="license-form">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="请输入授权码" />
            <button className="btn-primary sm" onClick={activate}>
              激活
            </button>
          </div>
        )}
        {msg && <div className="license-msg">{msg}</div>}
      </section>

      <section className="settings-card">
        <h3>数据备份</h3>
        <p className="settings-hint">
          每天首次启动自动备份一次本地数据，保留最近 7 天；恢复前会先自动备份当前数据。
        </p>
        <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
          <button className="btn-primary sm" onClick={backupNow} disabled={backupBusy}>
            {backupBusy ? '处理中…' : '立即备份'}
          </button>
          <button className="btn-link" onClick={loadBackups} disabled={backupBusy}>
            刷新列表
          </button>
        </div>
        {backups.length === 0 ? (
          <p className="settings-hint">暂无备份文件</p>
        ) : (
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {backups.map((b) => (
              <div
                key={b.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '5px 0',
                  borderBottom: '1px solid rgba(0,0,0,0.06)',
                }}
              >
                <span className="mono" style={{ flex: 1, fontSize: 12 }}>{b.name}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {sizeText(b.size)} · {new Date(b.mtime).toLocaleString('zh-CN')}
                </span>
                <button className="btn-link" onClick={() => restoreBackup(b.name)} disabled={backupBusy}>
                  恢复
                </button>
              </div>
            ))}
          </div>
        )}
        {backupMsg && <div className="license-msg">{backupMsg}</div>}
      </section>

      {IS_STANDARD && (
        <>
          {/* 审批服务端（仅解密账号李华东可见） */}
          {(!approvalStatus || approvalStatus.isApprovalAdmin) && (
          <section className="settings-card">
            <h3>审批服务（解密端）</h3>
            <div className="kv">
              <span>审批人身份</span>
              <b className={approvalStatus?.isApprovalAdmin ? 'ok' : 'warn'}>
                {approvalStatus?.isApprovalAdmin ? '是（李华东）' : '否，您是普通导出用户'}
              </b>
            </div>
            <div className="kv">
              <span>当前状态</span>
              <b className={approvalStatus?.serverRunning ? 'ok' : 'warn'}>
                {approvalStatus?.serverRunning ? '运行中' : '未启动'}
              </b>
            </div>
            {approvalStatus?.serverRunning && approvalStatus.ips.length > 0 && (
              <div className="kv">
                <span>局域网 IP</span>
                <b className="mono small">{approvalStatus.ips.join(' / ')}</b>
              </div>
            )}
            <div className="kv">
              <span>端口</span>
              <b className="mono">{approvalStatus?.port ?? 39125}</b>
            </div>
            <div className="kv">
              <span>令牌有效期</span>
              <b>{approvalStatus?.tokenTtlMin ?? 5} 分钟</b>
            </div>
            <div className="license-form">
              <input
                value={cidrText}
                onChange={(e) => setCidrText(e.target.value)}
                placeholder="10.1.1.0/24,10.1.2.0/24"
              />
              <button className="btn-secondary sm" onClick={saveCidrs}>
                保存网段
              </button>
            </div>
            <p className="settings-hint">
              仅这些网段的电脑可访问审批服务，多个网段用逗号分隔；保存后立即生效，也会在下次启动时自动套用。
            </p>
            {cidrMsg && <div className="license-msg">{cidrMsg}</div>}
            <div className="license-form">
              {!approvalStatus?.serverRunning ? (
                <button className="btn-primary sm" onClick={startServer}>
                  启动审批服务
                </button>
              ) : (
                <button className="btn-primary sm" onClick={stopServer}>
                  停止审批服务
                </button>
              )}
              {approvalStatus?.serverRunning && (
                <button className="btn-secondary sm" onClick={() => setPendingRefresh((v) => v + 1)}>
                  刷新待办
                </button>
              )}
            </div>
            {serverMsg && <div className="license-msg">{serverMsg}</div>}
            {approvalStatus?.serverRunning && (
              <>
                <h4 style={{ marginTop: 18 }}>待办审批（{pending.length}）</h4>
                {pending.length === 0 ? (
                  <p className="settings-hint">当前没有待审批的导出请求。</p>
                ) : (
                  <table className="kv-table">
                    <thead>
                      <tr>
                        <th>申请用户</th>
                        <th>文件</th>
                        <th>时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((p) => (
                        <tr key={p.requestId}>
                          <td>{p.operator}</td>
                          <td>{p.fileName}</td>
                          <td>{new Date(p.createdAt).toLocaleTimeString()}</td>
                          <td>
                            <button className="btn-primary sm" onClick={() => resolveRequest(p.requestId, 'approve')}>解密</button>
                            <button className="btn-danger sm" onClick={() => resolveRequest(p.requestId, 'reject')} style={{ marginLeft: 6 }}>拒绝</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
            {approvalStatus?.serverRunning && (
              <p className="settings-hint">
                服务监听本机所有网卡，导出方会主动连入（默认地址 {approvalStatus?.clientHost || '10.1.1.246'}:{approvalStatus?.clientPort || 39125}）。
                您无需配置各导出方的 IP。
              </p>
            )}
          </section>
          )}

          {/* 审批客户端（仅导出账号可见） */}
          {approvalStatus && !approvalStatus.isApprovalAdmin && (
          <section className="settings-card">
            <h3>审批客户端（导出方）</h3>
            <p className="settings-hint">
              导出时会向解密账号（李华东）的审批服务发送请求。默认地址已填为 10.1.1.246:39125，
              如无变更可直接使用。
            </p>
            <div className="license-form">
              <input
                value={clientHost}
                onChange={(e) => setClientHost(e.target.value)}
                placeholder="解密账号 IP（默认 10.1.1.246）"
              />
              <input
                value={clientPort}
                onChange={(e) => setClientPort(e.target.value.replace(/\D/g, ''))}
                placeholder="端口（默认 39125）"
              />
              <button className="btn-primary sm" onClick={saveClient}>
                保存配置
              </button>
              <button className="btn-secondary sm" onClick={testConnection} disabled={testing}>
                {testing ? '测试中…' : '测试连接'}
              </button>
              <button
                className="btn-link"
                onClick={() => {
                  setClientHost(approvalStatus?.defaultHost || '10.1.1.246');
                  setClientPort('39125');
                  setClientMsg('已恢复默认地址，记得点「保存配置」');
                }}
              >
                恢复默认
              </button>
            </div>
            {clientMsg && <div className="license-msg">{clientMsg}</div>}
            <p className="settings-hint">
              保存后建议先点「测试连接」，看到“连接成功”再导出。导出期间解密端需已启动审批服务。
            </p>
          </section>
          )}

          {/* 手动令牌解密（备选） */}
          <section className="settings-card">
            <h3>手动令牌解密</h3>
            <p className="settings-hint">
              如果您从李华东处直接拿到了解密令牌（而非通过软件导出流程），可以在此输入令牌解密 .ctre 文件。
            </p>
            <div className="license-form">
              <input
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="解密令牌"
              />
              <button className="btn-primary sm" onClick={doDecrypt} disabled={decrypting}>
                {decrypting ? '解密中…' : '选择文件并解密'}
              </button>
            </div>
            {decMsg && <div className="license-msg">{decMsg}</div>}
            <p className="settings-hint">令牌 5 分钟内有效，过期或被篡改的令牌无法解密。</p>
          </section>
        </>
      )}

      <section className="settings-card">
        <h3>关于</h3>
        <div className="kv">
          <span>产品名称</span>
          <b>{BRAND.productName}</b>
        </div>
        <div className="kv">
          <span>版本类型</span>
          <b>{EDITION_LABEL}</b>
        </div>
        <div className="kv">
          <span>版本</span>
          <b>{appInfo?.version ?? BRAND.version}</b>
        </div>
        <div className="kv">
          <span>公司</span>
          <b>{BRAND.companyName}</b>
        </div>
        <div className="kv">
          <span>数据目录</span>
          <b className="mono small">{appInfo?.dataDir ?? '—'}</b>
        </div>
        <p className="settings-hint">{BRAND.copyright}</p>
      </section>
    </div>
  );
}
