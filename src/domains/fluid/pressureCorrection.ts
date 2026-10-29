import type { FormulaSpec } from '../../formula/types';
import { PRESSURE_CORRECTION_DIAGRAM } from './diagrams';

/**
 * 压力修正公式（Pressure Correction to Standard Conditions）
 *
 * 主公式（与参考 PPT 严格一致，solve 收到的 T_std、T_test 已经是 K，故 (273.15+T_std)/(273.15+T_test) = T_std_K / T_test_K）：
 *   标准压降  ΔP_std = ΔP_test × T_std_K / T_test_K × P_test/P_std
 *   出口动压  P_dyn  = (1/2)·ρ·v²
 *   流速      v = (Q/ρ) / (πD²/4) / 3600    （Q/ρ 先得体积流量 m³/h，除以截面积 m² 再除以 3600 s/h 得 m/s）
 *   Q = ρ·V    （Q、V 二选一输入，Q 优先）
 *   总压降    ΔP_total = ΔP_std − P_dyn
 *
 * 内部 SI 全程 Pa（与项目「SI 全程 + unitGroup 显示换算」约定一致），outputs 声明 unit='kPa' + unitGroup='pressure'，
 * 界面自动换算显示 kPa。管道出口直径 D 以 m 为 SI 单位（PPT 默认 0.06 m）。
 */

/** 由 SI 输入（Pa, K, kg/h, kg/m³, m）算出中间量。Q/V 二选一：Q > 0 优先，否则 V。 */
function derive(v: Record<string, number>) {
  const { dPtest, Tstd, Ttest, Ptest, Pstd, rho, Q, V, D } = v;
  if (
    !Number.isFinite(dPtest) || !Number.isFinite(Tstd) || !Number.isFinite(Ttest) ||
    !Number.isFinite(Ptest) || !Number.isFinite(Pstd) ||
    !(rho > 0) || !(D > 0)
  ) return null;
  const q = Q > 0 ? Q : rho * V;       // kg/h（实际质量流量）
  const Vm3h = q / rho;                // m³/h（实际体积流量）
  const A = (Math.PI * D * D) / 4;     // m²
  const vel = Vm3h / A / 3600;         // m/s
  const pDyn = 0.5 * rho * vel * vel;   // Pa
  const dPstd = dPtest * Tstd / Ttest * Ptest / Pstd; // Pa，Tstd/Ttest 已经是 K（界面 ℃ → SI K）
  const dPtotal = dPstd - pDyn;        // Pa
  return { dPstd, pDyn, dPtotal, vel, q, Vm3h, A };
}

