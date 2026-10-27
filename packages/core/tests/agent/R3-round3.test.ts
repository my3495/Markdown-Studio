/**
 * R3 系列——第三轮加固的回归锁定用例：
 * 流中断重试（未吐内容前可安全重放）、写工具幂等键、兜底文案注入（i18n）。
 */

import { describe, it, expect } from 'vitest';
import {
  EMPTY_RESPONSE_HINT,
  streamChat,
  type FetchLike,
  type ResponseLike,
} from '../../src/agent/llm';
import { runToolAgent } from '../../src/agent/fc';
import { createSandboxSession } from '../../src/agent/sandbox';
import { createVaultTools } from '../../src/agent/tools';
import {
  collectStream,
  collectToolAgent,
  jsonFetchMock,
  linesBody,
  openaiTextResponse,
  seedVault,
  streamFetchMock,
} from './_mocks';

const cfg = { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' };
const tools = () => createVaultTools(seedVault());

/** 造一个「先产出若干行、然后抛错」的流 */
function failingBody(lines: string[], error: Error): AsyncIterable<Uint8Array> {
  const enc = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      for (const l of lines) yield enc.encode(`${l}\n`);
      throw error;
    },
  };
}

/* ─────────── 残留风险 3：流中断重试 ─────────── */

describe('R20 流中断重试', () => {
  it('R20-01 尚未吐出内容就断流 → 自动重试并最终成功', async () => {
    let n = 0;
    const fetchImpl: FetchLike = async () => {
      n += 1;
      if (n === 1) {
        return { ok: true, status: 200, body: failingBody([], new Error('socket hang up')) } as ResponseLike;
      }
      const enc = new TextEncoder();
      return {
        ok: true,
        status: 200,
        body: {
          async *[Symbol.asyncIterator]() {
            yield enc.encode('data: {"choices":[{"delta":{"content":"恢复"}}]}\n');
            yield enc.encode('data: [DONE]\n');
          },
        },
      } as ResponseLike;
    };
    const out = await collectStream(
      streamChat(cfg, { messages: [] }, fetchImpl, { retries: 2, baseDelayMs: 1 })
    );
    expect(out).toBe('恢复');
    expect(n).toBe(2);
  });

  it('R20-02 已吐出内容后断流 → 不重试（无法回滚重放），直接上抛', async () => {
    let n = 0;
    const fetchImpl: FetchLike = async () => {
      n += 1;
      return {
        ok: true,
        status: 200,
        body: failingBody(
          ['data: {"choices":[{"delta":{"content":"已经输出"}}]}'],
          new Error('connection reset')
        ),
      } as ResponseLike;
    };
    await expect(
      collectStream(streamChat(cfg, { messages: [] }, fetchImpl, { retries: 2, baseDelayMs: 1 }))
    ).rejects.toThrow(/connection reset/);
    expect(n).toBe(1);
  });

  it('R20-03 断流重试耗尽后抛出原始错误', async () => {
    let n = 0;
    const fetchImpl: FetchLike = async () => {
      n += 1;
      return { ok: true, status: 200, body: failingBody([], new Error('always down')) } as ResponseLike;
    };
    await expect(
      collectStream(streamChat(cfg, { messages: [] }, fetchImpl, { retries: 2, baseDelayMs: 1 }))
    ).rejects.toThrow(/always down/);
    expect(n).toBe(3);
  });

  it('R20-04 断流重试同样触发 onRetry 回调', async () => {
    let n = 0;
    const seen: number[] = [];
    const fetchImpl: FetchLike = async () => {
      n += 1;
      if (n === 1) return { ok: true, status: 200, body: failingBody([], new Error('drop')) } as ResponseLike;
      const enc = new TextEncoder();
      return {
        ok: true,
        status: 200,
        body: {
          async *[Symbol.asyncIterator]() {
            yield enc.encode('data: [DONE]\n');
          },
        },
      } as ResponseLike;
    };
    await collectStream(
      streamChat(cfg, { messages: [] }, fetchImpl, {
        retries: 2,
        baseDelayMs: 1,
        onRetry: (i) => seen.push(i.attempt),
      })
    );
    expect(seen).toEqual([1]);
  });
});

/* ─────────── 残留风险 4：写工具幂等 ─────────── */

