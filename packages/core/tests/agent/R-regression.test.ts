/**
 * R 系列——本次修复的回归锁定用例。
 *
 * 与 L1~L6 的区别：L 系列按「链路环节」组织、偏向场景；R 系列按「缺陷编号」组织，
 * 每条只锁定一个修复机制，且尽量做到「修复被回滚时该用例必然失败」，
 * 从而能明确验证修复前后的行为差异。
 */

import { describe, it, expect } from 'vitest';
import { Vault } from '../../src/vault/vault';
import {
  DEFAULT_HISTORY_LIMIT,
  EMPTY_RESPONSE_HINT,
  MAX_HISTORY_CHARS,
  MAX_PROMPT_CHARS,
  buildChatRequest,
  runAgent,
  streamChat,
  truncateText,
  type ChatMessage,
  type FetchLike,
  type ResponseLike,
} from '../../src/agent/llm';
import { buildToolsRequest, runToolAgent } from '../../src/agent/fc';
import { createVaultTools } from '../../src/agent/tools';
import { createSandboxSession } from '../../src/agent/sandbox';
import { matchRecipes, recipeIntervalMs, renderRecipePrompt, type Recipe } from '../../src/agent/recipes';
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
const tools = () => createVaultTools(seedVault());

/* ───────────────────────── F1 空输入短路 ───────────────────────── */

describe('R1 空输入短路', () => {
  it('R1-01 空 prompt：0 次请求 + 抛错（修复前：仍发 1 次请求）', async () => {
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('x'));
    await expect(
      collectToolAgent(
        runToolAgent({ cfg, tools: tools(), prompt: '', fetchImpl: fetch, streamFinal: false })
      )
    ).rejects.toThrow(/prompt 为空/);
    expect(calls.length).toBe(0);
  });

  it('R1-02 runAgent 同样短路且 retrieve 不被调用', async () => {
    let retrieved = 0;
    const { fetch } = streamFetchMock(() => ({ ok: true, status: 200, body: linesBody(['data: [DONE]']) }));
    await expect(
      collectAgent(
        runAgent({
          cfg,
          prompt: '  ',
          retrieve: () => {
            retrieved += 1;
            return { context: '', trace: [] };
          },
          fetchImpl: fetch,
        })
      )
    ).rejects.toThrow(/prompt 为空/);
    expect(retrieved).toBe(0);
  });
});

/* ───────────────────────── F2 容量上限 ───────────────────────── */

describe('R2 提示词/上下文截断', () => {
  it('R2-01 超长 prompt 被截断（≤ perMessageBudget + 标记），末尾有省略号', async () => {
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    await collectToolAgent(
      runToolAgent({
        cfg,
        tools: tools(),
        prompt: '啊'.repeat(100_000),
        fetchImpl: fetch,
        streamFinal: false,
      })
    );
    const sent = calls[0]!.body.messages.at(-1).content as string;
    // 新的契约：clipMessages 把单条 user 消息裁到 perMessageBudget（MAX_PROMPT_CHARS）以内，
    // 并在末尾追加「…[已截断，原 N 字符]」标记，因此总长略大于纯 budget 但绝不超 2*budget。
    expect(sent.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS + 50);
    expect(sent.length).toBeLessThan(100_000); // 一定被裁了
    expect(sent).toContain('…[已截断');
    expect(sent.endsWith(']')).toBe(true);
  });

  it('R2-02 未超限的 prompt 不被改写（不误伤）', async () => {
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    const p = '正常长度的问题';
    await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: p, fetchImpl: fetch, streamFinal: false })
    );
    expect(calls[0]!.body.messages.at(-1).content).toBe(p);
  });

  it('R2-03 runAgent 的「问题 + 资料」整体受同一上限约束', async () => {
    const { fetch, calls } = streamFetchMock(() => ({
      ok: true,
      status: 200,
      body: linesBody(['data: [DONE]']),
    }));
    await collectAgent(
      runAgent({
        cfg,
        prompt: '问',
        retrieve: () => ({ context: '资'.repeat(100_000), trace: [] }),
        fetchImpl: fetch,
      })
    );
    const sent = calls[0]!.body.messages.at(-1).content as string;
    expect(sent).toHaveLength(MAX_PROMPT_CHARS);
    expect(sent.startsWith('问题：问')).toBe(true);
  });

  it('R2-04 truncateText 边界：短于上限原样返回', () => {
    expect(truncateText('abc', 10)).toBe('abc');
    expect(truncateText('abcdef', 3)).toBe('ab…');
  });
});

