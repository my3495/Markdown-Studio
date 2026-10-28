import { render, warmupHighlight } from '@md-studio/core';
import type { RenderOptions, RenderResult } from '@md-studio/core';

/**
 * 渲染线程调度（ADR-01）。
 *
 * 目的：把 Markdown 解析 / CJK 排版 / 净化 / 高亮整体移出主线程。
 * 实测单次 `render()` 约 200–220ms（320 块 / 2241 节点，其中 shiki 仅 ~24ms），
 * 留在主线程时每次输入都会产生一个 200ms+ 的长任务。
 *
 * 兜底原则：**任何异常都退回主线程渲染**，宁可卡一点也不能让预览空白。
 * 回退条件：环境无 Worker（jsdom / 老浏览器）、Worker 构造失败、
 * Worker 抛错、首条消息或单次渲染超时。
 */

interface Pending {
  content: string;
  opts: RenderOptions;
  resolve: (r: RenderResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Worker 启动 + shiki 冷启动：首次请求给足时间，超时即永久回退主线程 */
const FIRST_REQUEST_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 20_000;

let worker: Worker | null = null;
let unavailable = false;
let seq = 0;
const pending = new Map<number, Pending>();

/**
 * Worker 判死后把在途请求全部改由主线程完成。
 * 注意是「重跑」而不是 reject：预览必须拿到结果，拒绝只会让面板停在旧内容上。
 */
function rerunAllOnMainThread(): void {
  const entries = [...pending.values()];
  pending.clear();
  for (const p of entries) {
    clearTimeout(p.timer);
    renderOnMainThread(p.content, p.opts).then(p.resolve, p.reject);
  }
}

function ensureWorker(): Worker | null {
  if (unavailable) return null;
  if (worker) return worker;
  if (typeof Worker === 'undefined') {
    unavailable = true;
    return null;
  }
  try {
    const w = new Worker(new URL('../workers/render.worker.ts', import.meta.url), {
      type: 'module',
    });
    w.onmessage = (
      event: MessageEvent<{ id: number; ok: boolean; stage?: string; result?: RenderResult; error?: string }>
    ) => {
      const msg = event.data;
      // id < 0：Worker 内部的模块加载失败（没有对应请求），单独报出来便于定位
      if (msg?.id < 0) {
        console.error('[render] worker import failed', msg.stage, msg.error);
        return;
      }
      const p = pending.get(msg?.id);
      if (!p) return; // 已超时并回退过：丢弃迟到结果
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok && msg.result) p.resolve(msg.result);
      else p.reject(new Error(msg.error ?? 'render worker failed'));
    };
    w.onerror = (e) => {
      // Worker 脚本本身崩了（加载/执行失败）：在途请求改走主线程，之后永不再试。
      // 保留一条 warn：dev 下 Worker 打包异常时，只表现为「性能没变好」，很容易被忽略。
      console.warn('[render] worker error, fallback to main thread', e);
      unavailable = true;
      worker = null;
      rerunAllOnMainThread();
    };
    worker = w;
    return w;
  } catch {
    unavailable = true;
    return null;
  }
}

/** 主线程直跑：无 Worker 或 Worker 已判死时的唯一路径 */
function renderOnMainThread(content: string, opts: RenderOptions): Promise<RenderResult> {
  return render(content, opts);
}

/**
 * 渲染 Markdown。有 Worker 时在 Worker 内执行，否则同步走主线程。
 * 超时不会 reject：本次回退主线程完成，保证预览一定拿到结果。
 */
export function renderMarkdown(content: string, opts: RenderOptions): Promise<RenderResult> {
  const w = ensureWorker();
  if (!w) return renderOnMainThread(content, opts);

  const id = ++seq;
  return new Promise<RenderResult>((resolve, reject) => {
    const timeout = pending.size === 0 ? FIRST_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    const timer = setTimeout(() => {
      pending.delete(id);
      renderOnMainThread(content, opts).then(resolve, reject);
    }, timeout);

    pending.set(id, { content, opts, resolve, reject, timer });
    try {
      w.postMessage({ id, kind: 'render', content, opts });
    } catch {
      pending.delete(id);
      clearTimeout(timer);
      renderOnMainThread(content, opts).then(resolve, reject);
    }
  });
}

/**
 * 预热 shiki（主题 + 常用语言）。
 * 渲染在 Worker 内进行，预热也必须在 Worker 里做 —— 主线程预热的是另一份实例，
 * 既省不下 Worker 的冷启动，还白白占用主线程。
 */
export function warmupRender(theme: 'light' | 'dark'): void {
  const w = ensureWorker();
  if (!w) {
    void warmupHighlight(theme);
    return;
  }
  try {
    w.postMessage({ id: ++seq, kind: 'warmup', theme });
  } catch {
    void warmupHighlight(theme);
  }
}

/** 仅供测试：重置模块级状态（Worker 单例与未完成请求） */
export function __resetRenderWorkerForTest(): void {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  if (worker) worker.terminate();
  worker = null;
  unavailable = false;
  seq = 0;
}
