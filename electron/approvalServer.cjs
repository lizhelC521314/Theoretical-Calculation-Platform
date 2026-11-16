/**
 * 审批服务端（李华东电脑）：局域网 HTTP 服务，接收标准版导出方的审批请求，
 * 李华东点击"解密/拒绝"后，生成 5 分钟有效的解密令牌返回。
 *
 * 协议（JSON，Content-Type: application/json）：
 *   POST /pending      请求审批  { requestId, fileName, fileHash, operator, port }
 *   GET  /poll/:id     轮询状态  → { status: 'pending' | 'approved' | 'rejected', token? }
 *   POST /resolve/:id  审批通过  { action: 'approve' | 'reject', token }  // 主进程内部调用
 */
const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');

const DEFAULT_PORT = 39125;
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 分钟

// —— 访问控制与限流 ——
// 默认只允许本机与 10.1.1.0/24 网段访问审批服务；
// 导出方不在该网段时，用环境变量 CTR_APPROVAL_ALLOW=10.1.1.0/24,10.1.2.0/24 覆盖
const DEFAULT_ALLOWED_CIDRS = ['127.0.0.1/32', '10.1.1.0/24'];
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQ = 120; // 每 IP 每分钟请求上限
const AUTH_FAIL_LIMIT = 10; // 5 分钟内密钥错误次数上限
const AUTH_FAIL_WINDOW_MS = 5 * 60 * 1000;
const BLOCK_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PENDING = 50;

/** 允许的网段，可用环境变量 CTR_APPROVAL_ALLOW=10.1.0.0/16,192.168.1.0/24 覆盖 */
let allowedCidrs = (() => {
  const fromEnv = String(process.env.CTR_APPROVAL_ALLOW || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ALLOWED_CIDRS.slice();
})();

/** 每 IP 请求计数：ip → { windowStart, count } */
const rateMap = new Map();
/** 每 IP 密钥失败计数：ip → { windowStart, count, blockedUntil } */
const failMap = new Map();
/** 已消费的令牌：令牌一次性使用，防止被重复拿去解密 */
const usedTokens = new Set();

/** 待审批请求内存表：requestId → { request, res, resolveTimer, expireAt } */
const pending = new Map();
/** 已签发的令牌表：token → { requestId, fileHash, expiresAt } */
const issuedTokens = new Map();
/** 客户端密钥（服务端启动时随机生成，客户端通过首个 poll 返回） */
let serverSecret = '';
let server = null;
let currentPort = 0;
let allowedClientKey = ''; // 客户端连接密钥，防止任意局域网请求

/** 服务是否在运行（main.cjs 通过此函数判断，不能直接读未导出的 server 变量） */
function isRunning() {
  return !!server;
}

/** 当前监听端口（未运行时为 0） */
function getPort() {
  return currentPort;
}

function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(ifaces)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

/** IPv4 转 32 位整数，非法返回 null */
function ipToInt(ip) {
  const parts = String(ip || '').split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value * 256) + n;
  }
  return value >>> 0;
}

/** 统一 IPv6 映射地址与回环地址的表示 */
function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

