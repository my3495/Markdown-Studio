/**
 * R2 系列——第二轮加固的回归锁定用例。
 *
 * 覆盖首轮验证报告中「尚未覆盖的风险点」里可测的部分：
 * 畸形/乱序流式输入、REST 新分支、MCP 传输层、沙箱幂等、
 * 异步检索降级、重试与截断的可观测性、工具名增量去重。
 */

import { describe, it, expect } from 'vitest';
import { Vault } from '../../src/vault/vault';
import {
  MAX_PROMPT_CHARS,
  runAgent,
  streamChat,
  type FetchLike,
  type ResponseLike,
} from '../../src/agent/llm';
import { runToolAgent } from '../../src/agent/fc';
import { createVaultTools } from '../../src/agent/tools';
import { createSandboxSession } from '../../src/agent/sandbox';
import { createMcpServer } from '../../src/mcp/server';
import { handleHttp } from '../../src/mcp/http';
import { serveOverLines, type LineIO } from '../../src/mcp/stdio';
import { handleRest } from '../../src/rest/api';
import {
  collectAgent,
  collectStream,
  collectToolAgent,
  jsonFetchMock,
  linesBody,
  openaiTextResponse,
  seedVault,
  sse,
  streamFetchMock,
} from './_mocks';

const cfg = { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' };
const tools = () => createVaultTools(seedVault());

/* ───────── 风险 2：真实网络的畸形 / 乱序流式输入 ───────── */

describe('R15 流式输入健壮性', () => {
  const collect = async (lines: string[]) => {
    const fetchImpl: FetchLike = async () =>
      ({ ok: true, status: 200, body: linesBody(lines) }) as ResponseLike;
    return collectStream(streamChat(cfg, { messages: [] }, fetchImpl));
  };

  it('R15-01 SSE 心跳注释行（: ping）被忽略', async () => {
    expect(
      await collect([
        ': ping',
        'data: {"choices":[{"delta":{"content":"A"}}]}',
        ': ping',
        'data: [DONE]',
      ])
    ).toBe('A');
  });

  it('R15-02 缺少 data: 前缀的行被忽略', async () => {
    expect(
      await collect(['garbage', 'data: {"choices":[{"delta":{"content":"B"}}]}', 'data: [DONE]'])
    ).toBe('B');
  });

  it('R15-03 无 [DONE] 时流结束仍返回已收到的内容', async () => {
    expect(await collect(['data: {"choices":[{"delta":{"content":"C"}}]}'])).toBe('C');
  });

  it('R15-04 CRLF 行尾正常解析', async () => {
    const enc = new TextEncoder();
    const fetchImpl: FetchLike = async () =>
      ({
        ok: true,
        status: 200,
        body: {
          async *[Symbol.asyncIterator]() {
            yield enc.encode('data: {"choices":[{"delta":{"content":"D"}}]}\r\n');
            yield enc.encode('data: [DONE]\r\n');
          },
        },
      }) as ResponseLike;
    expect(await collectStream(streamChat(cfg, { messages: [] }, fetchImpl))).toBe('D');
  });

  it('R15-05 一条超长 JSON 行（单行 200KB）不截断解析', async () => {
    const big = 'x'.repeat(200_000);
    const out = await collect([`data: {"choices":[{"delta":{"content":"${big}"}}]}`, 'data: [DONE]']);
    expect(out).toHaveLength(200_000);
  });

  it('R15-06 同一 chunk 内多条 SSE 行一次性到达', async () => {
    const enc = new TextEncoder();
    const fetchImpl: FetchLike = async () =>
      ({
        ok: true,
        status: 200,
        body: {
          async *[Symbol.asyncIterator]() {
            yield enc.encode(
              'data: {"choices":[{"delta":{"content":"1"}}]}\ndata: {"choices":[{"delta":{"content":"2"}}]}\ndata: [DONE]\n'
            );
          },
        },
      }) as ResponseLike;
    expect(await collectStream(streamChat(cfg, { messages: [] }, fetchImpl))).toBe('12');
  });

  it('R15-07 混合坏行与好行时不丢内容', async () => {
    expect(
      await collect([
        'data: {broken',
        'data: {"choices":[{"delta":{"content":"X"}}]}',
        'data: [DONE]',
        'data: {"choices":[{"delta":{"content":"Y"}}]}',
      ])
    ).toBe('X');
  });

  it('R15-08 工具名在多个 delta 中重复下发时不拼接', async () => {
    const { fetch } = streamFetchMock((_c, i) => {
      if (i === 0) {
        return {
          ok: true,
          status: 200,
          body: linesBody(
            sse([
              '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"search","arguments":""}}]}}]}',
              // 部分 provider 会在后续 delta 重复下发 name
              '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"search","arguments":"{\\"query\\":\\"苹果\\"}"}}]}}]}',
            ])
          ),
        };
      }
      return { ok: true, status: 200, body: linesBody(sse(['{"choices":[{"delta":{"content":"ok"}}]}'])) };
    });
    const { events } = await collectToolAgent(
      runToolAgent({
        cfg,
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
});

/* ───────────── 风险 3：REST 层随校验变化的新分支 ───────────── */

describe('R16 REST 新分支', () => {
  const seed = () => {
    const v = new Vault();
    v.upsert({ id: 'a.md', name: 'a.md', content: '# A 苹果' });
    return v;
  };

  it('R16-01 POST /notes 无 body 字段 → 用默认名创建空笔记（201）', () => {
    const v = seed();
    const res = handleRest(v, { method: 'POST', url: '/notes', headers: {}, body: '{}' }, { allowWrite: true });
    expect(res.status).toBe(201);
    const created = v.list().find((n) => n.name === 'untitled.md');
    expect(created).toBeTruthy();
    expect(created!.content).toBe('');
  });

  it('R16-02 PUT /notes/:id 传空 content → 允许清空正文（200）', () => {
    const v = seed();
    const res = handleRest(
      v,
      { method: 'PUT', url: '/notes/a.md', headers: {}, body: JSON.stringify({ content: '' }) },
      { allowWrite: true }
    );
    expect(res.status).toBe(200);
    expect(v.get('a.md')!.content).toBe('');
  });

  it('R16-03 GET /search 缺 q → 400 且 ok:false（校验已生效）', () => {
    const res = handleRest(seed(), { method: 'GET', url: '/search', headers: {} });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).ok).toBe(false);
  });

  it('R16-04 GET /search?q=苹果 → 200 且命中', () => {
    const res = handleRest(seed(), { method: 'GET', url: '/search?q=苹果', headers: {} });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('R16-05 只读模式写操作仍为 403（不误伤）', () => {
    const res = handleRest(seed(), {
      method: 'POST',
      url: '/notes',
      headers: {},
      body: JSON.stringify({ name: 'c.md', content: '# C' }),
    });
    expect(res.status).toBe(403);
  });

  it('R16-06 GET /notes/:id 不存在仍为 404（不误伤）', () => {
    expect(handleRest(seed(), { method: 'GET', url: '/notes/nope', headers: {} }).status).toBe(404);
  });
});

/* ───────────── 风险 10：MCP 传输层端到端 ───────────── */

describe('R17 MCP 传输层', () => {
  it('R17-01 HTTP：tools/call search 缺 query → isError', () => {
    const res = handleHttp(createMcpServer(seedVault()), {
      method: 'POST',
      url: '/mcp',
      headers: {},
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search', arguments: {} } }),
    });
    expect(res.status).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.result.isError).toBe(true);
    expect(JSON.parse(payload.result.content[0].text).error).toContain('query');
  });

  it('R17-02 HTTP：allowWrite 下空 content 写入成功', () => {
    const v = seedVault();
    const res = handleHttp(createMcpServer(v, { allowWrite: true }), {
      method: 'POST',
      url: '/mcp',
      headers: {},
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'write_note', arguments: { id: 'e', name: 'e.md', content: '' } },
      }),
    });
    expect(JSON.parse(res.body).result.isError).toBe(false);
    expect(v.get('e')!.content).toBe('');
  });

  it('R17-03 HTTP：Bearer 鉴权 / 坏 JSON / 批量 / health', () => {
    const srv = createMcpServer(seedVault());
    const denied = handleHttp(srv, { method: 'POST', url: '/mcp', headers: {}, body: '{}' }, { token: 's' });
    expect(denied.status).toBe(401);

    const bad = handleHttp(srv, { method: 'POST', url: '/mcp', headers: {}, body: '{ not json' });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body).error.code).toBe(-32700);

    const batch = handleHttp(srv, {
      method: 'POST',
      url: '/mcp',
      headers: {},
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ]),
    });
    expect(JSON.parse(batch.body)).toHaveLength(1);

    const health = handleHttp(srv, { method: 'GET', url: '/health', headers: {} });
    expect(JSON.parse(health.body).ok).toBe(true);
  });

  it('R17-04 stdio：完整 tools/call 往返 + 校验错误', () => {
    const out: string[] = [];
    let cb: (line: string) => void = () => {};
    const io: LineIO = { onLine: (fn) => (cb = fn), write: (l) => out.push(l) };
    serveOverLines(createMcpServer(seedVault()), io);

    cb(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_notes', arguments: {} } }));
    cb(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search', arguments: {} } }));

    expect(out).toHaveLength(2);
    expect(JSON.parse(out[0]!).result.isError).toBe(false);
    expect(JSON.parse(out[1]!).result.isError).toBe(true);
  });
});

