import { describe, it, expect } from 'vitest';
import { Vault } from '../src/vault/vault';
import { createVaultTools, extractOutline } from '../src/agent/tools';
import { radialLayout } from '../src/graph/graph';

function seed() {
  const v = new Vault();
  v.upsert({ id: 'a', name: 'Alpha.md', content: '# 标题一\n[[Beta]] 提到 苹果' });
  v.upsert({ id: 'b', name: 'Beta.md', content: '# 标题二\n回到 [[Alpha]]，香蕉 苹果' });
  v.upsert({ id: 'c', name: 'Gamma.md', content: '独立笔记，包含 苹果' });
  return v;
}

describe('Vault 检索', () => {
  it('关键词搜索命中', () => {
    const v = seed();
    const hits = v.search('苹果');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.map((h) => h.note.id)).toContain('a');
  });

  it('resolveName 支持无后缀', () => {
    const v = seed();
    expect(v.resolveName('beta')).toBe('b');
    expect(v.resolveName('nope')).toBeNull();
  });
});

describe('Vault 链接与图谱', () => {
  it('反链与出链', () => {
    const v = seed();
    expect(v.backlinks('a').map((n) => n.id)).toEqual(['b']);
    expect(v.outgoingLinks('a').map((n) => n.id)).toEqual(['b']);
  });

  it('图谱节点与去重边', () => {
    const v = seed();
    const g = v.noteGraph();
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(1); // a<->b 去重为一条
  });

  it('布局节点落在画布内', () => {
    const nodes = [
      { id: '1', label: '1' },
      { id: '2', label: '2' },
      { id: '3', label: '3' },
    ];
    const laid = radialLayout(nodes, [{ source: '1', target: '2' }], {
      width: 200,
      height: 200,
    });
    for (const n of laid) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(200);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(200);
    }
  });
});

describe('Agent 工具层', () => {
  it('只读工具可用', () => {
    const v = seed();
    const t = createVaultTools(v);
    expect(t.list_notes().data).toHaveLength(3);
    expect(t.read_note({ name: 'beta' }).data?.note.id).toBe('b');
    expect(t.get_backlinks({ id: 'a' }).data?.map((n) => n.id)).toEqual(['b']);
    expect(extractOutline('# A\n## B\n').map((o) => o.level)).toEqual([1, 2]);
  });

  it('只读模式下写被拦截', () => {
    const v = seed();
    const t = createVaultTools(v);
    expect(t.call('write_note', { name: 'X', content: 'y' }).ok).toBe(false);
    expect(t.call('delete_note', { id: 'c' }).ok).toBe(false);
  });

  it('allowWrite 后可写', () => {
    const v = seed();
    const t = createVaultTools(v, { allowWrite: true });
    expect(t.write_note({ name: 'Delta.md', content: '新笔记' }).ok).toBe(true);
    expect(v.list().some((n) => n.name === 'Delta.md')).toBe(true);
    expect(t.append_to_note({ id: 'a', text: '追加一句' }).ok).toBe(true);
    expect(v.get('a')!.content).toContain('追加一句');
  });
});
