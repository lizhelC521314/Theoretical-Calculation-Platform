/**
 * 项目校核包
 *
 * 项目下所有计算记录都在「当时的公式版本 + 当时的 SI 输入」下产生。
 * 公式库升版或实现调整后，这些记录是否仍然成立，需要一次性复核。
 *
 * 本模块对项目内的计算记录做三件事：
 *  1) 版本核对：记录快照的公式版本与当前公式库对比，识别升版 / 废止 / 已移出；
 *  2) 复算核对：用快照 SI 输入重新求解，与记录保存的输出逐项对比，偏差超容差即标记；
 *  3) 合规判定：按操作者给出的判定准则（结果 ≤ / ≥ / 介于限值）判定通过与否。
 *
 * 只读取历史记录与公式库，不写任何数据，因此不依赖主进程 API。
 */
import { showIfMatches, type FormulaSpec } from './types';

/** 记录中保存的输入结构（inputsSI 为统一 SI 输入快照） */
export interface RecordInputs {
  inputsSI?: Record<string, number>;
  values?: Record<string, number>;
  units?: Record<string, string>;
}

/** 待校核的计算记录（结构兼容 api.HistoryEntry，避免测试期引入 window 依赖） */
export interface CheckableRecord {
  id: string;
  formulaId: string;
  formulaTitle: string;
  formulaVersion?: string;
  formulaStatus?: string;
  domain?: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  createdAt: string;
}

/** 判定准则比较方式（与设计探索一致） */
export type CheckOp = 'le' | 'ge' | 'between';

export const CHECK_OP_LABEL: Record<CheckOp, string> = {
  le: '≤',
  ge: '≥',
  between: '介于',
};

/** 单条判定准则：某个公式的某个结果必须满足限值 */
export interface CheckCriterion {
  formulaId: string;
  output: string;
  op: CheckOp;
  /** 限值（SI） */
  value: number;
  /** op = between 时的上限（SI） */
  value2?: number;
}

export type VersionState = 'same' | 'updated' | 'deprecated' | 'removed';
export type CheckStatus = 'ok' | 'stale' | 'changed' | 'failed';
export type Compliance = 'pass' | 'fail' | 'undetermined';

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  ok: '复算一致',
  stale: '公式升版',
  changed: '复算不符',
  failed: '无法复算',
};

export const COMPLIANCE_LABEL: Record<Compliance, string> = {
  pass: '通过',
  fail: '不通过',
  undetermined: '未判定',
};

/** 单个输出的对比结果 */
export interface OutputDiff {
  key: string;
  label: string;
  recorded: number;
  current: number;
  /** 相对偏差 |current − recorded| / max(|recorded|, |current|, ε) */
  rel: number;
}

export interface CheckItem {
  recordId: string;
  formulaId: string;
  formulaTitle: string;
  createdAt: string;
  /** 记录快照版本 */
  recordedVersion?: string;
  /** 当前公式库版本 */
  currentVersion?: string;
  versionState: VersionState;
  /** 复算是否成功（缺公式 / 缺输入快照 / 求解抛错均为 false） */
  recomputed: boolean;
  diffs: OutputDiff[];
  maxRelDiff: number;
  status: CheckStatus;
  compliance: Compliance;
  /** 未满足的准则描述（含实际值） */
  violations: string[];
  /** 面向操作者的说明（升版、废止、缺快照等） */
  messages: string[];
}

export interface CheckPackageResult {
  items: CheckItem[];
  summary: {
    total: number;
    ok: number;
    stale: number;
    changed: number;
    failed: number;
    pass: number;
    fail: number;
    undetermined: number;
  };
}

/** 版本号按 x.y.z 数值比较；非标准格式按字符串比较兜底 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number(x));
  const pb = b.split('.').map((x) => Number(x));
  if (pa.some((x) => !Number.isFinite(x)) || pb.some((x) => !Number.isFinite(x))) {
    return a === b ? 0 : a > b ? 1 : -1;
  }
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function satisfy(v: number, op: CheckOp, lo: number, hi?: number): boolean {
  if (!Number.isFinite(v)) return false;
  if (op === 'le') return v <= lo;
  if (op === 'ge') return v >= lo;
  const a = Math.min(lo, hi ?? lo);
  const b = Math.max(lo, hi ?? lo);
  return v >= a && v <= b;
}

/** 统一的数值格式（不引入单位模块，保持纯函数便于测试） */
function num(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v !== 0 && (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3)) return v.toExponential(3);
  return String(Number(v.toPrecision(4)));
}