/* ───────────────────── F3/F4 search 参数校验 ───────────────────── */

describe('R3 search 入参校验', () => {
  it('R3-01 缺失 query → ok:false 且错误指向字段', () => {
    const r = tools().search({} as any);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('query');
  });

  it('R3-02 空白 query 同样被拒绝（修复前：静默返回空结果）', () => {
    expect(tools().search({ query: '   ' }).ok).toBe(false);
  });

  it('R3-03 limit 负数 / NaN / 0 一律回落默认 20', () => {
    for (const limit of [-1, Number.NaN, 0, -100]) {
      const r = tools().search({ query: '苹果', limit });
      expect(r.ok).toBe(true);
      expect(r.data).toHaveLength(2);
    }
  });

  it('R3-04 合法 limit 正常生效且不越界', () => {
    expect(tools().search({ query: '苹果', limit: 1 }).data).toHaveLength(1);
    expect(tools().search({ query: '苹果', limit: 99 }).data).toHaveLength(2);
  });

  it('R3-05 合法 query 结果结构不变（不误伤）', () => {
    const r = tools().search({ query: '苹果' });
    expect(r.ok).toBe(true);
    expect(r.data![0]).toHaveProperty('snippet');
    expect(r.data![0]!.snippet).toContain('苹果');
  });
});

/* ─────────────────── F5/F6 写入必填校验与错误信息 ─────────────────── */

