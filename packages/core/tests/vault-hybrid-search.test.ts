/**
 * 混合检索（关键词 + 语义）的相关性门槛。
 *
 * 回归背景：SemanticIndex 只过滤 `cosine > 0`，无关查询（打错字、乱码）也能拿到
 * 0.01–0.1 的正相似度。这些命中被无条件并入结果后，「搜索无结果」永远不会出现，
 * 用户输入一个不存在的词，看到的是一堆不相干笔记。
 */
import { describe, expect, it } from 'vitest';
import { Vault, SEMANTIC_MIN_SCORE } from '../src/vault/vault';
import type { Embedder } from '../src/search/fts';

/** 受控嵌入器：按内容返回固定向量，便于精确构造余弦相似度 */
const VECTORS: Record<string, number[]> = {
  量子计算: [1, 0],
  量子纠缠: [0.98, 0.2],
  烹饪指南: [0.05, 1],
  家常菜: [0.02, 1],
};

// 未知文本返回零向量：余弦恒为 0，代表「语义上也完全无关」
const embedder: Embedder = {
  embed: (text) => VECTORS[text] ?? [0, 0],
};

const flush = () => new Promise((r) => setTimeout(r, 0));

async function makeVault() {
  const vault = new Vault(embedder);
  for (const [content, vec] of Object.entries(VECTORS)) {
    vault.upsert({ id: `${content}.md`, name: content, content });
    void vec;
  }
  await flush();
  return vault;
}

describe('Vault 混合检索的相关性门槛', () => {
  it('语义命中低于阈值时不进入结果（无关内容不再污染列表）', async () => {
    const vault = await makeVault();
    const hits = await vault.searchHybrid('量子计算');
    const ids = hits.map((h) => h.note.id);

    // 关键词与语义都强相关 → 必须在
    expect(ids).toContain('量子计算.md');
    // 语义相似度 0.98*1+0.2*0 = 0.98/sqrt(0.98²+0.2²) ≈ 0.98 → 必须保留
    expect(ids).toContain('量子纠缠.md');
    // 相似度 0.05 / sqrt(0.05²+1) ≈ 0.05 → 必须被滤掉
    expect(ids).not.toContain('烹饪指南.md');
    expect(ids).not.toContain('家常菜.md');
  });

  it('完全无关的查询返回空数组（UI 才能显示「无匹配」）', async () => {
    const vault = await makeVault();
    const hits = await vault.searchHybrid('zzzz-nomatch');
    expect(hits).toEqual([]);
  });

  it('阈值常量与过滤行为一致', async () => {
    const vault = await makeVault();
    // 原始语义检索不做阈值过滤：它是「最近邻」原语，由调用方决定是否采信
    const raw = await vault.searchSemantic('量子计算');
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.some((r) => r.score < SEMANTIC_MIN_SCORE)).toBe(true);

    const hybrid = await vault.searchHybrid('量子计算');
    expect(hybrid.every((r) => r.via === 'fts' || r.score >= SEMANTIC_MIN_SCORE)).toBe(true);
  });
});
