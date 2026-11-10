const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const store = require('./store.cjs');
const license = require('./license.cjs');
const { writeMaterialParquet, readMaterialParquet } = require('./materialParquet.cjs');
const { writeFmeaParquet, readFmeaParquet } = require('./fmeaParquet.cjs');

// 打包后 @napi-rs/canvas 会被加载两次：主进程 require 解析到 app.asar 虚拟路径，
// pdfjs 的 node_utils 用 createRequire 解析到 app.asar.unpacked 真实路径。
// 同一原生库 dlopen 两次会让先加载实例的 Path2D 类注册被后加载实例覆盖，
// 之后任何 Path2D（无论来自哪个实例）传给 ctx.clip() 都会报
// "parameter 1 is not of type 'Path2D'"。仅设置 globalThis.Path2D 无法解决，
// 必须在任何 pdfjs 导入之前，把 unpacked 路径的模块缓存预填为同一份 exports。
(function seedNapiCanvasCache() {
  if (!app.isPackaged) return;
  try {
    const napi = require('@napi-rs/canvas');
    const asarEntry = require.resolve('@napi-rs/canvas');
    const unpackedEntry = asarEntry.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    if (unpackedEntry === asarEntry) return;
    const Module = require('node:module');
    if (Module._cache[unpackedEntry]) return;
    const m = new Module(unpackedEntry, module);
    m.filename = unpackedEntry;
    m.paths = Module._nodeModulePaths(path.dirname(unpackedEntry));
    m.exports = napi;
    m.loaded = true;
    Module._cache[unpackedEntry] = m;
  } catch (e) {
    console.warn('@napi-rs/canvas 缓存预填失败：', (e && e.message) || e);
  }
})();

const UNC_ROOT = '\\\\10.1.1.245\\Product Database';
const UNC_CALC_LIB = `${UNC_ROOT}\\Theoretical Calculation Library`;
const UNC_TEST_LIB = `${UNC_ROOT}\\Experimental Test Database`;
const UNC_TRUSTED = `${UNC_ROOT}\\Trusted Data Asset Library`;
const UNC_CAE_LIB = `${UNC_ROOT}\\Virtual Verification Library`;
const UNC_MATERIAL_LIB = '\\\\10.1.1.245\\materials library';

const KBE_ROOT = '\\\\10.1.1.245\\Knowledge & Experience Base';
const KBE_THEORY = `${KBE_ROOT}\\Theoretical Knowledge Base`;
const KBE_DESIGN = `${KBE_ROOT}\\Product Design Library`;
const KBE_FMEA = `${KBE_ROOT}\\FMEA Library`;

function libDir(libType) {
  switch (libType) {
    case 'calc': return UNC_CALC_LIB;
    case 'test': return UNC_TEST_LIB;
    case 'trusted': return UNC_TRUSTED;
    case 'cae': return UNC_CAE_LIB;
    case 'material': return UNC_MATERIAL_LIB;
    case 'theory': return KBE_THEORY;
    case 'design': return KBE_DESIGN;
    case 'fmea': return KBE_FMEA;
    default: return null;
  }
}
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

/** 路径安全：判断 target 是否位于某个允许的根目录下（兼容 UNC 与盘符路径） */
function isInAnyRoot(target, roots) {
  const t = path.resolve(target);
  for (const root of roots) {
    const r = path.resolve(root);
    // path.relative 处理 UNC 和盘符路径都稳健：
    //   - 如果 t 在 r 下，返回相对路径不以 '..' 开头，也不以盘符开头
    //   - 如果 t === r，返回 '' 也应视为在根内
    if (t === r) return true;
    const rel = path.relative(r, t);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    return true;
  }
  return false;
}

const isDev = !app.isPackaged;
const PRODUCT_TITLE = '汽车零部件理论计算平台';
/** 标准版按可执行文件名识别（打包时 productName 含「标准版」），与渲染层开关独立 */
const WINDOW_TITLE =
  app.isPackaged && /标准版/.test(path.basename(process.execPath))
    ? `${PRODUCT_TITLE}（标准版）`
    : PRODUCT_TITLE;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: WINDOW_TITLE,
    backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
  };
}

// ---------- 账号 ----------
ipcMain.handle('auth:status', () => ({
  hasAdmin: store.get().users.length > 0,
  userCount: store.get().users.length,
}));

