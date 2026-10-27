/**
 * VaultTools：MCP 风格的工具层（读写分离），让 AI / 外部客户端能驱动笔记库。
 * 纯逻辑、可单测；后续可由 Tauri 命令或独立 MCP 服务器（stdio/HTTP）暴露。
 */

import type { Vault, VaultNote } from '../vault/vault';

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface NoteSummary {
  id: string;
  name: string;
}

export interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

export interface ToolsOptions {
  /** 是否允许写操作（默认只读，对齐 SoloMD 的 --allow-write） */
  allowWrite?: boolean;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/**
 * 命中片段：优先取包含查询词的行，供模型单次检索即可作答（避免"只拿到文件名却强行编造"，
 * 也减少一次 read_note 往返）。
 */
export function excerptFor(content: string, query: string, max = 160): string {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const terms = query.split(/\s+/).filter(Boolean);
  const matched = terms.length ? lines.filter((l) => terms.some((t) => l.includes(t))) : [];
  const text = (matched.length ? matched : lines).slice(0, 2).join(' ').replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 提取 Markdown 标题大纲 */
export function extractOutline(content: string): OutlineItem[] {
  const lines = content.split(/\r?\n/);
  const out: OutlineItem[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = HEADING_RE.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 });
  }
  return out;
}

function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

export interface VaultTools {
  // 只读
  list_notes(): ToolResult<NoteSummary[]>;
  read_note(args: { id?: string; name?: string }): ToolResult<{ note: VaultNote }>;
  search(args: { query: string; limit?: number }): ToolResult<
    { id: string; name: string; score: number; snippet: string }[]
  >;
  get_outline(args: { id?: string; name?: string }): ToolResult<OutlineItem[]>;
  get_backlinks(args: { id?: string; name?: string }): ToolResult<NoteSummary[]>;
  get_outgoing(args: { id?: string; name?: string }): ToolResult<NoteSummary[]>;
  // 写入（需 allowWrite）
  /** idempotencyKey：同一会话内相同 key 的写操作只执行一次（写工具非幂等，重试会重复追加） */
  write_note(args: { name: string; content: string; id?: string; idempotencyKey?: string }): ToolResult;
  append_to_note(args: { id?: string; name?: string; text: string; idempotencyKey?: string }): ToolResult;
  delete_note(args: { id?: string; name?: string; idempotencyKey?: string }): ToolResult;

  /** 统一分发入口（便于映射为 MCP tool call） */
  call(name: string, args?: Record<string, unknown>): ToolResult;
  /** 工具元数据（名称 + 是否写操作） */
  manifest(): { name: keyof VaultTools | string; write: boolean; description: string }[];
}

const WRITE_TOOLS = new Set(['write_note', 'append_to_note', 'delete_note']);
/** 元方法：不是工具，禁止被 call() 分发 */
const META_METHODS = new Set(['call', 'manifest']);

/**
 * 必填字符串字段校验。
 * `allowEmpty` 用于区分「字段必须存在且为字符串」与「必须非空」：
 * JSON Schema 的 required 只要求字段存在，因此 content / text 允许空串，
 * 而 name 这类决定笔记身份的字段必须非空。
 */
function requiredString(
  args: Record<string, unknown>,
  field: string,
  opts: { allowEmpty?: boolean } = {}
): { ok: true; value: string } | { ok: false; error: string } {
  const v = args[field];
  if (typeof v !== 'string') return { ok: false, error: `missing required field: ${field}` };
  if (!opts.allowEmpty && v.trim() === '') {
    return { ok: false, error: `missing required field: ${field}` };
  }
  return { ok: true, value: v };
}

/**
 * 把工具执行结果压缩为一行短摘要，供 trace UI 用。
 * 数组 → "N 项"；带 note/name 的对象 → 名称；失败 → 错误首句。
 * 抽取到独立函数方便复用与单测。
 */
export function summarizeToolResult(result: { ok: boolean; data?: unknown; error?: string }): string {
  if (!result.ok) return result.error ?? '失败';
  const d = result.data as any;
  if (Array.isArray(d)) return `${d.length} 项`;
  if (d && typeof d === 'object') {
    if ('note' in d) return d.note?.name ?? 'note';
    if ('name' in d) return String(d.name);
  }
  return 'ok';
}

