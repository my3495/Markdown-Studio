import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Tauri 期望固定的端口与相对资源路径
export default defineConfig({
  plugins: [react()],
  // @ts-ignore - Tauri 注入的环境变量
  clearScreen: false,
  resolve: {
    alias: {
      '@md-studio/web': path.resolve(__dirname, '../web/src'),
    },
  },
  // 共享 web 的静态资产（tldraw-assets 本地化字体/图标/翻译），
  // 否则桌面产物缺该目录 → tldraw 报 "Could not load assets" 白板无法挂载
  publicDir: path.resolve(__dirname, '../web/public'),
  server: { port: 1420, strictPort: true, host: false },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
