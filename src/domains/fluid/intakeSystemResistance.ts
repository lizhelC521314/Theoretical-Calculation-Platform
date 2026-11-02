import type { FormulaSpec, OutputSpec, ParamSpec, ShowIf } from '../../formula/types';

/**
 * 进气系统分部件阻力设计（进气管 1~5 段 + 空滤器 + 出气管 1~5 段）
 *
 * 按《进气系统分部件阻力计算（进气管-波纹管-编织管-空滤器-出气管-消音器）》实现：
 *   通用段阻力   Δp = [ f·(L/D) + ΣK ]·(ρv²/2)，v = Q/A，A = πD²/4
 *   渐变管       D(x) = D_in + (D_out − D_in)·x/L，沿程摩擦按 N = 20 段积分（式 4a~4c）；
 *                全锥角 θ = 2arctan[(D_out − D_in)/(2L)]，渐扩 K_exp = k_exp(θ)·(1 − A_in/A_out)²（基准 v_in）、
 *                渐缩 K_con = k_con(θ)·(1 − A_out/A_in)（基准 v_out），k 按 5°~90° 表插值（式 4d~4f）
 *   动压差       Δp_sys,static = ΣΔp_loss + ½ρ(v_out² − v_in²)（式 4g）；本式入口为静止大气，
 *                加速到 v_in 的动压已含在入口段 (1 + K_in) 项内，故取 Δp_sys,static = ΣΔp_loss + ½ρv_out²
 *   摩擦因子     f = 0.25 / { lg[ ε/(3.7D) + 5.74/Re^0.9 ] }²（Swamee-Jain 显式解，替代式 5）
 *   弯头         K_bend = n·K_90(R/D)·(θ/90°)^0.8~1.2（式 6a，本式取指数 1.0 + 查表 K_90）
 *   波纹管       f_c = f_s·[1 + k·(h/p)^m]（式 7，k = 3~5、m = 1.2~1.5）；无波深/波距时退回 C_c
 *   编织管       ε_b = 0.05~0.30 mm 粗糙管；弯曲时 K 增 cb·D/R_b、有效面积 A_eff = A·(1 − 0.1·D/R_b)（式 9d/9e）
 *   穿孔消音器   f_m = f_s·(1 + a·φ)，φ = A_h/(π·D·L)（式 15）；另有隔板、突扩/突缩、弯曲开孔附加（式 15c）
 *   空滤器       Δp = ΣK_box·(ρv_box²/2) + (a·v_eff + b·v_eff²) + k_d·m_dust，v_eff = v_f/η（式 13b/13c）
 *   大气入口段   Δp_entrance = (1 + K_in)·(ρv²/2) − (ρV²/2) + p_bay
 *   空气密度     ρ = p/(R·T)·(1 − 0.378·p_v/p)，p = p0·(1 − 2.2557×10⁻⁵·z)^5.2559（式 20~22，可选）
 *   可压缩修正   Δp_comp ≈ Δp_inc·(1 + M²/4)，M = v/c，c = (γRT)^(1/2)
 */
/** 输入分区标题 */
const SEC_COMP = '系统组成';
const SEC_RUN = '运行参数';
const SEC_MAT = '摩阻与粗糙度参数';
const SEC_IN = '进气管几何';
const SEC_BOX = '空滤器';
const SEC_OUT = '出气管几何与消音器';

/** 给一组输入统一加分区标题 */
const withGroup = (list: ParamSpec[], group: string): ParamSpec[] => list.map((p) => ({ ...p, group }));