/** limit 归一化：非法值（负数 / NaN / 非数字）回落默认值 */
function normalizeLimit(limit: unknown, fallback = 20): number {
  const n = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function createVaultTools(vault: Vault, opts: ToolsOptions = {}): VaultTools {
  const allowWrite = opts.allowWrite ?? false;

  const resolveId = (args: { id?: string; name?: string }): string | null => {
    if (args.id && vault.get(args.id)) return args.id;
    if (args.name) {
      const id = vault.resolveName(args.name);
      if (id) return id;
    }
    return null;
  };

  const denyWrite = (): ToolResult => ({ ok: false, error: 'write disabled (allowWrite=false)' });

  const tools: VaultTools = {
    list_notes: () => ({
      ok: true,
      data: vault.list().map((n) => ({ id: n.id, name: n.name })),
    }),

    read_note: (args) => {
      const id = resolveId(args);
      const note = id ? vault.get(id) : null;
      return note ? { ok: true, data: { note } } : { ok: false, error: 'note not found' };
    },

    search: (args) => {
      // 缺失 query 必须报错：否则会「调用成功但 0 条结果」，反而诱发模型编造
      const q = requiredString(args ?? {}, 'query');
      if (!q.ok) return { ok: false, error: q.error };
      const limit = normalizeLimit(args.limit);
      const hits = vault.search(q.value, limit);
      return {
        ok: true,
        data: hits.map((h) => ({
          id: h.note.id,
          name: h.note.name,
          score: h.score,
          snippet: excerptFor(h.note.content, q.value),
        })),
      };
    },

    get_outline: (args) => {
      const id = resolveId(args);
      const note = id ? vault.get(id) : null;
      return note
        ? { ok: true, data: extractOutline(note.content) }
        : { ok: false, error: 'note not found' };
    },

    get_backlinks: (args) => {
      const id = resolveId(args);
      if (!id) return { ok: false, error: 'note not found' };
      return {
        ok: true,
        data: vault.backlinks(id).map((n) => ({ id: n.id, name: n.name })),
      };
    },

    get_outgoing: (args) => {
      const id = resolveId(args);
      if (!id) return { ok: false, error: 'note not found' };
      return {
        ok: true,
        data: vault.outgoingLinks(id).map((n) => ({ id: n.id, name: n.name })),
      };
    },

    write_note: (args) => {
      if (!allowWrite) return denyWrite();
      const name = requiredString(args ?? {}, 'name');
      if (!name.ok) return { ok: false, error: name.error };
      // content 允许空串：新建一篇空笔记是合法操作
      const content = requiredString(args ?? {}, 'content', { allowEmpty: true });
      if (!content.ok) return { ok: false, error: content.error };
      const id = args.id ?? `note-${slug(name.value)}-${Date.now().toString(36)}`;
      vault.upsert({ id, name: name.value, content: content.value, updatedAt: Date.now() });
      return { ok: true, data: { id, name: name.value } };
    },

    append_to_note: (args) => {
      if (!allowWrite) return denyWrite();
      const text = requiredString(args ?? {}, 'text', { allowEmpty: true });
      if (!text.ok) return { ok: false, error: text.error };
      const id = resolveId(args);
      const note = id ? vault.get(id) : null;
      if (!note) return { ok: false, error: 'note not found' };
      const sep = note.content && !note.content.endsWith('\n') ? '\n' : '';
      vault.upsert({
        id: note.id,
        name: note.name,
        content: `${note.content}${sep}${text.value}`,
        updatedAt: Date.now(),
      });
      return { ok: true, data: { id: note.id, name: note.name } };
    },

    delete_note: (args) => {
      if (!allowWrite) return denyWrite();
      const id = resolveId(args);
      if (!id || !vault.get(id)) return { ok: false, error: 'note not found' };
      vault.remove(id);
      return { ok: true, data: { id } };
    },

    call: (name, args = {}) => {
      // 元方法不是工具，必须拒绝（否则 call('manifest') 会返回数组而非 ToolResult）
      if (!name || META_METHODS.has(name)) {
        return { ok: false, error: `unknown tool: ${name}` };
      }
      // unknown 中转：VaultTools 是接口类型，无法直接转 Record；通过 unknown 中转避免双重断言
      const fn = (tools as unknown as Record<string, (a: unknown) => ToolResult>)[name];
      if (typeof fn !== 'function') return { ok: false, error: `unknown tool: ${name}` };
      if (WRITE_TOOLS.has(name) && !allowWrite) {
        return { ok: false, error: 'write disabled (allowWrite=false)' };
      }
      try {
        return fn(args as unknown);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    manifest: () => [
      { name: 'list_notes', write: false, description: '列出所有笔记' },
      { name: 'read_note', write: false, description: '读取笔记内容' },
      { name: 'search', write: false, description: '关键词全文搜索' },
      { name: 'get_outline', write: false, description: '获取标题大纲' },
      { name: 'get_backlinks', write: false, description: '获取反向链接' },
      { name: 'get_outgoing', write: false, description: '获取出链' },
      { name: 'write_note', write: true, description: '新建/覆盖笔记' },
      { name: 'append_to_note', write: true, description: '向笔记追加内容' },
      { name: 'delete_note', write: true, description: '删除笔记' },
    ],
  };

  return tools;
}
