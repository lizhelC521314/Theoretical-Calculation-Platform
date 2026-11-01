import type { FormulaSpec } from '../../formula/types';
import { INTAKE_HOSE_DIAGRAM } from './diagrams';

/**
 * 乘用车橡胶进气软管（波纹管）几何参数反算设计
 *
 * 按参考文档《乘用车橡胶进气软管几何参数反算设计》（依据 SAE J20、GB/T 3683、
 * EJMA 波纹管经验式与 Bies 工程噪声控制）实现「反算 + 正算复核」：
 *   壁厚反算  tb = kb·p·D/(2σb)（爆破），tv = D·[nv·pv·(1−ν²)/(2E·CL)]^{1/3}（真空塌陷），
 *             tr = pac/(2πf·ρ·vallow)（声辐射），t = max(tb, tv, tr) 向上圆整 0.5 mm
 *   波数反算  K = 1.7·Dm·E·tp³·n/(weff³·Cf)（单波刚度），Ker = K/N，
 *             隔振下限 Nmin = K/[M(2πfn,max)²]，拔脱上限 Nmax = K·Δallow/Fpull
 *   长度质量  L = N·w，M = ρπDt·L + M接头（与 N 耦合，按二次方程直接求解）
 *   正算复核  fn、Tr、R ≥ Rreq；σrad、LW、Lp ≤ Lp,req；F = Ker·Δallow ≥ Fpull；
 *             pcr ≥ nv·pv；pb = 2tσb/D ≥ kb·p
 */