/* ───────────── 风险 8：沙箱幂等 / 重复应用 ───────────── */

describe('R18 沙箱幂等', () => {
  it('R18-01 accept 同一 key 两次，第二次返回 false', () => {
    const v = seedVault();
    const sb = createSandboxSession(v, { allowWrite: true });
    sb.tools.write_note({ id: 'x', name: 'x.md', content: 'new' });
    expect(sb.accept('write:x')).toBe(true);
    expect(sb.accept('write:x')).toBe(false);
    expect(sb.pending()).toHaveLength(0);
  });

  it('R18-02 acceptAll 连续两次，第二次返回 0 且不重复落库', () => {
    const v = seedVault();
    const sb = createSandboxSession(v, { allowWrite: true });
    sb.tools.write_note({ id: 'x', name: 'x.md', content: 'new' });
    expect(sb.acceptAll()).toBe(1);
    expect(sb.acceptAll()).toBe(0);
    expect(v.get('x')!.content).toBe('new');
    expect(v.size).toBe(4); // 原有 3 篇 + 新建 1 篇，无重复
  });

  it('R18-03 accept 之后 reject 同 key 返回 false', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    sb.tools.write_note({ id: 'x', name: 'x.md', content: 'new' });
    expect(sb.accept('write:x')).toBe(true);
    expect(sb.reject('write:x')).toBe(false);
  });

  it('R18-04 rejectAll 之后 acceptAll 返回 0', () => {
    const v = seedVault();
    const sb = createSandboxSession(v, { allowWrite: true });
    sb.tools.write_note({ id: 'x', name: 'x.md', content: 'new' });
    expect(sb.rejectAll()).toBe(1);
    expect(sb.acceptAll()).toBe(0);
    expect(v.get('x')).toBeNull();
  });
});

