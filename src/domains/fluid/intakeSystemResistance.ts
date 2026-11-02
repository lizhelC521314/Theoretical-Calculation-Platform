import type { FormulaSpec } from '../../formula/types';

/**
 * 进气系统分部件阻力设计（进气管 3 段 + 空滤器 + 出气管 3 段）
 *
 * 按《进气系统分部件阻力计算（进气管-波纹管-编织管-空滤器-出气管-消音器）》实现：
 *   通用段阻力   Δp = [ f·(L/D) + ΣK ]·(ρv²/2)，v = Q/A，A = πD²/4
 *   摩擦因子     f = 0.25 / { lg[ ε/(3.7D) + 5.74/Re^0.9 ] }²（Swamee-Jain 显式解，替代式 5）
 *   弯头         K_bend = n·K_90(R/D)·(θ/90°)^0.8~1.2（式 6a，本式取指数 1.0 + 查表 K_90）
 *   波纹管       f_c = f_s·[1 + k·(h/p)^m]（式 7，k = 3~5、m = 1.2~1.5）；无波深/波距时退回 C_c
 *   编织管       ε_b = 0.05~0.30 mm 粗糙管；弯曲时 K 增 cb·D/R_b、有效面积 A_eff = A·(1 − 0.1·D/R_b)（式 9d/9e）
 *   穿孔消音器   f_m = f_s·(1 + a·φ)，φ = A_h/(π·D·L)（式 15）；另有隔板、突扩/突缩、弯曲开孔附加（式 15c）
 *   空滤器       Δp = ΣK_box·(ρv_box²/2) + (a·v_f + b·v_f²) + k_d·m_dust
 *   大气入口段   Δp_entrance = (1 + K_in)·(ρv²/2) − (ρV²/2) + p_bay
 *   空气密度     ρ = p/(R·T)·(1 − 0.378·p_v/p)，p = p0·(1 − 2.2557×10⁻⁵·z)^5.2559（式 20~22，可选）
 *   可压缩修正   Δp_comp ≈ Δp_inc·(1 + M²/4)，M = v/c，c = (γRT)^(1/2)
 */
