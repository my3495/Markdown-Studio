import type { VaultStore } from '@md-studio/core';

/**
 * Vault 存储后端：Web（File System Access）与桌面（Tauri fs）可注入替换。
 */
export interface VaultBackend {
  available(): boolean;
  pick(): Promise<VaultStore | null>;
  /** 恢复上次会话的文件夹（可选） */
  restore?(): Promise<VaultStore | null>;
  current(): VaultStore | null;
}

let backend: VaultBackend | null = null;
let fallback: VaultBackend | null = null;

export function setVaultBackend(b: VaultBackend): void {
  backend = b;
}

/** 注册默认后端（通常为 File System Access）；桌面可再 setVaultBackend 覆盖 */
export function setDefaultVaultBackend(b: VaultBackend): void {
  fallback = b;
  if (!backend) backend = b;
}

export function getVaultBackend(): VaultBackend | null {
  return backend ?? fallback;
}

export function vaultPickerAvailable(): boolean {
  return !!(backend ?? fallback)?.available();
}

export async function pickVaultDirectory(): Promise<VaultStore | null> {
  const b = getVaultBackend();
  if (!b) return null;
  return b.pick();
}

export async function restoreVaultDirectory(): Promise<VaultStore | null> {
  const b = getVaultBackend();
  if (!b?.restore) return null;
  return b.restore();
}

export function currentVaultStore(): VaultStore | null {
  return getVaultBackend()?.current() ?? null;
}
