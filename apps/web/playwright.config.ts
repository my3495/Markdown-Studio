import { defineConfig, devices } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
    channel: undefined as unknown as undefined,
    launchOptions: {
      // 不写死本机路径：未设置 CHROMIUM_PATH 时交给 Playwright 用自带浏览器，
      // 否则在别的机器 / CI 上会因找不到可执行文件而失败。
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    cwd: resolve(__dirname, '..'),
  },
});
