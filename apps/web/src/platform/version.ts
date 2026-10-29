/**
 * 应用版本号。
 *
 * 值来自 `version.generated.ts`（由 `scripts/sync-version.mjs` 从
 * `apps/desktop/src-tauri/tauri.conf.json` 生成，发版只改那一处），
 * `predev` / `prebuild` / `pretest` 会自动同步。
 *
 * 背景：Web 端「关于与更新」此前把版本硬编码成 '0.0.0'，网页端永远显示 0.0.0；
 * 桌面端走 tauri `getVersion()` 是对的，两个环境对不上。
 */
export { APP_VERSION } from './version.generated';
