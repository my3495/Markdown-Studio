import { describe, it, expect } from 'vitest';
import {
  buildChatRequest,
  isAbortError,
  normalizeAbortError,
  parseStreamLine,
  streamChat,
  runAgent,
  type FetchLike,
  type ResponseLike,
} from '../src/agent/llm';

function sseBody(lines: string[]): AsyncIterable<Uint8Array> {
  const enc = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      for (const l of lines) yield enc.encode(l + '\n');
    },
  };
}

describe('buildChatRequest', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }];

  it('ollama → /api/chat，无鉴权头，stream=true', () => {
    const req = buildChatRequest({ provider: 'ollama', model: 'qwen2.5' }, { messages });
    expect(req.url.endsWith('/api/chat')).toBe(true);
    expect(req.headers.authorization).toBeUndefined();
    expect((req.body as any).stream).toBe(true);
    expect((req.body as any).model).toBe('qwen2.5');
  });

  it('openai → /chat/completions，Bearer 头', () => {
    const req = buildChatRequest(
      { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' },
      { messages }
    );
    expect(req.url.endsWith('/chat/completions')).toBe(true);
    expect(req.headers.authorization).toBe('Bearer sk-test');
  });

  it('claude → /v1/messages，x-api-key，system 分离', () => {
    const req = buildChatRequest(
      { provider: 'claude', model: 'claude-sonnet-4-5', apiKey: 'sk-ant' },
      {
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
      }
    );
    expect(req.url.endsWith('/v1/messages')).toBe(true);
    expect(req.headers['x-api-key']).toBe('sk-ant');
    expect((req.body as any).system).toBe('sys');
    expect((req.body as any).messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});

describe('parseStreamLine', () => {
  it('OpenAI SSE：增量文本 / [DONE] / 坏行', () => {
    expect(parseStreamLine('data: {"choices":[{"delta":{"content":"hi"}}]}', 'openai')).toEqual({
      text: 'hi',
    });
    expect(parseStreamLine('data: [DONE]', 'openai')).toEqual({ done: true });
    expect(parseStreamLine('data: {bad', 'openai')).toBeNull();
  });

  it('Ollama NDJSON：message.content / done', () => {
    expect(parseStreamLine('{"message":{"content":"x"},"done":false}', 'ollama')).toEqual({
      text: 'x',
      done: false,
    });
    expect(parseStreamLine('{"done":true}', 'ollama')).toEqual({ done: true });
  });

  it('Anthropic SSE：text_delta / message_stop', () => {
    expect(
      parseStreamLine(
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}',
        'claude'
      )
    ).toEqual({ text: '你好' });
    expect(parseStreamLine('data: {"type":"message_stop"}', 'claude')).toEqual({ done: true });
  });
});

describe('streamChat', () => {
  const collect = async (gen: AsyncGenerator<string>) => {
    let out = '';
    for await (const t of gen) out += t;
    return out;
  };

  it('聚合 OpenAI SSE 增量', async () => {
    const fetchImpl: FetchLike = async () =>
      ({
        ok: true,
        body: sseBody([
          'data: {"choices":[{"delta":{"content":"你好"}}]}',
          'data: {"choices":[{"delta":{"content":"，世界"}}]}',
          'data: [DONE]',
        ]),
      }) as ResponseLike;
    const out = await collect(
      streamChat({ provider: 'openai', model: 'm', apiKey: 'k' }, { messages: [] }, fetchImpl)
    );
    expect(out).toBe('你好，世界');
  });

  it('非 2xx 抛错', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 401, body: null, text: async () => 'no' });
    await expect(
      collect(streamChat({ provider: 'openai', model: 'm', apiKey: 'k' }, { messages: [] }, fetchImpl))
    ).rejects.toThrow(/401/);
  });
});

