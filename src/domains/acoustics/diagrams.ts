/** 声学（NVH）领域示意图（内联 SVG，随公式元数据一起交付，离线可用） */

export const HELMHOLTZ_DIAGRAM = `
<svg viewBox="0 0 520 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="赫姆霍兹消音器几何示意">
  <!-- 主管道：宽扁矩形 -->
  <rect x="30" y="228" width="460" height="44" fill="#ffffff" stroke="#222222" stroke-width="1.8"/>
  <!-- 共振腔：圆形 -->
  <circle cx="260" cy="105" r="63" fill="#ffffff" stroke="#222222" stroke-width="1.8"/>
  <!-- 喉管：先挖掉圆周底弧，再画两条侧边 -->
  <rect x="246" y="163" width="28" height="65" fill="#ffffff"/>
  <line x1="246" y1="163" x2="246" y2="228" stroke="#222222" stroke-width="1.8"/>
  <line x1="274" y1="163" x2="274" y2="228" stroke="#222222" stroke-width="1.8"/>

  <!-- 部件名称：引线指向对应几何位置 -->
  <line x1="218" y1="62" x2="166" y2="50" stroke="#8a8a8a" stroke-width="1"/>
  <text x="162" y="54" text-anchor="end" font-size="12" fill="#222222">共振腔</text>
  <line x1="246" y1="216" x2="196" y2="216" stroke="#8a8a8a" stroke-width="1"/>
  <text x="192" y="220" text-anchor="end" font-size="12" fill="#222222">喉管</text>
  <text x="392" y="256" text-anchor="middle" font-size="12" fill="#222222">主管道</text>

  <!-- 符号标注 -->
  <text x="260" y="111" text-anchor="middle" font-size="15" fill="#222222">V</text>
  <text x="260" y="205" text-anchor="middle" font-size="11" fill="#222222">d</text>
  <line x1="274" y1="196" x2="330" y2="196" stroke="#8a8a8a" stroke-width="1"/>
  <text x="334" y="200" text-anchor="start" font-size="12" fill="#222222">l<tspan font-size="9" dy="3">c</tspan></text>
  <text x="72" y="256" text-anchor="middle" font-size="13" fill="#222222">D</text>

  <!-- 主公式 -->
  <text x="260" y="300" text-anchor="middle" font-size="14" fill="#c0392b" font-weight="600">f = c/(2π)·√(Sc / (V·(lc + 1.5d/2)))</text>
</svg>`;