/**
 * 校核一条记录。
 * @param entry       历史记录
 * @param formula     当前公式库中的同名公式（undefined 表示已移出公式库）
 * @param criteria    判定准则（可为空；为空时合规全部为「未判定」）
 * @param tolerance   复算相对容差，默认 1e-6
 */
export function checkRecord(
  entry: CheckableRecord,
  formula: FormulaSpec | undefined,
  criteria: CheckCriterion[] = [],
  tolerance = 1e-6,
): CheckItem {
  const messages: string[] = [];
  const base: CheckItem = {
    recordId: entry.id,
    formulaId: entry.formulaId,
    formulaTitle: entry.formulaTitle,
    createdAt: entry.createdAt,
    recordedVersion: entry.formulaVersion,
    currentVersion: formula?.version,
    versionState: 'same',
    recomputed: false,
    diffs: [],
    maxRelDiff: 0,
    status: 'failed',
    compliance: 'undetermined',
    violations: [],
    messages,
  };

  if (!formula) {
    base.versionState = 'removed';
    messages.push('该公式已不在当前公式库中，无法复算');
    return base;
  }

  // 版本核对
  if (!entry.formulaVersion) {
    messages.push('记录未快照公式版本（旧数据），按当前版本复算');
  } else {
    const cmp = compareVersions(formula.version, entry.formulaVersion);
    if (cmp === 0) {
      base.versionState = 'same';
    } else if (cmp > 0) {
      base.versionState = 'updated';
      messages.push(`公式已从 v${entry.formulaVersion} 升版至 v${formula.version}`);
    } else {
      base.versionState = 'updated';
      messages.push(`记录版本 v${entry.formulaVersion} 高于当前库 v${formula.version}，请确认公式库是否被回退`);
    }
  }
  if (formula.status === 'deprecated' && entry.formulaStatus !== 'deprecated') {
    base.versionState = 'deprecated';
    messages.push('该公式已废止，不应继续用于正式校核');
  }

  // 复算
  const si = (entry.inputs as RecordInputs | undefined)?.inputsSI;
  if (!si || typeof si !== 'object') {
    messages.push('记录缺少 SI 输入快照，无法复算（旧数据）');
    base.status = 'failed';
    return base;
  }

  let current: Record<string, number>;
  try {
    current = formula.solve(si);
  } catch (e) {
    messages.push('复算抛出异常：' + (e instanceof Error ? e.message : String(e)));
    base.status = 'failed';
    return base;
  }
  base.recomputed = true;

  // 逐项对比当前可见输出
  for (const o of formula.outputs) {
    if (!showIfMatches(o.showIf, si)) continue;
    const rec = Number(entry.outputs[o.key]);
    const cur = current[o.key];
    if (!Number.isFinite(rec) || !Number.isFinite(cur)) continue;
    const rel = Math.abs(cur - rec) / Math.max(Math.abs(rec), Math.abs(cur), 1e-12);
    base.diffs.push({ key: o.key, label: o.label, recorded: rec, current: cur, rel });
    if (rel > base.maxRelDiff) base.maxRelDiff = rel;
  }
  if (base.diffs.length === 0) {
    messages.push('记录中没有可对比的输出结果');
  }

  // 合规判定
  const mine = criteria.filter((c) => c.formulaId === entry.formulaId);
  if (mine.length === 0) {
    base.compliance = 'undetermined';
  } else {
    let applied = 0;
    let allPass = true;
    for (const c of mine) {
      const v = current[c.output];
      const o = formula.outputs.find((x) => x.key === c.output);
      if (!o || !Number.isFinite(v)) continue;
      applied++;
      const ok = satisfy(v, c.op, c.value, c.value2);
      if (!ok) {
        allPass = false;
        const limit =
          c.op === 'between'
            ? `${num(Math.min(c.value, c.value2 ?? c.value))} ~ ${num(Math.max(c.value, c.value2 ?? c.value))}`
            : `${CHECK_OP_LABEL[c.op]} ${num(c.value)}`;
        base.violations.push(`${o.label} = ${num(v)} ${o.unit}，要求 ${limit} ${o.unit}`);
      }
    }
    base.compliance = applied === 0 ? 'undetermined' : allPass ? 'pass' : 'fail';
    if (applied === 0) messages.push('判定准则中的结果在当前工况下不存在');
  }

  // 结论：复算不符 > 无法复算 > 升版/废止 > 一致
  if (base.diffs.length > 0 && base.maxRelDiff > tolerance) {
    base.status = 'changed';
  } else if (base.versionState === 'updated' || base.versionState === 'deprecated') {
    base.status = 'stale';
  } else {
    base.status = 'ok';
  }
  return base;
}

