/** 流体领域示意图（内联 SVG，随公式元数据一起交付，离线可用） */

export const POROUS_MEDIA_DIAGRAM = `
<svg viewBox="0 0 520 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="多孔介质压降试验示意">
  <defs>
    <marker id="pmArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#1a5fb4"/>
    </marker>
    <pattern id="pmHatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="9" stroke="#b7cbe6" stroke-width="1.5"/>
    </pattern>
  </defs>
  <text x="260" y="26" text-anchor="middle" font-size="13" fill="#5a6b85">ρ（密度）、μ（动力粘度）</text>
  <rect x="150" y="50" width="220" height="110" fill="url(#pmHatch)" stroke="#1a5fb4" stroke-width="2"/>
  <text x="260" y="96" text-anchor="middle" font-size="14" fill="#0b3a72" font-weight="600">多孔介质</text>
  <text x="260" y="120" text-anchor="middle" font-size="12" fill="#5a6b85">厚度 L</text>
  <line x1="20" y1="105" x2="144" y2="105" stroke="#1a5fb4" stroke-width="2" marker-end="url(#pmArrow)"/>
  <text x="84" y="82" text-anchor="middle" font-size="12.5" fill="#1a5fb4">v₁, v₂</text>
  <line x1="376" y1="105" x2="500" y2="105" stroke="#1a5fb4" stroke-width="2" marker-end="url(#pmArrow)"/>
  <text x="438" y="82" text-anchor="middle" font-size="12.5" fill="#1a5fb4">p₁, p₂</text>
  <text x="260" y="188" text-anchor="middle" font-size="14" fill="#c0392b" font-weight="600">ΔP/L = −(μ/α + ρC₂/2)·|v|·v</text>
  <text x="260" y="214" text-anchor="middle" font-size="12" fill="#5a6b85">两工况联立 → 反算 1/α 与 C₂，再换算 P_v 与 P_i</text>
</svg>`;

export const PRESSURE_CORRECTION_DIAGRAM = `
<svg viewBox="0 0 500 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="压力修正示意">
  <defs>
    <marker id="pcArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#1a5fb4"/>
    </marker>
  </defs>
  <rect x="20" y="80" width="180" height="70" rx="6" fill="#f9fbfd" stroke="#1a5fb4" stroke-width="2"/>
  <text x="110" y="105" text-anchor="middle" font-size="12" fill="#5a6b85">测试条件</text>
  <text x="110" y="125" text-anchor="middle" font-size="13" fill="#0b3a72">T<tspan font-size="9" dy="3">test</tspan>, P<tspan font-size="9" dy="3">test</tspan></text>
  <text x="110" y="142" text-anchor="middle" font-size="12" fill="#0b3a72">ΔP<tspan font-size="9" dy="3">test</tspan></text>
  <line x1="200" y1="115" x2="290" y2="115" stroke="#1a5fb4" stroke-width="2" marker-end="url(#pcArrow)"/>
  <rect x="290" y="80" width="190" height="70" rx="6" fill="#eef4ff" stroke="#1a5fb4" stroke-width="2"/>
  <text x="385" y="105" text-anchor="middle" font-size="12" fill="#5a6b85">标准条件</text>
  <text x="385" y="125" text-anchor="middle" font-size="13" fill="#0b3a72">T<tspan font-size="9" dy="3">std</tspan>, P<tspan font-size="9" dy="3">std</tspan></text>
  <text x="385" y="142" text-anchor="middle" font-size="12" fill="#0b3a72">ΔP<tspan font-size="9" dy="3">std</tspan></text>

  <rect x="195" y="20" width="110" height="34" rx="4" fill="#ffffff" stroke="#8496b3" stroke-width="1.5"/>
  <text x="250" y="42" text-anchor="middle" font-size="11" fill="#5a6b85">修正公式</text>

  <!-- 管道出口动压示意 -->
  <rect x="60" y="170" width="380" height="38" rx="4" fill="#ffffff" stroke="#8496b3" stroke-width="1.5"/>
  <line x1="100" y1="170" x2="100" y2="208" stroke="#8496b3" stroke-width="1.5"/>
  <text x="245" y="195" text-anchor="middle" font-size="11" fill="#5a6b85">出口动压 P<tspan font-size="8" dy="2">dyn</tspan> = ½ρv²，v = (Q/ρ)/(πD²/4)/3600</text>
  <line x1="420" y1="170" x2="420" y2="208" stroke="#8496b3" stroke-width="1.5"/>

  <!-- 主公式 -->
  <text x="250" y="8" text-anchor="middle" font-size="12" fill="#c0392b" font-weight="600">ΔP<tspan font-size="9" dy="3">std</tspan> = ΔP<tspan font-size="9" dy="3">test</tspan> · (273.15+T<tspan font-size="9" dy="3">std</tspan>)/(273.15+T<tspan font-size="9" dy="3">test</tspan>) · P<tspan font-size="9" dy="3">test</tspan>/P<tspan font-size="9" dy="3">std</tspan>，ΔP<tspan font-size="9" dy="3">total</tspan> = ΔP<tspan font-size="9" dy="3">std</tspan> − P<tspan font-size="9" dy="3">dyn</tspan></text>
</svg>`;