export const EXPANSION_DIAGRAM = `
<svg viewBox="0 0 560 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="膨胀腔消音器几何示意">
  <!-- 膨胀腔：中部大矩形 -->
  <rect x="190" y="80" width="180" height="140" fill="#ffffff" stroke="#222222" stroke-width="1.8"/>
  <!-- 声音传入管：自左侧插入膨胀腔（白底覆盖腔壁穿过的部分） -->
  <rect x="60" y="132" width="190" height="36" fill="#ffffff" stroke="#222222" stroke-width="1.8"/>
  <!-- 声音传出管：自右侧插入膨胀腔 -->
  <rect x="310" y="132" width="190" height="36" fill="#ffffff" stroke="#222222" stroke-width="1.8"/>

  <!-- 部件名称：引线指向对应几何位置 -->
  <line x1="140" y1="120" x2="140" y2="130" stroke="#8a8a8a" stroke-width="1"/>
  <text x="140" y="114" text-anchor="middle" font-size="12" fill="#222222">声音传入管</text>
  <line x1="372" y1="82" x2="418" y2="48" stroke="#8a8a8a" stroke-width="1"/>
  <text x="422" y="46" text-anchor="start" font-size="12" fill="#222222">膨胀腔</text>
  <line x1="400" y1="120" x2="400" y2="130" stroke="#8a8a8a" stroke-width="1"/>
  <text x="400" y="114" text-anchor="middle" font-size="12" fill="#222222">声音传出管</text>

  <!-- 顶部尺寸：膨胀腔长度 L -->
  <line x1="190" y1="70" x2="370" y2="70" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="190" y1="64" x2="190" y2="76" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="370" y1="64" x2="370" y2="76" stroke="#8a8a8a" stroke-width="1"/>
  <text x="280" y="62" text-anchor="middle" font-size="13" fill="#222222">L</text>

  <!-- 底部尺寸：插入深度 La / Lb -->
  <line x1="190" y1="246" x2="250" y2="246" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="190" y1="240" x2="190" y2="252" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="250" y1="240" x2="250" y2="252" stroke="#8a8a8a" stroke-width="1"/>
  <text x="220" y="264" text-anchor="middle" font-size="12" fill="#222222">L<tspan font-size="9" dy="3">a</tspan></text>
  <line x1="310" y1="246" x2="370" y2="246" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="310" y1="240" x2="310" y2="252" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="370" y1="240" x2="370" y2="252" stroke="#8a8a8a" stroke-width="1"/>
  <text x="340" y="264" text-anchor="middle" font-size="12" fill="#222222">L<tspan font-size="9" dy="3">b</tspan></text>

  <!-- 管径符号：竖向尺寸线置于管外两侧，文字在尺寸线外侧，避免遮挡 -->
  <line x1="50" y1="132" x2="50" y2="168" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="44" y1="132" x2="56" y2="132" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="44" y1="168" x2="56" y2="168" stroke="#8a8a8a" stroke-width="1"/>
  <text x="40" y="154" text-anchor="end" font-size="12" fill="#222222">S<tspan font-size="9" dy="3">1</tspan>/d</text>
  <line x1="510" y1="132" x2="510" y2="168" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="504" y1="132" x2="516" y2="132" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="504" y1="168" x2="516" y2="168" stroke="#8a8a8a" stroke-width="1"/>
  <text x="520" y="154" text-anchor="start" font-size="12" fill="#222222">D/S<tspan font-size="9" dy="3">2</tspan></text>

  <!-- 主公式 -->
  <text x="280" y="306" text-anchor="middle" font-size="13" fill="#c0392b" font-weight="600">TL = 10lg[1 + 0.25(m − 1/m)²·(sin(2πL/λ) / (cos(2πLa/λ)·cos(2πLb/λ)))²]</text>
</svg>`;

export const QUARTER_WAVE_DIAGRAM = `
<svg viewBox="0 0 520 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="四分之一波长管消音器几何示意">
  <!-- 主管道：横向矩形 -->
  <rect x="30" y="200" width="460" height="50" fill="#ffffff" stroke="#222222" stroke-width="1.8"/>
  <!-- 四分之一波长管：竖直支管（白底覆盖管壁穿过部分） -->
  <rect x="250" y="60" width="24" height="140" fill="#ffffff" stroke="#222222" stroke-width="1.8"/>

  <!-- 部件名称：引线指向对应几何位置 -->
  <line x1="276" y1="88" x2="362" y2="80" stroke="#8a8a8a" stroke-width="1"/>
  <text x="366" y="84" text-anchor="start" font-size="12" fill="#222222">四分之一波长管</text>
  <text x="392" y="231" text-anchor="middle" font-size="12" fill="#222222">主管道</text>

  <!-- 符号标注 -->
  <text x="100" y="231" text-anchor="middle" font-size="13" fill="#222222">S<tspan font-size="9" dy="3">p</tspan></text>
  <text x="262" y="188" text-anchor="middle" font-size="11" fill="#222222">S<tspan font-size="8" dy="2">c</tspan></text>

  <!-- 管长尺寸：竖向尺寸线置于支管左侧，文字在线外侧 -->
  <line x1="238" y1="60" x2="238" y2="200" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="232" y1="60" x2="244" y2="60" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="232" y1="200" x2="244" y2="200" stroke="#8a8a8a" stroke-width="1"/>
  <text x="228" y="134" text-anchor="end" font-size="13" fill="#222222">L</text>

  <!-- 主公式 -->
  <text x="260" y="292" text-anchor="middle" font-size="13" fill="#c0392b" font-weight="600">f_c = c/(4L)，TL = 10lg[1 + ¼(m·tan(2πL/λ))²]</text>
</svg>`;

