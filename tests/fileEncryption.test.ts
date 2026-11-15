import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const encryption = require('../electron/fileEncryption.cjs') as {
  MAGIC: Buffer;
  ENCRYPTED_EXTENSION: string;
  encryptBuffer(plain: Buffer, originalName: string, token: string): Buffer;
  decryptBuffer(container: Buffer, token: string): { data: Buffer; originalName: string };
  deriveKey(token: string): Buffer;
  encryptedFileName(filePath: string): string;
};

const TOKEN = 'test-token-abcdef1234567890';

describe('审批令牌加密容器', () => {
  it('AES-256-GCM 加密后可无损还原二进制内容和原文件名', () => {
    const plain = Buffer.concat([
      Buffer.from([0, 1, 2, 255, 254, 0]),
      Buffer.from('汽车零部件数字设计平台：试验报告正文', 'utf8'),
    ]);
    const encrypted = encryption.encryptBuffer(plain, '试验报告.pdf', TOKEN);

    expect(encrypted.subarray(0, 7).toString('utf8')).toBe('CTRAPV1');
    expect(encrypted.includes(plain)).toBe(false);
    expect(encrypted.toString('utf8')).toContain('AES-256-GCM');

    const decrypted = encryption.decryptBuffer(encrypted, TOKEN);
    expect(decrypted.originalName).toBe('试验报告.pdf');
    expect(decrypted.data.equals(plain)).toBe(true);
  });

  it('同一 token 每次使用随机 salt + nonce，密文容器不同但都能解', () => {
    const plain = Buffer.from('same content for approval test');
    const first = encryption.encryptBuffer(plain, 'a.xlsx', TOKEN);
    const second = encryption.encryptBuffer(plain, 'a.xlsx', TOKEN);
    expect(first.equals(second)).toBe(false);
    expect(encryption.decryptBuffer(first, TOKEN).data.equals(plain)).toBe(true);
    expect(encryption.decryptBuffer(second, TOKEN).data.equals(plain)).toBe(true);
  });

  it('错误 token 和被篡改的密文均无法解密', () => {
    const encrypted = encryption.encryptBuffer(Buffer.from(' confidential '), 'report.docx', TOKEN);
    expect(() => encryption.decryptBuffer(encrypted, 'wrong-token')).toThrow('解密令牌无效或已过期');

    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => encryption.decryptBuffer(tampered, TOKEN)).toThrow('解密令牌无效或已过期');
  });

  it('拒绝非 CTRAPV1 文件，并支持空文件往返', () => {
    expect(() => encryption.decryptBuffer(Buffer.from('plain text'), TOKEN)).toThrow('不是有效的 CTR 加密文件');
    const encrypted = encryption.encryptBuffer(Buffer.alloc(0), '..\\empty.csv', TOKEN);
    const decrypted = encryption.decryptBuffer(encrypted, TOKEN);
    expect(decrypted.originalName).toBe('empty.csv');
    expect(decrypted.data.length).toBe(0);
  });

  it('导出文件名统一追加 .ctre 且不重复追加', () => {
    expect(encryption.encryptedFileName('报告.pdf')).toBe('报告.pdf.ctre');
    expect(encryption.encryptedFileName('报告.pdf.ctre')).toBe('报告.pdf.ctre');
    expect(encryption.encryptedFileName('报告.pdf.CTRE')).toBe('报告.pdf.CTRE');
  });

  it('deriveKey 对空/无效 token 抛出明确错误', () => {
    expect(() => encryption.deriveKey('')).toThrow('解密令牌无效');
    expect(() => encryption.deriveKey(null as unknown as string)).toThrow('解密令牌无效');
    const a = encryption.deriveKey('token-a');
    const b = encryption.deriveKey('token-b');
    expect(a.equals(b)).toBe(false);
    expect(a.length).toBe(32);
  });
});
