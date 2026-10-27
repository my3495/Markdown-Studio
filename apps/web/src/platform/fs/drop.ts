import type { OpenedFile } from './web';

/**
 * 拖入文档的事件类型：
 * - enter / leave 用于驱动拖入遮罩
 * - drop 携带已解码的文档（桌面端由 Tauri 原生拖放提供绝对路径）
 */
export type DropEvent =
  | { type: 'enter' }
  | { type: 'leave' }
  | { type: 'drop'; files: OpenedFile[] };

export interface FileDropSource {
  /** 订阅拖放事件；返回取消订阅函数 */
  subscribe(onEvent: (e: DropEvent) => void): () => void;
}

let source: FileDropSource | null = null;

/** 桌面端注入 Tauri 原生拖放源；未注入时 App 回退到 HTML5 拖放 */
export function setFileDropSource(s: FileDropSource): void {
  source = s;
}

export function getFileDropSource(): FileDropSource | null {
  return source;
}
