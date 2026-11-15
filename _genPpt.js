/* eslint-disable */
// 进气系统理论设计平台设想 — 生成脚本 (简化版，直接用原生 pptxgenjs)
// 运行：node _genPpt.js
const pptxgen = require('pptxgenjs');
const path = require('path');

// ============================================================
// SLIDE DIMENSIONS + THEME
// ============================================================
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN_L = 0.6, MARGIN_R = 0.6;
const MARGIN_T = 0.55, MARGIN_B = 0.45;
const CONTENT_X = MARGIN_L;
const CONTENT_Y = MARGIN_T;
const CONTENT_W = SLIDE_W - MARGIN_L - MARGIN_R;
const CONTENT_H = SLIDE_H - MARGIN_T - MARGIN_B;

// 配色：兵器工业蓝 + 科技灰
const C = {
  primary:    '0B3D91',
  secondary:  '1E5BB8',
  accent:     'E8921B',
  textDark:   '1A1A2E',
  textMid:    '3A3F4B',
  textLight:  '6B7280',
  bgLight:    'F4F6FB',
  bgBlue:     '0B3D91',
  white:      'FFFFFF',
  line:       'D1D5DB',
  success:    '16A34A',
  warn:       'D97706',
  danger:     'DC2626',
};

const FONT = '微软雅黑';
const TOTAL_SLIDES = 29;

// ============================================================
// HELPERS
// ============================================================
function addFoot(slide, chapterLabel, slideNum) {
  // 左侧装饰条
  slide.addShape('rect', { x: 0, y: 0, w: 0.22, h: SLIDE_H, fill: { color: C.primary }, line: { color: C.primary } });
  slide.addText(`${slideNum} / ${TOTAL_SLIDES}`, { x: SLIDE_W - 1.4, y: SLIDE_H - 0.35, w: 1.2, h: 0.28, fontSize: 9, color: C.textLight, align: 'right', fontFace: FONT });
  slide.addText('成都万友滤机有限公司', { x: 0.45, y: SLIDE_H - 0.35, w: 2.5, h: 0.28, fontSize: 9, color: C.textLight, align: 'left', fontFace: FONT });
  if (chapterLabel) {
    slide.addText(chapterLabel, { x: SLIDE_W - 3.0, y: 0.18, w: 2.6, h: 0.36, fontSize: 10, color: C.primary, align: 'right', fontFace: FONT, bold: true });
  }
}

function addTitle(slide, title, subtitle) {
  slide.addText(title, {
    x: CONTENT_X, y: CONTENT_Y, w: CONTENT_W, h: 0.55,
    fontSize: 22, bold: true, color: C.textDark, fontFace: FONT, charSpacing: 1.5,
  });
  slide.addShape('rect', { x: CONTENT_X, y: CONTENT_Y + 0.58, w: 0.55, h: 0.07, fill: { color: C.accent }, line: { color: C.accent } });
  if (subtitle) {
    slide.addText(subtitle, {
      x: CONTENT_X + 0.65, y: CONTENT_Y + 0.5, w: CONTENT_W - 0.7, h: 0.42,
      fontSize: 12, color: C.textLight, fontFace: FONT, italic: true,
    });
  }
}

function addChapterCover(pres, num, title, sub) {
  const s = pres.addSlide();
  s.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: C.bgBlue }, line: { color: C.bgBlue } });
  s.addText(`0${num}`, { x: CONTENT_X, y: CONTENT_Y + 0.6, w: 3.5, h: 2.0, fontSize: 120, bold: true, color: C.white, fontFace: FONT, charSpacing: 3 });
  s.addShape('rect', { x: CONTENT_X, y: CONTENT_Y + 2.85, w: 1.2, h: 0.09, fill: { color: C.accent }, line: { color: C.accent } });
  s.addText(title, { x: CONTENT_X, y: CONTENT_Y + 3.05, w: SLIDE_W - CONTENT_X, h: 0.9, fontSize: 40, bold: true, color: C.white, fontFace: FONT, charSpacing: 2 });
  if (sub) s.addText(sub, { x: CONTENT_X, y: CONTENT_Y + 4.05, w: SLIDE_W - CONTENT_X, h: 0.5, fontSize: 16, color: 'CFE0FA', fontFace: FONT });
  return s;
}

function addCard(slide, x, y, w, h, fill = C.white, borderColor = C.line, radius = 0.08) {
  slide.addShape('rect', { x, y, w, h, fill: { color: fill }, line: { color: borderColor }, rectRadius: radius, shadow: { type: 'outer', color: 'B0B8C8', blur: 3, offset: 1 } });
}

// ============================================================
// MAIN PRESENTATION
// ============================================================
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.author = '成都万友滤机有限公司';
pres.title = '进气系统理论设计平台设想';

let slideNum = 0;

// ============ Slide 1: 封面 ============
slideNum = 1;
{
  const s = pres.addSlide();
  s.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: C.bgBlue }, line: { color: C.bgBlue } });
  s.addShape('triangle', { x: 0, y: 0, w: 2.0, h: 2.0, fill: { color: C.accent }, line: { color: C.accent }, rotate: 270 });
  s.addShape('rect', { x: 0.22, y: 2.4, w: 1.0, h: 0.06, fill: { color: C.accent }, line: { color: C.accent } });
  s.addShape('rect', { x: 0.22, y: 2.55, w: 0.5, h: 0.03, fill: { color: C.white, transparency: 40 }, line: { color: C.white, transparency: 40 } });

  s.addText('进气系统理论设计平台', {
    x: 0.6, y: 2.8, w: SLIDE_W - 1.2, h: 1.1,
    fontSize: 46, bold: true, color: C.white, fontFace: FONT, charSpacing: 4,
  });
  s.addText('设 计 平 台 设 想', {
    x: 0.6, y: 3.85, w: SLIDE_W - 1.2, h: 0.7,
    fontSize: 30, bold: true, color: 'CFE0FA', fontFace: FONT, charSpacing: 8,
  });
  s.addText('—— 公式内核 · 产品定义 · 数据资产 · 知识沉淀的一体化解决方案', {
    x: 0.6, y: 4.65, w: SLIDE_W - 1.2, h: 0.5,
    fontSize: 15, color: 'A8BFDE', fontFace: FONT,
  });

  // 右下角信息框：用 accent 色半透明，确保白色文字对比度
  s.addShape('rect', { x: SLIDE_W - 5.0, y: SLIDE_H - 1.6, w: 4.6, h: 1.3, fill: { color: '153578' }, line: { color: C.accent }, rectRadius: 0.08 });
  s.addText('汇报单位：成都万友滤机有限公司', { x: SLIDE_W - 4.9, y: SLIDE_H - 1.5, w: 4.4, h: 0.35, fontSize: 13, color: C.white, fontFace: FONT });
  s.addText('所属集团：西南兵器工业 · 中国兵器', { x: SLIDE_W - 4.9, y: SLIDE_H - 1.15, w: 4.4, h: 0.35, fontSize: 12, color: 'CFE0FA', fontFace: FONT });
  s.addText('2026 年 11 月', { x: SLIDE_W - 4.9, y: SLIDE_H - 0.8, w: 4.4, h: 0.3, fontSize: 12, color: C.accent, fontFace: FONT, bold: true });

  s.addText('中国兵器  NORINCO GROUP', { x: 0.6, y: SLIDE_H - 0.82, w: 2.8, h: 0.44, fontSize: 14, bold: true, color: C.white, fontFace: FONT });
}

