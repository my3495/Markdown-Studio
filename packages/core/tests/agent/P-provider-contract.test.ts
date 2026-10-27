/**
 * P 系列——provider 契约测试（离线）。
 *
 * 用「贴近真实文档」的响应样本回放，锁定三家 provider 的解析契约：
 * OpenAI chat.completions / Anthropic messages / Ollama api/chat。
 * 全部为桩数据，不产生任何网络请求；用于替代无法在此环境做的真实联调。
 */

import { describe, it, expect } from 'vitest';
import { parseToolsResponse, buildToolsRequest } from '../../src/agent/fc';
import { parseStreamLine, buildChatRequest, resolveEndpointKind } from '../../src/agent/llm';
import { parseUsageFromResponse } from '../../src/agent/tokens';
import { createVaultTools } from '../../src/agent/tools';
import { seedVault } from './_mocks';

const tools = () => createVaultTools(seedVault());

/* ─────────── OpenAI chat.completions 契约 ─────────── */

describe('P1 OpenAI 响应契约', () => {
  const openaiText = {
    id: 'chatcmpl-abc123',
    object: 'chat.completion',
    created: 1720000000,
    model: 'gpt-4o-mini-2024-07-18',
    choices: [
      { index: 0, message: { role: 'assistant', content: '答案在 Alpha.md。', refusal: null }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    system_fingerprint: 'fp_1',
  };

  const openaiTools = {
    id: 'chatcmpl-def456',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_xyz',
              type: 'function',
              function: { name: 'search', arguments: '{"query":"苹果","limit":5}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 },
  };

  it('P1-01 纯文本响应：content 与 usage 均正确解析', () => {
    const m = parseToolsResponse(openaiText, 'openai');
    expect(m.content).toBe('答案在 Alpha.md。');
    expect(m.toolCalls).toHaveLength(0);
    expect(parseUsageFromResponse(openaiText)).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
    });
  });

  it('P1-02 工具调用响应：content 为 null 时安全降级为空串', () => {
    const m = parseToolsResponse(openaiTools, 'openai');
    expect(m.content).toBe('');
    expect(m.toolCalls[0]).toMatchObject({ id: 'call_xyz', name: 'search' });
    expect(m.toolCalls[0]!.arguments).toEqual({ query: '苹果', limit: 5 });
  });

  it('P1-03 请求体符合 OpenAI 契约（model/messages/tools/stream）', () => {
    const req = buildToolsRequest({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk' }, [], tools());
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(req.headers.authorization).toBe('Bearer sk');
    const body = req.body as any;
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.stream).toBe(false);
    expect(body.tools[0]).toMatchObject({ type: 'function' });
    expect(body.tools[0].function).toHaveProperty('parameters');
  });

  it('P1-04 流式增量契约：delta.content 与 [DONE]', () => {
    expect(
      parseStreamLine('data: {"id":"x","choices":[{"index":0,"delta":{"content":"你"}}]}', 'openai')
    ).toEqual({ text: '你' });
    expect(parseStreamLine('data: [DONE]', 'openai')).toEqual({ done: true });
  });
});

/* ─────────── Anthropic messages 契约 ─────────── */

describe('P2 Anthropic 响应契约', () => {
  const anthropicText = {
    id: 'msg_01',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
    content: [{ type: 'text', text: '答案在 Alpha.md。' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 25 },
  };

  const anthropicToolUse = {
    id: 'msg_02',
    content: [
      { type: 'text', text: '我先检索一下。' },
      { type: 'tool_use', id: 'toolu_01', name: 'search', input: { query: '苹果' } },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 150, output_tokens: 40 },
  };

  it('P2-01 纯文本：拼接 content blocks 并解析 usage', () => {
    const m = parseToolsResponse(anthropicText, 'claude');
    expect(m.content).toBe('答案在 Alpha.md。');
    expect(m.toolCalls).toHaveLength(0);
    expect(parseUsageFromResponse(anthropicText)).toEqual({
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
    });
  });

  it('P2-02 tool_use：文本与工具调用同时存在时分别提取', () => {
    const m = parseToolsResponse(anthropicToolUse, 'claude');
    expect(m.content).toBe('我先检索一下。');
    expect(m.toolCalls[0]).toMatchObject({ id: 'toolu_01', name: 'search' });
    expect(m.toolCalls[0]!.arguments).toEqual({ query: '苹果' });
  });

  it('P2-03 请求体符合 Anthropic 契约（system 独立、x-api-key、input_schema）', () => {
    const req = buildToolsRequest(
      { provider: 'claude', model: 'claude-sonnet-4-5', apiKey: 'sk-ant' },
      [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }],
      tools()
    );
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('sk-ant');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    const body = req.body as any;
    expect(body.system).toBe('SYS');
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.tools[0]).toHaveProperty('input_schema');
  });

  it('P2-04 流式事件契约：content_block_start/delta/stop/message_stop', () => {
    expect(
      parseStreamLine(
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}',
        'claude'
      )
    ).toEqual({ text: '你' });
    expect(parseStreamLine('data: {"type":"message_stop"}', 'claude')).toEqual({ done: true });
  });
});

/* ─────────── Ollama api/chat 契约 ─────────── */

