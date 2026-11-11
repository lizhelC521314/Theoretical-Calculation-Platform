import { useCallback, useMemo, useState } from 'react';
import { api, isDesktop, type CtrUser } from '../api';
import { KBE_TRAINING } from '../report/db';
import {
  parseTrainingCoverText,
  parseTrainingFileName,
  todayTrainingDate,
  TRAINING_ACCEPT,
  TRAINING_CATEGORIES,
  type TrainingRecord,
} from '../report/training';

interface Props {
  user: CtrUser;
}

interface Entry {
  uid: string;
  fileName: string;
  filePath: string;
  title: string;
  trainer: string;
  trainedAt: string;
  /** 培训资料类别（CAE分析/产品设计/软件操作/工艺/材料） */
  category: string;
  status: 'idle' | 'importing' | 'done' | 'error';
  message: string;
  recordId?: string;
  /** 正在读取封面文字 */
  reading: boolean;
  /** 封面识别结果说明 */
  coverNote: string;
  /** 培训人 / 培训时间被手工修改后不再被封面结果覆盖 */
  manualTrainer: boolean;
  manualDate: boolean;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * 培训资料导入
 * 支持一次选择多份资料，依次从文件名与资料封面自动识别「培训时间、培训人、资料名」，
 * 导入时统一转换为 PDF，并把元数据写入同名 JSON。
 */
export function TrainingImportPage({ user }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2800);
  };

  const patch = (id: string, next: Partial<Entry>) => {
    setEntries((prev) => prev.map((e) => (e.uid === id ? { ...e, ...next } : e)));
  };

  /** 读取封面文字并回填培训人 / 培训时间（已手工修改的字段不覆盖） */
  const readCover = useCallback(async (entry: Entry) => {
    try {
      const res = await api.training.extractCover(entry.filePath);
      const meta = res.ok && res.text ? parseTrainingCoverText(res.text) : { trainer: '', trainedAt: '' };
      const found = [
        meta.trainer ? `培训人 ${meta.trainer}` : '',
        meta.trainedAt ? `培训时间 ${meta.trainedAt}` : '',
      ].filter(Boolean);
      setEntries((prev) =>
        prev.map((e) => {
          if (e.uid !== entry.uid) return e;
          return {
            ...e,
            trainer: meta.trainer && !e.manualTrainer ? meta.trainer : e.trainer,
            trainedAt: meta.trainedAt && !e.manualDate ? meta.trainedAt : e.trainedAt,
            reading: false,
            coverNote: found.length ? `封面识别：${found.join('、')}` : '封面未识别到培训人/时间，沿用文件名结果',
          };
        }),
      );
    } catch (err) {
      patch(entry.uid, {
        reading: false,
        coverNote: `封面识别失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, []);

  const addFiles = useCallback(
    (files: FileList | null) => {
      if (!files || !files.length) return;
      if (!isDesktop) {
        setError('浏览器调试模式不支持导入本地资料，请在桌面程序中使用');
        return;
      }
      setError('');
      const next: Entry[] = [];
      for (const f of Array.from(files)) {
        const filePath = api.file.getPath(f);
        if (!filePath) continue;
        const parsed = parseTrainingFileName(f.name);
        next.push({
          uid: uid(),
          fileName: f.name,
          filePath,
          title: parsed.title,
          trainer: parsed.trainer,
          trainedAt: parsed.trainedAt || todayTrainingDate(),
          category: '',
          status: 'idle',
          message: '',
          reading: true,
          coverNote: '',
          manualTrainer: false,
          manualDate: false,
        });
      }
      if (next.length === 0) setError('未能获取文件路径，请重新选择');
      setEntries((prev) => [...prev, ...next]);
      // 顺序读取，避免多份 Office 文件同时转换占用资源
      void (async () => {
        for (const entry of next) await readCover(entry);
      })();
    },
    [readCover],
  );

  const pending = useMemo(() => entries.filter((e) => e.status === 'idle' || e.status === 'error'), [entries]);
  const ready = pending.filter((e) => !e.reading);
  const doneCount = entries.filter((e) => e.status === 'done').length;

  const startImport = async () => {
    if (!ready.length) return;
    setBusy(true);
    setError('');
    let okCount = 0;
    for (const e of ready) {
      if (!e.title.trim()) {
        patch(e.uid, { status: 'error', message: '培训资料名不能为空' });
        continue;
      }
      patch(e.uid, { status: 'importing', message: '正在转 PDF…' });
      try {
        const res = await api.training.import({
          srcPath: e.filePath,
          title: e.title.trim(),
          trainer: e.trainer.trim(),
          trainedAt: e.trainedAt.trim(),
          category: e.category,
          createdBy: user.username,
          createdByDisplay: user.displayName,
        });
        if (!res.ok) {
          patch(e.uid, { status: 'error', message: res.message || '导入失败' });
          continue;
        }
        const rec = res.record as TrainingRecord | undefined;
        okCount += 1;
        patch(e.uid, {
          status: 'done',
          message: `已转为 PDF 并入库：${rec?.id || ''}`,
          recordId: rec?.id,
        });
      } catch (err) {
        patch(e.uid, { status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }
    setBusy(false);
    if (okCount) showToast(`已导入 ${okCount} 份培训资料`);
  };


  return (
    <div className="test-search fmea-page training-page">
      <div className="settings-card">
        <div className="ts-head">
          <h3>培训资料导入</h3>
          <div className="ts-status">
            <span className="chip">待导入 {ready.length}</span>
            <span className="chip">已导入 {doneCount}</span>
            <button className="btn-ghost sm" onClick={() => api.app.openPath(KBE_TRAINING)}>
              打开归档目录
            </button>
          </div>
        </div>

        <div className="ts-toolbar">
          <label className={busy ? 'btn-primary sm disabled' : 'btn-primary sm'}>
            选择培训资料
            <input
              type="file"
              accept={TRAINING_ACCEPT}
              multiple
              hidden
              disabled={busy}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <button className="btn-primary sm" onClick={startImport} disabled={busy || ready.length === 0}>
            {busy ? '导入中…' : `开始导入（${ready.length}）`}
          </button>
          <span className="lib-count">
            支持 PDF / Word / PPT / Excel；导入后统一转为 PDF。系统会从文件名和资料封面自动识别培训人、培训时间
          </span>
        </div>
        <div className="training-path">
          归档目录：<span className="mono">{KBE_TRAINING}</span>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="settings-card training-import-card">
        {entries.length === 0 ? (
          <div className="preview-empty">
            <div className="pe-icon">🎓</div>
            <div className="pe-title">还没有选择培训资料</div>
            <div className="pe-sub">
              点击「选择培训资料」可一次选多份，系统会从文件名和资料封面自动识别培训时间、培训人，识别结果可在下方修改。
            </div>
          </div>
        ) : (
          <div className="training-import-list">
            <div className="training-import-head">
              <span>培训资料名</span>
              <span>培训人</span>
              <span>培训时间</span>
              <span>类别</span>
              <span>源文件</span>
              <span>状态</span>
              <span />
            </div>
            {entries.map((e) => (
              <div className="training-import-row" key={e.uid}>
                <input
                  className="training-input"
                  value={e.title}
                  disabled={e.status === 'done' || e.status === 'importing'}
                  onChange={(ev) => patch(e.uid, { title: ev.target.value })}
                  placeholder="如 空滤器设计规范"
                />
                <input
                  className="training-input"
                  value={e.trainer}
                  disabled={e.status === 'done' || e.status === 'importing'}
                  onChange={(ev) => patch(e.uid, { trainer: ev.target.value, manualTrainer: true })}
                  placeholder="如 张三"
                />
                <input
                  className="training-input"
                  type="date"
                  value={e.trainedAt}
                  disabled={e.status === 'done' || e.status === 'importing'}
                  onChange={(ev) => patch(e.uid, { trainedAt: ev.target.value, manualDate: true })}
                />
                <select
                  className="training-input"
                  value={e.category}
                  disabled={e.status === 'done' || e.status === 'importing'}
                  onChange={(ev) => patch(e.uid, { category: ev.target.value })}
                >
                  <option value="">未分类</option>
                  {TRAINING_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className="training-source" title={e.fileName}>
                  {e.fileName}
                </span>
                <span
                  className={
                    e.status === 'done'
                      ? 'training-state ok'
                      : e.status === 'error'
                        ? 'training-state err'
                        : 'training-state'
                  }
                >
                  {e.status === 'idle' && (e.reading ? '正在识别封面…' : e.coverNote || '待导入')}
                  {e.status === 'importing' && e.message}
                  {e.status === 'done' && e.message}
                  {e.status === 'error' && e.message}
                </span>
                {e.status === 'idle' || e.status === 'error' ? (
                  <button
                    className="btn-link danger sm"
                    disabled={busy}
                    onClick={() => setEntries((prev) => prev.filter((x) => x.uid !== e.uid))}
                  >
                    移除
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
