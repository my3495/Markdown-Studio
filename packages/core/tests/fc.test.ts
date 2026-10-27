import { describe, it, expect } from 'vitest';
import { Vault } from '../src/vault/vault';
import { createVaultTools, excerptFor } from '../src/agent/tools';
import { toOpenAITools, toAnthropicTools } from '../src/agent/toolschema';
import {
  parseToolsResponse,
  buildToolsRequest,
  runToolAgent,
  toAnthropicMessages,
  type JsonFetch,
} from '../src/agent/fc';

function seedVault() {
  const v = new Vault();
  v.upsert({ id: 'a', name: 'Alpha.md', content: '# Alpha 苹果 笔记' });
  v.upsert({ id: 'b', name: 'Beta.md', content: '# Beta 香蕉' });
  return v;
}

describe('toolschema', () => {
  it('转换为 OpenAI function 工具（含 parameters）', () => {
    const tools = toOpenAITools(createVaultTools(seedVault()));
    expect(tools.length).toBe(9);
    const search = tools.find((t) => t.function.name === 'search')!;
    expect(search.type).toBe('function');
    expect(search.function.parameters).toHaveProperty('required');
  });
});

describe('parseToolsResponse', () => {
  it('OpenAI：解析 content 与 tool_calls', () => {
    const msg = parseToolsResponse(
      {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'search', arguments: '{"query":"苹果"}' } },
              ],
            },
          },
        ],
      },
      'openai'
    );
    expect(msg.toolCalls[0]).toMatchObject({ id: 'c1', name: 'search' });
    expect(msg.toolCalls[0]!.arguments).toEqual({ query: '苹果' });
  });

  it('Ollama：解析 message.tool_calls（arguments 为对象）', () => {
    const msg = parseToolsResponse(
      { message: { content: '', tool_calls: [{ function: { name: 'list_notes', arguments: {} } }] } },
      'ollama'
    );
    expect(msg.toolCalls[0]!.name).toBe('list_notes');
  });

  it('无工具调用时仅 content', () => {
    const msg = parseToolsResponse({ choices: [{ message: { content: '你好' } }] }, 'openai');
    expect(msg.content).toBe('你好');
    expect(msg.toolCalls).toHaveLength(0);
  });
});

describe('buildToolsRequest', () => {
  it('OpenAI → /chat/completions 且带 tools', () => {
    const tools = createVaultTools(seedVault());
    const req = buildToolsRequest({ provider: 'openai', model: 'm', apiKey: 'k' }, [], tools);
    expect(req.url.endsWith('/chat/completions')).toBe(true);
    expect((req.body as any).tools.length).toBe(9);
    expect((req.body as any).stream).toBe(false);
  });

  it('Claude → /v1/messages，x-api-key，Anthropic tools 形态', () => {
    const tools = createVaultTools(seedVault());
    const req = buildToolsRequest(
      { provider: 'claude', model: 'claude-sonnet-4-5', apiKey: 'sk-ant' },
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      tools
    );
    expect(req.url.endsWith('/v1/messages')).toBe(true);
    expect(req.headers['x-api-key']).toBe('sk-ant');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    expect((req.body as any).system).toBe('sys');
    expect((req.body as any).tools[0]).toHaveProperty('input_schema');
    expect((req.body as any).tools[0]).not.toHaveProperty('type');
  });
});

describe('Anthropic tools', () => {
  it('toAnthropicTools 含 input_schema', () => {
    const tools = toAnthropicTools(createVaultTools(seedVault()));
    expect(tools.length).toBe(9);
    expect(tools[0]).toMatchObject({ name: expect.any(String), input_schema: expect.anything() });
  });

  it('parseToolsResponse 解析 tool_use', () => {
    const msg = parseToolsResponse(
      {
        content: [
          { type: 'text', text: '' },
          { type: 'tool_use', id: 'tu1', name: 'search', input: { query: '苹果' } },
        ],
      },
      'claude'
    );
    expect(msg.toolCalls[0]).toMatchObject({ id: 'tu1', name: 'search' });
    expect(msg.toolCalls[0]!.arguments).toEqual({ query: '苹果' });
  });

  it('toAnthropicMessages 抽出 system', () => {
    const { system, messages } = toAnthropicMessages([
      { role: 'system', content: 'A' },
      { role: 'user', content: 'B' },
    ]);
    expect(system).toBe('A');
    expect(messages).toEqual([{ role: 'user', content: 'B' }]);
  });

  it('runToolAgent 走 Claude 一轮 tool 循环', async () => {
    const vault = seedVault();
    const tools = createVaultTools(vault);
    let call = 0;
    const fetchImpl: JsonFetch = async () => {
      call++;
      if (call === 1) {
        return {
          ok: true,
          json: async () => ({
            content: [{ type: 'tool_use', id: 'tu1', name: 'search', input: { query: '苹果' } }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'Alpha.md 含苹果。' }] }),
      };
    };
    let text = '';
    for await (const ev of runToolAgent({
      cfg: { provider: 'claude', model: 'm', apiKey: 'k' },
      tools,
      prompt: '苹果？',
      fetchImpl,
      streamFinal: false,
    })) {
      if (ev.type === 'delta') text += ev.text;
    }
    expect(call).toBe(2);
    expect(text).toContain('Alpha.md');
  });
});

