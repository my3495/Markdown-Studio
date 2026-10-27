import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { LlmTraceStep, PendingChange } from '@md-studio/core';

/** 消息角色 */
export type SessionRole = 'user' | 'assistant';

/** 单条消息（与原 AgentChat.ChatMessage 保持一致） */
export interface SessionMessage {
  id: string;
  role: SessionRole;
  text: string;
  /** 送入模型的完整文本（含附件正文）；缺省回落到 text */
  context?: string;
  /** 工具调用轮里模型的中间正文（前言） */
  preamble?: string;
  attachments?: { name: string; size: number }[];
  trace?: LlmTraceStep[];
  streaming?: boolean;
  /** 用户主动取消时标记 */
  aborted?: boolean;
  /** 创建时间（毫秒） */
  createdAt: number;
}

/** Agent 模式：agent=可用工具，chat=纯对话，plan=规划模式（占位） */
export type SessionMode = 'agent' | 'chat' | 'plan';

/** 一个会话（thread） */
export interface AgentSession {
  id: string;
  /** 标题：默认取首条 user 消息前 30 字，可用户重命名 */
  title: string;
  /** 创建时间 */
  createdAt: number;
  /** 最近活动（最后一条消息或最后活跃时间） */
  updatedAt: number;
  /** 会话内消息 */
  messages: SessionMessage[];
  /** 模式 */
  mode: SessionMode;
  /** 使用的模型 id（OpenAI 兼容 provider 的 model 名） */
  model?: string;
  /** 当前未确认的 sandbox 变更（保持原 AgentChat pending 字段） */
  pending?: PendingChange[];
}

interface SessionStore {
  sessions: Record<string, AgentSession>;
  /** 会话 id 顺序（按 updatedAt 倒序维护） */
  order: string[];
  /** 当前激活的会话 id */
  activeId: string | null;

  /** 新建一个会话并设为激活 */
  createSession: (init?: Partial<AgentSession>) => string;
  /** 删除一个会话 */
  deleteSession: (id: string) => void;
  /** 重命名 */
  renameSession: (id: string, title: string) => void;
  /** 设为激活 */
  setActive: (id: string | null) => void;
  /** 清空一个会话的消息（保留会话） */
  clearMessages: (id: string) => void;

  /** 在当前激活会话里加一条消息；返回消息 id */
  appendMessage: (msg: Omit<SessionMessage, 'id' | 'createdAt'>) => string;
  /** 更新消息（按 patch 函数） */
  patchMessage: (id: string, patch: Partial<SessionMessage> | ((m: SessionMessage) => Partial<SessionMessage>)) => void;
  /** 删除某条消息（连带其后所有消息一起删，用于「编辑后重发」） */
  truncateAfter: (messageId: string) => void;
  /** 整段覆盖 messages（用于「分叉」） */
  setMessages: (messages: SessionMessage[]) => void;

  /** 从一个会话分叉：复制到新会话，从 messageId 处开始 */
  forkFrom: (sessionId: string, messageId: string) => string | null;

  /** 设置模式 */
  setMode: (mode: SessionMode) => void;
  /** 设置模型 */
  setModel: (model: string | undefined) => void;

  /** 当前激活会话（便捷 getter） */
  getActive: () => AgentSession | null;
}

const STORAGE_KEY = 'md-studio:agent-sessions:v1';
let _seq = 0;
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `m-${Date.now()}-${_seq++}`;

/** 截断标题到指定字符宽度 */
function deriveTitle(text: string, max = 30): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return '新会话';
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

/** 把会话挪到 order 顶部 */
function touch(order: string[], id: string): string[] {
  return [id, ...order.filter((x) => x !== id)];
}

