/**
 * L6 结果输出与异常处理：流式聚合、工具调用增量、外部依赖失败降级、
 * 错误可诊断性、工具结果摘要。
 */

import { describe, it, expect } from 'vitest';
import { runAgent, streamChat, type FetchLike, type ResponseLike } from '../../src/agent/llm';
import { runToolAgent } from '../../src/agent/fc';
import { createVaultTools } from '../../src/agent/tools';
import {
  collectAgent,
  collectStream,
  collectToolAgent,
  jsonFetchMock,
  linesBody,
  openaiTextResponse,
  openaiToolResponse,
  seedVault,
  sse,
  streamFetchMock,
} from './_mocks';

const cfg = { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' };
const tools = () => createVaultTools(seedVault());

describe('L6-1 流式输出聚合', () => {
  it('L6-01 多段 delta 拼接为完整答复并以 done 收尾', async () => {
    const { fetch } = streamFetchMock(() => ({
      ok: true,
      status: 200,
      body: linesBody(
        sse([
          '{"choices":[{"delta":{"content":"你好"}}]}',
          '{"choices":[{"delta":{"content":"，世界"}}]}',
        ])
      ),
    }));
    const { events, text } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: jsonFetchMock(() => openaiTextResponse('')).fetch, streamFetch: fetch })
    );
    expect(text).toBe('你好，世界');
    expect(events.at(-1)!.type).toBe('done');
  });

  it('L6-02 OpenAI 流式工具调用分片累积为完整参数', async () => {
    const { fetch } = streamFetchMock((_c, i) => {
      if (i === 0) {
        return {
          ok: true,
          status: 200,
          body: linesBody(
            sse([
              '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"search","arguments":""}}]}}]}',
              '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\""}}]}}]}',
              '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"苹果\\"}"}}]}}]}',
            ])
          ),
        };
      }
      return {
        ok: true,
        status: 200,
        body: linesBody(sse(['{"choices":[{"delta":{"content":"找到了 Alpha"}}]}'])),
      };
    });
    const { events, text } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: jsonFetchMock(() => openaiTextResponse('')).fetch, streamFetch: fetch })
    );
    const toolEv = events.find((e) => e.type === 'tool') as any;
    expect(toolEv.name).toBe('search');
    expect(toolEv.args).toEqual({ query: '苹果' });
    expect(text).toContain('Alpha');
  });

  it('L6-03 Anthropic 流式 tool_use 累积为完整参数', async () => {
    const { fetch } = streamFetchMock((_c, i) => {
      if (i === 0) {
        return {
          ok: true,
          status: 200,
          body: linesBody(
            sse([
              '{"type":"content_block_start","content_block":{"type":"tool_use","id":"tu1","name":"search"}}',
              '{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"query\\":"}}',
              '{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"\\"苹果\\"}"}}',
              '{"type":"content_block_stop"}',
              '{"type":"message_stop"}',
            ], false)
          ),
        };
      }
      return {
        ok: true,
        status: 200,
        body: linesBody(sse(['{"type":"content_block_delta","delta":{"type":"text_delta","text":"结果"}}', '{"type":"message_stop"}'], false)),
      };
    });
    const { events } = await collectToolAgent(
      runToolAgent({
        cfg: { provider: 'claude', model: 'claude-sonnet-4-5', apiKey: 'sk-ant' },
        tools: tools(),
        prompt: 'q',
        fetchImpl: jsonFetchMock(() => openaiTextResponse('')).fetch,
        streamFetch: fetch,
      })
    );
    const toolEv = events.find((e) => e.type === 'tool') as any;
    expect(toolEv.name).toBe('search');
    expect(toolEv.args).toEqual({ query: '苹果' });
  });

  it('L6-03b Anthropic 流式 tool_use 截断 args → badToolFormat notice', async () => {
    const { fetch } = streamFetchMock((_c, i) => {
      if (i === 0) {
        return {
          ok: true,
          status: 200,
          body: linesBody(
            sse(
              [
                '{"type":"content_block_start","content_block":{"type":"tool_use","id":"t1","name":"search"},"index":0}',
                '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\": \\"苹果"}}',
                '{"type":"content_block_stop","index":0}',
                '{"type":"message_stop"}',
              ],
              false
            )
          ),
        };
      }
      throw new Error('unexpected call');
    });
    const { events } = await collectToolAgent(
      runToolAgent({
        cfg: { provider: 'claude', model: 'claude-sonnet-4-5', apiKey: 'sk-ant' },
        tools: tools(),
        prompt: 'q',
        fetchImpl: jsonFetchMock(() => openaiTextResponse('')).fetch,
        streamFetch: fetch,
      })
    );
    const toolEv = events.find((e) => e.type === 'tool') as any;
    expect(toolEv.name).toBe('search');
    // 截断时 arguments 兜底为空对象
    expect(toolEv.args).toEqual({});
    const notice = events.find((e) => e.type === 'notice' && e.code === 'badToolFormat') as any;
    expect(notice).toBeDefined();
    expect(notice.detail).toContain('search');
  });

  it('L6-04 Ollama NDJSON 流式工具调用', async () => {
    const { fetch } = streamFetchMock((_c, i) => {
      if (i === 0) {
        return {
          ok: true,
          status: 200,
          body: linesBody([
            '{"message":{"tool_calls":[{"function":{"name":"search","arguments":{"query":"苹果"}}}]},"done":false}',
            '{"done":true}',
          ]),
        };
      }
      return { ok: true, status: 200, body: linesBody(['{"message":{"content":"答案"},"done":true}']) };
    });
    const { events } = await collectToolAgent(
      runToolAgent({
        cfg: { provider: 'ollama', model: 'qwen2.5' },
        tools: tools(),
        prompt: 'q',
        fetchImpl: jsonFetchMock(() => openaiTextResponse('')).fetch,
        streamFetch: fetch,
      })
    );
    const toolEv = events.find((e) => e.type === 'tool') as any;
    expect(toolEv.name).toBe('search');
    expect(toolEv.ok).toBe(true);
  });

  it('L6-05 流中出现 [DONE] 后停止解析', async () => {
    const fetchImpl: FetchLike = async () =>
      ({
        ok: true,
        status: 200,
        body: linesBody([
          'data: {"choices":[{"delta":{"content":"A"}}]}',
          'data: [DONE]',
          'data: {"choices":[{"delta":{"content":"B"}}]}',
        ]),
      }) as ResponseLike;
    expect(await collectStream(streamChat(cfg, { messages: [] }, fetchImpl))).toBe('A');
  });
});

