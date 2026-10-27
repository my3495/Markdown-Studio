/**
 * R4 系列——真实风格 SSE/NDJSON 字节流回放。
 *
 * P 系列验证「单行解析契约」，本系列验证「字节传输层」：
 * 用贴近官方文档线格式的原始字节序列，经真实 ReadableStream（getReader 分支）
 * 与奇数字节分块（含多字节 UTF-8 中间断开）驱动 streamChat 全链路。
 * 全部为本地构造的桩字节，无任何网络请求。
 */

import { describe, it, expect } from 'vitest';
import { streamChat, toLines, type FetchLike, type ResponseLike } from '../../src/agent/llm';

/* ─────────── 构造真实风格的线格式字节 ─────────── */

/** OpenAI chat.completions 流式线格式（含心跳注释、CRLF、[DONE]） */
const openaiWire = [
  ': OPENAI heartbeat', // SSE 注释行（保活），解析器应忽略
  '',
  'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1720000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1720000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"苹果"},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1720000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"笔记在"},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1720000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Alpha.md。"},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1720000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  '',
  'data: [DONE]',
  '',
  '',
].join('\r\n'); // 真实服务端常见 CRLF 行尾

/** Anthropic messages 流式线格式（event: 行 + ping 事件混入） */
const anthropicWire = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_01","role":"assistant","content":[],"usage":{"input_tokens":100,"output_tokens":1}}}',
  '',
  'event: ping',
  'data: {"type":"ping"}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"苹果"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"笔记在"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Alpha.md。"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":25}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n');

/** Ollama /api/chat NDJSON 线格式（逐行一个 JSON 对象） */
const ollamaWire = [
  '{"model":"qwen2.5","created_at":"2026-01-01T00:00:00Z","message":{"role":"assistant","content":"苹果"},"done":false}',
  '{"model":"qwen2.5","created_at":"2026-01-01T00:00:01Z","message":{"role":"assistant","content":"笔记在"},"done":false}',
  '{"model":"qwen2.5","created_at":"2026-01-01T00:00:02Z","message":{"role":"assistant","content":"Alpha.md。"},"done":false}',
  '{"model":"qwen2.5","created_at":"2026-01-01T00:00:03Z","message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":42,"eval_count":17}',
  '',
].join('\n');

/* ─────────── 字节传输构造 ─────────── */

/** 按固定字节数切片（刻意用奇数尺寸，且会切断多字节 UTF-8 字符） */
function byteChunks(wire: string, size: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(wire);
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
}

/** 真实 ReadableStream（Node 18+ 全局可用；同时具备 getReader 与 asyncIterator） */
function realStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

/** 只暴露 getReader 的传输对象（强制走 chunksOf 的 ReadableStream 分支） */
function readerOnly(chunks: Uint8Array[]): { getReader: () => ReadableStreamDefaultReader<Uint8Array> } {
  return { getReader: () => realStream(chunks).getReader() };
}

function stubFetch(body: unknown): { fetchImpl: FetchLike; calls: number[] } {
  const calls: number[] = [];
  const fetchImpl: FetchLike = async () => {
    calls.push(1);
    return { ok: true, status: 200, body } as ResponseLike;
  };
  return { fetchImpl, calls };
}

const collect = async (gen: AsyncGenerator<string>) => {
  let text = '';
  for await (const piece of gen) text += piece;
  return text;
};

/* ─────────── R4 用例 ─────────── */

describe('R4-01 OpenAI 全链路回放（心跳/CRLF/[DONE]）', () => {
  it('拼接出完整增量文本，且只请求一次', async () => {
    const { fetchImpl, calls } = stubFetch(realStream(byteChunks(openaiWire, 64)));
    const text = await collect(
      streamChat({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk' }, { messages: [] }, fetchImpl, {
        retries: 2,
      })
    );
    expect(text).toBe('苹果笔记在Alpha.md。');
    expect(calls).toHaveLength(1);
  });
});

