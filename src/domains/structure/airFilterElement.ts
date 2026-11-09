import type { FormulaSpec } from '../../formula/types';
import { FILTER_DIAGRAM } from './diagrams';

/**
 * 空气滤清器滤芯设计（圆柱折叠式 / 面板式）
 *
 * 按参考 PPT《空气滤清器滤芯设计·公式与参数输入清单（2026）》
 * （依据 ISO 5011:2025 / GB/T 28949-2025 / QC/T 32-2017）的五参数闭环实现：
 *   体积流量   Q = ηv·Π·(T0/T2)·Vd·N/120          （增压按歧管状态修正，自然吸气 Π = 1）
 *   所需面积   Am_req = Q / vm                     （vm 为设计滤材面速度）
 *   褶皱几何   圆柱式：h = (D − d)/2，Np = π·Dm/p，Am = 2·Np·h·L
 *              面板式：Np = Lp/p，Am = 2·Np·h·W
 *   均匀度修正 Am_eff = γu·Am，vm_max = Q/Am_eff   （气流不均折减有效面积）
 *   滤材压降   Δpm = μ·vm_max·t/K + ρ·β·vm_max²·t （Darcy + Forchheimer，按局部最大面速度校核）
 *   滤芯总压降 Δp = k_c·Δpm                        （k_c = 1.2~1.6，含褶皱通道与壳体）
 *   服务寿命   T = s_f·DHC·Am_eff / (Cu·Q·η)       （Cu 以 g/m³ 计）
 *   折算里程   L_km = T·v_avg
 *   溃破要求   Δp_c ≥ 3·Δp_e
 */
