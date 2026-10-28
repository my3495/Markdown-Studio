import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  resolve: {
    // Worker 里没有 document。部分依赖按 `browser` 条件解析到直接操作 DOM 的实现，
    // 典型如 decode-named-character-reference：browser 入口在模块顶层执行
    // `document.createElement('i')`，Worker 加载时立即抛 ReferenceError，
    // 于是渲染 Worker 静默回退主线程（表现为「优化上线了但没变快」）。
    // 该包在 exports 中把 `worker` 条件写在 `browser` 之前，加入候选即可命中文档无关实现。
    // 注：Vite 没有 per-worker 的 resolve 配置，只能全局生效；主线程用非 DOM 实现仅是
    // 解码器性能略低，结果完全一致。
    conditions: ['worker', 'module', 'browser', 'development|production'],
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
