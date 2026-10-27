/**
 * L3 提示词组装：system/user 组装顺序、systemPrompt 覆盖、
 * provider 路由（URL/鉴权头/baseUrl 归一化）、未知 provider 与缺 key 的降级。
 */

import { describe, it, expect } from 'vitest';
import { buildChatRequest, runAgent, type FetchLike, type ResponseLike } from '../../src/agent/llm';
import { buildToolsRequest, runToolAgent } from '../../src/agent/fc';
import { createVaultTools } from '../../src/agent/tools';
import {
  collectAgent,
  collectToolAgent,
  jsonFetchMock,
  linesBody,
  openaiTextResponse,
  seedVault,
  streamFetchMock,
} from './_mocks';

const cfg = { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' };
const tools = () => createVaultTools(seedVault());

describe('L3-1 消息组装', () => {
  it('L3-01 runAgent：system → history → user，资料为空时注入（无）', async () => {
    const { fetch, calls } = streamFetchMock(() => ({
      ok: true,
      status: 200,
      body: linesBody(['data: {"choices":[{"delta":{"content":"x"}}]}', 'data: [DONE]']),
    }));
    await collectAgent(
      runAgent({
        cfg,
        prompt: '问题？',
        retrieve: () => ({ context: '', trace: [] }),
        history: [{ role: 'user', content: '上一问' }],
        fetchImpl: fetch,
      })
    );
    const msgs = calls[0]!.body.messages;
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'user']);
    expect(msgs.at(-1).content).toContain('（无）');
    expect(msgs.at(-1).content).toContain('问题？');
  });

  it('L3-02 runAgent：自定义 systemPrompt 覆盖默认', async () => {
    const { fetch, calls } = streamFetchMock(() => ({
      ok: true,
      status: 200,
      body: linesBody(['data: [DONE]']),
    }));
    await collectAgent(
      runAgent({
        cfg,
        prompt: 'p',
        retrieve: () => ({ context: '', trace: [] }),
        systemPrompt: 'CUSTOM-SYS',
        fetchImpl: fetch,
      })
    );
    expect(calls[0]!.body.messages[0].content).toBe('CUSTOM-SYS');
  });

  it('L3-03 runToolAgent：自定义 systemPrompt 生效且位于首位', async () => {
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    await collectToolAgent(
      runToolAgent({
        cfg,
        tools: tools(),
        prompt: 'q',
        systemPrompt: 'TOOL-SYS',
        fetchImpl: fetch,
        streamFinal: false,
      })
    );
    const msgs = calls[0]!.body.messages;
    expect(msgs[0]).toEqual({ role: 'system', content: 'TOOL-SYS' });
    expect(msgs.at(-1)).toEqual({ role: 'user', content: 'q' });
  });

  it('L3-04 runToolAgent：无 history 时仅 system + 本轮提问', async () => {
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    expect(calls[0]!.body.messages).toHaveLength(2);
  });

  it('L3-05 组装后的请求体携带 tools 声明', async () => {
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    expect(calls[0]!.body.tools).toHaveLength(9);
  });
});

describe('L3-2 provider 路由', () => {
  it('L3-06 ollama → /api/chat，不带鉴权头', () => {
    const req = buildToolsRequest(
      { provider: 'ollama', model: 'qwen2.5' },
      [],
      tools(),
      { stream: false }
    );
    expect(req.url).toBe('http://localhost:11434/api/chat');
    expect(req.headers.authorization).toBeUndefined();
  });

  it('L3-07 claude → /v1/messages + x-api-key + system 分离', () => {
    const req = buildToolsRequest(
      { provider: 'claude', model: 'claude-sonnet-4-5', apiKey: 'sk-ant' },
      [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }],
      tools()
    );
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('sk-ant');
    expect((req.body as any).system).toBe('SYS');
  });

  it('L3-08 自定义 baseUrl 覆盖默认且尾斜杠归一化', () => {
    const req = buildChatRequest(
      { provider: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://gw.example.com/v1///' },
      { messages: [{ role: 'user', content: 'hi' }] }
    );
    expect(req.url).toBe('https://gw.example.com/v1/chat/completions');
  });

  it('L3-09 未知 provider 应给出可诊断的端点或明确报错', () => {
    // 修复前会产出相对 URL '/chat/completions'，浏览器/Node 都无法请求且错误信息不可诊断
    expect(() =>
      buildToolsRequest({ provider: 'no-such-provider', model: 'm', apiKey: 'k' }, [], tools())
    ).toThrow(/baseUrl/);
  });

  it('L3-10 custom provider 未配置 baseUrl 时同上', () => {
    expect(() =>
      buildChatRequest({ provider: 'custom', model: 'm', apiKey: 'k' }, { messages: [] })
    ).toThrow(/baseUrl/);
  });

  it('L3-11 缺失 apiKey（needsKey provider）应提前报错而非发出无鉴权请求', async () => {
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    const { events } = await collectToolAgent(
      runToolAgent({
        cfg: { provider: 'openai', model: 'm' },
        tools: tools(),
        prompt: 'q',
        fetchImpl: fetch,
        streamFinal: false,
      })
    );
    const errEv = events.find((e) => e.type === 'error') as { message?: string } | undefined;
    expect(errEv?.message).toMatch(/缺少 apiKey/);
    expect(calls.length).toBe(0);
    expect(events.at(-1)!.type).toBe('done');
  });

  it('L3-12 有 apiKey 时注入 Bearer 头', () => {
    const req = buildChatRequest(cfg, { messages: [] });
    expect(req.headers.authorization).toBe('Bearer sk-test');
  });
});

describe('L3-3 上下文注入', () => {
  it('L3-13 检索资料拼接进 user 消息', async () => {
    const { fetch, calls } = streamFetchMock(() => ({
      ok: true,
      status: 200,
      body: linesBody(['data: [DONE]']),
    }));
    await collectAgent(
      runAgent({
        cfg,
        prompt: '问',
        retrieve: () => ({ context: '资料ABC', trace: [] }),
        fetchImpl: fetch,
      })
    );
    const last = calls[0]!.body.messages.at(-1).content as string;
    expect(last).toContain('问题：问');
    expect(last).toContain('资料ABC');
  });

  it('L3-14 流式开关随 provider 正确透传', async () => {
    const fetchImpl: FetchLike = async () =>
      ({ ok: true, status: 200, body: linesBody(['data: [DONE]']) }) as ResponseLike;
    const seen: boolean[] = [];
    const spy: FetchLike = async (url, init) => {
      seen.push(JSON.parse(init.body).stream);
      return fetchImpl(url, init);
    };
    await collectAgent(
      runAgent({ cfg, prompt: 'p', retrieve: () => ({ context: '', trace: [] }), fetchImpl: spy })
    );
    expect(seen).toEqual([true]);
  });
});