describe('R4 写入必填校验', () => {
  it('R4-01 缺 name → 错误信息可读且指向字段（修复前：泄漏 TypeError）', () => {
    // 需 allowWrite：只读闸门先于字段校验生效（鉴权优先于校验，避免向未授权调用方泄漏 schema）
    const t = createVaultTools(seedVault(), { allowWrite: true });
    const r = t.call('write_note', { content: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing required field: name');
  });

  it('R4-02 缺 content → 指向字段（修复前：静默写入 undefined）', () => {
    const t = createVaultTools(seedVault(), { allowWrite: true });
    const r = t.call('write_note', { name: 'x.md' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing required field: content');
  });

  it('R4-02b 只读模式下写闸门优先于字段校验（顺序不被打乱）', () => {
    const r = tools().call('write_note', { content: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('write disabled');
  });

  it('R4-03 空字符串 content 应被允许（合法创建空笔记）', () => {
    const v = seedVault();
    const t = createVaultTools(v, { allowWrite: true });
    const r = t.write_note({ id: 'empty', name: 'empty.md', content: '' });
    expect(r.ok).toBe(true);
    expect(v.get('empty')!.content).toBe('');
  });

  it('R4-04 空字符串 name 仍被拒绝', () => {
    const t = createVaultTools(seedVault(), { allowWrite: true });
    expect(t.write_note({ name: '   ', content: 'x' }).ok).toBe(false);
  });

  it('R4-05 沙箱写入同样校验必填', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    expect(sb.tools.call('write_note', { id: 'x' }).ok).toBe(false);
    expect(sb.tools.call('write_note', { id: 'x', name: 'x.md' }).ok).toBe(false);
  });

  it('R4-06 沙箱允许空 content（对齐非沙箱语义）', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    expect(sb.tools.call('write_note', { id: 'x', name: 'x.md', content: '' }).ok).toBe(true);
  });

  it('R4-07 append 缺失 text 被拒绝', () => {
    const t = createVaultTools(seedVault(), { allowWrite: true });
    expect(t.call('append_to_note', { id: 'a' }).ok).toBe(false);
  });

  it('R4-08 合法写入仍成功（不误伤）', () => {
    const v = seedVault();
    const t = createVaultTools(v, { allowWrite: true });
    expect(t.write_note({ id: 'w', name: 'w.md', content: 'hi' }).ok).toBe(true);
    expect(v.get('w')!.content).toBe('hi');
  });
});

/* ───────────────────────── F8 模板特殊替换 ───────────────────────── */

describe('R5 recipe 模板渲染', () => {
  const ctx = { path: 'p.md', name: 'N', content: 'C' };

  it('R5-01 $& / $\' / $` / $$ / $1 全部原样保留（修复前被解释）', () => {
    for (const raw of ['A$&B', "A$'B", 'A$`B', 'A$$B', 'A$1B']) {
      expect(renderRecipePrompt('{{name}}', { ...ctx, name: raw })).toBe(raw);
    }
  });

  it('R5-02 常规渲染结果不变（不误伤）', () => {
    expect(renderRecipePrompt('{{name}}/{{path}}', ctx)).toBe('N/p.md');
  });
});

/* ──────────────────── F9/F10 间隔与空提示词 ──────────────────── */

describe('R6 recipes 健壮性', () => {
  const mk = (over: Partial<Recipe>): Recipe => ({
    id: 'r',
    name: 'r',
    trigger: 'cron',
    prompt: 'p',
    enabled: true,
    ...over,
  });

  it('R6-01 NaN / Infinity / 非数字 间隔回落 60 分钟（修复前：NaN）', () => {
    expect(recipeIntervalMs(mk({ intervalMinutes: Number.NaN }))).toBe(3_600_000);
    expect(recipeIntervalMs(mk({ intervalMinutes: Number.POSITIVE_INFINITY }))).toBe(3_600_000);
    expect(recipeIntervalMs(mk({ intervalMinutes: 'abc' as unknown as number }))).toBe(3_600_000);
  });

  it('R6-02 合法间隔仍按分钟换算（不误伤）', () => {
    expect(recipeIntervalMs(mk({ intervalMinutes: 15 }))).toBe(900_000);
    expect(recipeIntervalMs(mk({}))).toBe(3_600_000);
  });

  it('R6-03 空白 prompt 的 recipe 不入队，非空的仍在', () => {
    const recipes = [mk({ id: 'blank', prompt: '  ' }), mk({ id: 'ok', prompt: '你好' })];
    const hit = matchRecipes(recipes, 'cron', { path: 'a.md', name: 'a.md', content: '' });
    expect(hit.map((h) => h.recipe.id)).toEqual(['ok']);
  });
});

/* ─────────────────── F11/F12 baseUrl 与 apiKey ─────────────────── */

describe('R7 provider 前置校验', () => {
  it('R7-01 未知 provider → 抛错提示 baseUrl', () => {
    expect(() =>
      buildToolsRequest({ provider: 'nope', model: 'm', apiKey: 'k' }, [], tools())
    ).toThrow(/baseUrl/);
  });

  it('R7-02 custom 未配 baseUrl → 抛错（修复前产出相对 URL）', () => {
    expect(() => buildChatRequest({ provider: 'custom', model: 'm', apiKey: 'k' }, { messages: [] })).toThrow(
      /baseUrl/
    );
  });

  it('R7-03 openai 缺 apiKey → 抛错（修复前静默发无鉴权请求）', () => {
    expect(() => buildChatRequest({ provider: 'openai', model: 'm' }, { messages: [] })).toThrow(
      /apiKey/
    );
  });

  it('R7-04 custom 已配 baseUrl 但无 apiKey 不拦截（本地/自建端点常见）', () => {
    const req = buildChatRequest(
      { provider: 'custom', model: 'm', baseUrl: 'http://localhost:1234/v1' },
      { messages: [] }
    );
    expect(req.url).toBe('http://localhost:1234/v1/chat/completions');
    expect(req.headers.authorization).toBeUndefined();
  });

  it('R7-05 ollama 无 apiKey 不拦截（本地推理）', () => {
    const req = buildChatRequest({ provider: 'ollama', model: 'qwen2.5' }, { messages: [] });
    expect(req.url).toBe('http://localhost:11434/api/chat');
  });

  it('R7-06 已知 provider 配齐参数时 URL 正确（不误伤）', () => {
    expect(buildChatRequest(cfg, { messages: [] }).url).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });
});

/* ───────────────────────── F13 元方法拒绝 ───────────────────────── */

describe('R8 工具分发元方法', () => {
  it('R8-01 call("manifest")/call("call") 返回 ok:false（修复前返回数组）', () => {
    const t = tools();
    expect(t.call('manifest').ok).toBe(false);
    expect(typeof t.call('manifest').error).toBe('string');
    expect(t.call('call').ok).toBe(false);
  });

  it('R8-02 九个真实工具仍全部可用（不误伤）', () => {
    const t = tools();
    for (const n of [
      'list_notes',
      'read_note',
      'search',
      'get_outline',
      'get_backlinks',
      'get_outgoing',
    ]) {
      expect(t.call(n, { query: '苹果', id: 'a', name: 'Alpha' }).ok).toBe(true);
    }
  });
});

/* ───────────────────────── F14 重试与退避 ───────────────────────── */

describe('R9 重试策略', () => {
  const fast = { retries: 2, baseDelayMs: 1 };

  it('R9-01 5xx 默认重试 2 次（共 3 次尝试）后失败', async () => {
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      return { ok: false, status: 503, text: async () => 'down' };
    });
    const { events } = await collectToolAgent(
      runToolAgent({
        cfg,
        tools: tools(),
        prompt: 'q',
        fetchImpl: fetch,
        streamFinal: false,
        retry: fast,
      })
    );
    expect(n).toBe(3);
    expect((events.find((e) => e.type === 'error') as any).message).toMatch(/503/);
  });

  it('R9-02 429 重试后成功', async () => {
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) return { ok: false, status: 429, text: async () => 'rate limited' };
      return openaiTextResponse('退避后成功');
    });
    const { text } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false, retry: fast })
    );
    expect(n).toBe(2);
    expect(text).toContain('退避后成功');
  });

  it('R9-03 网络层异常重试后成功', async () => {
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) throw new Error('ECONNREFUSED');
      return openaiTextResponse('重连成功');
    });
    const { text } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false, retry: fast })
    );
    expect(n).toBe(2);
    expect(text).toContain('重连成功');
  });

  it('R9-04 401 属不可重试错误，只请求 1 次', async () => {
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      return { ok: false, status: 401, text: async () => 'bad key' };
    });
    await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false, retry: fast })
    );
    expect(n).toBe(1);
  });

  it('R9-05 默认退避真实生效（首次重试等待 ≥100ms）', async () => {
    let n = 0;
    const started = Date.now();
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      if (n === 1) return { ok: false, status: 500, text: async () => '' };
      return openaiTextResponse('ok');
    });
    await collectToolAgent(
      // 不传 retry，使用默认 baseDelayMs=200
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    expect(n).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('R9-06 retries:0 可关闭重试', async () => {
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      return { ok: false, status: 500, text: async () => '' };
    });
    await collectToolAgent(
      runToolAgent({
        cfg,
        tools: tools(),
        prompt: 'q',
        fetchImpl: fetch,
        streamFinal: false,
        retry: { retries: 0, baseDelayMs: 1 },
      })
    );
    expect(n).toBe(1);
  });

  it('R9-07 首次即成功时不产生额外请求（不误伤）', async () => {
    let n = 0;
    const { fetch } = jsonFetchMock(() => {
      n += 1;
      return openaiTextResponse('ok');
    });
    await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false, retry: fast })
    );
    expect(n).toBe(1);
  });
});

