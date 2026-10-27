/**
 * 检索内核：CJK 感知分词 + BM25 全文索引 + 可插拔语义（RAG）索引。
 * 零第三方依赖，可在 Node/Worker/主线程运行；语义向量由上层 Embedder 提供。
 */

export interface SearchHit {
  id: string;
  score: number;
}

const WORD_RE = /[A-Za-z0-9_]+/g;
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/g;

/**
 * CJK 感知分词：拉丁/数字按词，CJK 取 unigram + bigram（无空格语言的最佳实践）。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  if (!text) return tokens;
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text))) tokens.push(m[0].toLowerCase());
  CJK_RE.lastIndex = 0;
  while ((m = CJK_RE.exec(text))) {
    const s = m[0];
    if (s.length === 1) {
      tokens.push(s);
    } else {
      for (let i = 0; i < s.length; i++) {
        tokens.push(s[i]);
        if (i < s.length - 1) tokens.push(s.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

/** BM25 全文索引 */
export class FullTextIndex {
  private docs = new Map<string, { tf: Map<string, number>; len: number }>();
  private df = new Map<string, number>();
  private totalLen = 0;
  private readonly k1 = 1.2;
  private readonly b = 0.75;

  get size(): number {
    return this.docs.size;
  }

  add(id: string, text: string): void {
    this.remove(id);
    const toks = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    this.docs.set(id, { tf, len: toks.length });
    this.totalLen += toks.length;
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
  }

  remove(id: string): void {
    const d = this.docs.get(id);
    if (!d) return;
    for (const t of d.tf.keys()) {
      const c = (this.df.get(t) ?? 0) - 1;
      if (c <= 0) this.df.delete(t);
      else this.df.set(t, c);
    }
    this.totalLen -= d.len;
    this.docs.delete(id);
  }

  clear(): void {
    this.docs.clear();
    this.df.clear();
    this.totalLen = 0;
  }

  search(query: string, limit = 20): SearchHit[] {
    const q = tokenize(query);
    if (!q.length || this.docs.size === 0) return [];
    const N = this.docs.size;
    const avgdl = this.totalLen / N || 1;
    const scores = new Map<string, number>();
    for (const term of q) {
      const df = this.df.get(term) ?? 0;
      if (!df) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (const [id, d] of this.docs) {
        const f = d.tf.get(term);
        if (!f) continue;
        const denom = f + this.k1 * (1 - this.b + this.b * (d.len / avgdl));
        const s = idf * ((f * (this.k1 + 1)) / denom);
        scores.set(id, (scores.get(id) ?? 0) + s);
      }
    }
    return [...scores.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/** 余弦相似度 */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 语义索引（RAG）：存入向量，按查询向量做最近邻。向量由上层 Embedder 产出。 */
export class SemanticIndex {
  private vecs = new Map<string, number[]>();

  get size(): number {
    return this.vecs.size;
  }

  set(id: string, vec: number[]): void {
    this.vecs.set(id, vec);
  }

  remove(id: string): void {
    this.vecs.delete(id);
  }

  clear(): void {
    this.vecs.clear();
  }

  search(queryVec: number[], limit = 20): SearchHit[] {
    return [...this.vecs.entries()]
      .map(([id, v]) => ({ id, score: cosine(queryVec, v) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/** 嵌入器接口：由上层接入本地/远程模型（如 Ollama/OpenAI 嵌入） */
export interface Embedder {
  embed(text: string): Promise<number[]> | number[];
}
