/**
 * L4 工具/函数调用的选择与路由：VaultTools 分发、读写闸门、MCP tools/call 路由、
 * 错误回填与重试/回退。
 */

import { describe, it, expect } from 'vitest';
import { Vault } from '../../src/vault/vault';
import { createVaultTools } from '../../src/agent/tools';
import { createSandboxSession } from '../../src/agent/sandbox';
import { createMcpServer } from '../../src/mcp/server';
import { runToolAgent } from '../../src/agent/fc';
import {
  collectToolAgent,
  jsonFetchMock,
  openaiTextResponse,
  openaiToolResponse,
  seedVault,
} from './_mocks';

const cfg = { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' };

describe('L4-1 VaultTools 分发', () => {
  it('L4-01 六个只读工具全部路由成功', () => {
    const t = createVaultTools(seedVault());
    expect(t.call('list_notes').ok).toBe(true);
    expect(t.call('read_note', { id: 'a' }).ok).toBe(true);
    expect(t.call('search', { query: '苹果' }).ok).toBe(true);
    expect(t.call('get_outline', { id: 'a' }).ok).toBe(true);
    expect(t.call('get_backlinks', { id: 'a' }).ok).toBe(true);
    expect(t.call('get_outgoing', { id: 'a' }).ok).toBe(true);
  });

  it('L4-02 未知工具名返回 ok:false 并带工具名', () => {
    const r = createVaultTools(seedVault()).call('no_such_tool');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('no_such_tool');
  });

  it('L4-03 空工具名返回 ok:false', () => {
    expect(createVaultTools(seedVault()).call('').ok).toBe(false);
  });

  it('L4-04 call("manifest") 应被拒绝而非返回数组', () => {
    const r = createVaultTools(seedVault()).call('manifest');
    expect(r.ok).toBe(false);
  });

  it('L4-05 call("call") 不递归爆炸且返回 ok:false', () => {
    const r = createVaultTools(seedVault()).call('call');
    expect(r.ok).toBe(false);
  });

  it('L4-06 call 缺省 args 视为空对象', () => {
    const t = createVaultTools(seedVault());
    expect(t.call('list_notes').ok).toBe(true);
  });
});

describe('L4-2 读写闸门', () => {
  it('L4-07 只读模式下三个写工具均被拦截', () => {
    const t = createVaultTools(seedVault());
    for (const name of ['write_note', 'append_to_note', 'delete_note']) {
      const r = t.call(name, { name: 'x.md', content: 'y', text: 'z', id: 'a' });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('write disabled');
    }
  });

  it('L4-08 allowWrite=true 时写工具放行并落库', () => {
    const v = seedVault();
    const t = createVaultTools(v, { allowWrite: true });
    expect(t.call('write_note', { id: 'w', name: 'w.md', content: 'hello' }).ok).toBe(true);
    expect(v.get('w')!.content).toBe('hello');
    expect(t.call('append_to_note', { id: 'w', text: '!' }).ok).toBe(true);
    // 原文不以换行结尾时自动补分隔符
    expect(v.get('w')!.content).toBe('hello\n!');
    expect(t.call('delete_note', { id: 'w' }).ok).toBe(true);
    expect(v.get('w')).toBeNull();
  });

  it('L4-09 只读模式下直接调用写方法（绕过 call）同样被拦截', () => {
    const v = seedVault();
    const t = createVaultTools(v);
    expect(t.write_note({ id: 'z', name: 'z.md', content: 'x' }).ok).toBe(false);
    expect(v.get('z')).toBeNull();
  });
});

describe('L4-3 目标解析分支 (resolveId)', () => {
  it('L4-10 按 id 命中', () => {
    expect(createVaultTools(seedVault()).read_note({ id: 'a' }).ok).toBe(true);
  });

  it('L4-11 按 name 命中（可省略 .md 后缀）', () => {
    const t = createVaultTools(seedVault());
    expect(t.read_note({ name: 'Alpha.md' }).ok).toBe(true);
    expect(t.read_note({ name: 'Alpha' }).ok).toBe(true);
  });

  it('L4-12 id 优先于 name', () => {
    const t = createVaultTools(seedVault());
    const r = t.read_note({ id: 'a', name: 'Beta' });
    expect(r.data!.note.id).toBe('a');
  });

  it('L4-13 id 不存在且 name 缺失 → note not found', () => {
    expect(createVaultTools(seedVault()).read_note({ id: 'nope' }).ok).toBe(false);
  });

  it('L4-14 空 id / 空 name 等价未指定', () => {
    const t = createVaultTools(seedVault());
    expect(t.read_note({ id: '', name: '' }).ok).toBe(false);
  });

  it('L4-15 空库中工具安全返回', () => {
    const t = createVaultTools(new Vault());
    expect(t.call('list_notes').data).toEqual([]);
    expect(t.call('get_outline', { id: 'x' }).ok).toBe(false);
  });
});

describe('L4-4 MCP tools/call 路由', () => {
  it('L4-16 已知工具经 MCP 路由成功', () => {
    const s = createMcpServer(seedVault());
    const res = s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_notes', arguments: {} } })!;
    expect(res.error).toBeUndefined();
    expect((res.result as any).isError).toBe(false);
  });

  it('L4-17 未知工具 → isError:true', () => {
    const s = createMcpServer(seedVault());
    const res = s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } })!;
    expect((res.result as any).isError).toBe(true);
  });

  it('L4-18 未知方法 → -32601', () => {
    const s = createMcpServer(seedVault());
    const res = s.handle({ jsonrpc: '2.0', id: 1, method: 'nope' })!;
    expect(res.error!.code).toBe(-32601);
  });

  it('L4-19 缺少 params.name → isError:true', () => {
    const s = createMcpServer(seedVault());
    const res = s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} })!;
    expect((res.result as any).isError).toBe(true);
  });

  it('L4-20 MCP 只读模式下写工具 → isError:true', () => {
    const s = createMcpServer(seedVault());
    const res = s.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'write_note', arguments: { name: 'a.md', content: 'x' } },
    })!;
    expect((res.result as any).isError).toBe(true);
  });
});