export const airFilterElement: FormulaSpec = {
  id: 'structure.airFilter.element',
  domain: 'structure',
  subsystem: '空气滤清器',
  title: '★空气滤清器滤芯设计',
  summary: '按「流量 → 面积 → 褶皱 → 压降 → 寿命」五参数闭环设计圆柱折叠式 / 面板式滤芯：由发动机需求算 Q，按面速度定面积，用褶皱几何实现，计入气流均匀度折减，校核 Darcy+Forchheimer 压降，最后估算容尘寿命与溃破要求。',
  tags: ['空气滤清器', '滤芯', '圆柱式', '面板式', '褶皱', '均匀度', 'Darcy', '压降', '容尘量', 'DHC', '寿命', 'ISO 5011', '进气系统', '结构设计'],
  description:
    '圆柱折叠式与面板式滤芯的五参数闭环设计：1) 体积流量 Q = ηv·Π·(T0/T2)·Vd·N/120（自然吸气 Π=1；增压按歧管状态修正，取额定功率点与最大扭矩点较大值）；2) 所需滤材面积 Am_req = Q/vm（vm 推荐 0.08~0.10 m/s）；3) 褶皱实现——圆柱式 h = (D−d)/2、Np = π·Dm/p、Am = 2·Np·h·L，面板式 Np = Lp/p、Am = 2·Np·h·W，余量建议 20~30%；4) 气流均匀度按系数 γu 折减有效面积 Am_eff = γu·Am，滤材压降按局部最大面速度 vm_max = Q/Am_eff 计算 Δpm = μ·vm_max·t/K + ρ·β·vm_max²·t，滤芯总压降按修正系数 k_c = 1.2~1.6 估算，初始压降限值 <0.5 kPa（自然吸气）/ <1.25 kPa（增压）；5) 寿命 T = s_f·DHC·Am_eff/(Cu·Q·η)，安全系数 0.6~0.8；溃破压力 ≥ 3× 终了压降。',
  inputs: [
    { key: 'ftype', label: '滤芯结构型式', symbol: '-', unit: '-', kind: 'select', options: [{ value: 1, label: '圆柱折叠式（径向褶皱）' }, { value: 2, label: '面板式（平板褶皱）' }], default: 1, required: true, description: '圆柱式按外径/内径/长度计算褶皱；面板式按褶高、面板长度与宽度计算' },
    { key: 'Vd', label: '发动机排量', symbol: 'Vd', unit: 'L', unitGroup: 'volume', default: 2.0, min: 0, required: true, description: '四冲程发动机排量，2.0 L = 0.002 m³' },
    { key: 'N', label: '发动机转速', symbol: 'N', unit: 'rpm', default: 6000, min: 0, required: true, description: '取额定功率点或最大扭矩点转速，两者分别计算取较大流量' },
    { key: 'etaV', label: '容积效率', symbol: 'ηv', unit: '-', default: 0.92, min: 0, max: 1.2, required: true, description: '自然吸气 0.85~0.95；增压 0.90~1.00' },
    { key: 'Pi', label: '增压比', symbol: 'Π', unit: '-', default: 2.2, min: 1, max: 4, required: true, description: '歧管绝对压力与环境压力之比 p2/p0，自然吸气发动机取 1.0' },
    { key: 'T0', label: '环境温度', symbol: 'T0', unit: 'K', default: 298, min: 0, required: true, description: '环境空气绝对温度，常用 253~318 K' },
    { key: 'T2', label: '歧管温度', symbol: 'T2', unit: 'K', default: 313, min: 0, required: true, description: '中冷后歧管空气绝对温度，自然吸气可近似取 T0' },
    { key: 'vm', label: '设计滤材面速度', symbol: 'vm', unit: 'm/s', unitGroup: 'velocity', default: 0.1, min: 0.01, max: 0.2, required: true, description: '通过滤材的面速度，设计窗口 0.05~0.12 m/s，推荐 0.08~0.10 m/s；vm 越大压降越高、寿命越短' },
    { key: 'D', label: '滤芯外径', symbol: 'D', unit: 'mm', unitGroup: 'diameter', default: 200, min: 0, required: true, showIf: { key: 'ftype', max: 1 }, description: '圆柱滤芯外径，典型 150~300 mm，由安装空间确定' },
    { key: 'd', label: '滤芯内径', symbol: 'd', unit: 'mm', unitGroup: 'diameter', default: 120, min: 0, required: true, showIf: { key: 'ftype', max: 1 }, description: '滤芯中心通道内径，典型 80~180 mm，须小于外径' },
    { key: 'L', label: '滤芯长度', symbol: 'L', unit: 'mm', unitGroup: 'length', default: 300, min: 0, required: true, showIf: { key: 'ftype', max: 1 }, description: '圆柱滤芯有效长度，典型 200~400 mm' },
    { key: 'hP', label: '褶高', symbol: 'h', unit: 'mm', unitGroup: 'length', default: 40, min: 8, max: 40, required: true, showIf: { key: 'ftype', min: 2 }, description: '面板式褶皱高度，设计窗口 8~40 mm；越高面积越大，但通道压降上升' },
    { key: 'Lp', label: '面板长度（沿褶排列方向）', symbol: 'Lp', unit: 'mm', unitGroup: 'length', default: 450, min: 0, required: true, showIf: { key: 'ftype', min: 2 }, description: '沿褶皱排列方向的面板尺寸，褶数 Np = Lp/p' },
    { key: 'W', label: '面板宽度（褶条长度方向）', symbol: 'W', unit: 'mm', unitGroup: 'length', default: 350, min: 0, required: true, showIf: { key: 'ftype', min: 2 }, description: '单条褶皱的展开长度，Am = 2·Np·h·W' },
    { key: 'p', label: '褶距', symbol: 'p', unit: 'mm', unitGroup: 'length', default: 6, min: 0, required: true, description: '相邻褶皱间距，设计窗口 3~8 mm；过小易堵易塌、通道压降急升' },
    { key: 'mu', label: '空气动力粘度', symbol: 'μ', unit: 'Pa·s', unitGroup: 'dynamicViscosity', default: 1.81e-5, min: 0, required: true, description: '20℃ 空气约 1.81×10⁻⁵ Pa·s' },
    { key: 'rho', label: '空气密度', symbol: 'ρ', unit: 'kg/m³', unitGroup: 'density', default: 1.2, min: 0, required: true, description: '20℃、1 atm 约 1.2 kg/m³，仅 Forchheimer 惯性项使用' },
    { key: 't', label: '滤材厚度', symbol: 't', unit: 'mm', unitGroup: 'length', default: 0.5, min: 0, required: true, description: '滤材（介质）厚度，典型 0.3~0.8 mm，供应商数据' },
    { key: 'K', label: '滤材渗透率', symbol: 'K', unit: 'm²', unitGroup: 'permeability', default: 5e-12, min: 0, required: true, description: 'Darcy 渗透率，典型 1~10×10⁻¹² m²（输入 5e-12 即 5×10⁻¹²），供应商实测' },
    { key: 'beta', label: '惯性系数（Forchheimer）', symbol: 'β', unit: 'm⁻¹', unitGroup: 'inverseLength', default: 0, min: 0, required: true, description: '高速/高填充时的二次项系数，无数据时取 0 退化为纯 Darcy 项' },
    { key: 'kc', label: '压降修正系数', symbol: 'k_c', unit: '-', default: 1.5, min: 1, max: 2, required: true, description: '滤芯总压降 = k_c × 滤材压降，工程估算 1.2~1.6，含褶皱通道与壳体阻力' },
    { key: 'gammaU', label: '气流均匀度系数', symbol: 'γu', unit: '-', default: 0.9, min: 0.5, max: 1, required: true, description: '滤芯迎风面流速均匀度（CFD 或台架流速分布实测）：理想均匀取 1.0，良好设计 0.85~0.95，差设计 0.7~0.85；有效面积 Am_eff = γu·Am' },
    { key: 'DHC', label: '单位面积容尘量', symbol: 'DHC', unit: 'g/m²', default: 400, min: 0, required: true, description: '按 ISO 5011 A2 粉尘、至终了压降测得的单位面积容尘量' },
    { key: 'Cu', label: '环境粉尘浓度', symbol: 'Cu', unit: 'mg/m³', default: 1, min: 0, required: true, description: '城市 0.5~5 mg/m³；矿山/农业 10~100 mg/m³，现场实测' },
    { key: 'eta', label: '重量效率', symbol: 'η', unit: '%', default: 99.5, min: 0, max: 100, required: true, description: 'ISO 5011 重量法效率，乘用车 ≥99.5%，重载 ≥99.9%' },
    { key: 'sf', label: '寿命安全系数', symbol: 's_f', unit: '-', default: 0.7, min: 0.1, max: 1, required: true, description: '现场粉尘波动/超载修正，0.6~0.8' },
    { key: 'vAvg', label: '平均车速', symbol: 'v', unit: 'km/h', default: 60, min: 0, required: true, description: '用于把寿命小时数折算为保养里程' },
    { key: 'dpe', label: '终了压降', symbol: 'Δp_e', unit: 'kPa', unitGroup: 'pressure', default: 6.25, min: 0, required: true, description: '寿命终点的滤芯压降限值：2.5 kPa（自然吸气）/ 3.75~6.25 kPa（增压）' },
  ],
  outputs: [
    { key: 'Q', label: '滤芯体积流量', symbol: 'Q', unit: 'm³/s', unitGroup: 'volumeFlow', digits: 3, group: '流量与面积', description: 'Q = ηv·Π·(T0/T2)·Vd·N/120' },
    { key: 'AmReq', label: '所需滤材面积', symbol: 'Am_req', unit: 'm²', unitGroup: 'area', digits: 3, group: '流量与面积', description: 'Am_req = Q/vm，由设计面速度反算' },
    { key: 'h', label: '褶高', symbol: 'h', unit: 'mm', unitGroup: 'length', digits: 3, group: '褶皱几何', description: '圆柱式 h = (D − d)/2；面板式直接取褶高输入，设计窗口 8~40 mm' },
    { key: 'Np', label: '褶数', symbol: 'Np', unit: '-', digits: 3, group: '褶皱几何', description: '圆柱式 Np = π·Dm/p（Dm = (D + d)/2）；面板式 Np = Lp/p' },
    { key: 'Am', label: '实际滤材面积', symbol: 'Am', unit: 'm²', unitGroup: 'area', digits: 3, group: '褶皱几何', description: '圆柱式 Am = 2·Np·h·L；面板式 Am = 2·Np·h·W（褶皱双面利用）' },
    { key: 'AmEff', label: '有效滤材面积（计均匀度）', symbol: 'Am_eff', unit: 'm²', unitGroup: 'area', digits: 3, group: '褶皱几何', description: 'Am_eff = γu·Am，气流不均时实际参与过滤的面积' },
    { key: 'margin', label: '面积余量', symbol: 'δ', unit: '%', digits: 3, group: '褶皱几何', description: 'δ = (Am − Am_req)/Am_req，建议 ≥20~30%（容尘后压降上升、胶线/端盖占用面积）' },
    { key: 'vmReal', label: '平均面速度', symbol: "vm'", unit: 'm/s', unitGroup: 'velocity', digits: 3, group: '压降校核', description: "vm' = Q/Am，按几何面积回算的平均面速度" },
    { key: 'vmMax', label: '局部最大面速度', symbol: 'vm_max', unit: 'm/s', unitGroup: 'velocity', digits: 3, group: '压降校核', description: 'vm_max = Q/Am_eff = vm′/γu，气流最集中区域的面速度，压降按此校核' },
    { key: 'dpm', label: '滤材压降（Darcy+Forchheimer）', symbol: 'Δp_m', unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '压降校核', description: 'Δpm = μ·vm_max·t/K + ρ·β·vm_max²·t，按局部最大面速度计算' },
    { key: 'dp', label: '滤芯总压降（估算）', symbol: 'Δp', unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '压降校核', primary: true, description: 'Δp = k_c·Δpm，含褶皱通道与壳体；初始压降限值 <0.5 kPa（自然吸气）/ <1.25 kPa（增压）' },
    { key: 'life', label: '服务寿命', symbol: 'T', unit: 'h', digits: 3, group: '寿命与校核', primary: true, description: 'T = s_f·DHC·Am_eff/(Cu·Q·η)，面积按均匀度折减并已计入安全系数' },
    { key: 'mileage', label: '折算保养里程', symbol: 'L_km', unit: 'km', digits: 3, group: '寿命与校核', description: 'L_km = T·v_avg，按平均车速折算' },
    { key: 'dpc', label: '溃破压力要求', symbol: 'Δp_c', unit: 'kPa', unitGroup: 'pressure', digits: 3, group: '寿命与校核', description: 'Δp_c ≥ 3×Δp_e（重载 3~5×），须台架验证' },
  ],
  latex: [
    {
      label: '体积流量（增压按歧管状态修正，自然吸气 Π = 1）',
      tex: 'Q = \\eta_v\\,\\Pi\\,\\frac{T_0}{T_2}\\,\\frac{V_d\\,N}{120}',
    },
    {
      label: '所需滤材面积',
      tex: 'A_{m,req} = \\frac{Q}{v_m}',
    },
    {
      label: '褶皱几何（圆柱折叠式）',
      tex: 'h = \\frac{D - d}{2},\\qquad D_m = \\frac{D + d}{2},\\qquad N_p = \\frac{\\pi D_m}{p},\\qquad A_m = 2 N_p h L',
    },
    {
      label: '褶皱几何（面板式）',
      tex: 'N_p = \\frac{L_p}{p},\\qquad A_m = 2 N_p h W',
    },
    {
      label: '气流均匀度修正',
      tex: 'A_{m,eff} = \\gamma_u\\, A_m,\\qquad v_{m,max} = \\frac{Q}{A_{m,eff}}',
    },
    {
      label: '滤材压降（Darcy + Forchheimer，按局部最大面速度）',
      tex: '\\Delta p_m = \\frac{\\mu\\, v_{m,max}\\, t}{K} + \\rho\\,\\beta\\, v_{m,max}^{2}\\, t,\\qquad \\Delta p = k_c\\,\\Delta p_m',
    },
    {
      label: '服务寿命与折算里程',
      tex: 'T = s_f\\,\\frac{DHC\\cdot A_{m,eff}}{C_u\\, Q\\, \\eta},\\qquad L_{km} = T\\, v_{avg}',
    },
    {
      label: '溃破压力要求',
      tex: '\\Delta p_c \\;\\ge\\; 3\\,\\Delta p_e',
    },
  ],
  diagram: FILTER_DIAGRAM,
  sensitivity: true,
  assumptions: [
    '公式与参考 PPT《空气滤清器滤芯设计·公式与参数输入清单（2026）》一致；均匀度系数 γu = 1 时逐步复现 PPT 设计算例（2.0 L / 6000 rpm / 增压比 2.2）：Q ≈ 0.193 m³/s、Am_req ≈ 1.93 m²、Am ≈ 2.01 m²、Δp ≈ 260 Pa、寿命 ≈ 816 h（约 4.9 万 km）',
    '覆盖圆柱折叠式（径向褶皱，Np = π·Dm/p，Am = 2·Np·h·L）与面板式（平板褶皱，Np = Lp/p，Am = 2·Np·h·W）两种结构，通过「滤芯结构型式」切换',
    '气流均匀度按系数 γu 折减有效面积：Am_eff = γu·Am；压降按局部最大面速度 vm_max = Q/Am_eff 校核，寿命按 Am_eff 估算；γu 应由壳体 CFD 或台架流速分布实测确定，无数据时建议取 0.85~0.9',
    '流量按单工况点计算；实际应分别计算额定功率点与最大扭矩点并取较大值，高原/高温需按环境 p0、T0 修正',
    '滤材压降取 Darcy + Forchheimer 两项；惯性系数 β 无供应商数据时取 0，退化为纯 Darcy 项',
    '滤芯总压降按修正系数 k_c = 1.2~1.6 估算（含褶皱通道与壳体阻力），属工程估算，精确值须台架实测',
    '寿命按实验室 A2 粉尘 DHC 估算并乘安全系数 0.6~0.8；现场粉尘粒径/形状/浓度不同，实际寿命以现场工况为准',
    '效率模型（单纤维捕集、分级效率、品质因子 QF）用于滤材选型比较，不在本公式的计算范围内',
    '溃破压力 ≥3× 终了压降为设计要求下限，本公式只输出校核目标值，溃破与否须按 ISO 5011 台架验证',
  ],
  solve(v) {
    const empty = {
      Q: NaN, AmReq: NaN, h: NaN, Np: NaN, Am: NaN, AmEff: NaN, margin: NaN,
      vmReal: NaN, vmMax: NaN, dpm: NaN, dp: NaN, life: NaN, mileage: NaN, dpc: NaN,
    };
    const cyl = v.ftype !== 2;
    const geomOk = cyl
      ? v.D > 0 && v.d > 0 && v.D > v.d && v.L > 0
      : v.hP > 0 && v.Lp > 0 && v.W > 0;
    if (!(v.Vd > 0) || !(v.N > 0) || !(v.etaV > 0) || !(v.Pi >= 1) || !(v.T0 > 0) || !(v.T2 > 0) ||
        !(v.vm > 0) || !geomOk || !(v.p > 0) ||
        !(v.mu > 0) || !(v.rho > 0) || !(v.t > 0) || !(v.K > 0) || !(v.beta >= 0) || !(v.kc >= 1) ||
        !(v.gammaU > 0) || !(v.gammaU <= 1) ||
        !(v.DHC > 0) || !(v.Cu > 0) || !(v.eta > 0) || !(v.eta < 100) || !(v.sf > 0) || !(v.dpe > 0))
      return empty;

    // 体积流量（m³/s）
    const Q = (v.etaV * v.Pi * (v.T0 / v.T2) * v.Vd * v.N) / 120;
    const Qh = Q * 3600;

    // 所需面积
    const AmReq = Q / v.vm;

    // 褶皱几何（Np 取连续值，保证面积核算自洽）
    let h: number, Np: number, Am: number;
    if (cyl) {
      h = (v.D - v.d) / 2;
      const Dm = (v.D + v.d) / 2;
      Np = (Math.PI * Dm) / v.p;
      Am = 2 * Np * h * v.L;
    } else {
      h = v.hP;
      Np = v.Lp / v.p;
      Am = 2 * Np * h * v.W;
    }
    const margin = ((Am - AmReq) / AmReq) * 100;

    // 均匀度修正：有效面积折减，压降按局部最大面速度校核
    const AmEff = v.gammaU * Am;
    const vmReal = Q / Am;
    const vmMax = Q / AmEff;
    const dpm = (v.mu * vmMax * v.t) / v.K + v.rho * v.beta * vmMax * vmMax * v.t;
    const dp = v.kc * dpm;

    // 寿命（Cu：mg/m³ → g/m³；Qh：m³/h；η：% → 小数；vAvg：km/h）
    const life = (v.sf * v.DHC * AmEff) / (v.Cu * 1e-3 * Qh * (v.eta / 100));
    const mileage = life * v.vAvg;

    // 溃破要求
    const dpc = 3 * v.dpe;

    return { Q, AmReq, h, Np, Am, AmEff, margin, vmReal, vmMax, dpm, dp, life, mileage, dpc };
  },
  benchmarks: [
    {
      name: 'PPT 算例：2.0 L 增压 / 6000 rpm（圆柱式，理想均匀）',
      input: {
        ftype: 1,
        Vd: 0.002, N: 6000, etaV: 0.92, Pi: 2.2, T0: 298, T2: 313, vm: 0.1,
        D: 0.2, d: 0.12, L: 0.3, hP: 0.04, Lp: 0.45, W: 0.35, p: 0.006,
        mu: 1.81e-5, rho: 1.2, t: 5e-4, K: 5e-12, beta: 0, kc: 1.5, gammaU: 1,
        DHC: 400, Cu: 1, eta: 99.5, sf: 0.7, vAvg: 60, dpe: 6250,
      },
      expect: {
        Q: 0.19270031948881794,
        AmReq: 1.9270031948881794,
        h: 0.04,
        Np: 83.77580409572782,
        Am: 2.0106192982974678,
        AmEff: 2.0106192982974678,
        margin: 4.339178244805166,
        vmReal: 0.09584127619385271,
        vmMax: 0.09584127619385271,
        dpm: 173.47270991087342,
        dp: 260.20906486631014,
        life: 815.6049667377287,
        mileage: 48936.29800426372,
        dpc: 18750,
      },
      tolerance: 1e-9,
      source: '《空气滤清器滤芯设计·公式与参数输入清单（2026）》设计算例（ISO 5011:2025 / GB/T 28949-2025）',
    },
    {
      name: '变工况：1.5 L 自然吸气 / 4000 rpm（圆柱式，理想均匀）',
      input: {
        ftype: 1,
        Vd: 0.0015, N: 4000, etaV: 0.9, Pi: 1.0, T0: 298, T2: 298, vm: 0.08,
        D: 0.18, d: 0.1, L: 0.25, hP: 0.04, Lp: 0.45, W: 0.35, p: 0.005,
        mu: 1.81e-5, rho: 1.2, t: 4e-4, K: 8e-12, beta: 0, kc: 1.3, gammaU: 1,
        DHC: 300, Cu: 2, eta: 99.5, sf: 0.7, vAvg: 50, dpe: 2500,
      },
      expect: {
        Q: 0.045,
        AmReq: 0.5625,
        h: 0.04,
        Np: 87.96459430051422,
        Am: 1.7592918860102842,
        AmEff: 1.7592918860102842,
        margin: 212.76300195738384,
        vmReal: 0.025578472996911752,
        vmMax: 0.025578472996911752,
        dpm: 23.148518062205138,
        dp: 30.093073480866682,
        life: 1146.0118371554054,
        mileage: 57300.59185777027,
        dpc: 7500,
      },
      tolerance: 1e-9,
      source: '自建变工况校验算例（自然吸气 Π = 1，温度不修正）',
    },
    {
      name: '面板式算例：2.0 L 增压 / 均匀度 0.9',
      input: {
        ftype: 2,
        Vd: 0.002, N: 6000, etaV: 0.92, Pi: 2.2, T0: 298, T2: 313, vm: 0.1,
        D: 0.2, d: 0.12, L: 0.3, hP: 0.04, Lp: 0.45, W: 0.35, p: 0.005,
        mu: 1.81e-5, rho: 1.2, t: 5e-4, K: 5e-12, beta: 0, kc: 1.5, gammaU: 0.9,
        DHC: 400, Cu: 1, eta: 99.5, sf: 0.7, vAvg: 60, dpe: 6250,
      },
      expect: {
        Q: 0.19270031948881794,
        AmReq: 1.9270031948881794,
        h: 0.04,
        Np: 90,
        Am: 2.52,
        AmEff: 2.2680000000000002,
        margin: 30.77300580948083,
        vmReal: 0.07646838074953093,
        vmMax: 0.0849648674994788,
        dpm: 153.78641017405664,
        dp: 230.67961526108496,
        life: 920.0110961471014,
        mileage: 55200.66576882608,
        dpc: 18750,
      },
      tolerance: 1e-9,
      source: '自建面板式校验算例（平板褶皱 + 气流均匀度折减 γu = 0.9）',
    },
  ],
};
