/**
 * Agent 写入沙箱：写操作先入队，Accept 才落到 Vault；Reject 丢弃。
 */

import type { Vault, VaultNote } from '../vault/vault';
import { createVaultTools, type ToolResult, type ToolsOptions, type VaultTools } from './tools';
import { createIdempotencyCache } from './idempotency';

export type SandboxOp = 'write' | 'append' | 'delete';

export interface PendingChange {
  key: string;
  op: SandboxOp;
  id: string;
  name: string;
  /** 变更前内容；新建为 null；删除时为删除前正文 */
  before: string | null;
  /** 变更后内容；删除为 null */
  after: string | null;
}

export interface SandboxSession {
  tools: VaultTools;
  pending: () => PendingChange[];
  acceptAll: () => number;
  rejectAll: () => number;
  accept: (key: string) => boolean;
  reject: (key: string) => boolean;
}

function changeKey(id: string, op: SandboxOp): string {
  return `${op}:${id}`;
}

/**
 * 包装 VaultTools：allowWrite 时写入进沙箱队列，读操作仍走真库（叠加 pending 视图）。
 */
export function createSandboxSession(vault: Vault, opts: ToolsOptions = {}): SandboxSession {
  const base = createVaultTools(vault, { ...opts, allowWrite: false });
  const allowWrite = opts.allowWrite ?? false;
  const queue = new Map<string, PendingChange>();
  /**
   * 幂等键 → 首次成功执行结果。
   * 写工具（尤其 append）非幂等，重试或模型重复调用会造成重复追加；调用方传 idempotencyKey
   * 时，同一会话内相同 key 直接复用首次成功结果、不再入队。
   *
   * 失败结果不固化：下游重试同名 key 仍会重跑，便于用户修正参数或临时放开 allowWrite 后恢复。
   * 见 idempotency.ts 中的契约说明。
   */
  const idempotency = createIdempotencyCache<ToolResult>();

  const overlayGet = (id: string): VaultNote | null => {
    const p = [...queue.values()].find((c) => c.id === id);
    if (p?.op === 'delete') return null;
    if (p && p.after !== null) {
      return { id: p.id, name: p.name, content: p.after, updatedAt: Date.now() };
    }
    return vault.get(id);
  };

  const tools: VaultTools = {
    ...base,
    read_note: (args) => {
      const r = base.read_note(args);
      if (r.ok && r.data) {
        const over = overlayGet(r.data.note.id);
        if (!over) return { ok: false, error: 'note not found (pending delete)' };
        if (over.content !== r.data.note.content || over.name !== r.data.note.name) {
          return { ok: true, data: { note: over } };
        }
      }
      // 新建尚未落库
      if (args.id) {
        const over = overlayGet(args.id);
        if (over) return { ok: true, data: { note: over } };
      }
      if (args.name) {
        for (const c of queue.values()) {
          if (c.name === args.name && c.after !== null) {
            return { ok: true, data: { note: { id: c.id, name: c.name, content: c.after } } };
          }
        }
      }
      return r;
    },

    write_note: (args) =>
      idempotency.run(args?.idempotencyKey as string | undefined, () => {
      if (!allowWrite) return { ok: false, error: 'write disabled (allowWrite=false)' };
      const name = typeof args?.name === 'string' && args.name.trim() ? args.name : null;
      if (!name) return { ok: false, error: 'missing required field: name' };
      // 与非沙箱语义一致：content 允许空串，缺失（undefined/非字符串）才拒绝
      const content = typeof args?.content === 'string' ? args.content : null;
      if (content === null) return { ok: false, error: 'missing required field: content' };
      const id = args.id ?? `note-sandbox-${Date.now().toString(36)}`;
      const existing = vault.get(id);
      const key = changeKey(id, 'write');
      queue.set(key, {
        key,
        op: 'write',
        id,
        name,
        before: existing?.content ?? null,
        after: content,
      });
      return { ok: true, data: { id, name, sandboxed: true } };
      }),

    append_to_note: (args) =>
      idempotency.run(args?.idempotencyKey as string | undefined, () => {
      if (!allowWrite) return { ok: false, error: 'write disabled (allowWrite=false)' };
      const text = typeof args?.text === 'string' ? args.text : null;
      if (text === null) return { ok: false, error: 'missing required field: text' };
      const resolved = base.read_note(args);
      const targetId = resolved.data?.note?.id ?? args.id ?? null;
      if (!targetId) return { ok: false, error: 'note not found' };
      // 必须基于「叠加了 pending 的视图」取基线，否则连续 append 会丢掉前一次追加的内容
      const pendingOp = [...queue.values()].find((c) => c.id === targetId);
      if (pendingOp?.op === 'delete') {
        return { ok: false, error: 'note not found (pending delete)' };
      }
      const note = overlayGet(targetId);
      if (!note) return { ok: false, error: 'note not found' };
      const sep = note.content && !note.content.endsWith('\n') ? '\n' : '';
      const after = `${note.content}${sep}${text}`;
      const key = changeKey(note.id, 'write');
      const prev = queue.get(key);
      queue.set(key, {
        key,
        op: 'write',
        id: note.id,
        name: note.name,
        before: prev?.before ?? note.content,
        after,
      });
      return { ok: true, data: { id: note.id, name: note.name, sandboxed: true } };
      }),

    delete_note: (args) =>
      idempotency.run(args?.idempotencyKey as string | undefined, () => {
      if (!allowWrite) return { ok: false, error: 'write disabled (allowWrite=false)' };
      const r = base.read_note(args);
      const note = r.data?.note;
      if (!note) return { ok: false, error: 'note not found' };
      const key = changeKey(note.id, 'delete');
      queue.set(key, {
        key,
        op: 'delete',
        id: note.id,
        name: note.name,
        before: note.content,
        after: null,
      });
      return { ok: true, data: { id: note.id, sandboxed: true } };
      }),

    call: (name, args = {}) => {
      const fn = (tools as unknown as Record<string, (a: unknown) => ToolResult>)[name];
      if (typeof fn !== 'function' || name === 'call' || name === 'manifest') {
        return { ok: false, error: `unknown tool: ${name}` };
      }
      try {
        return fn(args);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    manifest: () => base.manifest(),
  };

  const applyOne = (c: PendingChange) => {
    if (c.op === 'delete') {
      vault.remove(c.id);
      return;
    }
    if (c.after !== null) {
      vault.upsert({ id: c.id, name: c.name, content: c.after, updatedAt: Date.now() });
    }
  };

  return {
    tools,
    pending: () => [...queue.values()],
    acceptAll: () => {
      // 逐条「应用即出队」：中途失败时已成功的项不会残留、不会被重复应用
      const failed: string[] = [];
      let n = 0;
      for (const [key, c] of [...queue.entries()]) {
        try {
          applyOne(c);
        } catch (e) {
          failed.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        queue.delete(key);
        n++;
      }
      if (failed.length) throw new Error(`sandbox accept 部分失败：${failed.join('; ')}`);
      return n;
    },
    rejectAll: () => {
      const n = queue.size;
      queue.clear();
      return n;
    },
    accept: (key) => {
      const c = queue.get(key);
      if (!c) return false;
      try {
        applyOne(c);
      } catch (e) {
        // 与 acceptAll 对齐：失败项保留在队列中，便于用户拒绝或重试
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(`sandbox accept 失败：${key}：${detail}`);
      }
      queue.delete(key);
      return true;
    },
    reject: (key) => queue.delete(key),
  };
}
