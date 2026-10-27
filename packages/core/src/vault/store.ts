/**
 * Vault 持久化抽象：以“相对路径为笔记 id”，把本地文件夹与 Vault 模型互相同步。
 * 平台无关；具体存储由上层实现（Web: File System Access API；桌面: Tauri fs）。
 */

import type { Vault } from './vault';

export interface VaultFile {
  /** 相对路径（同时作为笔记 id，保证重载稳定） */
  path: string;
  content: string;
}

export interface VaultStore {
  /** 列出所有 .md 文件 */
  list(): Promise<VaultFile[]>;
  /** 写入/覆盖（路径不存在则创建） */
  save(path: string, content: string): Promise<void>;
  /** 删除 */
  remove(path: string): Promise<void>;
  /** 重命名（可选；未实现时由 renameNote 退化为复制 + 删除） */
  rename?(from: string, to: string): Promise<void>;
}

export function basename(path: string): string {
  return path.replace(/^.*[\\/]/, '');
}

/** 相对路径所在目录（不含文件名）；根目录返回空串 */
export function dirname(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

/**
 * 规范化用户输入的笔记文件名：
 * - 去除首尾空白、去掉路径分隔符与非法字符（含 . / .. 之类的目录穿越）
 * - 无扩展名时补 `.md`；仅接受 .md / .markdown / .mdx
 * - 结果为空或非法时返回 null（调用方据此取消重命名）
 */
export function normalizeNoteName(input: string): string | null {
  const base = (input ?? '').trim().replace(/.*[\\/]/, '');
  if (!base || base === '.' || base === '..') return null;
  const withExt = /\.[a-z0-9]+$/i.test(base) ? base : `${base}.md`;
  const stem = withExt.replace(/\.[a-z0-9]+$/i, '');
  if (!stem.trim()) return null;
  if (INVALID_NAME_CHARS.test(withExt)) return null;
  if (!/\.(md|markdown|mdx)$/i.test(withExt)) return null;
  // Windows 保留名 / 结尾点或空格
  if (/[. ]$/.test(stem)) return null;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) return null;
  return withExt;
}

/** 从存储加载全部笔记进 Vault */
export async function loadVault(
  vault: Vault,
  store: VaultStore
): Promise<{ loaded: number; files: VaultFile[] }> {
  const files = await store.list();
  for (const f of files) {
    vault.upsert({ id: f.path, name: basename(f.path), content: f.content });
  }
  return { loaded: files.length, files };
}

/** 保存单篇笔记 */
export async function saveNote(store: VaultStore, path: string, content: string): Promise<void> {
  await store.save(path, content);
}

/** 删除单篇笔记 */
export async function removeNote(store: VaultStore, path: string): Promise<void> {
  await store.remove(path);
}

/** 重命名单篇笔记（存储未实现 rename 时退化为「读取 → 写入新路径 → 删除旧文件」） */
export async function renameNote(store: VaultStore, from: string, to: string): Promise<void> {
  if (from === to) return;
  if (store.rename) {
    await store.rename(from, to);
    return;
  }
  const hit = (await store.list()).find((f) => f.path === from);
  if (!hit) throw new Error(`note not found: ${from}`);
  await store.save(to, hit.content);
  await store.remove(from);
}
