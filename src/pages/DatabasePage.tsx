import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CtrUser } from '../api';
import { UNC_CALC_LIB, UNC_TEST_LIB, UNC_TRUSTED, buildTrustedXlsxBase64, extractKeywords, parseArchiveName, productKey, trustedFileName } from '../report/db';

interface Props {
  user: CtrUser;
}

type Tab = 'calc' | 'test' | 'trusted';

interface DbFile {
  name: string;
  size: number;
  mtime: string;
  fullPath: string;
}

/** 从归档 xlsx 的表格行中解析出"计算题目 / 输入参数 / 结果"三元组（跳过前 3 行信息与表头） */
function parseCalcRows(rows: unknown[][]): { title: string; params: string; result: string; keywords: string[] }[] {
  if (!Array.isArray(rows) || rows.length <= 3) return [];
  const rows2 = rows.slice(3); // 跳过信息行和表头
  const out: { title: string; params: string; result: string; keywords: string[] }[] = [];
  let curTitle = '';
  let curParams: string[] = [];
  let curResultName = '';
  let curResultValue = '';

  const flush = () => {
    if (!curTitle) return;
    out.push({
      title: curTitle,
      params: curParams.join('；'),
      result: curResultName && curResultValue ? `${curResultName}=${curResultValue}` : curResultValue || '',
      keywords: extractKeywords(curTitle),
    });
  };

  for (const r of rows2) {
    const cells = (r || []).map((c) => (c == null ? '' : String(c)));
    const [no, title, pName, pVal, rName, rVal] = cells;
    if (no || title) {
      flush();
      curTitle = title;
      curParams = pName && pVal ? [`${pName}=${pVal}`] : [];
      curResultName = rName;
      curResultValue = rVal;
    } else {
      if (pName && pVal) curParams.push(`${pName}=${pVal}`);
      if (rName) curResultName = rName;
      if (rVal) curResultValue = rVal;
    }
  }
  flush();
  return out;
}

