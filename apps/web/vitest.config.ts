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
  },
});