/* ───────────── 风险 9：异步检索（Embedder）失败降级 ───────────── */

describe('R19 异步检索与可观测性', () => {
  const body = () => ({ ok: true, status: 200, body: linesBody(['data: [DONE]']) });

  it('R19-01 异步 retrieve 正常解析', async () => {
    const { fetch, calls } = streamFetchMock(() => body());
    await collectAgent(
      runAgent({
        cfg,
        prompt: '苹果',
        retrieve: async () => ({ context: '异步资料', trace: [] }),
        fetchImpl: fetch,
      })
    );
    expect(calls[0]!.body.messages.at(-1).content).toContain('异步资料');
  });

  it('R19-02 异步 retrieve reject → 降级为失败步骤而非击穿', async () => {
    const { fetch } = streamFetchMock(() => body());
    const { events } = await collectAgent(
      runAgent({
        cfg,
        prompt: '苹果',
        retrieve: async () => {
          throw new Error('embedder down');
        },
        fetchImpl: fetch,
      })
    );
    expect((events[0] as any).step).toMatchObject({ tool: 'retrieve', ok: false });
    expect(events.at(-1)!.type).toBe('done');
  });

  it('R19-03 重试产生 retry 事件（不再静默等待）', async () => {
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) return { ok: false, status: 503, text: async () => 'down' };
      return openaiTextResponse('恢复');
    });
    const { events } = await collectToolAgent(
      runToolAgent({
        cfg,
        tools: tools(),
        prompt: 'q',
        fetchImpl: fetch,
        streamFinal: false,
        retry: { retries: 2, baseDelayMs: 1 },
      })
    );
    const retryEv = events.find((e) => e.type === 'retry') as any;
    expect(retryEv).toBeTruthy();
    expect(retryEv.attempt).toBe(1);
    expect(retryEv.status).toBe(503);
    expect(retryEv.delayMs).toBeGreaterThanOrEqual(0);
  });

  it('R19-04 prompt 被截断时产出 notice 事件（对用户可见）', async () => {
    const { fetch } = jsonFetchMock(() => openaiTextResponse('ok'));
    const { events } = await collectToolAgent(
      runToolAgent({
        cfg,
        tools: tools(),
        prompt: '啊'.repeat(MAX_PROMPT_CHARS + 500),
        fetchImpl: fetch,
        streamFinal: false,
      })
    );
    const notice = events.find((e) => e.type === 'notice') as any;
    expect(notice).toBeTruthy();
    expect(notice.code).toBe('truncated');
  });

  it('R19-05 未超限时不应产出 notice（不误伤）', async () => {
    const { fetch } = jsonFetchMock(() => openaiTextResponse('ok'));
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: '正常问题', fetchImpl: fetch, streamFinal: false })
    );
    expect(events.some((e) => e.type === 'notice')).toBe(false);
  });

  it('R19-06 多轮工具循环仍以 done 收尾且事件序列完整', async () => {
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
                    { id: 'c1', type: 'function', function: { name: 'search', arguments: '{"query":"苹果"}' } },
                  ],
                },
              },
            ],
          }),
        };
      }
      return openaiTextResponse('完成');
    });
    const { events, text } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    expect(events.map((e) => e.type)).toEqual(['tool', 'delta', 'done']);
    expect(text).toBe('完成');
  });
});