/** 解析实验测试表，得到测试项列表 */
function parseTestRows(rows: unknown[][]): { name: string; conditionText: string; resultText: string; keywords: string[] }[] {
  if (!Array.isArray(rows) || rows.length <= 3) return [];
  const rows2 = rows.slice(3);
  const out: { name: string; conditionText: string; resultText: string; keywords: string[] }[] = [];
  let curName = '';
  let curConds: string[] = [];
  let curResults: string[] = [];

  const flush = () => {
    if (!curName) return;
    out.push({
      name: curName,
      conditionText: curConds.join('；'),
      resultText: curResults.join('；'),
      keywords: extractKeywords(curName),
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

/** 数据库模块：UNC 状态、三大库列表、可信资产生成 */
export function DatabasePage({ user }: Props) {
  const [tab, setTab] = useState<Tab>('calc');
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [calcFiles, setCalcFiles] = useState<DbFile[]>([]);
  const [testFiles, setTestFiles] = useState<DbFile[]>([]);
  const [trustedFiles, setTrustedFiles] = useState<DbFile[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const showToast = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 2600);
  };

  const refresh = useCallback(async () => {
    const ping = await api.db.ping();
    setReachable(ping.reachable);
    const [c, t, tr] = await Promise.all([
      api.db.list({ libType: 'calc' }),
      api.db.list({ libType: 'test' }),
      api.db.list({ libType: 'trusted' }),
    ]);
    if (c.ok) setCalcFiles(c.files || []);
    if (t.ok) setTestFiles(t.files || []);
    if (tr.ok) setTrustedFiles(tr.files || []);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /** 从归档文件名生成 productKey，跳过 PDF（仅 xlsx 可用于可信资产匹配） */
  const genKeys = useMemo(
    () => ({
      calc: calcFiles.map((f) => {
        const p = parseArchiveName(f.name);
        return { file: f, key: productKey(p.project, p.product, p.version) };
      }),
      test: testFiles
        .filter((f) => !/\.pdf$/i.test(f.name))
        .map((f) => {
          const p = parseArchiveName(f.name);
          return { file: f, key: productKey(p.project, p.product, p.version) };
        }),
    }),
    [calcFiles, testFiles],
  );

  /** 选一份计算书 → 自动匹配实验报告 → 生成可信资产 */
  const buildTrustedFor = async (calc: DbFile) => {
    const calcParsed = parseArchiveName(calc.name);
    const targetKey = productKey(calcParsed.project, calcParsed.product, calcParsed.version);
    const matchedTests = testFiles
      .filter((f) => !/\.pdf$/i.test(f.name))
      .filter((f) => {
        const p = parseArchiveName(f.name);
        return productKey(p.project, p.product, p.version) === targetKey;
      });
    if (matchedTests.length === 0) {
      showToast(`未找到项目-产品-版本匹配的实验测试表（xlsx），请先在实验报告模块归档`);
      return;
    }

    setBusy('trusted');
    setError('');
    try {
      const [calcRead, testRead] = await Promise.all([
        api.db.read({ fullPath: calc.fullPath }),
        api.db.read({ fullPath: matchedTests[0].fullPath }),
      ]);
      if (!calcRead.ok || !testRead.ok) {
        throw new Error(calcRead.message || testRead.message || '读取归档文件失败');
      }
      const calcRows = parseCalcRows(calcRead.rows || []);
      const testRows = parseTestRows(testRead.rows || []);

      // 二次增强：把双方的关键字做一次显式匹配，让 db.ts 的 overlap 分数更高
      const b64 = await buildTrustedXlsxBase64(calcParsed.project, calcParsed.product, calcParsed.version, calcRows, testRows);
      const res = await api.db.archive({
        base64: b64,
        fileName: trustedFileName(calcParsed.project, calcParsed.product, calcParsed.version),
        libType: 'trusted',
      });
      if (!res.ok) throw new Error(res.message || '归档失败');
      showToast(`可信资产已归档：${res.filePath}`);
      refresh();
    } catch (e) {
      setError(`可信资产生成失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
    }
  };

  /** 双击文件卡片：调用系统默认程序打开原文 */
  const openFile = useCallback(async (f: DbFile) => {
    const res = await api.app.openPath(f.fullPath);
    if (!res.ok) showToast(`无法打开：${res.message || '未知错误'}`);
  }, []);

  const totalMatches = useMemo(() => {
    const calcKeys = new Map<string, number>();
    genKeys.calc.forEach((k) => calcKeys.set(k.key, (calcKeys.get(k.key) ?? 0) + 1));
    return genKeys.test.filter((k) => calcKeys.has(k.key)).length;
  }, [genKeys]);

  return (
    <div className="db-page">
      <div className="settings-card">
        <h3>产品数据库</h3>
        <div className="kv">
          <span>服务器</span>
          <b>{reachable === null ? '检测中…' : reachable ? '可达' : '不可达，请检查网络或 UNC 路径'}</b>
        </div>
        <div className="kv"><span>计算库</span><b style={{ fontSize: 12 }}>{UNC_CALC_LIB}</b></div>
        <div className="kv"><span>实验库</span><b style={{ fontSize: 12 }}>{UNC_TEST_LIB}</b></div>
        <div className="kv"><span>可信资产库</span><b style={{ fontSize: 12 }}>{UNC_TRUSTED}</b></div>
        <div className="kv"><span>当前登录</span><b>{user.displayName || user.username}</b></div>
        <div className="db-stats">
          <span className="chip">计算书 {calcFiles.length}</span>
          <span className="chip">实验报告 {testFiles.length}</span>
          <span className="chip">已自动匹配 {totalMatches}</span>
          <span className="chip">可信资产 {trustedFiles.length}</span>
          <button className="btn-ghost sm" onClick={refresh} disabled={busy === 'refresh'}>刷新</button>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="lib-tabs">
        <button className={tab === 'calc' ? 'tab-btn active' : 'tab-btn'} onClick={() => setTab('calc')}>
          理论计算库（{calcFiles.length}）
        </button>
        <button className={tab === 'test' ? 'tab-btn active' : 'tab-btn'} onClick={() => setTab('test')}>
          实验测试库（{testFiles.length}）
        </button>
        <button className={tab === 'trusted' ? 'tab-btn active' : 'tab-btn'} onClick={() => setTab('trusted')}>
          可信资产库（{trustedFiles.length}）
        </button>
      </div>

      {tab === 'calc' && (
        <FileList files={calcFiles} onBuildTrusted={buildTrustedFor} busy={busy} onOpen={openFile} />
      )}
      {tab === 'test' && <FileList files={testFiles} busy={busy} onOpen={openFile} />}
      {tab === 'trusted' && <FileList files={trustedFiles} busy={busy} onOpen={openFile} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function FileList({ files, onBuildTrusted, busy, onOpen }: { files: DbFile[]; onBuildTrusted?: (f: DbFile) => void; busy: string; onOpen?: (f: DbFile) => void }) {
  return (
    <div className="file-list">
      {files.length === 0 && (
        <div className="settings-card">
          <h3>暂无归档文件</h3>
          <p className="settings-hint">
            计算书：在「项目管理」页点击项目卡片的「导出到数据库」；
            实验报告：在「实验报告」页点击「导出 Excel 测试表」，后续将支持直接归档。
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
            onDoubleClick={() => onOpen?.(f)}
          >
            <div className="pc-head">
              <h3>{f.name}</h3>
              {p.version && <span className="tag light">{p.version}</span>}
            </div>
            <div className="kv"><span>项目</span><b>{p.project || '—'}</b></div>
            <div className="kv"><span>产品</span><b>{p.product || '—'}</b></div>
            <div className="kv"><span>日期</span><b>{p.date || '—'}</b></div>
            <div className="kv"><span>大小</span><b>{(f.size / 1024).toFixed(1)} KB · {new Date(f.mtime).toLocaleString('zh-CN')}</b></div>
            <div className="pc-actions">
              {onBuildTrusted && (
                <button className="btn-primary sm" disabled={busy === 'trusted'} onClick={() => onBuildTrusted(f)}>
                  生成可信资产（自动匹配实验报告）
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