export const intakeHose: FormulaSpec = {
  id: 'structure.intakeHose',
  domain: 'structure',
  subsystem: '进气系统',
  title: '橡胶进气软管（波纹管）几何反算设计',
  summary: '几何反算：输入橡胶材料参数与性能要求（隔振率、声辐射、拔脱力、真空度），直接输出壁厚 t、波数 N 与软管长度 L，并用正算公式逐项复核余量。',
  tags: ['进气软管', '波纹管', '橡胶软管', 'EPDM', '几何反算', '壁厚', '波数', '爆破', '真空吸扁', '隔振', '拔脱力', '管壁声辐射', 'EJMA', 'SAE J20', 'NVH', '结构设计'],
  description:
    '乘用车橡胶进气软管（EPDM，带 1~3 层增强层）的几何参数反算设计：① 输入内径 D、波距 w、波高 h、层数 n 与材料参数（E、ρ、σb、ν、ζ、HA）；② 按式(5)~(10) 由爆破、真空塌陷、声辐射三项约束反算壁厚并取大、向上圆整至 0.5 mm（无增强层橡胶 E 低，真空塌陷往往是控制项）；③ 按式(11)(12) 计算单波刚度 K 与整体刚度 Ker = K/N；④ 按式(13)~(17) 由隔振率要求给波数下限、拔脱力要求给波数上限，取 N = ⌈Nmin⌉ 并检查 N ≤ Nmax；⑤ 按式(18)(19) 计算 L = N·w 与总成质量 M（M 与 N 耦合，本实现按二次方程直接求解，等价于迭代 2~3 轮）；⑥ 按式(20)~(25) 正算复核固有频率、隔振率、声压级、拔脱承载、真空与爆破裕度；⑦ 若 R < Rreq 在 N ≤ Nmax 内自动递增 N（阻尼使实际传递率略高于无阻尼近似）；⑧ 按式(26)~(36) 校核运动位移：由 Δx/Δy/Δz 合成轴向位移 Δa 与横向位移 Δl，行程下限 Nmin,Δ 与隔振下限取大后并入 N 的取值，再校核单波行程比、位移应力 σd、组合应力 σeq ≤ [σ]/SFs、疲劳 Δσ ≤ Sf/SFf 与运动轴向力 Fax ≤ Fjoint；⑨ 若 max(Nmin, Nmin,Δ) > Nmax 则材料/结构无法同时满足，可行区间宽度输出为负，需调整材料或放宽要求。',
  inputs: [
    { key: 'D', label: '软管内径', symbol: 'D', unit: 'mm', unitGroup: 'diameter', default: 50, min: 0, required: true, description: '由空间/流量确定，0.03~0.12 m' },
    { key: 'w', label: '波距', symbol: 'w', unit: 'mm', unitGroup: 'length', default: 12, min: 0, required: true, description: '波纹节距，工艺确定，8~15 mm' },
    { key: 'h', label: '波高', symbol: 'h', unit: 'mm', unitGroup: 'length', default: 20, min: 0, required: true, description: '波纹径向高度，工艺确定，8~20 mm；须满足 h > n·t' },
    { key: 'n', label: '增强层层数', symbol: 'n', unit: '-', default: 2, min: 1, max: 5, required: true, description: '涤纶/芳纶增强层，1~3 层' },
    { key: 'E', label: '弹性模量', symbol: 'E', unit: 'MPa', unitGroup: 'stress', default: 6, min: 0, required: true, description: 'EPDM 5~10 MPa；随硬度、温度、应变幅变化，建议 20~80℃ 实测区间包络' },
    { key: 'rho', label: '胶料密度', symbol: 'ρ', unit: 'kg/m³', unitGroup: 'density', default: 1200, min: 0, required: true, description: 'EPDM 1100~1300 kg/m³' },
    { key: 'sigmaB', label: '拉伸强度', symbol: 'σb', unit: 'MPa', unitGroup: 'stress', default: 10, min: 0, required: true, description: '取胶料与增强层的较小值，8~15 MPa' },
    { key: 'nu', label: '泊松比', symbol: 'ν', unit: '-', default: 0.49, min: 0, max: 0.5, required: true, description: '橡胶近似不可压，取 0.49' },
    { key: 'zeta', label: '阻尼比', symbol: 'ζ', unit: '-', default: 0.08, min: 0, max: 1, required: true, description: '橡胶件 0.05~0.15，由隔振试验拟合' },
    { key: 'HA', label: '邵氏硬度', symbol: 'HA', unit: '-', default: 65, min: 40, max: 90, required: false, description: '55~75（65±5），仅作材料选型记录，不参与计算' },
    { key: 'Rreq', label: '隔振率要求', symbol: 'R_req', unit: 'dB', default: 12, min: 0, required: true, description: '目标值，≥10 dB' },
    { key: 'LpReq', label: '声辐射要求（测点声压级）', symbol: 'Lp,req', unit: 'dB', default: 75, min: 0, required: true, description: '按法规/目标值，测点距离 r 处' },
    { key: 'r', label: '声压测点距离', symbol: 'r', unit: 'mm', unitGroup: 'length', default: 1000, min: 0, required: true, description: '半消声室测点，0.5~2.0 m' },
    { key: 'Fpull', label: '拔脱力要求', symbol: 'F_pull', unit: 'N', unitGroup: 'force', default: 500, min: 0, required: true, description: '接头试验要求，500~2000 N' },
    { key: 'deltaAllow', label: '允许轴向伸长', symbol: 'Δ_allow', unit: 'mm', unitGroup: 'length', default: 5, min: 0, required: true, description: '按接头密封与布置取 3~8 mm' },
    { key: 'pv', label: '最大真空度', symbol: 'pv', unit: 'kPa', unitGroup: 'pressure', default: 30, min: 0, required: true, description: '自然吸气 30~50 kPa' },
    { key: 'p', label: '工作压力', symbol: 'p', unit: 'kPa', unitGroup: 'pressure', default: 100, min: 0, required: true, description: '按工况，增压机型更高' },
    { key: 'pac', label: '管内声压幅值', symbol: 'p_ac', unit: 'Pa', unitGroup: 'pressure', default: 100, min: 0, required: true, description: '管内声压/压力脉动幅值，按谱确定；未知时建议先实测' },
    { key: 'fex', label: '激励频率', symbol: 'f_ex', unit: 'Hz', unitGroup: 'frequency', default: 200, min: 0, required: true, description: '怠速/阶次频率，20~500 Hz；同时作为声辐射分析频率' },
    { key: 'Cf', label: '刚度修正系数', symbol: 'C_f', unit: '-', default: 1, min: 0, required: true, description: '0.8~1.5，查 EJMA' },
    { key: 'CL', label: '真空长度修正系数', symbol: 'C_L', unit: '-', default: 2, min: 0, required: true, description: '短管 1~3，长管取 1' },
    { key: 'kb', label: '爆破安全系数', symbol: 'k_b', unit: '-', default: 4, min: 0, required: true, description: '取 3~5' },
    { key: 'nv', label: '真空安全系数', symbol: 'n_v', unit: '-', default: 1.8, min: 0, required: true, description: '取 1.5~2' },
    { key: 'Mjoint', label: '接头质量', symbol: 'M_j', unit: 'kg', unitGroup: 'mass', default: 0.4, min: 0, required: true, description: '软管两端接头（含卡箍）质量，计入总成质量 M' },
    { key: 'rho0', label: '空气密度', symbol: 'ρ0', unit: 'kg/m³', unitGroup: 'density', default: 1.205, min: 0, required: true, description: '20℃、1 atm 约 1.205 kg/m³' },
    { key: 'c0', label: '空气声速', symbol: 'c0', unit: 'm/s', unitGroup: 'velocity', default: 343, min: 0, required: true, description: '20℃ 约 343 m/s' },
    { key: 'dx', label: 'X 向位移（轴向）', symbol: 'Δx', unit: 'mm', unitGroup: 'length', default: 2, min: 0, required: true, description: '软管一端固定、另一端运动的三向位移，X 为轴向（式26~27）' },
    { key: 'dy', label: 'Y 向位移（横向）', symbol: 'Δy', unit: 'mm', unitGroup: 'length', default: 1, min: 0, required: true, description: '横向分量，与 Δz 合成 Δl' },
    { key: 'dz', label: 'Z 向位移（横向）', symbol: 'Δz', unit: 'mm', unitGroup: 'length', default: 1, min: 0, required: true, description: '横向分量，与 Δy 合成 Δl' },
    { key: 'epsA', label: '单波轴向允许应变', symbol: 'ε_a', unit: '-', default: 0.15, min: 0, required: true, description: '0.10~0.20，按胶料疲劳数据与 EJMA/FSA 取值（式29）' },
    { key: 'epsL', label: '单波横向允许应变', symbol: 'ε_l', unit: '-', default: 0.08, min: 0, required: true, description: '0.05~0.10，按胶料疲劳数据与 EJMA/FSA 取值（式29）' },
    { key: 'SFs', label: '强度安全系数', symbol: 'SF_s', unit: '-', default: 2, min: 0, required: true, description: 'EJMA 常规 1.5~2，橡胶件建议 2~3（式34）' },
    { key: 'sigmaF', label: '疲劳强度（Nf 次）', symbol: 'S_f', unit: 'MPa', unitGroup: 'stress', default: 3, min: 0, required: true, description: '按 EJMA 疲劳曲线或胶料疲劳试验在设计循环次数 Nf 处取值（式35）' },
    { key: 'SFf', label: '疲劳安全系数', symbol: 'SF_f', unit: '-', default: 1.5, min: 0, required: true, description: '取 1.5~2（式35）' },
    { key: 'Nf', label: '设计循环次数', symbol: 'N_f', unit: '-', default: 1e6, min: 0, required: true, description: '如 10⁶ 次；用于确定疲劳强度 Sf 的取点，本身不直接参与计算' },
    { key: 'Fjoint', label: '接头允许轴向载荷', symbol: 'F_joint', unit: 'N', unitGroup: 'force', default: 1000, min: 0, required: true, description: '接头/卡箍允许轴向载荷，与拔脱力要求联合校核（式36）' },
  ],
  outputs: [
    { key: 't', label: '壁厚（反算）', symbol: 't', unit: 'mm', unitGroup: 'length', digits: 2, group: '反算结果', primary: true, description: 't = max(tb, tv, tr)，向上圆整至 0.5 mm（式10）' },
    { key: 'N', label: '波数（反算）', symbol: 'N', unit: '-', digits: 0, group: '反算结果', primary: true, description: '取 ⌈Nmin⌉ 并经阻尼校核递增，不超过 Nmax（式17）' },
    { key: 'L', label: '软管长度（反算）', symbol: 'L', unit: 'mm', unitGroup: 'length', digits: 1, group: '反算结果', primary: true, description: 'L = N·w（式18）' },
    { key: 'tb', label: '爆破约束壁厚', symbol: 'tb', unit: 'mm', unitGroup: 'length', digits: 3, group: '壁厚约束', description: 'tb = kb·p·D/(2σb)（式5）' },
    { key: 'tv', label: '真空塌陷约束壁厚', symbol: 'tv', unit: 'mm', unitGroup: 'length', digits: 3, group: '壁厚约束', description: 'tv = D·[nv·pv·(1−ν²)/(2E·CL)]^{1/3}（式6），橡胶 E 低时常为控制项' },
    { key: 'tr', label: '声辐射约束壁厚', symbol: 'tr', unit: 'mm', unitGroup: 'length', digits: 3, group: '壁厚约束', description: 'tr = pac/(2π·fex·ρ·vallow)（式9），由质量律反解' },
    { key: 'vallow', label: '允许壁面振速', symbol: 'v_allow', unit: 'm/s', unitGroup: 'velocity', digits: 4, group: '壁厚约束', description: 'vallow = √[Wreq/(ρ0·c0·S·σrad)]（式8）' },
    { key: 'Dm', label: '平均直径', symbol: 'D_m', unit: 'mm', unitGroup: 'length', digits: 2, group: '几何与刚度', description: 'Dm = D + h + n·t（式1）' },
    { key: 'tp', label: '单层等效厚度', symbol: 't_p', unit: 'mm', unitGroup: 'length', digits: 3, group: '几何与刚度', description: 'tp = t·(D/Dm)^{1/2}（式2）' },
    { key: 'weff', label: '有效波高', symbol: 'w_eff', unit: 'mm', unitGroup: 'length', digits: 3, group: '几何与刚度', description: 'weff = h − n·t（式3），须 > 0' },
    { key: 'K', label: '单波刚度', symbol: 'K', unit: 'kN/m', unitGroup: 'stiffness', digits: 2, group: '几何与刚度', description: 'K = 1.7·Dm·E·tp³·n/(weff³·Cf)（式11，EJMA 经验式）' },
    { key: 'Ker', label: '整体轴向刚度', symbol: 'K_er', unit: 'kN/m', unitGroup: 'stiffness', digits: 2, group: '几何与刚度', description: 'Ker = K/N（式12）' },
    { key: 'M', label: '总成质量', symbol: 'M', unit: 'kg', unitGroup: 'mass', digits: 3, group: '几何与刚度', description: 'M = ρ·π·D·t·L + M接头（式19）' },
    { key: 'Tt', label: '目标传递率', symbol: 'T_t', unit: '-', digits: 4, group: '波数区间', description: 'Tt = 10^(−Rreq/20)（式13）' },
    { key: 'fnMax', label: '允许最高固有频率', symbol: 'f_n,max', unit: 'Hz', unitGroup: 'frequency', digits: 2, group: '波数区间', description: 'fn,max = fex/√(1+1/Tt)（式14，无阻尼近似反解）' },
    { key: 'Nmin', label: '波数下限（隔振）', symbol: 'N_min', unit: '-', digits: 2, group: '波数区间', description: 'Nmin = K/[M·(2π·fn,max)²]（式15）；M 随 N 变化，按二次方程求解' },
    { key: 'Nmax', label: '波数上限（拔脱）', symbol: 'N_max', unit: '-', digits: 2, group: '波数区间', description: 'Nmax = K·Δallow/Fpull（式16）' },
    { key: 'Ngap', label: '可行区间宽度', symbol: 'N_max−N_min', unit: '-', digits: 2, group: '波数区间', description: 'Nmax − max(Nmin, Nmin,Δ)；≥0 可行；<0 说明材料/结构无法同时满足隔振、行程与拔脱，需调整' },
    { key: 'fn', label: '实际固有频率', symbol: 'f_n', unit: 'Hz', unitGroup: 'frequency', digits: 2, group: '校核·隔振', description: 'fn = (1/2π)·√(Ker/M)（式20）' },
    { key: 'ratio', label: '频率比', symbol: 'r', unit: '-', digits: 2, group: '校核·隔振', description: 'r = fex/fn，>√2 进入隔振区' },
    { key: 'Tr', label: '实际传递率', symbol: 'T_r', unit: '-', digits: 4, group: '校核·隔振', description: 'Tr = √{[1+(2ζr)²]/[(1−r²)²+(2ζr)²]}（式21）' },
    { key: 'R', label: '实际隔振率', symbol: 'R', unit: 'dB', digits: 1, group: '校核·隔振', primary: true, description: 'R = −20·lg(Tr)，应 ≥ Rreq' },
    { key: 'Rmargin', label: '隔振余量', symbol: 'R−R_req', unit: 'dB', digits: 1, group: '校核·隔振', description: '≥0 合格；为负时已被自动递增 N 修正，仍为负说明达到 Nmax 上限' },
    { key: 'cL', label: '管壁纵波速', symbol: 'c_L', unit: 'm/s', unitGroup: 'velocity', digits: 2, group: '校核·声辐射', description: 'cL = √{E/[ρ(1−ν²)]}' },
    { key: 'fr', label: '环频率', symbol: 'f_r', unit: 'Hz', unitGroup: 'frequency', digits: 1, group: '校核·声辐射', description: 'fr = cL/(π·D)' },
    { key: 'sigRad', label: '辐射效率', symbol: 'σ_rad', unit: '-', digits: 5, group: '校核·声辐射', description: 'f<fr 与 f≥fr 双分支（式22），f→fr 发散，工程限幅 [0,1]' },
    { key: 'vWall', label: '壁面振速', symbol: 'v_w', unit: 'm/s', unitGroup: 'velocity', digits: 4, group: '校核·声辐射', description: 'v = pac/(2π·fex·ρ·t)（质量律，由最终壁厚回代）' },
    { key: 'S', label: '辐射表面积', symbol: 'S', unit: 'm²', unitGroup: 'area', digits: 4, group: '校核·声辐射', description: 'S = π·D·L' },
    { key: 'W', label: '辐射声功率', symbol: 'W', unit: 'W', digits: 6, group: '校核·声辐射', description: 'W = ρ0·c0·S·σrad·v²（式23）' },
    { key: 'LW', label: '声功率级', symbol: 'L_W', unit: 'dB', digits: 1, group: '校核·声辐射', description: 'LW = 10·lg(W/10⁻¹²)' },
    { key: 'Lp', label: '测点声压级', symbol: 'L_p', unit: 'dB', digits: 1, group: '校核·声辐射', primary: true, description: 'Lp = LW − 10·lg(2π·r·L)，应 ≤ Lp,req' },
    { key: 'LpMargin', label: '声辐射余量', symbol: 'Lp,req−Lp', unit: 'dB', digits: 1, group: '校核·声辐射', description: '≥0 合格；为负时需增大壁厚或降低管内声压' },
    { key: 'F', label: '实际拔脱承载', symbol: 'F', unit: 'N', unitGroup: 'force', digits: 0, group: '校核·强度与连接', description: 'F = Ker·Δallow（式24），应 ≥ Fpull；最终仍须拔脱试验验证' },
    { key: 'Fratio', label: '拔脱裕度', symbol: 'F/F_pull', unit: '-', digits: 2, group: '校核·强度与连接', description: '≥1 合格' },
    { key: 'pcr', label: '真空失稳临界压力', symbol: 'p_cr', unit: 'kPa', unitGroup: 'pressure', digits: 1, group: '校核·强度与连接', description: 'pcr = [2E/(1−ν²)]·(t/D)³·CL，应 ≥ nv·pv（式25）' },
    { key: 'pcrRatio', label: '真空裕度', symbol: 'pcr/(n_v·p_v)', unit: '-', digits: 2, group: '校核·强度与连接', description: '≥1 合格' },
    { key: 'pb', label: '爆破压力', symbol: 'p_b', unit: 'kPa', unitGroup: 'pressure', digits: 1, group: '校核·强度与连接', description: 'pb = 2tσb/D，应 ≥ kb·p（式25）' },
    { key: 'pbRatio', label: '爆破裕度', symbol: 'pb/(k_b·p)', unit: '-', digits: 2, group: '校核·强度与连接', description: '≥1 合格' },
    { key: 'Delta', label: '合成总位移', symbol: 'Δ', unit: 'mm', unitGroup: 'length', digits: 3, group: '校核·位移与疲劳', description: 'Δ = (Δx²+Δy²+Δz²)^{1/2}（式26）' },
    { key: 'DeltaL', label: '横向合成位移', symbol: 'Δ_l', unit: 'mm', unitGroup: 'length', digits: 3, group: '校核·位移与疲劳', description: 'Δl = (Δy²+Δz²)^{1/2}（式27）' },
    { key: 'ea', label: '单波轴向位移', symbol: 'e_a', unit: 'mm', unitGroup: 'length', digits: 4, group: '校核·位移与疲劳', description: 'ea = Δa/N（式28），应 ≤ εa·h' },
    { key: 'el', label: '单波横向位移', symbol: 'e_l', unit: 'mm', unitGroup: 'length', digits: 4, group: '校核·位移与疲劳', description: 'el = Δl/N（式28），应 ≤ εl·h' },
    { key: 'eaRatio', label: '轴向行程比', symbol: 'e_a/[e_a]', unit: '-', digits: 3, group: '校核·位移与疲劳', description: 'ea/(εa·h)，≤1 合格（式29）' },
    { key: 'elRatio', label: '横向行程比', symbol: 'e_l/[e_l]', unit: '-', digits: 3, group: '校核·位移与疲劳', description: 'el/(εl·h)，≤1 合格（式29）' },
    { key: 'NminD', label: '波数下限（行程）', symbol: 'N_min,Δ', unit: '-', digits: 2, group: '校核·位移与疲劳', description: 'Nmin,Δ = max[Δa/(εa·h), Δl/(εl·h)]（式30），已并入 N 的下限' },
    { key: 'sigmaD', label: '位移应力', symbol: 'σ_d', unit: 'MPa', unitGroup: 'stress', digits: 3, group: '校核·位移与疲劳', description: 'σd = σdm + σdb（式31~32）' },
    { key: 'sigmaP', label: '压力应力', symbol: 'σ_p', unit: 'MPa', unitGroup: 'stress', digits: 3, group: '校核·位移与疲劳', description: 'σp = p·h/(2t) + p·h²/(2t²)（式33）' },
    { key: 'sigmaEq', label: '组合应力', symbol: 'σ_eq', unit: 'MPa', unitGroup: 'stress', digits: 3, group: '校核·位移与疲劳', primary: true, description: 'σeq = σp + σd（式34），应 ≤ [σ]/SFs，[σ] = σb/3' },
    { key: 'sigRatio', label: '强度利用系数', symbol: 'σ_eq/([σ]/SF_s)', unit: '-', digits: 3, group: '校核·位移与疲劳', description: '≤1 合格；超限时增大 h 或增加 N' },
    { key: 'dSigma', label: '疲劳应力幅', symbol: 'Δσ', unit: 'MPa', unitGroup: 'stress', digits: 3, group: '校核·位移与疲劳', description: 'Δσ = 2σd（式35），应 ≤ Sf(Nf)/SFf' },
    { key: 'fatRatio', label: '疲劳裕度', symbol: 'S_f/(SF_f·Δσ)', unit: '-', digits: 2, group: '校核·位移与疲劳', description: '≥1 合格' },
    { key: 'Fax', label: '运动轴向力', symbol: 'F_ax', unit: 'N', unitGroup: 'force', digits: 1, group: '校核·位移与疲劳', description: 'F = Ker·Δa（式36），应 ≤ Fjoint' },
    { key: 'FaxRatio', label: '轴向力裕度', symbol: 'F_joint/F_ax', unit: '-', digits: 2, group: '校核·位移与疲劳', description: '≥1 合格' },
  ],
  latex: [
    {
      label: '几何关系（式1~4）',
      tex: '\\star\\ D_m = D + h + n t,\\quad t_p = t\\sqrt{D/D_m},\\quad w_{eff} = h - n t,\\quad A_w = \\pi D t,\\quad I_w = \\frac{\\pi D^{3} t}{8}',
    },
    {
      label: '爆破约束壁厚（式5）',
      tex: '\\star\\ t_b = \\frac{k_b\\, p\\, D}{2 \\sigma_b}',
    },
    {
      label: '真空塌陷约束壁厚（式6）',
      tex: '\\star\\ t_v = D \\left[ \\frac{n_v\\, p_v\\, (1 - \\nu^{2})}{2\\, E\\, C_L} \\right]^{1/3}',
    },
    {
      label: '声辐射约束壁厚（式7~9）',
      tex: '\\star\\ L_{W,req} = L_{p,req} + 10\\lg(2\\pi r L),\\quad v_{allow} = \\sqrt{\\frac{10^{(L_{W,req}-120)/10}}{\\rho_0 c_0 S\\, \\sigma_{rad}}},\\quad t_r = \\frac{p_{ac}}{2\\pi f_{ex}\\, \\rho\\, v_{allow}}',
    },
    {
      label: '壁厚取值（式10）',
      tex: '\\star\\ t = \\max(t_b,\\, t_v,\\, t_r),\\quad \\text{向上圆整至}\\ 0.5\\ \\mathrm{mm}',
    },
    {
      label: '单波刚度与整体刚度（式11~12）',
      tex: '\\star\\ K = \\frac{1.7\\, D_m\\, E\\, t_p^{3}\\, n}{w_{eff}^{3}\\, C_f},\\qquad K_{er} = \\frac{K}{N}',
    },
    {
      label: '隔振给出的波数下限（式13~15）',
      tex: '\\star\\ T_t = 10^{-R_{req}/20},\\quad f_{n,max} = \\frac{f_{ex}}{\\sqrt{1 + 1/T_t}},\\quad N_{min} = \\frac{K}{M\\, (2\\pi f_{n,max})^{2}}',
    },
    {
      label: '拔脱力给出的波数上限（式16~17）',
      tex: '\\star\\ N_{max} = \\frac{K\\, \\Delta_{allow}}{F_{pull}},\\qquad N_{min} \\le N \\le N_{max}',
    },
    {
      label: '长度与质量（式18~19）',
      tex: '\\star\\ L = N\\, w,\\qquad M = \\rho\\, \\pi D t\\, L + M_{joint}',
    },
    {
      label: '校核：固有频率、传递率与隔振率（式20~21）',
      tex: '\\star\\ f_n = \\frac{1}{2\\pi}\\sqrt{\\frac{K_{er}}{M}},\\quad r = \\frac{f_{ex}}{f_n},\\quad T_r = \\sqrt{\\frac{1+(2\\zeta r)^{2}}{(1-r^{2})^{2}+(2\\zeta r)^{2}}},\\quad R = -20\\lg T_r \\ge R_{req}',
    },
    {
      label: '校核：辐射效率（式22）',
      tex: '\\star\\ \\sigma_{rad} = \\frac{2}{\\pi}\\frac{(ka)^{2}}{\\sqrt{1-(f/f_r)^{2}}}\\ (f < f_r),\\qquad \\sigma_{rad} = \\frac{1}{\\sqrt{1-(f_r/f)^{2}}}\\ (f \\ge f_r)',
    },
    {
      label: '校核：辐射声功率与测点声压级（式23）',
      tex: '\\star\\ L_W = 10\\lg\\frac{\\rho_0 c_0 S\\, \\sigma_{rad}\\, v^{2}}{10^{-12}},\\qquad L_p = L_W - 10\\lg(2\\pi r L) \\le L_{p,req}',
    },
    {
      label: '校核：拔脱、真空与爆破（式24~25）',
      tex: '\\star\\ F = K_{er}\\, \\Delta_{allow} \\ge F_{pull},\\qquad p_{cr} \\ge n_v\\, p_v,\\qquad p_b = \\frac{2 t \\sigma_b}{D} \\ge k_b\\, p',
    },
    {
      label: '位移合成与行程校核（式26~30）',
      tex: '\\star\\ \\Delta = \\sqrt{\\Delta x^2+\\Delta y^2+\\Delta z^2},\\quad \\Delta_a = \\Delta x,\\quad \\Delta_l = \\sqrt{\\Delta y^2+\\Delta z^2},\\quad e_a = \\frac{\\Delta_a}{N} \\le \\varepsilon_a h,\\quad e_l = \\frac{\\Delta_l}{N} \\le \\varepsilon_l h,\\quad N_{min,\\Delta} = \\max\\!\\left[\\frac{\\Delta_a}{\\varepsilon_a h},\\, \\frac{\\Delta_l}{\\varepsilon_l h}\\right]',
    },
    {
      label: '位移应力与组合应力（式31~34）',
      tex: '\\star\\ \\sigma_{dm} = \\frac{E\\, t^{2}\\, e_a}{2 h^{3}},\\quad \\sigma_{db} = \\frac{5 E\\, t\\, e_a}{3 h^{2}},\\quad \\sigma_d = \\sigma_{dm} + \\sigma_{db},\\quad \\sigma_p = \\frac{p\\, h}{2 t} + \\frac{p\\, h^{2}}{2 t^{2}},\\quad \\sigma_{eq} = \\sigma_p + \\sigma_d \\le \\frac{[\\sigma]}{SF_s}',
    },
    {
      label: '疲劳与轴向力校核（式35~36）',
      tex: '\\star\\ \\Delta\\sigma = 2\\sigma_d \\le \\frac{S_f(N_f)}{SF_f},\\qquad F = K_{er}\\, \\Delta_a \\le F_{joint}',
    },
  ],
  diagram: INTAKE_HOSE_DIAGRAM,
  sensitivity: true,
  assumptions: [
    '公式与参考文档《乘用车橡胶进气软管几何参数反算设计（含位移校核）》一致，对应其式 (1)~(36)，依据 SAE J20、GB/T 3683、EJMA 波纹管经验式、FSA 手册与 Bies《Engineering Noise Control》',
    '反算流程：t = max(tb, tv, tr) 并向上圆整至 0.5 mm；N 取隔振下限的向上取整且不超过拔脱上限 Nmax；若 Nmin > Nmax，材料/结构无法同时满足，「可行区间宽度」输出为负，需降低硬度/壁厚、增加增强层或放宽隔振率',
    'Nmin 与总成质量 M 互相耦合（N → L → M → K_er,max → Nmin，文档要求迭代 2~3 轮）；本实现把式(15)~(19) 联立为关于 N 的二次方程 aN²+bN−K=0 直接求正根，与迭代收敛结果一致',
    '式(14) 由无阻尼近似 Tr ≈ 1/(r²−1) 反解 fn,max；阻尼使实际传递率略偏高，本实现按文档设计流程⑥在 N ≤ ⌊Nmax⌋ 内自动递增 N 直至 R ≥ Rreq，仍不满足时隔振余量为负',
    '声辐射约束壁厚由质量控制段质量律 v = p/(2πfρt) 反解；pac 为管内声压（压力脉动）幅值；若辐射由结构振动主导，应改用实测壁面振速/加速度直接校核而不必反算 t（见文档 3.3 节）',
    '辐射效率在 f → fr 附近公式发散，本实现将 σrad 限幅到 [0, 1]（工程近似）；橡胶阻尼大，实际辐射低于同尺寸金属管，精确值须实测或 FEA 修正',
    'K 为单波刚度（EJMA 经验式，Cf 取 0.8~1.5）；带直段时整体刚度应按波纹段与直段串联加权，本实现按整段波纹等效',
    '橡胶 E 随硬度、温度、应变幅变化，建议用 20~80 ℃ 实测 E 区间做包络设计；HA 仅作材料选型记录，不参与计算',
    '拔脱力本质是接头/卡箍能力，式(16) 只给出软管轴向刚度下限，最终仍需做拔脱试验；反算结果须用正算模型复核并留 10%~20% 设计余量（本模块校核组已给出 R、Lp、F、pcr、pb 余量）',
    '运动位移校核按文档第 7 章式 (26)~(36)：行程下限 Nmin,Δ 与隔振下限 Nmin 取大后并入 N 的取值；式(31)(33) 中的壁厚符号 δ 以管壁厚度 t 代入、压力 q 以工作压力 p 代入；许用应力 [σ] 取 σb/3（文档建议拉伸强度的 1/3~1/2）',
    '疲劳校核 Δσ = 2σd ≤ Sf(Nf)/SFf：Sf(Nf) 需按 EJMA 疲劳曲线或胶料疲劳试验在设计循环次数 Nf 处取值后作为输入给出，Nf 本身不直接参与计算',
  ],
  solve(v) {
    const empty: Record<string, number> = {
      t: NaN, N: NaN, L: NaN,
      tb: NaN, tv: NaN, tr: NaN, vallow: NaN,
      Dm: NaN, tp: NaN, weff: NaN, K: NaN, Ker: NaN, M: NaN,
      Tt: NaN, fnMax: NaN, Nmin: NaN, Nmax: NaN, Ngap: NaN,
      fn: NaN, ratio: NaN, Tr: NaN, R: NaN, Rmargin: NaN,
      cL: NaN, fr: NaN, sigRad: NaN, vWall: NaN, S: NaN, W: NaN, LW: NaN, Lp: NaN, LpMargin: NaN,
      F: NaN, Fratio: NaN, pcr: NaN, pcrRatio: NaN, pb: NaN, pbRatio: NaN,
      Delta: NaN, DeltaL: NaN, ea: NaN, el: NaN, eaRatio: NaN, elRatio: NaN, NminD: NaN,
      sigmaD: NaN, sigmaP: NaN, sigmaEq: NaN, sigRatio: NaN, dSigma: NaN, fatRatio: NaN, Fax: NaN, FaxRatio: NaN,
    };
    const ok =
      v.D > 0 && v.w > 0 && v.h > 0 && v.n >= 1 && v.E > 0 && v.rho > 0 && v.sigmaB > 0 &&
      v.nu > 0 && v.nu < 0.5 && v.zeta > 0 && v.Rreq > 0 && v.r > 0 && v.Fpull > 0 &&
      v.deltaAllow > 0 && v.pv > 0 && v.p > 0 && v.pac > 0 && v.fex > 0 && v.Cf > 0 &&
      v.CL > 0 && v.kb > 0 && v.nv > 0 && v.Mjoint >= 0 && v.rho0 > 0 && v.c0 > 0 &&
      v.dx >= 0 && v.dy >= 0 && v.dz >= 0 && v.epsA > 0 && v.epsL > 0 &&
      v.SFs > 0 && v.sigmaF > 0 && v.SFf > 0 && v.Fjoint > 0;
    if (!ok) return empty;

    // 位移合成与行程下限（式26~30，与 t、N 无关）
    const Delta = Math.sqrt(v.dx * v.dx + v.dy * v.dy + v.dz * v.dz);
    const DeltaA = v.dx;
    const DeltaL = Math.sqrt(v.dy * v.dy + v.dz * v.dz);
    const NminD = Math.max(DeltaA / (v.epsA * v.h), DeltaL / (v.epsL * v.h));

    // 辐射效率（与 t、N 无关，只算一次）
    const cL = Math.sqrt(v.E / (v.rho * (1 - v.nu * v.nu)));
    const fr = cL / (Math.PI * v.D);
    const ka = (2 * Math.PI * v.fex * (v.D / 2)) / v.c0;
    let sigRad: number;
    if (v.fex < fr) {
      sigRad = ((2 / Math.PI) * ka * ka) / Math.sqrt(1 - Math.pow(v.fex / fr, 2));
    } else {
      sigRad = 1 / Math.sqrt(1 - Math.pow(fr / v.fex, 2));
    }
    // f → fr 附近公式发散，工程限幅到 [0, 1]
    sigRad = Math.min(1, Math.max(0, sigRad));

    // 壁厚前两项约束（与 L 无关，式5~6）
    const tb = (v.kb * v.p * v.D) / (2 * v.sigmaB);
    const tv = v.D * Math.cbrt((v.nv * v.pv * (1 - v.nu * v.nu)) / (2 * v.E * v.CL));

    // 隔振目标（式13~14）
    const Tt = Math.pow(10, -v.Rreq / 20);
    const fnMax = v.fex / Math.sqrt(1 + 1 / Tt);
    const w2 = Math.pow(2 * Math.PI * fnMax, 2);

    /** 向上圆整至 0.5 mm（式10） */
    const round05 = (x: number) => Math.ceil(x / 5e-4) * 5e-4;

    // 迭代：t → K → N → L → tr → t（tr 依赖 L，L 依赖 N；文档流程②~⑤要求迭代收敛）
    let t = round05(Math.max(tb, tv));
    let N = 1;
    let L = v.w;
    let tr = 0;
    let vallow = 0;
    let Dm = NaN;
    let tp = NaN;
    let weff = NaN;
    let K = NaN;
    let Nmin = NaN;
    let Nmax = NaN;
    for (let it = 0; it < 20; it++) {
      // 声辐射约束（式7~9，依赖当前 L）
      const LWreq = v.LpReq + 10 * Math.log10(2 * Math.PI * v.r * L);
      const Wreq = Math.pow(10, (LWreq - 120) / 10);
      const Sc = Math.PI * v.D * L;
      vallow = Math.sqrt(Wreq / (v.rho0 * v.c0 * Sc * sigRad));
      tr = v.pac / (2 * Math.PI * v.fex * v.rho * vallow);
      const tNew = round05(Math.max(tb, tv, tr));

      // 几何与单波刚度（式1~3、11）
      Dm = v.D + v.h + v.n * tNew;
      tp = tNew * Math.sqrt(v.D / Dm);
      weff = v.h - v.n * tNew;
      if (weff <= 0) return empty; // 波高不足以容纳 n·t
      K = (1.7 * Dm * v.E * Math.pow(tp, 3) * v.n) / (Math.pow(weff, 3) * v.Cf);

      // 波数下限（式15）：Nmin·(ρπD·t·w·Nmin + M_j)·ω² = K 的正根（联立式18~19）
      const aq = v.rho * Math.PI * v.D * tNew * v.w * w2;
      const bq = v.Mjoint * w2;
      Nmin = (-bq + Math.sqrt(bq * bq + 4 * aq * K)) / (2 * aq);
      // 波数上限（式16）
      Nmax = (K * v.deltaAllow) / v.Fpull;

      // 取 N = ⌈max(Nmin, Nmin,Δ)⌉，并按流程⑥在 N ≤ ⌊Nmax⌋ 内递增至 R ≥ Rreq
      const Ncap = Math.max(1, Math.floor(Nmax));
      let Nnew = Math.min(Math.max(1, Math.ceil(Math.max(Nmin, NminD))), Ncap);
      for (;;) {
        const Lc = Nnew * v.w;
        const Mc = v.rho * Math.PI * v.D * tNew * Lc + v.Mjoint;
        const KerC = K / Nnew;
        const fnC = Math.sqrt(KerC / Mc) / (2 * Math.PI);
        const rC = v.fex / fnC;
        const z2 = 2 * v.zeta * rC;
        const TrC = Math.sqrt((1 + z2 * z2) / (Math.pow(1 - rC * rC, 2) + z2 * z2));
        const RC = -20 * Math.log10(TrC);
        if (RC >= v.Rreq || Nnew >= Ncap) break;
        Nnew++;
      }

      const Lnew = Nnew * v.w;
      if (tNew === t && Nnew === N) break;
      t = tNew;
      N = Nnew;
      L = Lnew;
    }

    // 正算复核（式18~25）
    const S = Math.PI * v.D * L;
    const M = v.rho * Math.PI * v.D * t * L + v.Mjoint;
    const Ker = K / N;
    const fn = Math.sqrt(Ker / M) / (2 * Math.PI);
    const ratio = v.fex / fn;
    const z2 = 2 * v.zeta * ratio;
    const Tr = Math.sqrt((1 + z2 * z2) / (Math.pow(1 - ratio * ratio, 2) + z2 * z2));
    const R = -20 * Math.log10(Tr);
    const Rmargin = R - v.Rreq;

    const vWall = v.pac / (2 * Math.PI * v.fex * v.rho * t);
    const W = v.rho0 * v.c0 * S * sigRad * vWall * vWall;
    const LW = 10 * Math.log10(W / 1e-12);
    const Lp = LW - 10 * Math.log10(2 * Math.PI * v.r * L);
    const LpMargin = v.LpReq - Lp;

    const F = Ker * v.deltaAllow;
    const Fratio = F / v.Fpull;
    const pcr = ((2 * v.E) / (1 - v.nu * v.nu)) * Math.pow(t / v.D, 3) * v.CL;
    const pcrRatio = pcr / (v.nv * v.pv);
    const pb = (2 * t * v.sigmaB) / v.D;
    const pbRatio = pb / (v.kb * v.p);
    const Ngap = Nmax - Math.max(Nmin, NminD);

    // 运动位移与行程校核（式26~36）
    const ea = DeltaA / N;
    const el = DeltaL / N;
    const eaRatio = ea / (v.epsA * v.h);
    const elRatio = el / (v.epsL * v.h);
    const sigmaDm = (v.E * t * t * ea) / (2 * Math.pow(v.h, 3));
    const sigmaDb = (5 * v.E * t * ea) / (3 * v.h * v.h);
    const sigmaD = sigmaDm + sigmaDb;
    const sigmaP = (v.p * v.h) / (2 * t) + (v.p * v.h * v.h) / (2 * t * t);
    const sigmaEq = sigmaP + sigmaD;
    const sigRatio = sigmaEq / (v.sigmaB / 3 / v.SFs);
    const dSigma = 2 * sigmaD;
    const fatRatio = v.sigmaF / (v.SFf * dSigma);
    const Fax = Ker * DeltaA;
    const FaxRatio = v.Fjoint / Fax;

    return {
      t, N, L,
      tb, tv, tr, vallow,
      Dm, tp, weff, K, Ker, M,
      Tt, fnMax, Nmin, Nmax, Ngap,
      fn, ratio, Tr, R, Rmargin,
      cL, fr, sigRad, vWall, S, W, LW, Lp, LpMargin,
      F, Fratio, pcr, pcrRatio, pb, pbRatio,
      Delta, DeltaL, ea, el, eaRatio, elRatio, NminD,
      sigmaD, sigmaP, sigmaEq, sigRatio, dSigma, fatRatio, Fax, FaxRatio,
    };
  },
  benchmarks: [
    {
      name: '反算算例：D50 / w12 / h20 / 2 层，Rreq 12 dB，自然吸气真空 30 kPa（真空塌陷约束控制）',
      input: {
        D: 0.05, w: 0.012, h: 0.02, n: 2,
        E: 6e6, rho: 1200, sigmaB: 10e6, nu: 0.49, zeta: 0.08, HA: 65,
        Rreq: 12, LpReq: 75, r: 1.0, Fpull: 500, deltaAllow: 0.005,
        pv: 3e4, p: 1e5, pac: 100, fex: 200,
        Cf: 1, CL: 2, kb: 4, nv: 1.8,
        Mjoint: 0.4, rho0: 1.205, c0: 343,
        dx: 0.002, dy: 0.001, dz: 0.001, epsA: 0.15, epsL: 0.08,
        SFs: 2, sigmaF: 3e6, SFf: 1.5, Nf: 1e6, Fjoint: 1000,
      },
      expect: {
        t: 0.006, N: 3, L: 0.036000000000000004,
        tb: 0.001, tv: 0.005978831654688267, tr: 0.002885096451583242, vallow: 0.022985214094049404,
        Dm: 0.082, tp: 0.004685212856658182, weff: 0.008,
        K: 336017.60956345405, Ker: 112005.86985448468, M: 0.44071504079052376,
        Tt: 0.251188643150958, fnMax: 89.61250111744494,
        Nmin: 2.4466481390249206, Nmax: 3.360176095634541, Ngap: 0.9135279566096202,
        fn: 80.23458063666155, ratio: 2.4926907876005537, Tr: 0.20590029753362,
        R: 13.726860516195371, Rmargin: 1.7268605161953712,
        cL: 81.11604732299901, fr: 516.4007958212559, sigRad: 0.005792709076538173,
        vWall: 0.011052426603603843, S: 0.005654866776461628,
        W: 0.0000016538668472809484, LW: 62.185005416017056,
        Lp: 68.64018172476304, LpMargin: 6.359818275236961,
        F: 560.0293492724235, Fratio: 1.1200586985448469,
        pcr: 54575.60205290169, pcrRatio: 1.0106592972759572,
        pb: 2400000, pbRatio: 6,
        Delta: 0.002449489742783178, DeltaL: 0.001414213562373095,
        ea: 0.0006666666666666666, el: 0.0004714045207910317,
        eaRatio: 0.2222222222222222, elRatio: 0.2946278254943948,
        NminD: 0.8838834764831843, sigmaD: 109000.00000000001,
        sigmaP: 722222.2222222221, sigmaEq: 831222.2222222221,
        sigRatio: 0.49873333333333325, dSigma: 218000.00000000003,
        fatRatio: 9.174311926605503, Fax: 224.01173970896937, FaxRatio: 4.464051755944468,
      },
      tolerance: 1e-9,
      source: '按参考文档式 (1)~(36) 自建反算算例：tv 控制壁厚，N 位于隔振/拔脱可行区间内，含位移与疲劳校核',
    },
    {
      name: '高声压工况：pac 300 Pa（声辐射约束控制壁厚），阻尼校核递增 N',
      input: {
        D: 0.05, w: 0.012, h: 0.02, n: 2,
        E: 6e6, rho: 1200, sigmaB: 10e6, nu: 0.49, zeta: 0.08, HA: 65,
        Rreq: 12, LpReq: 75, r: 1.0, Fpull: 500, deltaAllow: 0.005,
        pv: 3e4, p: 1e5, pac: 300, fex: 200,
        Cf: 1, CL: 2, kb: 4, nv: 1.8,
        Mjoint: 0.4, rho0: 1.205, c0: 343,
        dx: 0.002, dy: 0.001, dz: 0.001, epsA: 0.15, epsL: 0.08,
        SFs: 2, sigmaF: 3e6, SFf: 1.5, Nf: 1e6, Fjoint: 1000,
      },
      expect: {
        t: 0.009000000000000001, N: 98, L: 1.176,
        tb: 0.001, tv: 0.005978831654688267, tr: 0.008655289354749724, vallow: 0.022985214094049407,
        Dm: 0.08800000000000001, tp: 0.006784005252999682, weff: 0.0019999999999999983,
        K: 70061814.25035442, Ker: 714916.4719423921, M: 2.395036998735663,
        Tt: 0.251188643150958, fnMax: 89.61250111744494,
        Nmin: 94.82867499346564, Nmax: 700.6181425035443, Ngap: 605.7894675100787,
        fn: 86.95442147239473, ratio: 2.3000555533969442, Tr: 0.24746013139758832,
        R: 12.129895216123481, Rmargin: 0.1298952161234812,
        cL: 81.11604732299901, fr: 516.4007958212559, sigRad: 0.005792709076538173,
        vWall: 0.022104853207207686, S: 0.18472564803107983,
        W: 0.00021610526804471055, LW: 83.346653539025,
        Lp: 74.66078163804265, LpMargin: 0.3392183619573501,
        F: 3574.58235971196, Fratio: 7.14916471942392,
        pcr: 184192.6569285433, pcrRatio: 3.410975128306357,
        pb: 3600000.0000000005, pbRatio: 9.000000000000002,
        Delta: 0.002449489742783178, DeltaL: 0.001414213562373095,
        ea: 0.000020408163265306123, el: 0.000014430750636460154,
        eaRatio: 0.006802721088435374, elRatio: 0.009019219147787597,
        NminD: 0.8838834764831843, sigmaD: 5211.734693877553,
        sigmaP: 358024.6913580246, sigmaEq: 363236.4260519022,
        sigRatio: 0.2179418556311413, dSigma: 10423.469387755105,
        fatRatio: 191.87469407733718, Fax: 1429.832943884784, FaxRatio: 0.6993824028722198,
      },
      tolerance: 1e-9,
      source: '自建高声压算例：tr > tv 时壁厚由声辐射约束控制，且 N 经阻尼校核递增后仍满足 R ≥ Rreq',
    },
  ],
};
