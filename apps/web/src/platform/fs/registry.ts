import { webFs, type OpenedFile } from './web';

/**
 * 文件系统后端：Web（file input + Blob 下载）与桌面（Tauri 原生对话框 + 写回原路径）可注入替换。
 * 与 platform/vault/registry 同构，供同一套 UI 复用。
 */
export interface FsBackend {
  openFile(): Promise<OpenedFile | null>;
  /** path 非空且实现支持时写回原路径，否则另存（Web 端为下载） */
  saveFile(path: string | null, name: string, content: string): Promise<string>;
}

export type { OpenedFile };

let backend: FsBackend | null = null;

/** 桌面端注入 Tauri 实现；未注入时回退 Web 实现 */
export function setFsBackend(b: FsBackend): void {
  backend = b;
}

export function getFsBackend(): FsBackend {
  return backend ?? webFs;
}
