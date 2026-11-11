/**
 * 标准版（普通操作版）打包配置。
 *
 * 与科研版（electron-builder.config.cjs）共用同一份构建产物 dist/，
 * 区别仅在于：Vite 以 `--mode standard` 构建，渲染层据此裁剪菜单与公式说明；
 * 此处再用独立的 appId / 应用名 / 输出目录，保证两个版本可同时安装。
 */
const base = require('./electron-builder.config.cjs');

module.exports = {
  ...base,
  appId: 'com.ctr.theory-calc.standard',
  productName: '汽车零部件数字设计平台（标准版）',
  artifactName: '汽车零部件数字设计平台（标准版） Setup ${version}.${ext}',
  directories: {
    ...base.directories,
    output: 'release-standard',
  },
  nsis: {
    ...base.nsis,
    shortcutName: '汽车零部件数字设计平台（标准版）',
  },
};