describe('L6-2 外部依赖失败与降级', () => {
  it('L6-06 runAgent：LLM 失败回退本地检索资料', async () => {
    const fetchImpl: FetchLike = async () =>
      ({ ok: false, status: 500, body: null, text: async () => 'boom' }) as ResponseLike;
    const { text, events } = await collectAgent(
      runAgent({ cfg, prompt: '苹果', retrieve: () => ({ context: '本地资料ABC', trace: [] }), fetchImpl })
    );
    expect(text).toContain('LLM 调用失败');
    expect(text).toContain('本地资料ABC');
    expect(events.at(-1)!.type).toBe('done');
  });

  it('L6-07 runToolAgent：外部依赖失败应降级而非向上抛出', async () => {
    const { fetch } = jsonFetchMock(() => {
      throw new Error('ECONNREFUSED 127.0.0.1:11434');
    });
    const { events, text } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    // 错误走 error 事件，不混入 delta 文本
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect((err as any).message).toContain('ECONNREFUSED');
    expect(events.at(-1)!.type).toBe('done');
    expect(text.length).toBe(0); // 不再往 delta 里塞错误文本
  });

  it('L6-08 runAgent：retrieve 自身抛错应降级而非整体失败', async () => {
    const { fetch } = streamFetchMock(() => ({ ok: true, status: 200, body: linesBody(['data: [DONE]']) }));
    const { events } = await collectAgent(
      runAgent({
        cfg,
        prompt: 'q',
        retrieve: () => {
          throw new Error('index corrupt');
        },
        fetchImpl: fetch,
      })
    );
    expect(events.at(-1)!.type).toBe('done');
  });

  it('L6-09 响应 JSON 解析失败应包装为可诊断错误', async () => {
    const { fetch } = jsonFetchMock(() => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    }));
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    // 原始 SyntaxError 必须被包装成带状态码的 chat failed，而不是裸抛
    const errEv = events.find((e) => e.type === 'error') as { message?: string } | undefined;
    expect(errEv?.message).toMatch(/chat failed/);
    expect(errEv?.message).toMatch(/JSON 解析失败/);
  });

  it('L6-10 非 2xx 响应错误信息含状态码与响应片段', async () => {
    const { fetch } = jsonFetchMock(() => ({ ok: false, status: 401, text: async () => 'invalid api key' }));
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    const errEv = events.find((e) => e.type === 'error') as { message?: string } | undefined;
    expect(errEv?.message).toMatch(/401/);
    expect(errEv?.message).toMatch(/invalid api key/);
  });

  it('L6-11 响应结构异常（无 choices）应安全降级为空内容', async () => {
    const { fetch } = jsonFetchMock(() => ({ ok: true, status: 200, json: async () => ({}) }));
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    expect(events.at(-1)!.type).toBe('done');
  });

  it('L6-12 模型返回空响应（无内容无工具）应给出可识别提示', async () => {
    const { fetch } = streamFetchMock(() => ({ ok: true, status: 200, body: linesBody(sse([])) }));
    const { text } = await collectToolAgent(
      runToolAgent({
        cfg,
        tools: tools(),
        prompt: 'q',
        fetchImpl: jsonFetchMock(() => openaiTextResponse('')).fetch,
        streamFetch: fetch,
      })
    );
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

describe('L6-3 工具结果摘要 (summarize)', () => {
  it('L6-13 摘要覆盖数组 / note / name / 失败四类形态', async () => {
    const t = createVaultTools(seedVault(), { allowWrite: true });
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    { id: 't1', type: 'function', function: { name: 'search', arguments: '{"query":"苹果"}' } },
                    { id: 't2', type: 'function', function: { name: 'read_note', arguments: '{"id":"a"}' } },
                    { id: 't3', type: 'function', function: { name: 'write_note', arguments: '{"id":"w","name":"w.md","content":"x"}' } },
                    { id: 't4', type: 'function', function: { name: 'read_note', arguments: '{"id":"ghost"}' } },
                  ],
                },
              },
            ],
          }),
        };
      }
      return openaiTextResponse('完成');
    });
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: t, prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    const toolEvs = events.filter((e) => e.type === 'tool') as any[];
    expect(toolEvs).toHaveLength(4);
    expect(toolEvs[0].summary).toMatch(/项$/); // 数组 → N 项
    expect(toolEvs[1].summary).toBe('Alpha.md'); // { note } → note.name
    expect(toolEvs[2].summary).toBe('w.md'); // { id, name } → name
    expect(toolEvs[3].summary).toContain('not found'); // 失败 → error
  });

  it('L6-14 工具事件携带工具名与参数，可用于 UI 追溯', async () => {
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) return openaiToolResponse('search', { query: '苹果', limit: 5 });
      return openaiTextResponse('x');
    });
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    const ev = events.find((e) => e.type === 'tool') as any;
    expect(ev.name).toBe('search');
    expect(ev.args).toEqual({ query: '苹果', limit: 5 });
  });

  it('L6-15 done 事件始终作为最后一个事件产出', async () => {
    const { fetch } = jsonFetchMock(() => openaiTextResponse('ok'));
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    expect(events.at(-1)).toEqual({ type: 'done' });
  });
});
