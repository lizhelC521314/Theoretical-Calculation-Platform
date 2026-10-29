const fs = require('node:fs');
const path = require('node:path');

// 本地数据仓库：单机离线场景使用 JSON 文件，位于用户数据目录，无需原生编译依赖
let dataFile = '';
let cache = null;

const emptyData = () => ({
  users: [],
  history: [],
  projects: [],
  settings: { license: null },
});

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  dataFile = path.join(dir, 'ctr-data.json');
  try {
    cache = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch {
    cache = null;
  }
  const base = emptyData();
  cache = Object.assign(base, cache || {});
  if (!Array.isArray(cache.users)) cache.users = [];
  if (!Array.isArray(cache.history)) cache.history = [];
  if (!Array.isArray(cache.projects)) cache.projects = [];
  // 旧数据迁移：补 customer/code 并重新计算 name（客户 + 项目代号）；补 version
  cache.projects = cache.projects.map((p) => {
    const version = typeof p.version === 'string' ? p.version : '';
    if (typeof p.customer !== 'string' || typeof p.code !== 'string') {
      const customer = String(p.name || '').trim() || '未填写';
      const code = '';
      return { ...p, customer, code, version, name: code ? `${customer} ${code}` : customer };
    }
    return { ...p, version };
  });
  if (!cache.settings) cache.settings = { license: null };
  persist();
}

function persist() {
  fs.writeFileSync(dataFile, JSON.stringify(cache, null, 2), 'utf8');
}

function get() {
  return cache;
}

function dataPath() {
  return dataFile;
}

module.exports = { init, get, persist, dataPath };
