/**
 * Vault（本地笔记库）模型：内存中的笔记集合，串联检索、链接/反链、知识图谱。
 * 平台无关；文件 IO 由上层适配（Web: File System Access / IndexedDB；桌面: Tauri fs）。
 */

import {
  backlinksOf,
  buildLinkGraph,
  buildNameIndex,
  normalizeName,
  outgoingOf,
  type LinkGraph,
} from '../links/wikilinks';
import { FullTextIndex, SemanticIndex, type Embedder } from '../search/fts';
import { buildNoteGraph, type NoteGraph } from '../graph/graph';

export interface VaultNote {
  id: string;
  /** 文件名（可含相对路径），如 "notes/idea.md" */
  name: string;
  content: string;
  updatedAt?: number;
}

export interface VaultSearchResult {
  note: VaultNote;
  score: number;
  /** 命中来源：关键词 / 语义 */
  via: 'fts' | 'semantic';
}

export class Vault {
  private notes = new Map<string, VaultNote>();
  private fts = new FullTextIndex();
  private semantic = new SemanticIndex();
  private graph: LinkGraph = { outgoing: new Map(), incoming: new Map() };
  private nameIndex = new Map<string, string>();
  private embedder?: Embedder;

  constructor(embedder?: Embedder) {
    this.embedder = embedder;
  }

  /**
   * 切换嵌入器并清空语义索引后重嵌全部笔记。
   * 传入 undefined 则关闭语义检索（仅保留 FTS）。
   */
  setEmbedder(embedder?: Embedder): void {
    this.embedder = embedder;
    this.semantic.clear();
    if (!embedder) return;
    for (const note of this.notes.values()) {
      void Promise.resolve(embedder.embed(note.content)).then((v) =>
        this.semantic.set(note.id, v)
      );
    }
  }

  /** 当前嵌入器（供上层判断是否已启用远程/离线语义） */
  getEmbedder(): Embedder | undefined {
    return this.embedder;
  }

  get size(): number {
    return this.notes.size;
  }

  private reindexGraph(): void {
    const list = [...this.notes.values()];
    this.nameIndex = buildNameIndex(list);
    this.graph = buildLinkGraph(list, this.nameIndex);
  }

  upsert(note: VaultNote): void {
    const prev = this.notes.get(note.id);
    this.notes.set(note.id, prev ? { ...note, updatedAt: note.updatedAt ?? prev.updatedAt } : note);
    this.fts.add(note.id, `${note.name}\n${note.content}`);
    if (this.embedder) {
      void Promise.resolve(this.embedder.embed(note.content)).then((v) =>
        this.semantic.set(note.id, v)
      );
    }
    this.reindexGraph();
  }

  remove(id: string): void {
    this.notes.delete(id);
    this.fts.remove(id);
    this.semantic.remove(id);
    this.reindexGraph();
  }

  clear(): void {
    this.notes.clear();
    this.fts.clear();
    this.semantic.clear();
    this.reindexGraph();
  }

  get(id: string): VaultNote | null {
    return this.notes.get(id) ?? null;
  }

  list(): VaultNote[] {
    return [...this.notes.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  /** 归一化名 → id（用于 wikilink 跳转） */
  resolveName(name: string): string | null {
    return this.nameIndex.get(normalizeName(name)) ?? null;
  }

  /** 关键词全文搜索 */
  search(query: string, limit = 20): VaultSearchResult[] {
    return this.fts.search(query, limit).flatMap((h) => {
      const note = this.notes.get(h.id);
      return note ? [{ note, score: h.score, via: 'fts' as const }] : [];
    });
  }

  /** 语义搜索（需注入 Embedder） */
  async searchSemantic(query: string, limit = 20): Promise<VaultSearchResult[]> {
    if (!this.embedder) return [];
    const vec = await this.embedder.embed(query);
    return this.semantic.search(vec, limit).flatMap((h) => {
      const note = this.notes.get(h.id);
      return note ? [{ note, score: h.score, via: 'semantic' as const }] : [];
    });
  }

  /** 混合检索：关键词 + 语义合并去重（无 embedder 时退化为关键词） */
  async searchHybrid(query: string, limit = 20): Promise<VaultSearchResult[]> {
    const kw = this.search(query, limit);
    if (!this.embedder) return kw;
    const sem = await this.searchSemantic(query, limit);
    const seen = new Set(kw.map((r) => r.note.id));
    const merged = [...kw];
    for (const r of sem) {
      if (!seen.has(r.note.id)) {
        seen.add(r.note.id);
        merged.push(r);
      }
    }
    return merged.slice(0, limit);
  }

  backlinks(id: string): VaultNote[] {
    return backlinksOf(this.graph, id)
      .map((x) => this.notes.get(x))
      .filter((n): n is VaultNote => !!n);
  }

  outgoingLinks(id: string): VaultNote[] {
    return outgoingOf(this.graph, id)
      .map((x) => this.notes.get(x))
      .filter((n): n is VaultNote => !!n);
  }

  noteGraph(): NoteGraph {
    return buildNoteGraph(this.list(), this.graph);
  }

  /** 原始链接图（高级用法） */
  linkGraph(): LinkGraph {
    return this.graph;
  }
}
