import { useState } from 'react';
import { templateIssues } from '../product/template';
import { createParam, createRequirement, nowIso, type ModelTemplate } from '../product/types';

interface Props {
  /** 编辑对象：新建时传空白模板，编辑已有模板时传该模板 */
  initial: ModelTemplate;
  onSave: (tpl: ModelTemplate) => void;
  onClose: () => void;
}

const numOrNull = (v: string): number | null => {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const numText = (v: number | null) => (v == null ? '' : String(v));

/**
 * 型号模板编辑器：手工搭建需求与参数骨架，或修改已有模板。
 * 模板不保存参数取值，因此参数只维护定义（键、名称、单位、上下限）。
 */
export function TemplateEditor({ initial, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<ModelTemplate>(initial);
  const [error, setError] = useState('');
  const issues = templateIssues(draft);

  const patchReq = (id: string, next: Partial<ModelTemplate['requirements'][number]>) =>
    setDraft((d) => ({
      ...d,
      requirements: d.requirements.map((r) => (r.id === id ? { ...r, ...next } : r)),
    }));

  const patchParam = (id: string, next: Partial<ModelTemplate['params'][number]>) =>
    setDraft((d) => ({ ...d, params: d.params.map((p) => (p.id === id ? { ...p, ...next } : p)) }));

  const save = () => {
    if (issues.length) {
      setError(issues[0]);
      return;
    }
    onSave({ ...draft, name: draft.name.trim(), system: draft.system.trim(), updatedAt: nowIso() });
  };

  return (
    <div className="prod-modal-mask" onClick={onClose}>
      <div className="prod-modal" style={{ width: 960 }} onClick={(e) => e.stopPropagation()}>
        <h3>模板搭建</h3>
        <p className="settings-hint">
          手工定义需求目标、关键参数与设计标准，套用后会生成草稿型号，参数需按项目重新计算。
        </p>
        <div className="prod-head" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <label className="kbe-field">
            <span>模板名称</span>
            <input
              className="training-input"
              placeholder="如 空滤通用骨架"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="kbe-field">
            <span>适用系统</span>
            <input
              className="training-input"
              placeholder="如 进气系统"
              value={draft.system}
              onChange={(e) => setDraft({ ...draft, system: e.target.value })}
            />
          </label>
        </div>
        <label className="kbe-field">
          <span>模板说明</span>
          <input
            className="training-input"
            placeholder="适用场景、注意事项等，可空"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        <label className="kbe-field">
          <span>设计标准（每行一条）</span>
          <textarea
            className="training-input"
            rows={2}
            placeholder={'QC/T 32-2017\nISO 5011'}
            value={draft.standards.join('\n')}
            onChange={(e) =>
              setDraft({
                ...draft,
                standards: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>

        <p className="panel-title" style={{ marginTop: 14 }}>
          需求清单
        </p>
        <table className="prod-table">
          <thead>
            <tr>
              <th style={{ width: '28%' }}>需求项</th>
              <th style={{ width: 100 }}>目标值</th>
              <th style={{ width: 90 }}>单位</th>
              <th style={{ width: 100 }}>方向</th>
              <th style={{ width: 90 }}>特性</th>
              <th style={{ width: 110 }}>验证方式</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.requirements.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    className="training-input"
                    placeholder="如 初始压降"
                    value={r.name}
                    onChange={(e) => patchReq(r.id, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="training-input"
                    value={numText(r.target)}
                    onChange={(e) => patchReq(r.id, { target: numOrNull(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    className="training-input"
                    placeholder="kPa"
                    value={r.unit}
                    onChange={(e) => patchReq(r.id, { unit: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="training-input"
                    value={r.direction}
                    onChange={(e) => patchReq(r.id, { direction: e.target.value as 'max' | 'min' })}
                  >
                    <option value="max">不大于</option>
                    <option value="min">不小于</option>
                  </select>
                </td>
                <td>
                  <select
                    className="training-input"
                    value={r.priority}
                    onChange={(e) =>
                      patchReq(r.id, { priority: e.target.value as 'CC' | 'SC' | 'normal' })
                    }
                  >
                    <option value="normal">一般</option>
                    <option value="SC">SC</option>
                    <option value="CC">CC</option>
                  </select>
                </td>
                <td>
                  <select
                    className="training-input"
                    value={r.verify}
                    onChange={(e) => patchReq(r.id, { verify: e.target.value as 'calc' | 'cae' | 'test' })}
                  >
                    <option value="calc">计算</option>
                    <option value="cae">CAE</option>
                    <option value="test">试验</option>
                  </select>
                </td>
                <td>
                  <button
                    className="btn-link danger sm"
                    onClick={() =>
                      setDraft((d) => ({ ...d, requirements: d.requirements.filter((x) => x.id !== r.id) }))
                    }
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="btn-ghost sm prod-add"
          onClick={() => setDraft((d) => ({ ...d, requirements: [...d.requirements, createRequirement()] }))}
        >
          + 添加需求项
        </button>

        <p className="panel-title" style={{ marginTop: 14 }}>
          关键参数
        </p>
        <table className="prod-table">
          <thead>
            <tr>
              <th style={{ width: '26%' }}>参数名</th>
              <th style={{ width: '20%' }}>参数键</th>
              <th style={{ width: 90 }}>单位</th>
              <th style={{ width: 110 }}>下限</th>
              <th style={{ width: 110 }}>上限</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.params.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    className="training-input"
                    placeholder="如 滤芯外径"
                    value={p.label}
                    onChange={(e) => patchParam(p.id, { label: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="training-input mono"
                    placeholder="D"
                    value={p.key}
                    onChange={(e) => patchParam(p.id, { key: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="training-input"
                    placeholder="mm"
                    value={p.unit}
                    onChange={(e) => patchParam(p.id, { unit: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="training-input"
                    value={p.min == null ? '' : String(p.min)}
                    onChange={(e) => patchParam(p.id, { min: numOrNull(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    className="training-input"
                    value={p.max == null ? '' : String(p.max)}
                    onChange={(e) => patchParam(p.id, { max: numOrNull(e.target.value) })}
                  />
                </td>
                <td>
                  <button
                    className="btn-link danger sm"
                    onClick={() => setDraft((d) => ({ ...d, params: d.params.filter((x) => x.id !== p.id) }))}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="btn-ghost sm prod-add"
          onClick={() => setDraft((d) => ({ ...d, params: [...d.params, createParam()] }))}
        >
          + 添加关键参数
        </button>

        {(error || issues.length > 0) && (
          <p className="settings-hint" style={{ color: 'var(--danger)' }}>
            {error || issues.join('；')}
          </p>
        )}
        <div className="prod-modal-actions">
          <button className="btn-primary sm" onClick={save}>
            保存模板
          </button>
          <button className="btn-ghost sm" onClick={onClose}>
            取消
          </button>
          <span className="settings-hint" style={{ marginLeft: 'auto' }}>
            需求 {draft.requirements.length} 项 · 参数 {draft.params.length} 个 · 标准{' '}
            {draft.standards.length} 条
          </span>
        </div>
      </div>
    </div>
  );
}