describe('R4-02 Anthropic 全链路回放（event: 行与 ping 混入）', () => {
  it('只提取 text_delta 文本，event:/ping/message_start 行被忽略', async () => {
    const { fetchImpl } = stubFetch(realStream(byteChunks(anthropicWire, 48)));
    const text = await collect(
      streamChat({ provider: 'claude', model: 'claude-sonnet-4-5', apiKey: 'sk-ant' }, { messages: [] }, fetchImpl)
    );
    expect(text).toBe('苹果笔记在Alpha.md。');
  });
});

describe('R4-03 Ollama NDJSON 回放', () => {
  it('逐行提取 message.content，done 行收尾', async () => {
    const { fetchImpl } = stubFetch(realStream(byteChunks(ollamaWire, 32)));
    const text = await collect(
      streamChat({ provider: 'ollama', model: 'qwen2.5' }, { messages: [] }, fetchImpl)
    );
    expect(text).toBe('苹果笔记在Alpha.md。');
  });
});

describe('R4-04 奇数字节分块不损坏多字节字符', () => {
  it.each([1, 3, 7, 13])('按 %i 字节切片回放中文增量无损', async (size) => {
    const { fetchImpl } = stubFetch(realStream(byteChunks(openaiWire, size)));
    const text = await collect(
      streamChat({ provider: 'openai', model: 'm', apiKey: 'sk' }, { messages: [] }, fetchImpl)
    );
    // 1 字节切片会把每个汉字拆成 3 个半字符 chunk，TextDecoder 流式模式必须正确重组
    expect(text).toBe('苹果笔记在Alpha.md。');
  });
});

describe('R4-05 getReader-only 传输分支', () => {
  it('仅有 getReader 的响应体同样可读', async () => {
    const { fetchImpl } = stubFetch(readerOnly(byteChunks(openaiWire, 96)));
    const text = await collect(
      streamChat({ provider: 'openai', model: 'm', apiKey: 'sk' }, { messages: [] }, fetchImpl)
    );
    expect(text).toBe('苹果笔记在Alpha.md。');
  });
});

describe('R4-06 噪声行容错（toLines 层）', () => {
  it('空行 / SSE 注释 / 坏 JSON / 半行残留均被安全忽略', async () => {
    const noisy = [
      ': keep-alive',
      '',
      'data: {"choices":[{"delta":{"content":"第一段"}}]}',
      'data: {bad json', // 坏行：parseStreamLine 返回 null
      '',
      'data: {"choices":[{"delta":{"content":"。"}}]}',
      'data: [DONE]',
    ].join('\n');
    const { fetchImpl } = stubFetch(realStream(byteChunks(noisy, 5)));
    const text = await collect(
      streamChat({ provider: 'openai', model: 'm', apiKey: 'sk' }, { messages: [] }, fetchImpl)
    );
    expect(text).toBe('第一段。');
  });
});

describe('R4-07 无终止标志时流自然收尾', () => {
  it('服务端直接关闭连接（无 [DONE]/done）不报错', async () => {
    const noTerminator = 'data: {"choices":[{"delta":{"content":"半句话"}}]}\n\n';
    const { fetchImpl } = stubFetch(realStream(byteChunks(noTerminator, 9)));
    const text = await collect(
      streamChat({ provider: 'openai', model: 'm', apiKey: 'sk' }, { messages: [] }, fetchImpl)
    );
    expect(text).toBe('半句话');
  });
});

describe('R4-08 toLines 跨 chunk 半行拼接（直接单测）', () => {
  it('一行被拆到多个 chunk 仍能完整输出', async () => {
    const line = 'data: {"choices":[{"delta":{"content":"跨块行"}}]}';
    const chunks = byteChunks(line + '\n', 4);
    const lines: string[] = [];
    for await (const l of toLines(realStream(chunks))) lines.push(l);
    expect(lines).toEqual([line]);
  });
});