describe('runToolAgent 循环', () => {
  it('模型先调 search，再据结果作答', async () => {
    const vault = seedVault();
    const tools = createVaultTools(vault);
    let call = 0;
    const fetchImpl: JsonFetch = async () => {
      call++;
      if (call === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    { id: 'c1', type: 'function', function: { name: 'search', arguments: '{"query":"苹果"}' } },
                  ],
                },
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Alpha.md 包含苹果。' } }] }) };
    };

    const events: string[] = [];
    let text = '';
    let sawTool = false;
    for await (const ev of runToolAgent({
      cfg: { provider: 'openai', model: 'm', apiKey: 'k' },
      tools,
      prompt: '哪些笔记讲苹果？',
      fetchImpl,
    })) {
      events.push(ev.type);
      if (ev.type === 'tool') sawTool = true;
      if (ev.type === 'delta') text += ev.text;
    }
    expect(sawTool).toBe(true);
    expect(call).toBe(2); // 一次工具调用 + 一次最终答复
    expect(events.at(-1)).toBe('done');
    expect(text).toContain('Alpha.md');
  });

  it('只读模式下模型调写工具被拦截（isError 事件）', async () => {
    const vault = seedVault();
    const tools = createVaultTools(vault); // 只读
    let call = 0;
    const fetchImpl: JsonFetch = async () => {
      call++;
      if (call === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              { message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_note', arguments: '{"name":"X","content":"y"}' } }] } },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: '无法写入（只读）。' } }] }) };
    };
    let toolOk: boolean | null = null;
    for await (const ev of runToolAgent({ cfg: { provider: 'openai', model: 'm', apiKey: 'k' }, tools, prompt: '写入', fetchImpl })) {
      if (ev.type === 'tool') toolOk = ev.ok;
    }
    expect(toolOk).toBe(false);
  });
});

describe('多轮上下文与检索片段', () => {
  it('runToolAgent 把历史对话按序送入模型', async () => {
    const tools = createVaultTools(seedVault());
    const bodies: any[] = [];
    const fetchImpl: JsonFetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: '好的' } }] }) };
    };

    const events: string[] = [];
    for await (const ev of runToolAgent({
      cfg: { provider: 'openai', model: 'm', apiKey: 'k' },
      tools,
      prompt: '第二问',
      history: [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '第一答' },
      ],
      fetchImpl,
    })) {
      events.push(ev.type);
    }

    const msgs = bodies[0].messages;
    expect(msgs.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(msgs[1].content).toBe('第一问');
    expect(msgs[2].content).toBe('第一答');
    expect(msgs.at(-1).content).toBe('第二问');
  });

  it('不带 history 时只有 system + 本轮提问', async () => {
    const tools = createVaultTools(seedVault());
    const bodies: any[] = [];
    const fetchImpl: JsonFetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: '好' } }] }) };
    };

    for await (const ev of runToolAgent({
      cfg: { provider: 'openai', model: 'm', apiKey: 'k' },
      tools,
      prompt: '唯一提问',
      fetchImpl,
    })) {
      void ev;
    }

    expect(bodies[0].messages).toHaveLength(2);
  });

  it('search 命中项带正文片段 snippet（可按查询词定位）', () => {
    const tools = createVaultTools(seedVault());
    const r = tools.search({ query: '苹果' });
    expect(r.ok).toBe(true);
    const hit = r.data![0]!;
    expect(hit.name).toContain('Alpha');
    expect(hit.snippet).toContain('苹果');
    expect(hit.snippet.length).toBeLessThanOrEqual(161);
  });

  it('excerptFor 无命中词时回退到正文开头并截断', () => {
    expect(excerptFor('第一行\n第二行\n第三行', '不存在的词')).toBe('第一行 第二行');
    expect(excerptFor('x'.repeat(300), 'x')).toHaveLength(161);
  });
});
