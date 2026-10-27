import { describe, it, expect } from 'vitest';
import { diffLines } from '../src/version/diff';
import {
  createSnapshot,
  listSnapshots,
  readSnapshot,
  type SnapshotFs,
} from '../src/version/snapshot';

describe('版本 diff', () => {
  it('标记新增/删除/不变行', () => {
    const ops = diffLines('a\nb\nc', 'a\nx\nc');
    const types = ops.map((o) => o.type);
    expect(types).toContain('del'); // b 被删
    expect(types).toContain('add'); // x 新增
    expect(types).toContain('eq'); // a, c 不变
  });
});

class MemoryFs implements SnapshotFs {
  store = new Map<string, string>();
  dirs = new Set<string>();
  async mkdirp(dir: string) {
    this.dirs.add(dir);
  }
  async writeTextFile(path: string, content: string) {
    this.store.set(path, content);
  }
  async readDir(dir: string) {
    return [...this.store.keys()]
      .filter((k) => k.startsWith(dir + '/'))
      .map((k) => k.slice(dir.length + 1));
  }
  async readTextFile(path: string) {
    return this.store.get(path) ?? '';
  }
  async remove(path: string) {
    this.store.delete(path);
  }
}

describe('版本快照', () => {
  it('创建并保留最近 20 版', async () => {
    const fs = new MemoryFs();
    for (let i = 0; i < 22; i++) {
      await createSnapshot(fs, 'doc.md', `v${i}`, 20);
    }
    const list = await listSnapshots(fs, 'doc.md');
    expect(list.length).toBe(20);
    const content = await readSnapshot(fs, list[0]!);
    expect(content).toBe('v21');
  });
});