/* ───────────────────────── F15 历史窗口 ───────────────────────── */

describe('R10 历史净化', () => {
  it('R10-01 超量历史只保留最近 DEFAULT_HISTORY_LIMIT 条', async () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 50; i++) history.push({ role: i % 2 ? 'assistant' : 'user', content: `第${i}轮` });
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', history, fetchImpl: fetch, streamFinal: false })
    );
    const msgs = calls[0]!.body.messages;
    expect(msgs).toHaveLength(1 + DEFAULT_HISTORY_LIMIT + 1);
    expect(msgs[1].content).toBe('第42轮');
    expect(msgs.at(-2).content).toBe('第49轮');
  });

  it('R10-02 单条超长历史被裁剪到 MAX_HISTORY_CHARS 且以省略号收尾', async () => {
    const history: ChatMessage[] = [{ role: 'user', content: '长'.repeat(100_000) }];
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', history, fetchImpl: fetch, streamFinal: false })
    );
    const h = calls[0]!.body.messages[1].content as string;
    expect(h).toHaveLength(MAX_HISTORY_CHARS);
    expect(h.endsWith('…')).toBe(true);
  });

  it('R10-03 非法角色（tool/system）与空内容被剔除', async () => {
    const history = [
      { role: 'tool', content: '工具结果' },
      { role: 'system', content: '注入的系统提示' },
      { role: 'user', content: '' },
      { role: 'user', content: '有效提问' },
    ] as unknown as ChatMessage[];
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', history, fetchImpl: fetch, streamFinal: false })
    );
    const msgs = calls[0]!.body.messages;
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'user']);
    expect(msgs[1].content).toBe('有效提问');
  });

  it('R10-04 正常短历史原样保留（不误伤）', async () => {
    const history: ChatMessage[] = [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
    ];
    const { fetch, calls } = jsonFetchMock(() => openaiTextResponse('ok'));
    await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: '第二问', history, fetchImpl: fetch, streamFinal: false })
    );
    const msgs = calls[0]!.body.messages;
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs[1].content).toBe('第一问');
    expect(msgs[2].content).toBe('第一答');
  });
});

