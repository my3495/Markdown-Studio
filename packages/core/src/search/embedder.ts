/**
 * 嵌入器（激活语义/RAG 检索）：
 * - HashingEmbedder：离线、零依赖的特征哈希词袋向量（捕捉词面重叠，开箱即用）。
 * - HttpEmbedder：调用 Ollama /api/embeddings 或 OpenAI 兼容 /embeddings（需配置）。
 * - createEmbedder：按配置选择；无可用配置时回退 HashingEmbedder。
 */

import { tokenize, type Embedder } from './fts';

const DIMS = 384;

function hashToken(t: string): number {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % DIMS;
}

/** 离线确定性嵌入：词袋 + 特征哈希 + L2 归一化 */
export class HashingEmbedder implements Embedder {
  readonly dims = DIMS;
  embed(text: string): number[] {
    const v = new Array<number>(DIMS).fill(0);
    for (const t of tokenize(text)) v[hashToken(t)] += 1;
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < DIMS; i++) v[i] /= norm;
    return v;
  }
}

export interface EmbedConfig {
  provider: string;
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

export interface EmbedResponse {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

export type EmbedFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<EmbedResponse>;

/** 远程嵌入：Ollama 与 OpenAI 兼容两种协议 */
export class HttpEmbedder implements Embedder {
  constructor(
    private cfg: EmbedConfig,
    private fetchImpl: EmbedFetch
  ) {}

  async embed(text: string): Promise<number[]> {
    const isOllama = this.cfg.provider === 'ollama';
    const base = (
      this.cfg.baseUrl || (isOllama ? 'http://localhost:11434' : 'https://api.openai.com/v1')
    ).replace(/\/+$/, '');
    const url = isOllama ? `${base}/api/embeddings` : `${base}/embeddings`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (!isOllama && this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
    const body = isOllama
      ? { model: this.cfg.model, prompt: text }
      : { model: this.cfg.model, input: text };
    const res = await this.fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok || !res.json) {
      const detail = res.text ? await res.text().catch(() => '') : '';
      throw new Error(`embed failed status=${res.status ?? '?'} ${detail.slice(0, 160)}`);
    }
    const j = (await res.json()) as any;
    const vec = isOllama ? j?.embedding : j?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) throw new Error('invalid embedding response');
    return vec as number[];
  }
}

/**
 * 选择嵌入器：配置了可用提供商时用远程（需注入 fetch），否则回退离线哈希嵌入。
 */
export function createEmbedder(cfg?: EmbedConfig, fetchImpl?: EmbedFetch): Embedder {
  const remoteReady = !!cfg && !!cfg.model && (cfg.provider === 'ollama' || !!cfg.apiKey);
  if (remoteReady && fetchImpl) return new HttpEmbedder(cfg!, fetchImpl);
  return new HashingEmbedder();
}