/**
 * 进气系统阻力（压力损失）示意图：
 * 上半部分为「大气入口 → 进气管 → 波纹管 → 编织管 → 空滤器 → 出气管 → 多腔穿孔消音器 → 发动机」，
 * 下半部分为沿程静压分布，压力在各部件处逐段下降。
 */
export const INTAKE_RESISTANCE_DIAGRAM = `
<svg class="diagram-wide" viewBox="0 0 760 356" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="进气系统阻力（压力损失）计算示意">
  <defs>
    <marker id="isrArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#1a5fb4"/>
    </marker>
    <pattern id="isrBraid" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="7" stroke="#b7cbe6" stroke-width="1.4"/>
    </pattern>
  </defs>

  <text x="380" y="20" text-anchor="middle" font-size="14" fill="#0b3a72" font-weight="600">进气系统阻力（压力损失）计算示意</text>

  <!-- 大气入口 -->
  <line x1="2" y1="107" x2="13" y2="107" stroke="#1a5fb4" stroke-width="2" marker-end="url(#isrArrow)"/>
  <polygon points="14,79 48,90 48,124 14,135" fill="#eef4ff" stroke="#1a5fb4" stroke-width="1.8"/>

  <!-- 进气管 -->
  <rect x="48" y="90" width="92" height="34" fill="#eef4ff" stroke="#1a5fb4" stroke-width="1.8"/>

  <!-- 波纹管 -->
  <rect x="140" y="86" width="82" height="42" fill="#f8fafd" stroke="#1a5fb4" stroke-width="1.8"/>
  <g stroke="#1a5fb4" stroke-width="1.2">
    <line x1="147" y1="86" x2="147" y2="128"/>
    <line x1="154" y1="86" x2="154" y2="128"/>
    <line x1="161" y1="86" x2="161" y2="128"/>
    <line x1="168" y1="86" x2="168" y2="128"/>
    <line x1="175" y1="86" x2="175" y2="128"/>
    <line x1="182" y1="86" x2="182" y2="128"/>
    <line x1="189" y1="86" x2="189" y2="128"/>
    <line x1="196" y1="86" x2="196" y2="128"/>
    <line x1="203" y1="86" x2="203" y2="128"/>
    <line x1="210" y1="86" x2="210" y2="128"/>
    <line x1="217" y1="86" x2="217" y2="128"/>
  </g>

  <!-- 编织管 -->
  <rect x="222" y="90" width="84" height="34" fill="url(#isrBraid)" stroke="#1a5fb4" stroke-width="1.8"/>

  <!-- 空滤器（含滤芯） -->
  <rect x="306" y="78" width="104" height="58" fill="#f9fbfd" stroke="#1a5fb4" stroke-width="2"/>
  <rect x="350" y="84" width="30" height="46" fill="url(#isrBraid)" stroke="#1a5fb4" stroke-width="1.5"/>
  <text x="330" y="112" text-anchor="middle" font-size="9" fill="#5a6b85">箱体</text>
  <text x="387" y="112" text-anchor="middle" font-size="9" fill="#5a6b85">滤芯</text>

  <!-- 出气管 -->
  <rect x="410" y="90" width="90" height="34" fill="#eef4ff" stroke="#1a5fb4" stroke-width="1.8"/>

  <!-- 多腔穿孔消音器 -->
  <rect x="500" y="78" width="120" height="58" fill="#f9fbfd" stroke="#1a5fb4" stroke-width="2"/>
  <rect x="508" y="94" width="104" height="26" fill="#eef4ff" stroke="#1a5fb4" stroke-width="1.2"/>
  <g stroke="#1a5fb4" stroke-width="1.2">
    <line x1="528" y1="94" x2="528" y2="120"/>
    <line x1="554" y1="94" x2="554" y2="120"/>
    <line x1="580" y1="94" x2="580" y2="120"/>
  </g>
  <g fill="#1a5fb4">
    <circle cx="513" cy="96" r="1.4"/><circle cx="526" cy="96" r="1.4"/><circle cx="539" cy="96" r="1.4"/>
    <circle cx="552" cy="96" r="1.4"/><circle cx="565" cy="96" r="1.4"/><circle cx="578" cy="96" r="1.4"/>
    <circle cx="591" cy="96" r="1.4"/><circle cx="604" cy="96" r="1.4"/>
    <circle cx="513" cy="118" r="1.4"/><circle cx="526" cy="118" r="1.4"/><circle cx="539" cy="118" r="1.4"/>
    <circle cx="552" cy="118" r="1.4"/><circle cx="565" cy="118" r="1.4"/><circle cx="578" cy="118" r="1.4"/>
    <circle cx="591" cy="118" r="1.4"/><circle cx="604" cy="118" r="1.4"/>
  </g>

  <!-- 出气至发动机 -->
  <line x1="620" y1="107" x2="704" y2="107" stroke="#1a5fb4" stroke-width="2" marker-end="url(#isrArrow)"/>

  <!-- 各部件名称与压降符号 -->
  <g font-size="11" fill="#1f2937" text-anchor="middle">
    <text x="31" y="58">大气</text>
    <text x="94" y="58">进气管</text>
    <text x="181" y="58">波纹管</text>
    <text x="264" y="58">编织管</text>
    <text x="358" y="58">空滤器（含滤芯）</text>
    <text x="455" y="58">出气管</text>
    <text x="560" y="58">多腔穿孔消音器</text>
    <text x="662" y="58">至发动机</text>
  </g>
  <g font-size="9.5" fill="#1a5fb4" text-anchor="middle">
    <text x="31" y="76">p_atm, V≈0</text>
    <text x="94" y="76">Δp_in</text>
    <text x="181" y="76">Δp_b</text>
    <text x="264" y="76">Δp_br</text>
    <text x="358" y="76">Δp_airbox</text>
    <text x="455" y="76">Δp_out</text>
    <text x="560" y="76">Δp_muf</text>
    <text x="662" y="76">p_engine</text>
  </g>

  <!-- 沿程静压分布 -->
  <rect x="58" y="172" width="684" height="126" fill="#fcfdff" stroke="#d7e1ee" stroke-width="1"/>
  <text x="400" y="188" text-anchor="middle" font-size="11.5" fill="#0b3a72">沿程静压分布（各段压降示意）</text>
  <line x1="80" y1="205" x2="720" y2="205" stroke="#c0392b" stroke-width="1.2" stroke-dasharray="6 4"/>
  <text x="84" y="201" font-size="9" fill="#c0392b">大气压 p_atm</text>

  <!-- 静压阶梯：每到一个部件下降一段 -->
  <path d="M80,215 H112 V218 H198 V226 H274 V232 H353 V238 H450 V260 H534 V266 H645 V272 H720 V298 H80 Z" fill="#eef4ff" opacity="0.6"/>
  <path d="M80,215 H112 V218 H198 V226 H274 V232 H353 V238 H450 V260 H534 V266 H645 V272 H720" fill="none" stroke="#1a5fb4" stroke-width="2"/>

  <g font-size="9" fill="#1a5fb4" text-anchor="middle">
    <text x="146" y="212">Δp_entrance</text>
    <text x="236" y="220">Δp_in</text>
    <text x="313" y="226">Δp_b</text>
    <text x="401" y="232">Δp_br</text>
    <text x="491" y="254">Δp_airbox</text>
    <text x="589" y="260">Δp_out</text>
    <text x="682" y="266">Δp_muf</text>
  </g>

  <text x="70" y="250" font-size="9.5" fill="#5a6b85" transform="rotate(-90 70 250)" text-anchor="middle">静压 p / kPa</text>
  <text x="400" y="315" text-anchor="middle" font-size="10" fill="#5a6b85">沿程位置</text>

  <text x="380" y="340" text-anchor="middle" font-size="11.5" fill="#c0392b" font-weight="600">Δp_sys = Δp_entrance + Δp_in + Δp_b + Δp_br + Δp_airbox + Δp_out + Δp_muf</text>
</svg>`;