export const WOVEN_DIAGRAM = `
<svg viewBox="0 0 520 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="编织管消音器几何示意">
  <!-- 编织管管壁：上下两条带厚度的壁 -->
  <rect x="60" y="118" width="400" height="14" fill="#eaeaea" stroke="#222222" stroke-width="1.8"/>
  <rect x="60" y="196" width="400" height="14" fill="#eaeaea" stroke="#222222" stroke-width="1.8"/>

  <!-- 微孔阵列：沿管壁均匀分布的细孔 -->
  <g stroke="#222222" stroke-width="1.4">
    <line x1="80" y1="118" x2="80" y2="132"/><line x1="110" y1="118" x2="110" y2="132"/>
    <line x1="140" y1="118" x2="140" y2="132"/><line x1="170" y1="118" x2="170" y2="132"/>
    <line x1="200" y1="118" x2="200" y2="132"/><line x1="230" y1="118" x2="230" y2="132"/>
    <line x1="260" y1="118" x2="260" y2="132"/><line x1="290" y1="118" x2="290" y2="132"/>
    <line x1="320" y1="118" x2="320" y2="132"/><line x1="350" y1="118" x2="350" y2="132"/>
    <line x1="380" y1="118" x2="380" y2="132"/><line x1="410" y1="118" x2="410" y2="132"/>
    <line x1="440" y1="118" x2="440" y2="132"/>
    <line x1="80" y1="196" x2="80" y2="210"/><line x1="110" y1="196" x2="110" y2="210"/>
    <line x1="140" y1="196" x2="140" y2="210"/><line x1="170" y1="196" x2="170" y2="210"/>
    <line x1="200" y1="196" x2="200" y2="210"/><line x1="230" y1="196" x2="230" y2="210"/>
    <line x1="260" y1="196" x2="260" y2="210"/><line x1="290" y1="196" x2="290" y2="210"/>
    <line x1="320" y1="196" x2="320" y2="210"/><line x1="350" y1="196" x2="350" y2="210"/>
    <line x1="380" y1="196" x2="380" y2="210"/><line x1="410" y1="196" x2="410" y2="210"/>
    <line x1="440" y1="196" x2="440" y2="210"/>
  </g>

  <!-- 管壁孔隙率说明 -->
  <text x="72" y="106" text-anchor="start" font-size="12" fill="#222222">微孔阵列（孔隙率 σ）</text>

  <!-- 微孔放大引线：d 与壁厚 t -->
  <line x1="230" y1="118" x2="300" y2="58" stroke="#8a8a8a" stroke-width="1"/>
  <circle cx="230" cy="118" r="4" fill="none" stroke="#8a8a8a" stroke-width="1"/>
  <text x="304" y="52" text-anchor="start" font-size="12" fill="#222222">微孔等效直径 d</text>
  <text x="304" y="70" text-anchor="start" font-size="12" fill="#222222">管壁厚度 t</text>

  <!-- 内径 D 尺寸：竖向尺寸线置于管左侧 -->
  <line x1="44" y1="132" x2="44" y2="196" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="38" y1="132" x2="50" y2="132" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="38" y1="196" x2="50" y2="196" stroke="#8a8a8a" stroke-width="1"/>
  <text x="34" y="168" text-anchor="end" font-size="13" fill="#222222">D</text>

  <!-- 管长 L 尺寸：横向尺寸线置于管下方 -->
  <line x1="60" y1="228" x2="460" y2="228" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="60" y1="222" x2="60" y2="234" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="460" y1="222" x2="460" y2="234" stroke="#8a8a8a" stroke-width="1"/>
  <text x="260" y="248" text-anchor="middle" font-size="13" fill="#222222">L</text>

  <!-- 主公式 -->
  <text x="260" y="288" text-anchor="middle" font-size="12" fill="#c0392b" font-weight="600">R_w = 32μt/(σρcd²)·[√(1+k²/32) + (√2/32)·k·d/t]，TL = 8.686·α·L</text>
</svg>`;
