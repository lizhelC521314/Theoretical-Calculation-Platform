import { useEffect, useState } from 'react';
import { api, type CtrUser, type LicenseInfo } from '../api';
import { BRAND } from '../branding';
import { EDITION_LABEL } from '../edition';

export function SettingsPage({ user }: { user: CtrUser }) {
  const [lic, setLic] = useState<LicenseInfo | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [appInfo, setAppInfo] = useState<{ version: string; dataDir: string } | null>(null);

  useEffect(() => {
    api.license.info().then(setLic);
    api.app.info().then(setAppInfo);
  }, []);

  const activate = async () => {
    const res = await api.license.activate(code);
    setMsg(res.ok ? '授权成功' : res.message ?? '授权失败');
    if (res.ok) api.license.info().then(setLic);
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
        <p className="settings-hint">
          离线授权：将本机机器码提供给管理员，换取对应授权码后在本页输入即可激活。授权与设备绑定，无需联网。
        </p>
      </section>

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
