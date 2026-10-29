/**
 * 版本号单一来源：构建期注入值必须等于发布配置 tauri.conf.json 的 version。
 *
 * 回归的是「网页端关于页永远显示 0.0.0」：当时 Web 更新后端把 currentVersion
 * 写死成 '0.0.0'，桌面端却走 tauri getVersion()，两端版本口径不一致。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_VERSION } from '../version';
import { getUpdateBackend } from '../update/registry';

const tauriConf = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../desktop/src-tauri/tauri.conf.json'), 'utf8')
) as { version: string };

describe('应用版本号', () => {
  it('V-01 注入值与 tauri.conf.json 一致（发版只改一处）', () => {
    expect(APP_VERSION).toBe(tauriConf.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('V-02 Web 更新后端报告真实版本，而不是 0.0.0', async () => {
    const backend = getUpdateBackend();
    // 浏览器里不能替换安装包 → 仍标记不可用，但版本号必须真实
    expect(backend.available()).toBe(false);
    expect(await backend.currentVersion()).toBe(APP_VERSION);
    expect(await backend.currentVersion()).not.toBe('0.0.0');
  });
});
