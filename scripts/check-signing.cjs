/**
 * 代码签名环境自检：打包前确认证书环境是否就绪。
 *
 * 用法：npm run sign:check
 * 通过环境变量提供证书（二选一）：
 *   1) OV 证书文件：CSC_LINK=证书.pfx 路径，CSC_KEY_PASSWORD=证书密码
 *   2) 已装入证书存储（EV / UKey）：WIN_CSC_SUBJECT_NAME=证书「颁发给」名称
 */
const fs = require('node:fs');

const certFile = process.env.CSC_LINK || process.env.WIN_CSC_LINK || '';
const certSubject = process.env.WIN_CSC_SUBJECT_NAME || '';
const certPassword = process.env.CSC_KEY_PASSWORD || process.env.WIN_CSC_KEY_PASSWORD || '';
const timestamp = process.env.CSC_TIMESTAMP_SERVER || 'http://timestamp.digicert.com';

const lines = [];
let ok = true;

if (!certFile && !certSubject) {
  ok = false;
  lines.push('未检测到签名证书，打包产物将不带数字签名（SmartScreen 会提示「未知发布者」）。');
  lines.push('');
  lines.push('配置方式一（.pfx 证书文件）：');
  lines.push('  $env:CSC_LINK = "D:\\certs\\code-signing.pfx"');
  lines.push('  $env:CSC_KEY_PASSWORD = "证书密码"');
  lines.push('');
  lines.push('配置方式二（证书已装入本机证书存储，EV / UKey 常用）：');
  lines.push('  $env:WIN_CSC_SUBJECT_NAME = "证书上的「颁发给」名称"');
} else {
  if (certFile) {
    if (!fs.existsSync(certFile)) {
      ok = false;
      lines.push(`证书文件不存在：${certFile}`);
    } else {
      lines.push(`证书文件：${certFile}（${(fs.statSync(certFile).size / 1024).toFixed(1)} KB）`);
    }
    lines.push(certPassword ? '证书密码：已设置' : '证书密码：未设置（若证书无密码可忽略）');
  }
  if (certSubject) lines.push(`证书存储中的颁发给：${certSubject}`);
  lines.push(`时间戳服务器：${timestamp}`);
  lines.push('注意：内网/离线环境无法访问默认时间戳服务器时，请用 CSC_TIMESTAMP_SERVER 指向内网时间戳服务。');
  lines.push('注意：首次签名会下载 winCodeSign 工具包，需管理员权限或开启 Windows「开发人员模式」。');
}

console.log(lines.join('\n'));
if (!ok) {
  console.log('\n自检结果：未就绪（不影响普通打包，仅缺少数字签名）');
  process.exitCode = 0;
} else {
  console.log('\n自检结果：签名环境已就绪，直接运行 npm run build / npm run build:standard 即可自动签名');
}