ipcMain.handle('auth:register', (_e, payload) => {
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');
  const displayName = String(payload.displayName || username).trim();

  if (username.length < 3) return { ok: false, message: '用户名至少 3 个字符' };
  if (password.length < 6) return { ok: false, message: '密码至少 6 个字符' };
  if (store.get().users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return { ok: false, message: '该用户名已存在' };
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    displayName,
    passwordHash: bcrypt.hashSync(password, 10),
    role: store.get().users.length === 0 ? 'admin' : 'engineer',
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
  store.get().users.push(user);
  store.persist();
  return { ok: true, user: publicUser(user) };
});

ipcMain.handle('auth:login', (_e, payload) => {
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');
  const user = store.get().users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return { ok: false, message: '用户名或密码错误' };
  if (!bcrypt.compareSync(password, user.passwordHash)) return { ok: false, message: '用户名或密码错误' };
  user.lastLoginAt = new Date().toISOString();
  store.persist();
  return { ok: true, user: publicUser(user) };
});

ipcMain.handle('auth:list', () => store.get().users.map(publicUser));

// ---------- 计算历史 ----------
ipcMain.handle('history:save', (_e, record) => {
  const entry = {
    id: crypto.randomUUID(),
    userId: record.userId,
    username: record.username,
    projectId: record.projectId || null,
    formulaId: record.formulaId,
    formulaTitle: record.formulaTitle,
    domain: record.domain,
    inputs: record.inputs,
    outputs: record.outputs,
    note: record.note || '',
    createdAt: new Date().toISOString(),
  };
  store.get().history.unshift(entry);
  if (store.get().history.length > 2000) store.get().history.length = 2000;
  store.persist();
  return { ok: true, entry };
});

ipcMain.handle('history:list', (_e, userId) => {
  const list = store.get().history.filter((h) => h.userId === userId);
  return list;
});

ipcMain.handle('history:remove', (_e, id) => {
  const arr = store.get().history;
  const idx = arr.findIndex((h) => h.id === id);
  if (idx >= 0) arr.splice(idx, 1);
  store.persist();
  return { ok: true };
});

// ---------- 项目 ----------
ipcMain.handle('project:list', (_e, userId) =>
  store.get().projects.filter((p) => p.userId === userId),
);

ipcMain.handle('project:create', (_e, payload) => {
  const customer = String(payload.customer || '').trim();
  const code = String(payload.code || '').trim();
  const version = String(payload.version || '').trim();
  if (!customer || !code) return { ok: false, message: '客户和项目代号均不能为空' };
  const name = `${customer} ${code}`;
  const dup = store.get().projects.some(
    (p) => p.userId === payload.userId && p.name === name && (p.version || '') === version,
  );
  if (dup) return { ok: false, message: version ? `已存在同名同版本项目（${version}）` : '已存在同名项目' };
  const project = {
    id: crypto.randomUUID(),
    userId: payload.userId,
    customer,
    code,
    name,
    version,
    product: String(payload.product || '').trim(),
    description: String(payload.description || '').trim(),
    createdAt: new Date().toISOString(),
  };
  store.get().projects.push(project);
  store.persist();
  return { ok: true, project };
});

ipcMain.handle('project:remove', (_e, id) => {
  const s = store.get();
  const idx = s.projects.findIndex((p) => p.id === id);
  if (idx >= 0) s.projects.splice(idx, 1);
  // 项目删除后，其下计算记录转为「未绑定项目」而不是一并删除，避免误删数据
  for (const h of s.history) {
    if (h.projectId === id) h.projectId = null;
  }
  store.persist();
  return { ok: true };
});

// ---------- 实验库（LabStore 快照持久化） ----------
ipcMain.handle('lab:get', () => store.get().lab ?? null);

ipcMain.handle('lab:set', (_e, snapshot) => {
  try {
    store.get().lab = snapshot ?? null;
    store.persist();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// ---------- 授权 ----------
ipcMain.handle('license:info', () => {
  const mc = license.machineCode();
  const lic = store.get().settings.license;
  return {
    machineCode: mc,
    activated: !!(lic && lic.activated),
    activatedAt: lic ? lic.activatedAt : null,
  };
});

ipcMain.handle('license:activate', (_e, code) => {
  if (!license.verify(code)) return { ok: false, message: '授权码与本机机器码不匹配' };
  store.get().settings.license = { code: String(code), activated: true, activatedAt: new Date().toISOString() };
  store.persist();
  return { ok: true };
});

// ---------- 导出 ----------
ipcMain.handle('export:save', async (_e, payload) => {
  const { defaultName, content, buffer, encoding } = payload || {};
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '保存文件',
    defaultPath: defaultName || 'file.txt',
    filters: [
      { name: 'CSV 表格', extensions: ['csv'] },
      { name: 'Excel 表格', extensions: ['xlsx', 'xls'] },
      { name: 'JSON 数据', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  let data = content;
  if (buffer instanceof ArrayBuffer) data = Buffer.from(buffer);
  else if (buffer) data = Buffer.from(buffer);
  if (data == null) return { ok: false, message: '无内容可写' };
  fs.writeFileSync(res.filePath, data, encoding === 'base64' ? 'base64' : undefined);
  return { ok: true, filePath: res.filePath };
});

/** 导出报告原件副本：把归档文件另存到用户指定位置（不改变原文） */
ipcMain.handle('file:copyOut', async (_e, payload) => {
  const { srcPath, defaultName } = payload || {};
  if (!srcPath || !fs.existsSync(srcPath)) return { ok: false, message: '源文件不存在' };
  const ext = path.extname(srcPath).replace('.', '');
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '导出报告副本',
    defaultPath: defaultName || path.basename(srcPath),
    filters: ext
      ? [
          { name: '报告文件', extensions: [ext] },
          { name: '所有文件', extensions: ['*'] },
        ]
      : [{ name: '所有文件', extensions: ['*'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    fs.copyFileSync(srcPath, res.filePath);
    return { ok: true, filePath: res.filePath };
  } catch (err) {
    return { ok: false, message: err && err.message ? err.message : String(err) };
  }
});

/** 导出 Word 计算书：渲染进程用 docx 库生成 base64，此处仅负责保存对话框与写盘 */
ipcMain.handle('export:docx', async (_e, payload) => {
  const { defaultName, base64 } = payload || {};
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '导出 Word 计算书',
    defaultPath: defaultName || '计算书.docx',
    filters: [{ name: 'Word 文档', extensions: ['docx'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(res.filePath, Buffer.from(base64, 'base64'));
  return { ok: true, filePath: res.filePath };
});

/** 导出 PDF 计算书：渲染进程生成自包含 HTML，此处用隐藏窗口排版后 printToPDF */
ipcMain.handle('export:pdf', async (_e, payload) => {
  const { defaultName, html } = payload || {};
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '导出 PDF 计算书',
    defaultPath: defaultName || '计算书.pdf',
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  const win = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: { sandbox: true },
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.6, bottom: 0.6, left: 0.7, right: 0.7 },
    });
    fs.writeFileSync(res.filePath, pdf);
    return { ok: true, filePath: res.filePath };
  } finally {
    win.destroy();
  }
});

/** 导出 Excel 计算汇总（附表内容，用于归档到设计数据库） */
ipcMain.handle('export:xlsx', async (_e, payload) => {
  const { defaultName, base64 } = payload || {};
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '导出 Excel 计算汇总',
    defaultPath: defaultName || '全部计算汇总.xlsx',
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(res.filePath, Buffer.from(base64, 'base64'));
  return { ok: true, filePath: res.filePath };
});

/** 提取 PDF 文字层：按版面行还原文本，列间距较大时补空格（便于表格识别） */
function pdfLinesFromItems(items) {
  const cells = [];
  for (const it of items) {
    if (!it || !it.str || !it.str.trim() || !it.transform) continue;
    cells.push({ x: it.transform[4], y: it.transform[5], w: it.width || 0, s: it.str });
  }
  cells.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const c of cells) {
    const row = rows.find((r) => Math.abs(r[0].y - c.y) <= 3);
    if (row) row.push(c);
    else rows.push([c]);
  }
  const lines = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let line = '';
    let prevEnd = Number.NEGATIVE_INFINITY;
    for (const c of row) {
      if (line && c.x - prevEnd > 8) line += '   ';
      line += c.s;
      prevEnd = c.x + c.w;
    }
    lines.push(line.trim());
  }
  return lines.join('\n');
}

/** 读取试验报告 PDF 文本（主进程读取，规避渲染进程 file:// 下的 worker 限制） */
ipcMain.handle('test:pdfText', async (_e, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, message: '文件不存在' };
    // pdfjs 仅有 ESM 构建：打包后位于 app.asar.unpacked，需按文件 URL 动态引入
    const pdfjsFile = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')
      : require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    const { getDocument } = await import(pathToFileURL(pdfjsFile).href);
    const data = new Uint8Array(fs.readFileSync(filePath));
    const task = getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      disableFontFace: true,
    });
    const doc = await task.promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(pdfLinesFromItems(content.items));
    }
    await task.destroy();
    return { ok: true, text: pages.join('\n'), pages };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/**
 * PDF 阅读器：主进程用 pdfjs + @napi-rs/canvas 把页面渲染成 PNG（data URL）。
 * 放在主进程做，避免渲染进程在打包后的 file:// 环境下创建 Worker 受限。
 * 同一文件的文档实例与已渲染页面做缓存，翻页/缩放时不必重新解析整份 PDF。
 */
let napiCanvas = null;
let pdfRenderState = { filePath: '', task: null, doc: null, canvasFactory: null };
const pdfPageCache = new Map();
const PDF_PAGE_CACHE_MAX = 24;

/** pdfjs 与 canvas 的路径与实例（按需加载） */
async function loadPdfRenderDeps() {
  const pdfjsFile = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')
    : require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  if (!napiCanvas) {
    const napi = require('@napi-rs/canvas');
    napiCanvas = napi.createCanvas;
    // 与文件顶部 seedNapiCanvasCache 配合：pdfjs 仅在全局缺失时才 polyfill，
    // 这里再把全局类显式锁定为本实例的，双保险保证 clip/setTransform 品牌一致。
    if (napi.Path2D) globalThis.Path2D = napi.Path2D;
    if (napi.DOMMatrix) globalThis.DOMMatrix = napi.DOMMatrix;
  }
  const { getDocument } = await import(pathToFileURL(pdfjsFile).href);
  // 标准字体与 CMap 目录：pdfjs 在 Node 环境下按文件路径读取（须为正斜杠结尾）
  const pdfjsRoot = path.join(path.dirname(pdfjsFile), '..', '..').replace(/\\/g, '/');
  const canvasFactory = {
    create(width, height) {
      const canvas = napiCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
      return { canvas, context: canvas.getContext('2d') };
    },
    reset(target, width, height) {
      if (!target) return;
      target.canvas.width = Math.max(1, Math.ceil(width));
      target.canvas.height = Math.max(1, Math.ceil(height));
    },
    destroy(target) {
      if (!target) return;
      target.canvas.width = 0;
      target.canvas.height = 0;
    },
  };
  return { getDocument, canvasFactory, pdfjsRoot };
}

/** 取得（或打开）指定 PDF 的文档实例；切换文件时释放旧实例 */
async function getPdfRenderDoc(filePath) {
  if (pdfRenderState.doc && pdfRenderState.filePath === filePath) return pdfRenderState.doc;
  if (pdfRenderState.doc) {
    try { await pdfRenderState.task.destroy(); } catch { /* 忽略释放异常 */ }
    pdfRenderState = { filePath: '', task: null, doc: null, canvasFactory: null };
    pdfPageCache.clear();
  }
  const { getDocument, canvasFactory, pdfjsRoot } = await loadPdfRenderDeps();
  const task = getDocument({
    data: new Uint8Array(fs.readFileSync(filePath)),
    canvasFactory,
    useSystemFonts: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    standardFontDataUrl: `${pdfjsRoot}/standard_fonts/`,
    cMapUrl: `${pdfjsRoot}/cmaps/`,
    cMapPacked: true,
  });
  const doc = await task.promise;
  pdfRenderState = { filePath, task, doc, canvasFactory };
  return doc;
}

/** 页数与首屏尺寸（scale=1），供渲染进程做「适应宽度」计算 */
ipcMain.handle('pdf:pageInfo', async (_e, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, message: '文件不存在' };
    const doc = await getPdfRenderDoc(filePath);
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    return {
      ok: true,
      pageCount: doc.numPages,
      width: Math.ceil(viewport.width),
      height: Math.ceil(viewport.height),
    };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/** 渲染指定页为 PNG data URL（scale 为缩放倍率，0.4~3） */
ipcMain.handle('pdf:renderPage', async (_e, payload) => {
  try {
    const { filePath } = payload || {};
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, message: '文件不存在' };
    const wanted = Math.max(1, Math.floor(Number(payload && payload.page) || 1));
    const scale = Math.min(3, Math.max(0.4, Number(payload && payload.scale) || 1.2));
    const cacheKey = `${filePath}|${wanted}|${scale}`;
    const hit = pdfPageCache.get(cacheKey);
    if (hit) return { ok: true, pageCount: hit.pageCount, page: hit.page, dataUrl: hit.dataUrl };

    const doc = await getPdfRenderDoc(filePath);
    const pageCount = doc.numPages;
    const pageNumber = Math.min(wanted, pageCount);
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    const canvas = napiCanvas(width, height);
    const canvasContext = canvas.getContext('2d');
    canvasContext.fillStyle = '#ffffff';
    canvasContext.fillRect(0, 0, width, height);
    await page.render({
      canvas,
      canvasContext,
      viewport,
      canvasFactory: pdfRenderState.canvasFactory,
    }).promise;
    const dataUrl = canvas.toDataURL('image/png');

    pdfPageCache.set(cacheKey, { pageCount, page: pageNumber, dataUrl });
    if (pdfPageCache.size > PDF_PAGE_CACHE_MAX) {
      const oldest = pdfPageCache.keys().next().value;
      pdfPageCache.delete(oldest);
    }
    page.cleanup();
    return { ok: true, pageCount, page: pageNumber, width, height, dataUrl };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/**
 * 把 pdfjs 解码出的内嵌图像（kind: 1=GRAYSCALE_1BPP 2=RGB_24BPP 3=RGBA_32BPP）
 * 编码为 24 位 BMP（自底向上行序、行 4 字节对齐、RGB→BGR），供系统 OCR 解码。
 */
function encodeBmp24(img) {
  const { width: w, height: h, kind, data } = img;
  const rowSize = (w * 3 + 3) & ~3;
  const buf = Buffer.alloc(54 + rowSize * h);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * h, 34);
  for (let y = 0; y < h; y++) {
    const dOff = 54 + (h - 1 - y) * rowSize;
    if (kind === 2) {
      const sOff = y * w * 3;
      for (let x = 0; x < w; x++) {
        buf[dOff + x * 3] = data[sOff + x * 3 + 2];
        buf[dOff + x * 3 + 1] = data[sOff + x * 3 + 1];
        buf[dOff + x * 3 + 2] = data[sOff + x * 3];
      }
    } else if (kind === 3) {
      const sOff = y * w * 4;
      for (let x = 0; x < w; x++) {
        buf[dOff + x * 3] = data[sOff + x * 4 + 2];
        buf[dOff + x * 3 + 1] = data[sOff + x * 4 + 1];
        buf[dOff + x * 3 + 2] = data[sOff + x * 4];
      }
    } else {
      const rowBytes = Math.ceil(w / 8);
      const sOff = y * rowBytes;
      for (let x = 0; x < w; x++) {
        const bit = (data[sOff + (x >> 3)] >> (7 - (x & 7))) & 1;
        const g = bit ? 255 : 0;
        buf[dOff + x * 3] = g;
        buf[dOff + x * 3 + 1] = g;
        buf[dOff + x * 3 + 2] = g;
      }
    }
  }
  return buf;
}

/** OCR 词坐标按版面行还原文本：按 y 分行、行内按 x 排序、列间距大时补空格（与 pdfLinesFromItems 同思路） */
function ocrWordsToLines(words) {
  if (!words.length) return '';
  const hs = words.map((w) => w.h).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)] || 1;
  const wids = words.map((w) => w.w).sort((a, b) => a - b);
  const medW = wids[Math.floor(wids.length / 2)] || 1;
  const tol = Math.max(12, medH * 0.6);
  const gapLimit = medW * 0.8;
  const sorted = [...words].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows = [];
  for (const w of sorted) {
    const cy = w.y + w.h / 2;
    const row = rows.find((r) => Math.abs(r.cy - cy) <= tol);
    if (row) {
      row.words.push(w);
      row.cy = (row.cy * (row.words.length - 1) + cy) / row.words.length;
    } else {
      rows.push({ cy, words: [w] });
    }
  }
  rows.sort((a, b) => a.cy - b.cy);
  return rows
    .map((row) => {
      const ws = row.words.sort((a, b) => a.x - b.x);
      let line = '';
      let prevEnd = Number.NEGATIVE_INFINITY;
      for (const w of ws) {
        if (line && w.x - prevEnd > gapLimit) line += '   ';
        line += w.text;
        prevEnd = w.x + w.w;
      }
      return line;
    })
    .join('\n');
}

/** 取 PDF 某页最大的内嵌扫描图（页面无图像时返回 null） */
async function pdfPageLargestImage(doc, pageNumber, OPS) {
  const page = await doc.getPage(pageNumber);
  const ops = await page.getOperatorList();
  let img = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
    const cand = await new Promise((res) => page.objs.get(ops.argsArray[i][0], res));
    if (cand && cand.data && (!img || cand.width * cand.height > img.width * img.height)) img = cand;
  }
  return img;
}

/** 用 Windows 系统 OCR 识别一张扫描图：BMP 临时文件 → WinRT OCR → 返回版面行文本与词坐标 */
async function ocrImageToText(img) {
  const tmpPath = path.join(os.tmpdir(), `ctr-ocr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.bmp`);
  fs.writeFileSync(tmpPath, encodeBmp24(img));
  const psPath = tmpPath.replace(/'/g, "''");
  const ps = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '[void][Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]',
    '[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType=WindowsRuntime]',
    '[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]',
    '$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods("Public, Static") | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethodDefinition -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1" })[0]',
    'function Await-Op($op, $rt) { $m = $asTask.MakeGenericMethod($rt); $t = $m.Invoke($null, @($op)); $t.Wait(); return $t.Result }',
    `if (-not (Test-Path '${psPath}')) { [Console]::Error.WriteLine("IMAGE_NOT_FOUND"); exit 2 }`,
    `$file = Await-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${psPath}')) ([Windows.Storage.StorageFile])`,
    '$stream = Await-Op ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream, Windows.Storage, ContentType=WindowsRuntime])',
    '$decoder = Await-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])',
    '$bitmap = Await-Op ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType=WindowsRuntime])',
    '$engine = $null',
    '$zh = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Where-Object { $_.LanguageTag -like "zh*" } | Select-Object -First 1',
    'if ($zh) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($zh) }',
    'if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }',
    'if (-not $engine) { [Console]::Error.WriteLine("NO_OCR_ENGINE"); exit 2 }',
    '$result = Await-Op ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime])',
    'foreach ($line in $result.Lines) { foreach ($w in $line.Words) { $r = $w.BoundingRect; [Console]::Out.WriteLine(([string][int]$r.X) + "`t" + ([string][int]$r.Y) + "`t" + ([string][int]$r.Width) + "`t" + ([string][int]$r.Height) + "`t" + $w.Text) } }',
  ].join('\n');

  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
        (err, out, stderr) => {
          if (err) {
            const detail = String(stderr || '').trim();
            if (detail.includes('NO_OCR_ENGINE')) reject(new Error('系统 OCR 引擎不可用（请确认系统语言含中文）'));
            else reject(new Error(detail || String(err.message || err)));
            return;
          }
          resolve(String(out || ''));
        },
      );
    });
    const words = [];
    for (const ln of stdout.split(/\r?\n/)) {
      const parts = ln.split('\t');
      if (parts.length < 5) continue;
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const w = Number(parts[2]);
      const h = Number(parts[3]);
      const text = parts.slice(4).join('\t').trim();
      if (!text || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      words.push({ x, y, w: Number.isFinite(w) ? w : 0, h: Number.isFinite(h) ? h : 0, text });
    }
    return { text: ocrWordsToLines(words), words };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

/** 单元格内容校验：排除表头词、地点/结论、编号与纯数字，避免误取相邻列 */
function isLikelyTestItemCell(value) {
  const s = value.replace(/[ \t]/g, '');
  if (!s) return false;
  if (/[试实]验项目/.test(s)) return false;
  if (/^[试实]?[验]?[项]?[目]?$/.test(s)) return false; // 标签被 OCR 拆断的半截（「项目」「试验」）
  if (
    /(数量|样件编号|样品编号|试验地点|判定|备注|试验设备|规格型号|序号|试验时间|试验日期|试验人员|试验员|试验方法|试验温度|实验室温度|湿度|大气压|设备号|样品批号|接受标准|接受准则|试验要求|试验标准)/.test(
      s,
    )
  ) {
    return false;
  }
  if (/(公司|工厂|有限公司|合格|不合格|日期)/.test(s)) return false;
  if (!/^[一-鿿A-Za-z0-9·\-—（）()]{2,24}$/.test(s)) return false;
  if (/\d{3,}/.test(s)) return false;
  if ((s.match(/[一-鿿]/g) || []).length < 2) return false;
  return true;
}

/**
 * 按列坐标从词里取「试验结果」表格的试验项目：
 * 先在表头行定位「试验项目」单元格的 x 范围（含「试验」「项目」被 OCR 拆开的写法），
 * 再取该列下方（或表头/数据被合并进同一行时同行）最近一行落在列内的词。
 * 这样不会把右侧「试验地点」「判定」等列的内容误当成试验项目。
 */
function extractTestItemFromWords(words) {
  const ws = (words || []).filter((w) => w && w.text);
  if (!ws.length) return '';
  const compact = (t) => t.replace(/[ \t]/g, '');
  const hs = ws.map((w) => w.h || 0).filter((v) => v > 0).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)] || 20;
  const tol = Math.max(10, medH * 0.6);

  // 按 y 中心聚成行
  const rows = [];
  for (const w of [...ws].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const cy = w.y + w.h / 2;
    const row = rows.find((r) => Math.abs(r.cy - cy) <= tol);
    if (row) {
      row.words.push(w);
      row.cy = (row.cy * (row.words.length - 1) + cy) / row.words.length;
    } else {
      rows.push({ cy, words: [w] });
    }
  }
  rows.sort((a, b) => a.cy - b.cy);

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const rw = [...row.words].sort((a, b) => a.x - b.x);
    if (!compact(rw.map((w) => w.text).join('')).includes('试验项目')) continue;

    // 行内定位「试验项目」：单字词或被拆成多段均可
    let startIdx = -1;
    let endIdx = -1;
    for (let i = 0; i < rw.length && startIdx < 0; i++) {
      let acc = compact(rw[i].text);
      for (let j = i; j < Math.min(rw.length, i + 4); j++) {
        if (j > i) acc += compact(rw[j].text);
        if (acc.includes('试验项目')) { startIdx = i; endIdx = j; break; }
        if (acc.length > 8) break;
      }
    }
    if (startIdx < 0) continue;

    const first = rw[startIdx];
    const last = rw[endIdx];

    // 表头按列间距切成单元格，验证它确实是网格表头（除「试验项目」外还有 ≥2 个表头关键字）；
    // 表单式（标签+值同行，如「试验项目 压力损失」）不在此处理，交给渲染进程文本解析
    const splitCells = (items) => {
      const out = [];
      let cur = null;
      let prev = null;
      for (const w of items) {
        if (!cur) cur = { text: w.text, x0: w.x, x1: w.x + w.w };
        else if (w.x - prev.x - prev.w > medH * 0.8) {
          out.push(cur);
          cur = { text: w.text, x0: w.x, x1: w.x + w.w };
        } else {
          cur.text += w.text;
          cur.x1 = w.x + w.w;
        }
        prev = w;
      }
      if (cur) out.push(cur);
      return out;
    };
    const headerCells = splitCells(rw);
    const gridCol = headerCells.findIndex((c) => compact(c.text).includes('试验项目'));
    if (gridCol < 0) continue;
    const otherHeaderHits = headerCells.filter(
      (c, idx) => idx !== gridCol && /(数量|样件编号|样品编号|试验地点|判定|备注|试验设备|规格型号|序号)/.test(compact(c.text)),
    ).length;

    // 标签行（表单式，如「试验项目 | 进气阻力 | 试验时间 | 2026/2/7」）：
    // 不是网格表头时，取同一行标签右侧（第二列）的第一个有效单元格
    if (otherHeaderHits < 2) {
      for (const c of headerCells.slice(gridCol + 1)) {
        const value = compact(c.text).replace(/^[：:＝=]+/, '');
        if (isLikelyTestItemCell(value)) return value;
      }
      // 标签与值粘在同一个单元格里（无列间距）时，去掉标签后取剩余部分
      const merged = compact(headerCells[gridCol].text).replace(/[试实]验项目/, '');
      const mergedValue = merged.replace(/^(名称|代号|编号)?[：:＝=]/, '');
      if (isLikelyTestItemCell(mergedValue)) return mergedValue;
      // 值单元格换行到下一行时，取下一行第一列
      if (ri + 1 < rows.length) {
        const nxt = splitCells([...rows[ri + 1].words].sort((a, b) => a.x - b.x));
        const wrapped = nxt.length ? compact(nxt[0].text).replace(/^[：:＝=]+/, '') : '';
        if (isLikelyTestItemCell(wrapped)) return wrapped;
      }
      continue;
    }

    // 网格表头：右边界取右侧表头列的起点，避免把「数量」「试验地点」列的内容算进来
    const rightCell = headerCells[gridCol + 1];
    const right = rightCell ? rightCell.x0 - 2 : last.x + last.w + medH * 0.5;

    // 表头下方的词按行聚合，逐行按列切分；跳过纯数字（序号列），取第一个像试验项目的单元格
    // 注意排除表头行自身的词：OCR 的字高/基线有抖动，表头词可能被算到「表头下方」，
    // 会拼出「试」「项目」这类半截标签被误当成试验项目
    const headerWords = new Set(row.words);
    const dataWords = ws.filter((w) => {
      if (headerWords.has(w)) return false;
      const cx = w.x + w.w / 2;
      const cy = w.y + w.h / 2;
      return cy > row.cy + tol * 0.5 && cx < right;
    });
    if (!dataWords.length) continue;

    const drows = [];
    for (const w of [...dataWords].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
      const cy = w.y + w.h / 2;
      const r = drows.find((d) => Math.abs(d.cy - cy) <= tol);
      if (r) {
        r.words.push(w);
        r.cy = (r.cy * (r.words.length - 1) + cy) / r.words.length;
      } else {
        drows.push({ cy, words: [w] });
      }
    }
    drows.sort((a, b) => a.cy - b.cy);

    for (let k = 0; k < drows.length && k < 4; k++) {
      const cells = splitCells([...drows[k].words].sort((a, b) => a.x - b.x));
      for (const c of cells) {
        const value = compact(c.text).replace(/^[：:]+/, '');
        if (isLikelyTestItemCell(value)) return value;
      }
    }
  }
  return '';
}

