/**
 * 实验数据入库与模型校准（《实验数据入库与模型校准规范》MVP 界面）
 *
 * 页签A：报告导入与列表（JSON / Excel / Word → 解析 → 元数据校验 → QC）
 * 页签B：比较与分流（理论来源 = 计算记录，runComparison → PASS/FAIL/SUSPECT → triage）
 * 页签C：案例库与审计（golden/misfit、校准触发、模型注册表、审计日志）
 *
 * 数据存放于内存 LabStore，每次变更后整体快照经 api.lab.set 持久化，
 * 页面挂载时经 api.lab.get 恢复（桌面版落到 ctr-data.json 的 lab 字段）。
 */
import { useEffect, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { api, type CtrUser, type HistoryEntry } from '../api';
import { getFormula } from '../formula/registry';
import {
  LabStore,
  ingestReport,
  listAudit,
  listCases,
  parseReportDocx,
  parseReportJson,
  parseReportXlsx,
  publishGolden,
  releaseModel,
  requestCalibration,
  reviewGolden,
  rollbackModel,
  runComparison,
  sha256Hex,
  triage,
  ROOT_CAUSE_LABELS,
  type AuditEntry,
  type ComparisonRecord,
  type ExperimentRecord,
  type GoldenCase,
  type IngestResult,
  type LabSnapshot,
  type MisfitCase,
  type ModelRegistryEntry,
  type ParsedReport,
  type ReportStatus,
  type RootCause,
  type Verdict,
} from '../experiment';

interface Props {
  user: CtrUser;
}

type TabKey = 'import' | 'compare' | 'cases';

interface ImportEntry {
  fileName: string;
  result?: IngestResult;
  error?: string;
}

const STATUS_LABEL: Record<ReportStatus, string> = {
  UPLOADED: '已上传',
  PARSED: '已解析',
  QC_PASSED: 'QC通过',
  QC_FAILED: 'QC失败',
  COMPARED: '已比较',
  GOLDEN: 'GOLDEN',
  MISFIT: 'MISFIT',
  REVIEWED: '已审核',
  PUBLISHED: '已发布',
};

/** 状态徽章配色：失败红、可疑黄、终态绿、中间态蓝/灰 */
function statusTagClass(s: ReportStatus): string {
  if (s === 'QC_FAILED') return 'tag tag-fail';
  if (s === 'MISFIT') return 'tag tag-warn';
  if (s === 'GOLDEN' || s === 'REVIEWED' || s === 'PUBLISHED') return 'tag tag-ok';
  if (s === 'QC_PASSED' || s === 'COMPARED') return 'tag domain';
  return 'tag light';
}

function verdictTagClass(v: Verdict): string {
  if (v === 'PASS') return 'tag tag-ok';
  if (v === 'FAIL') return 'tag tag-fail';
  return 'tag tag-warn';
}

const fmt3 = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : '—');

/** 从计算记录中取 SI 入参（CalculatorPage 保存结构为 { values, units, inputsSI }） */
function historyInputsSI(h: HistoryEntry | undefined): Record<string, number> {
  const inputs = h?.inputs as { inputsSI?: Record<string, number> } | undefined;
  return inputs?.inputsSI ?? {};
}

