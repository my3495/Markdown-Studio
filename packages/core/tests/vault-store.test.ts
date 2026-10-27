import { describe, it, expect } from 'vitest';
import { Vault } from '../src/vault/vault';
import {
  loadVault,
  saveNote,
  removeNote,
  renameNote,
  normalizeNoteName,
  type VaultStore,
  type VaultFile,
} from '../src/vault/store';

class MemoryStore implements VaultStore {
  files = new Map<string, string>();
  async list(): Promise<VaultFile[]> {
    return [...this.files.entries()].map(([path, content]) => ({ path, content }));
  }
  async save(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

/** 具备原生 rename 的实现（模拟桌面 Tauri fs / 支持 rename 的存储） */
class RenamingStore extends MemoryStore {
  calls: string[] = [];
  async rename(from: string, to: string): Promise<void> {
    this.calls.push(`${from}->${to}`);
    const content = this.files.get(from);
    this.files.delete(from);
    if (content !== undefined) this.files.set(to, content);
  }
}

describe('Vault 持久化抽象', () => {
  it('loadVault 以 path 为 id 载入，检索/反链可用', async () => {
    const store = new MemoryStore();
    store.files.set('notes/Alpha.md', '# Alpha [[Beta]] 苹果');
    store.files.set('notes/Beta.md', '# Beta 回到 [[Alpha]]');
    const vault = new Vault();
    const { loaded } = await loadVault(vault, store);
    expect(loaded).toBe(2);
    expect(vault.get('notes/Alpha.md')?.name).toBe('Alpha.md');
    expect(vault.backlinks('notes/Alpha.md').map((n) => n.id)).toEqual(['notes/Beta.md']);
    expect(vault.search('苹果').length).toBe(1);
  });

  it('saveNote / removeNote 写回存储', async () => {
    const store = new MemoryStore();
    await saveNote(store, 'a.md', '# A');
    expect(store.files.get('a.md')).toBe('# A');
    await removeNote(store, 'a.md');
    expect(store.files.has('a.md')).toBe(false);
  });

  it('重载稳定：同 path 再次 loadVault 不重复', async () => {
    const store = new MemoryStore();
    store.files.set('x.md', '# X');
    const vault = new Vault();
    await loadVault(vault, store);
    await loadVault(vault, store);
    expect(vault.size).toBe(1);
  });
});

describe('笔记重命名', () => {
  it('normalizeNoteName：补扩展名 / 剥离目录 / 拒绝非法名', () => {
    expect(normalizeNoteName('我的笔记')).toBe('我的笔记.md');
    expect(normalizeNoteName('  会议记录  ')).toBe('会议记录.md');
    expect(normalizeNoteName('  a/b/c.md  ')).toBe('c.md');
    expect(normalizeNoteName('note.md')).toBe('note.md');
    expect(normalizeNoteName('note.mdx')).toBe('note.mdx');
    expect(normalizeNoteName('note.markdown')).toBe('note.markdown');
    // 非法：空 / 目录穿越 / 非法字符 / 非 md 扩展名 / Windows 保留名 / 结尾点
    expect(normalizeNoteName('')).toBeNull();
    expect(normalizeNoteName('   ')).toBeNull();
    expect(normalizeNoteName('..')).toBeNull();
    expect(normalizeNoteName('a?b.md')).toBeNull();
    expect(normalizeNoteName('a:b.md')).toBeNull();
    expect(normalizeNoteName('note.txt')).toBeNull();
    expect(normalizeNoteName('con.md')).toBeNull();
    expect(normalizeNoteName('trail.')).toBeNull();
  });

  it('renameNote：存储实现 rename 时直接委托', async () => {
    const store = new RenamingStore();
    store.files.set('a.md', '# A');
    await renameNote(store, 'a.md', 'b.md');
    expect(store.calls).toEqual(['a.md->b.md']);
    expect(store.files.get('b.md')).toBe('# A');
    expect(store.files.has('a.md')).toBe(false);
  });

  it('renameNote：未实现 rename 时退化为复制 + 删除', async () => {
    const store = new MemoryStore();
    store.files.set('notes/A.md', '# A [[B]]');
    await renameNote(store, 'notes/A.md', 'notes/C.md');
    expect(store.files.get('notes/C.md')).toBe('# A [[B]]');
    expect(store.files.has('notes/A.md')).toBe(false);
  });

  it('renameNote：同名不动作；源不存在抛错', async () => {
    const store = new MemoryStore();
    store.files.set('a.md', '# A');
    await renameNote(store, 'a.md', 'a.md');
    expect(store.files.get('a.md')).toBe('# A');
    await expect(renameNote(store, 'missing.md', 'b.md')).rejects.toThrow();
  });
});