/**
 * 从试验结果表格读取流量：
 * 先定位含「接受标准 / 接受准则 / 试验要求」的表头（或字段）行，
 * 再在该行及其下方各行（直到「结论」行）的整行文字里找「数字 + kg/h 或 m³/h」。
 * 试验要求可能写在相邻列（如「SC6HAU进气流量380kg/h」），因此不再限定某一列；
 * 图表坐标轴「流量kg/h 104…312」没有「数字+kg/h」相邻形式，不会误取。
 * 多个流量按出现顺序用「/」连接。
 */
function extractFlowFromWords(words) {
  const ws = (words || []).filter((w) => w && w.text);
  if (!ws.length) return { flow: '', flowUnit: '' };
  const compact = (t) => t.replace(/[ \t]/g, '');
  const hs = ws.map((w) => w.h || 0).filter((v) => v > 0).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)] || 20;
  const tol = Math.max(10, medH * 0.6);

  // 按 y 中心聚成行
  const rows = [];
  for (const w of [...ws].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const cy = w.y + w.h / 2;
    const row = rows.find((r) => Math.abs(r.cy - cy) <= tol);
    if (row) {
      row.words.push(w);
      row.cy = (row.cy * (row.words.length - 1) + cy) / row.words.length;
    } else {
      rows.push({ cy, words: [w] });
    }
  }
  rows.sort((a, b) => a.cy - b.cy);

  const FLOW_CELL = /(\d+(?:\.\d+)?)(kg|m[³3])[\/／|丨]h/gi;
  const values = [];
  let unit = '';
  const rowText = (r) =>
    compact([...r.words].sort((a, b) => a.x - b.x).map((w) => w.text).join(''));

  for (let ri = 0; ri < rows.length; ri++) {
    if (!/(接受标准|接受准则|试验要求)/.test(rowText(rows[ri]))) continue;
    for (let k = ri; k < rows.length; k++) {
      const text = rowText(rows[k]);
      if (k > ri && (/(判定及结论|判定和结论|试验结论|结论)/.test(text) || /(接受标准|接受准则|试验要求)/.test(text))) break;
      for (const m of text.matchAll(FLOW_CELL)) {
        if (!values.includes(m[1])) values.push(m[1]);
        unit = m[2].toLowerCase().startsWith('m') ? 'm³/h' : 'kg/h';
      }
    }
  }

  return { flow: values.join('/'), flowUnit: values.length ? unit : '' };
}

