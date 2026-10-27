/**
 * Agent 链路细粒度测试的公共桩（L1~L6 共用）。
 *
 * 原则：所有 LLM / 第三方服务调用一律通过注入的 fetch 桩完成，
 * 测试运行期间不产生任何真实网络请求。
 */

import type { AgentEvent, FetchLike, ResponseLike } from '../../src/agent/llm';
import type { JsonFetch, JsonResponse, ToolAgentEvent } from '../../src/agent/fc';
import { Vault } from '../../src/vault/vault';

const encoder = new TextEncoder();

/** 按「一行一个 chunk」产出字节流（SSE / NDJSON 通用） */
export function linesBody(lines: string[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const line of lines) yield encoder.encode(`${line}\n`);
    },
  };
}

/** 按任意切分点产出字节流，用于构造跨 chunk 的半行 */
export function rawBody(chunks: string[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield encoder.encode(c);
    },
  };
}

/** 把 JSON 文本行包成 OpenAI/Anthropic 的 SSE 形态，末尾补 [DONE] */
export function sse(jsons: string[], withDone = true): string[] {
  const lines = jsons.map((j) => `data: ${j}`);
  return withDone ? [...lines, 'data: [DONE]'] : lines;
}

/** 三篇笔记的固定语料：苹果→Alpha/Gamma，香蕉→Beta/Gamma */
export function seedVault(): Vault {
  const v = new Vault();
  v.upsert({ id: 'a', name: 'Alpha.md', content: '# Alpha\n苹果 的 笔记 内容' });
  v.upsert({ id: 'b', name: 'Beta.md', content: '# Beta\n香蕉 的 笔记 内容' });
  v.upsert({ id: 'c', name: 'Gamma.md', content: '# Gamma\n苹果 与 香蕉' });
  return v;
}

export interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: any;
}

/** 非流式（function-calling）fetch 桩：记录每次请求体，按序号回响应 */
export function jsonFetchMock(
  respond: (call: RecordedCall, index: number) => JsonResponse
): { fetch: JsonFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: JsonFetch = async (url, init) => {
    const call: RecordedCall = { url, headers: init.headers, body: JSON.parse(init.body) };
    calls.push(call);
    return respond(call, calls.length - 1);
  };
  return { fetch, calls };
}

/** 流式 fetch 桩：返回带 body 的响应 */
export function streamFetchMock(
  respond: (call: RecordedCall, index: number) => ResponseLike
): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: RecordedCall = { url, headers: init.headers, body: JSON.parse(init.body) };
    calls.push(call);
    return respond(call, calls.length - 1);
  };
  return { fetch, calls };
}

/** OpenAI 形态的最终答复（无工具调用） */
export function openaiTextResponse(content: string): JsonResponse {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
}

/** OpenAI 形态的单次工具调用 */
export function openaiToolResponse(
  name: string,
  args: Record<string, unknown>,
  id = 'c1'
): JsonResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
            ],
          },
        },
      ],
    }),
  };
}

export async function collectToolAgent(gen: AsyncGenerator<ToolAgentEvent>) {
  const events: ToolAgentEvent[] = [];
  let text = '';
  for await (const ev of gen) {
    events.push(ev);
    if (ev.type === 'delta') text += ev.text;
  }
  return { events, text };
}

export async function collectAgent(gen: AsyncGenerator<AgentEvent>) {
  const events: AgentEvent[] = [];
  let text = '';
  for await (const ev of gen) {
    events.push(ev);
    if (ev.type === 'delta') text += ev.text;
  }
  return { events, text };
}

export async function collectStream(gen: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const t of gen) out += t;
  return out;
}
