/**
 * Wikilinks（Obsidian 风格 [[双链]]）：解析、归一化、链接图与反链。
 * 纯逻辑、平台无关；供 Vault / 搜索 / 知识图谱 / Agent 工具共用。
 */

export interface WikiLink {
  /** 原始 `[[...]]` 文本 */
  raw: string;
  /** 目标笔记名/路径（不含 # 与 | 部分） */
  target: string;
  /** 显示别名（`[[target|alias]]`） */
  alias?: string;
  /** 块引用标题（`[[target#heading]]`） */
  heading?: string;
}

const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g;

/** 从文本中解析所有 wikilink */
export function parseWikilinks(text: string): WikiLink[] {
  const out: WikiLink[] = [];
  if (!text) return out;
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(text))) {
    const inner = m[1];
    const pipe = inner.indexOf('|');
    let left = pipe >= 0 ? inner.slice(0, pipe) : inner;
    const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : undefined;
    let target = left.trim();
    let heading: string | undefined;
    const hash = target.indexOf('#');
    if (hash >= 0) {
      heading = target.slice(hash + 1).trim() || undefined;
      target = target.slice(0, hash).trim();
    }
    if (target) out.push({ raw: m[0], target, alias, heading });
  }
  return out;
}

/** 归一化笔记名：去 .md 后缀、去目录、小写（用于链接解析） */
export function normalizeName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.md$/i, '');
  return base.trim().toLowerCase();
}

export interface NoteRef {
  id: string;
  name: string;
}

/** 归一化名 → 笔记 id 索引（同时收录 basename 与完整名） */
export function buildNameIndex(notes: NoteRef[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const n of notes) {
    idx.set(normalizeName(n.name), n.id);
  }
  return idx;
}

/** 解析链接目标到笔记 id（解析不到返回 null） */
export function resolveTarget(
  target: string,
  nameIndex: Map<string, string>
): string | null {
  return nameIndex.get(normalizeName(target)) ?? null;
}

export interface LinkGraph {
  /** 出链：noteId → 指向的 noteId 集合 */
  outgoing: Map<string, Set<string>>;
  /** 入链（反链）：noteId → 引用它的 noteId 集合 */
  incoming: Map<string, Set<string>>;
}

/** 依据笔记内容构建双向链接图 */
export function buildLinkGraph(
  notes: { id: string; content: string }[],
  nameIndex: Map<string, string>
): LinkGraph {
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const n of notes) {
    outgoing.set(n.id, new Set());
    incoming.set(n.id, new Set());
  }
  for (const n of notes) {
    for (const link of parseWikilinks(n.content)) {
      const to = resolveTarget(link.target, nameIndex);
      if (to && to !== n.id) {
        outgoing.get(n.id)!.add(to);
        incoming.get(to)!.add(n.id);
      }
    }
  }
  return { outgoing, incoming };
}

export function outgoingOf(graph: LinkGraph, id: string): string[] {
  return [...(graph.outgoing.get(id) ?? [])];
}

export function backlinksOf(graph: LinkGraph, id: string): string[] {
  return [...(graph.incoming.get(id) ?? [])];
}

/** 未解析的链接（悬空双链）：返回 { target, from } */
export function unresolvedLinks(
  notes: { id: string; content: string }[],
  nameIndex: Map<string, string>
): { target: string; from: string }[] {
  const out: { target: string; from: string }[] = [];
  const seen = new Set<string>();
  for (const n of notes) {
    for (const link of parseWikilinks(n.content)) {
      if (!resolveTarget(link.target, nameIndex)) {
        const key = `${n.id}|${normalizeName(link.target)}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ target: link.target, from: n.id });
        }
      }
    }
  }
  return out;
}
