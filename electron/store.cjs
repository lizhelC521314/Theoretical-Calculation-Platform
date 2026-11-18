const fs = require('node:fs');
const path = require('node:path');

// 本地数据仓库：单机离线场景使用 JSON 文件，位于用户数据目录，无需原生编译依赖
const SCHEMA_VERSION = 1;
const DAILY_KEEP = 7;
const MANUAL_KEEP = 5;

let dataDir = '';
let dataFile = '';
let backupDir = '';
let cache = null;
// 写盘调度：连续变更合并到一次落盘，避免保存计算记录/项目时反复序列化整份数据
let flushTimer = null;
let pending = false;

const emptyData = () => ({
  schemaVersion: SCHEMA_VERSION,
  users: [],
  history: [],
  projects: [],
  settings: { license: null },
  // 实验库（LabStore）快照：null 表示尚未入库任何实验数据
  lab: null,
  // AI 公式优化：标定记录（草稿 / 审核 / 发布）
  aiCalibrations: [],
});

/** 读取 JSON，失败返回 null（不抛异常，交由调用方决定回退策略） */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 结构校验：缺少核心数组视为损坏，避免把半截文件当成有效数据继续使用 */
function isValidData(d) {
  return (
    !!d &&
    typeof d === 'object' &&
    Array.isArray(d.users) &&
    Array.isArray(d.projects) &&
    Array.isArray(d.history)
  );
}

function stampDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function stampTime(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${stampDate(d)}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 复制文件：先写临时副本再重命名，避免复制过程中断留下半份备份 */
function copyAtomic(src, dst) {
  const tmp = `${dst}.tmp`;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dst);
}

/** 列出可用备份（按时间倒序） */
function listBackupFiles() {
  if (!backupDir) return [];
  try {
    return fs
      .readdirSync(backupDir)
      .filter((n) => /^ctr-data-[\w.-]+\.json$/i.test(n))
      .map((n) => {
        const p = path.join(backupDir, n);
        const st = fs.statSync(p);
        return { name: n, path: p, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

/** 只保留最近 N 份匹配的备份 */
function pruneBackups(re, keep) {
  const matched = listBackupFiles().filter((b) => re.test(b.name));
  matched.slice(keep).forEach((b) => {
    try {
      fs.unlinkSync(b.path);
    } catch {
      /* 文件被占用时下次再清理 */
    }
  });
}

/** 版本迁移：当前只有 v0（无 schemaVersion）→ v1，后续新版本在此追加 */
function migrate(data) {
  const from = Number(data.schemaVersion) || 0;
  if (from < 1) {
    // v0：补 customer/code/version 并重新计算 name（客户 + 项目代号）
    data.projects = data.projects.map((p) => {
      const version = typeof p.version === 'string' ? p.version : '';
      if (typeof p.customer !== 'string' || typeof p.code !== 'string') {
        const customer = String(p.name || '').trim() || '未填写';
        const code = '';
        return { ...p, customer, code, version, name: code ? `${customer} ${code}` : customer };
      }
      return { ...p, version };
    });
  }
  data.schemaVersion = SCHEMA_VERSION;
  return data;
}

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  dataDir = dir;
  dataFile = path.join(dir, 'ctr-data.json');
  backupDir = path.join(dir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const hadFile = fs.existsSync(dataFile);
  let loaded = readJson(dataFile);
  // 主文件存在但无法解析或结构异常：先留存现场（便于排查），再按"损坏"处理
  if (hadFile && (!loaded || !isValidData(loaded))) {
    try {
      fs.renameSync(dataFile, `${dataFile}.corrupt-${stampTime()}`);
    } catch {
      /* 留存失败不影响后续回退 */
    }
    loaded = null;
  }
  // 主文件缺失或损坏：回退到最近一份可用备份
  if (!loaded) {
    for (const b of listBackupFiles()) {
      const d = readJson(b.path);
      if (isValidData(d)) {
        copyAtomic(b.path, dataFile);
        loaded = d;
        break;
      }
    }
  }

  cache = Object.assign(emptyData(), loaded || {});
  if (!Array.isArray(cache.users)) cache.users = [];
  if (!Array.isArray(cache.history)) cache.history = [];
  if (!Array.isArray(cache.projects)) cache.projects = [];
  if (!Array.isArray(cache.aiCalibrations)) cache.aiCalibrations = [];
  if (!cache.settings) cache.settings = { license: null };
  migrate(cache);

  persist(true);
  ensureDailyBackup();
}

/**
 * 立即落盘：写临时文件后重命名，避免写一半中断导致数据文件损坏。
 * 失败时保留待写标记，下次触发会重试。
 */
function writeNow() {
  if (!pending) return;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    const tmp = `${dataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, dataFile);
    pending = false;
  } catch (err) {
    // 保持 pending=true，交由下一次 flush 重试
    console.error('保存本地数据失败：', (err && err.message) || err);
  }
}

/**
 * 标记数据已变更并安排写盘。
 * immediate=true 时立即写（初始化等关键节点），否则合并 300ms 内的连续变更。
 */
function persist(immediate = false) {
  pending = true;
  if (immediate) {
    writeNow();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(writeNow, 300);
}

/** 退出前强制落盘，避免合并窗口内的变更丢失 */
function flush() {
  writeNow();
}

/** 每日首次启动自动备份当天快照，保留最近 7 天 */
function ensureDailyBackup() {
  try {
    if (!fs.existsSync(dataFile)) return;
    const target = path.join(backupDir, `ctr-data-${stampDate()}.json`);
    if (!fs.existsSync(target)) copyAtomic(dataFile, target);
    pruneBackups(/^ctr-data-\d{8}\.json$/i, DAILY_KEEP);
  } catch (err) {
    console.error('创建每日备份失败：', (err && err.message) || err);
  }
}

/** 手动备份（设置页按钮），保留最近 5 份 */
function createBackup(prefix = 'manual') {
  try {
    flush();
    if (!fs.existsSync(dataFile)) return { ok: false, message: '数据文件不存在' };
    const name = `ctr-data-${prefix}-${stampTime()}.json`;
    copyAtomic(dataFile, path.join(backupDir, name));
    pruneBackups(new RegExp(`^ctr-data-${prefix}-`), MANUAL_KEEP);
    return { ok: true, name };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
}

/** 从备份恢复；恢复前自动留一份当前数据，便于反悔 */
function restore(name) {
  try {
    if (!/^ctr-data-[\w.-]+\.json$/i.test(String(name || ''))) {
      return { ok: false, message: '备份文件名不合法' };
    }
    const src = path.join(backupDir, name);
    // 双保险：确认解析后的路径仍在备份目录内
    if (path.relative(backupDir, src).startsWith('..') || path.isAbsolute(path.relative(backupDir, src))) {
      return { ok: false, message: '备份路径不合法' };
    }
    const d = readJson(src);
    if (!isValidData(d)) return { ok: false, message: '备份文件已损坏，无法恢复' };
    createBackup('before-restore');
    copyAtomic(src, dataFile);
    cache = migrate(Object.assign(emptyData(), d));
    persist(true);
    return { ok: true, message: '恢复完成，请重启软件以加载恢复后的数据' };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
}

function listBackups() {
  return listBackupFiles().map((b) => ({ name: b.name, size: b.size, mtime: b.mtime }));
}

function get() {
  return cache;
}

function dataPath() {
  return dataFile;
}

function backupPath() {
  return backupDir;
}

module.exports = {
  SCHEMA_VERSION,
  init,
  get,
  persist,
  flush,
  dataPath,
  backupPath,
  listBackups,
  createBackup,
  restore,
};
