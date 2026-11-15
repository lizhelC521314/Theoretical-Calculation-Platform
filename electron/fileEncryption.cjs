/**
 * AES-256-GCM 加密容器。
 *
 * - 密钥输入：临时解密令牌（从审批服务签发）
 * - 密钥派生：key = HMAC-SHA256(token, "CTR-APPROVAL-KEY")
 * - 容器格式：[magic][headerLen:4B][JSON header][salt][nonce][authTag][ciphertext]
 * - 令牌本身自包含 expiresAt，GCM AuthTag 校验密钥正确性 + 完整性
 */
const crypto = require('node:crypto');
const path = require('node:path');

const MAGIC = Buffer.from('CTRAPV1', 'utf8');
const KEY_INFO = 'CTR-APPROVAL-KEY';
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_HEADER_BYTES = 64 * 1024;
const ENCRYPTED_EXTENSION = '.ctre';

function deriveKey(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('解密令牌无效或已过期');
  }
  return crypto.createHmac('sha256', KEY_INFO).update(token).digest();
}

function encryptBuffer(plain, originalName, token) {
  const data = Buffer.isBuffer(plain) ? plain : Buffer.from(plain);
  const salt = crypto.randomBytes(SALT_BYTES);
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const key = deriveKey(token);
  const header = Buffer.from(JSON.stringify({
    version: 1,
    notice: '本文件已加密，需经李华东审批后解密。解密令牌 5 分钟内有效。',
    originalName: path.win32.basename(String(originalName || '导出文件.bin')),
    algorithm: 'AES-256-GCM',
    kdf: 'HMAC-SHA256(token, CTR-APPROVAL-KEY)',
  }), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, length, header, salt, nonce, tag, ciphertext]);
}

function safeOriginalName(value) {
  const name = path.win32.basename(String(value || ''))
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim();
  return name || '解密文件.bin';
}

function decryptBuffer(container, token) {
  const minimum = MAGIC.length + 4 + SALT_BYTES + NONCE_BYTES + TAG_BYTES;
  if (!Buffer.isBuffer(container) || container.length < minimum || !container.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('不是有效的 CTR 加密文件（CTRAPV1）');
  }
  const headerLength = container.readUInt32BE(MAGIC.length);
  const headerStart = MAGIC.length + 4;
  const headerEnd = headerStart + headerLength;
  if (headerLength === 0 || headerLength > MAX_HEADER_BYTES || headerEnd + SALT_BYTES + NONCE_BYTES + TAG_BYTES > container.length) {
    throw new Error('加密文件头无效或文件已损坏');
  }

  let header;
  const headerBytes = container.subarray(headerStart, headerEnd);
  try {
    header = JSON.parse(headerBytes.toString('utf8'));
  } catch {
    throw new Error('加密文件头无效或文件已损坏');
  }
  if (header.version !== 1 || header.algorithm !== 'AES-256-GCM') {
    throw new Error('不支持的加密文件格式');
  }

  const saltStart = headerEnd;
  const nonceStart = saltStart + SALT_BYTES;
  const tagStart = nonceStart + NONCE_BYTES;
  const dataStart = tagStart + TAG_BYTES;
  const nonce = container.subarray(nonceStart, tagStart);
  const tag = container.subarray(tagStart, dataStart);
  const ciphertext = container.subarray(dataStart);
  const key = deriveKey(token);

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(tag);
    return {
      data: Buffer.concat([decipher.update(ciphertext), decipher.final()]),
      originalName: safeOriginalName(header.originalName),
    };
  } catch {
    throw new Error('解密令牌无效或已过期，或文件已损坏');
  }
}

function encryptedFileName(filePath) {
  const value = String(filePath);
  return value.toLowerCase().endsWith(ENCRYPTED_EXTENSION) ? value : `${value}${ENCRYPTED_EXTENSION}`;
}

module.exports = {
  MAGIC,
  ENCRYPTED_EXTENSION,
  KEY_INFO,
  encryptBuffer,
  decryptBuffer,
  deriveKey,
  encryptedFileName,
};