export const useAgentSessions = create<SessionStore>()(
  persist(
    (set, get) => ({
      sessions: {},
      order: [],
      activeId: null,

      getActive: () => {
        const { activeId, sessions } = get();
        return activeId ? (sessions[activeId] ?? null) : null;
      },

      createSession: (init) => {
        const id = uid();
        const now = Date.now();
        const session: AgentSession = {
          id,
          title: init?.title ?? '新会话',
          createdAt: now,
          updatedAt: now,
          messages: init?.messages ?? [],
          mode: init?.mode ?? 'agent',
          model: init?.model,
          pending: init?.pending ?? [],
        };
        set((s) => ({
          sessions: { ...s.sessions, [id]: session },
          order: touch(s.order, id),
          activeId: id,
        }));
        return id;
      },

      deleteSession: (id) => {
        set((s) => {
          const { [id]: _, ...rest } = s.sessions;
          const order = s.order.filter((x) => x !== id);
          return {
            sessions: rest,
            order,
            activeId: s.activeId === id ? (order[0] ?? null) : s.activeId,
          };
        });
      },

      renameSession: (id, title) => {
        set((s) => {
          const cur = s.sessions[id];
          if (!cur) return s;
          return {
            sessions: { ...s.sessions, [id]: { ...cur, title: title.trim() || cur.title } },
            order: touch(s.order, id),
          };
        });
      },

      setActive: (id) => {
        if (id === null) {
          set({ activeId: null });
          return;
        }
        set((s) => {
          if (!s.sessions[id]) return s;
          return { activeId: id, order: touch(s.order, id) };
        });
      },

      clearMessages: (id) => {
        set((s) => {
          const cur = s.sessions[id];
          if (!cur) return s;
          return {
            sessions: {
              ...s.sessions,
              [id]: { ...cur, messages: [], updatedAt: Date.now() },
            },
            order: touch(s.order, id),
          };
        });
      },

      appendMessage: (msg) => {
        const id = uid();
        set((s) => {
          const aid = s.activeId;
          if (!aid) return s;
          const cur = s.sessions[aid];
          if (!cur) return s;
          const full: SessionMessage = { ...msg, id, createdAt: Date.now() };
          const messages = [...cur.messages, full];
          // 自动从首条 user 消息派生标题
          let title = cur.title;
          if (cur.title === '新会话' && full.role === 'user') {
            title = deriveTitle(full.text);
          }
          return {
            sessions: {
              ...s.sessions,
              [aid]: { ...cur, title, messages, updatedAt: Date.now() },
            },
            order: touch(s.order, aid),
          };
        });
        return id;
      },

      patchMessage: (id, patch) => {
        set((s) => {
          const aid = s.activeId;
          if (!aid) return s;
          const cur = s.sessions[aid];
          if (!cur) return s;
          let changed = false;
          const messages = cur.messages.map((m) => {
            if (m.id !== id) return m;
            const p = typeof patch === 'function' ? patch(m) : patch;
            changed = true;
            return { ...m, ...p };
          });
          if (!changed) return s;
          return {
            sessions: {
              ...s.sessions,
              [aid]: { ...cur, messages, updatedAt: Date.now() },
            },
          };
        });
      },

      truncateAfter: (messageId) => {
        set((s) => {
          const aid = s.activeId;
          if (!aid) return s;
          const cur = s.sessions[aid];
          if (!cur) return s;
          const idx = cur.messages.findIndex((m) => m.id === messageId);
          if (idx < 0) return s;
          const messages = cur.messages.slice(0, idx + 1);
          return {
            sessions: {
              ...s.sessions,
              [aid]: { ...cur, messages, updatedAt: Date.now() },
            },
          };
        });
      },

      setMessages: (messages) => {
        set((s) => {
          const aid = s.activeId;
          if (!aid) return s;
          const cur = s.sessions[aid];
          if (!cur) return s;
          return {
            sessions: {
              ...s.sessions,
              [aid]: { ...cur, messages, updatedAt: Date.now() },
            },
            order: touch(s.order, aid),
          };
        });
      },

      forkFrom: (sessionId, messageId) => {
        const state = get();
        const src = state.sessions[sessionId];
        if (!src) return null;
        const idx = src.messages.findIndex((m) => m.id === messageId);
        if (idx < 0) return null;
        const messages = src.messages.slice(0, idx + 1);
        return get().createSession({ title: src.title, mode: src.mode, model: src.model, messages });
      },

      setMode: (mode) => {
        set((s) => {
          const aid = s.activeId;
          if (!aid) return s;
          const cur = s.sessions[aid];
          if (!cur) return s;
          return {
            sessions: { ...s.sessions, [aid]: { ...cur, mode } },
          };
        });
      },

      setModel: (model) => {
        set((s) => {
          const aid = s.activeId;
          if (!aid) return s;
          const cur = s.sessions[aid];
          if (!cur) return s;
          return {
            sessions: { ...s.sessions, [aid]: { ...cur, model } },
          };
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // 只持久化轻量字段；messages 可能很大，由调用方选择是否保存
      partialize: (s) => ({
        sessions: s.sessions,
        order: s.order,
        activeId: s.activeId,
      }),
    }
  )
);

/** 时间分组标签（按 updatedAt） */
export function sessionGroup(ts: number, now = Date.now()): '今天' | '昨天' | '本周' | '更早' {
  const d = new Date(ts);
  const n = new Date(now);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, n)) return '今天';
  const y = new Date(n);
  y.setDate(n.getDate() - 1);
  if (sameDay(d, y)) return '昨天';
  const diff = (now - ts) / (1000 * 60 * 60 * 24);
  if (diff < 7) return '本周';
  return '更早';
}
