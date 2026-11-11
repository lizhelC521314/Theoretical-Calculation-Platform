import { useEffect, useMemo, useState } from 'react';
import { api, type CtrUser, type HistoryEntry, type Project } from '../api';
import { getFormula } from '../formula/registry';
import { attachCalcRef, buildCalcParams, buildCalcRef } from '../product/calcRef';
import {
  EMPTY_STORE,
  MODEL_STATUS_LABEL,
  PARAM_SOURCE_LABEL,
  VERIFY_LABEL,
  createFamily,
  createModel,
  createParam,
  createRequirement,
  nowIso,
  uid,
  type Baseline,
  type CalcRef,
  type ModelStatus,
  type ModelTemplate,
  type ProductFamily,
  type ProductModel,
  type ProductStore,
} from '../product/types';
import { runGate } from '../product/gate';
import { analyzeImpact, IMPACT_LABEL } from '../product/impact';
import { archiveDesignArchive } from '../product/archive';
import { findSimilarModels } from '../product/similar';
import { createBlankTemplate, modelFromTemplate, templateFromModel } from '../product/template';
import { createVariant } from '../product/variant';
import { TemplateEditor } from '../components/TemplateEditor';

interface Props {
  user: CtrUser;
}

type Tab = 'req' | 'param' | 'calc' | 'similar' | 'impact' | 'version' | 'gate';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'req', label: '需求清单' },
  { key: 'param', label: '关键参数' },
  { key: 'calc', label: '计算与校核' },
  { key: 'similar', label: '相似型号' },
  { key: 'impact', label: '变更影响' },
  { key: 'version', label: '版本基线' },
  { key: 'gate', label: '发布门禁' },
];

const numOrNull = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const numText = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? '' : String(v));

/**
 * 产品定义库（P0）
 * 无三维建模时，用「产品族 → 型号 → 需求 / 关键参数 / 计算校核 / 版本基线」管理设计结果。
 */
