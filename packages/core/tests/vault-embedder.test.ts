import { describe, it, expect } from 'vitest';
import { Vault } from '../src/vault/vault';
import { HashingEmbedder, type EmbedFetch, HttpEmbedder } from '../src/search/embedder';

describe('Vault.setEmbedder', () => {
  it('切换嵌入器后语义索引可检索', async () => {
    const vault = new Vault();
    vault.upsert({ id: 'a.md', name: 'a.md', content: '苹果 香蕉 水果' });
    expect(await vault.searchSemantic('苹果')).toEqual([]);

    vault.setEmbedder(new HashingEmbedder());
    // 等待异步重嵌
    await new Promise((r) => setTimeout(r, 20));
    const hits = await vault.searchSemantic('香蕉 水果');
    expect(hits.some((h) => h.note.id === 'a.md')).toBe(true);
  });

  it('设为 undefined 关闭语义', async () => {
    const vault = new Vault(new HashingEmbedder());
    vault.upsert({ id: 'a.md', name: 'a.md', content: 'hello world' });
    await new Promise((r) => setTimeout(r, 20));
    vault.setEmbedder(undefined);
    expect(await vault.searchSemantic('hello')).toEqual([]);
  });

  it('HttpEmbedder 注入后 upsert 会调用 embed', async () => {
    let calls = 0;
    const fetchImpl: EmbedFetch = async () => {
      calls += 1;
      return { ok: true, json: async () => ({ embedding: [1, 0, 0] }) };
    };
    const vault = new Vault();
    vault.setEmbedder(new HttpEmbedder({ provider: 'ollama', model: 'nomic' }, fetchImpl));
    vault.upsert({ id: 'x.md', name: 'x.md', content: 'test' });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
