/**
 * L5 多轮上下文与状态管理：历史窗口、上下文膨胀、工具结果回填形态、
 * 沙箱队列状态、token 计量状态。
 */

import { describe, it, expect } from 'vitest';
import { TokenMeter } from '../../src/agent/tokens';
import { createSandboxSession } from '../../src/agent/sandbox';
import { createVaultTools } from '../../src/agent/tools';
import { runToolAgent } from '../../src/agent/fc';
import type { ChatMessage } from '../../src/agent/llm';
import {
  collectToolAgent,
  jsonFetchMock,
  openaiTextResponse,
  openaiToolResponse,
  seedVault,
} from './_mocks';

const cfg = { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' };
const claudeCfg = { provider: 'claude', model: 'claude-sonnet-4-5', apiKey: 'sk-ant' };

describe('L5-1 历史窗口', () => {
  it('L5-01 超长历史应被截断到最近 N 条（上下文窗口保护）', async () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 50; i++) {
      history.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `第${i}轮` });
    }
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    await collectToolAgent(
      runToolAgent({ cfg, tools: createVaultTools(seedVault()), prompt: '当前问', history, fetchImpl: fetch, streamFinal: false })
    );
    const msgs = calls[0]!.body.messages;
    // system + 历史 + 本轮提问；期望历史被窗口化（如至多 8 条）
    expect(msgs.length).toBeLessThanOrEqual(1 + 8 + 1);
  });

  it('L5-02 单条历史超长时不应整条灌入请求体', async () => {
    const history: ChatMessage[] = [{ role: 'user', content: '长'.repeat(200_000) }];
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    await collectToolAgent(
      runToolAgent({ cfg, tools: createVaultTools(seedVault()), prompt: 'q', history, fetchImpl: fetch, streamFinal: false })
    );
    const total = calls[0]!.body.messages.reduce(
      (n: number, m: { content?: string }) => n + (m.content?.length ?? 0),
      0
    );
    expect(total).toBeLessThanOrEqual(32_000);
  });

  it('L5-03 历史中非法角色（tool）应被剔除或补全，不应原样透传', async () => {
    const history = [{ role: 'tool', content: '上一轮工具结果' } as unknown as ChatMessage];
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    await collectToolAgent(
      runToolAgent({ cfg, tools: createVaultTools(seedVault()), prompt: 'q', history, fetchImpl: fetch, streamFinal: false })
    );
    const roles = calls[0]!.body.messages.map((m: { role: string }) => m.role);
    expect(roles).not.toContain('tool');
  });
});

