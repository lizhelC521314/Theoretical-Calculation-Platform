import { useState } from 'react';
import { api, isDesktop, type CtrUser } from '../api';
import { BRAND } from '../branding';

interface Props {
  onLogin: (user: CtrUser) => void;
}

/** 登录页：左侧品牌区，右侧账号登录 / 首次初始化管理员 */
export function LoginPage({ onLogin }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setMsg('');
    try {
      if (mode === 'register') {
        const reg = await api.auth.register({ username, password, displayName });
        if (!reg.ok) {
          setMsg(reg.message ?? '注册失败');
          return;
        }
        const login = await api.auth.login({ username, password });
        if (login.ok && login.user) onLogin(login.user);
        return;
      }
      const res = await api.auth.login({ username, password });
      if (!res.ok || !res.user) {
        setMsg(res.message ?? '登录失败');
        return;
      }
      onLogin(res.user);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-brand">
        <img className="brand-logo-lg" src={BRAND.logoUrl} alt="公司 LOGO" />
        <h1>{BRAND.companyName}</h1>
        <h2>{BRAND.productName}</h2>
        <p className="brand-desc">
          面向汽车零部件设计与 CAE 工程师的数字设计平台，集成流体、结构、NVH、热与电池包领域的工程公式，
          为产品性能与可靠性设计提供快速、可追溯的理论计算依据。
        </p>
        <ul className="brand-points">
          <li>公式与计算内核集中管理，界面自动生成</li>
          <li>每个公式附理论公式、示意图与适用条件</li>
          <li>计算结果本地存档，支持导出计算书</li>
        </ul>
        {BRAND.logoIsPlaceholder && (
          <div className="brand-placeholder-note">当前 LOGO 与公司名称为占位内容，交付前替换 src/branding.ts 与 public/logo.svg</div>
        )}
      </div>

      <div className="login-panel">
        <div className="login-card">
          <h3>{mode === 'login' ? '用户登录' : '创建账号'}</h3>
          <p className="login-sub">
            {mode === 'login'
              ? '请使用公司分配的账号登录'
              : '首次使用请创建管理员账号（密码至少 6 位）'}
          </p>

          <label className="field">
            <span>用户名</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              autoFocus
            />
          </label>
          {mode === 'register' && (
            <label className="field">
              <span>姓名</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="真实姓名（用于计算记录署名）"
              />
            </label>
          )}
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>

          {msg && <div className="login-error">{msg}</div>}
          {!isDesktop && (
            <div className="login-hint">浏览器调试模式：demo / 123456</div>
          )}

          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? '处理中…' : mode === 'login' ? '登录' : '创建并登录'}
          </button>

          <button
            className="btn-link"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setMsg('');
            }}
          >
            {mode === 'login' ? '首次使用，创建管理员账号' : '已有账号，返回登录'}
          </button>

          <div className="login-footer">{BRAND.copyright}</div>
        </div>
      </div>
    </div>
  );
}
