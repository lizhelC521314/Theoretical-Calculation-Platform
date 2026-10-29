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

