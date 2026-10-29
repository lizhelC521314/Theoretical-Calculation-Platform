const crypto = require('node:crypto');
const os = require('node:os');

// 离线授权：机器码由主机指纹生成，授权码为机器码的 HMAC 摘要，可在无网络环境下校验
const SECRET = 'CTR-THEORY-CALC-2026-OFFLINE-LICENSE';

function normalize(code) {
  return String(code || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function primaryMac() {
  const nets = os.networkInterfaces();
  for (const key of Object.keys(nets)) {
    for (const item of nets[key] || []) {
      if (!item.internal && item.mac && item.mac !== '00:00:00:00:00:00') return item.mac;
    }
  }
  return '00:00:00:00:00:00';
}

function machineCode() {
  const raw = [
    os.hostname(),
    process.platform,
    process.arch,
    (os.cpus()[0] && os.cpus()[0].model) || '',
    primaryMac(),
  ].join('|');
  const hash = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
  return hash.slice(0, 20).replace(/(.{5})(?=.)/g, '$1-');
}

function expectedCode(mc) {
  const h = crypto.createHmac('sha256', SECRET).update(mc).digest('hex').toUpperCase();
  return h.slice(0, 20).replace(/(.{5})(?=.)/g, '$1-');
}

function verify(input) {
  const mc = machineCode();
  return normalize(input) === normalize(expectedCode(mc));
}

module.exports = { machineCode, expectedCode, verify };