/**
 * 扫描件 OCR：主进程逐页提取内嵌扫描图（pdfjs operator list，无需 canvas/worker），
 * 编码为 BMP 后调用 Windows 系统 OCR（WinRT Windows.Media.Ocr，离线、支持中文），
 * 按词坐标还原来版面行返回文本。封面必读；之后逐页识别直到找到「试验项目」表格（最多 8 页），
 * 因为试验项目优先取试验结果表里的值，单靠封面「项目名称」不一定准确。
 * 通过 PowerShell -EncodedCommand 执行，避免编码与转义问题。
 * 注意：WinRT 异步对象在 PowerShell 里是原始 COM 对象（Status/GetResults 不可直接用），
 * 必须经 WindowsRuntimeSystemExtensions.AsTask 反射包装；泛型重载按参数类型名
 * "IAsyncOperation`1" 过滤（PowerShell 双引号串内反引号需写两个）。
 */
ipcMain.handle('pdf:ocrFirstPage', async (_e, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, message: '文件不存在' };

    const pdfjsFile = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')
      : require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    const { getDocument, OPS } = await import(pathToFileURL(pdfjsFile).href);
    const data = new Uint8Array(fs.readFileSync(filePath));
    const task = getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      disableFontFace: true,
    });

    const pagesText = [];
    let tableItem = '';
    let flow = '';
    let flowUnit = '';
    let tablePages = 0;
    try {
      const doc = await task.promise;
      const maxPages = Math.min(doc.numPages, 8);
      for (let p = 1; p <= maxPages; p++) {
        const img = await pdfPageLargestImage(doc, p, OPS);
        if (!img || !img.data) continue;
        let ocr = { text: '', words: [] };
        try {
          ocr = await ocrImageToText(img);
        } catch (err) {
          // 封面识别失败直接报错；后续页失败则不再继续扫描
          if (p === 1) return { ok: false, message: String((err && err.message) || err) };
          break;
        }
        const pageText = ocr.text;
        if (pageText) pagesText.push(pageText);
        // 试验项目取「试验结果」表格里的值（按列坐标提取，避免误取相邻列）
        if (!tableItem) tableItem = extractTestItemFromWords(ocr.words);
        // 流量取试验项目表格「接受标准」列（数字 + kg/h 或 m³/h，多个用 / 连接）
        if (!flow) {
          const pf = extractFlowFromWords(ocr.words);
          if (pf.flow) {
            flow = pf.flow;
            flowUnit = pf.flowUnit;
          }
        }
        const hasItemLabel = /[试实]\s*验\s*项\s*目/.test(pageText);
        if (hasItemLabel || tableItem) {
          // 已读到表格页：拿到流量即可停止，否则多给一页（接受标准可能续到下一页）
          if (flow) break;
          tablePages += 1;
          if (tablePages > 1) break;
        }
      }
    } finally {
      await task.destroy();
    }

    if (!pagesText.length) return { ok: false, message: '未识别到文字' };
    return { ok: true, text: pagesText.join('\n\n'), testItem: tableItem, flow, flowUnit };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});