describe('L5-2 工具结果回填形态', () => {
  it('L5-04 OpenAI：assistant(tool_calls) + 每条 tool 结果各一条消息', async () => {
    let n = 0;
    const { fetch, calls } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) return openaiToolResponse('search', { query: '苹果' });
      return openaiTextResponse('done');
    });
    await collectToolAgent(
      runToolAgent({ cfg, tools: createVaultTools(seedVault()), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    const msgs = calls[1]!.body.messages;
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    const assistant = msgs[2];
    expect(assistant.tool_calls[0].function.name).toBe('search');
    expect(msgs[3].tool_call_id).toBe('c1');
  });

  it('L5-05 Anthropic：多个 tool_result 合并为一条 user 消息', async () => {
    let n = 0;
    const { fetch, calls } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [
              { type: 'tool_use', id: 'tu1', name: 'search', input: { query: '苹果' } },
              { type: 'tool_use', id: 'tu2', name: 'list_notes', input: {} },
            ],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
    });
    await collectToolAgent(
      runToolAgent({ cfg: claudeCfg, tools: createVaultTools(seedVault()), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    const msgs = calls[1]!.body.messages;
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
    const toolResults = msgs[2].content.filter((c: { type: string }) => c.type === 'tool_result');
    expect(toolResults).toHaveLength(2);
    expect(toolResults.map((c: { tool_use_id: string }) => c.tool_use_id)).toEqual(['tu1', 'tu2']);
  });

  it('L5-06 Ollama：工具结果以 role=tool 文本消息回填', async () => {
    let n = 0;
    const { fetch, calls } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: { content: '', tool_calls: [{ function: { name: 'search', arguments: { query: '苹果' } } }] },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ message: { content: 'ok' } }) };
    });
    await collectToolAgent(
      runToolAgent({
        cfg: { provider: 'ollama', model: 'qwen2.5' },
        tools: createVaultTools(seedVault()),
        prompt: 'q',
        fetchImpl: fetch,
        streamFinal: false,
      })
    );
    const msgs = calls[1]!.body.messages;
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(typeof msgs[3].content).toBe('string');
  });

  it('L5-07 多轮工具循环中 messages 持续累积（不丢轮次）', async () => {
    let n = 0;
    const { fetch, calls } = jsonFetchMock(() => {
      n += 1;
      if (n <= 2) return openaiToolResponse('list_notes', {}, `c${n}`);
      return openaiTextResponse('最终');
    });
    await collectToolAgent(
      runToolAgent({ cfg, tools: createVaultTools(seedVault()), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    expect(calls).toHaveLength(3);
    expect(calls[2]!.body.messages.filter((m: { role: string }) => m.role === 'tool')).toHaveLength(2);
  });
});

describe('L5-3 沙箱状态', () => {
  it('L5-08 同一笔记多次写入合并为一条 pending', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    sb.tools.write_note({ id: 'a', name: 'Alpha.md', content: 'v1' });
    sb.tools.write_note({ id: 'a', name: 'Alpha.md', content: 'v2' });
    expect(sb.pending()).toHaveLength(1);
    expect(sb.pending()[0]!.after).toBe('v2');
  });

  it('L5-09 append 保留首次变更前的原文（before 不被后续覆盖）', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    sb.tools.append_to_note({ id: 'a', text: 'X' });
    sb.tools.append_to_note({ id: 'a', text: 'Y' });
    const p = sb.pending()[0]!;
    expect(p.before).toBe(seedVault().get('a')!.content);
    expect(p.after).toContain('X');
    expect(p.after).toContain('Y');
  });

  it('L5-10 待删除的笔记读取时不可见', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    sb.tools.delete_note({ id: 'a' });
    const r = sb.tools.read_note({ id: 'a' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('pending delete');
  });

  it('L5-11 accept / reject 不存在的 key 返回 false', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    expect(sb.accept('write:nope')).toBe(false);
    expect(sb.reject('write:nope')).toBe(false);
  });

  it('L5-12 acceptAll 中途失败：已应用项应出队，失败项保留待重试', () => {
    const v = seedVault();
    const sb = createSandboxSession(v, { allowWrite: true });
    sb.tools.write_note({ id: 'ok1', name: 'ok1.md', content: 'x' });
    sb.tools.write_note({ id: 'boom', name: 'boom.md', content: 'y' });
    // 模拟落库失败（磁盘写满 / 权限）
    (v as any).upsert = (note: { id: string }) => {
      if (note.id === 'boom') throw new Error('disk full');
    };
    expect(() => sb.acceptAll()).toThrow(/部分失败/);
    const keys = sb.pending().map((c) => c.id);
    // 已成功应用的必须从队列移除，避免重复应用
    expect(keys).not.toContain('ok1');
    // 失败项保留，用户可拒绝或重试
    expect(keys).toEqual(['boom']);
  });

  it('L5-13 rejectAll 清空队列且不落库', () => {
    const v = seedVault();
    const sb = createSandboxSession(v, { allowWrite: true });
    sb.tools.write_note({ id: 'a', name: 'Alpha.md', content: 'changed' });
    expect(sb.rejectAll()).toBe(1);
    expect(v.get('a')!.content).toContain('苹果');
    expect(sb.pending()).toHaveLength(0);
  });
});

describe('L5-4 token 计量状态', () => {
  it('L5-14 累计与清空', () => {
    const m = new TokenMeter();
    m.record({ promptTokens: 10, completionTokens: 5, totalTokens: 15, provider: 'openai', model: 'm', estimated: true });
    m.record({ promptTokens: 20, completionTokens: 10, totalTokens: 30, provider: 'openai', model: 'm', estimated: true });
    expect(m.totals()).toEqual({ promptTokens: 30, completionTokens: 15, totalTokens: 45 });
    expect(m.history()).toHaveLength(2);
    m.clear();
    expect(m.totals().totalTokens).toBe(0);
  });
});