/** 判断来源 IP 是否在允许网段内 */
function isIpAllowed(rawIp) {
  const value = ipToInt(normalizeIp(rawIp));
  if (value == null) return false;
  for (const cidr of allowedCidrs) {
    const [base, bitsRaw] = String(cidr).split('/');
    const bits = bitsRaw == null ? 32 : Number(bitsRaw);
    const baseValue = ipToInt(base);
    if (baseValue == null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if (((value & mask) >>> 0) === ((baseValue & mask) >>> 0)) return true;
  }
  return false;
}

/** 每 IP 每分钟请求数限流；超限返回 true */
function isRateLimited(ip) {
  const now = Date.now();
  const state = rateMap.get(ip);
  if (!state || now - state.windowStart > RATE_WINDOW_MS) {
    rateMap.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  state.count += 1;
  return state.count > RATE_MAX_REQ;
}

/** 该 IP 是否因密钥连续错误被临时封禁 */
function isBlocked(ip) {
  const state = failMap.get(ip);
  return !!state && state.blockedUntil > Date.now();
}

/** 记录一次密钥校验失败，达到阈值后封禁一段时间 */
function noteAuthFailure(ip) {
  const now = Date.now();
  const state = failMap.get(ip);
  if (!state || now - state.windowStart > AUTH_FAIL_WINDOW_MS) {
    failMap.set(ip, { windowStart: now, count: 1, blockedUntil: 0 });
    return;
  }
  state.count += 1;
  if (state.count >= AUTH_FAIL_LIMIT) state.blockedUntil = now + BLOCK_MS;
}

/** 防止两个计数表无限增长 */
function pruneThrottleMaps() {
  if (rateMap.size > 500 || failMap.size > 500) {
    const now = Date.now();
    for (const [ip, s] of rateMap) {
      if (now - s.windowStart > RATE_WINDOW_MS) rateMap.delete(ip);
    }
    for (const [ip, s] of failMap) {
      if (now - s.windowStart > AUTH_FAIL_WINDOW_MS && s.blockedUntil <= now) failMap.delete(ip);
    }
  }
}

/** 生成自包含令牌（HMAC-SHA256 签名），客户端可独立验证有效期 */
function signToken(payload) {
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', serverSecret).update(json).digest('hex');
  return Buffer.from(`${json}.${sig}`, 'utf8').toString('base64');
}

function verifyToken(tokenBase64) {
  try {
    const raw = Buffer.from(tokenBase64, 'base64').toString('utf8');
    const idx = raw.lastIndexOf('.');
    if (idx < 0) return null;
    const json = raw.slice(0, idx);
    const sig = raw.slice(idx + 1);
    const expected = crypto.createHmac('sha256', serverSecret).update(json).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(json);
    if (payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // 限制请求体大小，避免异常客户端占用内存
      if (size > MAX_BODY_BYTES) {
        const err = new Error('请求体过大');
        err.code = 'BODY_TOO_LARGE';
        reject(err);
        // 丢弃剩余数据而不是销毁连接，保证 413 响应能正常返回
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function checkClientKey(req) {
  const key = req.headers['x-client-key'];
  if (!allowedClientKey) return true; // 未设置密钥时不校验
  return key === allowedClientKey;
}

function handleRequest(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, 204, {});
  // 网段限制 + 限流 + 失败封禁：审批服务只应对局域网内可信机器开放
  const ip = normalizeIp(req.socket.remoteAddress);
  if (!isIpAllowed(ip)) {
    return jsonResponse(res, 403, { ok: false, message: '该网段不允许访问审批服务' });
  }
  if (isBlocked(ip)) {
    return jsonResponse(res, 429, { ok: false, message: '密钥错误次数过多，请 5 分钟后再试' });
  }
  pruneThrottleMaps();
  if (isRateLimited(ip)) {
    return jsonResponse(res, 429, { ok: false, message: '请求过于频繁，请稍后再试' });
  }
  if (!checkClientKey(req)) {
    noteAuthFailure(ip);
    return jsonResponse(res, 401, { ok: false, message: '客户端密钥不匹配' });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // 健康检查：供导出方「测试连接」使用，不做任何审批动作
  if (req.method === 'GET' && url.pathname === '/health') {
    return jsonResponse(res, 200, {
      ok: true,
      service: 'ctr-approval',
      version: 1,
      pending: Array.from(pending.values()).filter((e) => e.status === 'pending').length,
      tokenTtlMin: Math.round(TOKEN_TTL_MS / 60000),
    });
  }

  if (req.method === 'POST' && url.pathname === '/pending') {
    return readBody(req)
      .then((body) => {
        let payload;
        try { payload = JSON.parse(body || '{}'); } catch { return jsonResponse(res, 400, { ok: false, message: 'JSON 格式错误' }); }
        // 待审批请求数量上限，避免被刷出大量待办
        if (Array.from(pending.values()).filter((e) => e.status === 'pending').length >= MAX_PENDING) {
          return jsonResponse(res, 429, { ok: false, message: '待审批请求过多，请先处理现有请求' });
        }
        const requestId = String(payload.requestId || crypto.randomUUID());
        const pendingEntry = {
          requestId,
          fileName: String(payload.fileName || '未知文件'),
          fileHash: String(payload.fileHash || ''),
          operator: String(payload.operator || '未知用户'),
          createdAt: Date.now(),
          status: 'pending',
          response: res,
          notifiedAt: null,
        };
        pending.set(requestId, pendingEntry);
        setTimeout(() => {
          if (pending.get(requestId)?.status === 'pending') {
            pending.delete(requestId);
          }
        }, 10 * 60 * 1000); // 10 分钟未审批自动超时
        // 通知主进程有新请求：只传纯字段，entry 里的 response（HTTP ServerResponse）
        // 无法被 IPC 结构化克隆，直接发送会导致通知失败
        if (globalThis.__approvalNewRequest) {
          globalThis.__approvalNewRequest({
            requestId: pendingEntry.requestId,
            fileName: pendingEntry.fileName,
            operator: pendingEntry.operator,
            createdAt: pendingEntry.createdAt,
            fileHash: pendingEntry.fileHash,
          });
        }
        return jsonResponse(res, 200, { ok: true, requestId });
      })
      .catch((err) => jsonResponse(res, err && err.code === 'BODY_TOO_LARGE' ? 413 : 500, { ok: false, message: String(err?.message || err) }));
  }

  // 令牌一次性使用：导出方解密前调用此接口作废令牌，重复使用返回 409
  if (req.method === 'POST' && url.pathname === '/consume-token') {
    return readBody(req)
      .then((body) => {
        let token = '';
        try { token = String(JSON.parse(body || '{}').token || ''); } catch { /* 按无效令牌处理 */ }
        const payload = token ? verifyToken(token) : null;
        if (!payload) return jsonResponse(res, 400, { ok: false, message: '令牌无效或已过期' });
        if (usedTokens.has(token)) return jsonResponse(res, 409, { ok: false, message: '令牌已使用' });
        usedTokens.add(token);
        issuedTokens.delete(token);
        setTimeout(() => usedTokens.delete(token), TOKEN_TTL_MS + 60 * 1000);
        return jsonResponse(res, 200, { ok: true, requestId: payload.requestId });
      })
      .catch((err) => jsonResponse(res, err && err.code === 'BODY_TOO_LARGE' ? 413 : 500, { ok: false, message: String(err?.message || err) }));
  }

  if (req.method === 'GET' && url.pathname.startsWith('/poll/')) {
    const requestId = url.pathname.slice('/poll/'.length);
    const entry = pending.get(requestId);
    if (!entry) {
      return jsonResponse(res, 200, { ok: true, status: 'expired', serverSecret });
    }
    if (entry.status === 'pending') {
      return jsonResponse(res, 200, { ok: true, status: 'pending' });
    }
    if (entry.status === 'approved') {
      return jsonResponse(res, 200, {
        ok: true,
        status: 'approved',
        token: entry.token,
        serverSecret,
        expiresAt: entry.expiresAt,
      });
    }
    if (entry.status === 'rejected') {
      return jsonResponse(res, 200, { ok: true, status: 'rejected', serverSecret });
    }
  }

  return jsonResponse(res, 404, { ok: false, message: 'Not Found' });
}

function start(port) {
  // 幂等：已运行时直接返回当前状态，避免重复点击/重复自动启动报错
  if (server) {
    return Promise.resolve({
      ok: true,
      alreadyRunning: true,
      port: currentPort,
      ips: getLocalIPs(),
      serverSecret,
    });
  }
  serverSecret = crypto.randomBytes(32).toString('hex');
  server = http.createServer((req, res) => handleRequest(req, res));
  return new Promise((resolve) => {
    server.on('error', (err) => {
      server = null;
      currentPort = 0;
      resolve({ ok: false, message: `端口 ${port} 启动失败：${err.message}` });
    });
    server.listen(port, '0.0.0.0', () => {
      currentPort = Number(port);
      resolve({ ok: true, port: currentPort, ips: getLocalIPs(), serverSecret });
    });
  });
}

function stop() {
  if (!server) return Promise.resolve({ ok: false, message: '审批服务未运行' });
  return new Promise((resolve) => {
    server.close(() => {
      server = null;
      currentPort = 0;
      pending.clear();
      issuedTokens.clear();
      usedTokens.clear();
      rateMap.clear();
      failMap.clear();
      serverSecret = '';
      resolve({ ok: true });
    });
  });
}

function resolveRequest(requestId, action) {
  const entry = pending.get(requestId);
  if (!entry) return { ok: false, message: '请求不存在或已过期' };
  if (entry.status !== 'pending') return { ok: false, message: '该请求已处理' };
  const now = Date.now();
  if (action === 'approve') {
    const tokenPayload = {
      requestId,
      account: '李华东',
      issueAt: now,
      expiresAt: now + TOKEN_TTL_MS,
      fileHash: entry.fileHash,
    };
    entry.token = signToken(tokenPayload);
    entry.expiresAt = tokenPayload.expiresAt;
    entry.status = 'approved';
    issuedTokens.set(entry.token, { requestId, fileHash: entry.fileHash, expiresAt: tokenPayload.expiresAt });
    setTimeout(() => issuedTokens.delete(entry.token), TOKEN_TTL_MS + 30 * 1000);
  } else {
    entry.status = 'rejected';
  }
  // 不立即删除 pending entry，保留 2 分钟让导出方后续 poll 能查到最终状态
  // 之前立即删除会导致客户端 poll 时返回 expired，即使审批已通过
  setTimeout(() => pending.delete(requestId), 2 * 60 * 1000);
  return { ok: true, status: entry.status };
}

function listPending() {
  // 只返回仍待处理的请求；已批准/拒绝的条目保留在表中供客户端 poll 查询结果，但不再出现在待办列表
  return Array.from(pending.values())
    .filter((e) => e.status === 'pending')
    .map((e) => ({
      requestId: e.requestId,
      fileName: e.fileName,
      operator: e.operator,
      createdAt: e.createdAt,
      fileHash: e.fileHash,
    }));
}

function verifyTokenWithKey(tokenBase64, key) {
  try {
    const raw = Buffer.from(tokenBase64, 'base64').toString('utf8');
    const idx = raw.lastIndexOf('.');
    if (idx < 0) return null;
    const json = raw.slice(0, idx);
    const sig = raw.slice(idx + 1);
    const expected = crypto.createHmac('sha256', key, 'utf8').update(json).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(json);
    if (payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 运行时更新允许网段（设置页保存后立即生效，无需重启服务） */
function setAllowedCidrs(list) {
  const valid = (Array.isArray(list) ? list : [])
    .map((s) => String(s || '').trim())
    .filter((s) => /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(s))
    .map((s) => (s.includes('/') ? s : `${s}/32`));
  if (!valid.length) return { ok: false, message: '至少保留一个有效网段' };
  // 本机回环始终保留，避免保存白名单后本机自检（测试连接）也被拒绝
  allowedCidrs = valid.includes('127.0.0.1/32') ? valid : ['127.0.0.1/32', ...valid];
  return { ok: true, cidrs: allowedCidrs.slice() };
}

/** 当前生效的允许网段 */
function getAllowedCidrs() {
  return allowedCidrs.slice();
}

module.exports = {
  DEFAULT_PORT,
  TOKEN_TTL_MS,
  start,
  stop,
  isRunning,
  getPort,
  isIpAllowed, // 供自检/诊断使用
  setAllowedCidrs,
  getAllowedCidrs,
  resolveRequest,
  listPending,
  verifyToken,       // 服务端内部（用全局 secret）
  verifyTokenWithKey, // 客户端用（传入密钥）
};
