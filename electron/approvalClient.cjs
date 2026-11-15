/** 审批客户端：标准版导出方向李华东的审批服务发送请求并轮询结果 */
const crypto = require('node:crypto');
const http = require('node:http');

const POLL_INTERVAL_MS = 3000;
const REQUEST_TIMEOUT_MS = 60 * 1000;

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function formatNetworkError(err, hostname, port) {
  if (!err) return '未知网络错误';
  const msg = String(err.message || err);
  if (err.code === 'ECONNREFUSED') {
    return `${hostname}:${port} 拒绝连接——该地址没有审批服务在运行。请确认：①李华东电脑已用「李华东」账号登录并启动审批服务；②填写的 IP 是否正确`;
  }
  if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
    return `审批服务 ${hostname}:${port} 连接已断开`;
  }
  if (err.code === 'ETIMEDOUT' || err.code === 'EAI_AGAIN') {
    return `${hostname}:${port} 连接超时——请检查 IP 是否正确、两台电脑是否在同一局域网、防火墙是否放行 TCP ${port}`;
  }
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_NONAME') {
    return `无法解析审批服务地址 ${hostname}，请填写 IP 地址而非计算机名`;
  }
  if (err.code === 'EADDRNOTAVAIL') {
    return `审批服务地址 ${hostname}:${port} 不可达`;
  }
  return `审批服务 ${hostname}:${port} 通信错误：${msg}`;
}

function jsonRequest({ method, hostname, port, pathname, body, timeout }) {
  return new Promise((resolve, reject) => {
    const url = new URL(`http://${hostname}:${port}${pathname}`);
    const payload = body != null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload ? Buffer.byteLength(payload) : 0,
          'X-Client-Key': '',
        },
        timeout: timeout || REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8') || '{}';
            let parsed;
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = { _raw: text };
            }
            resolve({ status: res.statusCode, body: parsed });
          } catch (err) {
            reject(new Error(`HTTP ${res.statusCode}: ${err.message}`));
          }
        });
      },
    );
    req.on('timeout', () => {
      const err = new Error('连接超时');
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    });
    req.on('error', (err) => {
      req.destroy();
      reject(new Error(formatNetworkError(err, hostname, port)));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** 发起审批请求并等待结果（轮询直到 approved/rejected/超时） */
function requestApproval({ hostname, port, fileName, operator, fileHash }) {
  const startAt = Date.now();
  let serverSecret = '';

  return (async () => {
    // 参数校验（兼容误填 http:// 前缀的情况）
    hostname = String(hostname || '').trim().replace(/^https?:\/\//i, '');
    if (!hostname) {
      throw new Error('审批服务地址未配置');
    }
    if (!port || !Number.isFinite(Number(port)) || port < 1 || port > 65535) {
      throw new Error('审批服务端口无效');
    }

    // 1. 发送审批请求（外层 try-catch 包装网络错误）
    let pendingRes;
    try {
      pendingRes = await jsonRequest({
        method: 'POST',
        hostname,
        port: Number(port),
        pathname: '/pending',
        body: { requestId: crypto.randomUUID(), fileName, operator, fileHash },
      });
    } catch (err) {
      throw new Error(formatNetworkError(err?.code ? err : { message: err.message }, hostname, port));
    }

    if (!pendingRes.body?.ok) {
      throw new Error(pendingRes.body?.message || '审批请求发送失败');
    }
    const requestId = pendingRes.body.requestId;

    // 2. 轮询等待
    while (Date.now() - startAt < REQUEST_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      let pollRes;
      try {
        pollRes = await jsonRequest({
          method: 'GET',
          hostname,
          port: Number(port),
          pathname: `/poll/${requestId}`,
        });
      } catch {
        continue; // 网络抖动，继续轮询
      }
      const body = pollRes.body || {};
      if (body.serverSecret) serverSecret = body.serverSecret;
      if (body.status === 'approved') {
        return {
          status: 'approved',
          token: body.token,
          serverSecret,
          expiresAt: body.expiresAt,
        };
      }
      if (body.status === 'rejected') {
        const err = new Error('审批请求被拒绝');
        err.__approvalRejected = true;
        throw err;
      }
      if (body.status === 'expired') {
        throw new Error('审批请求已失效（服务端未收到或已过期）');
      }
      // 其他状态（pending 等）继续轮询
    }
    const err = new Error('审批等待超时');
    err.__approvalTimeout = true;
    throw err;
  })();
}

/** 探测审批服务是否可达（GET /health），用于设置页「测试连接」 */
function probe({ hostname, port }) {
  const host = String(hostname || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const p = Number(port);
  return new Promise((resolve) => {
    if (!host) return resolve({ ok: false, message: '请先填写李华东电脑的 IP 地址' });
    if (!p || p < 1 || p > 65535) return resolve({ ok: false, message: '端口无效（应为 1~65535）' });
    const req = http.request(
      { method: 'GET', hostname: host, port: p, path: '/health', timeout: 4000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let body = {};
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          } catch {
            body = {};
          }
          if (body && body.service === 'ctr-approval') {
            resolve({
              ok: true,
              message: `连接成功：${host}:${p} 审批服务运行中，当前待审批 ${body.pending ?? 0} 条`,
            });
          } else {
            resolve({ ok: false, message: `${host}:${p} 有响应，但不是 CTR 审批服务（端口被其他程序占用？）` });
          }
        });
      },
    );
    req.on('timeout', () => {
      const err = new Error('连接超时');
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    });
    req.on('error', (err) => resolve({ ok: false, message: formatNetworkError(err, host, p) }));
    req.end();
  });
}

module.exports = {
  POLL_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  hashBuffer,
  requestApproval,
  probe,
};
