import { defineConfig } from 'vitest/config';

/**
 * Desktop 测试配置：jsdom（localStorage / window 探测需要）。
 * 仅覆盖 tests/ 下的冒烟用例；agent 链路本体由 packages/core 测试。
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
