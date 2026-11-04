const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const store = require('./store.cjs');
const license = require('./license.cjs');

const UNC_ROOT = '\\\\10.1.1.245\\Product Database';
const UNC_CALC_LIB = `${UNC_ROOT}\\Theoretical Calculation Library`;
const UNC_TEST_LIB = `${UNC_ROOT}\\Experimental Test Database`;
const UNC_TRUSTED = `${UNC_ROOT}\\Trusted Data Asset Library`;

const KBE_ROOT = '\\\\10.1.1.245\\Knowledge & Experience Base';
const KBE_THEORY = `${KBE_ROOT}\\Theoretical Knowledge Base`;
const KBE_DESIGN = `${KBE_ROOT}\\Product Design Library`;
const KBE_FMEA = `${KBE_ROOT}\\FMEA Library`;

function libDir(libType) {
  switch (libType) {
    case 'calc': return UNC_CALC_LIB;
    case 'test': return UNC_TEST_LIB;
    case 'trusted': return UNC_TRUSTED;
    case 'theory': return KBE_THEORY;
    case 'design': return KBE_DESIGN;
    case 'fmea': return KBE_FMEA;
    default: return null;
  }
}
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

const isDev = !app.isPackaged;
const PRODUCT_TITLE = '汽车零部件理论计算平台';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: PRODUCT_TITLE,
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
  const { defaultName, content, encoding } = payload || {};
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '保存计算结果',
    defaultPath: defaultName || 'calculation.csv',
    filters: [
      { name: 'CSV 表格', extensions: ['csv'] },
      { name: 'JSON 数据', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(res.filePath, content, encoding === 'base64' ? 'base64' : 'utf8');
  return { ok: true, filePath: res.filePath };
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

/** 读取实验报告 PDF 文本（主进程读取，规避渲染进程 file:// 下的 worker 限制） */
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
    return { ok: true, text: pages.join('\n') };
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

/** 归档 Excel 到 UNC 数据库目录 */
ipcMain.handle('db:archive', async (_e, payload) => {
  try {
    const { base64, fileName, libType } = payload || {};
    const targetDir = libDir(libType);
    if (!targetDir) return { ok: false, message: '未知库类型' };
    ensureDir(targetDir);
    const filePath = path.join(targetDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return { ok: true, filePath, targetDir };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
});

/** 列出某个数据库目录下的归档文件（.xlsx + .pdf） */
ipcMain.handle('db:list', async (_e, payload) => {
  try {
    const { libType } = payload || {};
    const targetDir = libDir(libType);
    if (!targetDir) return { ok: false, message: '未知库类型' };
    if (!fs.existsSync(targetDir)) return { ok: true, dir: targetDir, files: [] };
    const files = fs
      .readdirSync(targetDir)
      .filter((n) => /\.(xlsx|pdf)$/i.test(n))
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

/** 删除归档文件（仅限已知库目录内的文件，防止越权删除） */
ipcMain.handle('db:delete', async (_e, payload) => {
  try {
    const { fullPath } = payload || {};
    if (!fullPath || !fs.existsSync(fullPath)) return { ok: false, message: '文件不存在' };
    const allowedRoots = [UNC_CALC_LIB, UNC_TEST_LIB, UNC_TRUSTED, KBE_THEORY, KBE_DESIGN, KBE_FMEA];
    const normalized = path.resolve(fullPath).toLowerCase();
    const inLib = allowedRoots.some((root) => {
      const r = path.resolve(root).toLowerCase();
      return normalized.startsWith(r + path.sep);
    });
    if (!inLib) return { ok: false, message: '仅允许删除数据库目录内的归档文件' };
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
