/**
 * 桌面端文件系统适配（Tauri 2.0 plugin-fs）。
 * 与 Web 端 webFs 实现同一 FsBackend 接口：打开走原生对话框，保存写回原路径。
 * 注意：此文件仅在 Tauri 构建/类型检查时解析 @tauri-apps/api。
 */
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { decodeBytes } from '@md-studio/core';
import type { FsBackend, OpenedFile } from '@md-studio/web';

const OPEN_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }];
const SAVE_FILTERS = [{ name: 'Markdown', extensions: ['md'] }];

export const tauriFs: FsBackend = {
  async openFile(): Promise<OpenedFile | null> {
    const selected = await open({ multiple: false, filters: OPEN_FILTERS });
    if (typeof selected !== 'string' || !selected) return null;
    // 读取字节后做 CJK 编码自动检测（与 Web 端行为一致）
    const detected = decodeBytes(await readFile(selected));
    return {
      id: `file-${selected}-${Date.now()}`,
      name: selected.split(/[\\/]/).pop() ?? selected,
      path: selected,
      content: detected.text,
      encoding: detected.encoding,
    };
  },

  async saveFile(path: string | null, name: string, content: string): Promise<string> {
    if (path) {
      try {
        await writeTextFile(path, content);
        return path;
      } catch {
        /* 原路径不可写（被占用等）→ 回退另存为 */
      }
    }
    const target = await save({ defaultPath: name, filters: SAVE_FILTERS });
    if (!target) return name;
    await writeTextFile(target, content);
    return target;
  },
};
