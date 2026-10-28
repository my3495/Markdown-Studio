import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Tauri 期望固定的端口与相对资源路径
export default defineConfig({
  plugins: [react()],
  // 渲染 Worker 用 `type: 'module'` 创建（见 apps/web/src/platform/render-offthread.ts），
  // 产物必须是 ES 格式；默认的 iife 与「Worker 与主包共享 chunk」不兼容，构建会直接失败：
  // "Invalid value "iife" for option "output.format" - IIFE 不支持 code-splitting"。
  worker: { format: 'es' },
  // @ts-ignore - Tauri 注入的环境变量
  clearScreen: false,
  resolve: {
    alias: {
      '@md-studio/web': path.resolve(__dirname, '../web/src'),
    },
    // 与 apps/web/vite.config.ts 保持一致：Worker 里没有 document，需命中文档无关实现，
    // 否则渲染 Worker 加载即崩、静默回退主线程。
    conditions: ['worker', 'module', 'browser', 'development|production'],
  },
  // 共享 web 的静态资产（tldraw-assets 本地化字体/图标/翻译），
  // 否则桌面产物缺该目录 → tldraw 报 "Could not load assets" 白板无法挂载
  publicDir: path.resolve(__dirname, '../web/public'),
  server: { port: 1420, strictPort: true, host: false },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
