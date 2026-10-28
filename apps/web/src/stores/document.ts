import { create } from 'zustand';
import type { Root } from 'hast';
import type { TocItem, TypographyWarning } from '@md-studio/core';
import { useSettings, getRenderOptions } from './settings';
import { t } from '../i18n';
// 渲染走 Worker（ADR-01），无 Worker 环境下自动回退主线程；见 platform/render-offthread.ts
import { renderMarkdown } from '../platform/render-offthread';

export interface Doc {
  id: string;
  name: string;
  /** 文件路径；Web 端可能为 null（未落盘） */
  path: string | null;
  content: string;
  hast: Root | null;
  toc: TocItem[];
  words: number;
  warnings: TypographyWarning[];
  dirty: boolean;
  scrollTop: number;
}

interface DocumentState {
  docs: Record<string, Doc>;
  order: string[];
  activeId: string | null;

  newDoc: () => string;
  openDoc: (doc: { id: string; name: string; path: string | null; content: string }) => void;
  closeDoc: (id: string) => void;
  setActive: (id: string) => void;
  /** 重命名文档：改显示名；知识库笔记传入 newId（新相对路径）时同步迁移 id/order */
  renameDoc: (id: string, name: string, newId?: string) => void;
  updateContent: (id: string, content: string) => Promise<void>;
  /** 用当前渲染设置重渲染所有已打开文档（设置项变更后调用） */
  rerenderAll: () => void;
  markSaved: (id: string, path: string) => void;
  setScrollTop: (id: string, top: number) => void;
}

let counter = 0;
function genId(): string {
  return `doc-${Date.now()}-${counter++}`;
}

/**
 * 连续输入时解析/渲染的尾随合并窗口（ms）；首帧不延迟。
 *
 * 这个值反直觉：**调小并不会更快**。渲染移到 Worker 后试过 40ms，
 * 实测追平反而从 ~340ms 变成 ~386ms（三次采样 386/348/405）。
 * 原因是窗口短于击键间隔时，Worker 总在渲染「刚刚过期」的那一版，
 * 最后一次按键要等「当前渲染 + 最新渲染」两次；140ms 恰好让 Worker
 * 在最后一次按键前空闲下来，只需一次渲染（单次 render 约 200ms，是这里的主导项）。
 * 所以此值属于「抖动吸收窗口」，不要为追求响应速度继续下调。
 */
const RENDER_COALESCE_MS = 140;
/** 每个文档：待执行的合并定时器与最新渲染序号（序号用于丢弃过期结果） */
const renderTimers = new Map<string, ReturnType<typeof setTimeout>>();
const renderSeq = new Map<string, number>();

