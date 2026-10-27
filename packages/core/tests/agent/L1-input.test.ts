/**
 * L1 输入解析：工具参数反序列化、空输入、超长输入、非法参数、缺失必填字段。
 * 全部使用注入桩，无真实网络请求。
 */

import { describe, it, expect } from 'vitest';
import { createVaultTools, excerptFor } from '../../src/agent/tools';
import { parseToolsResponse } from '../../src/agent/fc';
import { runAgent, streamChat, toLines, type FetchLike, type ResponseLike } from '../../src/agent/llm';
import { runToolAgent } from '../../src/agent/fc';
import {
  collectAgent,
  collectStream,
  collectToolAgent,
  jsonFetchMock,
  linesBody,
  openaiTextResponse,
  seedVault,
  streamFetchMock,
} from './_mocks';

const cfg = { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' };

describe('L1-1 工具参数反序列化 (safeParseArgs)', () => {
  it('L1-01 合法 JSON 字符串参数解析为对象', () => {
    const m = parseToolsResponse(
      {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'c1', function: { name: 'search', arguments: '{"query":"苹果","limit":5}' } },
              ],
            },
          },
        ],
      },
      'openai'
    );
    expect(m.toolCalls[0]!.arguments).toEqual({ query: '苹果', limit: 5 });
  });

  it('L1-02 非法 JSON 字符串参数回退为空对象，不抛错', () => {
    const m = parseToolsResponse(
      {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [{ id: 'c1', function: { name: 'search', arguments: '{"query":' } }],
            },
          },
        ],
      },
      'openai'
    );
    expect(m.toolCalls[0]!.arguments).toEqual({});
  });

  it('L1-03 参数为对象（Ollama 形态）直接透传', () => {
    const m = parseToolsResponse(
      { message: { content: '', tool_calls: [{ function: { name: 'search', arguments: { query: 'x' } } }] } },
      'ollama'
    );
    expect(m.toolCalls[0]!.arguments).toEqual({ query: 'x' });
  });

  it('L1-04 参数缺失 (undefined) 回退为空对象', () => {
    const m = parseToolsResponse(
      { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'list_notes' } }] } }] },
      'openai'
    );
    expect(m.toolCalls[0]!.arguments).toEqual({});
  });

  it('L1-05 参数为 null 回退为空对象', () => {
    const m = parseToolsResponse(
      { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'read_note', arguments: null } }] } }] },
      'openai'
    );
    expect(m.toolCalls[0]!.arguments).toEqual({});
  });

  it('L1-06 参数为数组不抛错（原样接受）', () => {
    const m = parseToolsResponse(
      { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'read_note', arguments: [1, 2] as any } }] } }] },
      'openai'
    );
    expect(m.toolCalls[0]!.arguments).toEqual([1, 2]);
  });
});

describe('L1-2 空输入', () => {
  it('L1-07 空 prompt 不应发起 LLM 请求（工具模式）', async () => {
    const tools = createVaultTools(seedVault());
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('x'));
    await expect(
      collectToolAgent(
        runToolAgent({ cfg, tools, prompt: '', fetchImpl: fetch, streamFinal: false })
      )
    ).rejects.toThrow(/prompt 为空/);
    expect(calls.length).toBe(0);
  });

  it('L1-08 空 prompt 不应发起 LLM 请求（检索增强模式）', async () => {
    const { fetch, calls } = streamFetchMock(() => ({
      ok: true,
      status: 200,
      body: linesBody(['data: {"choices":[{"delta":{"content":"x"}}]}', 'data: [DONE]']),
    }));
    await expect(
      collectAgent(
        runAgent({ cfg, prompt: '', retrieve: () => ({ context: '', trace: [] }), fetchImpl: fetch })
      )
    ).rejects.toThrow(/prompt 为空/);
    expect(calls.length).toBe(0);
  });

  it('L1-09 纯空白 prompt 应被判定为空', async () => {
    const tools = createVaultTools(seedVault());
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('x'));
    await expect(
      collectToolAgent(
        runToolAgent({ cfg, tools, prompt: '   \n\t  ', fetchImpl: fetch, streamFinal: false })
      )
    ).rejects.toThrow(/prompt 为空/);
    expect(calls.length).toBe(0);
  });
});