/* ─────────────────── F16/F17 沙箱状态一致性 ─────────────────── */

describe('R11 沙箱状态', () => {
  it('R11-01 连续三次 append 内容全部保留（修复前只留最后一次）', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    sb.tools.append_to_note({ id: 'a', text: 'X' });
    sb.tools.append_to_note({ id: 'a', text: 'Y' });
    sb.tools.append_to_note({ id: 'a', text: 'Z' });
    const after = sb.pending()[0]!.after!;
    expect(after).toContain('X');
    expect(after).toContain('Y');
    expect(after).toContain('Z');
  });

  it('R11-02 append 后 read_note 能读到累积内容', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    sb.tools.append_to_note({ id: 'a', text: 'X' });
    sb.tools.append_to_note({ id: 'a', text: 'Y' });
    const r = sb.tools.read_note({ id: 'a' });
    expect(r.ok).toBe(true);
    expect(r.data!.note.content).toContain('X');
    expect(r.data!.note.content).toContain('Y');
  });

  it('R11-03 待删除笔记上 append 应报错', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    sb.tools.delete_note({ id: 'a' });
    expect(sb.tools.append_to_note({ id: 'a', text: 'X' }).ok).toBe(false);
  });

  it('R11-04 append 的 before 始终是落库前的原始内容', () => {
    const v = seedVault();
    const original = v.get('a')!.content;
    const sb = createSandboxSession(v, { allowWrite: true });
    sb.tools.append_to_note({ id: 'a', text: 'X' });
    sb.tools.append_to_note({ id: 'a', text: 'Y' });
    expect(sb.pending()[0]!.before).toBe(original);
  });

  it('R11-05 acceptAll 部分失败：成功项出队、失败项保留', () => {
    const v = seedVault();
    const sb = createSandboxSession(v, { allowWrite: true });
    sb.tools.write_note({ id: 'ok1', name: 'ok1.md', content: 'x' });
    sb.tools.write_note({ id: 'boom', name: 'boom.md', content: 'y' });
    (v as any).upsert = (note: { id: string }) => {
      if (note.id === 'boom') throw new Error('disk full');
    };
    expect(() => sb.acceptAll()).toThrow(/部分失败/);
    expect(sb.pending().map((c) => c.id)).toEqual(['boom']);
  });

  it('R11-06 acceptAll 全成功时队列清空且返回条数', () => {
    const v = seedVault();
    const sb = createSandboxSession(v, { allowWrite: true });
    sb.tools.write_note({ id: 'n1', name: 'n1.md', content: 'x' });
    sb.tools.write_note({ id: 'n2', name: 'n2.md', content: 'y' });
    expect(sb.acceptAll()).toBe(2);
    expect(sb.pending()).toHaveLength(0);
    expect(v.get('n1')!.content).toBe('x');
    expect(v.get('n2')!.content).toBe('y');
  });
});