export const useDocuments = create<DocumentState>((set, get) => ({
  docs: {},
  order: [],
  activeId: null,

  newDoc: () => {
    const id = genId();
    const locale = useSettings.getState().locale;
    const untitled = t(locale, 'untitled');
    // 避免与已打开文档重名（保存时会导致互相覆盖）
    const used = new Set(Object.values(get().docs).map((d) => d.name));
    let name = `${untitled}.md`;
    for (let n = 2; used.has(name); n++) name = `${untitled} ${n}.md`;
    const doc: Doc = {
      id,
      name,
      path: null,
      content: `# ${t(locale, 'newDocHeading')}\n\n${t(locale, 'newDocHint')}\n`,
      hast: null,
      toc: [],
      words: 0,
      warnings: [],
      dirty: false,
      scrollTop: 0,
    };
    set((s) => ({
      docs: { ...s.docs, [id]: doc },
      order: [...s.order, id],
      activeId: id,
    }));
    void get().updateContent(id, doc.content);
    return id;
  },

  openDoc: (doc) => {
    set((s) => ({
      docs: {
        ...s.docs,
        [doc.id]: {
          ...doc,
          hast: null,
          toc: [],
          words: 0,
          warnings: [],
          dirty: false,
          scrollTop: 0,
        },
      },
      order: s.order.includes(doc.id) ? s.order : [...s.order, doc.id],
      activeId: doc.id,
    }));
    void get().updateContent(doc.id, doc.content);
  },

  closeDoc: (id) => {
    const t = renderTimers.get(id);
    if (t) clearTimeout(t);
    renderTimers.delete(id);
    renderSeq.delete(id);
    set((s) => {
      const docs = { ...s.docs };
      delete docs[id];
      const order = s.order.filter((x) => x !== id);
      const activeId = s.activeId === id ? order[order.length - 1] ?? null : s.activeId;
      return { docs, order, activeId };
    });
  },

  setActive: (id) => set({ activeId: id }),

  renameDoc: (id, name, newId) => {
    const to = newId && newId !== id ? newId : id;
    set((s) => {
      const cur = s.docs[id];
      if (!cur) return s;
      const docs = { ...s.docs };
      if (to !== id) delete docs[id];
      docs[to] = newId ? { ...cur, name, path: newId } : { ...cur, name };
      return {
        docs,
        order: to === id ? s.order : s.order.map((x) => (x === id ? to : x)),
        activeId: s.activeId === id ? to : s.activeId,
      };
    });
  },

  updateContent: async (id, content) => {
    const hadHast = !!get().docs[id]?.hast;
    set((s) => {
      const d = s.docs[id];
      if (!d) return {};
      return { docs: { ...s.docs, [id]: { ...d, content, dirty: true } } };
    });

    // 合并连续输入：正文先落库（dirty 立即生效），解析/渲染按文档做尾随合并。
    // 大文档单次 render 约 300–400ms，逐键渲染会排成队列把主线程压满；
    // 首次打开（还没有 hast）不延迟，保证打开即见。
    const seq = (renderSeq.get(id) ?? 0) + 1;
    renderSeq.set(id, seq);
    const prev = renderTimers.get(id);
    if (prev) clearTimeout(prev);
    if (hadHast) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          renderTimers.delete(id);
          resolve();
        }, RENDER_COALESCE_MS);
        renderTimers.set(id, t);
      });
    }
    // 期间又来了新版本：直接放弃本次，避免做过期工作
    if (renderSeq.get(id) !== seq) return;

    const settings = getRenderOptions(useSettings.getState());
    try {
      const result = await renderMarkdown(content, settings);
      if (renderSeq.get(id) !== seq) return;
      set((s) => {
        const d = s.docs[id];
        if (!d) return {};
        return {
          docs: {
            ...s.docs,
            [id]: {
              ...d,
              hast: result.hast,
              toc: result.toc,
              words: result.words,
              warnings: result.warnings ?? [],
            },
          },
        };
      });
    } catch (e) {
      console.error('[render] failed', e);
    }
  },

  markSaved: (id, path) =>
    set((s) => {
      const d = s.docs[id];
      if (!d) return {};
      return { docs: { ...s.docs, [id]: { ...d, dirty: false, path } } };
    }),

  /**
   * 用当前渲染设置重渲染所有已打开文档。
   *
   * 渲染相关的设置（标题编号、正文内目录、中文排版…）改变后，已渲染的 hast
   * 必须重新生成，否则预览区仍显示旧结果 —— 用户改完设置看不到任何变化。
   *
   * 实现上复用 updateContent：它内部已包含「按文档尾随合并 + 序号丢弃过期结果」
   * 的并发保护。注意这里**不能**改写 content（否则会把文档标记为 dirty），
   * 所以直接调用渲染逻辑而不是 updateContent。
   */
  rerenderAll: () => {
    const settings = getRenderOptions(useSettings.getState());
    for (const d of Object.values(get().docs)) {
      const seq = (renderSeq.get(d.id) ?? 0) + 1;
      renderSeq.set(d.id, seq);
      void (async () => {
        try {
          const result = await renderMarkdown(d.content, settings);
          if (renderSeq.get(d.id) !== seq) return;
          set((s) => {
            const cur = s.docs[d.id];
            if (!cur) return {};
            return {
              docs: {
                ...s.docs,
                [d.id]: {
                  ...cur,
                  hast: result.hast,
                  toc: result.toc,
                  words: result.words,
                  warnings: result.warnings ?? [],
                },
              },
            };
          });
        } catch (e) {
          console.error('[rerender] failed', e);
        }
      })();
    }
  },

  setScrollTop: (id, top) =>
    set((s) => {
      const d = s.docs[id];
      if (!d) return {};
      return { docs: { ...s.docs, [id]: { ...d, scrollTop: top } } };
    }),
}));