describe('L1-3 超长输入', () => {
  it('L1-10 超长 prompt 应被截断或拒绝（上下文预算保护）', async () => {
    const tools = createVaultTools(seedVault());
    const long = '啊'.repeat(200_000);
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    await collectToolAgent(
      runToolAgent({ cfg, tools, prompt: long, fetchImpl: fetch, streamFinal: false })
    );
    const sent = calls[0]!.body.messages.at(-1).content as string;
    expect(sent.length).toBeLessThanOrEqual(32_000);
  });

  it('L1-11 超长检索上下文应被截断（避免 provider 413 / 超窗）', async () => {
    const fetchImpl: FetchLike = async () =>
      ({
        ok: true,
        status: 200,
        body: linesBody(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']),
      }) as ResponseLike;
    let sent = '';
    const spy: FetchLike = async (url, init) => {
      sent = JSON.parse(init.body).messages.at(-1).content;
      return fetchImpl(url, init);
    };
    await collectAgent(
      runAgent({
        cfg,
        prompt: '问',
        retrieve: () => ({ context: '资'.repeat(200_000), trace: [] }),
        fetchImpl: spy,
      })
    );
    expect(sent.length).toBeLessThanOrEqual(32_000);
  });
});

describe('L1-4 非法参数 / 缺失必填字段', () => {
  it('L1-12 search 缺失必填 query 应报错而非静默返回空', () => {
    const tools = createVaultTools(seedVault());
    const r = tools.search({} as any);
    expect(r.ok).toBe(false);
  });

  it('L1-13 search limit 为负数不应吞掉命中结果', () => {
    const tools = createVaultTools(seedVault());
    const r = tools.search({ query: '苹果', limit: -1 });
    expect(r.ok).toBe(true);
    expect(r.data!.length).toBe(2);
  });

  it('L1-14 search limit 为 NaN 应回落默认值 20', () => {
    const tools = createVaultTools(seedVault());
    const r = tools.search({ query: '苹果', limit: Number('abc') });
    expect(r.ok).toBe(true);
    expect(r.data!.length).toBe(2);
  });

  it('L1-15 search limit=0 回落默认值且不抛错', () => {
    const tools = createVaultTools(seedVault());
    const r = tools.search({ query: '苹果', limit: 0 });
    // limit 必须为正整数；0 / 负数 / NaN 一律回落默认 20
    expect(r.ok).toBe(true);
    expect(r.data!.length).toBe(2);
  });

  it('L1-16 write_note 缺失 name 不应崩溃', () => {
    const tools = createVaultTools(seedVault(), { allowWrite: true });
    const r = tools.call('write_note', { content: 'x' });
    expect(r.ok).toBe(false);
  });

  it('L1-17 write_note 缺失 name 的错误信息应为可读的业务校验错误', () => {
    const tools = createVaultTools(seedVault(), { allowWrite: true });
    const r = tools.call('write_note', { content: 'x' });
    expect(String(r.error)).toMatch(/name|必填|required|missing/i);
  });

  it('L1-18 write_note 缺失 content 应被拒绝', () => {
    const tools = createVaultTools(seedVault(), { allowWrite: true });
    const r = tools.call('write_note', { name: 'x.md' });
    expect(r.ok).toBe(false);
  });

  it('L1-19 read_note 参数类型非法（id 为数字）应安全失败', () => {
    const tools = createVaultTools(seedVault());
    const r = tools.read_note({ id: 123 as any });
    expect(r.ok).toBe(false);
  });
});

describe('L1-5 流式输入解析边界', () => {
  it('L1-20 toLines 正确拼接被 chunk 切断的半行', async () => {
    const body = {
      async *[Symbol.asyncIterator]() {
        const enc = new TextEncoder();
        yield enc.encode('data: {"choices":[{"del');
        yield enc.encode('ta":{"content":"你"}}]}\n');
        yield enc.encode('data: [DONE]\n');
      },
    };
    const lines: string[] = [];
    for await (const l of toLines(body)) lines.push(l);
    expect(lines[0]).toBe('data: {"choices":[{"delta":{"content":"你"}}]}');
    expect(lines[1]).toBe('data: [DONE]');
  });

  it('L1-21 SSE 中出现坏 JSON 行应跳过而非中断', async () => {
    const fetchImpl: FetchLike = async () =>
      ({
        ok: true,
        status: 200,
        body: linesBody([
          'data: {bad json',
          'data: {"choices":[{"delta":{"content":"好"}}]}',
          'data: [DONE]',
        ]),
      }) as ResponseLike;
    const out = await collectStream(streamChat(cfg, { messages: [] }, fetchImpl));
    expect(out).toBe('好');
  });

  it('L1-22 响应体不是合法流（字符串）应报错而非静默空', async () => {
    const fetchImpl: FetchLike = async () =>
      ({ ok: true, status: 200, body: 'not-a-stream' }) as ResponseLike;
    await expect(collectStream(streamChat(cfg, { messages: [] }, fetchImpl))).rejects.toThrow();
  });

  it('L1-23 响应体为 null 应报错', async () => {
    const fetchImpl: FetchLike = async () =>
      ({ ok: true, status: 200, body: null, text: async () => '' }) as ResponseLike;
    await expect(collectStream(streamChat(cfg, { messages: [] }, fetchImpl))).rejects.toThrow();
  });
});

describe('L1-6 检索片段解析', () => {
  it('L1-24 excerptFor 空内容返回空串', () => {
    expect(excerptFor('', '苹果')).toBe('');
  });

  it('L1-25 excerptFor 空查询回退正文前两行', () => {
    expect(excerptFor('第一行\n第二行\n第三行', '   ')).toBe('第一行 第二行');
  });

  it('L1-26 excerptFor 超长片段截断到 max+1（含省略号）', () => {
    expect(excerptFor('x'.repeat(300), 'x')).toHaveLength(161);
  });
});
