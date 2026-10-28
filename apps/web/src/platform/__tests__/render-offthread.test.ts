// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@md-studio/core';

/**
 * 渲染 Worker 调度：重点是「任何失败都必须回退主线程」，
 * 否则一次 Worker 异常就会让预览永久空白。
 */

type Msg = { id: number; kind: string; content?: string; opts?: Record<string, unknown> };

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  async postMessage(msg: Msg): Promise<void> {
    if (msg.kind === 'warmup') {
      this.onmessage?.({ data: { id: msg.id, ok: true } });
      return;
    }
    const result = await render(msg.content ?? '', (msg.opts ?? {}) as never);
    this.onmessage?.({ data: { id: msg.id, ok: true, result } });
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** 每次 postMessage 都触发 onerror：模拟 Worker 脚本加载失败 */
class BrokenWorker extends FakeWorker {
  async postMessage(): Promise<void> {
    this.onerror?.();
  }
}

beforeEach(() => {
  vi.resetModules();
  FakeWorker.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renderMarkdown（Worker 调度）', () => {
  it('无 Worker 环境（node / jsdom）回退主线程渲染', async () => {
    expect(typeof Worker).toBe('undefined');
    const { renderMarkdown } = await import('../render-offthread');

    const r = await renderMarkdown('# 标题\n\n正文 **加粗**', {});
    expect(r.toc.map((t) => t.text)).toEqual(['标题']);
    expect(r.hast.type).toBe('root');
    expect(r.words).toBeGreaterThan(0);
  });

  it('有 Worker 时经消息往返取结果，且复用同一个实例', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { renderMarkdown } = await import('../render-offthread');

    const [a, b] = await Promise.all([renderMarkdown('# 甲', {}), renderMarkdown('# 乙', {})]);
    expect(a.toc[0]?.text).toBe('甲');
    expect(b.toc[0]?.text).toBe('乙');
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('Worker 抛错时在途请求改走主线程（预览不空白）', async () => {
    vi.stubGlobal('Worker', BrokenWorker);
    const { renderMarkdown } = await import('../render-offthread');

    const r = await renderMarkdown('# 兜底\n\n正文', {});
    expect(r.toc[0]?.text).toBe('兜底');
    expect(r.hast.type).toBe('root');
  });

  it('Worker 判死后不再重复创建实例', async () => {
    vi.stubGlobal('Worker', BrokenWorker);
    const { renderMarkdown } = await import('../render-offthread');

    await renderMarkdown('a', {});
    await renderMarkdown('b', {});
    expect(BrokenWorker.instances).toHaveLength(1);
  });

  it('warmup 投递到 Worker 且不抛错', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { warmupRender } = await import('../render-offthread');

    expect(() => warmupRender('dark')).not.toThrow();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('无 Worker 时 warmup 退回主线程预热', async () => {
    const { warmupRender } = await import('../render-offthread');
    expect(() => warmupRender('light')).not.toThrow();
  });
});
