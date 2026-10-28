import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Web 应用测试配置：jsdom + React 插件。
 * 只覆盖 src/tests 下的用例；core 包测试由 packages/core 自己运行。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/__tests__/**/*.test.{ts,tsx}'],
    /**
     * 把 `react` 精确地重定向到单实例 shim（不影响 `react-dom`、`react/jsx-runtime`）。
     *
     * 背景：pnpm 下 `apps/web/node_modules/react` 是指向仓库根 `.pnpm/` 的 junction，
     * 真实路径在 Vite root 之外，Vite 会把它当 linked 源码内联求值；而 react-dom 是 CJS、
     * 由 Node require。两条加载路径各执行一遍 react.development.js，得到两份
     * ReactSharedInternals：react-dom 把 dispatcher 写在自己那份，组件的 useState 来自
     * Vite 那份 → "Invalid hook call / Cannot read properties of null (reading 'useState')"。
     * 试过 resolve.dedupe / deps.external / deps.optimizer 均无效（它们不改变双 loader 的事实）。
     */
    alias: [
      {
        find: /^react$/,
        replacement: resolve(__dirname, 'tests/react-single-instance.ts'),
      },
    ],
  },
});