export const intakeSystemResistance: FormulaSpec = {
  id: 'fluid.intakeSystemResistance',
  domain: 'fluid',
  subsystem: '进气系统',
  title: '进气系统阻力设计（进气管—空滤器—出气管）',
  summary:
    '按「进气管 3 段（每段可选进气管/波纹管/编织管）→ 空滤器（箱体 + 滤芯）→ 出气管 3 段（每段可选出气管/波纹管/多腔穿孔消音器）」逐段计算静压损失并汇总，另计入大气入口段（含车速冲压与舱内负压）与可压缩性修正，输出系统阻力曲线。',
  tags: ['进气系统', '阻力', '压降', '进气管', '波纹管', '编织管', '空气滤清器', '滤芯', '消音器', '穿孔管', '达西摩擦因子', '局部阻力', '入口损失', '马赫数', 'ISO 5011', '流体设计'],
  description:
    '进气系统总阻力为各段静压损失之和：Δp_sys = Δp_entrance + ΣΔp_in + Δp_airbox + ΣΔp_out。每段均按「沿程摩擦 + 局部阻力」计算 Δp = [f·(L/D) + ΣK]·(ρv²/2)，各段流速按各自内径计算，局部阻力系数按该段局部流速取动压。弯头不再取固定值，按 K_bend = n·K_90(R/D)·(θ/90°)^0.8~1.2 逐只计算（90°、R/D=1 取 0.3~0.5，R/D=0.5 取 0.8~1.2，直角/拼焊取 1.1~1.5；45° 约为 90° 的一半）。进气管侧每段可选进气管（光滑管 ε_s）、波纹管（f_c = f_s·[1 + k·(h/p)^m]，k = 3~5、m = 1.2~1.5；无几何数据时退回 C_c = 1.5~2.5）或编织管（ε_b = 0.05~0.30 mm，弯曲时按 K·[1 + c_b·D/R_b] 放大、按 A_eff = A·(1 − 0.1·D/R_b) 重算流速）。出气管侧可选普通出气管、波纹管或多腔穿孔消音器：穿孔管摩擦按 f_m = f_s·(1 + a·φ) 放大，φ 为孔总面积与穿孔段管内表面积之比；另计隔板损失、本体突扩/突缩，以及弯曲段整片开孔带来的「冲击 + 腔体交换」附加损失 K_bend,perf = K_bend,0·[1 + c1·(θ/90°)·φ_b] + c2·(θ/90°)²·φ_b/(1 − φ_b)。空滤器阻力 = 箱体局部阻力 + 滤芯多孔介质阻力 (a·v_f + b·v_f²) + 容尘增量 k_d·m_dust，a、b 由 ISO 5011 台架拟合。大气入口段按 Δp = (1 + K_in)·(ρv²/2) − (ρV²/2) 计算，系数是 (1 + K_in) 而不是单独的 K_in，因为把静止空气加速到管内流速所需的动压同样表现为入口静压下降。空气密度可直接输入，也可按温度、海拔与相对湿度由 p(z)、Buck 公式与湿空气状态方程计算（式 20~22）。马赫数 M > 0.3 时按 Δp_comp ≈ Δp_inc·(1 + M²/4) 粗略修正，M > 0.6 应以一维气体动力学（Fanno）或 CFD 复算并做堵塞校核。选定管型后，输入区只显示该元件实际需要的参数，公式区同步切换为该元件的专用公式。',
  inputs: [
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
    { key: 'epsS', label: '光滑管绝对粗糙度', symbol: 'ε_s', unit: 'mm', unitGroup: 'length', default: 0.03, min: 0, required: true, description: '塑料/橡胶直管 0.01~0.05 mm，金属管 0.05~0.1 mm' },
    { key: 'Cc', label: '波纹管摩擦放大系数（无波深/波距时使用）', symbol: 'C_c', unit: '-', unitGroup: 'dimensionless', default: 2.0, min: 1, required: true, description: '式 7 的退化取值：浅波纹 1.5，深波纹 2.0~2.5。填写了波深 h 与波距 p 时改按 f_c = f_s·[1 + k·(h/p)^m] 计算' },
    { key: 'kBell', label: '波纹管拟合系数 k', symbol: 'k', unit: '-', unitGroup: 'dimensionless', default: 4, min: 0, required: true, description: '式 7：k = 3~5，由样件试验拟合；无数据取 4' },
    { key: 'mBell', label: '波纹管拟合指数 m', symbol: 'm', unit: '-', unitGroup: 'dimensionless', default: 1.35, min: 0, required: true, description: '式 7：m = 1.2~1.5，由样件试验拟合；无数据取 1.35' },
    { key: 'epsB', label: '编织管绝对粗糙度', symbol: 'ε_b', unit: 'mm', unitGroup: 'length', default: 0.1, min: 0, required: true, description: '细密编织 0.05~0.10 mm，粗编织/有横向凸起 0.15~0.30 mm，最好用一段直管做 Δp–Q 试验反算' },
    { key: 'cb', label: '编织管弯曲附加系数', symbol: 'c_b', unit: '-', unitGroup: 'dimensionless', default: 0.5, min: 0, required: true, description: '式 9d：c_b = 0.4~0.6。R_b/D ≥ 3 时基本无附加，R_b/D = 2 时 K 增 20%~30%，R_b/D = 1 时增 40%~60%' },
    { key: 'epsM', label: '穿孔管绝对粗糙度', symbol: 'ε_m', unit: 'mm', unitGroup: 'length', default: 0.2, min: 0, required: true, description: '穿孔管内壁 0.1~0.3 mm；孔口本身的增量另按穿孔率 φ 计入（式 15）' },
    { key: 'aPerf', label: '穿孔率摩擦放大系数 a', symbol: 'a', unit: '-', unitGroup: 'dimensionless', default: 1.0, min: 0, required: true, description: '式 15：f_m = f_s·(1 + a·φ)，a = 0.5~1.5，无试验数据取 1.0' },
    { key: 'c1', label: '消音器弯头开孔系数 c1', symbol: 'c_1', unit: '-', unitGroup: 'dimensionless', default: 1.5, min: 0, required: true, description: '式 15c：c1 = 1~2，由「直管 vs 弯管、开孔 vs 不开孔」对比试验标定' },
    { key: 'c2', label: '消音器弯头开孔系数 c2', symbol: 'c_2', unit: '-', unitGroup: 'dimensionless', default: 1.0, min: 0, required: true, description: '式 15c：c2 = 0.5~1.5，表征腔体交换损失，弯角越大权重越高' },
    { key: 'CdLeak', label: '编织壁泄漏流量系数', symbol: 'C_d', unit: '-', unitGroup: 'dimensionless', default: 0.7, min: 0, max: 1, required: true, description: '编织管壁面孔隙泄漏量 q = C_d·A_h·(2Δp/ρ)^(1/2) 的流量系数，取 0.6~0.8；泄漏量不计入压降，仅用于评估过滤旁通' },

    { key: 't1', label: '进气管段 1 类型', symbol: '-', unit: '-', kind: 'select', options: [{ value: 1, label: '进气管' }, { value: 2, label: '波纹管' }, { value: 3, label: '编织管' }], default: 1, required: true, description: '按实际走向把进气管划分为 3 段，每段单独选型、单独计算' },
    { key: 'D1', label: '进气管段 1 内径', symbol: 'D_in1', unit: 'mm', unitGroup: 'diameter', default: 70, min: 0, required: true, description: '该段管内径，流速按本段内径计算' },
    { key: 'L1', label: '进气管段 1 长度', symbol: 'L_in1', unit: 'mm', unitGroup: 'length', default: 300, min: 0, required: true, description: '该段沿程长度（不含弯头展开长度）' },
    { key: 'K1', label: '进气管段 1 其它局部阻力系数', symbol: 'ΣK_1', unit: '-', unitGroup: 'dimensionless', default: 0.35, min: 0, required: true, description: '不含弯头的局部损失之和（入口、变径、滤网等）；弯头由下面的「弯头规格 / 只数」自动按式 6a 计入' },
    { key: 'bendN1', label: '进气管段 1 弯头规格', symbol: 'K_90', unit: '-', kind: 'select', options: [{ value: 0, label: '无弯头' }, { value: 1, label: '45°，R/D=1（0.18）' }, { value: 2, label: '45°，R/D=0.5（0.35）' }, { value: 3, label: '90°，R/D=2（0.25）' }, { value: 4, label: '90°，R/D=1（0.40）' }, { value: 5, label: '90°，R/D=0.5（1.00）' }, { value: 6, label: '90°直角/拼焊（1.30）' }], default: 0, required: true, description: '按式 6a：K_bend = n·K_90(R/D)·(θ/90°)^0.8~1.2，括号内为 90° 基准值；Re < 10⁵ 或相邻弯头间距 <5D 时应再乘 1.1~1.3' },
    { key: 'nb1', label: '进气管段 1 弯头只数', symbol: 'n', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, required: true, description: '该段弯头数量，与规格系数相乘后叠加到 ΣK' },
    { key: 'h1', label: '进气管段 1 波纹波深', symbol: 'h', unit: 'mm', unitGroup: 'length', default: 4, min: 0, showIf: { key: 't1', min: 2, max: 2 }, description: '仅波纹管需要：波深 h。与波距 p 一起按 f_c = f_s·[1 + k·(h/p)^m] 计算；h 或 p 为 0 时退回 C_c' },
    { key: 'p1', label: '进气管段 1 波纹波距', symbol: 'p', unit: 'mm', unitGroup: 'length', default: 10, min: 0, showIf: { key: 't1', min: 2, max: 2 }, description: '仅波纹管需要：波距 p（自由状态）；轴向拉伸后波距变大、f_c 下降 5%~15%，设计按自由状态取值' },
    { key: 'lkA1', label: '进气管段 1 编织壁有效开孔面积', symbol: 'A_h1', unit: 'mm²', unitGroup: 'area', default: 0, min: 0, showIf: { key: 't1', min: 3, max: 3 }, description: '仅编织管需要：壁面孔隙的有效开孔面积，用于估算泄漏量（不计入压降）；0 表示忽略泄漏' },
    { key: 'rbn1', label: '进气管段 1 编织管弯曲半径', symbol: 'R_b1', unit: 'mm', unitGroup: 'length', default: 0, min: 0, showIf: { key: 't1', min: 3, max: 3 }, description: '仅编织管需要：软管弯曲半径 R_b。R_b/D ≥ 3 无附加损失；R_b/D = 2 时 K 增 20%~30% 且有效面积减 5%；R_b/D = 1 时 K 增 40%~60%、有效面积减 10%。0 表示无弯曲' },

    { key: 't2', label: '进气管段 2 类型', symbol: '-', unit: '-', kind: 'select', options: [{ value: 1, label: '进气管' }, { value: 2, label: '波纹管' }, { value: 3, label: '编织管' }], default: 2, required: true, description: '示例段 2 为波纹管' },
    { key: 'D2', label: '进气管段 2 内径', symbol: 'D_in2', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, required: true, description: '波纹管内径按波谷或名义内径取值，须与供应商定义一致' },
    { key: 'L2', label: '进气管段 2 长度', symbol: 'L_in2', unit: 'mm', unitGroup: 'length', default: 150, min: 0, required: true, description: '波纹管自由状态长度' },
    { key: 'K2', label: '进气管段 2 其它局部阻力系数', symbol: 'ΣK_2', unit: '-', unitGroup: 'dimensionless', default: 0.4, min: 0, required: true, description: '不含弯头的局部损失；波纹管弯曲安装时弯头系数取 0.5~0.8（比光滑管大）' },
    { key: 'bendN2', label: '进气管段 2 弯头规格', symbol: 'K_90', unit: '-', kind: 'select', options: [{ value: 0, label: '无弯头' }, { value: 1, label: '45°，R/D=1（0.18）' }, { value: 2, label: '45°，R/D=0.5（0.35）' }, { value: 3, label: '90°，R/D=2（0.25）' }, { value: 4, label: '90°，R/D=1（0.40）' }, { value: 5, label: '90°，R/D=0.5（1.00）' }, { value: 6, label: '90°直角/拼焊（1.30）' }], default: 0, required: true, description: '按式 6a 逐只计算弯头损失；波纹管弯曲时可比光滑管再放大 30%~60%' },
    { key: 'nb2', label: '进气管段 2 弯头只数', symbol: 'n', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, required: true, description: '该段弯头数量' },
    { key: 'h2', label: '进气管段 2 波纹波深', symbol: 'h', unit: 'mm', unitGroup: 'length', default: 4, min: 0, showIf: { key: 't2', min: 2, max: 2 }, description: '仅波纹管需要：波深 h，与波距 p 一起决定 f_c = f_s·[1 + k·(h/p)^m]' },
    { key: 'p2', label: '进气管段 2 波纹波距', symbol: 'p', unit: 'mm', unitGroup: 'length', default: 10, min: 0, showIf: { key: 't2', min: 2, max: 2 }, description: '仅波纹管需要：波距 p（自由状态），示例 h/p = 0.4' },
    { key: 'lkA2', label: '进气管段 2 编织壁有效开孔面积', symbol: 'A_h2', unit: 'mm²', unitGroup: 'area', default: 0, min: 0, showIf: { key: 't2', min: 3, max: 3 }, description: '仅编织管需要：壁面有效开孔面积，用于估算泄漏量（不计入压降）' },
    { key: 'rbn2', label: '进气管段 2 编织管弯曲半径', symbol: 'R_b2', unit: 'mm', unitGroup: 'length', default: 0, min: 0, showIf: { key: 't2', min: 3, max: 3 }, description: '仅编织管需要：弯曲半径 R_b，0 表示无弯曲；R_b/D < 3 时按式 9d/9e 放大 K 并折减有效面积' },

    { key: 't3', label: '进气管段 3 类型', symbol: '-', unit: '-', kind: 'select', options: [{ value: 1, label: '进气管' }, { value: 2, label: '波纹管' }, { value: 3, label: '编织管' }], default: 3, required: true, description: '示例段 3 为编织管' },
    { key: 'D3', label: '进气管段 3 内径', symbol: 'D_in3', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, required: true, description: '编织管内径' },
    { key: 'L3', label: '进气管段 3 长度', symbol: 'L_in3', unit: 'mm', unitGroup: 'length', default: 250, min: 0, required: true, description: '编织管长度' },
    { key: 'K3', label: '进气管段 3 其它局部阻力系数', symbol: 'ΣK_3', unit: '-', unitGroup: 'dimensionless', default: 0.3, min: 0, required: true, description: '不含弯头的局部损失；编织管弯曲时弯头 K 建议 ≥ 0.4' },
    { key: 'bendN3', label: '进气管段 3 弯头规格', symbol: 'K_90', unit: '-', kind: 'select', options: [{ value: 0, label: '无弯头' }, { value: 1, label: '45°，R/D=1（0.18）' }, { value: 2, label: '45°，R/D=0.5（0.35）' }, { value: 3, label: '90°，R/D=2（0.25）' }, { value: 4, label: '90°，R/D=1（0.40）' }, { value: 5, label: '90°，R/D=0.5（1.00）' }, { value: 6, label: '90°直角/拼焊（1.30）' }], default: 0, required: true, description: '按式 6a 逐只计算；急弯（R/D < 1）与入口损失叠加是进气阻力最容易被低估的部位' },
    { key: 'nb3', label: '进气管段 3 弯头只数', symbol: 'n', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, required: true, description: '该段弯头数量' },
    { key: 'h3', label: '进气管段 3 波纹波深', symbol: 'h', unit: 'mm', unitGroup: 'length', default: 4, min: 0, showIf: { key: 't3', min: 2, max: 2 }, description: '仅波纹管需要：波深 h' },
    { key: 'p3', label: '进气管段 3 波纹波距', symbol: 'p', unit: 'mm', unitGroup: 'length', default: 10, min: 0, showIf: { key: 't3', min: 2, max: 2 }, description: '仅波纹管需要：波距 p（自由状态）' },
    { key: 'lkA3', label: '进气管段 3 编织壁有效开孔面积', symbol: 'A_h3', unit: 'mm²', unitGroup: 'area', default: 0, min: 0, showIf: { key: 't3', min: 3, max: 3 }, description: '仅编织管需要：壁面有效开孔面积，用于估算泄漏量（不计入压降）；泄漏占总量 >2% 时需评估过滤效率与压降测量影响' },
    { key: 'rbn3', label: '进气管段 3 编织管弯曲半径', symbol: 'R_b3', unit: 'mm', unitGroup: 'length', default: 0, min: 0, showIf: { key: 't3', min: 3, max: 3 }, description: '仅编织管需要：弯曲半径 R_b；设计建议 R_b ≥ 3D，无法满足时按式 9d/9e 放大 K 并复核压降' },

    { key: 'ABox', label: '空滤器箱体流通面积', symbol: 'A_box', unit: 'm²', unitGroup: 'area', default: 0.00283, min: 0, required: true, description: '箱体入口截面面积，K_box 按此截面流速取动压；示例取与出气管截面相当（φ60 约 0.00283 m²）' },
    { key: 'KBox', label: '箱体局部阻力系数', symbol: 'ΣK_box', unit: '-', unitGroup: 'dimensionless', default: 0.5, min: 0, required: true, description: '箱体进口、出口、内部挡板等局部损失之和，通常 0.5~1.5' },
    { key: 'Af', label: '滤芯迎风面积', symbol: 'A_f', unit: 'm²', unitGroup: 'area', default: 0.25, min: 0, required: true, description: '滤材有效迎风面积，面速度 v_f = Q/A_f（示例 0.667 m/s）' },
    { key: 'aF', label: '滤芯压降线性系数', symbol: 'a', unit: 'Pa·s/m', default: 300, min: 0, required: true, description: 'ISO 5011 台架拟合的 Darcy 项系数（Pa·s/m），必须由本滤芯试验确定，不能套用其它滤芯' },
    { key: 'bF', label: '滤芯压降二次系数', symbol: 'b', unit: 'Pa·s²/m²', default: 800, min: 0, required: true, description: 'ISO 5011 台架拟合的惯性项系数（Pa·s²/m²）' },
    { key: 'mDust', label: '容尘量', symbol: 'm_dust', unit: 'g', default: 0, min: 0, required: true, description: '已积尘质量，初始状态取 0，终了状态按容尘试验值校核' },
    { key: 'kD', label: '容尘系数', symbol: 'k_d', unit: 'Pa/g', default: 0, min: 0, required: true, description: '容尘引起的压降增长率（Pa/g），由容尘试验确定；初始状态取 0' },

    { key: 'o1', label: '出气管段 1 类型', symbol: '-', unit: '-', kind: 'select', options: [{ value: 1, label: '出气管' }, { value: 2, label: '波纹管' }, { value: 3, label: '多腔穿孔消音器' }], default: 1, required: true, description: '出气管侧同样分 3 段，示例段 1 为出气管' },
    { key: 'Do1', label: '出气管段 1 内径', symbol: 'D_out1', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, required: true, description: '出气管段内径' },
    { key: 'Lo1', label: '出气管段 1 长度', symbol: 'L_out1', unit: 'mm', unitGroup: 'length', default: 400, min: 0, required: true, description: '出气管段长度' },
    { key: 'Ko1', label: '出气管段 1 其它局部阻力系数', symbol: 'ΣK_out1', unit: '-', unitGroup: 'dimensionless', default: 0.8, min: 0, required: true, description: '不含弯头的局部损失（节气门全开 0.1~0.3、变径等）；弯头由下面的「弯头规格 / 只数」按式 6a 计入' },
    { key: 'bendO1', label: '出气管段 1 弯头规格', symbol: 'K_90', unit: '-', kind: 'select', options: [{ value: 0, label: '无弯头' }, { value: 1, label: '45°，R/D=1（0.18）' }, { value: 2, label: '45°，R/D=0.5（0.35）' }, { value: 3, label: '90°，R/D=2（0.25）' }, { value: 4, label: '90°，R/D=1（0.40）' }, { value: 5, label: '90°，R/D=0.5（1.00）' }, { value: 6, label: '90°直角/拼焊（1.30）' }], default: 0, required: true, description: '按式 6a 逐只计算弯头损失' },
    { key: 'nbo1', label: '出气管段 1 弯头只数', symbol: 'n', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, required: true, description: '该段弯头数量' },
    { key: 'hO1', label: '出气管段 1 波纹波深', symbol: 'h', unit: 'mm', unitGroup: 'length', default: 4, min: 0, showIf: { key: 'o1', min: 2, max: 2 }, description: '仅波纹管需要：波深 h' },
    { key: 'pO1', label: '出气管段 1 波纹波距', symbol: 'p', unit: 'mm', unitGroup: 'length', default: 10, min: 0, showIf: { key: 'o1', min: 2, max: 2 }, description: '仅波纹管需要：波距 p（自由状态）' },
    { key: 'Db1', label: '出气管段 1 消音器本体内径', symbol: 'D_b1', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, showIf: { key: 'o1', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：本体（外壳）内径。大于穿孔管内径时自动按突扩 (1−A₁/A₂)² 与突缩 0.5(1−A₁/A₂) 计入局部损失；等径时为 0' },
    { key: 'Ah1', label: '出气管段 1 穿孔开孔总面积', symbol: 'A_h1', unit: 'mm²', unitGroup: 'area', default: 0, min: 0, showIf: { key: 'o1', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：穿孔管全部孔口的总面积，穿孔率 φ = A_h/(π·D·L) 用于摩擦放大 f_m = f_s·(1 + a·φ)；封闭腔无净穿流时孔口本身不计局部阻力' },
    { key: 'Cd1', label: '出气管段 1 孔口流量系数', symbol: 'C_d1', unit: '-', unitGroup: 'dimensionless', default: 0.7, min: 0, max: 1, showIf: { key: 'o1', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：孔口流量系数 0.6~0.8，用于孔口射流损失 (1/C_d² − 1)·ρv_h²/2' },
    { key: 'Qh1', label: '出气管段 1 穿流流量', symbol: 'Q_th1', unit: 'm³/s', unitGroup: 'volumeFlow', default: 0, min: 0, showIf: { key: 'o1', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：穿过孔口进入环腔的净流量。封闭环腔无净穿流取 0（孔口不计阻力）；回流式等有穿流结构按实际流量填写' },
    { key: 'phi1', label: '出气管段 1 弯曲段局部穿孔率', symbol: 'φ_b1', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, max: 1, showIf: { key: 'o1', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：弯曲段（约 90° 范围）孔面积与该段管内表面积之比。θ < 30° 且 φ_b < 0.1 时按光滑弯头 K 即可；θ ≥ 60° 且 φ_b > 0.2 时必须计入式 15c 的附加损失' },
    { key: 'kb1', label: '出气管段 1 隔板/挡板损失系数', symbol: 'ΣK_baf1', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, showIf: { key: 'o1', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：各腔隔板缩流损失之和，K = 0.5(1−A_b/A) + (1−A_b/A)²，典型 0.05~0.2/道；不缩流的环形挡板取 0.02~0.05' },

    { key: 'o2', label: '出气管段 2 类型', symbol: '-', unit: '-', kind: 'select', options: [{ value: 1, label: '出气管' }, { value: 2, label: '波纹管' }, { value: 3, label: '多腔穿孔消音器' }], default: 3, required: true, description: '示例段 2 为多腔穿孔消音器' },
    { key: 'Do2', label: '出气管段 2 内径', symbol: 'D_out2', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, required: true, description: '消音器穿孔管主体内径' },
    { key: 'Lo2', label: '出气管段 2 长度', symbol: 'L_out2', unit: 'mm', unitGroup: 'length', default: 200, min: 0, required: true, description: '穿孔管有效长度' },
    { key: 'Ko2', label: '出气管段 2 其它局部阻力系数', symbol: 'ΣK_out2', unit: '-', unitGroup: 'dimensionless', default: 0.4, min: 0, required: true, description: '消音器进出口 K_in,m + K_out,m（不含弯头与隔板）；本体直径大于主管时按突扩/突缩另加' },
    { key: 'bendO2', label: '出气管段 2 弯头规格', symbol: 'K_90', unit: '-', kind: 'select', options: [{ value: 0, label: '无弯头' }, { value: 1, label: '45°，R/D=1（0.18）' }, { value: 2, label: '45°，R/D=0.5（0.35）' }, { value: 3, label: '90°，R/D=2（0.25）' }, { value: 4, label: '90°，R/D=1（0.40）' }, { value: 5, label: '90°，R/D=0.5（1.00）' }, { value: 6, label: '90°直角/拼焊（1.30）' }], default: 0, required: true, description: '消音器弯曲 90° 时按式 15c 与弯曲段穿孔率 φ_b 联合修正；本项为同几何光滑弯头的 K_bend,0' },
    { key: 'nbo2', label: '出气管段 2 弯头只数', symbol: 'n', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, required: true, description: '该段弯头数量' },
    { key: 'hO2', label: '出气管段 2 波纹波深', symbol: 'h', unit: 'mm', unitGroup: 'length', default: 4, min: 0, showIf: { key: 'o2', min: 2, max: 2 }, description: '仅波纹管需要：波深 h' },
    { key: 'pO2', label: '出气管段 2 波纹波距', symbol: 'p', unit: 'mm', unitGroup: 'length', default: 10, min: 0, showIf: { key: 'o2', min: 2, max: 2 }, description: '仅波纹管需要：波距 p（自由状态）' },
    { key: 'Db2', label: '出气管段 2 消音器本体内径', symbol: 'D_b2', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, showIf: { key: 'o2', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：本体内径，大于穿孔管内径时自动计入突扩/突缩损失' },
    { key: 'Ah2', label: '出气管段 2 穿孔开孔总面积', symbol: 'A_h2', unit: 'mm²', unitGroup: 'area', default: 0, min: 0, showIf: { key: 'o2', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：全部孔口总面积，穿孔率 φ = A_h/(π·D·L) 用于摩擦放大 f_m = f_s·(1 + a·φ)' },
    { key: 'Cd2', label: '出气管段 2 孔口流量系数', symbol: 'C_d2', unit: '-', unitGroup: 'dimensionless', default: 0.7, min: 0, max: 1, showIf: { key: 'o2', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：孔口流量系数 0.6~0.8' },
    { key: 'Qh2', label: '出气管段 2 穿流流量', symbol: 'Q_th2', unit: 'm³/s', unitGroup: 'volumeFlow', default: 0, min: 0, showIf: { key: 'o2', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：穿过孔口的净流量，封闭环腔取 0' },
    { key: 'phi2', label: '出气管段 2 弯曲段局部穿孔率', symbol: 'φ_b2', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, max: 1, showIf: { key: 'o2', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：弯曲段局部穿孔率 φ_b；φ_b > 0.2 且弯角 ≥ 60° 时附加损失可达 0.5~2 倍动压' },
    { key: 'kb2', label: '出气管段 2 隔板/挡板损失系数', symbol: 'ΣK_baf2', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, showIf: { key: 'o2', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：多腔隔板缩流损失之和，典型 0.05~0.2/道' },

    { key: 'o3', label: '出气管段 3 类型', symbol: '-', unit: '-', kind: 'select', options: [{ value: 1, label: '出气管' }, { value: 2, label: '波纹管' }, { value: 3, label: '多腔穿孔消音器' }], default: 1, required: true, description: '未使用的段可将长度与局部阻力系数取 0' },
    { key: 'Do3', label: '出气管段 3 内径', symbol: 'D_out3', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, required: true, description: '出气管段内径' },
    { key: 'Lo3', label: '出气管段 3 长度', symbol: 'L_out3', unit: 'mm', unitGroup: 'length', default: 0, min: 0, required: true, description: '该段长度，未使用取 0' },
    { key: 'Ko3', label: '出气管段 3 其它局部阻力系数', symbol: 'ΣK_out3', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, required: true, description: '该段不含弯头的局部损失，未使用取 0' },
    { key: 'bendO3', label: '出气管段 3 弯头规格', symbol: 'K_90', unit: '-', kind: 'select', options: [{ value: 0, label: '无弯头' }, { value: 1, label: '45°，R/D=1（0.18）' }, { value: 2, label: '45°，R/D=0.5（0.35）' }, { value: 3, label: '90°，R/D=2（0.25）' }, { value: 4, label: '90°，R/D=1（0.40）' }, { value: 5, label: '90°，R/D=0.5（1.00）' }, { value: 6, label: '90°直角/拼焊（1.30）' }], default: 0, required: true, description: '按式 6a 逐只计算弯头损失' },
    { key: 'nbo3', label: '出气管段 3 弯头只数', symbol: 'n', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, required: true, description: '该段弯头数量' },
    { key: 'hO3', label: '出气管段 3 波纹波深', symbol: 'h', unit: 'mm', unitGroup: 'length', default: 4, min: 0, showIf: { key: 'o3', min: 2, max: 2 }, description: '仅波纹管需要：波深 h' },
    { key: 'pO3', label: '出气管段 3 波纹波距', symbol: 'p', unit: 'mm', unitGroup: 'length', default: 10, min: 0, showIf: { key: 'o3', min: 2, max: 2 }, description: '仅波纹管需要：波距 p（自由状态）' },
    { key: 'Db3', label: '出气管段 3 消音器本体内径', symbol: 'D_b3', unit: 'mm', unitGroup: 'diameter', default: 60, min: 0, showIf: { key: 'o3', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：本体内径，大于穿孔管内径时自动计入突扩/突缩损失' },
    { key: 'Ah3', label: '出气管段 3 穿孔开孔总面积', symbol: 'A_h3', unit: 'mm²', unitGroup: 'area', default: 0, min: 0, showIf: { key: 'o3', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：全部孔口总面积；封闭腔无净穿流时只作记录' },
    { key: 'Cd3', label: '出气管段 3 孔口流量系数', symbol: 'C_d3', unit: '-', unitGroup: 'dimensionless', default: 0.7, min: 0, max: 1, showIf: { key: 'o3', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：孔口流量系数 0.6~0.8' },
    { key: 'Qh3', label: '出气管段 3 穿流流量', symbol: 'Q_th3', unit: 'm³/s', unitGroup: 'volumeFlow', default: 0, min: 0, showIf: { key: 'o3', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：穿过孔口的净流量，封闭环腔取 0' },
    { key: 'phi3', label: '出气管段 3 弯曲段局部穿孔率', symbol: 'φ_b3', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, max: 1, showIf: { key: 'o3', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：弯曲段局部穿孔率 φ_b' },
    { key: 'kb3', label: '出气管段 3 隔板/挡板损失系数', symbol: 'ΣK_baf3', unit: '-', unitGroup: 'dimensionless', default: 0, min: 0, showIf: { key: 'o3', min: 3, max: 3 }, description: '仅多腔穿孔消音器需要：多腔隔板缩流损失之和，典型 0.05~0.2/道' },
  ],
  outputs: [
    { key: 'vIn', label: '入口截面流速', symbol: 'v_in', unit: 'm/s', unitGroup: 'velocity', digits: 2, group: '大气入口段', description: 'v_in = Q/(πD_in1²/4)，动压按此流速计算' },
    { key: 'dpEntrance', label: '大气入口段压降', symbol: 'Δp_entrance', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '大气入口段', primary: true, description: 'Δp = (1 + K_in)·(ρv_in²/2) − (ρV²/2) + p_bay' },
    { key: 'rhoUsed', label: '计算用空气密度', symbol: 'ρ', unit: 'kg/m³', unitGroup: 'density', digits: 4, group: '大气入口段', description: '方式 1 为输入值；方式 2 按 p(z)、T 与相对湿度计算（式 20~22）' },

    { key: 'dpIn1', label: '进气管段 1 压降', symbol: 'Δp_in1', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '进气管段', description: '[f·(L/D) + ΣK]·(ρv²/2)，按本段内径与类型计算' },
    { key: 'lk1', label: '进气管段 1 编织壁泄漏量', symbol: 'q_leak1', unit: 'm³/s', unitGroup: 'volumeFlow', digits: 5, group: '进气管段', showIf: { key: 't1', min: 3, max: 3 }, description: 'q = C_d·A_h·(2Δp/ρ)^(1/2)，不计入压降，仅用于评估过滤旁通' },
    { key: 'dpIn2', label: '进气管段 2 压降', symbol: 'Δp_in2', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '进气管段', description: '波纹管按 f_c = f_s·[1 + k·(h/p)^m]；未给波深/波距时退回 C_c·f_s' },
    { key: 'lk2', label: '进气管段 2 编织壁泄漏量', symbol: 'q_leak2', unit: 'm³/s', unitGroup: 'volumeFlow', digits: 5, group: '进气管段', showIf: { key: 't2', min: 3, max: 3 }, description: 'q = C_d·A_h·(2Δp/ρ)^(1/2)，不计入压降' },
    { key: 'dpIn3', label: '进气管段 3 压降', symbol: 'Δp_in3', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '进气管段', description: '编织管按 ε_b 的粗糙管计算；弯曲时按式 9d/9e 放大 K 并以 A_eff 重算流速' },
    { key: 'lk3', label: '进气管段 3 编织壁泄漏量', symbol: 'q_leak3', unit: 'm³/s', unitGroup: 'volumeFlow', digits: 5, group: '进气管段', showIf: { key: 't3', min: 3, max: 3 }, description: 'q = C_d·A_h·(2Δp/ρ)^(1/2)；泄漏占总量 >2% 时需评估过滤效率影响' },

    { key: 'dpBox', label: '空滤器箱体压降', symbol: 'Δp_box', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '空滤器', description: 'ΣK_box·(ρv_box²/2)，v_box = Q/A_box' },
    { key: 'dpFilter', label: '滤芯压降', symbol: 'Δp_f', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '空滤器', description: 'a·v_f + b·v_f²，v_f = Q/A_f（未含容尘）' },
    { key: 'dpAirbox', label: '空滤器总压降', symbol: 'Δp_airbox', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '空滤器', primary: true, description: '箱体 + 滤芯 + 容尘（k_d·m_dust）' },

    { key: 'dpOut1', label: '出气管段 1 压降', symbol: 'Δp_out1', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '出气管段', description: '出气管段按各自类型计算' },
    { key: 'dpJet1', label: '出气管段 1 孔口射流损失', symbol: 'Δp_jet1', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '出气管段', showIf: { key: 'o1', min: 3, max: 3 }, description: '(1/C_d² − 1)·(ρv_h²/2)，v_h = Q_th/A_h；封闭环腔无穿流时为 0' },
    { key: 'dpOut2', label: '出气管段 2 压降', symbol: 'Δp_out2', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '出气管段', description: '穿孔消音器按 f_m = f_s·(1 + a·φ) 的摩擦 + 进出口 K + 隔板 K + 突扩/突缩' },
    { key: 'dpJet2', label: '出气管段 2 孔口射流损失', symbol: 'Δp_jet2', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '出气管段', showIf: { key: 'o2', min: 3, max: 3 }, description: '(1/C_d² − 1)·(ρv_h²/2)，封闭环腔无净穿流时为 0' },
    { key: 'dpOut3', label: '出气管段 3 压降', symbol: 'Δp_out3', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '出气管段', description: '未使用段（L、K 取 0）结果为 0' },
    { key: 'dpJet3', label: '出气管段 3 孔口射流损失', symbol: 'Δp_jet3', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '出气管段', showIf: { key: 'o3', min: 3, max: 3 }, description: '(1/C_d² − 1)·(ρv_h²/2)，封闭环腔无净穿流时为 0' },
    { key: 'phiA1', label: '出气管段 1 穿孔率', symbol: 'φ₁', unit: '-', unitGroup: 'dimensionless', digits: 4, group: '出气管段', showIf: { key: 'o1', min: 3, max: 3 }, description: 'φ = A_h/(π·D·L)，用于 f_m = f_s·(1 + a·φ)；L 为 0 时为 0' },
    { key: 'phiA2', label: '出气管段 2 穿孔率', symbol: 'φ₂', unit: '-', unitGroup: 'dimensionless', digits: 4, group: '出气管段', showIf: { key: 'o2', min: 3, max: 3 }, description: 'φ = A_h/(π·D·L)' },
    { key: 'phiA3', label: '出气管段 3 穿孔率', symbol: 'φ₃', unit: '-', unitGroup: 'dimensionless', digits: 4, group: '出气管段', showIf: { key: 'o3', min: 3, max: 3 }, description: 'φ = A_h/(π·D·L)' },
    { key: 'dpB1', label: '出气管段 1 弯曲开孔附加损失', symbol: 'Δp_bend1', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '出气管段', showIf: { key: 'o1', min: 3, max: 3 }, description: '式 15b/15c：K_bend,perf 相对光滑弯头 K_bend,0 的增量乘以动压；无弯曲或 φ_b = 0 时为 0' },
    { key: 'dpB2', label: '出气管段 2 弯曲开孔附加损失', symbol: 'Δp_bend2', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '出气管段', showIf: { key: 'o2', min: 3, max: 3 }, description: '式 15b/15c：弯曲段整片开孔带来的「冲击 + 腔体交换」附加损失' },
    { key: 'dpB3', label: '出气管段 3 弯曲开孔附加损失', symbol: 'Δp_bend3', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '出气管段', showIf: { key: 'o3', min: 3, max: 3 }, description: '式 15b/15c：无弯曲或 φ_b = 0 时为 0' },

    { key: 'dpTotal', label: '系统总阻力', symbol: 'Δp_sys', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '汇总', primary: true, description: '入口段 + 进气管 3 段 + 空滤器 + 出气管 3 段之和' },
    { key: 'Mmax', label: '最大马赫数', symbol: 'M_max', unit: '-', unitGroup: 'dimensionless', digits: 3, group: '汇总', description: '各段 M = v/c 的最大值；M > 0.3 需做可压缩修正，M > 0.6 需 Fanno/CFD 并校核堵塞' },
    { key: 'dpComp', label: '可压缩修正后总阻力', symbol: 'Δp_comp', unit: 'Pa', unitGroup: 'pressure', digits: 0, group: '汇总', description: 'Δp_comp ≈ Δp_sys·(1 + M_max²/4)，M > 0.5 时误差变大，应逐段迭代 p、ρ、v' },
    { key: 'S', label: '系统阻力系数', symbol: 'S', unit: 'Pa·s²/m³', digits: 4, group: '汇总', description: 'S = Δp_sys/Q²，用于绘制 Δp = S·Q² 曲线并与发动机需求曲线匹配' },
  ],
  latex: [
    { label: '系统总阻力（各段串联求和）', tex: '\\Delta p_{sys} = \\Delta p_{entrance} + \\sum_{i=1}^{3}\\Delta p_{in,i} + \\Delta p_{airbox} + \\sum_{i=1}^{3}\\Delta p_{out,i}' },
    { label: '流速与流通面积', tex: 'v = \\frac{Q}{A},\\qquad A = \\frac{\\pi D^{2}}{4}' },
    { label: '雷诺数', tex: 'Re = \\frac{\\rho v D}{\\mu}' },
    { label: '通用段阻力（沿程摩擦 + 局部阻力）', tex: '\\Delta p = \\left[ f\\,\\frac{L}{D} + \\sum K \\right]\\cdot\\frac{\\rho v^{2}}{2}' },
    { label: '达西摩擦因子（Swamee-Jain 显式解）', tex: 'f = \\frac{0.25}{\\left\\{\\lg\\left[\\dfrac{\\varepsilon}{3.7D} + \\dfrac{5.74}{Re^{0.9}}\\right]\\right\\}^{2}}' },
    { label: '弯头损失（逐只计算，式 6a/6b）', tex: 'K_{bend} = n\\cdot K_{90}\\!\\left(\\frac{R}{D}\\right)\\cdot\\left(\\frac{\\theta}{90^{\\circ}}\\right)^{0.8\\sim 1.2}' },
    { label: '进气管段 1：波纹管（几何相关摩擦放大，式 7）', tex: 'f_c = f_s\\left[1 + k\\left(\\frac{h}{p}\\right)^{m}\\right],\\qquad \\Delta p = \\left[f_c\\frac{L}{D} + \\Sigma K\\right]\\frac{\\rho v^{2}}{2}', showIf: { key: 't1', min: 2, max: 2 } },
    { label: '进气管段 1：编织管（弯曲修正 + 壁面泄漏，式 9a/9d/9e）', tex: 'K_{br} = K\\left[1 + c_b\\frac{D}{R_b}\\right],\\quad A_{eff} = A\\left(1 - 0.1\\frac{D}{R_b}\\right),\\quad q_{leak} = C_d A_h\\sqrt{\\frac{2\\Delta p}{\\rho}}', showIf: { key: 't1', min: 3, max: 3 } },
    { label: '进气管段 2：波纹管（几何相关摩擦放大，式 7）', tex: 'f_c = f_s\\left[1 + k\\left(\\frac{h}{p}\\right)^{m}\\right],\\qquad \\Delta p = \\left[f_c\\frac{L}{D} + \\Sigma K\\right]\\frac{\\rho v^{2}}{2}', showIf: { key: 't2', min: 2, max: 2 } },
    { label: '进气管段 2：编织管（弯曲修正 + 壁面泄漏，式 9a/9d/9e）', tex: 'K_{br} = K\\left[1 + c_b\\frac{D}{R_b}\\right],\\quad A_{eff} = A\\left(1 - 0.1\\frac{D}{R_b}\\right),\\quad q_{leak} = C_d A_h\\sqrt{\\frac{2\\Delta p}{\\rho}}', showIf: { key: 't2', min: 3, max: 3 } },
    { label: '进气管段 3：波纹管（几何相关摩擦放大，式 7）', tex: 'f_c = f_s\\left[1 + k\\left(\\frac{h}{p}\\right)^{m}\\right],\\qquad \\Delta p = \\left[f_c\\frac{L}{D} + \\Sigma K\\right]\\frac{\\rho v^{2}}{2}', showIf: { key: 't3', min: 2, max: 2 } },
    { label: '进气管段 3：编织管（弯曲修正 + 壁面泄漏，式 9a/9d/9e）', tex: 'K_{br} = K\\left[1 + c_b\\frac{D}{R_b}\\right],\\quad A_{eff} = A\\left(1 - 0.1\\frac{D}{R_b}\\right),\\quad q_{leak} = C_d A_h\\sqrt{\\frac{2\\Delta p}{\\rho}}', showIf: { key: 't3', min: 3, max: 3 } },
    { label: '出气管段 1：波纹管（几何相关摩擦放大，式 7）', tex: 'f_c = f_s\\left[1 + k\\left(\\frac{h}{p}\\right)^{m}\\right],\\qquad \\Delta p = \\left[f_c\\frac{L}{D} + \\Sigma K\\right]\\frac{\\rho v^{2}}{2}', showIf: { key: 'o1', min: 2, max: 2 } },
    { label: '出气管段 2：波纹管（几何相关摩擦放大，式 7）', tex: 'f_c = f_s\\left[1 + k\\left(\\frac{h}{p}\\right)^{m}\\right],\\qquad \\Delta p = \\left[f_c\\frac{L}{D} + \\Sigma K\\right]\\frac{\\rho v^{2}}{2}', showIf: { key: 'o2', min: 2, max: 2 } },
    { label: '出气管段 3：波纹管（几何相关摩擦放大，式 7）', tex: 'f_c = f_s\\left[1 + k\\left(\\frac{h}{p}\\right)^{m}\\right],\\qquad \\Delta p = \\left[f_c\\frac{L}{D} + \\Sigma K\\right]\\frac{\\rho v^{2}}{2}', showIf: { key: 'o3', min: 2, max: 2 } },
    { label: '出气管段 1：多腔穿孔消音器（穿孔率摩擦放大 + 局损，式 15/15a）', tex: 'f_m = f_s\\left(1 + a\\varphi\\right),\\quad \\varphi = \\frac{A_h}{\\pi D L},\\qquad \\Delta p_m = \\left[f_m\\frac{L}{D} + K_{in,m} + K_{out,m} + \\Sigma K_{baf} + K_{geo}\\right]\\frac{\\rho v^{2}}{2},\\quad K_{geo} = \\left(1-\\frac{A_1}{A_2}\\right)^{2} + 0.5\\left(1-\\frac{A_1}{A_2}\\right)', showIf: { key: 'o1', min: 3, max: 3 } },
    { label: '出气管段 2：多腔穿孔消音器（穿孔率摩擦放大 + 局损，式 15/15a）', tex: 'f_m = f_s\\left(1 + a\\varphi\\right),\\quad \\varphi = \\frac{A_h}{\\pi D L},\\qquad \\Delta p_m = \\left[f_m\\frac{L}{D} + K_{in,m} + K_{out,m} + \\Sigma K_{baf} + K_{geo}\\right]\\frac{\\rho v^{2}}{2},\\quad K_{geo} = \\left(1-\\frac{A_1}{A_2}\\right)^{2} + 0.5\\left(1-\\frac{A_1}{A_2}\\right)', showIf: { key: 'o2', min: 3, max: 3 } },
    { label: '出气管段 3：多腔穿孔消音器（穿孔率摩擦放大 + 局损，式 15/15a）', tex: 'f_m = f_s\\left(1 + a\\varphi\\right),\\quad \\varphi = \\frac{A_h}{\\pi D L},\\qquad \\Delta p_m = \\left[f_m\\frac{L}{D} + K_{in,m} + K_{out,m} + \\Sigma K_{baf} + K_{geo}\\right]\\frac{\\rho v^{2}}{2},\\quad K_{geo} = \\left(1-\\frac{A_1}{A_2}\\right)^{2} + 0.5\\left(1-\\frac{A_1}{A_2}\\right)', showIf: { key: 'o3', min: 3, max: 3 } },
    { label: '出气管段 1：穿孔弯头附加损失（式 15b/15c/15d）', tex: 'K_{bend,perf} = K_{bend,0}\\left[1 + c_1\\frac{\\theta}{90^{\\circ}}\\varphi_b\\right] + c_2\\left(\\frac{\\theta}{90^{\\circ}}\\right)^{2}\\frac{\\varphi_b}{1-\\varphi_b},\\qquad \\Delta p_{bend} = K_{bend,perf}\\frac{\\rho v^{2}}{2}', showIf: { key: 'o1', min: 3, max: 3 } },
    { label: '出气管段 2：穿孔弯头附加损失（式 15b/15c/15d）', tex: 'K_{bend,perf} = K_{bend,0}\\left[1 + c_1\\frac{\\theta}{90^{\\circ}}\\varphi_b\\right] + c_2\\left(\\frac{\\theta}{90^{\\circ}}\\right)^{2}\\frac{\\varphi_b}{1-\\varphi_b},\\qquad \\Delta p_{bend} = K_{bend,perf}\\frac{\\rho v^{2}}{2}', showIf: { key: 'o2', min: 3, max: 3 } },
    { label: '出气管段 3：穿孔弯头附加损失（式 15b/15c/15d）', tex: 'K_{bend,perf} = K_{bend,0}\\left[1 + c_1\\frac{\\theta}{90^{\\circ}}\\varphi_b\\right] + c_2\\left(\\frac{\\theta}{90^{\\circ}}\\right)^{2}\\frac{\\varphi_b}{1-\\varphi_b},\\qquad \\Delta p_{bend} = K_{bend,perf}\\frac{\\rho v^{2}}{2}', showIf: { key: 'o3', min: 3, max: 3 } },
    { label: '出气管段 1：孔口射流损失（穿流结构）', tex: '\\Delta p_{jet} = \\left(\\frac{1}{C_d^{2}}-1\\right)\\frac{\\rho v_h^{2}}{2},\\qquad v_h = \\frac{Q_{th}}{A_h}', showIf: { key: 'o1', min: 3, max: 3 } },
    { label: '出气管段 2：孔口射流损失（穿流结构）', tex: '\\Delta p_{jet} = \\left(\\frac{1}{C_d^{2}}-1\\right)\\frac{\\rho v_h^{2}}{2},\\qquad v_h = \\frac{Q_{th}}{A_h}', showIf: { key: 'o2', min: 3, max: 3 } },
    { label: '出气管段 3：孔口射流损失（穿流结构）', tex: '\\Delta p_{jet} = \\left(\\frac{1}{C_d^{2}}-1\\right)\\frac{\\rho v_h^{2}}{2},\\qquad v_h = \\frac{Q_{th}}{A_h}', showIf: { key: 'o3', min: 3, max: 3 } },
    { label: '空滤器阻力（箱体 + 滤芯 + 容尘）', tex: '\\Delta p_{airbox} = \\sum K_{box}\\frac{\\rho v_{box}^{2}}{2} + \\left(a\\,v_f + b\\,v_f^{2}\\right) + k_d\\, m_{dust},\\qquad v_f = \\frac{Q}{A_f}' },
    { label: '大气入口段压降（含车速冲压与舱内负压）', tex: '\\Delta p_{entrance} = \\left(1 + K_{in}\\right)\\frac{\\rho v_{in}^{2}}{2} - \\frac{\\rho V^{2}}{2} + p_{bay}' },
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
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= 24; i++) {
        const q = base * (0.1 + (i * 1.5) / 24); // 10% ~ 160% 额定流量
        const r = intakeSystemResistance.solve({ ...v, Q: q });
        const dp = r.dpTotal;
        if (Number.isFinite(dp)) pts.push({ x: q * 3600, y: dp });
      }
      return pts;
    },
  },
  sensitivity: true,
  assumptions: [
    '公式与新版《进气系统分部件阻力计算（进气管-波纹管-编织管-空滤器-出气管-消音器）》一致；算例（Q = 600 m³/h、20 ℃、ρ = 1.205 kg/m³）各段与本公式的对比为：进气管 478 vs 485 Pa、波纹管 1082 vs 1049 Pa（本文按 h/p = 0.4、k = 4、m = 1.35 得 f_c ≈ 0.040，文档表取 f_c = 0.047）、编织管 819 vs 832 Pa、空滤器 1601 vs 1600 Pa、出气管 1923 vs 1935 Pa、消音器 986 vs 1030 Pa（文档表取 f = 0.022，本公式按 ε_m = 0.2 mm 得 f ≈ 0.028）；文档六段合计 6889 Pa 不含大气入口段，本公式再加入口段后台架静止约 8118 Pa',
    '弯头按式 6a/6b 逐只计算：K_bend = n·K_90(R/D)·(θ/90°)^0.8~1.2，规格下拉已内置 45°/R/D=1 0.18、45°/R/D=0.5 0.35、90°/R/D=2 0.25、90°/R/D=1 0.40、90°/R/D=0.5 1.00、90° 直角/拼焊 1.30；本公式取指数 1.0。Re < 10⁵ 或相邻弯头间距 < 5D 时应再乘 1.1~1.3，该放大需用户自行并入弯头规格系数或 ΣK',
    '波纹管摩擦按式 7：f_c = f_s·[1 + k·(h/p)^m]，k = 3~5、m = 1.2~1.5；h 或 p 未填写（为 0）时退回 C_c·f_s（C_c = 1.5~2.5）。轴向拉伸后波距变大、f_c 下降 5%~15%，设计按自由状态波距取值',
    '编织管按式 9a/9d/9e 计算：摩擦用 ε_b = 0.05~0.30 mm 的粗糙管；弯曲时弯头系数 K 增 c_b·D/R_b（c_b = 0.4~0.6），有效面积 A_eff = A·(1 − 0.1·D/R_b)，流速与动压按 A_eff 重算；R_b/D ≥ 3 时附加可忽略',
    '多腔穿孔消音器按式 15/15a：穿孔率 φ = A_h/(π·D·L)（A_h 为穿孔段孔口总面积，L 为穿孔段长度），摩擦按 f_m = f_s·(1 + a·φ) 放大，a = 0.5~1.5、无试验数据取 1.0；另计进出口 K、隔板 ΣK_baf 与本体突扩/突缩',
    '穿孔弯头按式 15b/15c 计算附加损失：K_bend,perf = K_bend,0·[1 + c1·(θ/90°)·φ_b] + c2·(θ/90°)²·φ_b/(1 − φ_b)，c1 = 1~2、c2 = 0.5~1.5；θ < 30° 且 φ_b < 0.1 时可直接把 φ_b 取 0 按光滑弯头计算，θ ≥ 60° 且 φ_b > 0.2 必须计入',
    '空气密度可选直接输入或按式 20~22 计算：ρ = p/(R_d·T)·(1 − 0.378·p_v/p)，p = p0·(1 − 2.2557×10⁻⁵·z)^5.2559，p_v = RH·p_sat，p_sat 按 Buck 公式；系统内仍用同一密度，各段温度不同时应逐段按当地密度修正',
    '按不可压缩流处理，各段流速与动压按该段内径计算；增压机型出气管（60~80 ℃）须按 Δp₂ = Δp₁·(ρ₂/ρ₁) 修正',
    '摩擦因子用 Swamee-Jain 显式解代替 Colebrook 迭代，Re > 1000 时误差 < 1%；波纹管用式 7 放大、编织管与穿孔管用等效粗糙度近似',
    '空滤器滤芯系数 a、b 必须由本滤芯的 ISO 5011 台架试验拟合，不能套用其它滤芯；k_d 由容尘试验确定，设计时按「初始」与「终了」两种状态分别校核',
    '消音器环腔为封闭腔、无净穿流，孔口不计射流损失；若结构存在穿流（如回流式），须另填 Q_th 并按 Δp_jet = (1/C_d² − 1)·ρv_h²/2 计算',
    '编织管壁面孔隙泄漏量 q = C_d·A_h·(2Δp/ρ)^(1/2) 只作旁通评估，不计入系统压降；泄漏占总量 >2% 时须评估对过滤效率与压降测量的影响',
    '大气入口段按 (1 + K_in)·(ρv²/2) − (ρV²/2) + p_bay 计算，即同时计入「加速到管内流速所需的动压」与「入口几何局部损失」；此段以进气管段 1 的内径与流速为基准',
    '马赫数修正采用 Δp_comp ≈ Δp_sys·(1 + M²/4)：M < 0.5 时误差约 3%，M > 0.6 应改用一维气体动力学（Fanno/等温流）或 CFD，并做堵塞校核',
    '一维计算用于方案筛选与管径/弯头优化，定型前须做 CFD 稳态/瞬态或整机台架验证',
  ],
  solve(v) {
    const empty = {
      vIn: NaN, dpEntrance: NaN,
      dpIn1: NaN, dpIn2: NaN, dpIn3: NaN,
      dpBox: NaN, dpFilter: NaN, dpAirbox: NaN,
      dpOut1: NaN, dpOut2: NaN, dpOut3: NaN,
      dpJet1: NaN, dpJet2: NaN, dpJet3: NaN,
      dpB1: NaN, dpB2: NaN, dpB3: NaN, phiA1: NaN, phiA2: NaN, phiA3: NaN,
      rhoUsed: NaN,
      lk1: NaN, lk2: NaN, lk3: NaN,
      dpTotal: NaN, Mmax: NaN, dpComp: NaN, S: NaN,
    };

    const segOk = (D: number, L: number, K: number) =>
      Number.isFinite(D) && D > 0 && Number.isFinite(L) && L >= 0 && Number.isFinite(K) && K >= 0;

    const num = (x: number, min = 0) => Number.isFinite(x) && x >= min;
    const bendOk = (o: number, n: number) => Number.isInteger(o) && o >= 0 && o <= 6 && num(n);
    const phiOk = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1;

    if (!(v.Q > 0) || !(v.mu > 0) || !(v.T > 0) || !num(v.V) || !num(v.Kin) || !Number.isFinite(v.pBay) ||
        !(v.rhoMode === 2 ? num(v.z) && phiOk(v.RH) : v.rho > 0) ||
        !num(v.epsS) || !num(v.Cc, 1) || !num(v.kBell) || !num(v.mBell) || !num(v.epsB) || !num(v.cb) ||
        !num(v.epsM) || !num(v.aPerf) || !num(v.c1) || !num(v.c2) || !num(v.CdLeak) ||
        !(v.ABox > 0) || !num(v.KBox) || !(v.Af > 0) ||
        !num(v.aF) || !num(v.bF) || !num(v.mDust) || !num(v.kD) ||
        !segOk(v.D1, v.L1, v.K1) || !segOk(v.D2, v.L2, v.K2) || !segOk(v.D3, v.L3, v.K3) ||
        !segOk(v.Do1, v.Lo1, v.Ko1) || !segOk(v.Do2, v.Lo2, v.Ko2) || !segOk(v.Do3, v.Lo3, v.Ko3) ||
        !bendOk(v.bendN1, v.nb1) || !bendOk(v.bendN2, v.nb2) || !bendOk(v.bendN3, v.nb3) ||
        !bendOk(v.bendO1, v.nbo1) || !bendOk(v.bendO2, v.nbo2) || !bendOk(v.bendO3, v.nbo3) ||
        !num(v.h1) || !num(v.p1) || !num(v.h2) || !num(v.p2) || !num(v.h3) || !num(v.p3) ||
        !num(v.hO1) || !num(v.pO1) || !num(v.hO2) || !num(v.pO2) || !num(v.hO3) || !num(v.pO3) ||
        !num(v.lkA1) || !num(v.lkA2) || !num(v.lkA3) || !num(v.rbn1) || !num(v.rbn2) || !num(v.rbn3) ||
        !(v.Db1 > 0) || !num(v.Ah1) || !(v.Cd1 > 0) || !num(v.Qh1) || !phiOk(v.phi1) || !num(v.kb1) ||
        !(v.Db2 > 0) || !num(v.Ah2) || !(v.Cd2 > 0) || !num(v.Qh2) || !phiOk(v.phi2) || !num(v.kb2) ||
        !(v.Db3 > 0) || !num(v.Ah3) || !(v.Cd3 > 0) || !num(v.Qh3) || !phiOk(v.phi3) || !num(v.kb3))
      return empty;

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

    type SegOpt = { h?: number; p?: number; rb?: number; ah?: number; phiB?: number; kb?: number; Db?: number };

    const seg = (type: number, D: number, L: number, K: number, bend: number, nb: number, opt: SegOpt, side: 'in' | 'out') => {
      const A0 = (Math.PI * D * D) / 4;
      const eps = type === 3 ? (side === 'in' ? v.epsB : v.epsM) : v.epsS;
      let Aeff = A0;
      let kBendAmp = 1;
      if (side === 'in' && type === 3 && opt.rb! > 0) {
        const ratio = D / opt.rb!;
        Aeff = Math.max(A0 * (1 - 0.1 * ratio), 0.5 * A0);
        kBendAmp = 1 + v.cb * ratio;
      }
      const vel = Q / Aeff;
      const Re = (rho * vel * D) / mu;
      let mult = 1;
      if (type === 2) {
        const hp = opt.h! > 0 && opt.p! > 0 ? opt.h! / opt.p! : 0;
        mult = hp > 0 ? 1 + v.kBell * Math.pow(hp, v.mBell) : v.Cc;
      }
      let phi = 0;
      if (side === 'out' && type === 3) {
        phi = L > 0 && opt.ah! > 0 ? opt.ah! / (Math.PI * D * L) : 0;
        mult = 1 + v.aPerf * phi;
      }
      const f = fric(Re, eps, D) * mult;
      const b = K90[bend] ?? K90[0];
      const th = b.th / 90;
      const pb = side === 'out' && type === 3 ? Math.min(opt.phiB ?? 0, 0.95) : 0;
      const kSmooth = b.k * (1 + v.c1 * th * pb) + v.c2 * th * th * (pb / (1 - pb));
      const kPer = kSmooth * kBendAmp;
      const nBend = nb > 0 ? nb : 0;
      const kJoint = K + nBend * kPer + (side === 'out' && type === 3 ? kGeo(opt.Db!, D) + (opt.kb ?? 0) : 0);
      const qDyn = 0.5 * rho * vel * vel;
      const dp = (f * (L / D) + kJoint) * qDyn;
      const dpB = nBend * (kSmooth - b.k) * qDyn;
      return { vel, M: vel / Math.sqrt(gamma * R * v.T), dp, dpB, phi };
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

    const s1 = seg(v.t1, v.D1, v.L1, v.K1, v.bendN1, v.nb1, { h: v.h1, p: v.p1, rb: v.rbn1 }, 'in');
    const s2 = seg(v.t2, v.D2, v.L2, v.K2, v.bendN2, v.nb2, { h: v.h2, p: v.p2, rb: v.rbn2 }, 'in');
    const s3 = seg(v.t3, v.D3, v.L3, v.K3, v.bendN3, v.nb3, { h: v.h3, p: v.p3, rb: v.rbn3 }, 'in');
    const s4 = seg(v.o1, v.Do1, v.Lo1, v.Ko1, v.bendO1, v.nbo1,
      { h: v.hO1, p: v.pO1, ah: v.Ah1, phiB: v.phi1, kb: v.kb1, Db: v.Db1 }, 'out');
    const s5 = seg(v.o2, v.Do2, v.Lo2, v.Ko2, v.bendO2, v.nbo2,
      { h: v.hO2, p: v.pO2, ah: v.Ah2, phiB: v.phi2, kb: v.kb2, Db: v.Db2 }, 'out');
    const s6 = seg(v.o3, v.Do3, v.Lo3, v.Ko3, v.bendO3, v.nbo3,
      { h: v.hO3, p: v.pO3, ah: v.Ah3, phiB: v.phi3, kb: v.kb3, Db: v.Db3 }, 'out');

    const dpJet1 = v.o1 === 3 ? jetDp(v.Qh1, v.Ah1, v.Cd1) : 0;
    const dpJet2 = v.o2 === 3 ? jetDp(v.Qh2, v.Ah2, v.Cd2) : 0;
    const dpJet3 = v.o3 === 3 ? jetDp(v.Qh3, v.Ah3, v.Cd3) : 0;

    const lk1 = v.t1 === 3 ? leakQ(v.lkA1, s1.dp) : 0;
    const lk2 = v.t2 === 3 ? leakQ(v.lkA2, s2.dp) : 0;
    const lk3 = v.t3 === 3 ? leakQ(v.lkA3, s3.dp) : 0;

    // 大气入口段：以进气管段 1 截面为基准，计入车速冲压与舱内负压
    const vIn = s1.vel;
    const dpEntrance = (1 + v.Kin) * 0.5 * rho * vIn * vIn - 0.5 * rho * v.V * v.V + v.pBay;

    // 空滤器：箱体局部阻力 + 滤芯多孔介质阻力 + 容尘
    const vBox = Q / v.ABox;
    const dpBox = v.KBox * 0.5 * rho * vBox * vBox;
    const vf = Q / v.Af;
    const dpFilter = v.aF * vf + v.bF * vf * vf;
    const dpAirbox = dpBox + dpFilter + v.kD * v.mDust;

    const dpTotal =
      dpEntrance + s1.dp + s2.dp + s3.dp + dpAirbox +
      s4.dp + s5.dp + s6.dp + dpJet1 + dpJet2 + dpJet3;

    const Mmax = Math.max(s1.M, s2.M, s3.M, s4.M, s5.M, s6.M);
    const dpComp = dpTotal * (1 + (Mmax * Mmax) / 4);
    const S = dpTotal / (Q * Q);

    return {
      vIn,
      dpEntrance,
      dpIn1: s1.dp, dpIn2: s2.dp, dpIn3: s3.dp,
      lk1, lk2, lk3,
      dpBox, dpFilter, dpAirbox,
      dpOut1: s4.dp, dpOut2: s5.dp, dpOut3: s6.dp,
      dpJet1, dpJet2, dpJet3,
      dpB1: s4.dpB, dpB2: s5.dpB, dpB3: s6.dpB,
      phiA1: s4.phi, phiA2: s5.phi, phiA3: s6.phi,
      rhoUsed: rho,
      dpTotal, Mmax, dpComp, S,
    };
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
  ],
};