describe('runAgent', () => {
  it('先检索后流式生成，事件序列 retrieve→delta→done', async () => {
    const fetchImpl: FetchLike = async () =>
      ({
        ok: true,
        body: sseBody(['data: {"choices":[{"delta":{"content":"答案"}}]}', 'data: [DONE]']),
      }) as ResponseLike;
    const events: string[] = [];
    let text = '';
    for await (const ev of runAgent({
      cfg: { provider: 'openai', model: 'm', apiKey: 'k' },
      prompt: '苹果',
      retrieve: () => ({ context: '苹果在 Alpha.md', trace: [{ tool: 'search', ok: true, summary: '1' }] }),
      fetchImpl,
    })) {
      events.push(ev.type);
      if (ev.type === 'delta') text += ev.text;
    }
    expect(events).toContain('retrieve');
    expect(events).toContain('delta');
    expect(events.at(-1)).toBe('done');
    expect(text).toBe('答案');
  });

  it('把历史对话插入 system 与本轮提问之间', async () => {
    const bodies: any[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return {
        ok: true,
        body: sseBody(['data: {"choices":[{"delta":{"content":"答"}}]}', 'data: [DONE]']),
      } as ResponseLike;
    };
    for await (const ev of runAgent({
      cfg: { provider: 'openai', model: 'm', apiKey: 'k' },
      prompt: '第二问',
      retrieve: () => ({ context: '资料', trace: [] }),
      history: [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '第一答' },
      ],
      fetchImpl,
    })) {
      void ev;
    }
    const msgs = bodies[0].messages;
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs[1].content).toBe('第一问');
    expect(msgs[2].content).toBe('第一答');
    expect(msgs.at(-1).content).toContain('第二问');
  });

  it('LLM 失败回退本地资料', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 500, body: null, text: async () => '' });
    let text = '';
    for await (const ev of runAgent({
      cfg: { provider: 'openai', model: 'm' },
      prompt: 'x',
      retrieve: () => ({ context: '本地资料ABC', trace: [] }),
      fetchImpl,
    })) {
      if (ev.type === 'delta') text += ev.text;
    }
    expect(text).toContain('本地资料ABC');
    expect(text).toContain('LLM 调用失败');
  });
});

/* ─────────────── 主动取消的判定（回归：user_cancelled 被误报为模型失败） ─────────────── */

describe('isAbortError', () => {
  it('识别 DOMException AbortError', () => {
    const e = new DOMException('aborted', 'AbortError');
    expect(isAbortError(e)).toBe(true);
  });

  it('识别 Error(name=AbortError)', () => {
    const e = new Error('x');
    e.name = 'AbortError';
    expect(isAbortError(e)).toBe(true);
  });

  it('识别 abort(reason) 传字符串时的拒绝值', () => {
    // AbortController.abort('user_cancelled') 会让 fetch 以字符串拒绝
    expect(isAbortError('user_cancelled')).toBe(true);
    expect(isAbortError('aborted')).toBe(true);
    expect(isAbortError('timeout')).toBe(true);
  });

  it('不把真实错误误判为取消', () => {
    expect(isAbortError(new Error('network down'))).toBe(false);
    expect(isAbortError('LLM 请求失败 status=500')).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe('normalizeAbortError', () => {
  it('把字符串 reason 归一化为标准 AbortError', () => {
    const out = normalizeAbortError('user_cancelled');
    expect(out).toBeInstanceOf(DOMException);
    expect((out as DOMException).name).toBe('AbortError');
  });
});

describe('取消不被当作模型失败', () => {
  it('streamChat 收到字符串 reason 的取消时抛出 AbortError 而非普通错误', async () => {
    const fetchImpl: FetchLike = async () => {
      throw 'user_cancelled';
    };
    let caught: unknown;
    try {
      for await (const _ of streamChat(
        { provider: 'openai', model: 'm', apiKey: 'k' },
        { messages: [{ role: 'user', content: 'hi' }] },
        fetchImpl,
        { retries: 2 }
      )) {
        /* drain */
      }
    } catch (e) {
      caught = e;
    }
    // 关键：必须是标准 AbortError，而不是 "user_cancelled" 字符串
    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe('AbortError');
  });

  it('runAgent 遇到取消时直接上抛，不产出"LLM 调用失败"回退正文', async () => {
    const fetchImpl: FetchLike = async () => {
      throw 'user_cancelled';
    };
    const events: string[] = [];
    let threw = false;
    try {
      for await (const ev of runAgent({
        cfg: { provider: 'openai', model: 'm', apiKey: 'k' },
        prompt: 'x',
        retrieve: () => ({ context: '资料', trace: [] }),
        fetchImpl,
      })) {
        if (ev.type === 'delta') events.push(ev.text);
      }
    } catch (e) {
      threw = isAbortError(e);
    }
    expect(threw).toBe(true);
    expect(events.join('')).not.toContain('LLM 调用失败');
  });
});