/** 进气管/出气管每侧最多支持的段数（操作者在「系统组成」里选实际段数） */
const SEG_MAX = 5;
const SEG_N_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} 段` }));

/** 分段几何默认值：进气管示例前 3 段为进气管/波纹管/编织管，段 4/5 默认未启用（长度 0） */
const IN_SEG_DEFAULT = [
  { type: 1, D: 70, L: 300, K: 0.35 },
  { type: 2, D: 60, L: 150, K: 0.4 },
  { type: 3, D: 60, L: 250, K: 0.3 },
  { type: 1, D: 60, L: 0, K: 0 },
  { type: 1, D: 60, L: 0, K: 0 },
];

/** 出气管示例前 3 段为出气管/多腔穿孔消音器/未启用，段 4/5 默认未启用 */
const OUT_SEG_DEFAULT = [
  { type: 1, D: 60, L: 400, K: 0.8 },
  { type: 3, D: 60, L: 200, K: 0.4 },
  { type: 1, D: 60, L: 0, K: 0 },
  { type: 1, D: 60, L: 0, K: 0 },
  { type: 1, D: 60, L: 0, K: 0 },
];

const BEND_OPTIONS = [
  { value: 0, label: '无弯头' },
  { value: 1, label: '45°，R/D=1（0.18）' },
  { value: 2, label: '45°，R/D=0.5（0.35）' },
  { value: 3, label: '90°，R/D=2（0.25）' },
  { value: 4, label: '90°，R/D=1（0.40）' },
  { value: 5, label: '90°，R/D=0.5（1.00）' },
  { value: 6, label: '90°直角/拼焊（1.30）' },
];

/**
 * 系统组成（放在所有参数之前）：先选进气管、出气管的分段数（各 1~5 段），
 * 再逐段选择该段类别（进气管/波纹管/编织管、出气管/波纹管/多腔穿孔消音器）；
 * 超出所选段数的段，其管型、几何参数与专用公式自动隐藏。
 */
const compInputs: ParamSpec[] = [
  { key: 'nIn', label: '进气管分段数', symbol: 'N_in,seg', unit: '段', kind: 'select', options: SEG_N_OPTIONS, default: 3, required: true, group: SEC_COMP, description: '进气管按实际走向分成几段（1~5）。超出该段数的进气管段，其管型、几何参数与专用公式均自动隐藏' },
];
for (let i = 1; i <= SEG_MAX; i++) {
  const d = IN_SEG_DEFAULT[i - 1];
  compInputs.push({
    key: `t${i}`, label: `进气管段 ${i} 管型`, cellTitle: `进气管 ${i}`, row: `in${i}`, symbol: '-', unit: '-', kind: 'select',
    options: [{ value: 1, label: '进气管' }, { value: 2, label: '波纹管' }, { value: 3, label: '编织管' }],
    default: d.type, required: true, group: SEC_COMP, showIf: { key: 'nIn', min: i },
    description: `进气管第 ${i} 段的类别由操作者选择：进气管 / 波纹管 / 编织管；段 ${i} 默认${d.type === 1 ? '进气管' : d.type === 2 ? '波纹管' : '编织管'}，下方几何参数与公式随选择切换`,
  });
}
compInputs.push({ key: 'nOut', label: '出气管分段数', symbol: 'N_out,seg', unit: '段', kind: 'select', options: SEG_N_OPTIONS, default: 3, required: true, group: SEC_COMP, description: '出气管按实际走向分成几段（1~5）。超出该段数的出气管段，其管型、几何参数与专用公式均自动隐藏' });
for (let i = 1; i <= SEG_MAX; i++) {
  const d = OUT_SEG_DEFAULT[i - 1];
  compInputs.push({
    key: `o${i}`, label: `出气管段 ${i} 管型`, cellTitle: `出气管 ${i}`, row: `out${i}`, symbol: '-', unit: '-', kind: 'select',
    options: [{ value: 1, label: '出气管' }, { value: 2, label: '波纹管' }, { value: 3, label: '多腔穿孔消音器' }],
    default: d.type, required: true, group: SEC_COMP, showIf: { key: 'nOut', min: i },
    description: `出气管第 ${i} 段的类别由操作者选择：出气管 / 波纹管 / 多腔穿孔消音器；段 ${i} 默认${d.type === 1 ? '出气管' : d.type === 2 ? '波纹管' : '多腔穿孔消音器'}，下方几何参数与公式随选择切换`,
  });
}

/** 运行参数 */
const runInputs: ParamSpec[] = [
  { key: 'Q', label: '系统体积流量', symbol: 'Q', unit: 'm³/h', unitGroup: 'volumeFlow', default: 600, min: 0, required: true, description: '发动机额定功率点或最大扭矩点的进气体积流量，示例 600 m³/h = 0.1667 m³/s' },
  { key: 'rhoMode', label: '密度计算方式', symbol: '-', unit: '-', kind: 'select', options: [{ value: 1, label: '直接输入密度' }, { value: 2, label: '按温度/海拔/湿度计算' }], default: 1, required: true, description: '方式 1 直接用下面的 ρ；方式 2 由本地大气压 p(z)、温度 T 与相对湿度按式 20~22 计算（高原、高温工况推荐）' },
  { key: 'rho', label: '空气密度', symbol: 'ρ', unit: 'kg/m³', unitGroup: 'density', default: 1.205, min: 0, required: true, showIf: { key: 'rhoMode', min: 1, max: 1 }, description: '20℃、1 atm 约 1.205 kg/m³；方式 2 时本输入不参与计算' },
  { key: 'z', label: '海拔高度', symbol: 'z', unit: 'm', unitGroup: 'length', default: 0, min: 0, showIf: { key: 'rhoMode', min: 2, max: 2 }, description: '仅方式 2 使用：p = p0·(1 − 2.2557×10⁻⁵·z)^5.2559；海拔每升高 1000 m 密度约降 9%~10%' },
  { key: 'RH', label: '相对湿度', symbol: 'RH', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, max: 1, showIf: { key: 'rhoMode', min: 2, max: 2 }, description: '仅方式 2 使用：0~1，p_v = RH·p_sat(T)，p_sat 按 Buck 公式；湿度 100% 时密度约低 1%~2%' },
  { key: 'mu', label: '空气动力粘度', symbol: 'μ', unit: 'mPa·s', unitGroup: 'dynamicViscosity', default: 0.0181, min: 0, required: true, description: '20℃ 空气约 1.81×10⁻⁵ Pa·s（输入 0.0181 即 18.1 μPa·s）' },
  { key: 'T', label: '空气温度', symbol: 'T', unit: '℃', unitGroup: 'temperature', default: 20, required: true, description: '用于计算声速 c = (γRT)^(1/2) 与马赫数；增压机型出气管 60~80℃' },
  { key: 'V', label: '车速', symbol: 'V', unit: 'm/s', unitGroup: 'velocity', default: 0, min: 0, required: true, description: '进气口迎风时的车速（冲压修正）；台架静止取 0，120 km/h 约 33.3 m/s' },
  { key: 'Kin', label: '入口损失系数', symbol: 'K_in', unit: '-', unitGroup: 'dimensionless', default: 0.05, min: 0, required: true, description: '喇叭口 0.03~0.05，直角锐边 0.5，带防尘网 0.5~1.5，格栅 0.3~1.0，防雨帽 1.0~2.0，snorkel 1.5~3.0' },
  { key: 'pBay', label: '舱内负压（低于大气取正）', symbol: 'p_bay', unit: 'Pa', unitGroup: 'pressure', default: 0, required: true, description: '进气口在发动机舱内且舱内低于大气压时填写正值（如 200），会叠加到入口段损失；迎风正压取 0 或负值' },
];

/** 材料/摩阻参数 */
const matInputs: ParamSpec[] = [
  { key: 'epsS', label: '光滑管绝对粗糙度', symbol: 'ε_s', unit: 'mm', unitGroup: 'length', default: 0.03, min: 0, required: true, description: '塑料/橡胶直管 0.01~0.05 mm，金属管 0.05~0.1 mm' },
  { key: 'Cc', label: '波纹管摩擦放大系数（无波深/波距时使用）', symbol: 'C_c', unit: '-', unitGroup: 'dimensionless', default: 2.0, min: 1, required: true, description: '式 7 的退化取值：浅波纹 1.5，深波纹 2.0~2.5。填写了波深 h 与波距 p 时改按 f_c = f_s·[1 + k·(h/p)^m] 计算' },
  { key: 'kBell', label: '波纹管拟合系数 k', symbol: 'k', unit: '-', unitGroup: 'dimensionless', default: 4, min: 0, required: true, description: '式 7：k = 3~5，由样件试验拟合；无数据取 4' },
  { key: 'mBell', label: '波纹管拟合指数 m', symbol: 'm', unit: '-', unitGroup: 'dimensionless', default: 1.35, min: 0, required: true, description: '式 7：m = 1.2~1.5，由样件试验拟合；无数据取 1.35' },
  { key: 'epsB', label: '编织管绝对粗糙度', symbol: 'ε_b', unit: 'mm', unitGroup: 'length', default: 0.1, min: 0, required: true, description: '细密编织 0.05~0.10 mm，粗编织/有横向凸起 0.15~0.30 mm，最好用一段直管做 Δp–Q 试验反算' },
  { key: 'cb', label: '编织管弯曲附加系数', symbol: 'c_b', unit: '-', unitGroup: 'dimensionless', default: 0.5, min: 0, required: true, description: '式 9d：c_b = 0.4~0.6。R_b/D ≥ 3 时基本无附加，R_b/D = 2 时 K 增 20%~30%，R_b/D = 1 时增 40%~60%' },
  { key: 'epsM', label: '穿孔管绝对粗糙度', symbol: 'ε_m', unit: 'mm', unitGroup: 'length', default: 0.2, min: 0, required: true, description: '穿孔管内壁 0.1~0.3 mm；孔口本身的增量另按穿孔率 φ 计入（式 15）' },
  { key: 'aPerf', label: '穿孔率摩擦放大系数 a', symbol: 'a', unit: '-', unitGroup: 'dimensionless', default: 1.0, min: 0, required: true, description: '式 15：f_m = f_s·(1 + a·φ)，a = 0.5~1.5，无试验数据取 1.0' },
  { key: 'c1', label: '消音器弯头开孔系数 c1', symbol: 'c_1', unit: '-', unitGroup: 'dimensionless', default: 1.5, min: 0, required: true, description: '式 15c：建议取值 1.5（范围 1~2；直管/弯管、开孔/不开孔的差异可按对比数据修正）' },
  { key: 'c2', label: '消音器弯头开孔系数 c2', symbol: 'c_2', unit: '-', unitGroup: 'dimensionless', default: 1.0, min: 0, required: true, description: '式 15c：c2 = 0.5~1.5，表征腔体交换损失，弯角越大权重越高' },
  { key: 'CdLeak', label: '编织壁泄漏流量系数', symbol: 'C_d', unit: '-', unitGroup: 'dimensionless', default: 0.7, min: 0, max: 1, required: true, description: '编织管壁面孔隙泄漏量 q = C_d·A_h·(2Δp/ρ)^(1/2) 的流量系数，取 0.6~0.8；泄漏量不计入压降，仅用于评估过滤旁通' },
];

/** 进气管几何（1~SEG_MAX 段，按所选段数的前 nIn 段展开） */
const inInputs: ParamSpec[] = [];
for (let i = 1; i <= SEG_MAX; i++) {
  const d = IN_SEG_DEFAULT[i - 1];
  const seg: ShowIf = { key: 'nIn', min: i };
  inInputs.push(
    { key: `D${i}`, label: `进气管段 ${i} 进口内径`, symbol: `D_in${i}`, unit: 'mm', unitGroup: 'diameter', default: d.D, min: 0, required: true, showIf: seg, description: '该段进口内径，流速按本段进口截面计算（入口段也以此为基准）' },
    { key: `Dout${i}`, label: `进气管段 ${i} 出口内径`, symbol: `D_in,out${i}`, unit: 'mm', unitGroup: 'diameter', default: d.D, min: 0, required: true, showIf: seg, description: '该段出口内径；与进口相同时按等截面直管，不同时按式(4a)~(4f) 渐变管离散（渐扩/渐缩局部损失按锥角查表自动计入）' },
    { key: `L${i}`, label: `进气管段 ${i} 长度`, symbol: `L_in${i}`, unit: 'mm', unitGroup: 'length', default: d.L, min: 0, required: true, showIf: seg, description: '该段沿程长度（不含弯头展开长度）' },
    { key: `K${i}`, label: `进气管段 ${i} 其它局部阻力系数`, symbol: `ΣK_${i}`, unit: '-', unitGroup: 'dimensionless', default: d.K, min: 0, required: true, showIf: seg, description: '不含弯头的局部损失之和（入口、变径、滤网等）；弯头由「弯头规格 / 只数」自动按式 6a 计入' },
    { key: `bendN${i}`, label: `进气管段 ${i} 弯头规格`, symbol: 'K_90', unit: '-', kind: 'select', options: BEND_OPTIONS, default: 0, required: true, showIf: seg, description: '按式 6a：K_bend = n·K_90(R/D)·(θ/90°)^0.8~1.2，括号内为 90° 基准值；Re < 10⁵ 或相邻弯头间距 <5D 时应再乘 1.1~1.3' },
    { key: `nb${i}`, label: `进气管段 ${i} 弯头只数`, symbol: 'n', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, required: true, showIf: seg, description: '该段弯头数量，与规格系数相乘后叠加到 ΣK' },
    { key: `h${i}`, label: `进气管段 ${i} 波纹波深`, symbol: 'h', unit: 'mm', unitGroup: 'length', default: 4, min: 0, showIf: [seg, { key: `t${i}`, min: 2, max: 2 }], description: '仅波纹管需要：波深 h。与波距 p 一起按 f_c = f_s·[1 + k·(h/p)^m] 计算；h 或 p 为 0 时退回 C_c' },
    { key: `p${i}`, label: `进气管段 ${i} 波纹波距`, symbol: 'p', unit: 'mm', unitGroup: 'length', default: 10, min: 0, showIf: [seg, { key: `t${i}`, min: 2, max: 2 }], description: '仅波纹管需要：波距 p（自由状态）；轴向拉伸后波距变大、f_c 下降 5%~15%，设计按自由状态取值' },
    { key: `lkA${i}`, label: `进气管段 ${i} 编织壁有效开孔面积`, symbol: `A_h${i}`, unit: 'mm²', unitGroup: 'area', default: 0, min: 0, showIf: [seg, { key: `t${i}`, min: 3, max: 3 }], description: '仅编织管需要：壁面孔隙的有效开孔面积，用于估算泄漏量（不计入压降）；0 表示忽略泄漏' },
    { key: `rbn${i}`, label: `进气管段 ${i} 编织管弯曲半径`, symbol: `R_b${i}`, unit: 'mm', unitGroup: 'length', default: 0, min: 0, showIf: [seg, { key: `t${i}`, min: 3, max: 3 }], description: '仅编织管需要：软管弯曲半径 R_b。R_b/D ≥ 3 无附加损失；R_b/D = 2 时 K 增 20%~30% 且有效面积减 5%；R_b/D = 1 时 K 增 40%~60%、有效面积减 10%。0 表示无弯曲' },
  );
}

/** 空滤器参数 */
const boxInputs: ParamSpec[] = [
  { key: 'ABox', label: '空滤器箱体流通面积', symbol: 'A_box', unit: 'm²', unitGroup: 'area', default: 0.00283, min: 0, required: true, description: '箱体入口截面面积，K_box 按此截面流速取动压；示例取与出气管截面相当（φ60 约 0.00283 m²）' },
  { key: 'KBox', label: '箱体局部阻力系数', symbol: 'ΣK_box', unit: '-', unitGroup: 'dimensionless', default: 0.5, min: 0, required: true, description: '箱体进口、出口、内部挡板等局部损失之和，通常 0.5~1.5' },
  { key: 'Af', label: '滤芯迎风面积', symbol: 'A_f', unit: 'm²', unitGroup: 'area', default: 0.25, min: 0, required: true, description: '滤材有效迎风面积，面速度 v_f = Q/A_f（示例 0.667 m/s）' },
  { key: 'aF', label: '滤芯压降线性系数', symbol: 'a', unit: 'Pa·s/m', default: 300, min: 0, required: true, description: 'ISO 5011 台架拟合的 Darcy 项系数（Pa·s/m），必须由本滤芯试验确定，不能套用其它滤芯' },
  { key: 'bF', label: '滤芯压降二次系数', symbol: 'b', unit: 'Pa·s²/m²', default: 800, min: 0, required: true, description: 'ISO 5011 台架拟合的惯性项系数（Pa·s²/m²）' },
  { key: 'mDust', label: '容尘量', symbol: 'm_dust', unit: 'g', default: 0, min: 0, required: true, description: '已积尘质量，初始状态取 0，终了状态按容尘试验值校核' },
  { key: 'kD', label: '容尘系数', symbol: 'k_d', unit: 'Pa/g', default: 0, min: 0, required: true, description: '容尘引起的压降增长率（Pa/g），由容尘试验确定；初始状态取 0' },
  { key: 'eta', label: '箱内流场不均匀系数', symbol: 'η', unit: '-', unitGroup: 'dimensionless', default: 1.0, min: 0.5, max: 1, required: true, description: '式(13b)(13c)：v_eff = v_f/η，按 a·v_eff + b·v_eff² 计算滤芯压降。进气口居中、箱体对称取 0.9；进气口偏置、挡板较多取 0.7~0.8；无导流板、进气直冲滤芯取 0.6~0.7；1.0 表示流场均匀' },
];

/** 出气管几何与消音器（1~SEG_MAX 段，按所选段数的前 nOut 段展开） */
const outInputs: ParamSpec[] = [];
for (let i = 1; i <= SEG_MAX; i++) {
  const d = OUT_SEG_DEFAULT[i - 1];
  const seg: ShowIf = { key: 'nOut', min: i };
  const muf: ShowIf = [seg, { key: `o${i}`, min: 3, max: 3 }];
  const bel: ShowIf = [seg, { key: `o${i}`, min: 2, max: 2 }];
  outInputs.push(
    { key: `Do${i}`, label: `出气管段 ${i} 进口内径`, symbol: `D_out${i}`, unit: 'mm', unitGroup: 'diameter', default: d.D, min: 0, required: true, showIf: seg, description: '出气管段进口内径；多腔穿孔消音器时为穿孔主管内径' },
    { key: `Douto${i}`, label: `出气管段 ${i} 出口内径`, symbol: `D_out,out${i}`, unit: 'mm', unitGroup: 'diameter', default: d.D, min: 0, required: true, showIf: seg, description: '与进口相同时按等截面；不同时按式(4a)~(4f) 渐变管离散；该段为系统末段时出口速度决定出口动压' },
    { key: `Lo${i}`, label: `出气管段 ${i} 长度`, symbol: `L_out${i}`, unit: 'mm', unitGroup: 'length', default: d.L, min: 0, required: true, showIf: seg, description: '该段沿程长度，未使用取 0' },
    { key: `Ko${i}`, label: `出气管段 ${i} 其它局部阻力系数`, symbol: `ΣK_out${i}`, unit: '-', unitGroup: 'dimensionless', default: d.K, min: 0, required: true, showIf: seg, description: '不含弯头的局部损失（节气门全开 0.1~0.3、变径、消音器进出口等）；弯头由「弯头规格 / 只数」按式 6a 计入' },
    { key: `bendO${i}`, label: `出气管段 ${i} 弯头规格`, symbol: 'K_90', unit: '-', kind: 'select', options: BEND_OPTIONS, default: 0, required: true, showIf: seg, description: '按式 6a 逐只计算弯头损失；穿孔消音器弯曲时再按式 15c 与 φ_b 联合修正' },
    { key: `nbo${i}`, label: `出气管段 ${i} 弯头只数`, symbol: 'n', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, required: true, showIf: seg, description: '该段弯头数量' },
    { key: `hO${i}`, label: `出气管段 ${i} 波纹波深`, symbol: 'h', unit: 'mm', unitGroup: 'length', default: 4, min: 0, showIf: bel, description: '仅波纹管需要：波深 h' },
    { key: `pO${i}`, label: `出气管段 ${i} 波纹波距`, symbol: 'p', unit: 'mm', unitGroup: 'length', default: 10, min: 0, showIf: bel, description: '仅波纹管需要：波距 p（自由状态）' },
    { key: `Db${i}`, label: `出气管段 ${i} 消音器本体内径`, symbol: `D_b${i}`, unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, showIf: muf, description: '仅多腔穿孔消音器需要：本体内径，大于穿孔管内径时自动按突扩 (1−A₁/A₂)² 与突缩 0.5(1−A₁/A₂) 计入局部损失' },
    { key: `Ah${i}`, label: `出气管段 ${i} 穿孔开孔总面积`, symbol: `A_h${i}`, unit: 'mm²', unitGroup: 'area', default: 0, min: 0, showIf: muf, description: '仅多腔穿孔消音器需要：孔口总面积，穿孔率 φ = A_h/(π·D·L) 用于摩擦放大 f_m = f_s·(1 + a·φ)；封闭腔无净穿流时孔口本身不计局部阻力' },
    { key: `Cd${i}`, label: `出气管段 ${i} 孔口流量系数`, symbol: `C_d${i}`, unit: '-', unitGroup: 'dimensionless', default: 0.7, min: 0, max: 1, showIf: muf, description: '仅多腔穿孔消音器需要：孔口流量系数 0.6~0.8，用于孔口射流损失 (1/C_d² − 1)·ρv_h²/2' },
    { key: `Qh${i}`, label: `出气管段 ${i} 穿流流量`, symbol: `Q_th${i}`, unit: 'm³/s', unitGroup: 'volumeFlow', default: 0, min: 0, showIf: muf, description: '仅多腔穿孔消音器需要：穿过孔口进入环腔的净流量。封闭环腔无净穿流取 0（孔口不计阻力）' },
    { key: `phi${i}`, label: `出气管段 ${i} 弯曲段局部穿孔率`, symbol: `φ_b${i}`, unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, max: 1, showIf: muf, description: '仅多腔穿孔消音器需要：弯曲段孔面积与该段管内表面积之比。θ ≥ 60° 且 φ_b > 0.2 时必须计入式 15c 附加损失' },
    { key: `kb${i}`, label: `出气管段 ${i} 隔板/挡板损失系数`, symbol: `ΣK_baf${i}`, unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, showIf: muf, description: '仅多腔穿孔消音器需要：各腔隔板缩流损失之和，K = 0.5(1−A_b/A) + (1−A_b/A)²，典型 0.05~0.2/道' },
  );
}

/** 各管段输出（1~SEG_MAX 段，按所选段数展开；超出段数的输出自动隐藏） */
const inSegOutputs: OutputSpec[] = [];
const outSegOutputs: OutputSpec[] = [];
for (let i = 1; i <= SEG_MAX; i++) {
  inSegOutputs.push(
    { key: `dpIn${i}`, label: `进气管段 ${i} 压降`, symbol: `Δp_in${i}`, unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '进气管段', showIf: { key: 'nIn', min: i }, description: '[f·(L/D) + ΣK]·(ρv²/2)，按本段内径、管型与渐变管修正计算' },
    { key: `lk${i}`, label: `进气管段 ${i} 编织壁泄漏量`, symbol: `q_leak${i}`, unit: 'm³/s', unitGroup: 'volumeFlow', digits: 3, group: '进气管段', showIf: [{ key: `t${i}`, min: 3, max: 3 }, { key: 'nIn', min: i }], description: 'q = C_d·A_h·(2Δp/ρ)^(1/2)，不计入压降，仅用于评估过滤旁通' },
  );
  outSegOutputs.push(
    { key: `dpOut${i}`, label: `出气管段 ${i} 压降`, symbol: `Δp_out${i}`, unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '出气管段', showIf: { key: 'nOut', min: i }, description: '按本段所选管型计算（穿孔消音器含穿孔率放大、进出口 K、隔板 K、突扩/突缩）' },
    { key: `dpJet${i}`, label: `出气管段 ${i} 孔口射流损失`, symbol: `Δp_jet${i}`, unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '出气管段', showIf: [{ key: `o${i}`, min: 3, max: 3 }, { key: 'nOut', min: i }], description: '(1/C_d² − 1)·(ρv_h²/2)，v_h = Q_th/A_h；封闭环腔无穿流时为 0' },
    { key: `phiA${i}`, label: `出气管段 ${i} 穿孔率`, symbol: `φ_${i}`, unit: '-', unitGroup: 'dimensionless', digits: 3, group: '出气管段', showIf: [{ key: `o${i}`, min: 3, max: 3 }, { key: 'nOut', min: i }], description: 'φ = A_h/(π·D·L)，用于 f_m = f_s·(1 + a·φ)；L 为 0 时为 0' },
    { key: `dpB${i}`, label: `出气管段 ${i} 弯曲开孔附加损失`, symbol: `Δp_bend${i}`, unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '出气管段', showIf: [{ key: `o${i}`, min: 3, max: 3 }, { key: 'nOut', min: i }], description: '式 15b/15c：K_bend,perf 相对光滑弯头 K_bend,0 的增量乘以动压；无弯曲或 φ_b = 0 时为 0' },
  );
}

/** 各管段按所选管型显示的专用公式：仅显示已启用段（i ≤ nIn / nOut）且管型匹配 */
const WAVE_TEX = 'f_c = f_s\\left[1 + k\\left(\\frac{h}{p}\\right)^{m}\\right],\\qquad \\Delta p = \\left[f_c\\frac{L}{D} + \\Sigma K\\right]\\frac{\\rho v^{2}}{2}';
const BRAID_TEX = 'K_{br} = K\\left[1 + c_b\\frac{D}{R_b}\\right],\\quad A_{eff} = A\\left(1 - 0.1\\frac{D}{R_b}\\right),\\quad q_{leak} = C_d A_h\\sqrt{\\frac{2\\Delta p}{\\rho}}';
const MUFFLER_TEX = 'f_m = f_s\\left(1 + a\\varphi\\right),\\quad \\varphi = \\frac{A_h}{\\pi D L},\\qquad \\Delta p_m = \\left[f_m\\frac{L}{D} + K_{in,m} + K_{out,m} + \\Sigma K_{baf} + K_{geo}\\right]\\frac{\\rho v^{2}}{2},\\quad K_{geo} = \\left(1-\\frac{A_1}{A_2}\\right)^{2} + 0.5\\left(1-\\frac{A_1}{A_2}\\right)';
const PERF_BEND_TEX = 'K_{bend,perf} = K_{bend,0}\\left[1 + c_1\\frac{\\theta}{90^{\\circ}}\\varphi_b\\right] + c_2\\left(\\frac{\\theta}{90^{\\circ}}\\right)^{2}\\frac{\\varphi_b}{1-\\varphi_b},\\qquad \\Delta p_{bend} = K_{bend,perf}\\frac{\\rho v^{2}}{2}';
const JET_TEX = '\\Delta p_{jet} = \\left(\\frac{1}{C_d^{2}}-1\\right)\\frac{\\rho v_h^{2}}{2},\\qquad v_h = \\frac{Q_{th}}{A_h}';

const segLatex: { label: string; tex: string; showIf?: ShowIf }[] = [];
for (let i = 1; i <= SEG_MAX; i++) {
  const seg: ShowIf = { key: 'nIn', min: i };
  segLatex.push(
    { label: `进气管段 ${i}：波纹管（几何相关摩擦放大，式 7）`, tex: WAVE_TEX, showIf: [seg, { key: `t${i}`, min: 2, max: 2 }] },
    { label: `进气管段 ${i}：编织管（弯曲修正 + 壁面泄漏，式 9a/9d/9e）`, tex: BRAID_TEX, showIf: [seg, { key: `t${i}`, min: 3, max: 3 }] },
  );
}
for (let i = 1; i <= SEG_MAX; i++) {
  const seg: ShowIf = { key: 'nOut', min: i };
  segLatex.push(
    { label: `出气管段 ${i}：波纹管（几何相关摩擦放大，式 7）`, tex: WAVE_TEX, showIf: [seg, { key: `o${i}`, min: 2, max: 2 }] },
    { label: `出气管段 ${i}：多腔穿孔消音器（穿孔率摩擦放大 + 局损，式 15/15a）`, tex: MUFFLER_TEX, showIf: [seg, { key: `o${i}`, min: 3, max: 3 }] },
    { label: `出气管段 ${i}：穿孔弯头附加损失（式 15b/15c/15d）`, tex: PERF_BEND_TEX, showIf: [seg, { key: `o${i}`, min: 3, max: 3 }] },
    { label: `出气管段 ${i}：孔口射流损失（穿流结构）`, tex: JET_TEX, showIf: [seg, { key: `o${i}`, min: 3, max: 3 }] },
  );
}

export const intakeSystemResistance: FormulaSpec = {
  id: 'fluid.intakeSystemResistance',
  domain: 'fluid',
  subsystem: '进气系统',
  title: '进气系统阻力设计',
  summary:
    '输入区最前为「系统组成」：操作者先选进气管、出气管的分段数（各 1~5 段），再逐段选择该段类别（进气管/波纹管/编织管、出气管/波纹管/多腔穿孔消音器），几何参数与公式随段数与管型自动显隐。按「进气管 → 空滤器（箱体 + 滤芯 + 流场不均匀修正）→ 出气管」逐段计算静压损失并汇总，另计入大气入口段（含车速冲压与舱内负压）、出口动压与可压缩性修正，输出系统阻力曲线。',
  tags: ['进气系统', '阻力', '压降', '进气管', '波纹管', '编织管', '空气滤清器', '滤芯', '消音器', '穿孔管', '达西摩擦因子', '局部阻力', '入口损失', '马赫数', 'ISO 5011', '流体设计'],
  description:
    '进气系统总阻力为各段静压损失之和：Δp_sys = Δp_entrance + ΣΔp_in + Δp_airbox + ΣΔp_out。每段均按「沿程摩擦 + 局部阻力」计算 Δp = [f·(L/D) + ΣK]·(ρv²/2)，各段流速按各自内径计算，局部阻力系数按该段局部流速取动压。若某段的进口与出口内径不同，按式(4a)~(4c) 把沿程摩擦分 20 段积分（D_i 取子段平均直径、v_i 按当地截面重算），并按式(4d)~(4f) 分别计入渐扩/渐缩局部损失：θ = 2arctan[(D_out − D_in)/(2L)]，K_exp = k_exp(θ)·(1 − A_in/A_out)²（基准为上游小管流速）、K_con = k_con(θ)·(1 − A_out/A_in)（基准为下游小管流速），k_exp、k_con 按 5°~90° 工程表线性插值；θ ≤ 10° 几乎可忽略，θ > 45° 的渐扩接近突扩必须计入，同面积比下渐扩损失约为渐缩的 1.5~2 倍。弯头不再取固定值，按 K_bend = n·K_90(R/D)·(θ/90°)^0.8~1.2 逐只计算（90°、R/D=1 取 0.3~0.5，R/D=0.5 取 0.8~1.2，直角/拼焊取 1.1~1.5；45° 约为 90° 的一半）。进气管侧每段可选进气管（光滑管 ε_s）、波纹管（f_c = f_s·[1 + k·(h/p)^m]，k = 3~5、m = 1.2~1.5；无几何数据时退回 C_c = 1.5~2.5）或编织管（ε_b = 0.05~0.30 mm，弯曲时按 K·[1 + c_b·D/R_b] 放大、按 A_eff = A·(1 − 0.1·D/R_b) 重算流速）。出气管侧可选普通出气管、波纹管或多腔穿孔消音器：穿孔管摩擦按 f_m = f_s·(1 + a·φ) 放大，φ 为孔总面积与穿孔段管内表面积之比；另计隔板损失、本体突扩/突缩，以及弯曲段整片开孔带来的「冲击 + 腔体交换」附加损失 K_bend,perf = K_bend,0·[1 + c1·(θ/90°)·φ_b] + c2·(θ/90°)²·φ_b/(1 − φ_b)。空滤器阻力 = 箱体局部阻力 + 滤芯多孔介质阻力 (a·v_f + b·v_f²) + 容尘增量 k_d·m_dust，a、b 由 ISO 5011 台架拟合；箱内流场不均匀时按式(13b)(13c) 取有效面速度 v_eff = v_f/η（η = 0.6~1.0：进气口居中、箱体对称取 0.9，进气口偏置、挡板较多取 0.7~0.8，无导流板、进气直冲滤芯取 0.6~0.7），压降按 a·v_eff + b·v_eff² 计算。大气入口段按 Δp = (1 + K_in)·(ρv²/2) − (ρV²/2) 计算，系数是 (1 + K_in) 而不是单独的 K_in，因为把静止空气加速到管内流速所需的动压同样表现为入口静压下降。空气密度可直接输入，也可按温度、海拔与相对湿度由 p(z)、Buck 公式与湿空气状态方程计算（式 20~22）。系统总静压降按式(4g) 另加出口动压 ½ρv_out²（入口为静止大气时），与各段损失之和分开输出，避免把动压项重复计入损失。马赫数 M > 0.3 时按 Δp_comp ≈ Δp_inc·(1 + M²/4) 粗略修正，M > 0.6 应以一维气体动力学（Fanno）或 CFD 复算并做堵塞校核。选定管型后，输入区只显示该元件实际需要的参数，公式区同步切换为该元件的专用公式。',
  inputs: [
    ...compInputs,
    ...withGroup(runInputs, SEC_RUN),
    ...withGroup(matInputs, SEC_MAT),

    ...withGroup(inInputs, SEC_IN),
    ...withGroup(boxInputs, SEC_BOX),
    ...withGroup(outInputs, SEC_OUT),
  ],
  outputs: [
    { key: 'vIn', label: '入口截面流速', symbol: 'v_in', unit: 'm/s', unitGroup: 'velocity', digits: 3, group: '大气入口段', description: 'v_in = Q/(πD_in1²/4)，动压按此流速计算' },
    { key: 'dpEntrance', label: '大气入口段压降', symbol: 'Δp_entrance', unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '大气入口段', primary: true, description: 'Δp = (1 + K_in)·(ρv_in²/2) − (ρV²/2) + p_bay' },
    { key: 'rhoUsed', label: '计算用空气密度', symbol: 'ρ', unit: 'kg/m³', unitGroup: 'density', digits: 3, group: '大气入口段', description: '方式 1 为输入值；方式 2 按 p(z)、T 与相对湿度计算（式 20~22）' },

    ...inSegOutputs,

    { key: 'dpBox', label: '空滤器箱体压降', symbol: 'Δp_box', unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '空滤器', description: 'ΣK_box·(ρv_box²/2)，v_box = Q/A_box' },
    { key: 'dpFilter', label: '滤芯压降', symbol: 'Δp_f', unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '空滤器', description: 'a·v_eff + b·v_eff²，v_eff = v_f/η（未含容尘）' },
    { key: 'vEff', label: '滤芯有效面速度', symbol: 'v_eff', unit: 'm/s', unitGroup: 'velocity', digits: 3, group: '空滤器', description: '式(13b)：v_eff = v_f/η，η < 1 时表示箱内流场不均匀、局部面速度升高' },
    { key: 'dpAirbox', label: '空滤器总压降', symbol: 'Δp_airbox', unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '空滤器', primary: true, description: '箱体 + 滤芯 + 容尘（k_d·m_dust）' },

    ...outSegOutputs,

    { key: 'dpTotal', label: '系统总阻力', symbol: 'Δp_sys', unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '汇总', primary: true, description: '入口段 + 进气管 N_in 段 + 空滤器 + 出气管 N_out 段各段静压损失之和（不含出口动压）' },
    { key: 'vOut', label: '系统出口流速', symbol: 'v_out', unit: 'm/s', unitGroup: 'velocity', digits: 3, group: '汇总', description: '按出气管末段（第 N_out 段）的出口内径计算，v_out = Q/(πD_out,out,N_out²/4)' },
    { key: 'dpDyn', label: '出口动压', symbol: 'Δp_dyn,out', unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '汇总', description: '式(4g)：Δp_dyn = ½ρv_out²，入口为静止大气时这部分动压同样由系统提供' },
    { key: 'dpTotalStatic', label: '系统总静压降', symbol: 'Δp_sys,static', unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '汇总', description: '式(4g)：Δp_sys,static = Δp_sys + ½ρv_out²，与各段损失之和分开输出' },
    { key: 'thetaMax', label: '最大全锥角', symbol: 'θ_max', unit: '°', digits: 3, group: '汇总', description: '式(4d)：θ = 2arctan[(D_out − D_in)/(2L)]，各段中绝对值最大者；θ ≤ 10° 渐变损失可忽略，θ > 45° 渐扩接近突扩' },
    { key: 'Mmax', label: '最大马赫数', symbol: 'M_max', unit: '-', unitGroup: 'dimensionless', digits: 3, group: '汇总', description: '各段 M = v/c 的最大值；M > 0.3 需做可压缩修正，M > 0.6 需 Fanno/CFD 并校核堵塞' },
    { key: 'dpComp', label: '可压缩修正后总阻力', symbol: 'Δp_comp', unit: 'Pa', unitGroup: 'pressure', digits: 3, group: '汇总', description: 'Δp_comp ≈ Δp_sys·(1 + M_max²/4)，M > 0.5 时误差变大，应逐段迭代 p、ρ、v' },
    { key: 'S', label: '系统阻力系数', symbol: 'S', unit: 'Pa·s²/m³', digits: 3, group: '汇总', description: 'S = Δp_sys/Q²，用于绘制 Δp = S·Q² 曲线并与发动机需求曲线匹配' },
  ],
  latex: [
    { label: '系统总阻力（各段串联求和）', tex: '\\Delta p_{sys} = \\Delta p_{entrance} + \\sum_{i=1}^{N_{in}}\\Delta p_{in,i} + \\Delta p_{airbox} + \\sum_{i=1}^{N_{out}}\\Delta p_{out,i}' },
    { label: '流速与流通面积', tex: 'v = \\frac{Q}{A},\\qquad A = \\frac{\\pi D^{2}}{4}' },
    { label: '雷诺数', tex: 'Re = \\frac{\\rho v D}{\\mu}' },
    { label: '通用段阻力（沿程摩擦 + 局部阻力）', tex: '\\Delta p = \\left[ f\\,\\frac{L}{D} + \\sum K \\right]\\cdot\\frac{\\rho v^{2}}{2}' },
    { label: '达西摩擦因子（Swamee-Jain 显式解）', tex: 'f = \\frac{0.25}{\\left\\{\\lg\\left[\\dfrac{\\varepsilon}{3.7D} + \\dfrac{5.74}{Re^{0.9}}\\right]\\right\\}^{2}}' },
    { label: '渐变管：直径变化与沿程摩擦离散（式 4a~4c，N = 20）', tex: 'D(x) = D_{in} + \\left(D_{out} - D_{in}\\right)\\frac{x}{L},\\quad v(x) = \\frac{4Q}{\\pi D(x)^{2}},\\qquad \\Delta p_{f} \\approx \\sum_{i=1}^{N} f_i\\frac{\\Delta L}{D_i}\\frac{\\rho v_i^{2}}{2}' },
    { label: '渐变管：全锥角与渐扩/渐缩局部损失（式 4d~4f）', tex: '\\theta = 2\\arctan\\frac{D_{out} - D_{in}}{2L},\\qquad K_{exp} = k_{exp}(\\theta)\\left(1 - \\frac{A_{in}}{A_{out}}\\right)^{2},\\qquad K_{con} = k_{con}(\\theta)\\left(1 - \\frac{A_{out}}{A_{in}}\\right)' },
    { label: '弯头损失（逐只计算，式 6a/6b）', tex: 'K_{bend} = n\\cdot K_{90}\\!\\left(\\frac{R}{D}\\right)\\cdot\\left(\\frac{\\theta}{90^{\\circ}}\\right)^{0.8\\sim 1.2}' },
    ...segLatex,
    { label: '空滤器阻力（箱体 + 滤芯 + 容尘）', tex: '\\Delta p_{airbox} = \\sum K_{box}\\frac{\\rho v_{box}^{2}}{2} + \\left(a\\,v_f + b\\,v_f^{2}\\right) + k_d\\, m_{dust},\\qquad v_f = \\frac{Q}{A_f}' },
    { label: '空滤器流场不均匀修正（式 13b/13c）', tex: 'v_{eff} = \\frac{v_f}{\\eta},\\qquad \\Delta p_{filter} = a\\,v_{eff} + b\\,v_{eff}^{2},\\qquad \\eta = 0.6\\sim 1.0' },
    { label: '大气入口段压降（含车速冲压与舱内负压）', tex: '\\Delta p_{entrance} = \\left(1 + K_{in}\\right)\\frac{\\rho v_{in}^{2}}{2} - \\frac{\\rho V^{2}}{2} + p_{bay}' },
    { label: '出口动压与系统总静压降（式 4g）', tex: '\\Delta p_{dyn,out} = \\frac{1}{2}\\rho v_{out}^{2},\\qquad \\Delta p_{sys,static} = \\Delta p_{sys} + \\frac{1}{2}\\rho v_{out}^{2}' },
    { label: '湿空气密度与海拔修正（式 20~22）', tex: '\\rho = \\frac{p}{R_d T}\\left[1 - 0.378\\frac{p_v}{p}\\right],\\qquad p = p_0\\left(1 - 2.2557\\times 10^{-5}z\\right)^{5.2559},\\qquad p_v = RH\\cdot 611.2\\exp\\left(\\frac{17.62T_c}{243.12 + T_c}\\right)', showIf: { key: 'rhoMode', min: 2, max: 2 } },
    { label: '马赫数与声速', tex: 'M = \\frac{v}{c},\\qquad c = \\sqrt{\\gamma R T}' },
    { label: '可压缩性工程修正', tex: '\\Delta p_{comp} \\approx \\Delta p_{sys}\\left(1 + \\frac{M^{2}}{4}\\right)' },
    { label: '系统阻力系数', tex: 'S = \\frac{\\Delta p_{sys}}{Q^{2}}' },
  ],
  curve: {
    label: '系统阻力—流量曲线 Δp = S·Q²',
    xLabel: 'Q (m³/h)',
    yLabel: 'Δp_sys (Pa)',
    compute(v) {
      const base = v.Q;
      if (!(base > 0)) return [];
      // 按输入流量 Q 的 0、25%、50%、75%、100%、125% 取点
      return [0, 0.25, 0.5, 0.75, 1, 1.25].map((r) => {
        const q = base * r;
        const dp = q > 0 ? intakeSystemResistance.solve({ ...v, Q: q }).dpTotal : 0;
        return { x: q * 3600, y: Number.isFinite(dp) ? dp : 0 };
      });
    },
  },
  sensitivity: true,
  assumptions: [
    '公式与新版《进气系统分部件阻力计算（进气管-波纹管-编织管-空滤器-出气管-消音器）》一致；算例（Q = 600 m³/h、20 ℃、ρ = 1.205 kg/m³）各段与本公式的对比为：进气管 478 vs 485 Pa、波纹管 1082 vs 1049 Pa（本文按 h/p = 0.4、k = 4、m = 1.35 得 f_c ≈ 0.040，文档表取 f_c = 0.047）、编织管 819 vs 832 Pa、空滤器 1601 vs 1600 Pa、出气管 1923 vs 1935 Pa、消音器 986 vs 1030 Pa（文档表取 f = 0.022，本公式按 ε_m = 0.2 mm 得 f ≈ 0.028）；文档六段合计 6889 Pa 不含大气入口段，本公式再加入口段后台架静止约 8118 Pa',
    '弯头按式 6a/6b 逐只计算：K_bend = n·K_90(R/D)·(θ/90°)^0.8~1.2，规格下拉已内置 45°/R/D=1 0.18、45°/R/D=0.5 0.35、90°/R/D=2 0.25、90°/R/D=1 0.40、90°/R/D=0.5 1.00、90° 直角/拼焊 1.30；本公式取指数 1.0。Re < 10⁵ 或相邻弯头间距 < 5D 时应再乘 1.1~1.3，该放大需用户自行并入弯头规格系数或 ΣK',
    '波纹管摩擦按式 7：f_c = f_s·[1 + k·(h/p)^m]，k = 3~5、m = 1.2~1.5；h 或 p 未填写（为 0）时退回 C_c·f_s（C_c = 1.5~2.5）。轴向拉伸后波距变大、f_c 下降 5%~15%，设计按自由状态波距取值',
    '编织管按式 9a/9d/9e 计算：摩擦用 ε_b = 0.05~0.30 mm 的粗糙管；弯曲时弯头系数 K 增 c_b·D/R_b（c_b = 0.4~0.6），有效面积 A_eff = A·(1 − 0.1·D/R_b)，流速与动压按 A_eff 重算；R_b/D ≥ 3 时附加可忽略',
    '某段进口与出口内径不同时按渐变管式 4a~4f 计算：沿程摩擦按 N = 20 个子段积分（D_i 取子段平均直径、v_i 按当地截面重算），全锥角 θ = 2arctan[(D_out − D_in)/(2L)]，渐扩 K_exp = k_exp(θ)·(1 − A_in/A_out)²（基准 v_in）、渐缩 K_con = k_con(θ)·(1 − A_out/A_in)（基准 v_out）；k_exp、k_con 由 5°/10°/20°/30°/45°/60°/90° 工程表线性插值，θ < 5° 按 0 线性过渡，θ > 90° 取末值',
    'θ ≤ 10° 的渐变损失几乎可忽略，θ > 45° 的渐扩接近突扩必须计入；同面积比下渐扩损失约为渐缩的 1.5~2 倍，因此进气管收缩段比扩张段更有利',
    '多腔穿孔消音器按式 15/15a：穿孔率 φ = A_h/(π·D·L)（A_h 为穿孔段孔口总面积，L 为穿孔段长度），摩擦按 f_m = f_s·(1 + a·φ) 放大，a = 0.5~1.5、无试验数据取 1.0；另计进出口 K、隔板 ΣK_baf 与本体突扩/突缩',
    '穿孔弯头按式 15b/15c 计算附加损失：K_bend,perf = K_bend,0·[1 + c1·(θ/90°)·φ_b] + c2·(θ/90°)²·φ_b/(1 − φ_b)，c1 = 1~2、c2 = 0.5~1.5；θ < 30° 且 φ_b < 0.1 时可直接把 φ_b 取 0 按光滑弯头计算，θ ≥ 60° 且 φ_b > 0.2 必须计入',
    '空气密度可选直接输入或按式 20~22 计算：ρ = p/(R_d·T)·(1 − 0.378·p_v/p)，p = p0·(1 − 2.2557×10⁻⁵·z)^5.2559，p_v = RH·p_sat，p_sat 按 Buck 公式；系统内仍用同一密度，各段温度不同时应逐段按当地密度修正',
    '按不可压缩流处理，各段流速与动压按该段内径计算；增压机型出气管（60~80 ℃）须按 Δp₂ = Δp₁·(ρ₂/ρ₁) 修正',
    '摩擦因子用 Swamee-Jain 显式解代替 Colebrook 迭代，Re > 1000 时误差 < 1%；波纹管用式 7 放大、编织管与穿孔管用等效粗糙度近似',
    '空滤器滤芯系数 a、b 必须由本滤芯的 ISO 5011 台架试验拟合，不能套用其它滤芯；k_d 由容尘试验确定，设计时按「初始」与「终了」两种状态分别校核',
    '箱内流场不均匀按式 13b/13c 修正：v_eff = v_f/η，滤芯压降按 a·v_eff + b·v_eff² 计算；η = 0.6~1.0（进气口居中、箱体对称 0.9；进气口偏置、挡板较多 0.7~0.8；无导流板直冲滤芯 0.6~0.7），η = 1 表示流场均匀、与 v_f 直接计算等价',
    '消音器环腔为封闭腔、无净穿流，孔口不计射流损失；若结构存在穿流（如回流式），须另填 Q_th 并按 Δp_jet = (1/C_d² − 1)·ρv_h²/2 计算',
    '编织管壁面孔隙泄漏量 q = C_d·A_h·(2Δp/ρ)^(1/2) 只作旁通评估，不计入系统压降；泄漏占总量 >2% 时须评估对过滤效率与压降测量的影响',
    '大气入口段按 (1 + K_in)·(ρv²/2) − (ρV²/2) + p_bay 计算，即同时计入「加速到管内流速所需的动压」与「入口几何局部损失」；此段以进气管段 1 的内径与流速为基准',
    '按式 4g 把「各段损失」与「出口动压」分开输出：Δp_sys 为各段静压损失之和，Δp_sys,static = Δp_sys + ½ρv_out² 为入口静止大气时的系统总静压降；接入发动机后若出口背压由进气歧管提供，则不应重复计入 ½ρv_out²',
    '马赫数修正采用 Δp_comp ≈ Δp_sys·(1 + M²/4)：M < 0.5 时误差约 3%，M > 0.6 应改用一维气体动力学（Fanno/等温流）或 CFD，并做堵塞校核',
    '一维计算用于方案筛选与管径/弯头优化，定型前须做 CFD 稳态/瞬态或整机台架验证',
  ],
  solve(v) {
    const empty: Record<string, number> = {};
    const nanKeys = ['vIn', 'dpEntrance', 'dpBox', 'dpFilter', 'dpAirbox', 'vEff', 'rhoUsed',
      'dpTotal', 'vOut', 'dpDyn', 'dpTotalStatic', 'thetaMax', 'Mmax', 'dpComp', 'S'];
    for (let i = 1; i <= SEG_MAX; i++) nanKeys.push(`dpIn${i}`, `lk${i}`, `dpOut${i}`, `dpJet${i}`, `phiA${i}`, `dpB${i}`);
    nanKeys.forEach((k) => { empty[k] = NaN; });

    const segOk = (D: number, L: number, K: number) =>
      Number.isFinite(D) && D > 0 && Number.isFinite(L) && L >= 0 && Number.isFinite(K) && K >= 0;

    const num = (x: number, min = 0) => Number.isFinite(x) && x >= min;
    const bendOk = (o: number, n: number) => Number.isInteger(o) && o >= 0 && o <= 6 && num(n);
    const phiOk = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1;
    /** 出口内径缺省（未填）视为与进口相同；填 0 也按等径处理 */
    const dOutOk = (x: number) => !Number.isFinite(x) || x >= 0;
    /** 流场不均匀系数：未填按 1.0；填写时限定 0.5~1.0 */
    const etaOk = (x: number) => !Number.isFinite(x) || (x >= 0.5 && x <= 1);

    const nIn = Number.isFinite(v.nIn) ? Math.round(v.nIn) : 3;
    const nOut = Number.isFinite(v.nOut) ? Math.round(v.nOut) : 3;
    if (!(nIn >= 1 && nIn <= SEG_MAX) || !(nOut >= 1 && nOut <= SEG_MAX)) return empty;

    if (!(v.Q > 0) || !(v.mu > 0) || !(v.T > 0) || !num(v.V) || !num(v.Kin) || !Number.isFinite(v.pBay) ||
        !(v.rhoMode === 2 ? num(v.z) && phiOk(v.RH) : v.rho > 0) ||
        !num(v.epsS) || !num(v.Cc, 1) || !num(v.kBell) || !num(v.mBell) || !num(v.epsB) || !num(v.cb) ||
        !num(v.epsM) || !num(v.aPerf) || !num(v.c1) || !num(v.c2) || !num(v.CdLeak) ||
        !(v.ABox > 0) || !num(v.KBox) || !(v.Af > 0) ||
        !num(v.aF) || !num(v.bF) || !num(v.mDust) || !num(v.kD) || !etaOk(v.eta))
      return empty;

    // 只校验已启用段（i ≤ nIn / nOut），超出段数的参数不参与计算
    for (let i = 1; i <= nIn; i++) {
      if (!segOk(v[`D${i}`], v[`L${i}`], v[`K${i}`]) || !dOutOk(v[`Dout${i}`]) ||
          !bendOk(v[`bendN${i}`], v[`nb${i}`]) || !num(v[`h${i}`]) || !num(v[`p${i}`]) ||
          !num(v[`lkA${i}`]) || !num(v[`rbn${i}`])) return empty;
    }
    for (let i = 1; i <= nOut; i++) {
      if (!segOk(v[`Do${i}`], v[`Lo${i}`], v[`Ko${i}`]) || !dOutOk(v[`Douto${i}`]) ||
          !bendOk(v[`bendO${i}`], v[`nbo${i}`]) || !num(v[`hO${i}`]) || !num(v[`pO${i}`]) ||
          !(v[`Db${i}`] > 0) || !num(v[`Ah${i}`]) || !(v[`Cd${i}`] > 0) || !num(v[`Qh${i}`]) ||
          !phiOk(v[`phi${i}`]) || !num(v[`kb${i}`])) return empty;
    }

    const Q = v.Q;
    // 空气密度：方式 1 直接输入 ρ；方式 2 按海拔 p(z)、温度与相对湿度计算（式 20~22）
    let rho = v.rho;
    if (v.rhoMode === 2) {
      const Tc = v.T - 273.15;
      const p = 101325 * Math.pow(1 - 2.2557e-5 * v.z, 5.2559);
      const psat = 611.2 * Math.exp((17.62 * Tc) / (243.12 + Tc));
      const pv = v.RH * psat;
      rho = (p / (287 * v.T)) * (1 - (0.378 * pv) / p);
    }
    const mu = v.mu;
    const gamma = 1.4;
    const R = 287;

    /** 达西摩擦因子：Swamee-Jain 显式解 */
    const fric = (Re: number, eps: number, D: number) => {
      const t = eps / (3.7 * D) + 5.74 / Math.pow(Re, 0.9);
      const lg = Math.log10(t);
      return 0.25 / (lg * lg);
    };

    /**
     * 单段阻力：type 1 光滑管；type 2 波纹管（式 7 摩擦放大）；
     * 进气管侧 type 3 为编织管（ε_b 粗糙管 + 式 9d/9e 弯曲修正）；
     * 出气管侧 type 3 为多腔穿孔消音器（式 15 穿孔率放大 + 式 15c 穿孔弯头修正）
     */
    /** 弯头 K_90(R/D) 查表（式 6b）；k 为基准系数，th 为名义弯角 */
    const K90: Record<number, { k: number; th: number }> = {
      0: { k: 0, th: 0 },
      1: { k: 0.18, th: 45 },
      2: { k: 0.35, th: 45 },
      3: { k: 0.25, th: 90 },
      4: { k: 0.4, th: 90 },
      5: { k: 1.0, th: 90 },
      6: { k: 1.3, th: 90 },
    };

    /**
     * 渐变管锥角系数表（式 4e/4f）：θ(°) 与 k_exp、k_con；
     * θ < 5° 时从 0 线性过渡到首值，θ > 90° 取末值。
     */
    const THETA_TAB = [5, 10, 20, 30, 45, 60, 90];
    const KEXP_TAB = [0.05, 0.08, 0.15, 0.3, 0.55, 0.8, 1.0];
    const KCON_TAB = [0.02, 0.03, 0.05, 0.08, 0.12, 0.18, 0.3];
    const interpTab = (tab: number[], deg: number) => {
      const d = Math.abs(deg);
      const last = THETA_TAB.length - 1;
      if (d <= THETA_TAB[0]) return tab[0] * (d / THETA_TAB[0]);
      if (d >= THETA_TAB[last]) return tab[last];
      for (let i = 1; i <= last; i++) {
        if (d <= THETA_TAB[i]) {
          const t = (d - THETA_TAB[i - 1]) / (THETA_TAB[i] - THETA_TAB[i - 1]);
          return tab[i - 1] + (tab[i] - tab[i - 1]) * t;
        }
      }
      return tab[last];
    };
    /** 渐变管沿程摩擦离散段数（式 4c 要求 N ≥ 10，本式取 20） */
    const TAPER_N = 20;

    type SegOpt = { h?: number; p?: number; rb?: number; ah?: number; phiB?: number; kb?: number; Db?: number };

    const seg = (type: number, din: number, doutRaw: number, L: number, K: number, bend: number, nb: number, opt: SegOpt, side: 'in' | 'out') => {
      const dout = Number.isFinite(doutRaw) && doutRaw > 0 ? doutRaw : din;
      const tapered = L > 0 && Math.abs(dout / din - 1) > 1e-9;
      const eps = type === 3 ? (side === 'in' ? v.epsB : v.epsM) : v.epsS;
      /** 编织管弯曲：按当地直径折减有效面积、放大弯头系数（式 9d/9e） */
      const areaAt = (D: number) => {
        const A = (Math.PI * D * D) / 4;
        if (side === 'in' && type === 3 && opt.rb! > 0) {
          const ratio = D / opt.rb!;
          return { Aeff: Math.max(A * (1 - 0.1 * ratio), 0.5 * A), kBendAmp: 1 + v.cb * ratio };
        }
        return { Aeff: A, kBendAmp: 1 };
      };
      const inl = areaAt(din);
      const outl = areaAt(dout);
      const vel = Q / inl.Aeff;
      const velOut = Q / outl.Aeff;
      const Re = (rho * vel * din) / mu;
      /** 波纹管/穿孔管的摩擦放大系数（穿孔率随当地直径变化，故逐子段另算） */
      let mult = 1;
      if (type === 2) {
        const hp = opt.h! > 0 && opt.p! > 0 ? opt.h! / opt.p! : 0;
        mult = hp > 0 ? 1 + v.kBell * Math.pow(hp, v.mBell) : v.Cc;
      }
      const phiAt = (D: number) =>
        side === 'out' && type === 3 && L > 0 && opt.ah! > 0 ? opt.ah! / (Math.PI * D * L) : 0;
      const phi = phiAt(din);
      if (side === 'out' && type === 3) mult = 1 + v.aPerf * phi;
      const f = fric(Re, eps, din) * mult;
      const b = K90[bend] ?? K90[0];
      const th = b.th / 90;
      const pb = side === 'out' && type === 3 ? Math.min(opt.phiB ?? 0, 0.95) : 0;
      const kSmooth = b.k * (1 + v.c1 * th * pb) + v.c2 * th * th * (pb / (1 - pb));
      const kPer = kSmooth * inl.kBendAmp;
      const nBend = nb > 0 ? nb : 0;
      const kJoint = K + nBend * kPer + (side === 'out' && type === 3 ? kGeo(opt.Db!, din) + (opt.kb ?? 0) : 0);
      const qDyn = 0.5 * rho * vel * vel;

      /** 等径段：Δp = [f·(L/D) + ΣK]·(ρv²/2)（基准算例的路径，保持不变） */
      let dp = (f * (L / din) + kJoint) * qDyn;
      /** 出口动压（式 4g 用末段出口流速；等径时与进口流速相同） */
      const qDynOut = 0.5 * rho * velOut * velOut;
      let thetaDeg = 0;
      if (tapered) {
        // 式 4a~4c：沿程摩擦按 N 段积分，D_i 取子段平均直径、v_i 按当地截面重算
        const dl = L / TAPER_N;
        let dpFric = 0;
        for (let i = 0; i < TAPER_N; i++) {
          const Di = din + (dout - din) * ((i + 0.5) / TAPER_N);
          const li = areaAt(Di);
          const vi = Q / li.Aeff;
          const Rei = (rho * vi * Di) / mu;
          const mi = side === 'out' && type === 3 ? 1 + v.aPerf * phiAt(Di) : mult;
          const fi = fric(Rei, eps, Di) * mi;
          dpFric += fi * (dl / Di) * 0.5 * rho * vi * vi;
        }
        // 式 4d~4f：全锥角与渐扩/渐缩局部损失（渐扩以 v_in 为基准、渐缩以 v_out 为基准）
        thetaDeg = (2 * Math.atan((dout - din) / (2 * L)) * 180) / Math.PI;
        const aRatio = outl.Aeff / inl.Aeff;
        const kTaper = dout > din
          ? interpTab(KEXP_TAB, thetaDeg) * Math.pow(1 - 1 / aRatio, 2) * qDyn
          : interpTab(KCON_TAB, thetaDeg) * (1 - aRatio) * qDynOut;
        dp = dpFric + kJoint * qDyn + kTaper;
      }

      const dpB = nBend * (kSmooth - b.k) * qDyn;
      const M = (tapered ? Math.max(vel, velOut) : vel) / Math.sqrt(gamma * R * v.T);
      return { vel, velOut, M, dp, dpB, phi, thetaDeg };
    };

    /** 消音器壳体与穿孔管不同径时的突扩 + 突缩系数（等径为 0） */
    const kGeo = (Db: number, D: number) => {
      if (!(Db > D) || !(D > 0)) return 0;
      const r = (D * D) / (Db * Db);
      return Math.pow(1 - r, 2) + 0.5 * (1 - r);
    };

    /** 孔口射流损失：Δp = (1/C_d² − 1)·ρv_h²/2，v_h = Q_th/A_h */
    const jetDp = (Qth: number, Ah: number, Cd: number) => {
      if (!(Qth > 0) || !(Ah > 0) || !(Cd > 0)) return 0;
      const vh = Qth / Ah;
      return (1 / (Cd * Cd) - 1) * 0.5 * rho * vh * vh;
    };

    /** 编织壁泄漏量（不计入压降，仅作旁通评估） */
    const leakQ = (A: number, dp: number) =>
      A > 0 && dp > 0 ? v.CdLeak * A * Math.sqrt((2 * dp) / rho) : 0;

    /** 按所选段数逐段求解；段索引 i 与输出键 dpIn{i} / dpOut{i} 一一对应 */
    const inRes: ReturnType<typeof seg>[] = [];
    for (let i = 1; i <= nIn; i++) {
      inRes.push(seg(v[`t${i}`], v[`D${i}`], v[`Dout${i}`], v[`L${i}`], v[`K${i}`], v[`bendN${i}`], v[`nb${i}`],
        { h: v[`h${i}`], p: v[`p${i}`], rb: v[`rbn${i}`] }, 'in'));
    }
    const outRes: ReturnType<typeof seg>[] = [];
    for (let i = 1; i <= nOut; i++) {
      outRes.push(seg(v[`o${i}`], v[`Do${i}`], v[`Douto${i}`], v[`Lo${i}`], v[`Ko${i}`], v[`bendO${i}`], v[`nbo${i}`],
        { h: v[`hO${i}`], p: v[`pO${i}`], ah: v[`Ah${i}`], phiB: v[`phi${i}`], kb: v[`kb${i}`], Db: v[`Db${i}`] }, 'out'));
    }

    // 大气入口段：以进气管段 1 截面为基准，计入车速冲压与舱内负压
    const vIn = inRes[0].vel;
    const dpEntrance = (1 + v.Kin) * 0.5 * rho * vIn * vIn - 0.5 * rho * v.V * v.V + v.pBay;

    // 空滤器：箱体局部阻力 + 滤芯多孔介质阻力（流场不均匀修正）+ 容尘
    const vBox = Q / v.ABox;
    const dpBox = v.KBox * 0.5 * rho * vBox * vBox;
    const eta = Number.isFinite(v.eta) && v.eta > 0 ? v.eta : 1;
    const vf = Q / v.Af;
    const vEff = vf / eta;
    const dpFilter = v.aF * vEff + v.bF * vEff * vEff;
    const dpAirbox = dpBox + dpFilter + v.kD * v.mDust;

    const res: Record<string, number> = { vIn, dpEntrance, dpBox, dpFilter, dpAirbox, vEff, rhoUsed: rho };
    inRes.forEach((s, j) => {
      res[`dpIn${j + 1}`] = s.dp;
      res[`lk${j + 1}`] = v[`t${j + 1}`] === 3 ? leakQ(v[`lkA${j + 1}`], s.dp) : 0;
    });
    outRes.forEach((s, j) => {
      res[`dpOut${j + 1}`] = s.dp;
      res[`dpJet${j + 1}`] = v[`o${j + 1}`] === 3 ? jetDp(v[`Qh${j + 1}`], v[`Ah${j + 1}`], v[`Cd${j + 1}`]) : 0;
      res[`phiA${j + 1}`] = s.phi;
      res[`dpB${j + 1}`] = s.dpB;
    });
    // 未启用段填 NaN（其输出按 nIn / nOut 隐藏）
    for (let i = inRes.length + 1; i <= SEG_MAX; i++) {
      res[`dpIn${i}`] = NaN;
      res[`lk${i}`] = NaN;
    }
    for (let i = outRes.length + 1; i <= SEG_MAX; i++) {
      res[`dpOut${i}`] = NaN;
      res[`dpJet${i}`] = NaN;
      res[`phiA${i}`] = NaN;
      res[`dpB${i}`] = NaN;
    }

    const dpInSum = inRes.reduce((a, s) => a + s.dp, 0);
    const dpOutSum = outRes.reduce((a, s) => a + s.dp, 0);
    const dpJetSum = outRes.reduce((a, _s, j) =>
      a + (v[`o${j + 1}`] === 3 ? jetDp(v[`Qh${j + 1}`], v[`Ah${j + 1}`], v[`Cd${j + 1}`]) : 0), 0);
    const dpTotal = dpEntrance + dpInSum + dpAirbox + dpOutSum + dpJetSum;

    // 式 4g：出口动压与系统总静压降（与各段损失之和分开输出）
    const vOut = outRes[outRes.length - 1].velOut;
    const dpDyn = 0.5 * rho * vOut * vOut;
    const allSegs = [...inRes, ...outRes];
    const thetaMax = Math.max(...allSegs.map((s) => s.thetaDeg));
    const Mmax = Math.max(...allSegs.map((s) => s.M));

    res.dpTotal = dpTotal;
    res.vOut = vOut;
    res.dpDyn = dpDyn;
    res.dpTotalStatic = dpTotal + dpDyn;
    res.thetaMax = thetaMax;
    res.Mmax = Mmax;
    res.dpComp = dpTotal * (1 + (Mmax * Mmax) / 4);
    res.S = dpTotal / (Q * Q);

    return res;
  },
  benchmarks: [
    {
      name: '文档算例：Q = 600 m³/h，台架静止（喇叭口 K_in = 0.05）',
      input: {
        Q: 600 / 3600, rho: 1.205, mu: 1.81e-5, T: 293.15, V: 0, Kin: 0.05, pBay: 0,
        rhoMode: 1, z: 0, RH: 0,
        epsS: 3e-5, Cc: 2, kBell: 4, mBell: 1.35, epsB: 1e-4, cb: 0.5,
        epsM: 2e-4, aPerf: 1, c1: 1.5, c2: 1, CdLeak: 0.7,
        t1: 1, D1: 0.07, L1: 0.3, K1: 0.35, bendN1: 0, nb1: 0, h1: 4e-3, p1: 0.01, lkA1: 0, rbn1: 0,
        t2: 2, D2: 0.06, L2: 0.15, K2: 0.4, bendN2: 0, nb2: 0, h2: 4e-3, p2: 0.01, lkA2: 0, rbn2: 0,
        t3: 3, D3: 0.06, L3: 0.25, K3: 0.3, bendN3: 0, nb3: 0, h3: 4e-3, p3: 0.01, lkA3: 0, rbn3: 0,
        ABox: 0.00283, KBox: 0.5, Af: 0.25, aF: 300, bF: 800, mDust: 0, kD: 0,
        o1: 1, Do1: 0.06, Lo1: 0.4, Ko1: 0.8, bendO1: 0, nbo1: 0, hO1: 4e-3, pO1: 0.01,
        o2: 3, Do2: 0.06, Lo2: 0.2, Ko2: 0.4, bendO2: 0, nbo2: 0, hO2: 4e-3, pO2: 0.01,
        o3: 1, Do3: 0.06, Lo3: 0, Ko3: 0, bendO3: 0, nbo3: 0, hO3: 4e-3, pO3: 0.01,
        Db1: 0.06, Ah1: 0, Cd1: 0.7, Qh1: 0, phi1: 0, kb1: 0,
        Db2: 0.06, Ah2: 0, Cd2: 0.7, Qh2: 0, phi2: 0, kb2: 0,
        Db3: 0.06, Ah3: 0, Cd3: 0.7, Qh3: 0, phi3: 0, kb3: 0,
      },
      expect: {
        vIn: 43.30746750799872,
        dpEntrance: 1186.5114313801457,
        rhoUsed: 1.205,
        dpIn1: 485.246132375281,
        dpIn2: 1048.5519669299392,
        dpIn3: 831.723139995698,
        dpBox: 1044.8445548771433,
        dpFilter: 555.5555555555554,
        dpAirbox: 1600.4001104326987,
        dpOut1: 1935.3532916120423,
        dpOut2: 1030.3829849372628,
        dpOut3: 0,
        phiA2: 0,
        dpTotal: 8118.169057663068,
        vOut: 58.946275219220496,
        dpDyn: 2093.484675737603,
        dpTotalStatic: 10211.653733400672,
        vEff: 0.6666666666666666,
        thetaMax: 0,
        Mmax: 0.1717538385775335,
        dpComp: 8178.03929831086,
        S: 292254.0860758705,
      },
      tolerance: 1e-9,
      source: '《进气系统分部件阻力计算》第 9 节算例（Q = 600 m³/h、20 ℃、ρ = 1.205 kg/m³，台架静止）',
    },
    {
      name: '同算例 120 km/h 迎风：车速冲压抵减入口损失',
      input: {
        Q: 600 / 3600, rho: 1.205, mu: 1.81e-5, T: 293.15, V: 33.3, Kin: 0.05, pBay: 0,
        rhoMode: 1, z: 0, RH: 0,
        epsS: 3e-5, Cc: 2, kBell: 4, mBell: 1.35, epsB: 1e-4, cb: 0.5,
        epsM: 2e-4, aPerf: 1, c1: 1.5, c2: 1, CdLeak: 0.7,
        t1: 1, D1: 0.07, L1: 0.3, K1: 0.35, bendN1: 0, nb1: 0, h1: 4e-3, p1: 0.01, lkA1: 0, rbn1: 0,
        t2: 2, D2: 0.06, L2: 0.15, K2: 0.4, bendN2: 0, nb2: 0, h2: 4e-3, p2: 0.01, lkA2: 0, rbn2: 0,
        t3: 3, D3: 0.06, L3: 0.25, K3: 0.3, bendN3: 0, nb3: 0, h3: 4e-3, p3: 0.01, lkA3: 0, rbn3: 0,
        ABox: 0.00283, KBox: 0.5, Af: 0.25, aF: 300, bF: 800, mDust: 0, kD: 0,
        o1: 1, Do1: 0.06, Lo1: 0.4, Ko1: 0.8, bendO1: 0, nbo1: 0, hO1: 4e-3, pO1: 0.01,
        o2: 3, Do2: 0.06, Lo2: 0.2, Ko2: 0.4, bendO2: 0, nbo2: 0, hO2: 4e-3, pO2: 0.01,
        o3: 1, Do3: 0.06, Lo3: 0, Ko3: 0, bendO3: 0, nbo3: 0, hO3: 4e-3, pO3: 0.01,
        Db1: 0.06, Ah1: 0, Cd1: 0.7, Qh1: 0, phi1: 0, kb1: 0,
        Db2: 0.06, Ah2: 0, Cd2: 0.7, Qh2: 0, phi2: 0, kb2: 0,
        Db3: 0.06, Ah3: 0, Cd3: 0.7, Qh3: 0, phi3: 0, kb3: 0,
      },
      expect: {
        vIn: 43.30746750799872,
        dpEntrance: 518.4052063801457,
        dpIn1: 485.246132375281,
        dpIn2: 1048.5519669299392,
        dpIn3: 831.723139995698,
        dpBox: 1044.8445548771433,
        dpFilter: 555.5555555555554,
        dpAirbox: 1600.4001104326987,
        dpOut1: 1935.3532916120423,
        dpOut2: 1030.3829849372628,
        dpOut3: 0,
        dpTotal: 7450.062832663069,
        Mmax: 0.1717538385775335,
        dpComp: 7505.00589327988,
        S: 268202.26197587047,
      },
      tolerance: 1e-9,
      source: '《进气系统分部件阻力计算》第 11.6 节算例②（120 km/h 迎风，冲压 669 Pa）',
    },
    {
      name: '加大波纹管/编织管至 65 mm：总阻力由 8.1 kPa 降至 6.7 kPa',
      input: {
        Q: 600 / 3600, rho: 1.205, mu: 1.81e-5, T: 293.15, V: 0, Kin: 0.05, pBay: 0,
        rhoMode: 1, z: 0, RH: 0,
        epsS: 3e-5, Cc: 2, kBell: 4, mBell: 1.35, epsB: 1e-4, cb: 0.5,
        epsM: 2e-4, aPerf: 1, c1: 1.5, c2: 1, CdLeak: 0.7,
        t1: 1, D1: 0.07, L1: 0.3, K1: 0.35, bendN1: 0, nb1: 0, h1: 4e-3, p1: 0.01, lkA1: 0, rbn1: 0,
        t2: 2, D2: 0.065, L2: 0.15, K2: 0.4, bendN2: 0, nb2: 0, h2: 4e-3, p2: 0.01, lkA2: 0, rbn2: 0,
        t3: 3, D3: 0.065, L3: 0.25, K3: 0.3, bendN3: 0, nb3: 0, h3: 4e-3, p3: 0.01, lkA3: 0, rbn3: 0,
        ABox: 0.00283, KBox: 0.5, Af: 0.25, aF: 300, bF: 800, mDust: 0, kD: 0,
        o1: 1, Do1: 0.065, Lo1: 0.4, Ko1: 0.8, bendO1: 0, nbo1: 0, hO1: 4e-3, pO1: 0.01,
        o2: 3, Do2: 0.065, Lo2: 0.2, Ko2: 0.4, bendO2: 0, nbo2: 0, hO2: 4e-3, pO2: 0.01,
        o3: 1, Do3: 0.065, Lo3: 0, Ko3: 0, bendO3: 0, nbo3: 0, hO3: 4e-3, pO3: 0.01,
        Db1: 0.065, Ah1: 0, Cd1: 0.7, Qh1: 0, phi1: 0, kb1: 0,
        Db2: 0.065, Ah2: 0, Cd2: 0.7, Qh2: 0, phi2: 0, kb2: 0,
        Db3: 0.065, Ah3: 0, Cd3: 0.7, Qh3: 0, phi3: 0, kb3: 0,
      },
      expect: {
        vIn: 43.30746750799872,
        dpEntrance: 1186.5114313801457,
        dpIn1: 485.246132375281,
        dpIn2: 748.8464357930342,
        dpIn3: 590.52115147465,
        dpBox: 1044.8445548771433,
        dpFilter: 555.5555555555554,
        dpAirbox: 1600.4001104326987,
        dpOut1: 1389.7783049538366,
        dpOut2: 734.8696478085001,
        dpOut3: 0,
        dpTotal: 6736.173214218146,
        Mmax: 0.14634646600689244,
        dpComp: 6772.240854844648,
        S: 242502.23571185328,
      },
      tolerance: 1e-9,
      source: '自建优化算例（波纹管、编织管、出气管、消音器内径 60 → 65 mm，验证第 9 节“加大管径可降到 5 kPa 以内”的结论方向）',
    },
    {
      name: '新版资料特性：90°弯头查表 + 编织管弯曲修正 + 穿孔弯头 φ_b = 0.3',
      input: {
        Q: 600 / 3600, rho: 1.205, mu: 1.81e-5, T: 293.15, V: 0, Kin: 0.05, pBay: 0,
        rhoMode: 1, z: 0, RH: 0,
        epsS: 3e-5, Cc: 2, kBell: 4, mBell: 1.35, epsB: 1e-4, cb: 0.5,
        epsM: 2e-4, aPerf: 1, c1: 1.5, c2: 1, CdLeak: 0.7,
        t1: 1, D1: 0.07, L1: 0.3, K1: 0.35, bendN1: 4, nb1: 1, h1: 4e-3, p1: 0.01, lkA1: 0, rbn1: 0,
        t2: 2, D2: 0.06, L2: 0.15, K2: 0.4, bendN2: 0, nb2: 0, h2: 4e-3, p2: 0.01, lkA2: 0, rbn2: 0,
        t3: 3, D3: 0.06, L3: 0.25, K3: 0.3, bendN3: 4, nb3: 1, h3: 4e-3, p3: 0.01, lkA3: 0, rbn3: 0.12,
        ABox: 0.00283, KBox: 0.5, Af: 0.25, aF: 300, bF: 800, mDust: 0, kD: 0,
        o1: 1, Do1: 0.06, Lo1: 0.4, Ko1: 0.8, bendO1: 0, nbo1: 0, hO1: 4e-3, pO1: 0.01,
        o2: 3, Do2: 0.06, Lo2: 0.2, Ko2: 0.4, bendO2: 4, nbo2: 1, hO2: 4e-3, pO2: 0.01,
        o3: 1, Do3: 0.06, Lo3: 0, Ko3: 0, bendO3: 0, nbo3: 0, hO3: 4e-3, pO3: 0.01,
        Db1: 0.06, Ah1: 0, Cd1: 0.7, Qh1: 0, phi1: 0, kb1: 0,
        Db2: 0.08, Ah2: 0.01131, Cd2: 0.7, Qh2: 0, phi2: 0.3, kb2: 0.1,
        Db3: 0.06, Ah3: 0, Cd3: 0.7, Qh3: 0, phi3: 0, kb3: 0,
      },
      expect: {
        dpIn1: 937.250487186765,
        dpIn2: 1048.5519669299392,
        dpIn3: 2080.976569557394,
        dpOut2: 4267.714205032371,
        dpB2: 1274.0349598060268,
        phiA2: 0.3000070677282227,
        dpTotal: 13056.758062131357,
        Mmax: 0.18079351429214055,
        dpComp: 13163.45232295211,
        S: 470043.2902367289,
      },
      tolerance: 1e-9,
      source: '新版资料校验（弯头式 6a、编织管式 9d/9e、穿孔弯头式 15b/15c：K_bend,perf ≈ 1.01，对应 Δp_bend ≈ 0.61·ρv²/2）',
    },
    {
      name: '渐变管缓扩 70→80 mm、L = 300 mm（资料式 4a~4f 与算例 15）',
      input: {
        Q: 600 / 3600, rho: 1.205, mu: 1.81e-5, T: 293.15, V: 0, Kin: 0.05, pBay: 0,
        rhoMode: 1, z: 0, RH: 0,
        epsS: 3e-5, Cc: 2, kBell: 4, mBell: 1.35, epsB: 1e-4, cb: 0.5,
        epsM: 2e-4, aPerf: 1, c1: 1.5, c2: 1, CdLeak: 0.7,
        t1: 1, D1: 0.07, Dout1: 0.08, L1: 0.3, K1: 0, bendN1: 0, nb1: 0, h1: 4e-3, p1: 0.01, lkA1: 0, rbn1: 0,
        t2: 2, D2: 0.06, L2: 0, K2: 0, bendN2: 0, nb2: 0, h2: 4e-3, p2: 0.01, lkA2: 0, rbn2: 0,
        t3: 3, D3: 0.06, L3: 0, K3: 0, bendN3: 0, nb3: 0, h3: 4e-3, p3: 0.01, lkA3: 0, rbn3: 0,
        ABox: 0.00283, KBox: 0.5, Af: 0.25, aF: 300, bF: 800, mDust: 0, kD: 0,
        o1: 1, Do1: 0.06, Lo1: 0, Ko1: 0, bendO1: 0, nbo1: 0, hO1: 4e-3, pO1: 0.01,
        o2: 1, Do2: 0.06, Lo2: 0, Ko2: 0, bendO2: 0, nbo2: 0, hO2: 4e-3, pO2: 0.01,
        o3: 1, Do3: 0.06, Lo3: 0, Ko3: 0, bendO3: 0, nbo3: 0, hO3: 4e-3, pO3: 0.01,
        Db1: 0.06, Ah1: 0, Cd1: 0.7, Qh1: 0, phi1: 0, kb1: 0,
        Db2: 0.06, Ah2: 0, Cd2: 0.7, Qh2: 0, phi2: 0, kb2: 0,
        Db3: 0.06, Ah3: 0, Cd3: 0.7, Qh3: 0, phi3: 0, kb3: 0,
      },
      expect: {
        dpIn1: 66.07954240676722,
        thetaMax: 1.9096825077443764,
        dpTotal: 2852.9910842196114,
      },
      tolerance: 1e-9,
      source: '《进气系统分部件阻力计算》式(4a)~(4f) 与算例 15：θ ≈ 1.9°，k_exp ≈ 0.03，K ≈ 0.002（Δp ≈ 2 Pa），沿程摩擦 ≈ 60 Pa',
    },
    {
      name: '渐变管急扩 60→120 mm、L = 50 mm（资料算例 15）',
      input: {
        Q: 600 / 3600, rho: 1.205, mu: 1.81e-5, T: 293.15, V: 0, Kin: 0.05, pBay: 0,
        rhoMode: 1, z: 0, RH: 0,
        epsS: 3e-5, Cc: 2, kBell: 4, mBell: 1.35, epsB: 1e-4, cb: 0.5,
        epsM: 2e-4, aPerf: 1, c1: 1.5, c2: 1, CdLeak: 0.7,
        t1: 1, D1: 0.07, L1: 0, K1: 0, bendN1: 0, nb1: 0, h1: 4e-3, p1: 0.01, lkA1: 0, rbn1: 0,
        t2: 1, D2: 0.06, Dout2: 0.12, L2: 0.05, K2: 0, bendN2: 0, nb2: 0, h2: 4e-3, p2: 0.01, lkA2: 0, rbn2: 0,
        t3: 3, D3: 0.06, L3: 0, K3: 0, bendN3: 0, nb3: 0, h3: 4e-3, p3: 0.01, lkA3: 0, rbn3: 0,
        ABox: 0.00283, KBox: 0.5, Af: 0.25, aF: 300, bF: 800, mDust: 0, kD: 0,
        o1: 1, Do1: 0.06, Lo1: 0, Ko1: 0, bendO1: 0, nbo1: 0, hO1: 4e-3, pO1: 0.01,
        o2: 1, Do2: 0.06, Lo2: 0, Ko2: 0, bendO2: 0, nbo2: 0, hO2: 4e-3, pO2: 0.01,
        o3: 1, Do3: 0.06, Lo3: 0, Ko3: 0, bendO3: 0, nbo3: 0, hO3: 4e-3, pO3: 0.01,
        Db1: 0.06, Ah1: 0, Cd1: 0.7, Qh1: 0, phi1: 0, kb1: 0,
        Db2: 0.06, Ah2: 0, Cd2: 0.7, Qh2: 0, phi2: 0, kb2: 0,
        Db3: 0.06, Ah3: 0, Cd3: 0.7, Qh3: 0, phi3: 0, kb3: 0,
      },
      expect: {
        dpIn2: 964.7727911893552,
        thetaMax: 61.92751306414704,
      },
      tolerance: 1e-9,
      source: '《进气系统分部件阻力计算》算例 15：急扩 θ ≈ 62°，k_exp ≈ 0.8，K ≈ 0.45，Δp ≈ 940 Pa',
    },
    {
      name: '空滤器流场不均匀 η = 0.9（资料式 13b/13c 与算例 14）',
      input: {
        Q: 600 / 3600, rho: 1.205, mu: 1.81e-5, T: 293.15, V: 0, Kin: 0.05, pBay: 0,
        rhoMode: 1, z: 0, RH: 0,
        epsS: 3e-5, Cc: 2, kBell: 4, mBell: 1.35, epsB: 1e-4, cb: 0.5,
        epsM: 2e-4, aPerf: 1, c1: 1.5, c2: 1, CdLeak: 0.7, eta: 0.9,
        t1: 1, D1: 0.07, L1: 0.3, K1: 0.35, bendN1: 0, nb1: 0, h1: 4e-3, p1: 0.01, lkA1: 0, rbn1: 0,
        t2: 2, D2: 0.06, L2: 0.15, K2: 0.4, bendN2: 0, nb2: 0, h2: 4e-3, p2: 0.01, lkA2: 0, rbn2: 0,
        t3: 3, D3: 0.06, L3: 0.25, K3: 0.3, bendN3: 0, nb3: 0, h3: 4e-3, p3: 0.01, lkA3: 0, rbn3: 0,
        ABox: 0.00283, KBox: 0.5, Af: 0.25, aF: 300, bF: 800, mDust: 0, kD: 0,
        o1: 1, Do1: 0.06, Lo1: 0.4, Ko1: 0.8, bendO1: 0, nbo1: 0, hO1: 4e-3, pO1: 0.01,
        o2: 3, Do2: 0.06, Lo2: 0.2, Ko2: 0.4, bendO2: 0, nbo2: 0, hO2: 4e-3, pO2: 0.01,
        o3: 1, Do3: 0.06, Lo3: 0, Ko3: 0, bendO3: 0, nbo3: 0, hO3: 4e-3, pO3: 0.01,
        Db1: 0.06, Ah1: 0, Cd1: 0.7, Qh1: 0, phi1: 0, kb1: 0,
        Db2: 0.06, Ah2: 0, Cd2: 0.7, Qh2: 0, phi2: 0, kb2: 0,
        Db3: 0.06, Ah3: 0, Cd3: 0.7, Qh3: 0, phi3: 0, kb3: 0,
      },
      expect: {
        vEff: 0.7407407407407407,
        dpFilter: 661.1796982167352,
        dpAirbox: 1706.0242530938785,
        dpTotal: 8223.793200324248,
      },
      tolerance: 1e-9,
      source: '《进气系统分部件阻力计算》式(13b)(13c) 与算例 14：η = 0.9 → v_eff = 0.741，a·v = 222 Pa、b·v² = 439 Pa，合计 661 Pa',
    },
  ],
};
