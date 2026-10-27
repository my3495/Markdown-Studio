/**
 * 应用更新：平台无关抽象层。
 *
 * 桌面端注入基于 tauri-plugin-updater 的实现（真实检查 + 下载 + 安装）；
 * Web 端未注入时 `getUpdateBackend()` 返回不可用实现，UI 隐藏更新入口。
 *
 * 与 platform/fs/registry、platform/vault/registry 同构：
 * 同一套 UI（设置面板「关于与更新」分区）复用于 Web 与桌面。
 */

/** 更新包元信息（对齐 tauri-plugin-updater 的 Update 字段） */
export interface UpdateInfo {
  /** 目标版本号，如 "1.1.0" */
  version: string;
  /** 更新说明（Markdown） */
  body?: string;
  /** 发布日期 ISO 字符串 */
  date?: string;
}

export interface UpdateBackend {
  /** 后端是否可用（桌面端 true，Web 端 false） */
  available(): boolean;
  /** 当前运行版本 */
  currentVersion(): Promise<string>;
  /** 检查是否有新版本；返回 null 表示已是最新 */
  check(): Promise<UpdateInfo | null>;
  /**
   * 下载并安装更新。
   * @param onProgress 下载进度回调（0..100）
   */
  downloadAndInstall(onProgress: (percent: number) => void): Promise<void>;
}

/** 默认（Web）后端：不可用 */
const unavailableBackend: UpdateBackend = {
  available: () => false,
  currentVersion: async () => '0.0.0',
  check: async () => null,
  downloadAndInstall: async () => {
    throw new Error('当前环境不支持自动更新');
  },
};

let backend: UpdateBackend | null = null;

/** 桌面端注入 Tauri 实现 */
export function setUpdateBackend(b: UpdateBackend): void {
  backend = b;
}

export function getUpdateBackend(): UpdateBackend {
  return backend ?? unavailableBackend;
}