describe('L4-5 错误回填与自愈', () => {
  it('L4-21 工具执行失败时错误结果回填模型并继续（不中断）', async () => {
    const t = createVaultTools(seedVault());
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) return openaiToolResponse('read_note', { id: 'ghost' });
      return openaiTextResponse('未找到该笔记。');
    });
    const { events, text } = await collectToolAgent(
      runToolAgent({ cfg, tools: t, prompt: '读一下', fetchImpl: fetch, streamFinal: false })
    );
    const toolEv = events.find((e) => e.type === 'tool') as any;
    expect(toolEv.ok).toBe(false);
    expect(text).toContain('未找到');
    expect(events.at(-1)!.type).toBe('done');
  });

  it('L4-22 模型调用未知工具时错误回填并继续', async () => {
    const t = createVaultTools(seedVault());
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) return openaiToolResponse('teleport', {});
      return openaiTextResponse('工具不可用。');
    });
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: t, prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    const toolEv = events.find((e) => e.type === 'tool') as any;
    expect(toolEv.ok).toBe(false);
    expect(toolEv.summary).toContain('unknown tool');
  });

  it('L4-23 只读模式下模型调写工具被拦截且结果回填', async () => {
    const t = createVaultTools(seedVault());
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) return openaiToolResponse('write_note', { name: 'x.md', content: 'y' });
      return openaiTextResponse('只读模式无法写入。');
    });
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: t, prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    const toolEv = events.find((e) => e.type === 'tool') as any;
    expect(toolEv.ok).toBe(false);
    expect(toolEv.summary).toContain('write disabled');
  });

  it('L4-24 达到 maxSteps 上限时给出提示而非静默结束', async () => {
    const t = createVaultTools(seedVault());
    const { fetch } = jsonFetchMock(() => openaiToolResponse('list_notes', {}));
    const { text, events } = await collectToolAgent(
      runToolAgent({ cfg, tools: t, prompt: 'q', fetchImpl: fetch, streamFinal: false, maxSteps: 3 })
    );
    expect(text).toContain('最大工具调用步数');
    expect(events.at(-1)!.type).toBe('done');
  });
});

describe('L4-6 重试 / 回退', () => {
  it('L4-25 5xx 服务端错误应重试后成功', async () => {
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) return { ok: false, status: 500, text: async () => 'internal error' };
      return openaiTextResponse('恢复成功');
    });
    const { text } = await collectToolAgent(
      runToolAgent({ cfg, tools: createVaultTools(seedVault()), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    expect(text).toContain('恢复成功');
  });

  it('L4-26 429 限流应退避重试后成功', async () => {
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) return { ok: false, status: 429, text: async () => 'rate limited' };
      return openaiTextResponse('退避后成功');
    });
    const { text } = await collectToolAgent(
      runToolAgent({ cfg, tools: createVaultTools(seedVault()), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    expect(text).toContain('退避后成功');
  });

  it('L4-27 网络层异常（DNS/连接失败）应重试或降级而非直接抛出', async () => {
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) throw new Error('ECONNREFUSED');
      return openaiTextResponse('重连成功');
    });
    const { text } = await collectToolAgent(
      runToolAgent({ cfg, tools: createVaultTools(seedVault()), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    expect(text).toContain('重连成功');
  });

  it('L4-28 重试耗尽后在事件流中给出带状态码的可诊断错误', async () => {
    const { fetch } = jsonFetchMock(() => ({ ok: false, status: 503, text: async () => 'down' }));
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: createVaultTools(seedVault()), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    const errEv = events.find((e) => e.type === 'error') as { message?: string } | undefined;
    expect(errEv?.message).toMatch(/503/);
    // 流仍以 done 收尾，调用方无需 try/catch
    expect(events.at(-1)!.type).toBe('done');
  });
});

describe('L4-7 沙箱路由', () => {
  it('L4-29 沙箱只读模式写入被拒', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: false });
    expect(sb.tools.call('write_note', { id: 'x', name: 'x.md', content: 'y' }).ok).toBe(false);
    expect(sb.pending()).toHaveLength(0);
  });

  it('L4-30 沙箱可写模式写入入队但不落库', () => {
    const v = seedVault();
    const sb = createSandboxSession(v, { allowWrite: true });
    expect(sb.tools.call('write_note', { id: 'x', name: 'x.md', content: 'y' }).ok).toBe(true);
    expect(v.get('x')).toBeNull();
    expect(sb.pending()).toHaveLength(1);
  });

  it('L4-31 沙箱读操作叠加未落库的写入（read-your-writes）', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    sb.tools.write_note({ id: 'a', name: 'Alpha.md', content: '沙箱新内容' });
    const r = sb.tools.read_note({ id: 'a' });
    expect(r.ok).toBe(true);
    expect(r.data!.note.content).toBe('沙箱新内容');
  });

  it('L4-32 沙箱拒绝未知工具与 call/manifest', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    expect(sb.tools.call('manifest').ok).toBe(false);
    expect(sb.tools.call('call').ok).toBe(false);
    expect(sb.tools.call('zzz').ok).toBe(false);
  });

  it('L4-33 沙箱写入缺失必填字段应被拒绝', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    const r = sb.tools.call('write_note', { id: 'x' });
    expect(r.ok).toBe(false);
  });
});
