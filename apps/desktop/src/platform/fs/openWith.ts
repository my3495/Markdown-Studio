/**
 * 「文件关联」入口：把 md/markdown 文件与本工具关联后，双击文件就能直接用本工具打开。
 *
 * 两条路径都要覆盖：
 * 1. 冷启动：Windows 把文件路径放进命令行参数，Rust 侧暂存，前端就绪后用
 *    `take_startup_path` 取走（取走即清空，避免刷新页面重复打开）；
 * 2. 热启动：应用已在运行，再双击一个文件时由 single-instance 插件把参数转发给
 *    现有实例，Rust 侧发 `mdstudio://open-path` 事件，前端监听后打开。
 * macOS / Linux 走 `RunEvent::Opened`，同样是这个事件。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getFsBackend, useDocuments } from '@md-studio/web';

const OPEN_PATH_EVENT = 'mdstudio://open-path';

async function openByPath(path: string): Promise<void> {
  const fs = getFsBackend();
  if (!fs.openPath) return;
  const f = await fs.openPath(path);
  if (!f) return;
  useDocuments.getState().openDoc({
    id: f.id,
    name: f.name,
    path: f.path,
    content: f.content,
  });
}

export async function initOpenWith(): Promise<void> {
  try {
    const startup = await invoke<string | null>('take_startup_path');
    if (startup) await openByPath(startup);
  } catch {
    /* 命令不可用（旧版本壳）时忽略，不影响主流程 */
  }

  try {
    await listen<string>(OPEN_PATH_EVENT, (e) => {
      if (e.payload) void openByPath(e.payload);
    });
  } catch {
    /* 监听失败忽略 */
  }
}