/** 将 PDF 文件（含 UNC 路径）拷贝到临时目录，返回 file:// URL 供 iframe 原生 PDF 查看器加载（避免 data URL 长度限制） */
ipcMain.handle('db:pdfData', async (_e, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, message: '文件不存在' };
    if (!/\.pdf$/i.test(filePath)) return { ok: false, message: '仅支持 PDF 文件' };
    const st = fs.statSync(filePath);
    if (st.size > 200 * 1024 * 1024) return { ok: false, message: '文件过大（>200MB）暂不支持预览' };

    // 拷贝到临时目录，避免 UNC 网络路径 + data URL 长度限制双重问题
    const tmpDir = path.join(app.getPath('temp'), 'ctr-pdf-preview');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const safeName = crypto.randomBytes(6).toString('hex') + '_' + path.basename(filePath);
    const tmpPath = path.join(tmpDir, safeName);
    fs.copyFileSync(filePath, tmpPath);

    // 清理临时目录中过期文件（保留最近 30 分钟内创建的）
    try {
      const now = Date.now();
      for (const n of fs.readdirSync(tmpDir)) {
        const p = path.join(tmpDir, n);
        try {
          const s = fs.statSync(p);
          if (now - s.mtimeMs > 30 * 60 * 1000) fs.unlinkSync(p);
        } catch {}
      }
    } catch {}

    const fileUrl = pathToFileURL(tmpPath).href;
    return { ok: true, fileUrl, size: st.size };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/** 材料库写入：一条记录一个 Parquet 文件 */
ipcMain.handle('material:write', async (_e, payload) => {
  try {
    const { record, fileName, overwrite } = payload || {};
    if (!record || typeof record !== 'object') return { ok: false, message: '材料记录为空' };
    const safeName = path.basename(String(fileName || ''));
    if (!/\.parquet$/i.test(safeName)) return { ok: false, message: '材料库文件必须为 .parquet' };
    ensureDir(UNC_MATERIAL_LIB);
    const filePath = path.join(UNC_MATERIAL_LIB, safeName);
    await writeMaterialParquet(filePath, record, overwrite === true);
    return { ok: true, filePath, targetDir: UNC_MATERIAL_LIB };
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      return { ok: false, exists: true, message: '同名记录已存在' };
    }
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/** FMEA 案例库写入：一条知识卡片一个 Parquet 文件（文件名即编号） */
ipcMain.handle('fmea:write', async (_e, payload) => {
  try {
    const { record, fileName, overwrite } = payload || {};
    if (!record || typeof record !== 'object') return { ok: false, message: 'FMEA 记录为空' };
    const safeName = path.basename(String(fileName || ''));
    if (!/\.parquet$/i.test(safeName)) return { ok: false, message: 'FMEA 库文件必须为 .parquet' };
    ensureDir(KBE_FMEA);
    const filePath = path.join(KBE_FMEA, safeName);
    await writeFmeaParquet(filePath, record, overwrite === true);
    return { ok: true, filePath, targetDir: KBE_FMEA };
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      return { ok: false, exists: true, message: '同名 FMEA 记录已存在' };
    }
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/** 归档 Excel 到 UNC 数据库目录 */
ipcMain.handle('db:archive', async (_e, payload) => {
  try {
    const { base64, fileName, libType, overwrite } = payload || {};
    const targetDir = libDir(libType);
    if (!targetDir) return { ok: false, message: '未知库类型' };
    ensureDir(targetDir);
    const filePath = path.join(targetDir, fileName);
    if (fs.existsSync(filePath) && overwrite === false) {
      return { ok: false, exists: true, message: '同名记录已存在' };
    }
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return { ok: true, filePath, targetDir };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/** 列出某个数据库目录下的归档文件（材料库为 .parquet，兼容旧 .json，其余为 .xlsx + .pdf） */
ipcMain.handle('db:list', async (_e, payload) => {
  try {
    const { libType } = payload || {};
    const targetDir = libDir(libType);
    if (!targetDir) return { ok: false, message: '未知库类型' };
    if (!fs.existsSync(targetDir)) return { ok: true, dir: targetDir, files: [] };
    const extRe =
      libType === 'material'
        ? /\.(parquet|json)$/i
        : libType === 'fmea'
          ? /^FM-\d{4}-\d{3,}\.parquet$/i
          : /\.(xlsx|pdf)$/i;
    const files = fs
      .readdirSync(targetDir)
      .filter((n) => extRe.test(n))
      .map((name) => {
        const st = fs.statSync(path.join(targetDir, name));
        return { name, size: st.size, mtime: st.mtime.toISOString(), fullPath: path.join(targetDir, name) };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    return { ok: true, dir: targetDir, files };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/** 读取 xlsx 归档文件，返回 sheet 行，供可信资产匹配使用 */
ipcMain.handle('db:read', async (_e, payload) => {
  try {
    const { fullPath } = payload || {};
    if (!fullPath || !fs.existsSync(fullPath)) return { ok: false, message: '文件不存在' };
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fullPath);
    const ws = wb.worksheets[0];
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      rows.push(row.values.slice(1)); // 第 0 项是 undefined
    });
    return { ok: true, rows, sheetCount: wb.worksheets.length };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/** 读取归档：材料库 Parquet 转为 JSON 文本返回，其余读取文本文件 */
ipcMain.handle('db:readText', async (_e, payload) => {
  try {
    const { fullPath } = payload || {};
    if (!fullPath || !fs.existsSync(fullPath)) return { ok: false, message: '文件不存在' };
    const allowedRoots = [UNC_CALC_LIB, UNC_TEST_LIB, UNC_TRUSTED, UNC_CAE_LIB, UNC_MATERIAL_LIB, KBE_THEORY, KBE_DESIGN, KBE_FMEA];
    if (!isInAnyRoot(fullPath, allowedRoots)) return { ok: false, message: '仅允许读取数据库目录内的归档文件' };
    if (/\.parquet$/i.test(fullPath)) {
      // FMEA 库与材料库共用 Parquet 扩展名，按所在目录选择对应的读取器
      const record =
        path.resolve(fullPath).toLowerCase().startsWith(path.resolve(KBE_FMEA).toLowerCase())
          ? await readFmeaParquet(fullPath)
          : await readMaterialParquet(fullPath);
      if (!record) return { ok: false, message: 'Parquet 记录为空或格式不正确' };
      return { ok: true, text: JSON.stringify(record) };
    }
    if (!/\.(json|csv|txt)$/i.test(fullPath)) return { ok: false, message: '仅支持文本类归档文件' };
    return { ok: true, text: fs.readFileSync(fullPath, 'utf8') };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/** 删除归档文件（仅限已知库目录内的文件，防止越权删除） */
ipcMain.handle('db:delete', async (_e, payload) => {
  try {
    const { fullPath } = payload || {};
    if (!fullPath || !fs.existsSync(fullPath)) return { ok: false, message: '文件不存在' };
    const allowedRoots = [UNC_CALC_LIB, UNC_TEST_LIB, UNC_TRUSTED, UNC_CAE_LIB, UNC_MATERIAL_LIB, KBE_THEORY, KBE_DESIGN, KBE_FMEA];
    if (!isInAnyRoot(fullPath, allowedRoots)) return { ok: false, message: '仅允许删除数据库目录内的归档文件' };
    fs.unlinkSync(fullPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/** 数据库连通性自检（UNC 根 + 知识库根） */
ipcMain.handle('db:ping', async () => {
  return {
    reachable: fs.existsSync(UNC_ROOT) || fs.existsSync(KBE_ROOT),
    root: UNC_ROOT,
    calc: UNC_CALC_LIB,
    test: UNC_TEST_LIB,
    trusted: UNC_TRUSTED,
    cae: UNC_CAE_LIB,
    material: UNC_MATERIAL_LIB,
    kbeRoot: KBE_ROOT,
    kbeTheory: KBE_THEORY,
    kbeDesign: KBE_DESIGN,
    kbeFmea: KBE_FMEA,
  };
});

/** 用系统默认程序打开文件（支持本地与 UNC 路径） */
ipcMain.handle('app:openPath', async (_e, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, message: '文件不存在或无法访问' };
    const errMsg = await shell.openPath(filePath);
    if (errMsg) return { ok: false, message: errMsg };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/** CAE 报告：PPT/PPTX 转换用的临时目录 */
const PPT_TEMP_DIR = path.join(os.tmpdir(), 'ctr-cae-ppt');

function pptTempDir() {
  ensureDir(PPT_TEMP_DIR);
  return PPT_TEMP_DIR;
}

/** 生成并执行临时 PowerShell 脚本（UTF-8 BOM，兼容中文路径） */
function runPowerShell(script, timeout = 180000) {
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), `ctr-ppt-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
    try {
      fs.writeFileSync(file, '\ufeff' + script, 'utf8');
    } catch (err) {
      resolve({ ok: false, message: String((err && err.message) || err) });
      return;
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file],
      { timeout, windowsHide: true },
      (err, stdout, stderr) => {
        try {
          fs.unlinkSync(file);
        } catch {}
        resolve({
          ok: !err,
          message: err ? `${String((err && err.message) || err)} ${stderr || ''}`.trim() : '',
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });
}

/** 查找 LibreOffice（未安装时返回空串，避免直接抛错） */
function findSoffice() {
  const candidates = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function convertWithLibreOffice(src, outDir) {
  return new Promise((resolve) => {
    const soffice = findSoffice();
    if (!soffice) {
      resolve({ ok: false, message: '未安装 LibreOffice' });
      return;
    }
    execFile(
      soffice,
      ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, src],
      { timeout: 180000, windowsHide: true },
      (err, stdout, stderr) =>
        resolve({
          ok: !err,
          message: err ? `${String((err && err.message) || err)} ${stderr || ''}`.trim() : '',
        }),
    );
  });
}

/**
 * CAE 报告导入：把 PPT / PPTX 转成文字版 PDF。
 * 优先使用本机 PowerPoint（WPS 演示兜底）的 COM 自动化，其次 LibreOffice 无头模式；
 * 转换后的 PDF 返回临时路径与 base64，由渲染进程解析元信息、清理临时文件。
 */
ipcMain.handle('ppt:toPdf', async (_e, filePath) => {
  try {
    const src = String(filePath || '');
    if (!src || !fs.existsSync(src)) return { ok: false, message: '文件不存在或无法访问' };
    if (!/\.(pptx?|ppsx?)$/i.test(src)) return { ok: false, message: '仅支持 PPT / PPTX 文件' };

    const dir = pptTempDir();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dst = path.join(dir, `cae-${stamp}.pdf`);

    // 1) Office / WPS COM 自动化（ppSaveAsPDF = 32）
    const script = `
$ErrorActionPreference = 'Stop'
$src = '${src.replace(/'/g, "''")}'
$dst = '${dst.replace(/'/g, "''")}'
$ok = $false
foreach ($id in @('PowerPoint.Application','KWPP.Application')) {
  $app = $null
  $pres = $null
  try {
    $app = New-Object -ComObject $id
    $pres = $app.Presentations.Open($src, -1, 0, 0)
    $pres.SaveAs($dst, 32)
    $pres.Close()
    $app.Quit()
    $ok = $true
    break
  } catch {
    if ($pres) { try { $pres.Close() } catch {} }
    if ($app) { try { $app.Quit() } catch {} }
  }
}
if ($ok) { Write-Output 'OK' } else { Write-Output 'ERR'; exit 1 }
`;
    await runPowerShell(script);

    // 2) LibreOffice 兜底
    if (!fs.existsSync(dst) || fs.statSync(dst).size === 0) {
      const loDir = path.join(dir, `lo-${stamp}`);
      ensureDir(loDir);
      await convertWithLibreOffice(src, loDir);
      const produced = fs.existsSync(loDir)
        ? fs.readdirSync(loDir).find((f) => /\.pdf$/i.test(f))
        : null;
      if (produced) {
        try {
          fs.renameSync(path.join(loDir, produced), dst);
        } catch {}
      }
      try {
        fs.rmSync(loDir, { recursive: true, force: true });
      } catch {}
    }

    if (!fs.existsSync(dst) || fs.statSync(dst).size === 0) {
      return {
        ok: false,
        message: 'PPT 转 PDF 失败：未检测到可用的 PowerPoint / WPS / LibreOffice，请安装其中之一后重试',
      };
    }

    return { ok: true, pdfPath: dst, pdfBase64: fs.readFileSync(dst).toString('base64') };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/** 清理 PPT 转换产生的临时 PDF（仅允许临时目录内的文件） */
ipcMain.handle('ppt:cleanup', (_e, pdfPath) => {
  try {
    const p = path.normalize(String(pdfPath || ''));
    const root = path.normalize(PPT_TEMP_DIR + path.sep);
    if (!p.startsWith(root)) return { ok: false, message: '仅允许清理临时目录内的文件' };
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  dataDir: store.dataPath(),
}));

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  store.init(app.getPath('userData'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
