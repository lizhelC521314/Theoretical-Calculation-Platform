import type { FormulaSpec } from '../../formula/types';
import { INTAKE_HOSE_DIAGRAM } from './diagrams';

/**
 * 乘用车橡胶进气软管（波纹管）设计
 *
 * 按参考文档《乘用车橡胶进气软管设计计算公式与输入参数（管壁辐射版）》
 * （依据 SAE J20 / SAE J200、GB/T 3683、ISO 6803、Munjal 管道声学）实现五类计算：
 *   几何与材料  A = πDt，I = πD³t/8，S = πDL，m″ = ρt
 *   耐压与爆破  σθ = pD/(2t)，σz = pD/(4t)，pb = 2tσb/D，
 *               pcr = [2E/(1−ν²)](t/D)³·CL
 *   刚度与隔振  kax = EA/L，kb = 3EI/L³，
 *               fn = (1/2π)√(kax/M)，Tr = √{[1+(2ζr)²]/[(1−r²)²+(2ζr)²]}，R = −20lgTr
 *   流动压降    Re = ρ0vD/μ，f = 64/Re 或 0.3164/Re^0.25，
 *               Δp = (kf·f·L/D + ΣK)·ρ0v²/2
 *   管壁声辐射  cL = √{E/[ρ(1−ν²)]}，fr = cL/(πD)，ka = 2πf·a/c0，
 *               σrad 分低/高环频率两支，W = ρ0c0Sσrad⟨v²⟩，LW = 10lg(W/10⁻¹²)
 *   卡箍连接    Fc = πDbpc/μf
 */
