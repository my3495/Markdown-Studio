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
    /** 使用系统已装的 chromium-1243（避免重复下载） */
    channel: undefined as unknown as undefined,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ??
        'C:\\Users\\gaoqi\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
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
