/**
 * FMEA 评分（S / O / D / AP）
 *
 * 参考 AIAG-VDA 2019 版行动优先级（Action Priority），
 * 高严重度优先，S/O/D 三因子组合得到 AP 三档（H/M/L），
 * 取代单一 RPN 阈值判断（方案 2.1、3.4 节）。
 */

/** 严重度 S 锚点（方案 3.4 节，部门统一） */
export const S_SCALE: Array<{ score: number; label: string; desc: string }> = [
  { score: 10, label: '极严重', desc: '危及安全/法规，无预警' },
  { score: 9, label: '极严重', desc: '危及安全/法规，有预警' },
  { score: 8, label: '高', desc: '主要功能丧失，客户不满' },
  { score: 7, label: '高', desc: '主要功能下降，客户可感知' },
  { score: 6, label: '中', desc: '次要功能丧失，客户不满' },
  { score: 5, label: '中', desc: '次要功能下降，客户可感知' },
  { score: 4, label: '低', desc: '外观/舒适性下降，多数客户注意' },
  { score: 3, label: '低', desc: '外观/舒适性下降，少数客户注意' },
  { score: 2, label: '很轻', desc: '无可察觉影响，客户可能注意' },
  { score: 1, label: '无', desc: '无可察觉影响' },
];

/** 发生度 O 锚点（按同类设计历史频次分档） */
export const O_SCALE: Array<{ score: number; label: string; freq: string }> = [
  { score: 10, label: '很高', freq: '> 1/10' },
  { score: 9, label: '很高', freq: '约 1/20' },
  { score: 8, label: '高', freq: '约 1/50' },
  { score: 7, label: '高', freq: '约 1/100' },
  { score: 6, label: '中', freq: '约 1/200' },
  { score: 5, label: '中', freq: '约 1/500' },
  { score: 4, label: '中', freq: '约 1/1000' },
  { score: 3, label: '低', freq: '约 1/2000' },
  { score: 2, label: '低', freq: '约 1/5000' },
  { score: 1, label: '极低', freq: '< 1/10000' },
];

/** 探测度 D 锚点（方案要求：与验证库试验项对应） */
export const D_SCALE: Array<{ score: number; label: string; desc: string }> = [
  { score: 10, label: '几乎不能', desc: '无任何探测手段' },
  { score: 9, label: '很低', desc: '几乎不能检出' },
  { score: 8, label: '低', desc: '现有探测手段检出概率低' },
  { score: 7, label: '低', desc: '现有探测手段检出概率偏低' },
  { score: 6, label: '中', desc: '专项试验才能发现' },
  { score: 5, label: '中', desc: '抽样试验可发现' },
  { score: 4, label: '高', desc: '过程检验可检出' },
  { score: 3, label: '高', desc: '设计阶段自动校验可发现' },
  { score: 2, label: '很高', desc: '设计阶段可防止' },
  { score: 1, label: '极高', desc: '设计阶段即可预防发生' },
];

export type ApLevel = 'H' | 'M' | 'L';

/**
 * AIAG-VDA AP 组合表（2019 版核心）。
 * 先看严重度是否高（S=9/10），再看 O/D 组合。
 * 高严重度条目即使 RPN 不高也必须处置（方案明确反对 RPN 阈值）。
 */
const AP_TABLE: Record<number, Record<string, ApLevel>> = {
  // S = 9/10 （高严重度优先原则）
  10: { H: 'H', M: 'H', L: 'H' },
  9:  { H: 'H', M: 'H', L: 'H' },
  // S = 7/8 （中高严重度）
  8:  { H: 'H', M: 'H', L: 'M' },
  7:  { H: 'H', M: 'M', L: 'M' },
  // S = 5/6 （中等严重度）
  6:  { H: 'H', M: 'M', L: 'L' },
  5:  { H: 'M', M: 'M', L: 'L' },
  // S = 3/4 （中低严重度）
  4:  { H: 'M', M: 'L', L: 'L' },
  3:  { H: 'L', M: 'L', L: 'L' },
  // S = 1/2 （低严重度）
  2:  { H: 'L', M: 'L', L: 'L' },
  1:  { H: 'L', M: 'L', L: 'L' },
};

function oBucket(o: number): 'H' | 'M' | 'L' {
  if (o >= 7) return 'H';
  if (o >= 4) return 'M';
  return 'L';
}
function dBucket(d: number): 'H' | 'M' | 'L' {
  if (d >= 7) return 'H';
  if (d >= 4) return 'M';
  return 'L';
}

/** 根据 AIAG-VDA 2019 计算 AP */
export function computeAp(S: number, O: number, D: number): ApLevel {
  const s = Math.round(S);
  if (s < 1 || s > 10) return 'L';
  // AIAG-VDA: 先按严重度档位取对应的 (O,D) 组合，其中 O/D 各分 H/M/L
  const ob = oBucket(O);
  const db = dBucket(D);
  const key = ob === 'H' ? 'H' : ob === 'M' ? (db === 'H' ? 'H' : 'M') : 'L';
  return AP_TABLE[s][key];
}

/** RPN 仅作参考（方案 2.1 节明确说 AP 优先于 RPN） */
export function computeRpn(S: number, O: number, D: number): number {
  return Math.round(S) * Math.round(O) * Math.round(D);
}

/** 校验 S/O/D 均为 1-10 整数，返回错误列表 */
export function validateSod(S?: number | null, O?: number | null, D?: number | null): string[] {
  const errs: string[] = [];
  const check = (label: string, v: number | null | undefined) => {
    if (v === null || v === undefined || Number.isNaN(v)) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 10) errs.push(`${label} 必须是 1–10 的整数，当前值：${v}`);
  };
  check('严重度 S', S);
  check('发生度 O', O);
  check('探测度 D', D);
  return errs;
}

/** AP 徽标展示信息（颜色映射在 CSS 里） */
export const AP_META: Record<ApLevel, { label: string; fullLabel: string; color: string; hint: string }> = {
  H: { label: 'H', fullLabel: '高优先级', color: '#c0392b', hint: '必须处置，措施需在DVP&R中验证' },
  M: { label: 'M', fullLabel: '中优先级', color: '#b45309', hint: '应处置，措施需评审确认' },
  L: { label: 'L', fullLabel: '低优先级', color: '#15803d', hint: '建议改进，按资源情况安排' },
};

/** 为还没评分的条目给默认引导词（仅用于导入提示，不自动填默认值） */
export const SOD_MISSING_HINT = '需补 S/O/D 评分后才能自动算 AP';