// ============ Slide 2: 目录 ============
slideNum = 2;
{
  const s = pres.addSlide();
  addFoot(s, 'CONTENTS', slideNum);
  addTitle(s, '汇报提纲', 'CONTENTS');

  const items = [
    { num: '01', title: '建设背景', desc: '现状痛点 · 核心问题 · 建设目标' },
    { num: '02', title: '总体架构', desc: '平台定位 · 技术架构 · 数据流转' },
    { num: '03', title: '公式内核', desc: '11 类进气系统设计公式库' },
    { num: '04', title: '产品定义库', desc: '需求—参数—计算—证据—基线 五表闭环' },
    { num: '05', title: '数据资产体系', desc: '材料 · 试验 · CAE · 知识经验 · FMEA' },
    { num: '06', title: '关键保障能力', desc: '数据质量分级 · 导出加密 · 双版本交付' },
    { num: '07', title: '实施与展望', desc: '阶段成果 · 效益指标 · 未来规划 · IP 布局' },
  ];

  const cardW = (CONTENT_W - 0.6) / 4;
  const cardH = 1.75;
  const startX = CONTENT_X;
  const row1Y = CONTENT_Y + 1.25;
  const row2Y = row1Y + cardH + 0.2;

  items.forEach((it, idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const x = startX + col * (cardW + 0.2);
    const y = row === 0 ? row1Y : row2Y;
    addCard(s, x, y, cardW, cardH);
    s.addText(it.num, { x: x + 0.15, y: y + 0.1, w: cardW - 0.3, h: 0.55, fontSize: 30, bold: true, color: C.primary, fontFace: FONT, charSpacing: 1 });
    s.addShape('rect', { x: x + 0.15, y: y + 0.7, w: 0.5, h: 0.05, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText(it.title, { x: x + 0.15, y: y + 0.82, w: cardW - 0.3, h: 0.42, fontSize: 16, bold: true, color: C.textDark, fontFace: FONT });
    s.addText(it.desc, { x: x + 0.15, y: y + 1.25, w: cardW - 0.3, h: 0.45, fontSize: 10.5, color: C.textMid, fontFace: FONT, valign: 'top' });
  });
}

// ============ Chapter 1: 建设背景 ============
slideNum = 3;
addChapterCover(pres, 1, '建设背景', '现状痛点 · 核心问题 · 建设目标');

// --- Slide 4: 现状 ---
slideNum = 4;
{
  const s = pres.addSlide();
  addFoot(s, '01 / 建设背景', slideNum);
  addTitle(s, '行业现状：经验驱动的设计模式正在逼近天花板', '三个核心痛点，制约设计效率与质量');

  const pains = [
    { icon: '📊', title: '口径不一', body: '同一工况由不同工程师计算，压降与噪声结果难以互认。公式分散在 Excel 中，无版本控制、无量程校验。' },
    { icon: '📁', title: '数据分散', body: '材料卡、试验报告、仿真报告散落在个人目录或共享盘；字段不统一，来源与版本无法追溯。' },
    { icon: '🧠', title: '依赖个人', body: '校核判据停留在个人经验层面；工程师离开后知识流失严重；新人难以快速上手与复用。' },
  ];
  const pcW = (CONTENT_W - 0.6) / 3;
  pains.forEach((p, i) => {
    const x = CONTENT_X + i * (pcW + 0.3);
    const y = CONTENT_Y + 1.35;
    addCard(s, x, y, pcW, 3.2);
    s.addShape('rect', { x: x + 0.15, y: y + 0.15, w: 0.5, h: 0.5, fill: { color: C.primary }, line: { color: C.primary }, rectRadius: 0.06 });
    s.addText(String(i + 1), { x: x + 0.15, y: y + 0.15, w: 0.5, h: 0.5, fontSize: 18, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle' });
    s.addText(p.icon, { x: x + 0.72, y: y + 0.15, w: 0.6, h: 0.5, fontSize: 28, align: 'center' });
    s.addText(p.title, { x: x + 0.15, y: y + 0.75, w: pcW - 0.3, h: 0.4, fontSize: 18, bold: true, color: C.primary, fontFace: FONT });
    s.addShape('rect', { x: x + 0.15, y: y + 1.18, w: pcW - 0.3, h: 0.04, fill: { color: C.line }, line: { color: C.line } });
    s.addText(p.body, { x: x + 0.15, y: y + 1.3, w: pcW - 0.3, h: 1.7, fontSize: 12.5, color: C.textMid, fontFace: FONT, valign: 'top' });
  });

  const y2 = CONTENT_Y + 4.7;
  s.addShape('rect', { x: CONTENT_X, y: y2, w: CONTENT_W, h: 1.6, fill: { color: 'FFF7ED' }, line: { color: C.accent }, rectRadius: 0.06 });
  s.addText('问题的本质', { x: CONTENT_X + 0.25, y: y2 + 0.12, w: CONTENT_W - 0.5, h: 0.35, fontSize: 14, bold: true, color: C.accent, fontFace: FONT });
  s.addText('设计知识以"人脑 + Excel"为载体，无法形成可复用、可追溯、可验证的数字资产。\n方案阶段缺少快速、可靠的量化计算手段，导致大量问题被延迟到试制和试验阶段才暴露。', {
    x: CONTENT_X + 0.25, y: y2 + 0.5, w: CONTENT_W - 0.5, h: 1.0,
    fontSize: 13, color: C.textDark, fontFace: FONT, valign: 'top',
  });
}

// --- Slide 5: 建设目标 ---
slideNum = 5;
{
  const s = pres.addSlide();
  addFoot(s, '01 / 建设背景', slideNum);
  addTitle(s, '建设目标：公式—计算—验证—数据 闭环', '设计阶段即可量化，把"能算的都算准"');

  const y1 = CONTENT_Y + 1.3;
  s.addShape('rect', { x: CONTENT_X, y: y1, w: CONTENT_W, h: 1.2, fill: { color: C.bgBlue }, line: { color: C.bgBlue }, rectRadius: 0.08 });
  s.addText('建成"公式内核 + 产品定义 + 数据资产 + 知识沉淀"四位一体的进气系统理论设计平台', {
    x: CONTENT_X + 0.3, y: y1 + 0.25, w: CONTENT_W - 0.6, h: 0.7,
    fontSize: 20, bold: true, color: C.white, fontFace: FONT, charSpacing: 1.5,
  });

  const goals = [
    { label: '一数一源', desc: '材料、试验、CAE 数据统一建模 · 一处录入 · 全平台复用' },
    { label: '一键计算', desc: '11 类专业公式即选即用 · 参数校验 · 灵敏度分析 · 计算书导出' },
    { label: '一链追溯', desc: '需求 → 参数 → 计算 → 证据 → 基线 全链路可追溯' },
  ];
  const gW = (CONTENT_W - 0.4) / 3;
  goals.forEach((g, i) => {
    const x = CONTENT_X + i * (gW + 0.2);
    const y = y1 + 1.45;
    addCard(s, x, y, gW, 2.1);
    s.addShape('rect', { x, y, w: gW, h: 0.07, fill: { color: C.accent }, line: { color: C.accent }, rectRadius: 0.08 });
    s.addText(g.label, { x: x + 0.15, y: y + 0.2, w: gW - 0.3, h: 0.6, fontSize: 26, bold: true, color: C.accent, fontFace: FONT, charSpacing: 2 });
    s.addShape('rect', { x: x + 0.15, y: y + 0.8, w: 0.5, h: 0.04, fill: { color: C.primary }, line: { color: C.primary } });
    s.addText(g.desc, { x: x + 0.15, y: y + 0.92, w: gW - 0.3, h: 1.0, fontSize: 12, color: C.textMid, fontFace: FONT, valign: 'top' });
  });

  const y3 = y1 + 3.8;
  s.addShape('rect', { x: CONTENT_X, y: y3, w: CONTENT_W, h: 0.04, fill: { color: C.line }, line: { color: C.line } });
  s.addText('平台不替代仿真和试验，而是把"该算的、能算的"在方案阶段先算准，把仿真与试验留给关键验证', {
    x: CONTENT_X, y: y3 + 0.1, w: CONTENT_W, h: 0.35,
    fontSize: 12, italic: true, color: C.textLight, fontFace: FONT, align: 'center',
  });
}

// ============ Chapter 2: 总体架构 ============
slideNum = 6;
addChapterCover(pres, 2, '总体架构', '平台定位 · 技术架构 · 数据流转');

// --- Slide 7: 技术架构 ---
slideNum = 7;
{
  const s = pres.addSlide();
  addFoot(s, '02 / 总体架构', slideNum);
  addTitle(s, '四层架构：应用层 · 公式内核层 · 数据资产层 · 基础设施层', 'Electron + React 桌面端 · 服务器集中存储');

  const layers = [
    { label: '应用层', color: C.primary, items: ['工作台', '项目管理', '公式计算', '产品定义库', '产品验证', '产品数据库', '知识经验库', '设置'] },
    { label: '公式内核层', color: C.secondary, items: ['11 类设计公式', '参数量程校验', '灵敏度分析', '回算求解', '计算链路', '不确定度', '计算书导出'] },
    { label: '数据资产层', color: C.accent, items: ['材料库(4类)', '试验报告库', 'CAE 报告库', '产品数据库', '知识经验库(6类)', 'FMEA 库', '培训资料'] },
    { label: '基础设施层', color: C.textMid, items: ['Electron 主进程', 'React 渲染前端', '本地加密存储', '服务器共享目录', '账号权限体系', 'AES-256 加密引擎', '离线授权令牌'] },
  ];

  const layerH = (CONTENT_H - 2.0) / 4;
  layers.forEach((layer, i) => {
    const y = CONTENT_Y + 1.3 + i * (layerH + 0.08);
    s.addShape('rect', { x: CONTENT_X, y, w: CONTENT_W, h: layerH, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });
    s.addShape('rect', { x: CONTENT_X, y, w: 1.4, h: layerH, fill: { color: layer.color }, line: { color: layer.color }, rectRadius: 0.06 });
    s.addText(layer.label, { x: CONTENT_X, y, w: 1.4, h: layerH, fontSize: 14, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle', charSpacing: 1 });
    const items = layer.items;
    const padX = 0.25;
    const totalItemW = CONTENT_W - 1.4 - padX * 2;
    const gap = 0.1;
    const itemW = (totalItemW - gap * (items.length - 1)) / items.length;
    items.forEach((it, j) => {
      const ix = CONTENT_X + 1.4 + padX + j * (itemW + gap);
      s.addShape('rect', { x: ix, y: y + 0.12, w: itemW, h: layerH - 0.24, fill: { color: C.white }, line: { color: layer.color }, rectRadius: 0.04 });
      s.addText(it, { x: ix, y: y + 0.12, w: itemW, h: layerH - 0.24, fontSize: 10.5, color: C.textDark, fontFace: FONT, align: 'center', valign: 'middle' });
    });
  });
}

// --- Slide 8: 数据流转 ---
slideNum = 8;
{
  const s = pres.addSlide();
  addFoot(s, '02 / 总体架构', slideNum);
  addTitle(s, '数据集中存于服务器共享目录，本地不留副本', 'UNC 路径白名单 · 统一命名规范 · 版本留痕');

  const y1 = CONTENT_Y + 1.2;
  s.addShape('rect', { x: CONTENT_X, y: y1, w: CONTENT_W, h: 1.1, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });
  s.addText('部署方式', { x: CONTENT_X + 0.25, y: y1 + 0.1, w: 1.6, h: 0.36, fontSize: 14, bold: true, color: C.primary, fontFace: FONT });
  s.addText('桌面端安装即用，数据集中存放于 \\\\10.1.1.245 共享服务器，本地不留副本', { x: CONTENT_X + 0.25, y: y1 + 0.48, w: CONTENT_W - 0.5, h: 0.5, fontSize: 14, color: C.textDark, fontFace: FONT });

  const objs = [
    { label: '计算记录', desc: '一次计算=一条 JSON（公式版本/输入参数/全部输出/时间戳/操作人）' },
    { label: '数据资产', desc: 'PDF 文档 + 同名 JSON 元数据（曲线数据独立存储）' },
    { label: '产品档案', desc: '发布即归档为五表 Excel（需求/参数/计算/基线/变型）' },
  ];
  const obW = (CONTENT_W - 0.4) / 3;
  objs.forEach((o, i) => {
    const x = CONTENT_X + i * (obW + 0.2);
    const y = y1 + 1.35;
    addCard(s, x, y, obW, 1.8);
    s.addShape('rect', { x, y, w: obW, h: 0.06, fill: { color: [C.primary, C.secondary, C.accent][i] }, line: { color: [C.primary, C.secondary, C.accent][i] }, rectRadius: 0.06 });
    s.addText(o.label, { x: x + 0.15, y: y + 0.18, w: obW - 0.3, h: 0.45, fontSize: 15, bold: true, color: C.primary, fontFace: FONT });
    s.addShape('rect', { x: x + 0.15, y: y + 0.65, w: obW - 0.3, h: 0.04, fill: { color: C.line }, line: { color: C.line } });
    s.addText(o.desc, { x: x + 0.15, y: y + 0.75, w: obW - 0.3, h: 1.0, fontSize: 11.5, color: C.textMid, fontFace: FONT, valign: 'top' });
  });

  const y2 = y1 + 3.4;
  const items = [
    { icon: '🔒', text: '导出加密\n(AES-256-GCM)' },
    { icon: '📝', text: '版本留痕\n时间/操作人' },
    { icon: '🔗', text: 'UNC 白名单\n防越权' },
    { icon: '📦', text: '统一命名\n类型+牌号+温度' },
  ];
  items.forEach((it, i) => {
    const ix = CONTENT_X + i * (CONTENT_W / 4);
    s.addText(it.icon, { x: ix, y: y2, w: CONTENT_W / 4, h: 0.45, fontSize: 26, align: 'center' });
    s.addText(it.text, { x: ix, y: y2 + 0.48, w: CONTENT_W / 4, h: 0.85, fontSize: 11, color: C.textMid, fontFace: FONT, align: 'center', valign: 'top' });
  });
}

// ============ Chapter 3: 公式内核 ============
slideNum = 9;
addChapterCover(pres, 3, '公式内核', '11 类进气系统设计公式库');

// --- Slide 10: 公式全景 ---
slideNum = 10;
{
  const s = pres.addSlide();
  addFoot(s, '03 / 公式内核', slideNum);
  addTitle(s, '三大领域 · 11 个公式模块', '流动阻力 · 结构设计 · 声学消声');

  const formulas = [
    { cat: '流动阻力', color: C.primary, items: [
      { name: '进气系统阻力设计', out: '各段压降 · 总阻 · 优化建议' },
      { name: '多孔介质性能拟合', out: '粘性/惯性阻力系数 · R²' },
      { name: '压力修正', out: '试验工况→标准状态换算' },
    ]},
    { cat: '结构设计', color: C.secondary, items: [
      { name: '空气滤清器滤芯设计', out: '有效过滤面积 · 褶皱数 · 压降' },
      { name: '橡胶进气软管全几何反算', out: '壁厚 · 层数 · 行程 · 阻尼' },
    ]},
    { cat: '声学消声', color: C.accent, items: [
      { name: '进气系统传递损失', out: '全频段 TL · 插入损失 IL' },
      { name: '膨胀腔消声器', out: '消声量 · 中心频率 · 频带' },
      { name: '亥姆霍兹消声器', out: '共振频率 · 消声带宽' },
      { name: '多腔穿孔消声器', out: '穿孔率 · 阻抗 · 频响' },
      { name: '四分之一波长管', out: '侧分支消声 · 带宽' },
      { name: '编织管消声器', out: '纤维吸声 · 流阻 · 声衰减' },
    ]},
  ];

  const colW = (CONTENT_W - 0.4) / 3;
  formulas.forEach((col, ci) => {
    const x = CONTENT_X + ci * (colW + 0.2);
    s.addShape('rect', { x, y: CONTENT_Y + 1.2, w: colW, h: 0.5, fill: { color: col.color }, line: { color: col.color }, rectRadius: 0.05 });
    s.addText(col.cat, { x, y: CONTENT_Y + 1.2, w: colW, h: 0.5, fontSize: 16, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle', charSpacing: 1 });
    col.items.forEach((f, fi) => {
      const y = CONTENT_Y + 1.85 + fi * 0.8;
      s.addShape('rect', { x, y, w: colW, h: 0.72, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.04 });
      s.addShape('rect', { x, y, w: 0.06, h: 0.72, fill: { color: col.color }, line: { color: col.color } });
      s.addText(f.name, { x: x + 0.15, y: y + 0.03, w: colW - 0.25, h: 0.35, fontSize: 11.5, bold: true, color: C.textDark, fontFace: FONT });
      s.addText('输出：' + f.out, { x: x + 0.15, y: y + 0.38, w: colW - 0.25, h: 0.3, fontSize: 9.5, color: C.textLight, fontFace: FONT });
    });
  });

  // 底栏：每项公式能力
  const yb = CONTENT_Y + 6.6;
  s.addShape('rect', { x: CONTENT_X, y: yb, w: CONTENT_W, h: 0.04, fill: { color: C.line }, line: { color: C.line } });
  s.addText('每项公式均含：参数说明 · 单位换算 · 量程校验 · 预置算例 · 计算书导出（CSV/Excel）· 结果可保存至项目与计算记录', {
    x: CONTENT_X, y: yb + 0.08, w: CONTENT_W, h: 0.35,
    fontSize: 11, italic: true, color: C.textLight, fontFace: FONT, align: 'center',
  });
}

// --- Slide 11: 高级计算能力 ---
slideNum = 11;
{
  const s = pres.addSlide();
  addFoot(s, '03 / 公式内核', slideNum);
  addTitle(s, '不只是公式计算：灵敏度 · 回算 · 链路 · 不确定度', '让公式"会思考、会求解、会追溯"');

  const abilities = [
    { icon: '📈', title: '灵敏度分析', desc: '自动识别关键参数对输出的影响程度 · 雷达图/条形图可视化', hl: '用于多参数方案筛选' },
    { icon: '🎯', title: '反向求解（反算）', desc: '给定目标输出值，自动反推输入参数取值范围', hl: '突破正算→试错模式' },
    { icon: '🔗', title: '计算链路', desc: '多公式串联 · 上游输出自动带入下游 · 参数绑定材料库', hl: '一个型号 = 一条计算链' },
    { icon: '📐', title: '不确定度评估', desc: '输入参数分布 → 蒙特卡洛 / 解析法 · 输出置信区间', hl: '量化设计可靠性' },
  ];
  const aW = (CONTENT_W - 0.6) / 4;
  abilities.forEach((a, i) => {
    const x = CONTENT_X + i * (aW + 0.2);
    const y = CONTENT_Y + 1.3;
    addCard(s, x, y, aW, 3.3);
    s.addShape('rect', { x: x + 0.1, y: y + 0.1, w: aW - 0.2, h: 0.7, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.04 });
    s.addText(a.icon, { x: x + 0.1, y: y + 0.1, w: aW - 0.2, h: 0.7, fontSize: 28, align: 'center', valign: 'middle' });
    s.addText(a.title, { x: x + 0.1, y: y + 0.95, w: aW - 0.2, h: 0.4, fontSize: 15, bold: true, color: C.primary, fontFace: FONT });
    s.addShape('rect', { x: x + 0.1, y: y + 1.38, w: aW - 0.2, h: 0.04, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText(a.desc, { x: x + 0.1, y: y + 1.48, w: aW - 0.2, h: 1.2, fontSize: 11.5, color: C.textMid, fontFace: FONT, valign: 'top' });
    s.addShape('rect', { x: x + 0.1, y: y + 2.8, w: aW - 0.2, h: 0.42, fill: { color: 'FFF7ED' }, line: { color: C.accent }, rectRadius: 0.04 });
    s.addText(a.hl, { x: x + 0.1, y: y + 2.8, w: aW - 0.2, h: 0.42, fontSize: 11, bold: true, color: C.accent, fontFace: FONT, align: 'center', valign: 'middle' });
  });
}

// --- Slide 12: 计算书导出 ---
slideNum = 12;
{
  const s = pres.addSlide();
  addFoot(s, '03 / 公式内核', slideNum);
  addTitle(s, '一键生成计算书 · 项目校核包自动汇总', '设计输出标准化、可审查、可归档');

  const y1 = CONTENT_Y + 1.25;

  s.addShape('rect', { x: CONTENT_X, y: y1, w: CONTENT_W / 2 - 0.1, h: 4.8, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });
  s.addText('标准计算书（一键导出）', { x: CONTENT_X + 0.25, y: y1 + 0.15, w: CONTENT_W / 2 - 0.5, h: 0.4, fontSize: 15, bold: true, color: C.primary, fontFace: FONT });
  s.addShape('rect', { x: CONTENT_X + 0.25, y: y1 + 0.6, w: CONTENT_W / 2 - 0.6, h: 0.05, fill: { color: C.accent }, line: { color: C.accent } });
  const calcItems = [
    '▶ 封面：公式名 / 版本 / 时间 / 操作人',
    '▶ 原始输入参数表（数值 / 单位 / 量程校验状态）',
    '▶ 公式原理简述与适用条件',
    '▶ 计算过程（中间变量 + 公式快照）',
    '▶ 全部输出结果表 + 结论（pass / fail / margin）',
    '▶ 灵敏度分析图（如启用）',
    '▶ 计算链路来源追溯',
    '▶ 材料绑定引用来源（如有）',
  ];
  calcItems.forEach((t, i) => {
    s.addText(t, { x: CONTENT_X + 0.25, y: y1 + 0.75 + i * 0.48, w: CONTENT_W / 2 - 0.6, h: 0.42, fontSize: 11.5, color: C.textMid, fontFace: FONT });
  });

  const xr = CONTENT_X + CONTENT_W / 2 + 0.1;
  s.addShape('rect', { x: xr, y: y1, w: CONTENT_W / 2 - 0.1, h: 4.8, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });
  s.addText('项目校核包（自动汇总）', { x: xr + 0.25, y: y1 + 0.15, w: CONTENT_W / 2 - 0.5, h: 0.4, fontSize: 15, bold: true, color: C.accent, fontFace: FONT });
  s.addShape('rect', { x: xr + 0.25, y: y1 + 0.6, w: CONTENT_W / 2 - 0.6, h: 0.05, fill: { color: C.primary }, line: { color: C.primary } });
  const pkgItems = [
    '▶ 同一项目下所有计算记录自动汇总',
    '▶ 按产品族 / 系统 / 计算类型分组',
    '▶ 批量导出 Excel 工作簿（多 sheet）',
    '▶ 需求达成统计（pass / fail / margin 汇总）',
    '▶ 门禁检查清单（所有公式均达阈值）',
    '▶ 与产品定义库联动 → 发布基线快照',
    '▶ 归档至服务器，供评审 / 追溯',
  ];
  pkgItems.forEach((t, i) => {
    s.addText(t, { x: xr + 0.25, y: y1 + 0.75 + i * 0.56, w: CONTENT_W / 2 - 0.6, h: 0.5, fontSize: 11.5, color: C.textMid, fontFace: FONT });
  });
}

// ============ Chapter 4: 产品定义库 ============
slideNum = 13;
addChapterCover(pres, 4, '产品定义库', '需求—参数—计算—证据—基线 五表闭环');

// --- Slide 14: 核心思想 ---
slideNum = 14;
{
  const s = pres.addSlide();
  addFoot(s, '04 / 产品定义库', slideNum);
  addTitle(s, '产品定义库：让一个产品型号可被精确描述', '五表结构 · 全链路闭环 · 发布即归档');

  const flowY = CONTENT_Y + 1.3;
  const stepW = 2.0;
  const gap = 0.25;
  const steps = [
    { num: '1', label: '需求', desc: '客户 SOR · 标准条款\n目标值 / 优先级 / 验证方式', color: C.danger },
    { num: '2', label: '设计参数', desc: '结构尺寸 · 材料属性\n来源标记（手填/计算/反算/材料库）', color: C.accent },
    { num: '3', label: '计算引用', desc: '关联历史计算记录（快照）\n公式版本 / 输出值 / 结论', color: C.primary },
    { num: '4', label: '发布门禁', desc: '错误清零方可发布\n基线快照 / 变型来源 / 相似型号', color: C.success },
    { num: '5', label: '归档档案', desc: '五表 Excel 设计档案\n自动归档至产品数据库', color: C.textMid },
  ];

  steps.forEach((st, i) => {
    const x = CONTENT_X + i * (stepW + gap);
    s.addShape('rect', { x, y: flowY, w: stepW, h: 2.8, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.06 });
    s.addShape('rect', { x, y: flowY, w: stepW, h: 0.08, fill: { color: st.color }, line: { color: st.color }, rectRadius: 0.06 });
    s.addShape('rect', { x: x + 0.15, y: flowY + 0.25, w: 0.5, h: 0.5, fill: { color: st.color }, line: { color: st.color }, rectRadius: 0.05 });
    s.addText(st.num, { x: x + 0.15, y: flowY + 0.25, w: 0.5, h: 0.5, fontSize: 22, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle' });
    s.addText(st.label, { x: x + 0.75, y: flowY + 0.28, w: stepW - 0.9, h: 0.45, fontSize: 16, bold: true, color: st.color, fontFace: FONT });
    s.addText(st.desc, { x: x + 0.15, y: flowY + 0.9, w: stepW - 0.3, h: 1.8, fontSize: 11, color: C.textMid, fontFace: FONT, valign: 'top' });
    if (i < steps.length - 1) {
      s.addShape('rightTriangle', { x: x + stepW + 0.02, y: flowY + 1.2, w: 0.22, h: 0.4, fill: { color: C.accent }, line: { color: C.accent } });
    }
  });

  const y2 = flowY + 3.0;
  s.addShape('rect', { x: CONTENT_X, y: y2, w: CONTENT_W, h: 1.6, fill: { color: 'EFF6FF' }, line: { color: C.primary }, rectRadius: 0.06 });
  s.addText('核心价值', { x: CONTENT_X + 0.25, y: y2 + 0.1, w: CONTENT_W - 0.5, h: 0.35, fontSize: 14, bold: true, color: C.primary, fontFace: FONT });
  s.addText('没有三维模型的情况下，用「需求 → 参数 → 计算 → 证据 → 基线」五表结构，\n完整描述一个产品型号的设计决策链条。发布门禁强制所有计算错误清零；发布时自动生成基线快照；归档形成可复用的设计模板库。', {
    x: CONTENT_X + 0.25, y: y2 + 0.5, w: CONTENT_W - 0.5, h: 1.0, fontSize: 12.5, color: C.textDark, fontFace: FONT, valign: 'top',
  });
}

// --- Slide 15: 相似·变型·模板 ---
slideNum = 15;
{
  const s = pres.addSlide();
  addFoot(s, '04 / 产品定义库', slideNum);
  addTitle(s, '相似型号 · 变型设计 · 模板提炼', '基于历史经验快速派生新型号');

  const cols = [
    {
      title: '相似型号检索', color: C.primary, icon: '🔍',
      items: [
        '• 按产品族 / 结构型式 / 平台筛选',
        '• 多维度相似度评分（结构/参数/工况）',
        '• 自动推荐最接近的历史型号',
        '• 对比视图：两个型号参数逐项 diff',
      ],
      hl: '找到"长得最像"的老型号'
    },
    {
      title: '变型设计继承', color: C.accent, icon: '🧬',
      items: [
        '• 一键从父型号派生变型型号',
        '• 需求 / 参数 / 计算引用自动继承',
        '• 修改的参数自动标记（与父型号对比）',
        '• 停产型号禁止作为变型来源',
      ],
      hl: '变型来源可追溯，防参数漂移'
    },
    {
      title: '模板提炼沉淀', color: C.success, icon: '📋',
      items: [
        '• 从已发布型号提炼模板（需求骨架）',
        '• 模板不含具体计算结果（防带入旧数据）',
        '• 支持手工搭建空白模板',
        '• 模板列表按系统 / 关键词筛选',
      ],
      hl: '模板库 = 标准化 starting point'
    },
  ];

  const colW = (CONTENT_W - 0.4) / 3;
  cols.forEach((c, i) => {
    const x = CONTENT_X + i * (colW + 0.2);
    const y = CONTENT_Y + 1.25;
    addCard(s, x, y, colW, 4.9);
    s.addShape('rect', { x, y, w: colW, h: 0.7, fill: { color: c.color }, line: { color: c.color }, rectRadius: 0.06 });
    s.addText(c.icon + '  ' + c.title, { x: x + 0.15, y: y + 0.1, w: colW - 0.3, h: 0.5, fontSize: 16, bold: true, color: C.white, fontFace: FONT, valign: 'middle' });
    c.items.forEach((it, j) => {
      s.addText(it, { x: x + 0.15, y: y + 0.85 + j * 0.6, w: colW - 0.3, h: 0.52, fontSize: 11.5, color: C.textMid, fontFace: FONT });
    });
    s.addShape('rect', { x: x + 0.1, y: y + 3.95, w: colW - 0.2, h: 0.75, fill: { color: 'EFF6FF' }, line: { color: c.color }, rectRadius: 0.04 });
    s.addText(c.hl, { x: x + 0.1, y: y + 3.95, w: colW - 0.2, h: 0.75, fontSize: 12, bold: true, color: c.color, fontFace: FONT, align: 'center', valign: 'middle' });
  });
}

// --- Slide 16: 发布与基线 ---
slideNum = 16;
{
  const s = pres.addSlide();
  addFoot(s, '04 / 产品定义库', slideNum);
  addTitle(s, '从草稿到发布：门禁 + 基线 + 档案', '状态机 · 强制校验 · 一键归档');

  const y1 = CONTENT_Y + 1.25;
  s.addText('型号状态流转', { x: CONTENT_X, y: y1, w: 3.0, h: 0.4, fontSize: 14, bold: true, color: C.primary, fontFace: FONT });
  const states = [
    { name: '草稿 draft', color: C.textLight },
    { name: '评审中 review', color: C.warn },
    { name: '已发布 released', color: C.success },
    { name: '已停产 obsolete', color: C.danger },
  ];
  states.forEach((st, i) => {
    const sx = CONTENT_X + 3.5 + i * 2.4;
    s.addShape('rect', { x: sx, y: y1 + 0.1, w: 2.0, h: 0.55, fill: { color: st.color }, line: { color: st.color }, rectRadius: 0.05 });
    s.addText(st.name, { x: sx, y: y1 + 0.1, w: 2.0, h: 0.55, fontSize: 13, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle' });
    if (i < states.length - 1) {
      s.addShape('rightTriangle', { x: sx + 2.05, y: y1 + 0.15, w: 0.3, h: 0.45, fill: { color: C.accent }, line: { color: C.accent } });
    }
  });

  const y2 = y1 + 0.9;
  const items = [
    { icon: '🚦', title: '发布门禁 runGate', color: C.primary,
      desc: ['• 检查所有关联计算的结论（pass/fail）', '• 存在 fail 或 pending 时禁止发布', '• 提示具体错误项，必须清零才能过审', '• 已发布型号禁止直接回退草稿'] },
    { icon: '📐', title: '基线快照 Baseline', color: C.accent,
      desc: ['• 发布时自动创建 V{n}.0 版本基线', '• 冻结：参数/计算引用/需求清单/门禁统计', '• 每次发布新增一条基线，永不覆盖', '• 可对比当前参数与历史基线的差异'] },
    { icon: '📦', title: '发布即归档', color: C.success,
      desc: ['• 五表 Excel 设计档案自动生成', '• 需求/参数/计算/基线/变型 各一 sheet', '• 命名：型号P/N + 版本号 + 时间戳', '• 存入产品数据库（libType: design）'] },
  ];

  const iW = (CONTENT_W - 0.4) / 3;
  items.forEach((it, i) => {
    const x = CONTENT_X + i * (iW + 0.2);
    const y = y2;
    addCard(s, x, y, iW, 4.5);
    s.addShape('rect', { x: x + 0.1, y: y + 0.1, w: iW - 0.2, h: 0.6, fill: { color: it.color }, line: { color: it.color }, rectRadius: 0.05 });
    s.addText(it.icon + '  ' + it.title, { x: x + 0.12, y: y + 0.1, w: iW - 0.24, h: 0.6, fontSize: 14, bold: true, color: C.white, fontFace: FONT, valign: 'middle' });
    it.desc.forEach((d, j) => {
      s.addText(d, { x: x + 0.15, y: y + 0.8 + j * 0.72, w: iW - 0.3, h: 0.62, fontSize: 11.5, color: C.textMid, fontFace: FONT });
    });
  });
}

// ============ Chapter 5: 数据资产体系 ============
slideNum = 17;
addChapterCover(pres, 5, '数据资产体系', '材料 · 试验 · CAE · 知识经验');

// --- Slide 18: 材料库四类统一 ---
slideNum = 18;
{
  const s = pres.addSlide();
  addFoot(s, '05 / 数据资产', slideNum);
  addTitle(s, '材料库：四类材料统一建模', '按类型 + 牌号 + 系列号 + 温度 唯一标识');

  const mats = [
    { cat: '常规材料', fields: ['密度', '泊松比', '弹性模量', '抗拉强度'], apply: '金属壳体 / 支架', icon: '⚙️' },
    { cat: '超弹性材料', fields: ['应力-应变曲线', '硬度（邵氏）', '温度范围'], apply: '橡胶密封件 / 软管', icon: '🌀' },
    { cat: '流体', fields: ['密度', '动力粘度', '导热系数', '比热'], apply: '进气空气 / 冷却液', icon: '💧' },
    { cat: '多孔介质', fields: ['孔径分布', '粘性阻力 α', '惯性阻力 β'], apply: '滤纸 / 滤芯', icon: '🧪' },
  ];
  const mW = (CONTENT_W - 0.6) / 4;
  mats.forEach((m, i) => {
    const x = CONTENT_X + i * (mW + 0.2);
    const y = CONTENT_Y + 1.3;
    addCard(s, x, y, mW, 3.3);
    s.addText(m.icon, { x: x + 0.1, y: y + 0.1, w: mW - 0.2, h: 0.6, fontSize: 28, align: 'center' });
    s.addText(m.cat, { x: x + 0.1, y: y + 0.72, w: mW - 0.2, h: 0.42, fontSize: 15, bold: true, color: C.primary, fontFace: FONT, align: 'center' });
    s.addShape('rect', { x: x + 0.35, y: y + 1.18, w: mW - 0.7, h: 0.04, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText('核心字段', { x: x + 0.12, y: y + 1.28, w: mW - 0.24, h: 0.28, fontSize: 11, bold: true, color: C.textDark, fontFace: FONT });
    m.fields.forEach((f, j) => {
      s.addText('• ' + f, { x: x + 0.12, y: y + 1.58 + j * 0.3, w: mW - 0.24, h: 0.27, fontSize: 10.5, color: C.textMid, fontFace: FONT });
    });
    s.addShape('rect', { x: x + 0.1, y: y + 2.78, w: mW - 0.2, h: 0.42, fill: { color: 'EFF6FF' }, line: { color: C.primary }, rectRadius: 0.04 });
    s.addText(m.apply, { x: x + 0.12, y: y + 2.78, w: mW - 0.24, h: 0.42, fontSize: 10.5, bold: true, color: C.primary, fontFace: FONT, align: 'center', valign: 'middle' });
  });

  const y2 = CONTENT_Y + 4.8;
  s.addShape('rect', { x: CONTENT_X, y: y2, w: CONTENT_W, h: 1.6, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });
  s.addText('统一建模与存储规则', { x: CONTENT_X + 0.25, y: y2 + 0.1, w: CONTENT_W - 0.5, h: 0.35, fontSize: 14, bold: true, color: C.primary, fontFace: FONT });
  const rules = [
    '• 一条记录 = 一个牌号在一个温度下的完整属性集（JSON + 曲线数据表）',
    '• 支持 CSV / Excel 整表批量导入（按表头自动映射字段）',
    '• 检索页支持按类型 / 牌号 / 温度筛选，图表与数据表联动',
    '• 导出 CSV 时曲线按"自变量 / 因变量"两列逐行输出',
  ];
  rules.forEach((r, i) => {
    s.addText(r, { x: CONTENT_X + 0.25, y: y2 + 0.5 + i * 0.27, w: CONTENT_W - 0.5, h: 0.25, fontSize: 11.5, color: C.textDark, fontFace: FONT });
  });
}

// --- Slide 19: 试验/CAE + 实验状态机 ---
slideNum = 19;
{
  const s = pres.addSlide();
  addFoot(s, '05 / 数据资产', slideNum);
  addTitle(s, '试验 · CAE · 实验数据校准', '试验为精度基准 · CAE 校准 · QC 状态机');

  const y1 = CONTENT_Y + 1.3;

  s.addShape('rect', { x: CONTENT_X, y: y1, w: CONTENT_W / 2 - 0.1, h: 3.3, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });
  s.addText('试验报告库', { x: CONTENT_X + 0.25, y: y1 + 0.15, w: CONTENT_W / 2 - 0.6, h: 0.4, fontSize: 15, bold: true, color: C.primary, fontFace: FONT });
  s.addText('原始 PDF 归档 + 结构化元数据\n试验工况 / 测试标准 / 曲线数据 / 结果判定\n支持按工况 / 项目 / 时间检索\nCSV 批量导入，表头自动映射', {
    x: CONTENT_X + 0.25, y: y1 + 0.6, w: CONTENT_W / 2 - 0.6, h: 1.3, fontSize: 12, color: C.textMid, fontFace: FONT, valign: 'top',
  });
  s.addShape('rect', { x: CONTENT_X + 0.25, y: y1 + 2.05, w: CONTENT_W / 2 - 0.6, h: 0.04, fill: { color: C.line }, line: { color: C.line } });
  s.addText('CAE 报告库', { x: CONTENT_X + 0.25, y: y1 + 2.15, w: CONTENT_W / 2 - 0.6, h: 0.38, fontSize: 15, bold: true, color: C.accent, fontFace: FONT });
  s.addText('仿真模型版本 / 工况 / 边界条件绑定\n应力应变曲线（拉伸/压缩负值处理）\n疲劳寿命曲线 · 振动模态\n支持多报告横向对比', {
    x: CONTENT_X + 0.25, y: y1 + 2.55, w: CONTENT_W / 2 - 0.6, h: 0.7, fontSize: 11.5, color: C.textMid, fontFace: FONT, valign: 'top',
  });

  const xr = CONTENT_X + CONTENT_W / 2 + 0.1;
  s.addShape('rect', { x: xr, y: y1, w: CONTENT_W / 2 - 0.1, h: 3.3, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });
  s.addText('实验数据入库与模型校准', { x: xr + 0.25, y: y1 + 0.15, w: CONTENT_W / 2 - 0.6, h: 0.4, fontSize: 15, bold: true, color: C.success, fontFace: FONT });
  const states = ['原始导入', '字段校验', 'QC 比对', '已校准', '可信入库'];
  states.forEach((st, i) => {
    const sx = xr + 0.25 + i * ((CONTENT_W / 2 - 0.6) / states.length);
    s.addShape('rect', { x: sx, y: y1 + 0.65, w: 1.15, h: 0.5, fill: { color: C.white }, line: { color: [C.textLight, C.warn, C.warn, C.accent, C.success][i] }, rectRadius: 0.04 });
    s.addText(st, { x: sx, y: y1 + 0.65, w: 1.15, h: 0.5, fontSize: 9.5, color: C.textDark, fontFace: FONT, align: 'center', valign: 'middle' });
    if (i < states.length - 1) {
      s.addText('→', { x: sx + 1.18, y: y1 + 0.65, w: 0.25, h: 0.5, fontSize: 16, color: C.accent, fontFace: FONT, align: 'center', valign: 'middle' });
    }
  });
  const qcItems = [
    '• QC 规则：与试验基准值比对，差异 ≤ 5% 为高精品质',
    '• 超限数据自动标记，转为"待优化样本"',
    '• 校准后参数回写到材料库 / 公式库',
    '• 入库数据 = 试验 + 仿真 + 理论 三者一致',
  ];
  qcItems.forEach((t, i) => {
    s.addText(t, { x: xr + 0.25, y: y1 + 1.35 + i * 0.46, w: CONTENT_W / 2 - 0.6, h: 0.42, fontSize: 11, color: C.textMid, fontFace: FONT });
  });

  const y2 = y1 + 3.45;
  s.addShape('rect', { x: CONTENT_X, y: y2, w: CONTENT_W, h: 1.15, fill: { color: C.bgBlue }, line: { color: C.bgBlue }, rectRadius: 0.06 });
  const flow = [
    { label: '试验/仿真数据', color: 'CFE0FA' },
    { label: 'QC 比对分流', color: 'CFE0FA' },
    { label: '高精品质→产品库', color: C.success },
    { label: '超限→自优化样本', color: C.accent },
    { label: '校准→反哺公式', color: 'CFE0FA' },
  ];
  flow.forEach((f, i) => {
    const fx = CONTENT_X + 0.25 + i * ((CONTENT_W - 0.5) / flow.length);
    const fw = (CONTENT_W - 0.5) / flow.length - 0.15;
    s.addShape('rect', { x: fx, y: y2 + 0.35, w: fw, h: 0.5, fill: { color: C.white, transparency: 85 }, line: { color: f.color }, rectRadius: 0.04 });
    s.addText(f.label, { x: fx, y: y2 + 0.35, w: fw, h: 0.5, fontSize: 10, color: f.color, fontFace: FONT, align: 'center', valign: 'middle' });
  });
}

// --- Slide 20: 知识经验库六类 ---
slideNum = 20;
{
  const s = pres.addSlide();
  addFoot(s, '05 / 数据资产', slideNum);
  addTitle(s, '知识经验库 · FMEA · 培训', 'PDF + 同名 JSON 元数据 · 可检索 · 可预览');

  const kbes = [
    { cat: '知识理论', icon: '📖', desc: '进气系统理论基础 · 设计方法论', color: C.primary },
    { cat: '标准&规范', icon: '📘', desc: '国标 / 行标 / 企业标准', color: C.primary },
    { cat: '设计指南', icon: '🧭', desc: '产品族设计指南 · 选型手册', color: C.secondary },
    { cat: '经验教训', icon: '💡', desc: '典型问题案例 · 根因分析', color: C.accent },
    { cat: '论文/专利', icon: '📄', desc: '学术文献 · 公司专利', color: C.accent },
    { cat: 'FMEA 库', icon: '⚠️', desc: '失效模式 · 风险评级 · 改进措施', color: C.danger },
    { cat: '培训资料', icon: '🎓', desc: '新员工入门 · 专题培训课件', color: C.success },
    { cat: '产品数据库', icon: '📦', desc: '产品设计档案（calc/test/trusted/cae/design）', color: C.textMid },
  ];
  const kW = (CONTENT_W - 0.7) / 4;
  kbes.forEach((k, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = CONTENT_X + col * (kW + 0.23);
    const y = CONTENT_Y + 1.25 + row * 1.35;
    s.addShape('rect', { x, y, w: kW, h: 1.2, fill: { color: C.white }, line: { color: k.color }, rectRadius: 0.06 });
    s.addShape('rect', { x, y, w: 0.08, h: 1.2, fill: { color: k.color }, line: { color: k.color } });
    s.addText(k.icon, { x: x + 0.15, y: y + 0.1, w: 0.6, h: 0.6, fontSize: 22, align: 'center' });
    s.addText(k.cat, { x: x + 0.75, y: y + 0.12, w: kW - 0.9, h: 0.42, fontSize: 13, bold: true, color: k.color, fontFace: FONT });
    s.addText(k.desc, { x: x + 0.15, y: y + 0.62, w: kW - 0.3, h: 0.5, fontSize: 10.5, color: C.textMid, fontFace: FONT, valign: 'top' });
  });

  const y2 = CONTENT_Y + 4.1;
  s.addShape('rect', { x: CONTENT_X, y: y2, w: CONTENT_W, h: 1.2, fill: { color: 'EFF6FF' }, line: { color: C.primary }, rectRadius: 0.06 });
  s.addText('统一存储与访问', { x: CONTENT_X + 0.25, y: y2 + 0.12, w: CONTENT_W - 0.5, h: 0.35, fontSize: 14, bold: true, color: C.primary, fontFace: FONT });
  s.addText('• 一条记录 = PDF 文档 + 同名 JSON 元数据（标题 / 作者 / 日期 / 分类 / 标签 / 摘要）\n' +
    '• 内置 PDF 预览器，不依赖外部阅读器 · 支持按分类 / 关键词 / 日期检索\n' +
    '• FMEA 库支持风险优先级（RPN）评级 · 改进措施跟踪 · Word 表格导出', {
    x: CONTENT_X + 0.25, y: y2 + 0.5, w: CONTENT_W - 0.5, h: 0.65,
    fontSize: 11.5, color: C.textDark, fontFace: FONT, valign: 'top',
  });
}

// ============ Chapter 6: 关键保障能力 ============
slideNum = 21;
addChapterCover(pres, 6, '关键保障能力', '数据质量 · 导出加密 · 双版本交付');

// --- Slide 22: 数据质量分级 ---
slideNum = 22;
{
  const s = pres.addSlide();
  addFoot(s, '06 / 保障能力', slideNum);
  addTitle(s, '数据质量分级：试验为基准 · 差异 ≤5% 入库', '高精品质数据入库 · 超限数据反哺公式优化');

  const y1 = CONTENT_Y + 1.25;

  s.addShape('rect', { x: CONTENT_X, y: y1, w: CONTENT_W / 2 - 0.1, h: 3.6, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });
  // 分流图
  s.addShape('rect', { x: CONTENT_X + CONTENT_W / 4 - 1.3, y: y1 + 0.15, w: 2.6, h: 0.5, fill: { color: C.primary }, line: { color: C.primary }, rectRadius: 0.05 });
  s.addText('CAE 报告 / 理论计算书', { x: CONTENT_X + CONTENT_W / 4 - 1.3, y: y1 + 0.15, w: 2.6, h: 0.5, fontSize: 12, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle' });
  s.addShape('rect', { x: CONTENT_X + CONTENT_W / 4 - 1.3, y: y1 + 0.8, w: 2.6, h: 0.55, fill: { color: C.white }, line: { color: C.accent }, rectRadius: 0.05 });
  s.addText('与试验基准值逐项比对', { x: CONTENT_X + CONTENT_W / 4 - 1.3, y: y1 + 0.8, w: 2.6, h: 0.55, fontSize: 12, bold: true, color: C.accent, fontFace: FONT, align: 'center', valign: 'middle' });
  // 两条箭头
  s.addText('▼', { x: CONTENT_X + CONTENT_W / 4 - 0.6, y: y1 + 1.35, w: 0.4, h: 0.4, fontSize: 16, color: C.success, fontFace: FONT, align: 'center', valign: 'middle' });
  s.addText('▼', { x: CONTENT_X + CONTENT_W / 4 + 0.6, y: y1 + 1.35, w: 0.4, h: 0.4, fontSize: 16, color: C.accent, fontFace: FONT, align: 'center', valign: 'middle' });
  // 左
  s.addShape('rect', { x: CONTENT_X + 0.15, y: y1 + 1.85, w: CONTENT_W / 4 - 0.25, h: 1.5, fill: { color: 'F0FDF4' }, line: { color: C.success }, rectRadius: 0.05 });
  s.addText('差异 ≤ 5%', { x: CONTENT_X + 0.15, y: y1 + 1.9, w: CONTENT_W / 4 - 0.25, h: 0.35, fontSize: 13, bold: true, color: C.success, fontFace: FONT, align: 'center' });
  s.addText('→ 沉淀高精品质数据\n→ 存入产品数据库\n→ 形成优秀案例标杆', { x: CONTENT_X + 0.15, y: y1 + 2.25, w: CONTENT_W / 4 - 0.25, h: 1.0, fontSize: 11, color: C.textMid, fontFace: FONT, align: 'center' });
  // 右
  s.addShape('rect', { x: CONTENT_X + CONTENT_W / 4 + 0.1, y: y1 + 1.85, w: CONTENT_W / 4 - 0.25, h: 1.5, fill: { color: 'FFF7ED' }, line: { color: C.accent }, rectRadius: 0.05 });
  s.addText('差异 > 5%', { x: CONTENT_X + CONTENT_W / 4 + 0.1, y: y1 + 1.9, w: CONTENT_W / 4 - 0.25, h: 0.35, fontSize: 13, bold: true, color: C.accent, fontFace: FONT, align: 'center' });
  s.addText('→ 转为自优化样本\n→ 以试验值反演\n→ 修正经验系数', { x: CONTENT_X + CONTENT_W / 4 + 0.1, y: y1 + 2.25, w: CONTENT_W / 4 - 0.25, h: 1.0, fontSize: 11, color: C.textMid, fontFace: FONT, align: 'center' });

  const xr = CONTENT_X + CONTENT_W / 2 + 0.1;
  s.addShape('rect', { x: xr, y: y1, w: CONTENT_W / 2 - 0.1, h: 3.6, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });
  s.addText('数据闭环', { x: xr + 0.25, y: y1 + 0.15, w: CONTENT_W / 2 - 0.5, h: 0.4, fontSize: 15, bold: true, color: C.primary, fontFace: FONT });
  const cycleItems = [
    ['①', '审核入库', '试验/计算/CAE三者一致，共同作为可信数据'],
    ['②', '精度比对', '自动比对计算值、仿真值与试验基准'],
    ['③', '分流处理', '≤ 5% 入库 · > 5% 转样本'],
    ['④', '反哺优化', '样本驱动公式经验系数校准'],
    ['⑤', '回归验证', '校准后版本自动回归验证'],
    ['⑥', '案例推送', '按产品族/工况/材料推送历史案例'],
  ];
  cycleItems.forEach((c, i) => {
    const rowY = y1 + 0.65 + i * 0.46;
    s.addShape('oval', { x: xr + 0.25, y: rowY + 0.05, w: 0.35, h: 0.35, fill: { color: C.primary }, line: { color: C.primary } });
    s.addText(c[0], { x: xr + 0.25, y: rowY + 0.05, w: 0.35, h: 0.35, fontSize: 10, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle' });
    s.addText(c[1], { x: xr + 0.7, y: rowY, w: 1.35, h: 0.45, fontSize: 12, bold: true, color: C.textDark, fontFace: FONT });
    s.addText(c[2], { x: xr + 2.1, y: rowY, w: CONTENT_W / 2 - 2.35, h: 0.45, fontSize: 10.5, color: C.textMid, fontFace: FONT });
  });
}

// --- Slide 23: 导出加密 ---
slideNum = 23;
{
  const s = pres.addSlide();
  addFoot(s, '06 / 保障能力', slideNum);
  addTitle(s, '所有导出资料自动加密，离开本机需解密授权', 'AES-256-GCM · 设备绑定密钥 · 离线令牌');

  const y1 = CONTENT_Y + 1.25;
  s.addShape('rect', { x: CONTENT_X, y: y1, w: CONTENT_W, h: 2.5, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });
  s.addText('加密方案', { x: CONTENT_X + 0.25, y: y1 + 0.1, w: CONTENT_W - 0.5, h: 0.36, fontSize: 14, bold: true, color: C.primary, fontFace: FONT });

  const encItems = [
    { title: '加密算法', body: 'AES-256-GCM\n每文件随机 96-bit IV\n+ 认证标签' },
    { title: '密钥派生', body: '设备指纹（CPU/主板/系统盘）\n+ 安装盐 → KDF 派生\n密钥仅存本机' },
    { title: '文件头格式', body: '魔数 + 版本 + 算法标识\n+ IV + 密文 + 认证标签\n自有加密格式' },
    { title: '安全存储', body: '密钥不上传任何服务器\nAES-256-GCM 加解密\n审计日志全程记录' },
  ];
  encItems.forEach((e, i) => {
    const ex = CONTENT_X + 0.25 + i * ((CONTENT_W - 0.5) / 4);
    const ew = (CONTENT_W - 0.5) / 4 - 0.15;
    s.addShape('rect', { x: ex, y: y1 + 0.55, w: ew, h: 1.75, fill: { color: C.white }, line: { color: C.primary }, rectRadius: 0.05 });
    s.addText(e.title, { x: ex + 0.1, y: y1 + 0.62, w: ew - 0.2, h: 0.4, fontSize: 13, bold: true, color: C.primary, fontFace: FONT, align: 'center' });
    s.addShape('rect', { x: ex + ew / 2 - 0.15, y: y1 + 1.05, w: 0.3, h: 0.04, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText(e.body, { x: ex + 0.1, y: y1 + 1.15, w: ew - 0.2, h: 1.1, fontSize: 10.5, color: C.textMid, fontFace: FONT, align: 'center', valign: 'top' });
  });

  const y2 = y1 + 2.7;
  s.addShape('rect', { x: CONTENT_X, y: y2, w: CONTENT_W / 2 - 0.1, h: 2.2, fill: { color: 'F0FDF4' }, line: { color: C.success }, rectRadius: 0.06 });
  s.addText('✓ 本机查看', { x: CONTENT_X + 0.25, y: y2 + 0.15, w: CONTENT_W / 2 - 0.6, h: 0.4, fontSize: 15, bold: true, color: C.success, fontFace: FONT });
  s.addText('• 软件内置 PDF / Excel 查看器\n• 解密后直接渲染，不生成明文临时文件\n• 设备密钥自动识别，无需额外操作\n• 全程内存加解密，无明文落盘', {
    x: CONTENT_X + 0.25, y: y2 + 0.65, w: CONTENT_W / 2 - 0.6, h: 1.4, fontSize: 11.5, color: C.textMid, fontFace: FONT, valign: 'top',
  });

  const xr = CONTENT_X + CONTENT_W / 2 + 0.1;
  s.addShape('rect', { x: xr, y: y2, w: CONTENT_W / 2 - 0.1, h: 2.2, fill: { color: 'FFF7ED' }, line: { color: C.accent }, rectRadius: 0.06 });
  s.addText('🔐 异地授权（标准版审批机制）', { x: xr + 0.25, y: y2 + 0.15, w: CONTENT_W / 2 - 0.6, h: 0.4, fontSize: 15, bold: true, color: C.accent, fontFace: FONT });
  s.addText('① 导出方请求 → 加密文件（.ctre）\n② 审批人收到请求 → 签发离线解密令牌\n③ 令牌 5 分钟内有效 · 导入自动解密\n④ 审计日志：导出/打开/解密全记录', {
    x: xr + 0.25, y: y2 + 0.65, w: CONTENT_W / 2 - 0.6, h: 1.4, fontSize: 11.5, color: C.textMid, fontFace: FONT, valign: 'top',
  });
}

// --- Slide 24: 双版本交付 ---
slideNum = 24;
{
  const s = pres.addSlide();
  addFoot(s, '06 / 保障能力', slideNum);
  addTitle(s, '标准版与科研版双版本交付', '同一代码库 · 两种交付形态');

  const y1 = CONTENT_Y + 1.25;
  const wl = CONTENT_W / 2 - 0.1;

  s.addShape('rect', { x: CONTENT_X, y: y1, w: wl, h: 0.65, fill: { color: C.primary }, line: { color: C.primary }, rectRadius: 0.06 });
  s.addText('🔬 科研版', { x: CONTENT_X + 0.2, y: y1, w: wl - 0.4, h: 0.65, fontSize: 20, bold: true, color: C.white, fontFace: FONT, valign: 'middle' });
  s.addShape('rect', { x: CONTENT_X, y: y1 + 0.75, w: wl, h: 4.55, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });
  const fullItems = [
    '✅ 全部 11 类公式计算',
    '✅ 灵敏度分析 / 回算 / 链路 / 不确定度',
    '✅ 全部 4 类材料数据导入 + 校准',
    '✅ 试验 / CAE 报告导入 / 批量入库',
    '✅ 实验数据入库与 QC 状态机',
    '✅ FMEA / 培训 / 知识经验导入',
    '✅ 产品定义库完整功能',
    '✅ 导出加密 + 审批机制',
    '✅ 适合：研发工程师 / 技术负责人',
  ];
  fullItems.forEach((t, i) => {
    s.addText(t, { x: CONTENT_X + 0.25, y: y1 + 0.9 + i * 0.42, w: wl - 0.5, h: 0.38, fontSize: 12, color: C.textMid, fontFace: FONT });
  });

  const xr = CONTENT_X + CONTENT_W / 2 + 0.1;
  s.addShape('rect', { x: xr, y: y1, w: wl, h: 0.65, fill: { color: C.accent }, line: { color: C.accent }, rectRadius: 0.06 });
  s.addText('🏭 标准版', { x: xr + 0.2, y: y1, w: wl - 0.4, h: 0.65, fontSize: 20, bold: true, color: C.white, fontFace: FONT, valign: 'middle' });
  s.addShape('rect', { x: xr, y: y1 + 0.75, w: wl, h: 4.55, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });
  const stdItems = [
    '✅ 常用公式计算（11 类全开放）',
    '✅ 材料 / 试验 / CAE / 知识检索',
    '✅ 计算记录 / 项目校核包',
    '✅ 产品定义库（只读 + 草稿）',
    '✅ 导出加密 · 审批解密机制',
    '❌ 数据导入（统一由管理员维护）',
    '❌ 实验数据入库校准',
    '❌ 灵敏度 / 回算 / 不确定度（裁剪）',
    '✅ 适合：产品工程师 / 工艺工程师',
  ];
  stdItems.forEach((t, i) => {
    const isCross = t.startsWith('❌');
    s.addText(t, { x: xr + 0.25, y: y1 + 0.9 + i * 0.42, w: wl - 0.5, h: 0.38, fontSize: 12, color: isCross ? C.textLight : C.textMid, fontFace: FONT });
  });
}

// ============ Chapter 7: 实施与展望 ============
slideNum = 25;
addChapterCover(pres, 7, '实施与展望', '阶段成果 · 效益指标 · 未来规划');

// --- Slide 26: 已实现成果 ---
slideNum = 26;
{
  const s = pres.addSlide();
  addFoot(s, '07 / 实施与展望', slideNum);
  addTitle(s, '已实现成果：一个桌面应用 · 11 个公式 · 全模块贯通', '从零自研 · Electron + React + TypeScript');

  const stats = [
    { num: '11', unit: '个', label: '公式模块', sub: '结构 2 · 流体 3 · 声学 6', color: C.primary },
    { num: '8', unit: '类', label: '数据资产', sub: '材料/试验/CAE/产品/知识...', color: C.secondary },
    { num: '24', unit: '页', label: '功能页面', sub: '导航清晰，按需裁剪', color: C.accent },
    { num: '2', unit: '版', label: '交付形态', sub: '科研版 + 标准版', color: C.success },
  ];
  const stW = (CONTENT_W - 0.6) / 4;
  stats.forEach((st, i) => {
    const x = CONTENT_X + i * (stW + 0.2);
    const y = CONTENT_Y + 1.3;
    addCard(s, x, y, stW, 2.0);
    s.addShape('rect', { x, y, w: stW, h: 0.08, fill: { color: st.color }, line: { color: st.color }, rectRadius: 0.08 });
    s.addText(st.num, { x: x + 0.15, y: y + 0.2, w: stW - 0.3, h: 1.0, fontSize: 52, bold: true, color: st.color, fontFace: FONT, charSpacing: 3 });
    s.addText(st.unit, { x: x + stW - 0.75, y: y + 0.55, w: 0.55, h: 0.35, fontSize: 18, color: st.color, fontFace: FONT });
    s.addText(st.label, { x: x + 0.15, y: y + 1.22, w: stW - 0.3, h: 0.35, fontSize: 14, bold: true, color: C.textDark, fontFace: FONT });
    s.addText(st.sub, { x: x + 0.15, y: y + 1.55, w: stW - 0.3, h: 0.35, fontSize: 10.5, color: C.textLight, fontFace: FONT });
  });

  const y2 = CONTENT_Y + 3.45;
  s.addShape('rect', { x: CONTENT_X, y: y2, w: CONTENT_W, h: 2.45, fill: { color: C.bgLight }, line: { color: C.line }, rectRadius: 0.06 });

  const achievements = [
    { title: '核心引擎', color: C.primary, items: [
      '11 类专业公式全部实现：正向计算/灵敏度/回算/链路/不确定度',
      '参数量程与单位自动校验，预置算例自比对',
      '计算书一键导出，含完整溯源信息',
    ]},
    { title: '产品定义库', color: C.accent, items: [
      '五表结构：需求 → 参数 → 计算引用 → 门禁 → 基线',
      '相似型号评分 / 变型继承 / 模板提炼',
      '发布即归档，自动生成设计档案',
    ]},
    { title: '数据资产与安全', color: C.success, items: [
      '四类材料建模 · 试验/CAE 报告检索 · 知识经验六类',
      '实验数据 QC 状态机 · 校准回写',
      'AES-256-GCM 导出加密 · 设备绑定 · 离线令牌',
    ]},
  ];
  achievements.forEach((ach, i) => {
    const ax = CONTENT_X + 0.25 + i * ((CONTENT_W - 0.5) / 3);
    const aw = (CONTENT_W - 0.5) / 3 - 0.15;
    s.addShape('rect', { x: ax, y: y2 + 0.15, w: 0.08, h: 2.15, fill: { color: ach.color }, line: { color: ach.color } });
    s.addText(ach.title, { x: ax + 0.2, y: y2 + 0.15, w: aw - 0.2, h: 0.4, fontSize: 14, bold: true, color: ach.color, fontFace: FONT });
    ach.items.forEach((it, j) => {
      s.addText('• ' + it, { x: ax + 0.2, y: y2 + 0.6 + j * 0.52, w: aw - 0.2, h: 0.45, fontSize: 10.5, color: C.textDark, fontFace: FONT });
    });
  });
}

// --- Slide 27: 效益指标 ---
slideNum = 27;
{
  const s = pres.addSlide();
  addFoot(s, '07 / 实施与展望', slideNum);
  addTitle(s, '用量化指标衡量平台价值', '效率提升 · 质量保障 · 知识沉淀');

  const y1 = CONTENT_Y + 1.3;
  const benefits = [
    { icon: '🎯', title: '方案阶段算准', color: C.primary, items: ['• 阻力/噪声/结构一次算清', '• 减少试制轮次', '• 方案评审有据可依'], metric: '试制轮次 ↓ 30%+' },
    { icon: '📋', title: '数据一次录入', color: C.accent, items: ['• 材料与试验数据多处复用', '• 避免重复整理格式转换', '• 字段统一口径一致'], metric: '录入时间 ↓ 50%+' },
    { icon: '💡', title: '经验可视可用', color: C.success, items: ['• 计算过程与判据沉淀', '• 新人可快速上手复用', '• 人员流动不带走知识'], metric: '新人培养 ↓ 40%' },
    { icon: '🔗', title: '全链追溯管控', color: C.textMid, items: ['• 需求→参数→计算→基线追溯', '• 加密导出防泄密', '• 门禁机制降低发布风险'], metric: '档案追溯率 100%' },
  ];
  const bW = (CONTENT_W - 0.6) / 4;
  benefits.forEach((b, i) => {
    const x = CONTENT_X + i * (bW + 0.2);
    addCard(s, x, y1, bW, 3.5);
    s.addShape('rect', { x, y: y1, w: bW, h: 0.08, fill: { color: b.color }, line: { color: b.color }, rectRadius: 0.08 });
    s.addText(b.icon, { x: x + 0.1, y: y1 + 0.15, w: bW - 0.2, h: 0.55, fontSize: 28, align: 'center' });
    s.addText(b.title, { x: x + 0.1, y: y1 + 0.75, w: bW - 0.2, h: 0.45, fontSize: 16, bold: true, color: b.color, fontFace: FONT, align: 'center' });
    b.items.forEach((it, j) => {
      s.addText(it, { x: x + 0.12, y: y1 + 1.3 + j * 0.5, w: bW - 0.24, h: 0.42, fontSize: 10.5, color: C.textMid, fontFace: FONT });
    });
    s.addShape('rect', { x: x + 0.1, y: y1 + 2.9, w: bW - 0.2, h: 0.5, fill: { color: b.color }, line: { color: b.color }, rectRadius: 0.04 });
    s.addText(b.metric, { x: x + 0.1, y: y1 + 2.9, w: bW - 0.2, h: 0.5, fontSize: 11, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle' });
  });

  const y2 = y1 + 3.7;
  s.addText('分阶段路线图', { x: CONTENT_X, y: y2, w: 3.0, h: 0.4, fontSize: 14, bold: true, color: C.primary, fontFace: FONT });
  const phases = [
    { p: '第一阶段\n已实现', items: '公式库 11 类上线\n材料库四类建档\n试验/CAE 报告导入', status: C.success },
    { p: '第二阶段\n近期推进', items: '灵敏度分析增强\n计算书模板化\n权限分级与审批', status: C.accent },
    { p: '第三阶段\n中期规划', items: '与 CAD 接口打通\n参数自动寻优\n跨部门协同', status: C.textMid },
    { p: '第四阶段\n长期愿景', items: 'AI 公式自生成\n案例智能推送\n跨厂协同平台', status: C.primary },
  ];
  phases.forEach((ph, i) => {
    const px = CONTENT_X + i * (CONTENT_W / 4);
    const pw = CONTENT_W / 4 - 0.15;
    s.addShape('rect', { x: px, y: y2 + 0.5, w: pw, h: 1.25, fill: { color: C.bgLight }, line: { color: ph.status }, rectRadius: 0.05 });
    s.addText(ph.p, { x: px, y: y2 + 0.55, w: pw, h: 0.45, fontSize: 11, bold: true, color: ph.status, fontFace: FONT, align: 'center' });
    s.addText(ph.items, { x: px, y: y2 + 1.0, w: pw, h: 0.7, fontSize: 9.5, color: C.textMid, fontFace: FONT, align: 'center' });
  });
}

// --- Slide 28: 未来规划与 IP ---
slideNum = 28;
{
  const s = pres.addSlide();
  addFoot(s, '07 / 实施与展望', slideNum);
  addTitle(s, '知识产权与未来规划', '申请人自行开发 · 完整源码所有权');

  const y1 = CONTENT_Y + 1.25;

  s.addShape('rect', { x: CONTENT_X, y: y1, w: CONTENT_W / 2 - 0.1, h: 2.55, fill: { color: 'EFF6FF' }, line: { color: C.primary }, rectRadius: 0.06 });
  s.addShape('rect', { x: CONTENT_X, y: y1, w: CONTENT_W / 2 - 0.1, h: 0.5, fill: { color: C.primary }, line: { color: C.primary }, rectRadius: 0.06 });
  s.addText('📀 软件著作权（已完成源码整理）', { x: CONTENT_X + 0.2, y: y1, w: CONTENT_W / 2 - 0.5, h: 0.5, fontSize: 15, bold: true, color: C.white, fontFace: FONT, valign: 'middle' });
  const swItems = [
    '• 软件名称：进气系统理论设计平台 V1.0',
    '• 源码量：TypeScript + JS 约 15,000+ 行',
    '• 著作权人：成都万友滤机有限公司',
    '• 状态：代码已归档 · 文档编写中 · 待提交登记',
    '• 登记意义：明确所有权 · 商业保护 · 项目申报加分',
  ];
  swItems.forEach((t, i) => {
    s.addText(t, { x: CONTENT_X + 0.25, y: y1 + 0.6 + i * 0.38, w: CONTENT_W / 2 - 0.6, h: 0.35, fontSize: 11.5, color: C.textDark, fontFace: FONT });
  });

  const xr = CONTENT_X + CONTENT_W / 2 + 0.1;
  s.addShape('rect', { x: xr, y: y1, w: CONTENT_W / 2 - 0.1, h: 2.55, fill: { color: 'FFF7ED' }, line: { color: C.accent }, rectRadius: 0.06 });
  s.addShape('rect', { x: xr, y: y1, w: CONTENT_W / 2 - 0.1, h: 0.5, fill: { color: C.accent }, line: { color: C.accent }, rectRadius: 0.06 });
  s.addText('📝 发明专利（两项拟申请）', { x: xr + 0.2, y: y1, w: CONTENT_W / 2 - 0.5, h: 0.5, fontSize: 15, bold: true, color: C.white, fontFace: FONT, valign: 'middle' });
  const patents = [
    { title: '发明一：基于设备绑定的导出文件加密与离线授权方法', body: 'AES-256-GCM + 设备指纹派生密钥 + 离线令牌签发机制，适用于企业内部技术资料保护' },
    { title: '发明二：面向滤清器产品的"需求—参数—证据"链校核方法', body: '五表结构产品定义库 + 门禁强制校验 + 发布基线自动归档，解决无三维建模条件下的产品数字化问题' },
  ];
  patents.forEach((p, i) => {
    const py = y1 + 0.6 + i * 0.95;
    s.addText(p.title, { x: xr + 0.25, y: py, w: CONTENT_W / 2 - 0.6, h: 0.4, fontSize: 12, bold: true, color: C.accent, fontFace: FONT });
    s.addText(p.body, { x: xr + 0.25, y: py + 0.42, w: CONTENT_W / 2 - 0.6, h: 0.48, fontSize: 10.5, color: C.textMid, fontFace: FONT, valign: 'top' });
  });

  const y2 = y1 + 2.8;
  s.addShape('rect', { x: CONTENT_X, y: y2, w: CONTENT_W, h: 2.4, fill: { color: C.bgBlue }, line: { color: C.bgBlue }, rectRadius: 0.06 });
  s.addText('申请人自行开发声明', { x: CONTENT_X + 0.25, y: y2 + 0.12, w: CONTENT_W - 0.5, h: 0.45, fontSize: 16, bold: true, color: C.accent, fontFace: FONT });
  s.addText('本软件由成都万友滤机有限公司技术团队独立设计、开发、测试，完整知识产权归申请人所有。\n仅使用 Electron / React / pptxgenjs 等公开开源框架作为工程基础设施，所有业务逻辑均为自研。', {
    x: CONTENT_X + 0.25, y: y2 + 0.6, w: CONTENT_W - 0.5, h: 0.95, fontSize: 12, color: 'CFE0FA', fontFace: FONT, valign: 'top',
  });
  s.addShape('rect', { x: CONTENT_X + 0.25, y: y2 + 1.7, w: CONTENT_W - 0.5, h: 0.04, fill: { color: C.accent }, line: { color: C.accent } });
  s.addText('未来迭代：① 公式引擎 AI 自扩展  ② 与 CAD/CAE 求解器双向参数联动  ③ 跨部门协同平台（多厂/多客户共享）', {
    x: CONTENT_X + 0.25, y: y2 + 1.8, w: CONTENT_W - 0.5, h: 0.5, fontSize: 11, color: 'CFE0FA', fontFace: FONT, valign: 'top',
  });
}

// ============ Slide 29: 结束页 ============
slideNum = 29;
{
  const s = pres.addSlide();
  s.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: C.bgBlue }, line: { color: C.bgBlue } });
  s.addShape('rect', { x: CONTENT_X, y: CONTENT_Y + 1.8, w: 1.5, h: 0.06, fill: { color: C.accent }, line: { color: C.accent } });
  s.addText('感 谢 聆 听', {
    x: CONTENT_X, y: CONTENT_Y + 2.0, w: SLIDE_W - 1.2, h: 1.2,
    fontSize: 54, bold: true, color: C.white, fontFace: FONT, charSpacing: 12, align: 'center',
  });
  s.addText('请各位领导、专家批评指正', {
    x: CONTENT_X, y: CONTENT_Y + 3.25, w: SLIDE_W - 1.2, h: 0.6,
    fontSize: 22, color: 'CFE0FA', fontFace: FONT, align: 'center', charSpacing: 3,
  });
  s.addShape('rect', { x: SLIDE_W / 2 - 3.5, y: CONTENT_Y + 4.2, w: 7.0, h: 1.0, fill: { color: '153578' }, line: { color: C.accent }, rectRadius: 0.06 });
  s.addText('成都万友滤机有限公司', {
    x: SLIDE_W / 2 - 3.5, y: CONTENT_Y + 4.2, w: 7.0, h: 0.5,
    fontSize: 16, bold: true, color: C.white, fontFace: FONT, align: 'center', valign: 'middle',
  });
  s.addText('西南兵器工业 · 中国兵器  |  2026 年 11 月', {
    x: SLIDE_W / 2 - 3.5, y: CONTENT_Y + 4.7, w: 7.0, h: 0.5,
    fontSize: 12, color: 'CFE0FA', fontFace: FONT, align: 'center', valign: 'middle',
  });
}

// ============================================================
// SAVE
// ============================================================
const outPath = path.resolve(__dirname, '进气系统理论设计平台设想-v2.pptx');
pres.writeFile({ fileName: outPath }).then(() => {
  console.log('✅ PPT generated:', outPath);
  console.log('Total slides:', pres.slides.length);
}).catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
