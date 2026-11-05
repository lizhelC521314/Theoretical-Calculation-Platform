import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 构建时间戳：用于核对安装包是否为最新构建（侧栏版本号旁显示）
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // Electron 打包后以 file:// 协议加载，必须使用相对路径
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