export const pressureCorrection: FormulaSpec = {
  id: 'fluid.pressureCorrection',
  domain: 'fluid',
  subsystem: '压降修正',
  title: '压力修正公式',
  summary: '将非标准环境下测得的压降修正到标准大气压与标准温度，并扣除出口动压得到总压降。',
  tags: ['压力修正', '压降', '标准条件', '动压', '总压降', '流量', '空气滤清器', '进排气系统'],
  description:
    '压力修正公式用于将台架或现场测得的非标准大气压、非标准温度下的压降值换算到标准环境条件，同时扣除出口动压得到总压降。本公式按参考 PPT 计算：ΔP_std = ΔP_test × (273.15+T_std)/(273.15+T_test) × P_test/P_std；出口动压 P_dyn = ½ρv²，其中流速 v 由流量和出口直径计算，v = (Q/ρ)/(πD²/4)/3600（Q/ρ 先得体积流量 m³/h，除以截面积 m² 再除以 3600 s/h）；总压降 ΔP_total = ΔP_std − P_dyn。质量流量 Q 与体积流量 V 二选一输入（Q 优先，置 0 时按 V 反算 Q = ρ·V）。压力量内部统一 Pa（SI），界面可切换显示 kPa/MPa；管道出口直径 D 以 m 为单位。',
  inputs: [
    { key: 'dPtest', label: '非标准大气压下测得的压降', symbol: 'ΔP_test', unit: 'kPa', unitGroup: 'pressure', default: 5, required: true, description: '测试条件下直接测得的静态压降' },
    { key: 'Tstd', label: '标准环境温度', symbol: 'T_std', unit: '℃', unitGroup: 'temperature', default: 20, required: true, description: '标准参考温度（ISO 1217 等标准默认 20℃ 或 25℃）' },
    { key: 'Ttest', label: '测试环境温度', symbol: 'T_test', unit: '℃', unitGroup: 'temperature', default: 25, required: true, description: '测试时的实际环境温度' },
    { key: 'Ptest', label: '非标准大气压', symbol: 'P_test', unit: 'kPa', unitGroup: 'pressure', default: 96, required: true, description: '测试地点/条件下的实际大气压力' },
    { key: 'Pstd', label: '标准大气压', symbol: 'P_std', unit: 'kPa', unitGroup: 'pressure', default: 101.325, required: true, description: '标准大气压力，通常取 101.325 kPa' },
    { key: 'rho', label: '空气密度', symbol: 'ρ', unit: 'kg/m³', default: 1.205, min: 0, required: true, description: '测试条件下的空气密度（标准条件约 1.205 kg/m³）' },
    { key: 'Q', label: '空气的质量流量', symbol: 'Q', unit: 'kg/h', default: 1, min: 0, required: true, description: '与体积流量 V 二选一：Q > 0 时优先按本值计算；Q = 0 时按 V 反算 Q = ρ·V' },
    { key: 'V', label: '空气的体积流量', symbol: 'V', unit: 'm³/h', default: 0, min: 0, required: true, description: '与质量流量 Q 二选一：Q = 0 时才按本值计算体积流量' },
    { key: 'D', label: '管道出口的直径', symbol: 'D', unit: 'm', default: 0.06, min: 0, required: true, description: '管道出口内径，计算截面积 A = πD²/4 与流速 v 用' },
  ],
  outputs: [
    { key: 'dPstd', label: '修正到标准大气压的压降', symbol: 'ΔP_std', unit: 'kPa', unitGroup: 'pressure', primary: true, group: '修正结果', description: 'ΔP_std = ΔP_test × (273.15+T_std)/(273.15+T_test) × P_test/P_std' },
    { key: 'pDyn', label: '出口动压', symbol: 'P_dyn', unit: 'kPa', unitGroup: 'pressure', primary: true, group: '修正结果', description: 'P_dyn = ½ρv²；从 ΔP_std 中扣除即得总压降' },
    { key: 'dPtotal', label: '总压降', symbol: 'ΔP_total', unit: 'kPa', unitGroup: 'pressure', primary: true, group: '修正结果', description: 'ΔP_total = ΔP_std − P_dyn，反映纯摩擦/结构损失，不含出口动能' },
    { key: 'vel', label: '出口流速', symbol: 'v', unit: 'm/s', group: '中间量', description: 'v = (Q/ρ)/(πD²/4)/3600' },
    { key: 'q', label: '质量流量（实际）', symbol: 'Q', unit: 'kg/h', group: '中间量', description: '若输入 Q > 0 则为输入值；若 Q = 0 则由 Q = ρ·V 反算' },
    { key: 'Vm3h', label: '体积流量（实际）', symbol: 'V', unit: 'm³/h', group: '中间量', description: '由 Q/ρ 计算（Q 优先）' },
    { key: 'A', label: '出口截面积', symbol: 'A', unit: 'm²', group: '中间量', description: 'A = πD²/4' },
  ],
  latex: [
    {
      label: '压力修正（主公式）',
      tex: '\\Delta P_{std} = \\Delta P_{test} \\cdot \\frac{273.15 + T_{std}}{273.15 + T_{test}} \\cdot \\frac{P_{test}}{P_{std}}',
    },
    {
      label: '出口动压',
      tex: 'P_{dyn} = \\frac{1}{2}\\rho v^{2}',
    },
    {
      label: '流速',
      tex: 'v = \\frac{Q / \\rho}{\\pi D^{2} / 4} \\cdot \\frac{1}{3600}',
    },
    {
      label: '流量关联与总压降',
      tex: 'Q = \\rho V,\\qquad \\Delta P_{total} = \\Delta P_{std} - P_{dyn}',
    },
  ],
  diagram: PRESSURE_CORRECTION_DIAGRAM,
  sensitivity: true,
  assumptions: [
    '公式与参考 PPT 严格一致：ΔP_std = ΔP_test × (273.15+T_std)/(273.15+T_test) × P_test/P_std',
    'PPT 给出的流速公式 v = (Q/ρ)/(πD²/4)/3600：Q/ρ 先得体积流量 m³/h，除以截面积 m² 再除以 3600 s/h 得 m/s',
    'PPT 说明 Q 与 V 两者只能输入一个。本实现按之前直径/面积二选一的惯例：Q > 0 时优先采用 Q，Q = 0 时按 V 反算 Q = ρ·V',
    '压力量内部全程以 Pa 为 SI 单位，界面通过 unitGroup=pressure 自动换算显示 kPa/MPa',
    'D 以 m 为单位（PPT 默认 0.06 m，即 60 mm），与声学公式 D 以 mm 不同，请注意输入单位',
    'ΔP_total = ΔP_std − P_dyn：从修正后的静态压降中扣除出口动压得到纯损失压降',
  ],
  solve(v) {
    const empty = {
      dPstd: NaN, pDyn: NaN, dPtotal: NaN, vel: NaN,
      q: NaN, Vm3h: NaN, A: NaN,
    };
    const r = derive(v);
    if (!r) return empty;
    return {
      dPstd: r.dPstd,
      pDyn: r.pDyn,
      dPtotal: r.dPtotal,
      vel: r.vel,
      q: r.q,
      Vm3h: r.Vm3h,
      A: r.A,
    };
  },
  benchmarks: [
    {
      name: '默认工况（Q 输入：ΔP_test=5kPa, T_std=20℃, T_test=25℃, P_test=96kPa, P_std=101.325kPa, Q=1kg/h, D=0.06m）',
      input: {
        dPtest: 5000, Tstd: 293.15, Ttest: 298.15, Ptest: 96000, Pstd: 101325,
        rho: 1.205, Q: 1, V: 0, D: 0.06,
      },
      expect: {
        dPstd: 4657.79,
        vel: 0.08153,
        pDyn: 0.004005,
        dPtotal: 4657.78,
      },
      tolerance: 5e-3,
      source: '按 PPT 公式手工核算（SI 全程）：ΔP_std = 5000 × 293.15/298.15 × 96000/101325 ≈ 4657.8 Pa；v = (1/1.205)/(π×0.06²/4)/3600 ≈ 0.0815 m/s；P_dyn = ½×1.205×0.0815² ≈ 0.004005 Pa；ΔP_total ≈ 4657.78 Pa',
    },
    {
      name: '体积流量输入（V=2m³/h 反算 Q：ΔP_test=10kPa, T_std=25℃, T_test=35℃, P_test=95kPa, D=0.05m, ρ=1.2）',
      input: {
        dPtest: 10000, Tstd: 298.15, Ttest: 308.15, Ptest: 95000, Pstd: 101325,
        rho: 1.2, Q: 0, V: 2, D: 0.05,
      },
      expect: {
        q: 2.4,
        vel: 0.2829,
        pDyn: 0.04803,
        dPstd: 9071.51,
        dPtotal: 9071.46,
      },
      tolerance: 5e-3,
      source: 'V=2 m³/h → Q=ρV=2.4 kg/h；v = 2/(π×0.05²/4)/3600 ≈ 0.283 m/s；P_dyn = ½×1.2×0.283² ≈ 0.048 Pa；ΔP_std = 10000 × 298.15/308.15 × 95000/101325 ≈ 9071.5 Pa',
    },
  ],
};