export const intakeHose: FormulaSpec = {
  id: 'structure.intakeHose',
  domain: 'structure',
  subsystem: '进气系统',
  title: '橡胶进气软管（波纹管）设计',
  summary: '进气软管五类校核：壁厚耐压与真空吸扁、刚度与隔振率、流动压降、管壁声辐射、卡箍密封，覆盖直段与波纹段组合的橡胶软管。',
  tags: ['进气软管', '波纹管', '橡胶软管', 'EPDM', '壁厚', '爆破压力', '真空吸扁', '隔振', '传递率', '压降', '管壁声辐射', '卡箍', 'SAE J20', 'NVH', '结构设计'],
  description:
    '乘用车橡胶进气软管（EPDM / NBR-PVC，常带涤纶或芳纶增强层）的五类设计校核：1) 几何与材料——管壁截面积 A = πDt、截面惯性矩 I = πD³t/8、内表面积 S = πDL、面密度 m″ = ρt；2) 耐压——环向应力 σθ = pD/(2t)、轴向应力 σz = pD/(4t)，安全系数 n = σb/σθ 应取 2~3，爆破压力 pb = 2tσb/D 应达工作压力的 3~5 倍，真空塌陷临界外压 pcr = [2E/(1−ν²)](t/D)³·CL 应达最大真空度的 1.5~2 倍；3) 刚度与隔振——轴向刚度 kax = EA/L、弯曲刚度 kb = 3EI/L³，固有频率 fn = (1/2π)√(kax/M)，按传递率 Tr 换算隔振率 R = −20lgTr，目标 ≥10 dB（fn ≤ fex/√2 才进入隔振区）；4) 流动——Re = ρ0vD/μ，层流 f = 64/Re、湍流 f = 0.3164/Re^0.25，波纹段粗糙修正 kf = 1.5~2.5，Δp = (kf·f·L/D + ΣK)·ρ0v²/2，目标 ≤3~5 kPa；5) 管壁声辐射——纵波速 cL、环频率 fr、波数 ka，辐射效率 σrad 按 f < fr 与 f ≥ fr 两支计算，辐射声功率 W 与声功率级 LW、测点声压级 Lp(r)；6) 卡箍夹紧力 Fc = πDbpc/μf，压缩率建议 20%~35%。',
  inputs: [
    { key: 'D', label: '软管内径', symbol: 'D', unit: 'mm', unitGroup: 'diameter', default: 50, min: 0, required: true, description: '与管路匹配，典型 30~120 mm' },
    { key: 't', label: '壁厚（含增强层）', symbol: 't', unit: 'mm', unitGroup: 'length', default: 6, min: 0, required: true, description: '橡胶 + 增强层总壁厚，典型 3~8 mm' },
    { key: 'L', label: '软管长度', symbol: 'L', unit: 'mm', unitGroup: 'length', default: 300, min: 0, required: true, description: '按布置确定，典型 100~600 mm（含波纹段）' },
    { key: 'E', label: '弹性模量', symbol: 'E', unit: 'MPa', unitGroup: 'stress', default: 8, min: 0, required: true, description: 'EPDM 5~10 MPa；带增强层按等效模量取值' },
    { key: 'sigmaB', label: '拉伸强度', symbol: 'σb', unit: 'MPa', unitGroup: 'stress', default: 10, min: 0, required: true, description: '取胶料与增强层的较小值，典型 8~15 MPa（带增强层可更高）' },
    { key: 'rho', label: '胶料密度', symbol: 'ρ', unit: 'kg/m³', unitGroup: 'density', default: 1200, min: 0, required: true, description: 'EPDM 1100~1300 kg/m³，用于纵波速与面密度' },
    { key: 'nu', label: '泊松比', symbol: 'ν', unit: '-', default: 0.49, min: 0, max: 0.5, required: true, description: '橡胶近似不可压，取 0.49' },
    { key: 'zeta', label: '阻尼比', symbol: 'ζ', unit: '-', default: 0.1, min: 0, max: 1, required: true, description: '橡胶件 0.05~0.15，由隔振试验拟合' },
    { key: 'p', label: '工作内压', symbol: 'p', unit: 'kPa', unitGroup: 'pressure', default: 100, min: 0, required: true, description: '增压机型更高，增压前 80~200 kPa，自然吸气接近常压' },
    { key: 'pv', label: '最大真空度', symbol: 'pv', unit: 'kPa', unitGroup: 'pressure', default: 40, min: 0, required: true, description: '自然吸气机型 30~50 kPa；增压机型进气负压较小' },
    { key: 'CL', label: '短管长度修正系数', symbol: 'CL', unit: '-', default: 2, min: 0, required: true, description: '真空塌陷公式的长度修正：长管取 1，短管 1~3' },
    { key: 'M', label: '隔振侧质量', symbol: 'M', unit: 'kg', unitGroup: 'mass', default: 15, min: 0, required: true, description: '软管所隔离的部件质量（空滤总成 / 管路），用于固有频率' },
    { key: 'fex', label: '激励频率', symbol: 'f_ex', unit: 'Hz', unitGroup: 'frequency', default: 100, min: 0, required: true, description: '发动机怠速/阶次频率，20~500 Hz；同时作为声辐射分析频率' },
    { key: 'Q', label: '额定流量', symbol: 'Q', unit: 'm³/s', unitGroup: 'volumeFlow', default: 0.08, min: 0, required: true, description: '按发动机进气量，典型 0.03~0.20 m³/s' },
    { key: 'muA', label: '空气动力粘度', symbol: 'μ', unit: 'Pa·s', unitGroup: 'dynamicViscosity', default: 1.81e-5, min: 0, required: true, description: '20℃ 空气约 1.81×10⁻⁵ Pa·s' },
    { key: 'rho0', label: '空气密度', symbol: 'ρ0', unit: 'kg/m³', unitGroup: 'density', default: 1.2, min: 0, required: true, description: '20℃、1 atm 约 1.2 kg/m³' },
    { key: 'c0', label: '空气声速', symbol: 'c0', unit: 'm/s', unitGroup: 'velocity', default: 343, min: 0, required: true, description: '20℃ 约 343 m/s' },
    { key: 'sumK', label: '局部损失系数合计', symbol: 'ΣK', unit: '-', default: 1.5, min: 0, required: true, description: '弯头、变径、卡箍台阶累加，单个 0.2~1.0' },
    { key: 'kf', label: '波纹粗糙修正系数', symbol: 'kf', unit: '-', default: 1.8, min: 1, max: 3, required: true, description: '波纹段摩擦系数取同 Re 直管的 1.5~2.5 倍；全直管取 1.0' },
    { key: 'vmode', label: '壁面振速来源', symbol: '-', unit: '-', kind: 'select', options: [{ value: 1, label: '按质量律估算（p/(2πf·m″)）' }, { value: 2, label: '实测壁面法向振速' }], default: 1, required: true, description: '低频薄壁控制段可按式估算；有实测/FEA 数据时选实测' },
    { key: 'pA', label: '管内压力脉动幅值', symbol: 'p′', unit: 'kPa', unitGroup: 'pressure', default: 1, min: 0, required: true, showIf: { key: 'vmode', max: 1 }, description: '压力脉动幅值（非静压），0.1~1 kPa 量级；用于质量律估算壁面振速' },
    { key: 'vwall', label: '壁面法向振速（有效值）', symbol: 'v_w', unit: 'm/s', unitGroup: 'velocity', default: 0.15, min: 0, required: true, showIf: { key: 'vmode', min: 2 }, description: '实测或 FEA 得到的壁面法向振速有效值' },
    { key: 'r', label: '声压测点距离', symbol: 'r', unit: 'mm', unitGroup: 'length', default: 1000, min: 0, required: true, description: '半消声室测点，0.5~2.0 m；r 远大于 L 时改用球面扩散' },
    { key: 'b', label: '密封带宽度', symbol: 'b', unit: 'mm', unitGroup: 'length', default: 12, min: 0, required: true, description: '卡箍密封面宽度，8~15 mm' },
    { key: 'pc', label: '接触压力', symbol: 'pc', unit: 'kPa', unitGroup: 'pressure', default: 800, min: 0, required: true, description: '卡箍接触压力 0.5~1.0 MPa（即 500~1000 kPa）' },
    { key: 'muF', label: '摩擦系数', symbol: 'μf', unit: '-', default: 0.7, min: 0, max: 1, required: true, description: '橡胶-金属 0.6~0.8' },
  ],
  outputs: [
    { key: 'A', label: '管壁截面积', symbol: 'A', unit: 'mm²', unitGroup: 'area', digits: 1, group: '几何与材料', description: 'A = π·D·t' },
    { key: 'I', label: '截面惯性矩', symbol: 'I', unit: 'mm⁴', unitGroup: 'secondMomentOfArea', digits: 0, group: '几何与材料', description: 'I = π·D³·t/8（薄壁圆环近似）' },
    { key: 'S', label: '内表面积', symbol: 'S', unit: 'm²', unitGroup: 'area', digits: 4, group: '几何与材料', description: 'S = π·D·L，用于辐射声功率' },
    { key: 'mS', label: '管壁面密度', symbol: 'm″', unit: 'kg/m²', unitGroup: 'surfaceDensity', digits: 3, group: '几何与材料', description: 'm″ = ρ·t，质量定律与振速估算使用' },
    { key: 'sigTheta', label: '环向应力', symbol: 'σθ', unit: 'MPa', unitGroup: 'stress', digits: 3, group: '耐压与爆破', description: 'σθ = p·D/(2t)，应满足 σθ ≤ σb/n（n = 2~3）' },
    { key: 'sigZ', label: '轴向应力', symbol: 'σz', unit: 'MPa', unitGroup: 'stress', digits: 3, group: '耐压与爆破', description: 'σz = p·D/(4t) = σθ/2' },
    { key: 'nAct', label: '实际安全系数', symbol: 'n', unit: '-', digits: 2, group: '耐压与爆破', primary: true, description: 'n = σb/σθ，设计要求 2~3' },
    { key: 'pb', label: '爆破压力', symbol: 'pb', unit: 'kPa', unitGroup: 'pressure', digits: 1, group: '耐压与爆破', description: 'pb = 2tσb/D，取胶料与增强层强度的较小值' },
    { key: 'pbRatio', label: '爆破裕度', symbol: 'pb/p', unit: '-', digits: 2, group: '耐压与爆破', description: '要求 pb ≥ (3~5)·p，并满足 SAE J20 爆破试验' },
    { key: 'pcr', label: '临界外压（真空吸扁）', symbol: 'pcr', unit: 'kPa', unitGroup: 'pressure', digits: 1, group: '耐压与爆破', description: 'pcr = [2E/(1−ν²)]·(t/D)³·CL，橡胶 E 低，无增强层时仅十几 kPa' },
    { key: 'pcrRatio', label: '真空裕度', symbol: 'pcr/pv', unit: '-', digits: 2, group: '耐压与爆破', description: '要求 pcr ≥ (1.5~2)·pv，不足时需增加增强层或波纹段' },
    { key: 'kax', label: '轴向刚度', symbol: 'kax', unit: 'kN/m', unitGroup: 'stiffness', digits: 2, group: '刚度与隔振', description: 'kax = E·A/L，软管越软隔振越好，但越易吸扁' },
    { key: 'kb', label: '弯曲刚度（简支）', symbol: 'kb', unit: 'kN/m', unitGroup: 'stiffness', digits: 2, group: '刚度与隔振', description: 'kb = 3·E·I/L³，两端固支时系数取 12' },
    { key: 'fn', label: '固有频率', symbol: 'fn', unit: 'Hz', unitGroup: 'frequency', digits: 2, group: '刚度与隔振', description: 'fn = (1/2π)·√(kax/M)，应满足 fn ≤ fex/√2 才进入隔振区' },
    { key: 'rFr', label: '频率比', symbol: 'r', unit: '-', digits: 2, group: '刚度与隔振', description: 'r = fex/fn' },
    { key: 'Tr', label: '力传递率', symbol: 'Tr', unit: '-', digits: 4, group: '刚度与隔振', description: 'Tr = √{[1+(2ζr)²]/[(1−r²)²+(2ζr)²]}' },
    { key: 'R', label: '隔振率', symbol: 'R', unit: 'dB', digits: 1, group: '刚度与隔振', primary: true, description: 'R = −20·lg(Tr)，目标 ≥10 dB' },
    { key: 'vel', label: '平均流速', symbol: 'v', unit: 'm/s', unitGroup: 'velocity', digits: 3, group: '流动压降', description: 'v = Q/(πD²/4)，设计窗口 20~60 m/s，避免高速气流再生噪声' },
    { key: 'Re', label: '雷诺数', symbol: 'Re', unit: '-', digits: 0, group: '流动压降', description: 'Re = ρ0·v·D/μ，<2300 按层流' },
    { key: 'fD', label: '直管摩擦系数', symbol: 'f', unit: '-', digits: 4, group: '流动压降', description: '层流 64/Re，湍流 0.3164/Re^0.25' },
    { key: 'dp', label: '软管压降', symbol: 'Δp', unit: 'kPa', unitGroup: 'pressure', digits: 3, group: '流动压降', primary: true, description: 'Δp = (kf·f·L/D + ΣK)·ρ0·v²/2，目标 ≤3~5 kPa' },
    { key: 'cL', label: '管壁纵波速', symbol: 'cL', unit: 'm/s', unitGroup: 'velocity', digits: 2, group: '管壁声辐射', description: 'cL = √{E/[ρ(1−ν²)]}，橡胶远低于金属' },
    { key: 'fr', label: '环频率', symbol: 'fr', unit: 'Hz', unitGroup: 'frequency', digits: 1, group: '管壁声辐射', description: 'fr = cL/(π·D)，管壁呼吸模态频率' },
    { key: 'sigRad', label: '辐射效率', symbol: 'σrad', unit: '-', digits: 5, group: '管壁声辐射', description: 'f < fr 按 (2/π)(ka)²/√{1−(f/fr)²}；f ≥ fr 按 1/√{1−(fr/f)²}，工程限幅 ≤1' },
    { key: 'vWall', label: '壁面振速（有效值）', symbol: 'vw', unit: 'm/s', unitGroup: 'velocity', digits: 4, group: '管壁声辐射', description: '质量律幅值 p′/(2πf·m″) 折有效值；或直接取实测值' },
    { key: 'W', label: '辐射声功率', symbol: 'W', unit: 'W', digits: 6, group: '管壁声辐射', description: 'W = ρ0·c0·S·σrad·⟨v²⟩' },
    { key: 'LW', label: '声功率级', symbol: 'LW', unit: 'dB', digits: 1, group: '管壁声辐射', description: 'LW = 10·lg(W/10⁻¹²)' },
    { key: 'Lp', label: '测点声压级', symbol: 'Lp', unit: 'dB', digits: 1, group: '管壁声辐射', description: 'Lp(r) = LW − 10·lg(2π·r·L)，线声源近似；r ≫ L 时改球面扩散' },
    { key: 'Fc', label: '卡箍夹紧力', symbol: 'Fc', unit: 'N', unitGroup: 'force', digits: 0, group: '卡箍连接', description: 'Fc = π·D·b·pc/μf，压缩率建议 20%~35%' },
  ],
  latex: [
    {
      label: '几何与材料',
      tex: "A = \\pi D t,\\qquad I = \\frac{\\pi D^{3} t}{8},\\qquad S = \\pi D L,\\qquad m'' = \\rho t",
    },
    {
      label: '内压应力与安全系数',
      tex: '\\sigma_\\theta = \\frac{p D}{2 t},\\qquad \\sigma_z = \\frac{p D}{4 t},\\qquad n = \\frac{\\sigma_b}{\\sigma_\\theta}',
    },
    {
      label: '爆破压力',
      tex: 'p_b = \\frac{2 t \\sigma_b}{D}',
    },
    {
      label: '真空塌陷临界外压',
      tex: 'p_{cr} = \\frac{2 E}{1 - \\nu^{2}} \\left(\\frac{t}{D}\\right)^{3} C_L',
    },
    {
      label: '轴向与弯曲刚度',
      tex: 'k_{ax} = \\frac{E A}{L},\\qquad k_b = \\frac{3 E I}{L^{3}}',
    },
    {
      label: '固有频率、传递率与隔振率',
      tex: 'f_n = \\frac{1}{2\\pi}\\sqrt{\\frac{k_{ax}}{M}},\\qquad r = \\frac{f_{ex}}{f_n},\\qquad T_r = \\sqrt{\\frac{1+(2\\zeta r)^{2}}{(1-r^{2})^{2}+(2\\zeta r)^{2}}},\\qquad R = -20\\lg T_r',
    },
    {
      label: '流动压降',
      tex: 'Re = \\frac{\\rho_0 v D}{\\mu},\\quad f = \\frac{64}{Re}\\ \\text{或}\\ \\frac{0.3164}{Re^{0.25}},\\quad \\Delta p = \\left(k_f f \\frac{L}{D} + \\sum K\\right)\\frac{\\rho_0 v^{2}}{2}',
    },
    {
      label: '管壁纵波速、环频率与波数',
      tex: 'c_L = \\sqrt{\\frac{E}{\\rho(1-\\nu^{2})}},\\qquad f_r = \\frac{c_L}{\\pi D},\\qquad ka = \\frac{2\\pi f a}{c_0}\\ \\ (a = D/2)',
    },
    {
      label: '圆柱壳辐射效率（低于 / 高于环频率）',
      tex: '\\sigma_{rad} = \\frac{2}{\\pi}\\frac{(ka)^{2}}{\\sqrt{1-(f/f_r)^{2}}}\\ (f < f_r),\\qquad \\sigma_{rad} = \\frac{1}{\\sqrt{1-(f_r/f)^{2}}}\\ (f \\ge f_r)',
    },
    {
      label: '辐射声功率与声压级',
      tex: 'W = \\rho_0 c_0 S \\,\\sigma_{rad}\\langle v^{2}\\rangle,\\qquad L_W = 10\\lg\\frac{W}{10^{-12}},\\qquad L_p(r) = L_W - 10\\lg(2\\pi r L)',
    },
    {
      label: '壁面法向振速（质量律估算）',
      tex: "|v| \\approx \\frac{p'}{2\\pi f m''},\\qquad m'' = \\rho t",
    },
    {
      label: '卡箍夹紧力',
      tex: 'F_c = \\frac{\\pi D b p_c}{\\mu_f}',
    },
  ],
  diagram: INTAKE_HOSE_DIAGRAM,
  sensitivity: true,
  assumptions: [
    '公式与参考文档《乘用车橡胶进气软管设计计算公式与输入参数（管壁辐射版）》一致，对应其式 (1)~(25)，依据 SAE J20 / SAE J200、GB/T 3683、ISO 6803 与 Munjal 管道声学',
    '薄壁圆环近似：A = πDt、I = πD³t/8 要求 t/D 较小（本设计窗口 t/D ≈ 0.05~0.15），D 为内径；橡胶近似不可压取 ν = 0.49',
    'σb 取胶料与增强层的较小值；无增强层时爆破压力与真空临界外压都很低，实际软管须靠增强层或波纹结构抗吸扁（本公式按输入 σb、E 计算，不含增强层角度/层数的折减）',
    '隔振分析把软管简化为一端固定、另一端质量 M 的单自由度系统，kax 取轴向刚度；带波纹段时整体刚度应按直段与波纹段串联（波纹段刚度见 EJMA 波纹管公式）后再代入',
    '压降用 Darcy-Weisbach，波纹段以 kf 放大同 Re 直管摩擦系数；ΣK 为全部局部损失之和，不含气流再生噪声',
    '管壁声辐射只考虑壁面受激振动向外辐射，不含膨胀腔、谐振腔等管内消声元件；若总成带谐振腔，消声量按管道声学传递矩阵另行计算',
    '辐射效率在 f → fr 附近公式发散，本实现将 σrad 限幅到 [0, 1]（工程近似）；橡胶阻尼大，实际辐射效率低于同尺寸金属管，精确值须实测或 FEA 修正',
    '壁面振速按质量律估算时，p′/(2πf·m″) 视为幅值并折为有效值（÷√2）；选「实测」时输入值本身即为有效值，质量律不适用于接近环频率的模态区',
    'Lp(r) 按线声源近似 −10lg(2πrL)；r 远大于管长 L 时应改用球面扩散 −10lg(4πr²)，本公式未自动切换',
    '卡箍压缩率 20%~35% 为结构建议，本公式只输出所需夹紧力，泄漏与切伤须按 GB/T 3683 与样件验证',
  ],
  solve(v) {
    const empty = {
      A: NaN, I: NaN, S: NaN, mS: NaN,
      sigTheta: NaN, sigZ: NaN, nAct: NaN, pb: NaN, pbRatio: NaN, pcr: NaN, pcrRatio: NaN,
      kax: NaN, kb: NaN, fn: NaN, rFr: NaN, Tr: NaN, R: NaN,
      vel: NaN, Re: NaN, fD: NaN, dp: NaN,
      cL: NaN, fr: NaN, sigRad: NaN, vWall: NaN, W: NaN, LW: NaN, Lp: NaN,
      Fc: NaN,
    };
    const measured = v.vmode === 2;
    const ok =
      v.D > 0 && v.t > 0 && v.L > 0 && v.E > 0 && v.sigmaB > 0 && v.rho > 0 &&
      v.nu > 0 && v.nu < 0.5 && v.zeta > 0 && v.p > 0 && v.pv > 0 && v.CL > 0 &&
      v.M > 0 && v.fex > 0 && v.Q > 0 && v.muA > 0 && v.rho0 > 0 && v.c0 > 0 &&
      v.sumK >= 0 && v.kf > 0 && v.r > 0 && v.b > 0 && v.pc > 0 && v.muF > 0 &&
      (measured ? v.vwall > 0 : v.pA > 0);
    if (!ok) return empty;

    // 几何与材料
    const A = Math.PI * v.D * v.t;
    const I = (Math.PI * Math.pow(v.D, 3) * v.t) / 8;
    const S = Math.PI * v.D * v.L;
    const mS = v.rho * v.t;

    // 耐压与爆破
    const sigTheta = (v.p * v.D) / (2 * v.t);
    const sigZ = (v.p * v.D) / (4 * v.t);
    const nAct = v.sigmaB / sigTheta;
    const pb = (2 * v.t * v.sigmaB) / v.D;
    const pbRatio = pb / v.p;
    const pcr = ((2 * v.E) / (1 - v.nu * v.nu)) * Math.pow(v.t / v.D, 3) * v.CL;
    const pcrRatio = pcr / v.pv;

    // 刚度与隔振
    const kax = (v.E * A) / v.L;
    const kb = (3 * v.E * I) / Math.pow(v.L, 3);
    const fn = Math.sqrt(kax / v.M) / (2 * Math.PI);
    const rFr = v.fex / fn;
    const twoZR = 2 * v.zeta * rFr;
    const Tr = Math.sqrt((1 + twoZR * twoZR) / (Math.pow(1 - rFr * rFr, 2) + twoZR * twoZR));
    const R = -20 * Math.log10(Tr);

    // 流动压降
    const Ac = (Math.PI * v.D * v.D) / 4;
    const vel = v.Q / Ac;
    const Re = (v.rho0 * vel * v.D) / v.muA;
    const fD = Re < 2300 ? 64 / Re : 0.3164 / Math.pow(Re, 0.25);
    const dp = ((v.kf * fD * v.L) / v.D + v.sumK) * v.rho0 * vel * vel / 2;

    // 管壁声辐射
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

    // vmode = 1：质量律幅值 p′/(2πf·m″)，折为有效值；vmode = 2：直接取实测有效值
    const vWall = measured ? v.vwall : v.pA / (2 * Math.PI * v.fex * mS) / Math.sqrt(2);
    const W = v.rho0 * v.c0 * S * sigRad * vWall * vWall;
    const LW = 10 * Math.log10(W / 1e-12);
    const Lp = LW - 10 * Math.log10(2 * Math.PI * v.r * v.L);

    // 卡箍连接
    const Fc = (Math.PI * v.D * v.b * v.pc) / v.muF;

    return {
      A, I, S, mS,
      sigTheta, sigZ, nAct, pb, pbRatio, pcr, pcrRatio,
      kax, kb, fn, rFr, Tr, R,
      vel, Re, fD, dp,
      cL, fr, sigRad, vWall, W, LW, Lp,
      Fc,
    };
  },
  benchmarks: [
    {
      name: '全链校核算例：D50 / t6 / L300，增压前 100 kPa，激励 100 Hz（低于环频率）',
      input: {
        D: 0.05, t: 0.006, L: 0.3, E: 8e6, sigmaB: 10e6, rho: 1200, nu: 0.49, zeta: 0.1,
        p: 1e5, pv: 4e4, CL: 2, M: 15, fex: 100, Q: 0.08,
        muA: 1.81e-5, rho0: 1.2, c0: 343, sumK: 1.5, kf: 1.8,
        vmode: 1, pA: 1000, vwall: 0.15,
        r: 1.0, b: 0.012, pc: 8e5, muF: 0.7,
      },
      expect: {
        A: 0.0009424777960769379,
        I: 2.9452431127404315e-7,
        S: 0.047123889803846894,
        mS: 7.2,
        sigTheta: 416666.6666666667,
        sigZ: 208333.33333333334,
        nAct: 24,
        pb: 2400000,
        pbRatio: 24,
        pcr: 72767.46940386892,
        pcrRatio: 1.819186735096723,
        kax: 25132.741228718347,
        kb: 261.7993877991495,
        fn: 6.5147001587056,
        rFr: 15.349900619197324,
        Tr: 0.013760436814505233,
        R: 37.227355590733744,
        vel: 40.7436654315252,
        Re: 135061.8743586471,
        fD: 0.016504534571135807,
        dp: 1671.5825718382848,
        cL: 93.66474351506379,
        fr: 596.288276954278,
        sigRad: 0.0013543357987156085,
        vWall: 0.15630491599949758,
        W: 0.0006417828843868181,
        LW: 88.07388130778376,
        Lp: 85.32087007700599,
        Fc: 2154.234962461572,
      },
      tolerance: 1e-9,
      source: '按参考文档式 (1)~(25) 自建全链校验算例（直管摩擦系数按湍流分支）',
    },
    {
      name: '恶劣工况：800 Hz 高于环频率 + 实测振速 + 真空不足（pv 60 kPa）',
      input: {
        D: 0.05, t: 0.006, L: 0.3, E: 8e6, sigmaB: 10e6, rho: 1200, nu: 0.49, zeta: 0.1,
        p: 1e5, pv: 6e4, CL: 2, M: 15, fex: 800, Q: 0.12,
        muA: 1.81e-5, rho0: 1.2, c0: 343, sumK: 1.5, kf: 2.5,
        vmode: 2, pA: 1000, vwall: 0.2,
        r: 1.0, b: 0.012, pc: 8e5, muF: 0.7,
      },
      expect: {
        A: 0.0009424777960769379,
        I: 2.9452431127404315e-7,
        S: 0.047123889803846894,
        mS: 7.2,
        sigTheta: 416666.6666666667,
        sigZ: 208333.33333333334,
        nAct: 24,
        pb: 2400000,
        pbRatio: 24,
        pcr: 72767.46940386892,
        pcrRatio: 1.2127911567311487,
        kax: 25132.741228718347,
        kb: 261.7993877991495,
        fn: 6.5147001587056,
        rFr: 122.7992049535786,
        Tr: 0.001630130480651023,
        R: 55.755552638807075,
        vel: 61.1154981472878,
        Re: 202592.81153797064,
        fD: 0.014913530507126266,
        dp: 3862.9260047468774,
        cL: 93.66474351506379,
        fr: 596.288276954278,
        sigRad: 1,
        vWall: 0.2,
        W: 0.7758477217305353,
        LW: 118.89776489168172,
        Lp: 116.14475366090394,
        Fc: 2154.234962461572,
      },
      tolerance: 1e-9,
      source: '自建恶劣工况算例：f ≥ fr 时辐射效率取高分支并限幅为 1，验证真空裕度不足的校核输出',
    },
  ],
};