export function ProductLibraryPage({ user }: Props) {
  const [store, setStore] = useState<ProductStore>(EMPTY_STORE);
  const [loading, setLoading] = useState(true);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('req');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [baselineNote, setBaselineNote] = useState('');
  /** 正在重新导出设计档案的基线 id（空表示空闲） */
  const [exportingId, setExportingId] = useState('');
  const [toast, setToast] = useState('');
  const [newFamily, setNewFamily] = useState(false);
  const [newModel, setNewModel] = useState(false);
  const [familyDraft, setFamilyDraft] = useState({ code: '', name: '', system: '', structure: '' });
  const [modelDraft, setModelDraft] = useState({ id: '', name: '', customer: '' });
  /** 型号 P/N 的编辑草稿：失焦时才提交重命名，避免逐字改动导致型号丢失 */
  const [pnDraft, setPnDraft] = useState('');
  /** 变型模板：源型号与新建草稿 */
  const [variantSource, setVariantSource] = useState<ProductModel | null>(null);
  const [variantDraft, setVariantDraft] = useState({
    id: '',
    name: '',
    customer: '',
    copyReq: true,
    copyParam: true,
    copyStd: true,
    copyCalc: false,
    keepValues: true,
  });
  /** 相似检索：是否只看同族 */
  const [sameFamilyOnly, setSameFamilyOnly] = useState(false);
  /** 型号模板库：保存当前型号为模板 / 从模板新建型号 */
  const [tplModal, setTplModal] = useState<null | 'save' | 'use'>(null);
  const [tplDraft, setTplDraft] = useState({ name: '', system: '', description: '' });
  const [tplNew, setTplNew] = useState({ templateId: '', familyId: '', id: '', name: '', customer: '' });
  /** 模板编辑器：null 表示未打开 */
  const [tplEditing, setTplEditing] = useState<ModelTemplate | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2400);
  };

  // 首次加载：产品定义库快照 + 计算记录 + 项目列表
  useEffect(() => {
    let alive = true;
    Promise.all([api.product.get(), api.history.list(user.id), api.project.list(user.id)])
      .then(([snapshot, hist, proj]) => {
        if (!alive) return;
        const s = snapshot ?? EMPTY_STORE;
        // 兼容早期快照：模板库是后加字段，缺失时按空库处理
        setStore({ families: s.families ?? [], models: s.models ?? [], templates: s.templates ?? [] });
        setFamilyId(s.families[0]?.id ?? null);
        setHistory(hist);
        setProjects(proj);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user.id]);

  // 改动后延时落盘，避免逐字写文件
  useEffect(() => {
    if (loading) return;
    const t = window.setTimeout(() => {
      void api.product.set(store);
    }, 400);
    return () => window.clearTimeout(t);
  }, [store, loading]);

  const family = store.families.find((f) => f.id === familyId) ?? null;
  const familyModels = useMemo(
    () => store.models.filter((m) => m.familyId === familyId),
    [store.models, familyId],
  );
  const model = store.models.find((m) => m.id === modelId) ?? null;
  const gate = useMemo(() => (model ? runGate(model) : null), [model]);

  useEffect(() => {
    setPnDraft(model?.id ?? '');
  }, [model?.id]);

  /** 相似型号：默认在全库范围比对，可切换为只看同族 */
  const similar = useMemo(
    () => (model ? findSimilarModels(store.models, model, { sameFamilyOnly }) : []),
    [store.models, model, sameFamilyOnly],
  );

  /** 变更影响：反查共用标准、同名需求、同参数键与下游变型的型号 */
  const impacts = useMemo(
    () => (model ? analyzeImpact(store.models, model) : []),
    [store.models, model],
  );

  /** 存为模板：从当前型号提炼需求/参数/标准骨架 */
  const openSaveTemplate = () => {
    if (!model) return;
    setTplDraft({ name: `${model.name} 模板`, system: family?.system || '', description: '' });
    setTplModal('save');
  };

  const submitSaveTemplate = () => {
    if (!model) return;
    if (!tplDraft.name.trim()) {
      showToast('请填写模板名称');
      return;
    }
    const tpl = templateFromModel(model, tplDraft);
    setStore((prev) => ({ ...prev, templates: [tpl, ...(prev.templates ?? [])] }));
    setTplModal(null);
    showToast('已存为模板（参数取值不随模板保存，套用后需重新计算）');
  };

  const openUseTemplate = () => {
    const tpls = store.templates ?? [];
    if (tpls.length === 0) {
      showToast('模板库为空，先在一个型号上「存为模板」');
      return;
    }
    setTplNew({
      templateId: tpls[0].id,
      familyId: family?.id ?? store.families[0]?.id ?? '',
      id: '',
      name: '',
      customer: '',
    });
    setTplModal('use');
  };

  const submitUseTemplate = () => {
    const tpl = (store.templates ?? []).find((t) => t.id === tplNew.templateId);
    if (!tpl) {
      showToast('请选择模板');
      return;
    }
    const id = tplNew.id.trim();
    if (!id) {
      showToast('请填写新型号 P/N');
      return;
    }
    if (store.models.some((m) => m.id === id)) {
      showToast('型号 P/N 已存在');
      return;
    }
    if (!tplNew.familyId) {
      showToast('请选择产品族');
      return;
    }
    const created = modelFromTemplate(tpl, tplNew.familyId, {
      id,
      name: tplNew.name,
      customer: tplNew.customer,
      owner: user.displayName || user.username,
    });
    setStore((prev) => ({ ...prev, models: [...prev.models, created] }));
    setFamilyId(created.familyId);
    setModelId(created.id);
    setTab('req');
    setTplModal(null);
    showToast(`已按模板「${tpl.name}」新建 ${created.id}`);
  };

  /** 模板编辑器保存：同 id 覆盖，否则作为新模板插入 */
  const upsertTemplate = (tpl: ModelTemplate) => {
    setStore((prev) => {
      const list = prev.templates ?? [];
      const exists = list.some((t) => t.id === tpl.id);
      return {
        ...prev,
        templates: exists ? list.map((t) => (t.id === tpl.id ? tpl : t)) : [tpl, ...list],
      };
    });
    setTplEditing(null);
    showToast('模板已保存');
  };

  const removeTemplate = (id: string) => {
    const tpl = (store.templates ?? []).find((t) => t.id === id);
    if (!tpl || !window.confirm(`确认删除模板「${tpl.name}」？`)) return;
    setStore((prev) => ({ ...prev, templates: (prev.templates ?? []).filter((t) => t.id !== id) }));
    setTplNew((prev) => ({ ...prev, templateId: '' }));
    showToast('模板已删除');
  };

  const openVariant = (src: ProductModel) => {
    setVariantSource(src);
    setVariantDraft({
      id: '',
      name: `${src.name} 变型`,
      customer: src.customer,
      copyReq: true,
      copyParam: true,
      copyStd: true,
      copyCalc: false,
      keepValues: true,
    });
  };

  const submitVariant = () => {
    if (!variantSource) return;
    const id = variantDraft.id.trim();
    if (!id) {
      showToast('请填写新型号 P/N');
      return;
    }
    if (store.models.some((m) => m.id === id)) {
      showToast('型号 P/N 已存在');
      return;
    }
    const created = createVariant(variantSource, {
      id,
      name: variantDraft.name,
      customer: variantDraft.customer,
      copyRequirements: variantDraft.copyReq,
      copyParams: variantDraft.copyParam,
      copyStandards: variantDraft.copyStd,
      copyCalcRefs: variantDraft.copyCalc,
      keepValues: variantDraft.keepValues,
    });
    setStore((prev) => ({ ...prev, models: [...prev.models, created] }));
    setFamilyId(created.familyId);
    setModelId(created.id);
    setTab('req');
    setVariantSource(null);
    showToast(`已按 ${variantSource.id} 生成变型 ${created.id}`);
  };

  const updateFamily = (id: string, patch: Partial<ProductFamily>) => {
    setStore((prev) => ({
      ...prev,
      families: prev.families.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: nowIso() } : f)),
    }));
  };

  const patchModel = (fn: (m: ProductModel) => ProductModel) => {
    if (!model) return;
    const next = { ...fn(model), updatedAt: nowIso() };
    setStore((prev) => ({ ...prev, models: prev.models.map((m) => (m.id === next.id ? next : m)) }));
  };

  const createNewFamily = () => {
    if (!familyDraft.name.trim()) {
      showToast('请填写产品族名称');
      return;
    }
    const f = createFamily(familyDraft);
    setStore((prev) => ({ ...prev, families: [...prev.families, f] }));
    setFamilyId(f.id);
    setModelId(null);
    setNewFamily(false);
    setFamilyDraft({ code: '', name: '', system: '', structure: '' });
  };

  const createNewModel = () => {
    if (!familyId) return;
    if (!modelDraft.id.trim() || !modelDraft.name.trim()) {
      showToast('请填写型号 P/N 与名称');
      return;
    }
    const id = modelDraft.id.trim();
    if (store.models.some((m) => m.id === id)) {
      showToast('型号 P/N 已存在');
      return;
    }
    const m = createModel(familyId, { id, name: modelDraft.name.trim(), customer: modelDraft.customer.trim() });
    setStore((prev) => ({ ...prev, models: [...prev.models, m] }));
    setModelId(m.id);
    setNewModel(false);
    setModelDraft({ id: '', name: '', customer: '' });
  };

  const removeModel = () => {
    if (!model) return;
    if (!window.confirm(`确认删除型号「${model.id}」及其需求、参数与基线？`)) return;
    setStore((prev) => ({ ...prev, models: prev.models.filter((m) => m.id !== model.id) }));
    setModelId(null);
  };

  const removeFamily = () => {
    if (!family) return;
    const count = store.models.filter((m) => m.familyId === family.id).length;
    if (!window.confirm(`确认删除产品族「${family.name}」${count ? `及其 ${count} 个型号` : ''}？`)) return;
    setStore((prev) => ({
      ...prev,
      families: prev.families.filter((f) => f.id !== family.id),
      models: prev.models.filter((m) => m.familyId !== family.id),
    }));
    setFamilyId(null);
    setModelId(null);
  };

  /** 关联历史计算记录：快照输出值，并把尚未记录的数值输出补成参数 */
  const addCalcRef = (h: HistoryEntry) => {
    if (!model) return;
    const ref = buildCalcRef(h);
    const params = buildCalcParams(
      getFormula(h.formulaId)?.outputs ?? [],
      ref,
      model.params.map((p) => p.key),
    );
    patchModel((m) => attachCalcRef(m, ref, params));
    setShowPicker(false);
    showToast(params.length ? `已关联，并补入 ${params.length} 个计算参数` : '已关联计算记录');
  };

  const publish = async () => {
    if (!model || !gate) return;
    if (!gate.ok) {
      setToast('发布门禁未通过，请先处理错误项');
      return;
    }
    const label = `V${model.baselines.length + 1}.0`;
    const baseline: Baseline = {
      id: uid(),
      label,
      createdAt: nowIso(),
      createdBy: user.displayName || user.username,
      note: baselineNote.trim() || '发布基线',
      params: model.params.map((p) => ({ key: p.key, label: p.label, value: p.value, unit: p.unit })),
      calcRefIds: model.calcRefs.map((c) => c.id),
      requirementCount: model.requirements.length,
      errorCount: gate.errors,
      warnCount: gate.warns,
    };
    const released: ProductModel = { ...model, status: 'released', baselines: [baseline, ...model.baselines] };
    patchModel(() => released);
    setBaselineNote('');
    showToast(`已发布，生成基线 ${label}，正在归档设计档案…`);
    // 发布即归档：设计档案落到产品设计库，避免只在应用内留痕
    const res = await archiveDesignArchive(released, family ?? null, baseline);
    showToast(
      res.ok
        ? `已发布 ${label}，设计档案已归档`
        : `已发布 ${label}，但设计档案归档失败：${res.message ?? '未知错误'}`,
    );
  };

  /** 对历史基线重新导出设计档案（用于补导出、或共享目录写入失败后重试） */
  const reexportArchive = async (b: Baseline) => {
    if (!model) return;
    setExportingId(b.id);
    try {
      const res = await archiveDesignArchive(model, family ?? null, b);
      showToast(
        res.ok
          ? `${b.label} 设计档案已重新导出`
          : `${b.label} 导出失败：${res.message ?? '未知错误'}`,
      );
    } finally {
      setExportingId('');
    }
  };

  const releasedCount = store.models.filter((m) => m.status === 'released').length;
  const familyName = (id: string) => store.families.find((f) => f.id === id)?.name || '未归类';
  const tplSel = (store.templates ?? []).find((t) => t.id === tplNew.templateId) ?? null;

  return (
    <div className="test-search fmea-page training-page">
      <div className="settings-card">
        <div className="ts-head">
          <h3>产品定义库</h3>
          <div className="ts-status">
            <span className="chip">产品族 {store.families.length}</span>
            <span className="chip">型号 {store.models.length}</span>
            <span className="chip">已发布 {releasedCount}</span>
            <span className="chip">模板 {(store.templates ?? []).length}</span>
            <button className="btn-ghost sm" onClick={openUseTemplate}>
              从模板新建
            </button>
            <button className="btn-ghost sm" onClick={() => setTplEditing(createBlankTemplate())}>
              手工新建模板
            </button>
            <button className="btn-ghost sm" onClick={() => setNewFamily((v) => !v)}>
              {newFamily ? '取消' : '+ 新建产品族'}
            </button>
          </div>
        </div>

        {newFamily && (
          <div className="prod-form-row">
            <input
              className="training-input"
              placeholder="族编码，如 AF-CYL"
              value={familyDraft.code}
              onChange={(e) => setFamilyDraft({ ...familyDraft, code: e.target.value })}
            />
            <input
              className="training-input"
              placeholder="产品族名称，如 圆柱折叠式空气滤清器"
              value={familyDraft.name}
              onChange={(e) => setFamilyDraft({ ...familyDraft, name: e.target.value })}
            />
            <input
              className="training-input"
              placeholder="所属系统，如 进气系统"
              value={familyDraft.system}
              onChange={(e) => setFamilyDraft({ ...familyDraft, system: e.target.value })}
            />
            <input
              className="training-input"
              placeholder="结构型式，如 圆柱折叠式"
              value={familyDraft.structure}
              onChange={(e) => setFamilyDraft({ ...familyDraft, structure: e.target.value })}
            />
            <button className="btn-primary sm" onClick={createNewFamily}>
              创建
            </button>
          </div>
        )}

        <div className="fmea-body" style={{ gridTemplateColumns: '300px minmax(0, 1fr)', marginTop: 6 }}>
          <div className="fmea-list">
            {store.families.map((f) => {
              const count = store.models.filter((m) => m.familyId === f.id).length;
              return (
                <div
                  key={f.id}
                  className={f.id === familyId ? 'fmea-item active' : 'fmea-item'}
                  onClick={() => {
                    setFamilyId(f.id);
                    setModelId(null);
                  }}
                >
                  <div className="fmea-item-top">
                    <span className="fmea-item-id">{f.code || '未编码'}</span>
                    <span className="fmea-year">{count} 型号</span>
                  </div>
                  <div className="fmea-item-part">{f.name}</div>
                  <div className="fmea-item-action">
                    {f.system || '未填系统'}
                    {f.structure ? ` · ${f.structure}` : ''}
                  </div>
                </div>
              );
            })}
            {store.families.length === 0 && !loading && (
              <div className="fmea-list-empty">还没有产品族，点右上角「+ 新建产品族」开始。</div>
            )}

            {family && (
              <>
                <div className="prod-side-label">
                  {family.name} · 型号
                  <button className="btn-link sm" onClick={() => setNewModel((v) => !v)}>
                    {newModel ? '取消' : '+ 新建型号'}
                  </button>
                </div>
                {newModel && (
                  <div className="prod-new-model">
                    <input
                      className="training-input"
                      placeholder="型号 P/N"
                      value={modelDraft.id}
                      onChange={(e) => setModelDraft({ ...modelDraft, id: e.target.value })}
                    />
                    <input
                      className="training-input"
                      placeholder="型号名称"
                      value={modelDraft.name}
                      onChange={(e) => setModelDraft({ ...modelDraft, name: e.target.value })}
                    />
                    <input
                      className="training-input"
                      placeholder="客户（可空）"
                      value={modelDraft.customer}
                      onChange={(e) => setModelDraft({ ...modelDraft, customer: e.target.value })}
                    />
                    <button className="btn-primary sm" onClick={createNewModel}>
                      创建
                    </button>
                  </div>
                )}
                {familyModels.map((m) => (
                  <div
                    key={m.id}
                    className={m.id === modelId ? 'fmea-item active' : 'fmea-item'}
                    onClick={() => {
                      setModelId(m.id);
                      setTab('req');
                    }}
                  >
                    <div className="fmea-item-top">
                      <span className="fmea-item-id">{m.id}</span>
                      <span className="fmea-year">{MODEL_STATUS_LABEL[m.status]}</span>
                    </div>
                    <div className="fmea-item-part">{m.name}</div>
                    <div className="fmea-item-action">
                      需求 {m.requirements.length} · 参数 {m.params.length} · 计算 {m.calcRefs.length}
                    </div>
                  </div>
                ))}
                {familyModels.length === 0 && (
                  <div className="fmea-list-empty">该族下还没有型号。</div>
                )}
              </>
            )}
          </div>

          <div className="prod-detail">
            {!family && (
              <div className="preview-empty">
                <div className="pe-icon">📦</div>
                <div className="pe-title">先创建或选择一个产品族</div>
                <div className="pe-sub">
                  产品族用来归并同一结构型式的型号；型号里记录性能需求、关键参数、计算校核与版本基线。
                </div>
              </div>
            )}

            {family && !model && (
              <>
                <div className="fmea-detail-head">
                  <h3>{family.name}</h3>
                  <div className="preview-meta">
                    <span className="chip">{family.code || '未编码'}</span>
                    <span className="chip">{family.system || '未填系统'}</span>
                    <span className="chip">{family.structure || '未填结构型式'}</span>
                    <button className="btn-link danger sm" onClick={removeFamily}>
                      删除产品族
                    </button>
                  </div>
                </div>
                <div className="kbe-edit-grid">
                  <label className="kbe-field">
                    <span>族编码</span>
                    <input
                      className="training-input"
                      value={family.code}
                      onChange={(e) => updateFamily(family.id, { code: e.target.value })}
                    />
                  </label>
                  <label className="kbe-field">
                    <span>产品族名称</span>
                    <input
                      className="training-input"
                      value={family.name}
                      onChange={(e) => updateFamily(family.id, { name: e.target.value })}
                    />
                  </label>
                  <label className="kbe-field">
                    <span>所属系统</span>
                    <input
                      className="training-input"
                      value={family.system}
                      onChange={(e) => updateFamily(family.id, { system: e.target.value })}
                    />
                  </label>
                  <label className="kbe-field">
                    <span>结构型式</span>
                    <input
                      className="training-input"
                      value={family.structure}
                      onChange={(e) => updateFamily(family.id, { structure: e.target.value })}
                    />
                  </label>
                  <label className="kbe-field">
                    <span>适用平台 / 客户</span>
                    <input
                      className="training-input"
                      value={family.platforms}
                      onChange={(e) => updateFamily(family.id, { platforms: e.target.value })}
                    />
                  </label>
                  <label className="kbe-field">
                    <span>说明</span>
                    <input
                      className="training-input"
                      value={family.description}
                      onChange={(e) => updateFamily(family.id, { description: e.target.value })}
                    />
                  </label>
                </div>
                <p className="settings-hint">选择一个型号，或新建型号后进入「需求—参数—计算—基线」工作台。</p>
              </>
            )}

            {model && gate && (
              <>
                <div className="fmea-detail-head">
                  <h3>
                    {model.name}
                    <span className="prod-pn">{model.id}</span>
                  </h3>
                  <div className="preview-meta">
                    <span className={model.status === 'released' ? 'chip ok' : 'chip'}>
                      {MODEL_STATUS_LABEL[model.status]}
                    </span>
                    <span className={gate.ok ? 'chip ok' : 'chip err'}>
                      门禁 错误 {gate.errors} · 提示 {gate.warns}
                    </span>
                    {model.derivedFrom && <span className="chip">变型自 {model.derivedFrom}</span>}
                    <button className="btn-link sm" onClick={openSaveTemplate}>
                      存为模板
                    </button>
                    <button className="btn-link sm" onClick={() => openVariant(model)}>
                      另存为变型
                    </button>
                    <button className="btn-link danger sm" onClick={removeModel}>
                      删除型号
                    </button>
                  </div>
                </div>

                <div className="prod-head">
                  <label className="kbe-field">
                    <span>型号 P/N</span>
                    <input
                      className="training-input"
                      value={pnDraft}
                      onChange={(e) => setPnDraft(e.target.value)}
                      onBlur={() => {
                        const id = pnDraft.trim();
                        if (!model || !id || id === model.id) {
                          setPnDraft(model?.id ?? '');
                          return;
                        }
                        if (store.models.some((m) => m.id === id && m.id !== model.id)) {
                          setPnDraft(model.id);
                          showToast('型号 P/N 已存在，已还原');
                          return;
                        }
                        patchModel((m) => ({ ...m, id }));
                        setModelId(id);
                      }}
                    />
                  </label>
                  <label className="kbe-field">
                    <span>型号名称</span>
                    <input
                      className="training-input"
                      value={model.name}
                      onChange={(e) => patchModel((m) => ({ ...m, name: e.target.value }))}
                    />
                  </label>
                  <label className="kbe-field">
                    <span>状态</span>
                    <select
                      className="training-input"
                      value={model.status}
                      onChange={(e) => patchModel((m) => ({ ...m, status: e.target.value as ModelStatus }))}
                    >
                      {(Object.keys(MODEL_STATUS_LABEL) as ModelStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {MODEL_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="kbe-field">
                    <span>客户</span>
                    <input
                      className="training-input"
                      value={model.customer}
                      onChange={(e) => patchModel((m) => ({ ...m, customer: e.target.value }))}
                    />
                  </label>
                  <label className="kbe-field">
                    <span>设计负责人</span>
                    <input
                      className="training-input"
                      value={model.owner}
                      onChange={(e) => patchModel((m) => ({ ...m, owner: e.target.value }))}
                    />
                  </label>
                  <label className="kbe-field">
                    <span>绑定项目</span>
                    <select
                      className="training-input"
                      value={model.projectId ?? ''}
                      onChange={(e) => patchModel((m) => ({ ...m, projectId: e.target.value || null }))}
                    >
                      <option value="">未绑定</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="kbe-field kbe-span2">
                    <span>设计依据标准（可多条，用逗号或换行分隔）</span>
                    <input
                      className="training-input"
                      placeholder="如 ISO 5011、GB/T 28949-2025、客户技术规范"
                      value={model.standards.join('，')}
                      onChange={(e) =>
                        patchModel((m) => ({
                          ...m,
                          standards: e.target.value
                            .split(/[,，;；\n]/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="prod-tabs">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      className={tab === t.key ? 'prod-tab active' : 'prod-tab'}
                      onClick={() => setTab(t.key)}
                    >
                      {t.label}
                      {t.key === 'req' && `（${model.requirements.length}）`}
                      {t.key === 'param' && `（${model.params.length}）`}
                      {t.key === 'calc' && `（${model.calcRefs.length}）`}
                      {t.key === 'version' && `（${model.baselines.length}）`}
                    </button>
                  ))}
                </div>

                {tab === 'req' && (
                  <>
                    <table className="prod-table">
                      <thead>
                        <tr>
                          <th style={{ width: '22%' }}>需求项</th>
                          <th style={{ width: 90 }}>目标值</th>
                          <th style={{ width: 80 }}>单位</th>
                          <th style={{ width: 90 }}>方向</th>
                          <th style={{ width: 80 }}>特性</th>
                          <th style={{ width: '20%' }}>来源</th>
                          <th style={{ width: 88 }}>验证方式</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {model.requirements.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <input
                                className="training-input"
                                placeholder="如 初始压降"
                                value={r.name}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    requirements: m.requirements.map((x) =>
                                      x.id === r.id ? { ...x, name: e.target.value } : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="training-input"
                                value={numText(r.target)}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    requirements: m.requirements.map((x) =>
                                      x.id === r.id ? { ...x, target: numOrNull(e.target.value) } : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="training-input"
                                placeholder="kPa"
                                value={r.unit}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    requirements: m.requirements.map((x) =>
                                      x.id === r.id ? { ...x, unit: e.target.value } : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <select
                                className="training-input"
                                value={r.direction}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    requirements: m.requirements.map((x) =>
                                      x.id === r.id
                                        ? { ...x, direction: e.target.value as 'max' | 'min' }
                                        : x,
                                    ),
                                  }))
                                }
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
                                  patchModel((m) => ({
                                    ...m,
                                    requirements: m.requirements.map((x) =>
                                      x.id === r.id
                                        ? { ...x, priority: e.target.value as 'CC' | 'SC' | 'normal' }
                                        : x,
                                    ),
                                  }))
                                }
                              >
                                <option value="normal">一般</option>
                                <option value="SC">SC</option>
                                <option value="CC">CC</option>
                              </select>
                            </td>
                            <td>
                              <input
                                className="training-input"
                                placeholder="客户 SOR / 标准条款"
                                value={r.source}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    requirements: m.requirements.map((x) =>
                                      x.id === r.id ? { ...x, source: e.target.value } : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <select
                                className="training-input"
                                value={r.verify}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    requirements: m.requirements.map((x) =>
                                      x.id === r.id ? { ...x, verify: e.target.value as 'calc' | 'cae' | 'test' } : x,
                                    ),
                                  }))
                                }
                              >
                                {(Object.keys(VERIFY_LABEL) as Array<'calc' | 'cae' | 'test'>).map((k) => (
                                  <option key={k} value={k}>
                                    {VERIFY_LABEL[k]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <button
                                className="btn-link danger sm"
                                onClick={() =>
                                  patchModel((m) => ({
                                    ...m,
                                    requirements: m.requirements.filter((x) => x.id !== r.id),
                                  }))
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
                      onClick={() =>
                        patchModel((m) => ({ ...m, requirements: [...m.requirements, createRequirement()] }))
                      }
                    >
                      + 添加需求项
                    </button>
                  </>
                )}

                {tab === 'param' && (
                  <>
                    <table className="prod-table">
                      <thead>
                        <tr>
                          <th style={{ width: '18%' }}>参数名</th>
                          <th style={{ width: '14%' }}>参数键</th>
                          <th style={{ width: 100 }}>数值</th>
                          <th style={{ width: 80 }}>单位</th>
                          <th style={{ width: 90 }}>下限</th>
                          <th style={{ width: 90 }}>上限</th>
                          <th style={{ width: 110 }}>来源</th>
                          <th style={{ width: '20%' }}>取值依据</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {model.params.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <input
                                className="training-input"
                                placeholder="如 滤芯外径"
                                value={p.label}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    params: m.params.map((x) =>
                                      x.id === p.id ? { ...x, label: e.target.value } : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="training-input mono"
                                placeholder="如 D"
                                value={p.key}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    params: m.params.map((x) =>
                                      x.id === p.id ? { ...x, key: e.target.value } : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="training-input"
                                value={numText(p.value)}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    params: m.params.map((x) =>
                                      x.id === p.id ? { ...x, value: numOrNull(e.target.value) } : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="training-input"
                                placeholder="mm"
                                value={p.unit}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    params: m.params.map((x) =>
                                      x.id === p.id ? { ...x, unit: e.target.value } : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="training-input"
                                value={numText(p.min)}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    params: m.params.map((x) =>
                                      x.id === p.id ? { ...x, min: numOrNull(e.target.value) } : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="training-input"
                                value={numText(p.max)}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    params: m.params.map((x) =>
                                      x.id === p.id ? { ...x, max: numOrNull(e.target.value) } : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <select
                                className="training-input"
                                value={p.source}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    params: m.params.map((x) =>
                                      x.id === p.id ? { ...x, source: e.target.value as typeof p.source } : x,
                                    ),
                                  }))
                                }
                              >
                                {(Object.keys(PARAM_SOURCE_LABEL) as Array<keyof typeof PARAM_SOURCE_LABEL>).map((k) => (
                                  <option key={k} value={k}>
                                    {PARAM_SOURCE_LABEL[k]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                className="training-input"
                                placeholder="公式名 v1.0 / 材料牌号"
                                value={p.basis}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    params: m.params.map((x) =>
                                      x.id === p.id ? { ...x, basis: e.target.value } : x,
                                    ),
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <button
                                className="btn-link danger sm"
                                onClick={() =>
                                  patchModel((m) => ({ ...m, params: m.params.filter((x) => x.id !== p.id) }))
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
                      onClick={() => patchModel((m) => ({ ...m, params: [...m.params, createParam()] }))}
                    >
                      + 添加参数
                    </button>
                  </>
                )}

                {tab === 'calc' && (
                  <>
                    <div className="prod-side-actions">
                      <button className="btn-ghost sm" onClick={() => setShowPicker((v) => !v)}>
                        {showPicker ? '收起计算记录' : '+ 关联计算记录'}
                      </button>
                      <span className="settings-hint">
                        关联后会把本次输出的数值项自动补进「关键参数」，并记录公式版本快照。
                      </span>
                    </div>
                    {showPicker && (
                      <div className="prod-picker">
                        {history.length === 0 && <div className="fmea-list-empty">还没有计算记录，先去计算页保存一次。</div>}
                        {history.slice(0, 25).map((h) => (
                          <div className="prod-picker-row" key={h.id}>
                            <span className="prod-picker-title">{h.formulaTitle}</span>
                            <span className="mono">v{h.formulaVersion || '—'}</span>
                            <span>{new Date(h.createdAt).toLocaleString('zh-CN')}</span>
                            <span className="prod-picker-proj">{h.projectId ? '项目内' : '临时计算'}</span>
                            <button className="btn-primary sm" onClick={() => addCalcRef(h)}>
                              关联
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <table className="prod-table">
                      <thead>
                        <tr>
                          <th>计算公式</th>
                          <th style={{ width: 80 }}>版本</th>
                          <th style={{ width: 170 }}>计算时间</th>
                          <th style={{ width: 120 }}>结论</th>
                          <th>输出项（SI）</th>
                          <th style={{ width: 60 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {model.calcRefs.map((c) => (
                          <tr key={c.id}>
                            <td>{c.formulaTitle}</td>
                            <td className="mono">v{c.formulaVersion || '—'}</td>
                            <td>{new Date(c.createdAt).toLocaleString('zh-CN')}</td>
                            <td>
                              <select
                                className="training-input"
                                value={c.conclusion}
                                onChange={(e) =>
                                  patchModel((m) => ({
                                    ...m,
                                    calcRefs: m.calcRefs.map((x) =>
                                      x.id === c.id
                                        ? { ...x, conclusion: e.target.value as CalcRef['conclusion'] }
                                        : x,
                                    ),
                                  }))
                                }
                              >
                                <option value="pending">待确认</option>
                                <option value="pass">满足</option>
                                <option value="fail">不满足</option>
                              </select>
                            </td>
                            <td className="prod-out">
                              {Object.entries(c.outputs)
                                .map(([k, v]) => `${k}=${Number(v.toPrecision(4))}`)
                                .join(' · ') || '—'}
                            </td>
                            <td>
                              <button
                                className="btn-link danger sm"
                                onClick={() =>
                                  patchModel((m) => ({
                                    ...m,
                                    calcRefs: m.calcRefs.filter((x) => x.id !== c.id),
                                  }))
                                }
                              >
                                移除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {model.calcRefs.length === 0 && <p className="settings-hint">还没有关联计算记录。</p>}
                  </>
                )}

                {tab === 'similar' && (
                  <>
                    <div className="prod-side-actions">
                      <label className="prod-check">
                        <input
                          type="checkbox"
                          checked={sameFamilyOnly}
                          onChange={(e) => setSameFamilyOnly(e.target.checked)}
                        />
                        仅在同产品族内检索
                      </label>
                      <span className="settings-hint">
                        以当前型号的需求项、关键参数与设计标准为基准做全库比对，得分越高说明可复用度越高。
                      </span>
                    </div>
                    {similar.length === 0 && (
                      <p className="settings-hint">
                        库里还没有可比较的其他型号。可以先在左侧新建型号，或用下方「变型」按钮派生一个。
                      </p>
                    )}
                    <div className="prod-sim-list">
                      {similar.map((s) => (
                        <div className="prod-sim" key={s.model.id}>
                          <div className="prod-sim-head">
                            <span className="prod-sim-score">{s.score}</span>
                            <div className="prod-sim-title">
                              <strong>{s.model.name}</strong>
                              <span className="mono">{s.model.id}</span>
                            </div>
                            <span className="chip">{familyName(s.model.familyId)}</span>
                            <span className={s.model.status === 'released' ? 'chip ok' : 'chip'}>
                              {MODEL_STATUS_LABEL[s.model.status]}
                            </span>
                            <span className="prod-sim-reasons">{s.reasons.join(' · ')}</span>
                            <button
                              className="btn-ghost sm"
                              onClick={() => {
                                setFamilyId(s.model.familyId);
                                setModelId(s.model.id);
                                setTab('req');
                              }}
                            >
                              查看
                            </button>
                            <button className="btn-ghost sm" onClick={() => openVariant(s.model)}>
                              以此为模板
                            </button>
                          </div>
                          {s.requirements.length > 0 && (
                            <div className="prod-sim-row">
                              <span className="prod-sim-label">需求</span>
                              {s.requirements.map((r) => (
                                <span className="chip light" key={r.name}>
                                  {r.name}
                                  {r.target != null ? ` ${r.target}${r.unit}` : ''}
                                  {r.deltaPct != null
                                    ? `（${r.deltaPct > 0 ? '+' : ''}${r.deltaPct.toFixed(0)}%）`
                                    : ''}
                                </span>
                              ))}
                            </div>
                          )}
                          {s.params.length > 0 && (
                            <div className="prod-sim-row">
                              <span className="prod-sim-label">参数</span>
                              {s.params.map((p) => (
                                <span className="chip light" key={p.key}>
                                  {p.label || p.key}
                                  {p.value != null ? ` ${Number(p.value.toPrecision(4))}${p.unit}` : ''}
                                </span>
                              ))}
                            </div>
                          )}
                          {s.sharedStandards.length > 0 && (
                            <div className="prod-sim-row">
                              <span className="prod-sim-label">标准</span>
                              {s.sharedStandards.map((t) => (
                                <span className="chip light" key={t}>
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="prod-side-actions" style={{ marginTop: 12 }}>
                      <button className="btn-ghost sm" onClick={() => openVariant(model)}>
                        以当前型号为模板新建变型
                      </button>
                      <span className="settings-hint">
                        变型会复制需求、参数与标准，清空基线并把状态置为草稿，同时记录来源型号便于追溯。
                      </span>
                    </div>
                  </>
                )}

                {tab === 'impact' && (
                  <>
                    <p className="settings-hint">
                      改这个型号的需求目标、参数口径或设计标准之前，先确认哪些型号被牵连：共用标准的需同步评估，同名需求与同参数的建议一起改。
                    </p>
                    {impacts.length === 0 && (
                      <p className="settings-hint">
                        当前型号的需求项、关键参数与设计标准没有被其他型号引用，变更不会波及其他型号。
                      </p>
                    )}
                    <div className="prod-sim-list">
                      {impacts.map((it) => (
                        <div className="prod-sim" key={it.model.id}>
                          <div className="prod-sim-head">
                            <span className="prod-sim-score">{it.hits.length}</span>
                            <div className="prod-sim-title">
                              <strong>{it.model.name}</strong>
                              <span className="mono">{it.model.id}</span>
                            </div>
                            <span className="chip">{familyName(it.model.familyId)}</span>
                            <span className={it.model.status === 'released' ? 'chip ok' : 'chip'}>
                              {MODEL_STATUS_LABEL[it.model.status]}
                            </span>
                            <span className="prod-sim-reasons">
                              受影响 {it.hits.length} 处
                            </span>
                            <button
                              className="btn-ghost sm"
                              onClick={() => {
                                setFamilyId(it.model.familyId);
                                setModelId(it.model.id);
                                setTab('req');
                              }}
                            >
                              查看
                            </button>
                          </div>
                          <div className="prod-sim-row">
                            {it.hits.map((h) => (
                              <span
                                className={h.kind === 'variant' ? 'chip ok' : 'chip light'}
                                key={`${h.kind}-${h.key}`}
                                title={h.detail}
                              >
                                {IMPACT_LABEL[h.kind]}：{h.key}
                                {h.kind === 'standard' ? '' : `（${h.detail}）`}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {tab === 'version' && (
                  <>
                    <div className="prod-side-actions">
                      <input
                        className="training-input prod-note"
                        placeholder="基线说明，如 首版发布 / 客户评审版"
                        value={baselineNote}
                        onChange={(e) => setBaselineNote(e.target.value)}
                      />
                      <button
                        className="btn-ghost sm"
                        onClick={() => {
                          if (!model) return;
                          const label = `V${model.baselines.length + 1}.0`;
                          const b: Baseline = {
                            id: uid(),
                            label,
                            createdAt: nowIso(),
                            createdBy: user.displayName || user.username,
                            note: baselineNote.trim() || '手工基线',
                            params: model.params.map((p) => ({
                              key: p.key,
                              label: p.label,
                              value: p.value,
                              unit: p.unit,
                            })),
                            calcRefIds: model.calcRefs.map((c) => c.id),
                            requirementCount: model.requirements.length,
                            errorCount: gate?.errors ?? 0,
                            warnCount: gate?.warns ?? 0,
                          };
                          patchModel((m) => ({ ...m, baselines: [b, ...m.baselines] }));
                          setBaselineNote('');
                          showToast(`已生成基线 ${label}`);
                        }}
                      >
                        + 生成基线
                      </button>
                    </div>
                    <table className="prod-table">
                      <thead>
                        <tr>
                          <th style={{ width: 90 }}>版本</th>
                          <th style={{ width: 170 }}>时间</th>
                          <th style={{ width: 110 }}>创建人</th>
                          <th>说明</th>
                          <th style={{ width: 150 }}>参数 / 需求 / 计算</th>
                          <th style={{ width: 120 }}>门禁</th>
                          <th style={{ width: 130 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {model.baselines.map((b) => (
                          <tr key={b.id}>
                            <td className="mono">{b.label}</td>
                            <td>{new Date(b.createdAt).toLocaleString('zh-CN')}</td>
                            <td>{b.createdBy}</td>
                            <td>{b.note}</td>
                            <td>
                              {b.params.length} / {b.requirementCount} / {b.calcRefIds.length}
                            </td>
                            <td>
                              错误 {b.errorCount} · 提示 {b.warnCount}
                            </td>
                            <td>
                              <button
                                className="btn-link sm"
                                onClick={() => void reexportArchive(b)}
                                disabled={exportingId === b.id}
                                title="重新生成该版本的设计档案并归档到产品设计库"
                              >
                                {exportingId === b.id ? '导出中…' : '导出档案'}
                              </button>
                              <button
                                className="btn-link danger sm"
                                onClick={() =>
                                  patchModel((m) => ({
                                    ...m,
                                    baselines: m.baselines.filter((x) => x.id !== b.id),
                                  }))
                                }
                              >
                                删除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {model.baselines.length === 0 && (
                      <p className="settings-hint">还没有基线。基线会固化当时的参数快照、需求数与关联计算记录。</p>
                    )}
                  </>
                )}

                {tab === 'gate' && (
                  <>
                    <div className="prod-side-actions">
                      <button className="btn-primary sm" onClick={publish} disabled={!gate.ok}>
                        发布并生成基线
                      </button>
                      <span className="settings-hint">
                        门禁无错误即可发布；提示项不阻断，但建议在发布前处理。
                      </span>
                    </div>
                    <div className="prod-gate">
                      {gate.issues.length === 0 && <div className="prod-issue">门禁通过，可以发布。</div>}
                      {gate.issues.map((i, idx) => (
                        <div key={`${i.scope}-${idx}`} className={i.level === 'error' ? 'prod-issue err' : 'prod-issue warn'}>
                          <span className="prod-issue-tag">{i.level === 'error' ? '错误' : '提示'}</span>
                          <span>{i.message}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {tplModal === 'save' && model && (
        <div className="prod-modal-mask" onClick={() => setTplModal(null)}>
          <div className="prod-modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3>存为型号模板</h3>
            <p className="settings-hint">
              来源型号 {model.id} · {model.name}。模板保存需求目标、参数定义与设计标准，参数取值不保存。
            </p>
            <div className="prod-head" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label className="kbe-field">
                <span>模板名称</span>
                <input
                  className="training-input"
                  value={tplDraft.name}
                  onChange={(e) => setTplDraft({ ...tplDraft, name: e.target.value })}
                />
              </label>
              <label className="kbe-field">
                <span>适用系统</span>
                <input
                  className="training-input"
                  placeholder="如 进气系统"
                  value={tplDraft.system}
                  onChange={(e) => setTplDraft({ ...tplDraft, system: e.target.value })}
                />
              </label>
            </div>
            <label className="kbe-field">
              <span>模板说明</span>
              <input
                className="training-input"
                placeholder="适用场景、注意事项等，可空"
                value={tplDraft.description}
                onChange={(e) => setTplDraft({ ...tplDraft, description: e.target.value })}
              />
            </label>
            <p className="settings-hint">
              包含：需求 {model.requirements.length} 项 · 参数 {model.params.length} 个 · 标准{' '}
              {model.standards.length} 条
            </p>
            <div className="prod-modal-actions">
              <button className="btn-primary sm" onClick={submitSaveTemplate}>
                保存模板
              </button>
              <button className="btn-ghost sm" onClick={() => setTplModal(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {tplModal === 'use' && (
        <div className="prod-modal-mask" onClick={() => setTplModal(null)}>
          <div className="prod-modal" onClick={(e) => e.stopPropagation()}>
            <h3>从模板新建型号</h3>
            <p className="settings-hint">
              套用后会生成草稿型号：需求与参数重新生成主键，参数取值留空，需按本项目重新计算并走发布门禁。
            </p>
            <label className="kbe-field">
              <span>选择模板</span>
              <select
                className="tu-project"
                value={tplNew.templateId}
                onChange={(e) => setTplNew({ ...tplNew, templateId: e.target.value })}
              >
                {(store.templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.system ? ` · ${t.system}` : ''}（需求 {t.requirements.length} / 参数{' '}
                    {t.params.length}）
                  </option>
                ))}
              </select>
            </label>
            {tplSel && (
              <div className="prod-sim-row" style={{ marginBottom: 8 }}>
                <span className="prod-sim-label">标准</span>
                {tplSel.standards.length === 0 && <span className="settings-hint">未关联标准</span>}
                {tplSel.standards.map((s) => (
                  <span className="chip light" key={s}>
                    {s}
                  </span>
                ))}
                {tplSel.description && (
                  <span className="settings-hint" style={{ marginLeft: 8 }}>
                    {tplSel.description}
                  </span>
                )}
              </div>
            )}
            <div className="prod-head" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <label className="kbe-field">
                <span>新型号 P/N</span>
                <input
                  className="training-input"
                  placeholder="如 AF-2026-010"
                  value={tplNew.id}
                  onChange={(e) => setTplNew({ ...tplNew, id: e.target.value })}
                />
              </label>
              <label className="kbe-field">
                <span>型号名称</span>
                <input
                  className="training-input"
                  value={tplNew.name}
                  onChange={(e) => setTplNew({ ...tplNew, name: e.target.value })}
                />
              </label>
              <label className="kbe-field">
                <span>客户</span>
                <input
                  className="training-input"
                  value={tplNew.customer}
                  onChange={(e) => setTplNew({ ...tplNew, customer: e.target.value })}
                />
              </label>
              <label className="kbe-field">
                <span>产品族</span>
                <select
                  className="tu-project"
                  value={tplNew.familyId}
                  onChange={(e) => setTplNew({ ...tplNew, familyId: e.target.value })}
                >
                  {store.families.length === 0 && <option value="">请先创建产品族</option>}
                  {store.families.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code ? `${f.code} · ` : ''}
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="prod-modal-actions">
              <button className="btn-primary sm" onClick={submitUseTemplate}>
                创建型号
              </button>
              <button className="btn-ghost sm" onClick={() => setTplModal(null)}>
                取消
              </button>
              {tplSel && (
                <button className="btn-link sm" style={{ marginLeft: 'auto' }} onClick={() => setTplEditing(tplSel)}>
                  编辑该模板
                </button>
              )}
              {tplSel && (
                <button className="btn-link danger sm" onClick={() => removeTemplate(tplSel.id)}>
                  删除该模板
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {tplEditing && (
        <TemplateEditor initial={tplEditing} onSave={upsertTemplate} onClose={() => setTplEditing(null)} />
      )}

      {variantSource && (
        <div className="prod-modal-mask" onClick={() => setVariantSource(null)}>
          <div className="prod-modal" onClick={(e) => e.stopPropagation()}>
            <h3>按型号派生变型</h3>
            <p className="settings-hint">
              源型号：{variantSource.id} · {variantSource.name}（{familyName(variantSource.familyId)}）
            </p>
            <div className="prod-head">
              <label className="kbe-field">
                <span>新型号 P/N</span>
                <input
                  className="training-input"
                  placeholder="如 AF-2026-002"
                  value={variantDraft.id}
                  onChange={(e) => setVariantDraft({ ...variantDraft, id: e.target.value })}
                />
              </label>
              <label className="kbe-field">
                <span>型号名称</span>
                <input
                  className="training-input"
                  value={variantDraft.name}
                  onChange={(e) => setVariantDraft({ ...variantDraft, name: e.target.value })}
                />
              </label>
              <label className="kbe-field">
                <span>客户</span>
                <input
                  className="training-input"
                  value={variantDraft.customer}
                  onChange={(e) => setVariantDraft({ ...variantDraft, customer: e.target.value })}
                />
              </label>
            </div>
            <div className="prod-check-row">
              <label className="prod-check">
                <input
                  type="checkbox"
                  checked={variantDraft.copyReq}
                  onChange={(e) => setVariantDraft({ ...variantDraft, copyReq: e.target.checked })}
                />
                复制需求清单（{variantSource.requirements.length}）
              </label>
              <label className="prod-check">
                <input
                  type="checkbox"
                  checked={variantDraft.copyParam}
                  onChange={(e) => setVariantDraft({ ...variantDraft, copyParam: e.target.checked })}
                />
                复制关键参数（{variantSource.params.length}）
              </label>
              <label className="prod-check">
                <input
                  type="checkbox"
                  checked={variantDraft.copyStd}
                  onChange={(e) => setVariantDraft({ ...variantDraft, copyStd: e.target.checked })}
                />
                复制设计标准（{variantSource.standards.length}）
              </label>
              <label className="prod-check">
                <input
                  type="checkbox"
                  checked={variantDraft.copyCalc}
                  onChange={(e) => setVariantDraft({ ...variantDraft, copyCalc: e.target.checked })}
                />
                带上计算记录（{variantSource.calcRefs.length}）
              </label>
              <label className="prod-check">
                <input
                  type="checkbox"
                  checked={variantDraft.keepValues}
                  disabled={!variantDraft.copyParam}
                  onChange={(e) => setVariantDraft({ ...variantDraft, keepValues: e.target.checked })}
                />
                保留参数取值（取消则清空数值，按新需求重算）
              </label>
            </div>
            <div className="prod-modal-actions">
              <button className="btn-primary sm" onClick={submitVariant}>
                创建变型
              </button>
              <button className="btn-ghost sm" onClick={() => setVariantSource(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
