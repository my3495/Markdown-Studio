import { describe, it, expect } from 'vitest';
import {
  HashingEmbedder,
  HttpEmbedder,
  createEmbedder,
  type EmbedFetch,
} from '../src/search/embedder';
import { cosine } from '../src/search/fts';

describe('HashingEmbedder', () => {
  const e = new HashingEmbedder();

  it('确定性：同文本向量一致', () => {
    expect(e.embed('苹果 香蕉')).toEqual(e.embed('苹果 香蕉'));
  });

  it('L2 归一化（模长约 1）', () => {
    const v = e.embed('hello world 测试');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
    expect(v.length).toBe(384);
  });

  it('相似文本余弦 > 无关文本', () => {
    const a = e.embed('苹果 香蕉 水果');
    const b = e.embed('香蕉 苹果 水果');
    const c = e.embed('汽车 飞机 交通');
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
    expect(cosine(a, b)).toBeGreaterThan(0.9);
  });
});

describe('HttpEmbedder', () => {
  it('OpenAI：请求 /embeddings 并解析 data[0].embedding', async () => {
    let captured: any;
    const fetchImpl: EmbedFetch = async (url, init) => {
      captured = { url, init };
      return { ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) };
    };
    const e = new HttpEmbedder({ provider: 'openai', apiKey: 'k', model: 'text-embedding-3-small' }, fetchImpl);
    const v = await e.embed('hi');
    expect(v).toEqual([0.1, 0.2, 0.3]);
    expect(captured.url.endsWith('/embeddings')).toBe(true);
    expect(captured.init.headers.authorization).toBe('Bearer k');
    expect(JSON.parse(captured.init.body)).toMatchObject({ model: 'text-embedding-3-small', input: 'hi' });
  });

  it('Ollama：请求 /api/embeddings 并解析 embedding', async () => {
    let captured: any;
    const fetchImpl: EmbedFetch = async (url) => {
      captured = { url };
      return { ok: true, json: async () => ({ embedding: [1, 0] }) };
    };
    const e = new HttpEmbedder({ provider: 'ollama', model: 'nomic-embed' }, fetchImpl);
    expect(await e.embed('x')).toEqual([1, 0]);
    expect(captured.url.endsWith('/api/embeddings')).toBe(true);
  });
});

describe('createEmbedder', () => {
  it('无配置 → 离线哈希嵌入', () => {
    expect(createEmbedder()).toBeInstanceOf(HashingEmbedder);
    expect(createEmbedder({ provider: 'openai', model: 'm' })).toBeInstanceOf(HashingEmbedder); // 无 key/无 fetch
  });

  it('有提供商+模型+fetch → 远程嵌入', () => {
    const fetchImpl: EmbedFetch = async () => ({ ok: true, json: async () => ({ embedding: [1] }) });
    const e = createEmbedder({ provider: 'ollama', model: 'nomic' }, fetchImpl);
    expect(e).toBeInstanceOf(HttpEmbedder);
  });
});
