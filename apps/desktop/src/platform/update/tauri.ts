/**
 * 桌面端更新后端：基于 tauri-plugin-updater。
 *
 * 与 Web 端共享 platform/update/registry 的抽象，
 * 由 apps/desktop/src/main.tsx 注入。
 */
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import type { UpdateBackend, UpdateInfo } from '@md-studio/web/platform/update/registry';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function toInfo(u: Update): UpdateInfo {
  return {
    version: u.version,
    body: u.body,
    date: u.date,
  };
}

export const tauriUpdateBackend: UpdateBackend = {
  available: () => isTauri(),

  currentVersion: async () => {
    if (!isTauri()) return '0.0.0';
    return getVersion();
  },

  check: async () => {
    if (!isTauri()) return null;
    const update = await check();
    return update ? toInfo(update) : null;
  },

  downloadAndInstall: async (onProgress) => {
    if (!isTauri()) throw new Error('当前环境不支持自动更新');
    const update = await check();
    if (!update) throw new Error('没有可安装的新版本');
    let downloaded = 0;
    let total = 0;
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? 0;
          onProgress(0);
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          if (total > 0) onProgress(Math.min(99, Math.round((downloaded / total) * 100)));
          break;
        case 'Finished':
          onProgress(100);
          break;
      }
    });
    // 安装后重启应用使新版本生效
    await relaunch();
  },
};