/** 校核整个项目：记录逐条复算并汇总 */
export function buildCheckPackage(
  records: CheckableRecord[],
  formulaIndex: Map<string, FormulaSpec> | FormulaSpec[],
  criteria: CheckCriterion[] = [],
  tolerance = 1e-6,
): CheckPackageResult {
  const index =
    formulaIndex instanceof Map
      ? formulaIndex
      : new Map(formulaIndex.map((f) => [f.id, f] as const));
  const items = records.map((r) => checkRecord(r, index.get(r.formulaId), criteria, tolerance));
  const summary = {
    total: items.length,
    ok: items.filter((i) => i.status === 'ok').length,
    stale: items.filter((i) => i.status === 'stale').length,
    changed: items.filter((i) => i.status === 'changed').length,
    failed: items.filter((i) => i.status === 'failed').length,
    pass: items.filter((i) => i.compliance === 'pass').length,
    fail: items.filter((i) => i.compliance === 'fail').length,
    undetermined: items.filter((i) => i.compliance === 'undetermined').length,
  };
  return { items, summary };
}

/** 导出校核包 CSV（含判定准则与逐条结论） */
export function checkPackageCsv(
  result: CheckPackageResult,
  meta: { projectName: string; user: string; time: string },
  criteria: CheckCriterion[] = [],
  formulaIndex: Map<string, FormulaSpec> | FormulaSpec[] = [],
): string {
  const index =
    formulaIndex instanceof Map
      ? formulaIndex
      : new Map(formulaIndex.map((f) => [f.id, f] as const));
  const lines: string[] = [];
  lines.push(`项目校核包,${meta.projectName}`);
  lines.push(`校核人,${meta.user}`);
  lines.push(`校核时间,${meta.time}`);
  const s = result.summary;
  lines.push(`记录总数,${s.total}`);
  lines.push(`复算一致,${s.ok} 条 · 公式升版,${s.stale} 条 · 复算不符,${s.changed} 条 · 无法复算,${s.failed} 条`);
  lines.push(`合规判定,通过 ${s.pass} 条 · 不通过 ${s.fail} 条 · 未判定 ${s.undetermined} 条`);
  lines.push('');

  if (criteria.length) {
    lines.push('判定准则');
    lines.push('公式,结果,比较,限值1,限值2');
    for (const c of criteria) {
      const f = index.get(c.formulaId);
      const o = f?.outputs.find((x) => x.key === c.output);
      lines.push(
        [
          f?.title ?? c.formulaId,
          o?.label ?? c.output,
          CHECK_OP_LABEL[c.op],
          c.value,
          c.op === 'between' ? c.value2 ?? '' : '',
        ].join(','),
      );
    }
    lines.push('');
  }

  lines.push('校核明细');
  lines.push('公式,记录时间,记录版本,当前版本,复算结论,合规结论,最大相对偏差,未满足准则,说明');
  for (const it of result.items) {
    lines.push(
      [
        it.formulaTitle,
        new Date(it.createdAt).toLocaleString('zh-CN'),
        it.recordedVersion ? `v${it.recordedVersion}` : '（未快照）',
        it.currentVersion ? `v${it.currentVersion}` : '（已移出）',
        CHECK_STATUS_LABEL[it.status],
        COMPLIANCE_LABEL[it.compliance],
        it.recomputed ? (it.maxRelDiff * 100).toFixed(4) + '%' : '—',
        `"${it.violations.join('；')}"`,
        `"${it.messages.join('；')}"`,
      ].join(','),
    );
  }
  return lines.join('\n');
}