describe('R21 写工具幂等键', () => {
  it('R21-01 相同 idempotencyKey 的 append 只入队一次', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    const r1 = sb.tools.append_to_note({ id: 'a', text: 'X', idempotencyKey: 'k1' });
    const r2 = sb.tools.append_to_note({ id: 'a', text: 'X', idempotencyKey: 'k1' });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(sb.pending()).toHaveLength(1);
    expect(sb.pending()[0]!.after).toContain('X');
    // 内容只追加了一次（不是 XX）
    expect(sb.pending()[0]!.after!.split('X').length - 1).toBe(1);
  });

  it('R21-02 不同 key 的 append 正常各自生效', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    sb.tools.append_to_note({ id: 'a', text: 'X', idempotencyKey: 'k1' });
    sb.tools.append_to_note({ id: 'a', text: 'Y', idempotencyKey: 'k2' });
    const after = sb.pending()[0]!.after!;
    expect(after).toContain('X');
    expect(after).toContain('Y');
  });

  it('R21-03 不带幂等键时行为完全不变（不误伤）', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    sb.tools.append_to_note({ id: 'a', text: 'X' });
    sb.tools.append_to_note({ id: 'a', text: 'Y' });
    const after = sb.pending()[0]!.after!;
    expect(after).toContain('X');
    expect(after).toContain('Y');
  });

  it('R21-04 幂等对 write / delete 同样生效', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    sb.tools.write_note({ id: 'w', name: 'w.md', content: '1', idempotencyKey: 'kw' });
    sb.tools.write_note({ id: 'w', name: 'w.md', content: '1', idempotencyKey: 'kw' });
    expect(sb.pending()).toHaveLength(1);

    sb.tools.delete_note({ id: 'a', idempotencyKey: 'kd' });
    sb.tools.delete_note({ id: 'a', idempotencyKey: 'kd' });
    expect(sb.pending().filter((c) => c.op === 'delete')).toHaveLength(1);
  });

  it('R21-05 失败结果不被幂等缓存（便于重试）', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: false });
    const r = sb.tools.append_to_note({ id: 'a', text: 'X', idempotencyKey: 'k' });
    expect(r.ok).toBe(false);
    // 只读状态下再次调用仍返回错误，而不是把错误固化后放行
    expect(sb.tools.append_to_note({ id: 'a', text: 'X', idempotencyKey: 'k' }).ok).toBe(false);
  });
});

/* ─────────── 残留风险 5：兜底文案注入（i18n） ─────────── */

describe('R22 兜底文案注入', () => {
  it('R22-01 空响应提示可被上层覆盖（默认仍为内置中文）', async () => {
    const { fetch } = streamFetchMock(() => ({ ok: true, status: 200, body: linesBody([]) }));
    const run = async (hints?: { emptyResponse: string }) => {
      const { text } = await collectToolAgent(
        runToolAgent({
          cfg,
          tools: tools(),
          prompt: 'q',
          fetchImpl: jsonFetchMock(() => openaiTextResponse('')).fetch,
          streamFetch: fetch,
          hints,
        })
      );
      return text;
    };
    expect(await run()).toContain(EMPTY_RESPONSE_HINT);
    expect(await run({ emptyResponse: '[Model returned empty]' })).toContain('[Model returned empty]');
  });

  it('R22-02 失败提示可被上层覆盖（错误走 error 事件，不混 delta）', async () => {
    const mk = async (hints?: { callFailed: string }) => {
      const { fetch } = jsonFetchMock(() => {
        throw new Error('ECONNREFUSED');
      });
      const { events } = await collectToolAgent(
        runToolAgent({
          cfg,
          tools: tools(),
          prompt: 'q',
          fetchImpl: fetch,
          streamFinal: false,
          retry: { retries: 0, baseDelayMs: 1 },
          hints,
        })
      );
      return events.find((e) => e.type === 'error') as any;
    };
    // 错误走 error 事件，不混入 delta 文本；callFailed hints 在此路径已废弃
    const err1 = await mk({ callFailed: '[Call failed] ' });
    expect(err1).toBeDefined();
    expect(err1.message).toContain('ECONNREFUSED');
    const err2 = await mk();
    expect(err2).toBeDefined();
    expect(err2.message).toContain('ECONNREFUSED');
  });

  it('R22-03 最大步数提示可被上层覆盖', async () => {
    const { fetch } = jsonFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [{ id: 'c', type: 'function', function: { name: 'list_notes', arguments: '{}' } }],
            },
          },
        ],
      }),
    }));
    const { text } = await collectToolAgent(
      runToolAgent({
        cfg,
        tools: tools(),
        prompt: 'q',
        fetchImpl: fetch,
        streamFinal: false,
        maxSteps: 2,
        hints: { maxSteps: '[Max steps reached]' },
      })
    );
    expect(text).toContain('[Max steps reached]');
    expect(text).not.toContain('已达最大工具调用步数');
  });
});