export function LabPage({ user }: Props) {
  const storeRef = useRef<LabStore | null>(null);
  if (!storeRef.current) storeRef.current = new LabStore();
  const [loaded, setLoaded] = useState(false);
  const [, setTick] = useState(0);
  const [tab, setTab] = useState<TabKey>('import');
  const [toast, setToast] = useState('');
  const actor = user.id;

  // 挂载时从主进程恢复实验库快照
  useEffect(() => {
    let alive = true;
    api.lab
      .get()
      .then((snap) => {
        if (!alive) return;
        if (snap) storeRef.current = new LabStore(snap as LabSnapshot);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!alive) return;
        setLoaded(true);
        setTick((t) => t + 1);
      });
    return () => {
      alive = false;
    };
  }, []);

  const showToast = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 2600);
  };

  /** 每次变更后快照持久化 + 触发重渲染 */
  const persist = async () => {
    const res = await api.lab.set(storeRef.current!.snapshot());
    if (!res.ok) showToast(`持久化失败：${res.error}`);
    setTick((t) => t + 1);
  };

  // ---------- 页签A：导入与列表 ----------
  const [imports, setImports] = useState<ImportEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState('');

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      for (const file of Array.from(files)) {
        try {
          const buf = await file.arrayBuffer();
          const ext = file.name.split('.').pop()?.toLowerCase();
          let parsed: ParsedReport;
          if (ext === 'json') {
            parsed = parseReportJson(JSON.parse(new TextDecoder().decode(buf)));
          } else if (ext === 'xlsx') {
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
            parsed = await parseReportXlsx(wb);
          } else if (ext === 'docx') {
            parsed = await parseReportDocx(buf);
          } else {
            throw new Error('不支持的文件类型（仅 .json / .xlsx / .docx）');
          }
          const hash = await sha256Hex(buf);
          const path = api.file?.getPath?.(file) || file.name;
          const result = ingestReport(storeRef.current!, parsed, { path, hash }, actor);
          setImports((prev) => [{ fileName: file.name, result }, ...prev]);
        } catch (e) {
          setImports((prev) => [
            { fileName: file.name, error: e instanceof Error ? e.message : String(e) },
            ...prev,
          ]);
        }
      }
      await persist();
    } finally {
      setImporting(false);
    }
  };

  const experiments = storeRef.current.listExperiments();
  const comparable = (e: ExperimentRecord) => e.status === 'QC_PASSED' || e.status === 'MISFIT';

  // ---------- 页签B：比较与分流 ----------
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    if (tab === 'compare') api.history.list(user.id).then(setHistory);
  }, [tab, user.id]);

  const exp = selectedReportId ? storeRef.current.getExperiment(selectedReportId) : undefined;
  const [histId, setHistId] = useState('');
  const [modelVersion, setModelVersion] = useState('0.1.0');
  const [scalarQuantity, setScalarQuantity] = useState('');
  const [scalarOutput, setScalarOutput] = useState('');
  const [curveQuantity, setCurveQuantity] = useState('');
  const [applicableRange, setApplicableRange] = useState('');
  const [rootCause, setRootCause] = useState<RootCause>('boundary');
  const [misfitNote, setMisfitNote] = useState('');

  const hist = history.find((h) => h.id === histId);
  const histInputsSI = historyInputsSI(hist);
  const outputKeys = Object.keys(hist?.outputs ?? {}).filter(
    (k) => typeof (hist!.outputs as Record<string, unknown>)[k] === 'number',
  );
  const curveSpec = hist ? getFormula(hist.formulaId)?.curve : undefined;
  const quantities = exp?.curves.map((c) => c.quantity) ?? [];
  const comparisons: ComparisonRecord[] = exp
    ? storeRef.current.listComparisons(exp.reportId)
    : [];
  const hasSuspect = comparisons.some((c) => c.verdict === 'SUSPECT');
  const allPass = comparisons.length > 0 && comparisons.every((c) => c.verdict === 'PASS');
  const hasFail = comparisons.some((c) => c.verdict === 'FAIL');
  const canTriage = !!exp && (exp.status === 'COMPARED' || exp.status === 'MISFIT') && comparisons.length > 0;

  const doCompare = async () => {
    if (!exp || !hist) return;
    try {
      const scalars: Record<string, number> = {};
      if (scalarQuantity && scalarOutput) {
        scalars[scalarQuantity] = Number((hist.outputs as Record<string, unknown>)[scalarOutput]);
      }
      const curve =
        curveSpec && curveQuantity
          ? { quantity: curveQuantity, points: curveSpec.compute(histInputsSI) }
          : undefined;
      if (Object.keys(scalars).length === 0 && !curve) {
        showToast('请至少配置一项标量对比或曲线对比');
        return;
      }
      const res = runComparison(storeRef.current!, {
        reportId: exp.reportId,
        modelId: hist.formulaId,
        modelVersion: modelVersion.trim() || '0.1.0',
        inputJson: histInputsSI,
        scalars,
        curve,
        actor,
      });
      if (!res.ok) showToast(res.message ?? '比较失败');
      await persist();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const doTriageGolden = async () => {
    if (!exp) return;
    const res = triage(storeRef.current!, exp.reportId, actor, { applicableRange: applicableRange.trim() });
    showToast(res.ok ? '已入 golden 案例库（待人工审核）' : res.message ?? '分流失败');
    await persist();
  };

  const doTriageMisfit = async () => {
    if (!exp) return;
    const res = triage(storeRef.current!, exp.reportId, actor, {
      rootCause,
      note: misfitNote.trim(),
    });
    showToast(res.ok ? '已入 misfit 偏差案例库' : res.message ?? '分流失败');
    await persist();
  };

  // ---------- 页签C：案例库与审计 ----------
  const goldenCases = listCases(storeRef.current, 'golden') as GoldenCase[];
  const misfitCases = listCases(storeRef.current, 'misfit') as MisfitCase[];
  const models = storeRef.current.listModels();

  const [calFamily, setCalFamily] = useState('');
  const [calResult, setCalResult] = useState<{ ok: boolean; shouldCalibrate: boolean; message: string } | null>(null);
  const [relModelId, setRelModelId] = useState('');
  const [relVersion, setRelVersion] = useState('');
  const [relCoeff, setRelCoeff] = useState('{}');
  const [rbModelId, setRbModelId] = useState('');
  const [rbFrom, setRbFrom] = useState('');
  const [rbTo, setRbTo] = useState('');
  const [auditFilter, setAuditFilter] = useState('');

  const auditList: AuditEntry[] = listAudit(
    storeRef.current,
    undefined,
    auditFilter.trim() || undefined,
  );

  const doCalCheck = () => {
    if (!calFamily.trim()) {
      showToast('请输入产品族');
      return;
    }
    const res = requestCalibration(storeRef.current!, calFamily.trim(), {
      modelId: '-',
      whitelist: [],
      folds: 5,
    });
    setCalResult(res);
  };

  const doRelease = async () => {
    try {
      let coefficientsJson: Record<string, number> = {};
      try {
        coefficientsJson = JSON.parse(relCoeff || '{}') as Record<string, number>;
      } catch {
        showToast('系数 JSON 解析失败');
        return;
      }
      if (!relModelId.trim() || !relVersion.trim()) {
        showToast('请填写模型 ID 与版本号');
        return;
      }
      releaseModel(
        storeRef.current!,
        {
          modelId: relModelId.trim(),
          version: relVersion.trim(),
          coefficientsJson,
          calibrationDataIds: [],
          metricsJson: {},
        },
        actor,
      );
      showToast(`模型 ${relModelId}@${relVersion} 已发布`);
      await persist();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const doRollback = async () => {
    try {
      if (!rbModelId.trim() || !rbFrom.trim() || !rbTo.trim()) {
        showToast('请填写模型 ID 与源/目标版本');
        return;
      }
      rollbackModel(storeRef.current!, rbModelId.trim(), rbFrom.trim(), rbTo.trim(), actor);
      showToast(`已回滚：${rbModelId} ${rbFrom} → ${rbTo}`);
      await persist();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  if (!loaded) {
    return (
      <div className="lab-page">
        <p className="empty-hint">实验库加载中…</p>
      </div>
    );
  }

  return (
    <div className="lab-page">
      <div className="lab-tabs">
        <button className={tab === 'import' ? 'lab-tab active' : 'lab-tab'} onClick={() => setTab('import')}>
          报告导入与列表
        </button>
        <button className={tab === 'compare' ? 'lab-tab active' : 'lab-tab'} onClick={() => setTab('compare')}>
          比较与分流
        </button>
        <button className={tab === 'cases' ? 'lab-tab active' : 'lab-tab'} onClick={() => setTab('cases')}>
          案例库与审计
        </button>
      </div>

      {/* ==================== 页签A ==================== */}
      {tab === 'import' && (
        <>
          <div className="lib-toolbar">
            <label className={importing ? 'btn-primary sm disabled' : 'btn-primary sm'}>
              {importing ? '解析中…' : '选择实验报告（JSON / Excel / Word）'}
              <input
                type="file"
                accept=".json,.xlsx,.docx"
                multiple
                hidden
                disabled={importing}
                onChange={(e) => {
                  importFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            <span className="lib-count">已入库 {experiments.length} 份报告</span>
          </div>

          <div className="pdf-filename-preview" style={{ marginBottom: 16 }}>
            <span className="pfp-label">Excel 模板约定：</span>
            工作表「元数据」A 列字段名、B 列值（报告编号 / 产品族 / 产品型号 / 报告版本 / 试验标准 / 试验日期 / 试验员 /
            实验室 / 传感器编号 / 校准到期日 / 温度 / 湿度 / 海拔 / 流量 / 单位制）；
            工作表「曲线」表头：测量量 | 单位 | x | 第1次 | 第2次 | 第3次 | … | U95（可选）。单位统一为 SI。
          </div>

          {imports.length > 0 && (
            <div className="settings-card" style={{ marginBottom: 16 }}>
              <h3>导入结果</h3>
              {imports.map((it, i) => (
                <div key={i} className="kv" style={{ alignItems: 'flex-start' }}>
                  <span className="mono small">{it.fileName}</span>
                  {it.error ? (
                    <b className="warn">{it.error}</b>
                  ) : it.result ? (
                    <b>
                      <span className={statusTagClass(it.result.status ?? 'UPLOADED')}>
                        {STATUS_LABEL[it.result.status ?? 'UPLOADED']}
                      </span>
                      <span className="small" style={{ fontWeight: 400 }}>
                        {it.result.reportId} {it.result.message ?? ''}
                      </span>
                      {it.result.qcIssues && it.result.qcIssues.length > 0 && (
                        <span style={{ display: 'block', fontWeight: 400 }}>
                          {it.result.qcIssues.map((q, j) => (
                            <span key={j} className={q.level === 'FAIL' ? 'tag tag-fail' : 'tag tag-warn'}>
                              {q.level} {q.rule} {q.message}
                            </span>
                          ))}
                        </span>
                      )}
                    </b>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <table className="compare-table">
            <thead>
              <tr>
                <th>报告编号</th>
                <th>产品</th>
                <th>状态</th>
                <th>试验日期</th>
                <th>SUSPECT 量</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((e) => (
                <tr key={e.reportId}>
                  <td className="mono">{e.reportId}</td>
                  <td>
                    {e.meta.productFamily} / {e.meta.productModel}
                  </td>
                  <td>
                    <span className={statusTagClass(e.status)}>{STATUS_LABEL[e.status]}</span>
                  </td>
                  <td>{e.meta.testDate}</td>
                  <td>{e.suspectQuantities.length > 0 ? e.suspectQuantities.join('、') : '—'}</td>
                  <td>
                    <button
                      className="btn-link"
                      disabled={!comparable(e)}
                      onClick={() => {
                        setSelectedReportId(e.reportId);
                        setTab('compare');
                      }}
                    >
                      去比较
                    </button>
                  </td>
                </tr>
              ))}
              {experiments.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <p className="empty-hint">暂无报告。点击上方按钮选择 JSON / Excel / Word 实验报告导入。</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {/* ==================== 页签B ==================== */}
      {tab === 'compare' && (
        <>
          <div className="settings-card" style={{ marginBottom: 16 }}>
            <h3>比较对象</h3>
            <div className="lab-form-row">
              <label className="field" style={{ flex: 1 }}>
                <span>实验报告（QC 通过 / MISFIT 可重新比较）</span>
                <select
                  value={selectedReportId}
                  onChange={(e) => setSelectedReportId(e.target.value)}
                >
                  <option value="">（请选择）</option>
                  {experiments.filter(comparable).map((e) => (
                    <option key={e.reportId} value={e.reportId}>
                      {e.reportId} · {e.meta.productModel}（{STATUS_LABEL[e.status]}）
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span>理论来源（计算记录）</span>
                <select value={histId} onChange={(e) => setHistId(e.target.value)}>
                  <option value="">（请选择）</option>
                  {history.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.formulaTitle} · {new Date(h.createdAt).toLocaleString('zh-CN')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ width: 140 }}>
                <span>模型版本</span>
                <input value={modelVersion} onChange={(e) => setModelVersion(e.target.value)} />
              </label>
            </div>
            {hist && (
              <p className="settings-hint">
                已选公式 {hist.formulaId}（{hist.formulaTitle}），入参采用记录中的 SI 值；输出键：
                {outputKeys.join('、') || '无数值输出'}
                {curveSpec ? `；该公式支持理论曲线（${curveSpec.label}）` : '；该公式无曲线配置'}
              </p>
            )}
          </div>

          {exp && hist && (
            <div className="settings-card" style={{ marginBottom: 16 }}>
              <h3>对比配置</h3>
              <div className="lab-form-row">
                <label className="field" style={{ flex: 1 }}>
                  <span>标量对比 · 报告测量量</span>
                  <select value={scalarQuantity} onChange={(e) => setScalarQuantity(e.target.value)}>
                    <option value="">（不对比）</option>
                    {quantities.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span>标量对比 · 模型值（计算记录输出）</span>
                  <select value={scalarOutput} onChange={(e) => setScalarOutput(e.target.value)}>
                    <option value="">（请选择）</option>
                    {outputKeys.map((k) => (
                      <option key={k} value={k}>
                        {k} = {Number((hist.outputs as Record<string, unknown>)[k]).toPrecision(6)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {curveSpec && (
                <div className="lab-form-row">
                  <label className="field" style={{ flex: 1 }}>
                    <span>曲线对比 · 报告测量量（理论曲线由该公式按 SI 入参计算）</span>
                    <select value={curveQuantity} onChange={(e) => setCurveQuantity(e.target.value)}>
                      <option value="">（不对比）</option>
                      {quantities.map((q) => (
                        <option key={q} value={q}>
                          {q}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <button className="btn-primary sm" onClick={doCompare}>
                运行比较
              </button>
            </div>
          )}

          {exp && comparisons.length > 0 && (
            <div className="settings-card" style={{ marginBottom: 16 }}>
              <h3>比较结果（{exp.reportId}）</h3>
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>测量量</th>
                    <th>类别</th>
                    <th>判定</th>
                    <th>MAPE %</th>
                    <th>RMSE</th>
                    <th>峰值频率偏差 %</th>
                    <th>带内平均偏差</th>
                    <th>理由</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((c) => (
                    <tr key={c.id}>
                      <td>{c.quantity}</td>
                      <td>{c.kind === 'acoustic' ? '声学量' : '线性量'}</td>
                      <td>
                        <span className={verdictTagClass(c.verdict)}>{c.verdict}</span>
                      </td>
                      <td>{fmt3(c.metrics.mapePct)}</td>
                      <td>{fmt3(c.metrics.rmse)}</td>
                      <td>{fmt3(c.metrics.peakFreqDevPct)}</td>
                      <td>{fmt3(c.metrics.bandAvgDev)}</td>
                      <td className="small">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {canTriage && hasSuspect && (
                <p className="ts-warn" style={{ marginTop: 12 }}>
                  ⚠ 存在 SUSPECT 量：退回补测，禁止进入校准集（数据质量问题不算模型偏差）
                </p>
              )}

              {canTriage && !hasSuspect && allPass && (
                <div className="lab-form-row" style={{ marginTop: 12 }}>
                  <label className="field" style={{ flex: 1 }}>
                    <span>适用范围（入 golden 案例库必填）</span>
                    <input
                      value={applicableRange}
                      onChange={(e) => setApplicableRange(e.target.value)}
                      placeholder="如：流量 200~600 m³/h，进气系统 V1.0"
                    />
                  </label>
                  <button
                    className="btn-primary sm"
                    style={{ alignSelf: 'flex-end' }}
                    disabled={!applicableRange.trim()}
                    onClick={doTriageGolden}
                  >
                    全部 PASS → 入 golden
                  </button>
                </div>
              )}

              {canTriage && !hasSuspect && hasFail && (
                <div className="lab-form-row" style={{ marginTop: 12 }}>
                  <label className="field" style={{ flex: 1 }}>
                    <span>根因标签（FAIL 必填）</span>
                    <select value={rootCause} onChange={(e) => setRootCause(e.target.value as RootCause)}>
                      {(Object.keys(ROOT_CAUSE_LABELS) as RootCause[]).map((k) => (
                        <option key={k} value={k}>
                          {ROOT_CAUSE_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field" style={{ flex: 2 }}>
                    <span>备注</span>
                    <input
                      value={misfitNote}
                      onChange={(e) => setMisfitNote(e.target.value)}
                      placeholder="偏差情况说明"
                    />
                  </label>
                  <button className="btn-primary sm" style={{ alignSelf: 'flex-end' }} onClick={doTriageMisfit}>
                    FAIL → 入 misfit
                  </button>
                </div>
              )}
            </div>
          )}

          {!exp && <p className="empty-hint">请先在「报告导入与列表」页签选择一份 QC 通过的报告，或在此直接选择。</p>}
        </>
      )}

      {/* ==================== 页签C ==================== */}
      {tab === 'cases' && (
        <>
          <div className="settings-card" style={{ marginBottom: 16 }}>
            <h3>golden 高精案例（须人工审核后才可作推荐值）</h3>
            <table className="compare-table">
              <thead>
                <tr>
                  <th>案例 ID</th>
                  <th>报告编号</th>
                  <th>模型</th>
                  <th>适用范围</th>
                  <th>审核</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {goldenCases.map((g) => (
                  <tr key={g.caseId}>
                    <td className="mono">{g.caseId}</td>
                    <td className="mono">{g.reportId}</td>
                    <td>{g.modelId}</td>
                    <td>{g.applicableRange || '—'}</td>
                    <td>
                      {g.approvedBy ? (
                        <span className="tag tag-ok">已审核 {new Date(g.approvedAt!).toLocaleDateString('zh-CN')}</span>
                      ) : (
                        <span className="tag tag-warn">待审核</span>
                      )}
                    </td>
                    <td>
                      {!g.approvedBy && (
                        <button
                          className="btn-link"
                          onClick={async () => {
                            try {
                              reviewGolden(storeRef.current!, g.caseId, actor);
                              await persist();
                            } catch (e) {
                              showToast(e instanceof Error ? e.message : String(e));
                            }
                          }}
                        >
                          审核
                        </button>
                      )}
                      {g.approvedBy && (
                        <button
                          className="btn-link"
                          onClick={async () => {
                            try {
                              publishGolden(storeRef.current!, g.caseId, actor);
                              showToast('已发布');
                              await persist();
                            } catch (e) {
                              showToast(e instanceof Error ? e.message : String(e));
                            }
                          }}
                        >
                          发布
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {goldenCases.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <p className="empty-hint">暂无 golden 案例。比较全部 PASS 后可在「比较与分流」页签入库。</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="settings-card" style={{ marginBottom: 16 }}>
            <h3>misfit 偏差案例（必须打根因标签）</h3>
            <table className="compare-table">
              <thead>
                <tr>
                  <th>案例 ID</th>
                  <th>报告编号</th>
                  <th>模型</th>
                  <th>根因</th>
                  <th>备注</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {misfitCases.map((m) => (
                  <tr key={m.caseId}>
                    <td className="mono">{m.caseId}</td>
                    <td className="mono">{m.reportId}</td>
                    <td>{m.modelId}</td>
                    <td>
                      <span className="tag tag-warn">{ROOT_CAUSE_LABELS[m.rootCause]}</span>
                    </td>
                    <td>{m.note || '—'}</td>
                    <td className="small">{new Date(m.createdAt).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
                {misfitCases.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <p className="empty-hint">暂无 misfit 案例。</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="settings-card" style={{ marginBottom: 16 }}>
            <h3>校准触发检查（§9.1）</h3>
            <div className="lab-form-row">
              <label className="field" style={{ flex: 1 }}>
                <span>产品族</span>
                <input
                  value={calFamily}
                  onChange={(e) => setCalFamily(e.target.value)}
                  placeholder="如：进气系统"
                />
              </label>
              <button className="btn-ghost" style={{ alignSelf: 'flex-end' }} onClick={doCalCheck}>
                检查是否触发校准
              </button>
            </div>
            {calResult && (
              <p className={calResult.shouldCalibrate ? 'ts-warn' : 'settings-hint'}>
                {calResult.message}
              </p>
            )}
          </div>

          <div className="settings-card" style={{ marginBottom: 16 }}>
            <h3>模型注册表（发布 / 回滚）</h3>
            <div className="lab-form-row">
              <label className="field" style={{ flex: 1 }}>
                <span>模型 ID</span>
                <input value={relModelId} onChange={(e) => setRelModelId(e.target.value)} placeholder="公式 ID" />
              </label>
              <label className="field" style={{ width: 140 }}>
                <span>版本号</span>
                <input value={relVersion} onChange={(e) => setRelVersion(e.target.value)} placeholder="如 1.1.0" />
              </label>
              <label className="field" style={{ flex: 2 }}>
                <span>系数 JSON</span>
                <input value={relCoeff} onChange={(e) => setRelCoeff(e.target.value)} placeholder='{"k": 1.0}' />
              </label>
              <button className="btn-primary sm" style={{ alignSelf: 'flex-end' }} onClick={doRelease}>
                发布
              </button>
            </div>
            <div className="lab-form-row">
              <label className="field" style={{ flex: 1 }}>
                <span>回滚 · 模型 ID</span>
                <input value={rbModelId} onChange={(e) => setRbModelId(e.target.value)} />
              </label>
              <label className="field" style={{ width: 140 }}>
                <span>从版本</span>
                <input value={rbFrom} onChange={(e) => setRbFrom(e.target.value)} />
              </label>
              <label className="field" style={{ width: 140 }}>
                <span>回滚到版本</span>
                <input value={rbTo} onChange={(e) => setRbTo(e.target.value)} />
              </label>
              <button className="btn-ghost" style={{ alignSelf: 'flex-end' }} onClick={doRollback}>
                回滚
              </button>
            </div>
            <table className="compare-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>模型 ID</th>
                  <th>版本</th>
                  <th>状态</th>
                  <th>系数</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m: ModelRegistryEntry) => (
                  <tr key={`${m.modelId}@${m.version}`}>
                    <td className="mono">{m.modelId}</td>
                    <td>{m.version}</td>
                    <td>
                      <span className={m.status === 'released' ? 'tag tag-ok' : m.status === 'retired' ? 'tag light' : 'tag tag-warn'}>
                        {m.status === 'released' ? '已发布' : m.status === 'retired' ? '已退役' : '草稿'}
                      </span>
                    </td>
                    <td className="mono small">{JSON.stringify(m.coefficientsJson)}</td>
                    <td className="small">{new Date(m.createdAt).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
                {models.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <p className="empty-hint">注册表为空。发布一个模型版本后将在此列出。</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="settings-card">
            <h3>审计日志</h3>
            <div className="lib-toolbar" style={{ marginBottom: 10 }}>
              <input
                className="search-input"
                value={auditFilter}
                onChange={(e) => setAuditFilter(e.target.value)}
                placeholder="按实体 ID 过滤（如报告编号、案例 ID）"
              />
              <span className="lib-count">共 {auditList.length} 条</span>
            </div>
            <table className="compare-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>实体</th>
                  <th>实体 ID</th>
                  <th>动作</th>
                  <th>操作人</th>
                </tr>
              </thead>
              <tbody>
                {auditList.map((a) => (
                  <tr key={a.id}>
                    <td className="small">{new Date(a.timestamp).toLocaleString('zh-CN')}</td>
                    <td>{a.entity}</td>
                    <td className="mono small">{a.entityId}</td>
                    <td>{a.action}</td>
                    <td>{a.actor}</td>
                  </tr>
                ))}
                {auditList.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <p className="empty-hint">暂无审计记录。</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