/* ─────────────── F18/F19/F20/F21 降级与错误包装 ─────────────── */

describe('R12 降级与错误处理', () => {
  it('R12-01 runToolAgent 网络异常：error 事件 + done，不向上抛', async () => {
    const { fetch } = jsonFetchMock(() => {
      throw new Error('ECONNREFUSED');
    });
    const { events, text } = await collectToolAgent(
      runToolAgent({
        cfg,
        tools: tools(),
        prompt: 'q',
        fetchImpl: fetch,
        streamFinal: false,
        retry: { retries: 0, baseDelayMs: 1 },
      })
    );
    const err = events.find((e) => e.type === 'error') as any;
    expect(err).toBeDefined();
    expect(err.message).toMatch(/ECONNREFUSED/);
    expect(events.at(-1)!.type).toBe('done');
    // 错误走 error 事件，不混入 delta 文本
    expect(text).toBe('');
  });

  it('R12-02 重试耗尽：error 事件带状态码，流仍以 done 收尾', async () => {
    const { fetch } = jsonFetchMock(() => ({ ok: false, status: 503, text: async () => 'down' }));
    const { events } = await collectToolAgent(
      runToolAgent({ cfg, tools: tools(), prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    expect((events.find((e) => e.type === 'error') as any).message).toMatch(/503/);
    expect(events.at(-1)!.type).toBe('done');
  });

  it('R12-03 runAgent 的 retrieve 抛错降级为一条失败的 retrieve 步骤', async () => {
    const { fetch } = streamFetchMock(() => ({
      ok: true,
      status: 200,
      body: linesBody(['data: [DONE]']),
    }));
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
    const first = events[0] as any;
    expect(first.type).toBe('retrieve');
    expect(first.step).toMatchObject({ ok: false });
    expect(first.step.summary).toMatch(/index corrupt/);
    expect(events.at(-1)!.type).toBe('done');
  });

  it('R12-04 响应 JSON 解析失败包装为 chat failed（修复前裸抛 SyntaxError）', async () => {
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
    const msg = (events.find((e) => e.type === 'error') as any).message as string;
    expect(msg).toContain('chat failed');
    expect(msg).toContain('JSON 解析失败');
  });

  it('R12-05 模型返回空响应时给出可识别提示（修复前静默空白）', async () => {
    const { fetch } = streamFetchMock(() => ({ ok: true, status: 200, body: linesBody(['data: [DONE]']) }));
    const { text, events } = await collectToolAgent(
      runToolAgent({
        cfg,
        tools: tools(),
        prompt: 'q',
        fetchImpl: jsonFetchMock(() => openaiTextResponse('')).fetch,
        streamFetch: fetch,
      })
    );
    expect(text).toContain(EMPTY_RESPONSE_HINT);
    expect(events.at(-1)!.type).toBe('done');
  });

  it('R12-06 runAgent 既有降级未被破坏：LLM 失败仍回退本地资料', async () => {
    const fetchImpl: FetchLike = async () =>
      ({ ok: false, status: 500, body: null, text: async () => '' }) as ResponseLike;
    const { text } = await collectAgent(
      runAgent({
        cfg,
        prompt: '苹果',
        retrieve: () => ({ context: '本地资料ABC', trace: [] }),
        fetchImpl,
      })
    );
    expect(text).toContain('LLM 调用失败');
    expect(text).toContain('本地资料ABC');
  });
});

/* ───────────────────────── F7 响应体校验 ───────────────────────── */

describe('R13 流式响应体', () => {
  it('R13-01 非流响应体抛错（修复前静默空文本）', async () => {
    const fetchImpl: FetchLike = async () =>
      ({ ok: true, status: 200, body: 'not-a-stream' }) as ResponseLike;
    await expect(collectStream(streamChat(cfg, { messages: [] }, fetchImpl))).rejects.toThrow(
      /不是可读流/
    );
  });

  it('R13-02 ReadableStream(getReader) 分支仍正常（不误伤）', async () => {
    const enc = new TextEncoder();
    const lines = ['data: {"choices":[{"delta":{"content":"你"}}]}', 'data: [DONE]'];
    let i = 0;
    const fetchImpl: FetchLike = async () =>
      ({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () =>
              i < lines.length
                ? { done: false, value: enc.encode(lines[i++] + '\n') }
                : { done: true, value: undefined },
          }),
        },
      }) as unknown as ResponseLike;
    expect(await collectStream(streamChat(cfg, { messages: [] }, fetchImpl))).toBe('你');
  });

  it('R13-03 异步可迭代分支仍正常（不误伤）', async () => {
    const fetchImpl: FetchLike = async () =>
      ({
        ok: true,
        status: 200,
        body: linesBody(['data: {"choices":[{"delta":{"content":"好"}}]}', 'data: [DONE]']),
      }) as ResponseLike;
    expect(await collectStream(streamChat(cfg, { messages: [] }, fetchImpl))).toBe('好');
  });

  it('R13-04 空 body 仍按原逻辑报 LLM 请求失败', async () => {
    const fetchImpl: FetchLike = async () =>
      ({ ok: true, status: 200, body: null, text: async () => '' }) as ResponseLike;
    await expect(collectStream(streamChat(cfg, { messages: [] }, fetchImpl))).rejects.toThrow(
      /LLM 请求失败/
    );
  });
});

