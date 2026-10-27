/**
 * Tauri 桌面端 VaultStore：以用户选择的本地目录为知识库根。
 */
import { open } from '@tauri-apps/plugin-dialog';
import { mkdir, readDir, readTextFile, remove, rename as renameFs, writeTextFile } from '@tauri-apps/plugin-fs';
import type { VaultFile, VaultStore } from '@md-studio/core';
import type { VaultBackend } from '@md-studio/web';

const ROOT_KEY = 'md-studio.vaultRoot';

let currentStore: VaultStore | null = null;

function join(root: string, rel: string): string {
  const norm = rel.replace(/^[\\/]+/, '').replace(/\\/g, '/');
  const base = root.replace(/[\\/]+$/, '');
  const sep = root.includes('\\') ? '\\' : '/';
  return norm ? `${base}${sep}${norm.split('/').join(sep)}` : base;
}

function parentDir(abs: string): string {
  return abs.replace(/[\\/][^\\/]+$/, '');
}

async function walk(dir: string, prefix: string, out: VaultFile[]): Promise<void> {
  const entries = await readDir(dir);
  for (const e of entries) {
    const name = e.name;
    if (!name) continue;
    if (e.isDirectory) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      await walk(join(dir, name), `${prefix}${name}/`, out);
    } else if (/\.mdx?$/i.test(name)) {
      const content = await readTextFile(join(dir, name));
      out.push({ path: `${prefix}${name}`, content });
    }
  }
}

function makeStore(root: string): VaultStore {
  return {
    async list(): Promise<VaultFile[]> {
      const out: VaultFile[] = [];
      await walk(root, '', out);
      return out;
    },
    async save(path: string, content: string): Promise<void> {
      const abs = join(root, path);
      const dir = parentDir(abs);
      if (dir && dir !== root) {
        try {
          await mkdir(dir, { recursive: true });
        } catch {
          /* 已存在 */
        }
      }
      await writeTextFile(abs, content);
    },
    async remove(path: string): Promise<void> {
      await remove(join(root, path));
    },
    async rename(from: string, to: string): Promise<void> {
      const target = join(root, to);
      const dir = parentDir(target);
      if (dir && dir !== root) {
        try {
          await mkdir(dir, { recursive: true });
        } catch {
          /* 已存在 */
        }
      }
      await renameFs(join(root, from), target);
    },
  };
}

function bindRoot(root: string): VaultStore {
  currentStore = makeStore(root);
  try {
    localStorage.setItem(ROOT_KEY, root);
  } catch {
    /* ignore */
  }
  return currentStore;
}

export async function pickTauriVaultDirectory(): Promise<VaultStore | null> {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected !== 'string' || !selected) return null;
  return bindRoot(selected);
}

export async function restoreTauriVaultDirectory(): Promise<VaultStore | null> {
  try {
    const root = localStorage.getItem(ROOT_KEY);
    if (!root) return null;
    return bindRoot(root);
  } catch {
    return null;
  }
}

export function currentTauriVaultStore(): VaultStore | null {
  return currentStore;
}

export function tauriVaultAvailable(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export const tauriVaultBackend: VaultBackend = {
  available: tauriVaultAvailable,
  pick: pickTauriVaultDirectory,
  restore: restoreTauriVaultDirectory,
  current: currentTauriVaultStore,
};
