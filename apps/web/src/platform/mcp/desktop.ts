/**
 * 桌面端 MCP HTTP 启停（通过 Tauri invoke）。
 * 非 Tauri 环境返回不可用，避免给 Web 包增加 @tauri-apps 依赖。
 */

export interface McpServerInfo {
  port: number;
  token: string;
  workspace: string;
  url: string;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const g = window as any;
  const inv =
    g.__TAURI_INTERNALS__?.invoke ??
    g.__TAURI__?.core?.invoke ??
    g.__TAURI__?.invoke;
  if (typeof inv !== 'function') throw new Error('Tauri invoke 不可用');
  return inv(cmd, args) as Promise<T>;
}

export function mcpDesktopAvailable(): boolean {
  return isTauri();
}

export async function mcpStart(opts: {
  workspace: string;
  port?: number;
  token?: string;
  allowWrite?: boolean;
  script?: string;
}): Promise<McpServerInfo> {
  return invoke<McpServerInfo>('mcp_start', {
    args: {
      workspace: opts.workspace,
      port: opts.port ?? 3721,
      token: opts.token,
      allow_write: opts.allowWrite ?? false,
      script: opts.script,
    },
  });
}

export async function mcpStop(): Promise<void> {
  await invoke('mcp_stop');
}

export async function mcpStatus(): Promise<McpServerInfo | null> {
  return invoke<McpServerInfo | null>('mcp_status');
}
