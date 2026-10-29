/** 构建配置：打包 Windows 安装包（NSIS），完全离线安装 */
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
     * 关闭“签名并改写 exe 资源”步骤。
     *
     * 原因：该步骤会触发下载 electron-builder 的 winCodeSign 工具包，而其压缩包内含
     * macOS 符号链接，在无管理员权限 / 未开启 Windows“开发人员模式”的电脑上解压会失败，
     * 导致打包中断。关闭后安装包与快捷方式图标仍使用上面的 icon 配置。
     *
     * 若已具备代码签名证书（或已开启开发人员模式），可改为 true 以写入公司版权信息、
     * 产品版本号到 exe 资源，并按 signtoolOptions 配置进行签名。
     */
    signAndEditExecutable: false,
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
