/** 声学（NVH）领域示意图（内联 SVG，随公式元数据一起交付，离线可用） */

export const HELMHOLTZ_DIAGRAM = `
<svg viewBox="0 0 520 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="亥姆霍兹消音器几何示意">
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
  <text x="72" y="106" text-anchor="start" font-size="12" fill="#222222">编织丝网管壁（孔隙率 φ，流阻率 σf）</text>

  <!-- 管壁放大引线：壁厚 t -->
  <line x1="230" y1="118" x2="300" y2="58" stroke="#8a8a8a" stroke-width="1"/>
  <circle cx="230" cy="118" r="4" fill="none" stroke="#8a8a8a" stroke-width="1"/>
  <text x="304" y="52" text-anchor="start" font-size="12" fill="#222222">编织管壁（JCA 等效流体层）</text>
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

export const MULTI_CAVITY_DIAGRAM = `
<svg viewBox="0 0 520 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="多腔穿孔消声器几何示意">
  <!-- 外壳 -->
  <rect x="60" y="96" width="400" height="120" rx="6" fill="#f7f7f7" stroke="#222222" stroke-width="1.8"/>

  <!-- 四腔分隔（三道隔板） -->
  <line x1="160" y1="96" x2="160" y2="216" stroke="#222222" stroke-width="2.4"/>
  <line x1="260" y1="96" x2="260" y2="216" stroke="#222222" stroke-width="2.4"/>
  <line x1="360" y1="96" x2="360" y2="216" stroke="#222222" stroke-width="2.4"/>

  <!-- 腔体标注 -->
  <text x="110" y="118" text-anchor="middle" font-size="11" fill="#555555">腔 1</text>
  <text x="210" y="118" text-anchor="middle" font-size="11" fill="#555555">腔 2</text>
  <text x="310" y="118" text-anchor="middle" font-size="11" fill="#555555">腔 3</text>
  <text x="410" y="118" text-anchor="middle" font-size="11" fill="#555555">腔 4</text>

  <!-- 主管（含穿孔段） -->
  <rect x="40" y="140" width="440" height="34" fill="#ffffff" stroke="#222222" stroke-width="1.6"/>
  <line x1="40" y1="157" x2="480" y2="157" stroke="#c8c8c8" stroke-width="1"/>

  <!-- 穿孔：每腔一组小圆 -->
  <g fill="#222222">
    <circle cx="90" cy="157" r="3"/><circle cx="110" cy="157" r="3"/><circle cx="130" cy="157" r="3"/>
    <circle cx="190" cy="157" r="3"/><circle cx="210" cy="157" r="3"/><circle cx="230" cy="157" r="3"/>
    <circle cx="290" cy="157" r="3"/><circle cx="310" cy="157" r="3"/><circle cx="330" cy="157" r="3"/>
    <circle cx="390" cy="157" r="3"/><circle cx="410" cy="157" r="3"/><circle cx="430" cy="157" r="3"/>
  </g>

  <!-- 进出口 -->
  <line x1="20" y1="157" x2="40" y2="157" stroke="#222222" stroke-width="3"/>
  <line x1="480" y1="157" x2="500" y2="157" stroke="#222222" stroke-width="3"/>
  <text x="22" y="146" text-anchor="middle" font-size="11" fill="#222222">入</text>
  <text x="498" y="146" text-anchor="middle" font-size="11" fill="#222222">出</text>

  <!-- 尺寸标注：dout（腔体外径）、din（主管内径）、Lc（腔宽）、dh（孔径） -->
  <line x1="36" y1="96" x2="36" y2="216" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="30" y1="96" x2="42" y2="96" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="30" y1="216" x2="42" y2="216" stroke="#8a8a8a" stroke-width="1"/>
  <text x="26" y="160" text-anchor="end" font-size="12" fill="#222222">d_out</text>

  <line x1="52" y1="140" x2="52" y2="174" stroke="#8a8a8a" stroke-width="1"/>
  <text x="58" y="136" text-anchor="start" font-size="11" fill="#222222">d_in</text>

  <line x1="160" y1="228" x2="260" y2="228" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="160" y1="222" x2="160" y2="234" stroke="#8a8a8a" stroke-width="1"/>
  <line x1="260" y1="222" x2="260" y2="234" stroke="#8a8a8a" stroke-width="1"/>
  <text x="210" y="247" text-anchor="middle" font-size="12" fill="#222222">L_c,i</text>

  <line x1="110" y1="157" x2="110" y2="190" stroke="#8a8a8a" stroke-width="1"/>
  <text x="112" y="204" text-anchor="start" font-size="11" fill="#222222">d_h</text>

  <!-- 主公式 -->
  <text x="260" y="286" text-anchor="middle" font-size="12" fill="#c0392b" font-weight="600">Φ = exp(A·L_c)，T_cav = Φ11 − Φ12[:,1]·Φ21[2,:]/Φ22[2,1]，TL = 20lg(|T11+T12+T21+T22|/2)</text>
