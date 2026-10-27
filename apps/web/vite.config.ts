import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  server: {
    port: 1420,
    strictPort: true,
    // 代理配置：解决浏览器 CORS 限制
    // 注意：仅开发环境使用，生产环境需要后端代理
    proxy: {
      '/api/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/deepseek/, '/v1'),
      },
      '/api/qwen': {
        target: 'https://dashscope.aliyuncs.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/qwen/, ''),
      },
      '/api/kimi': {
        target: 'https://api.moonshot.cn',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/kimi/, ''),
      },
      '/api/glm': {
        target: 'https://open.bigmodel.cn',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/glm/, ''),
      },
    },
  },
  build: {
    target: 'es2022',
  },
});
