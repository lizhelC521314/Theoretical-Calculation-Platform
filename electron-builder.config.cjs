/** 构建配置：打包 Windows 安装包（NSIS），完全离线安装 */

/**
 * 代码签名（消除 SmartScreen「未知发布者」警告）。
 *
 * 只能使用 CA 签发的代码签名证书，自签名证书无效（仍会提示未知发布者）。
 * 提供以下任一环境变量后自动开启签名，未提供时保持不签名，打包流程与原来一致：
 *   1) 证书文件（OV）：CSC_LINK=证书.pfx 的路径，CSC_KEY_PASSWORD=证书密码
 *   2) 证书已装入 Windows 证书存储（EV / UKey）：WIN_CSC_SUBJECT_NAME=证书「颁发给」名称
 * 注意：开启签名后 electron-builder 会下载并运行 winCodeSign（内含 signtool），
 * 其压缩包含 macOS 符号链接，需以管理员运行或开启 Windows「开发人员模式」才能解压，
 * 否则打包会中断。
 */
const certFile = process.env.CSC_LINK || process.env.WIN_CSC_LINK;
const certSubject = process.env.WIN_CSC_SUBJECT_NAME;
const canSign = Boolean(certFile || certSubject);

/** 证书签名（SHA-256 + RFC3161 时间戳），时间戳保证证书过期后历史安装包签名仍有效 */
const signtoolOptions = canSign
  ? {
      ...(certFile ? { certificateFile: certFile } : {}),
      ...(certSubject ? { certificateSubjectName: certSubject } : {}),
      signingHashAlgorithms: ['sha256'],
      rfc3161TimeStampServer: process.env.CSC_TIMESTAMP_SERVER || 'http://timestamp.digicert.com',
    }
  : undefined;

module.exports = {
  appId: 'com.ctr.theory-calc',
  productName: '汽车零部件理论计算平台',
  copyright: '© 2026 成都万友滤机有限公司',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  /** 安装包文件名（拷贝到其它电脑时按此名识别） */
  artifactName: 'Theoretical Calculation Platform Setup ${version}.${ext}',
  files: ['dist/**/*', 'electron/**/*', 'package.json'],
  // 单机离线使用，安装包内不包含源码与开发依赖
  asar: true,
  /** pdfjs 只有 ESM 构建，需解包到 asar 外才能被主进程动态 import */
  asarUnpack: ['node_modules/pdfjs-dist/**'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    /**
     * 未提供签名证书时关闭“签名并改写 exe 资源”步骤。
     *
     * 原因：该步骤会触发下载 electron-builder 的 winCodeSign 工具包，而其压缩包内含
     * macOS 符号链接，在无管理员权限 / 未开启 Windows“开发人员模式”的电脑上解压会失败，
     * 导致打包中断。关闭后安装包与快捷方式图标仍使用上面的 icon 配置。
     *
     * 配置证书环境变量后自动改为 true，按 signtoolOptions 写入公司版权信息并签名。
     */
    signAndEditExecutable: canSign,
    ...(signtoolOptions ? { signtoolOptions } : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '汽车零部件理论计算平台',
    installerLanguages: ['zh_CN'],
    language: '2052',
  },
  // 关闭自动更新：内网/离线环境由管理员统一下发安装包
  publish: null,
};