describe('P3 Ollama 响应契约', () => {
  const ollamaText = {
    model: 'qwen2.5',
    created_at: '2026-01-01T00:00:00Z',
    message: { role: 'assistant', content: '答案在 Alpha.md。' },
    done: true,
    prompt_eval_count: 42,
    eval_count: 17,
  };

  const ollamaTools = {
    model: 'qwen2.5',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'search', arguments: { query: '苹果' } } }],
    },
    done: true,
  };

  it('P3-01 纯文本：message.content + eval 计数', () => {
    const m = parseToolsResponse(ollamaText, 'ollama');
    expect(m.content).toBe('答案在 Alpha.md。');
    expect(m.toolCalls).toHaveLength(0);
    expect(parseUsageFromResponse(ollamaText)).toEqual({
      promptTokens: 42,
      completionTokens: 17,
      totalTokens: 59,
    });
  });

  it('P3-02 工具调用：arguments 为对象形态', () => {
    const m = parseToolsResponse(ollamaTools, 'ollama');
    expect(m.toolCalls[0]).toMatchObject({ name: 'search' });
    expect(m.toolCalls[0]!.arguments).toEqual({ query: '苹果' });
  });

  it('P3-03 请求体符合 Ollama 契约（/api/chat、无鉴权、options.temperature）', () => {
    const req = buildChatRequest(
      { provider: 'ollama', model: 'qwen2.5' },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 0.7 }
    );
    expect(req.url).toBe('http://localhost:11434/api/chat');
    expect(req.headers.authorization).toBeUndefined();
    expect((req.body as any).options.temperature).toBe(0.7);
    expect((req.body as any).stream).toBe(true);
  });

  it('P3-04 NDJSON 流式契约：done 标志', () => {
    expect(parseStreamLine('{"model":"qwen2.5","message":{"content":"x"},"done":false}', 'ollama')).toEqual({
      text: 'x',
      done: false,
    });
    expect(parseStreamLine('{"model":"qwen2.5","done":true}', 'ollama')).toEqual({ done: true });
  });
});

/* ─────────── OpenAI 兼容国产模型契约 ─────────── */

describe('P4 OpenAI 兼容 provider 路由', () => {
  const cases: [string, string][] = [
    ['deepseek', 'https://api.deepseek.com/v1/chat/completions'],
    ['qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
    ['glm', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
    ['kimi', 'https://api.moonshot.cn/v1/chat/completions'],
  ];

  it.each(cases)('P4-%s 路由到正确的兼容端点', (provider, url) => {
    const req = buildChatRequest({ provider, model: 'm', apiKey: 'k' }, { messages: [] });
    expect(req.url).toBe(url);
  });

  it('P4-05 兼容 provider 的响应按 OpenAI 形态解析', () => {
    const m = parseToolsResponse(
      { choices: [{ message: { content: 'deepseek 回答' } }], usage: { prompt_tokens: 5, completion_tokens: 6 } },
      'deepseek'
    );
    expect(m.content).toBe('deepseek 回答');
  });
});

/* ─────────── Ollama OpenAI 兼容模式 ─────────── */

describe('P5 Ollama + /v1 baseUrl 走 OpenAI 兼容协议', () => {
  it('P5-01 buildChatRequest 路由到 /chat/completions 而非 /api/chat', () => {
    const req = buildChatRequest(
      { provider: 'ollama', model: 'qwen2.5', baseUrl: 'http://localhost:11434/v1', apiKey: 'sk' },
      { messages: [{ role: 'user', content: 'hi' }] }
    );
    expect(req.url).toBe('http://localhost:11434/v1/chat/completions');
    expect((req.body as any).options).toBeUndefined();
    expect((req.headers as any).authorization).toBe('Bearer sk');
  });

  it('P5-02 buildToolsRequest 同样走 /chat/completions', () => {
    const tools = createVaultTools(seedVault());
    const req = buildToolsRequest(
      { provider: 'ollama', model: 'qwen2.5', baseUrl: 'http://localhost:11434/v1', apiKey: 'sk' },
      [],
      tools,
      { stream: true }
    );
    expect(req.url).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('P5-03 parseToolsResponse 按 OpenAI 形态解析（choices[0].message）', () => {
    const m = parseToolsResponse(
      {
        choices: [
          {
            message: {
              content: 'ollama-openai 回答',
              tool_calls: [{ id: 'c1', function: { name: 'search', arguments: '{"q":"苹果"}' } }],
            },
          },
        ],
      },
      'ollama',
      'http://localhost:11434/v1'
    );
    expect(m.content).toBe('ollama-openai 回答');
    expect(m.toolCalls[0]).toMatchObject({ id: 'c1', name: 'search' });
    expect(m.toolCalls[0]!.arguments).toEqual({ q: '苹果' });
  });

  it('P5-04 不带 baseUrl 时回退到原生 /api/chat', () => {
    const req = buildChatRequest(
      { provider: 'ollama', model: 'qwen2.5' },
      { messages: [] }
    );
    expect(req.url).toBe('http://localhost:11434/api/chat');
  });

  it('P5-05 resolveEndpointKind 探测规则', () => {
    expect(resolveEndpointKind({ provider: 'ollama', model: 'm' })).toBe('native');
    expect(resolveEndpointKind({ provider: 'ollama', model: 'm', baseUrl: 'http://h:11434' })).toBe('native');
    expect(resolveEndpointKind({ provider: 'ollama', model: 'm', baseUrl: 'http://h:11434/v1' })).toBe('openai-compat');
    expect(resolveEndpointKind({ provider: 'ollama', model: 'm', baseUrl: 'http://h:11434/v1/' })).toBe('openai-compat');
    expect(resolveEndpointKind({ provider: 'openai', model: 'm', baseUrl: 'http://h/v1' })).toBe('native');
  });
});
