/**
 * 桌面端拖入文档：Tauri 原生拖放（dragDropEnabled 默认开启时，WebView 不产生 HTML5 drop 事件，
 * 由 Tauri 提供带绝对路径的文件列表，因此可以写回原文件）。
 */
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { readFile } from '@tauri-apps/plugin-fs';
import { decodeBytes } from '@md-studio/core';
import type { FileDropSource, OpenedFile } from '@md-studio/web';

const MARKDOWN = /\.(md|markdown|mdx)$/i;
const MAX_FILES = 20;
const MAX_BYTES = 20 * 1024 * 1024;

export const tauriFileDrop: FileDropSource = {
  subscribe(onEvent) {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const p = event.payload;
        if (p.type === 'enter' || p.type === 'over') {
          onEvent({ type: 'enter' });
          return;
        }
        if (p.type === 'leave') {
          onEvent({ type: 'leave' });
          return;
        }
        onEvent({ type: 'leave' });

        const paths = (Array.isArray(p.paths) ? p.paths : [])
          .filter((x) => MARKDOWN.test(x))
          .slice(0, MAX_FILES);
        const files: OpenedFile[] = [];
        for (const path of paths) {
          try {
            const bytes = await readFile(path);
            if (bytes.byteLength > MAX_BYTES) continue;
            const detected = decodeBytes(bytes);
            files.push({
              id: `file-${path}`,
              name: path.split(/[\\/]/).pop() ?? path,
              path,
              content: detected.text,
              encoding: detected.encoding,
            });
          } catch {
            /* 单个文件不可读（权限/占用）时跳过，不影响其余文件 */
          }
        }
        if (files.length > 0) onEvent({ type: 'drop', files });
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  },
};
