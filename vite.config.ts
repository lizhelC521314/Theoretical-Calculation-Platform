import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 生产构建注入 CSP：只允许同源脚本与样式，禁止远程加载与内嵌页面。
// 不在开发模式注入——Vite HMR 需要内联脚本与 ws 连接。
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // KaTeX 与 React 内联 style 属性需要 unsafe-inline
  "style-src 'self' 'unsafe-inline'",
  // 预览图与公式渲染图片：本地资源 + data/blob + PDF 临时文件的 file 协议
  "img-src 'self' data: blob: file:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-csp',
      apply: 'build',
      transformIndexHtml(html) {
        return html.replace(
          '</head>',
          `  <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n  </head>`
        );
      },
    },
  ],
  // 构建时间戳：用于核对安装包是否为最新构建（侧栏版本号旁显示）
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // Electron 打包后以 file:// 协议加载，必须使用相对路径
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Electron 32 内置 Chromium 120，无需为老浏览器降级语法
    target: 'chrome120',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 把变更频率低、体积大的第三方库拆成独立 vendor chunk：
        // 页面 chunk 更新时这些 vendor 文件可继续命中缓存，也避免首屏解析整包
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (/node_modules[\\/](echarts|zrender)[\\/]/.test(id)) return 'vendor-echarts';
          if (/node_modules[\\/](docx|exceljs|xlsx|pptxgenjs|mammoth|jszip)[\\/]/.test(id)) return 'vendor-office';
          // 注意：katex 不单独分包——main.tsx 只引入了它的 CSS，
          // 单独分包会让入口被迫预加载整个 KaTeX JS（约 258KB），反而拖慢首屏
          if (/node_modules[\\/]pdfjs-dist[\\/]/.test(id)) return 'vendor-pdf';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