/* ─────────────── 集成：真实 Vault 上的端到端工具循环 ─────────────── */

describe('R14 集成：真实 Vault + 重试 + 工具循环 + 沙箱', () => {
  it('R14-01 工具循环端到端：search → 回填 → 最终答复，且笔记内容来自真实 Vault', async () => {
    const vault = new Vault();
    vault.upsert({ id: 'n1', name: '笔记一.md', content: '# 标题\n这里提到 苹果 的种植' });
    vault.upsert({ id: 'n2', name: '笔记二.md', content: '# 标题\n这里提到 香蕉' });
    const t = createVaultTools(vault);

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
                    {
                      id: 'c1',
                      type: 'function',
                      function: { name: 'search', arguments: '{"query":"苹果"}' },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      if (n === 2) return openaiTextResponse('答案在笔记一.md');
      throw new Error('unexpected call');
    });

    const { events, text } = await collectToolAgent(
      runToolAgent({ cfg, tools: t, prompt: '苹果在哪', fetchImpl: fetch, streamFinal: false })
    );
    const toolEv = events.find((e) => e.type === 'tool') as any;
    expect(toolEv.name).toBe('search');
    expect(toolEv.ok).toBe(true);
    expect(text).toContain('笔记一.md');
    expect(events.at(-1)!.type).toBe('done');
  });

  it('R14-02 集成：模型乱传参数时工具报错但不中断，最终仍能作答', async () => {
    const t = createVaultTools(seedVault());
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
                    { id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } },
                  ],
                },
              },
            ],
          }),
        };
      }
      return openaiTextResponse('检索参数有误，已跳过');
    });
    const { events, text } = await collectToolAgent(
      runToolAgent({ cfg, tools: t, prompt: 'q', fetchImpl: fetch, streamFinal: false })
    );
    const toolEv = events.find((e) => e.type === 'tool') as any;
    expect(toolEv.ok).toBe(false);
    expect(toolEv.summary).toContain('query');
    expect(text).toContain('检索参数有误');
  });

  it('R14-03 集成：沙箱写入需 Accept 才落库，Reject 后原文不变', () => {
    const vault = seedVault();
    const before = vault.get('a')!.content;
    const sb = createSandboxSession(vault, { allowWrite: true });
    sb.tools.write_note({ id: 'a', name: 'Alpha.md', content: '被改写了' });
    expect(vault.get('a')!.content).toBe(before);
    expect(sb.rejectAll()).toBe(1);
    expect(vault.get('a')!.content).toBe(before);
  });
});
