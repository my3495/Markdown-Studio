/**
 * 渲染 Worker（ADR-01）。
 *
 * 单次 `render()` 对 320 块 / 2241 节点的文档约 200ms —— 留在主线程时，
 * 每次输入都会排出一个 200ms+ 的长任务，打字明显掉帧。放到这里后主线程只剩 commit。
 *
 * 消息协议见 `platform/render-offthread.ts`：
 *   { id, kind: 'render', content, opts }  → { id, ok, result | error }
 *   { id, kind: 'warmup', theme }          → { id, ok }（预热结果不参与业务）
 *
 * core 用**动态 import**：静态 import 一旦在模块求值阶段抛错，Worker 只能在 onerror 里
 * 拿到一个没有堆栈的 ErrorEvent，dev 下极难定位（首次接入时就踩到过
 * `ReferenceError: document is not defined`）。改成动态加载后可以把完整堆栈回传主线程。
 */
type CoreModule = typeof import('@md-studio/core/worker');

interface RenderRequest {
  id: number;
  kind: 'render';
  content: string;
  opts: Parameters<CoreModule['render']>[1];
}

interface WarmupRequest {
  id: number;
  kind: 'warmup';
  theme: 'light' | 'dark';
}

// 不能叫 Request：与 DOM lib 的 Request 全局类型冲突
type WorkerIncoming = RenderRequest | WarmupRequest;

// 不引用 DedicatedWorkerGlobalScope 类型：会与 tsconfig 的 DOM lib 冲突，
// 这里只用到 postMessage/onmessage 两个成员。
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerIncoming>) => void) | null;
  postMessage: (message: unknown) => void;
};

let corePromise: Promise<CoreModule> | null = null;

function loadCore(): Promise<CoreModule> {
  if (!corePromise) {
    corePromise = import('@md-studio/core/worker').catch((e: unknown) => {
      ctx.postMessage({
        id: -1,
        ok: false,
        stage: 'import',
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      });
      throw e;
    });
  }
  return corePromise;
}

ctx.onmessage = (event: MessageEvent<WorkerIncoming>) => {
  const req = event.data;
  if (!req || typeof req.id !== 'number') return;

  if (req.kind === 'warmup') {
    void loadCore()
      .then((core) => core.warmupHighlight(req.theme))
      .catch(() => undefined)
      .then(() => ctx.postMessage({ id: req.id, ok: true }));
    return;
  }

  // 逐条处理、不丢任务。
  // 曾试过「覆盖式槽位 + 单飞循环」（只保留最新任务），实测反而更慢：
  // 主线程仍会为每次渲染付一次结构化克隆，而被丢掉的那次渲染的 CPU 也照付，
  // 最终表现为追平延迟反而上升。主线程侧已有尾随合并 + seq 丢弃，
  // 请求本身不会密集到达，这里保持简单的串行语义即可。
  void (async () => {
    const core = await loadCore();
    // RenderResult 的 hast 设计为纯 JSON（见 core/src/types.ts），可结构化克隆；
    // 不能传 transferable —— hast 是普通对象树。
    const result = await core.render(req.content, req.opts);
    ctx.postMessage({ id: req.id, ok: true, result });
  })().catch((e: unknown) => {
    ctx.postMessage({
      id: req.id,
      ok: false,
      stage: 'render',
      error: e instanceof Error ? (e.stack ?? e.message) : String(e),
    });
  });
};
