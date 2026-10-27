/**
 * Tauri Vault 后端冒烟（D 系列）。
 *
 * desktop 的 agent 链路复用 web + core，唯一桌面特有的部分是
 * `tauriVaultBackend`（Tauri FS 之上的 VaultStore）。本文件用内存 FS
 * mock 掉 @tauri-apps/plugin-fs / plugin-dialog，验证：
 *   1. store 的 list/save/remove 语义与路径拼接（含 Windows 反斜杠根）
 *   2. 该 store 可直接喂给 core 的 createVaultTools —— agent 工具链在桌面后端可用
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** 内存文件系统：normalizedPath -> content；目录单独记录 */
const fakeFs = vi.hoisted(() => {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['/']);
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return { files, dirs, norm };
});

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(async (dir: string) => {
    const base = fakeFs.norm(dir);
    const out: { name: string; isDirectory: boolean }[] = [];
    const seen = new Set<string>();
    const emit = (p: string, isDir: boolean) => {
      const rel = p.slice(base.length + 1);
      if (!rel || rel.includes('/')) return;
      if (seen.has(rel)) return;
      seen.add(rel);
      out.push({ name: rel, isDirectory: isDir });
    };
    for (const d of fakeFs.dirs) if (d !== base && d.startsWith(base + '/')) emit(d, true);
    for (const f of fakeFs.files.keys()) if (f.startsWith(base + '/')) emit(f, false);
    return out;
  }),
  readTextFile: vi.fn(async (p: string) => {
    const v = fakeFs.files.get(fakeFs.norm(p));
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  }),
  writeTextFile: vi.fn(async (p: string, contents: string) => {
    fakeFs.files.set(fakeFs.norm(p), contents);
  }),
  mkdir: vi.fn(async (p: string) => {
    fakeFs.dirs.add(fakeFs.norm(p));
  }),
  remove: vi.fn(async (p: string) => {
    const n = fakeFs.norm(p);
    fakeFs.files.delete(n);
    fakeFs.dirs.delete(n);
    for (const d of [...fakeFs.dirs]) if (d.startsWith(n + '/')) fakeFs.dirs.delete(d);
    for (const f of [...fakeFs.files.keys()]) if (f.startsWith(n + '/')) fakeFs.files.delete(f);
  }),
}));

const dialog = vi.hoisted(() => ({ selected: null as string | null }));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => dialog.selected),
}));

import {
  Vault,
  createVaultTools,
  loadVault,
} from '@md-studio/core';
import {
  pickTauriVaultDirectory,
  restoreTauriVaultDirectory,
  tauriVaultBackend,
  tauriVaultAvailable,
} from '../src/platform/vault/tauriVault';

beforeEach(() => {
  fakeFs.files.clear();
  fakeFs.dirs.clear();
  fakeFs.dirs.add('/');
  dialog.selected = null;
  localStorage.clear();
});

describe('D-Tauri Vault 后端冒烟', () => {
  it('D-01 list() 只收 .md/.mdx，跳过 node_modules 与点目录', async () => {
    fakeFs.files.set('/vault/a.md', '# A');
    fakeFs.files.set('/vault/b.mdx', '# B');
    fakeFs.files.set('/vault/c.txt', 'nope');
    fakeFs.files.set('/vault/node_modules/d.md', 'dep');
    fakeFs.files.set('/vault/.hidden/e.md', 'hidden');
    fakeFs.dirs.add('/vault/sub');
    fakeFs.files.set('/vault/sub/f.md', '# F');
    dialog.selected = '/vault';

    const store = await pickTauriVaultDirectory();
    expect(store).not.toBeNull();
    const list = await store!.list();
    expect(list.map((f) => f.path).sort()).toEqual(['a.md', 'b.mdx', 'sub/f.md']);
    expect(list.find((f) => f.path === 'a.md')?.content).toBe('# A');
  });

  it('D-02 save() 自动创建父目录并写入', async () => {
    dialog.selected = '/vault';
    const store = await pickTauriVaultDirectory();
    await store!.save('deep/nested/note.md', '# 深');
    expect(fakeFs.files.get('/vault/deep/nested/note.md')).toBe('# 深');
    expect(fakeFs.dirs.has('/vault/deep/nested')).toBe(true);
  });

  it('D-03 remove() 删除文件', async () => {
    fakeFs.files.set('/vault/gone.md', 'x');
    dialog.selected = '/vault';
    const store = await pickTauriVaultDirectory();
    await store!.remove('gone.md');
    expect(fakeFs.files.has('/vault/gone.md')).toBe(false);
  });

  it('D-04 Windows 反斜杠根下路径拼接正确', async () => {
    dialog.selected = 'D:\\Vault';
    const store = await pickTauriVaultDirectory();
    await store!.save('sub/win.md', '# W');
    // join() 应把正斜杠相对路径翻转为反斜杠，落在根目录下
    expect(fakeFs.files.get('D:/Vault/sub/win.md')).toBe('# W');
    expect(await store!.list()).toEqual([{ path: 'sub/win.md', content: '# W' }]);
  });

  it('D-05 root 持久化到 localStorage，restore 可恢复', async () => {
    dialog.selected = '/vault';
    await pickTauriVaultDirectory();
    expect(localStorage.getItem('md-studio.vaultRoot')).toBe('/vault');
    const restored = await restoreTauriVaultDirectory();
    expect(restored).not.toBeNull();
    expect(await restored!.list()).toEqual([]);
  });

  it('D-06 available() 在无 Tauri 环境为 false', () => {
    expect(tauriVaultAvailable()).toBe(false);
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {};
    expect(tauriVaultAvailable()).toBe(true);
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  it('D-07 用户取消选择时 pick 返回 null 且不清空已绑定的库', async () => {
    // 先成功绑定一个库
    dialog.selected = '/vault';
    const store = await pickTauriVaultDirectory();
    expect(store).not.toBeNull();
    // 取消选择：pick 返回 null，但已绑定的 current 不清空（保持当前库是可接受的设计）
    dialog.selected = null;
    expect(await pickTauriVaultDirectory()).toBeNull();
    expect(tauriVaultBackend.current()).toBe(store);
  });

  it('D-08 集成：Tauri store → Vault → core agent 工具链闭环', async () => {
    fakeFs.files.set('/vault/苹果.md', '# 苹果\n苹果是一种水果。\n苹果含维生素。');
    fakeFs.files.set('/vault/香蕉.md', '# 香蕉\n香蕉是热带水果。');
    dialog.selected = '/vault';
    const store = await pickTauriVaultDirectory();

    // 与 web 端 bindStore 相同的组装方式：VaultStore → Vault → 工具
    const vault = new Vault();
    const { loaded } = await loadVault(vault, store!);
    expect(loaded).toBe(2);

    const tools = createVaultTools(vault);
    const r = tools.search({ query: '苹果', limit: 5 });
    expect(r.ok).toBe(true);
    const hits = (r.data ?? []) as { id: string; name: string; score: number }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.name).toBe('苹果.md');
    // 读回正文，确认链路闭环
    const note = tools.read_note({ id: hits[0]!.id });
    expect(note.ok).toBe(true);
    expect(note.data?.note.content).toContain('苹果是一种水果。');
  });
});
