import { decodeBytes, type VaultFile, type VaultStore } from '@md-studio/core';
import {
  clearDirectoryHandle,
  ensurePermission,
  loadDirectoryHandle,
  saveDirectoryHandle,
} from './idbHandle';
import type { VaultBackend } from './registry';

/**
 * File System Access API 适配器：把用户选择的本地文件夹作为 Vault 存储。
 * 仅在 Chromium 内核（含 WebView2）可用；不可用时返回 null，由上层降级。
 */

interface FsEntry {
  kind: 'file' | 'directory';
  name: string;
  getFile?(): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
  values?(): AsyncIterableIterator<FsEntry>;
  getFileHandle?(name: string, opts?: { create?: boolean }): Promise<FsEntry & { createWritable(): Promise<FsWritable> }>;
  getDirectoryHandle?(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
  removeEntry?(name: string, opts?: { recursive?: boolean }): Promise<void>;
}
interface FsWritable {
  write(content: string): Promise<void>;
  close(): Promise<void>;
}
type FsDirHandle = FsEntry;

let currentStore: VaultStore | null = null;

/** 用 unknown 中转避免暴露 window 上不存在 showDirectoryPicker 的 TS 错误 */
type WinWithPicker = { showDirectoryPicker?: (...args: unknown[]) => unknown };
const winPicker = window as unknown as WinWithPicker;

export function fsAccessAvailable(): boolean {
  return typeof window !== 'undefined' && typeof winPicker.showDirectoryPicker === 'function';
}

async function walk(handle: FsDirHandle, prefix: string, out: VaultFile[]): Promise<void> {
  if (!handle.values) return;
  for await (const entry of handle.values()) {
    if (entry.kind === 'directory') {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await walk(entry as FsDirHandle, `${prefix}${entry.name}/`, out);
    } else if (entry.kind === 'file' && /\.mdx?$/i.test(entry.name) && entry.getFile) {
      const file = await entry.getFile();
      const buf = await file.arrayBuffer();
      out.push({ path: `${prefix}${entry.name}`, content: decodeBytes(buf).text });
    }
  }
}

async function resolveParent(handle: FsDirHandle, path: string): Promise<{ dir: FsDirHandle; name: string }> {
  const parts = path.replace(/^[\\/]+/, '').split(/[\\/]/);
  const name = parts.pop()!;
  let dir = handle;
  for (const part of parts) {
    if (!part) continue;
    dir = (await dir.getDirectoryHandle!(part, { create: true })) as FsDirHandle;
  }
  return { dir, name };
}

export function makeStore(handle: FsDirHandle): VaultStore {
  return {
    async list(): Promise<VaultFile[]> {
      const out: VaultFile[] = [];
      await walk(handle, '', out);
      return out;
    },
    async save(path: string, content: string): Promise<void> {
      const { dir, name } = await resolveParent(handle, path);
      const fh = await dir.getFileHandle!(name, { create: true });
      const w = await fh.createWritable();
      await w.write(content);
      await w.close();
    },
    async remove(path: string): Promise<void> {
      const { dir, name } = await resolveParent(handle, path);
      await dir.removeEntry!(name);
    },
    async rename(from: string, to: string): Promise<void> {
      // File System Access API 没有 rename：读取旧文件 → 写入新路径 → 删除旧文件
      const src = await resolveParent(handle, from);
      const srcFh = await src.dir.getFileHandle!(src.name);
      const buf = await srcFh.getFile!().then((f) => f.arrayBuffer());
      const dst = await resolveParent(handle, to);
      const dstFh = await dst.dir.getFileHandle!(dst.name, { create: true });
      const w = await dstFh.createWritable();
      await w.write(decodeBytes(buf).text);
      await w.close();
      await src.dir.removeEntry!(src.name);
    },
  };
}

async function bindHandle(handle: FsDirHandle): Promise<VaultStore> {
  currentStore = makeStore(handle);
  try {
    await saveDirectoryHandle(handle as unknown as FileSystemDirectoryHandle);
  } catch {
    /* IDB 不可用时忽略 */
  }
  return currentStore;
}

/** 弹出目录选择器并返回一个 VaultStore（用户取消或不可用返回 null） */
export async function pickFsAccessDirectory(): Promise<VaultStore | null> {
  if (!fsAccessAvailable() || !winPicker.showDirectoryPicker) return null;
  try {
    const handle = (await winPicker.showDirectoryPicker!({ mode: 'readwrite' })) as unknown as FsDirHandle;
    return bindHandle(handle);
  } catch {
    return null; // 用户取消
  }
}

/** 从 IndexedDB 恢复上次选择的文件夹 */
export async function restoreFsAccessDirectory(): Promise<VaultStore | null> {
  if (!fsAccessAvailable()) return null;
  const handle = await loadDirectoryHandle();
  if (!handle) return null;
  const ok = await ensurePermission(handle);
  if (!ok) {
    await clearDirectoryHandle();
    return null;
  }
  return bindHandle(handle as unknown as FsDirHandle);
}

export function currentFsAccessStore(): VaultStore | null {
  return currentStore;
}

export const fsAccessBackend: VaultBackend = {
  available: fsAccessAvailable,
  pick: pickFsAccessDirectory,
  restore: restoreFsAccessDirectory,
  current: currentFsAccessStore,
};
