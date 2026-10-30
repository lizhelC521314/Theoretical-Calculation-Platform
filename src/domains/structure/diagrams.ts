/**
 * 结构设计域示意图
 */
export const FILTER_DIAGRAM = `
<svg viewBox="0 0 420 240" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="420" height="240" fill="#ffffff"/>
  <text x="12" y="22" font-size="13" fill="#222222" font-weight="bold">圆柱折叠式滤芯（径向褶皱）</text>

  <!-- 端面剖视：外径 D、内径 d、褶皱示意 -->
  <circle cx="110" cy="140" r="70" fill="none" stroke="#222222" stroke-width="2"/>
  <circle cx="110" cy="140" r="42" fill="none" stroke="#222222" stroke-width="2"/>
  <g stroke="#4a79b4" stroke-width="1">
    <line x1="110" y1="70" x2="110" y2="98"/>
    <line x1="110" y1="182" x2="110" y2="210"/>
    <line x1="40" y1="140" x2="68" y2="140"/>
    <line x1="152" y1="140" x2="180" y2="140"/>
    <line x1="60" y1="90" x2="80" y2="110"/>
    <line x1="140" y1="170" x2="160" y2="190"/>
    <line x1="160" y1="90" x2="140" y2="110"/>
    <line x1="80" y1="170" x2="60" y2="190"/>
  </g>
  <line x1="110" y1="140" x2="180" y2="140" stroke="#b44a4a" stroke-width="1" marker-end="none"/>
  <text x="132" y="134" font-size="11" fill="#b44a4a">D/2</text>
  <line x1="110" y1="140" x2="145" y2="175" stroke="#3a7d44" stroke-width="1"/>
  <text x="122" y="168" font-size="11" fill="#3a7d44">d/2</text>
  <text x="92" y="230" font-size="11" fill="#222222">褶距 p</text>

  <!-- 侧视：长度 L、褶高 h -->
  <rect x="230" y="80" width="150" height="120" fill="none" stroke="#222222" stroke-width="2"/>
  <g stroke="#4a79b4" stroke-width="1">
    <line x1="242" y1="80" x2="242" y2="200"/>
    <line x1="254" y1="80" x2="254" y2="200"/>
    <line x1="266" y1="80" x2="266" y2="200"/>
    <line x1="278" y1="80" x2="278" y2="200"/>
    <line x1="290" y1="80" x2="290" y2="200"/>
    <line x1="302" y1="80" x2="302" y2="200"/>
    <line x1="314" y1="80" x2="314" y2="200"/>
    <line x1="326" y1="80" x2="326" y2="200"/>
    <line x1="338" y1="80" x2="338" y2="200"/>
    <line x1="350" y1="80" x2="350" y2="200"/>
    <line x1="362" y1="80" x2="362" y2="200"/>
  </g>
  <line x1="230" y1="216" x2="380" y2="216" stroke="#222222" stroke-width="1"/>
  <line x1="230" y1="211" x2="230" y2="221" stroke="#222222" stroke-width="1"/>
  <line x1="380" y1="211" x2="380" y2="221" stroke="#222222" stroke-width="1"/>
  <text x="296" y="231" font-size="12" fill="#222222">L</text>
  <text x="236" y="70" font-size="11" fill="#222222">褶高 h = (D − d) / 2</text>
  <text x="236" y="52" font-size="11" fill="#666666">气流：径向由外向内</text>
</svg>
`;