</svg>`;

/**
 * 进气系统传递损失（TL）构成示意：
 * 上部为「入射声 → 进气管 → 波纹管 → 编织管 → 空滤器（含滤芯） → 出气管 → 多腔穿孔消音器 → 透射声」
 * 的链路及各段长度；中部为各部件传递矩阵逐级串联；下部为总传递矩阵与 TL 计算式。
 */
export const INTAKE_TL_DIAGRAM = `
<svg class="diagram-wide" viewBox="0 0 760 380" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="进气系统传递损失设计示意">
  <defs>
    <marker id="tlsArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#5b6f8a"/>
    </marker>
    <marker id="tlsRed" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
      <path d="M0,0 L12,6 L0,12 z" fill="#c0392b"/>
    </marker>
    <marker id="tlsGreen" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
      <path d="M0,0 L12,6 L0,12 z" fill="#1e8449"/>
    </marker>
    <marker id="tlsDim" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse">
      <path d="M0,0 L8,4 L0,8 z" fill="#8496b3"/>
    </marker>
    <pattern id="tlsBraid" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="7" stroke="#dbae74" stroke-width="1.6"/>
    </pattern>
    <pattern id="tlsFilter" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="5" stroke="#7f96b3" stroke-width="1.4"/>
    </pattern>
  </defs>

  <text x="380" y="20" text-anchor="middle" font-size="14" fill="#0b3a72" font-weight="600">进气系统传递损失设计示意</text>

  <!-- 入射声 -->
  <text x="14" y="86" font-size="11" fill="#c0392b">入射声 W_in</text>
  <line x1="16" y1="118" x2="50" y2="118" stroke="#c0392b" stroke-width="2" marker-end="url(#tlsRed)"/>

  <!-- 进气喇叭口 -->
  <polygon points="55,88 88,102 88,134 55,148" fill="#e6ecf4" stroke="#5b6f8a" stroke-width="1.8"/>
  <!-- 进气管 -->
  <rect x="88" y="102" width="70" height="32" fill="#e6ecf4" stroke="#5b6f8a" stroke-width="1.8"/>

  <!-- 波纹管 -->
  <rect x="158" y="98" width="76" height="40" fill="#f3f6fa" stroke="#5b6f8a" stroke-width="1.8"/>
  <g stroke="#5b6f8a" stroke-width="1.2">
    <line x1="163" y1="98" x2="163" y2="138"/>
    <line x1="170" y1="98" x2="170" y2="138"/>
    <line x1="177" y1="98" x2="177" y2="138"/>
    <line x1="184" y1="98" x2="184" y2="138"/>
    <line x1="191" y1="98" x2="191" y2="138"/>
    <line x1="198" y1="98" x2="198" y2="138"/>
    <line x1="205" y1="98" x2="205" y2="138"/>
    <line x1="212" y1="98" x2="212" y2="138"/>
    <line x1="219" y1="98" x2="219" y2="138"/>
    <line x1="226" y1="98" x2="226" y2="138"/>
  </g>

  <!-- 编织管 -->
  <rect x="234" y="102" width="66" height="32" fill="url(#tlsBraid)" stroke="#c08a4a" stroke-width="1.8"/>

  <!-- 空滤器（含滤芯） -->
  <rect x="300" y="72" width="104" height="92" fill="#f7f9fc" stroke="#5b6f8a" stroke-width="2"/>
  <rect x="336" y="84" width="18" height="68" fill="url(#tlsFilter)" stroke="#5b6f8a" stroke-width="1.4"/>
  <text x="362" y="122" font-size="10" fill="#5a6b85">滤芯</text>

  <!-- 出气管 -->
  <rect x="404" y="102" width="76" height="32" fill="#e6ecf4" stroke="#5b6f8a" stroke-width="1.8"/>

  <!-- 多腔穿孔消音器 -->
  <rect x="480" y="76" width="134" height="84" fill="#f7f9fc" stroke="#5b6f8a" stroke-width="2"/>
  <rect x="480" y="106" width="134" height="24" fill="#e6ecf4" stroke="#5b6f8a" stroke-width="1.2"/>
  <g stroke="#5b6f8a" stroke-width="1.2">
    <line x1="513.5" y1="76" x2="513.5" y2="106"/>
    <line x1="547" y1="76" x2="547" y2="106"/>
    <line x1="580.5" y1="76" x2="580.5" y2="106"/>
    <line x1="513.5" y1="130" x2="513.5" y2="160"/>
    <line x1="547" y1="130" x2="547" y2="160"/>
    <line x1="580.5" y1="130" x2="580.5" y2="160"/>
  </g>
  <g fill="#1a5fb4">
    <circle cx="490" cy="110" r="1.5"/><circle cx="504" cy="110" r="1.5"/><circle cx="518" cy="110" r="1.5"/>
    <circle cx="532" cy="110" r="1.5"/><circle cx="546" cy="110" r="1.5"/><circle cx="560" cy="110" r="1.5"/>
    <circle cx="574" cy="110" r="1.5"/><circle cx="588" cy="110" r="1.5"/><circle cx="602" cy="110" r="1.5"/>
    <circle cx="490" cy="126" r="1.5"/><circle cx="504" cy="126" r="1.5"/><circle cx="518" cy="126" r="1.5"/>
    <circle cx="532" cy="126" r="1.5"/><circle cx="546" cy="126" r="1.5"/><circle cx="560" cy="126" r="1.5"/>
    <circle cx="574" cy="126" r="1.5"/><circle cx="588" cy="126" r="1.5"/><circle cx="602" cy="126" r="1.5"/>
  </g>
  <rect x="614" y="106" width="26" height="24" fill="#e6ecf4" stroke="#5b6f8a" stroke-width="1.8"/>

  <!-- 透射声 -->
  <text x="746" y="86" text-anchor="end" font-size="11" fill="#1e8449">透射声 W_out</text>
  <line x1="642" y1="118" x2="704" y2="118" stroke="#1e8449" stroke-width="2" marker-end="url(#tlsGreen)"/>

  <!-- 部件名称与引线 -->
  <g font-size="11" fill="#1f2937" text-anchor="middle">
    <text x="123" y="54">进气管</text>
    <text x="196" y="54">波纹管</text>
    <text x="267" y="54">编织管</text>
    <text x="352" y="54">空滤器（含滤芯）</text>
    <text x="442" y="54">出气管</text>
    <text x="547" y="54">多腔穿孔消音器</text>
  </g>
  <g stroke="#9fb0c7" stroke-width="1">
    <line x1="123" y1="58" x2="123" y2="100"/>
    <line x1="196" y1="58" x2="196" y2="96"/>
    <line x1="267" y1="58" x2="267" y2="100"/>
    <line x1="352" y1="58" x2="352" y2="70"/>
    <line x1="442" y1="58" x2="442" y2="100"/>
    <line x1="547" y1="58" x2="547" y2="74"/>
  </g>

  <!-- 各段长度 -->
  <g stroke="#8496b3" stroke-width="1.2" marker-start="url(#tlsDim)" marker-end="url(#tlsDim)">
    <line x1="88" y1="182" x2="158" y2="182"/>
    <line x1="158" y1="182" x2="234" y2="182"/>
    <line x1="234" y1="182" x2="300" y2="182"/>
    <line x1="300" y1="182" x2="404" y2="182"/>
    <line x1="404" y1="182" x2="480" y2="182"/>
    <line x1="480" y1="182" x2="614" y2="182"/>
  </g>
  <g font-size="10.5" fill="#5a6b85" text-anchor="middle">
    <text x="123" y="175">L_in</text>
    <text x="196" y="175">L_D</text>
    <text x="267" y="175">L_br</text>
    <text x="352" y="175">L_air</text>
    <text x="442" y="175">L_out</text>
    <text x="547" y="175">L_m</text>
  </g>

  <!-- 传递矩阵逐级串联 -->
  <g fill="#eef4ff" stroke="#1a5fb4" stroke-width="1.6">
    <rect x="26" y="236" width="84" height="44" rx="4"/>
    <rect x="132" y="236" width="84" height="44" rx="4"/>
    <rect x="238" y="236" width="84" height="44" rx="4"/>
    <rect x="344" y="236" width="84" height="44" rx="4"/>
    <rect x="450" y="236" width="84" height="44" rx="4"/>
    <rect x="556" y="236" width="84" height="44" rx="4"/>
  </g>
  <g font-size="12.5" font-style="italic" fill="#0b3a72" text-anchor="middle">
    <text x="68" y="262">T_in</text>
    <text x="174" y="262">T_D</text>
    <text x="280" y="262">T_br</text>
    <text x="386" y="262">T_air</text>
    <text x="492" y="262">T_out</text>
    <text x="598" y="262">T_m</text>
  </g>
  <g font-size="10" fill="#5a6b85" text-anchor="middle">
    <text x="68" y="300">进气管</text>
    <text x="174" y="300">波纹管</text>
    <text x="280" y="300">编织管</text>
    <text x="386" y="300">空滤器</text>
    <text x="492" y="300">出气管</text>
    <text x="598" y="300">消音器</text>
  </g>

  <!-- 串联箭头 -->
  <g stroke="#8496b3" stroke-width="1.5" marker-end="url(#tlsArrow)">
    <line x1="110" y1="258" x2="128" y2="258"/>
    <line x1="216" y1="258" x2="234" y2="258"/>
    <line x1="322" y1="258" x2="340" y2="258"/>
    <line x1="428" y1="258" x2="446" y2="258"/>
    <line x1="534" y1="258" x2="552" y2="258"/>
    <line x1="640" y1="258" x2="684" y2="258"/>
  </g>
  <text x="692" y="263" font-size="13" fill="#c0392b" font-weight="600">TL</text>

  <!-- 汇总公式 -->
  <text x="380" y="338" text-anchor="middle" font-size="11.5" fill="#1f2937">T_sys = T_in · T_D · T_br · T_air · T_out · T_m</text>
  <text x="380" y="362" text-anchor="middle" font-size="11.5" fill="#c0392b" font-weight="600">TL = 20 lg[(T11 + T12 + T21 + T22) / 2]</text>
</svg>`;
