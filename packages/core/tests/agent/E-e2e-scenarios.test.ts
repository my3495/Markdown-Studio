/**
 * E2E Agent 场景测试：工具循环检测、多 Provider 兼容性、Token 估算边界、
 * 错误恢复、沙箱写入路径。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Vault } from '../../src/vault/vault';
import { createSandboxSession } from '../../src/agent/sandbox';
import { createVaultTools, type VaultTools } from '../../src/agent/tools';
import { estimateTokens } from '../../src/agent/tokens';
import { runToolAgent } from '../../src/agent/fc';
import { type RetryPolicy } from '../../src/agent/llm';

// ══════════════════════════════════════════════════════════════
// 1. 工具循环检测（连续调用相同工具 4 次应停止）
// ══════════════════════════════════════════════════════════════

describe('E2E-1 工具循环检测', () => {
  let vault: Vault;
  let tools: VaultTools;

  beforeEach(() => {
    vault = new Vault();
    vault.upsert({ id: 'n1', name: 'Note 1', content: 'Hello world' });
    tools = createVaultTools(vault, { allowWrite: true });
  });

  it('同一 (name, args) 调用超过 3 次时停止循环并返回 error summary', async () => {
    // 用 mock spy 拦截工具调用
    const searchResults = [
      { id: 'n1', name: 'Note 1', score: 1.0, snippet: 'Hello world' },
      { id: 'n1', name: 'Note 1', score: 1.0, snippet: 'Hello world' },
      { id: 'n1', name: 'Note 1', score: 1.0, snippet: 'Hello world' },
      { id: 'n1', name: 'Note 1', score: 1.0, snippet: 'Hello world' },
    ];
    let searchCallCount = 0;

    // 拦截 tools.call 来模拟无限搜索循环
    vi.spyOn(tools, 'call').mockImplementation((name) => {
      if (name === 'search') {
        searchCallCount++;
        return { ok: true, data: searchResults };
      }
      if (name === 'read_note') {
        return { ok: true, data: { note: { id: 'n1', name: 'Note 1', content: 'Hello world' } } };
      }
      return { ok: false, error: `unknown tool: ${name}` };
    });

    // 模拟 LLM：始终返回 tool_calls（模拟模型持续想搜索）
    let llmCallCount = 0;
    const mockFetch = async () => {
      llmCallCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: `call_${llmCallCount}`,
                    type: 'function',
                    function: { name: 'search', arguments: JSON.stringify({ query: 'hello' }) },
                  },
                ],
              },
            },
          ],
        }),
      };
    };

    const events: { type: string; summary?: string }[] = [];
    for await (const ev of runToolAgent({
      cfg: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
      tools,
      prompt: 'Find notes about hello',
      fetchImpl: mockFetch as any,
      maxSteps: 10, // 允许足够多步数
    })) {
      events.push({ type: ev.type, summary: 'summary' in ev ? (ev as any).summary : undefined });
    }

    // 验证循环检测工作：应该检测到重复调用并停止
    const toolEvents = events.filter((e) => e.type === 'tool');
    const failedEvents = toolEvents.filter((e) => {
      return e.summary?.includes('重复调用检测');
    });

    expect(failedEvents.length).toBeGreaterThanOrEqual(1);
    expect(events[events.length - 1]).toEqual({ type: 'done', summary: undefined });
    // search 被调用 3 次后，第 4 次被循环检测阻止
    expect(searchCallCount).toBeGreaterThanOrEqual(3);
  });

  it('不同参数的工具调用不受循环检测影响', async () => {
    const queries = ['hello', 'world', 'note', 'test', 'data'];
    let queryIndex = 0;

    vi.spyOn(tools, 'call').mockImplementation((name, args) => {
      if (name === 'search') {
        const query = (args as any)?.query ?? '';
        return {
          ok: true,
          data: [{ id: 'n1', name: `${query}.md`, score: 1.0, snippet: `${query} content` }],
        };
      }
      if (name === 'read_note') {
        return { ok: true, data: { note: { id: 'n1', name: 'Note 1', content: 'Hello world' } } };
      }
      return { ok: false, error: `unknown tool: ${name}` };
    });

    // 模拟 LLM：每次返回不同查询的 tool_calls
    const mockFetch = async () => {
      const q = queries[queryIndex % queries.length];
      queryIndex++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: `call_${queryIndex}`,
                    type: 'function',
                    function: { name: 'search', arguments: JSON.stringify({ query: q }) },
                  },
                ],
              },
            },
          ],
        }),
      };
    };

    const events: string[] = [];
    for await (const ev of runToolAgent({
      cfg: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
      tools,
      prompt: 'Find notes',
      fetchImpl: mockFetch as any,
      maxSteps: 8,
    })) {
      events.push(ev.type);
    }

    // 不同参数调用不受循环检测限制，应该完成多轮
    const toolEvents = events.filter((e) => e === 'tool');
    expect(toolEvents.length).toBeGreaterThan(4);
    expect(events[events.length - 1]).toBe('done');
  });
});

// ══════════════════════════════════════════════════════════════
// 2. 多 Provider 兼容性（Ollama / OpenAI / Anthropic）
// ══════════════════════════════════════════════════════════════

describe('E2E-2 多 Provider 兼容性', () => {
  it('OpenAI 兼容 Provider 能正常完成对话', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'This is a test response',
              tool_calls: [],
            },
          },
        ],
      }),
    });

    const vault = new Vault();
    const tools = createVaultTools(vault, { allowWrite: false });

    const events: string[] = [];
    for await (const ev of runToolAgent({
      cfg: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
      tools,
      prompt: 'Hello',
      fetchImpl: mockFetch as any,
    })) {
      events.push(ev.type);
    }

    expect(events).toContain('delta');
    expect(events[events.length - 1]).toBe('done');
  });

  it('Anthropic (Claude) 能正常完成对话', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        type: 'message',
        id: 'msg_123',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Response from Anthropic' },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    const vault = new Vault();
    const tools = createVaultTools(vault, { allowWrite: false });

    const events: string[] = [];
    for await (const ev of runToolAgent({
      cfg: { provider: 'claude', model: 'claude-3-sonnet', apiKey: 'sk-ant-test' },
      tools,
      prompt: 'Hello',
      fetchImpl: mockFetch as any,
    })) {
      events.push(ev.type);
    }

    expect(events).toContain('delta');
    expect(events[events.length - 1]).toBe('done');
  });

  it('Ollama (native) 能正常完成对话', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        message: {
          role: 'assistant',
          content: 'Response from Ollama',
        },
        done: true,
        prompt_eval_count: 5,
        eval_count: 8,
      }),
    });

    const vault = new Vault();
    const tools = createVaultTools(vault, { allowWrite: false });

    const events: string[] = [];
    for await (const ev of runToolAgent({
      cfg: { provider: 'ollama', model: 'qwen2.5', baseUrl: 'http://localhost:11434' },
      tools,
      prompt: 'Hello',
      fetchImpl: mockFetch as any,
    })) {
      events.push(ev.type);
    }

    expect(events).toContain('delta');
    expect(events[events.length - 1]).toBe('done');
  });
});

// ══════════════════════════════════════════════════════════════
// 3. Token 估算边界（纯中文 / 纯英文 / 中英混合 / 含韩文）
// ══════════════════════════════════════════════════════════════

describe('E2E-3 Token 估算边界', () => {
  it('纯中文文本估算', () => {
    const chinese = '这是一段纯中文文本，用于测试Token估算功能。';
    const tokens = estimateTokens(chinese);
    expect(tokens).toBeGreaterThan(0);
    // 中文约 1.2 token/字，22 字约 26 token
    expect(tokens).toBeGreaterThanOrEqual(15);
    expect(tokens).toBeLessThanOrEqual(35);
  });

  it('纯英文文本估算', () => {
    const english = 'This is a pure English text for testing token estimation.';
    const tokens = estimateTokens(english);
    expect(tokens).toBeGreaterThan(0);
    // 英文约 4 字符/token，54 字符约 13.5 token
    expect(tokens).toBeGreaterThanOrEqual(8);
    expect(tokens).toBeLessThanOrEqual(25);
  });

  it('中英混合文本估算', () => {
    const mixed = 'Hello 你好 World 世界 123 数字';
    const tokens = estimateTokens(mixed);
    expect(tokens).toBeGreaterThan(0);
    // 混合文本应在合理范围内
    expect(tokens).toBeLessThan(50);
  });

  it('含韩文文本估算', () => {
    const korean = '안녕하세요 Korean text 테스트中韩文混合';
    const tokens = estimateTokens(korean);
    expect(tokens).toBeGreaterThan(0);
    // 验证韩文字符被正确识别
    const koreanChars = (korean.match(/[\uAC00-\uD7AF]/g) || []).length;
    expect(koreanChars).toBeGreaterThan(0);
    // 韩文约 0.35 token/字符
    expect(tokens).toBeLessThan(50);
  });

  it('空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('仅空格返回 1', () => {
    const tokens = estimateTokens('   ');
    expect(tokens).toBeGreaterThanOrEqual(1);
  });

  it('长文本估算稳定', () => {
    // '测' = 1 字符，重复 2000 次 = 2000 字符
    // CJK: 2000 * 1.2 = 2400 token
    const long = '测'.repeat(2000);
    const tokens = estimateTokens(long);
    expect(tokens).toBeGreaterThanOrEqual(2000);
    expect(tokens).toBeLessThanOrEqual(3000);
  });

  it('日文假名正确估算', () => {
    const japanese = 'こんにちは Katakana カタカナ';
    const tokens = estimateTokens(japanese);
    expect(tokens).toBeGreaterThan(0);
    // 日文假名也在 CJK 范围内
    expect(tokens).toBeLessThan(50);
  });
});

// ══════════════════════════════════════════════════════════════
// 4. 错误恢复（网络错误 / 超时 / 无效响应）
// ══════════════════════════════════════════════════════════════

describe('E2E-4 错误恢复', () => {
  it('网络错误触发重试', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Network error');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'Success after retry' } }],
        }),
      };
    };

    const vault = new Vault();
    const tools = createVaultTools(vault);
    const policy: RetryPolicy = { retries: 3, baseDelayMs: 10 };

    const events: string[] = [];
    for await (const ev of runToolAgent({
      cfg: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
      tools,
      prompt: 'Test',
      fetchImpl: mockFetch as any,
      retry: policy,
    })) {
      events.push(ev.type);
    }

    expect(attempts).toBe(3);
    expect(events).toContain('retry');
    expect(events[events.length - 1]).toBe('done');
  });

  it('5xx 错误触发重试', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts < 2) {
        return {
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'Recovered' } }],
        }),
      };
    };

    const vault = new Vault();
    const tools = createVaultTools(vault);
    const policy: RetryPolicy = { retries: 2, baseDelayMs: 10 };

    const events: string[] = [];
    for await (const ev of runToolAgent({
      cfg: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
      tools,
      prompt: 'Test',
      fetchImpl: mockFetch as any,
      retry: policy,
    })) {
      events.push(ev.type);
    }

    expect(attempts).toBe(2);
    expect(events).toContain('retry');
    expect(events[events.length - 1]).toBe('done');
  });

  it('无效 JSON 响应返回 error 事件', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '这不是有效的 JSON 响应',
    });

    const vault = new Vault();
    const tools = createVaultTools(vault);

    const events: string[] = [];
    for await (const ev of runToolAgent({
      cfg: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
      tools,
      prompt: 'Test',
      fetchImpl: mockFetch as any,
    })) {
      events.push(ev.type);
    }

    expect(events).toContain('error');
    expect(events[events.length - 1]).toBe('done');
  });

  it('空 prompt 抛出错误', async () => {
    const vault = new Vault();
    const tools = createVaultTools(vault);

    await expect(async () => {
      const events: string[] = [];
      for await (const ev of runToolAgent({
        cfg: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' },
        tools,
        prompt: '   ',
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' }) as any,
      })) {
        events.push(ev.type);
      }
    }).rejects.toThrow('prompt 为空');
  });
});

// ══════════════════════════════════════════════════════════════
// 5. 沙箱写入路径（write / append / delete 路径验证）
// ══════════════════════════════════════════════════════════════

describe('E2E-5 沙箱写入路径', () => {
  let vault: Vault;

  beforeEach(() => {
    vault = new Vault();
    vault.upsert({ id: 'existing', name: 'Existing.md', content: 'Original content' });
  });

  it('write_note 路径：先入队，accept 后落库', () => {
    const sb = createSandboxSession(vault, { allowWrite: true });

    // 写入前验证未落库
    const r1 = sb.tools.write_note({ id: 'new', name: 'New.md', content: 'New content' });
    expect(r1.ok).toBe(true);
    expect(vault.get('new')).toBeNull();
    expect(sb.pending()).toHaveLength(1);

    // accept 后落库
    const accepted = sb.acceptAll();
    expect(accepted).toBe(1);
    expect(vault.get('new')?.content).toBe('New content');
    expect(sb.pending()).toHaveLength(0);
  });

  it('append_to_note 路径：正确追加内容', () => {
    const sb = createSandboxSession(vault, { allowWrite: true });

    const r1 = sb.tools.append_to_note({ id: 'existing', text: '\nAppended line 1' });
    expect(r1.ok).toBe(true);

    const r2 = sb.tools.append_to_note({ id: 'existing', text: '\nAppended line 2' });
    expect(r2.ok).toBe(true);

    // 两次 append 合并为一次 pending
    expect(sb.pending()).toHaveLength(1);
    const pending = sb.pending()[0];
    expect(pending.after).toContain('Appended line 1');
    expect(pending.after).toContain('Appended line 2');

    sb.acceptAll();
    expect(vault.get('existing')?.content).toContain('Appended line 2');
  });

  it('delete_note 路径：先入队标记删除，reject 后恢复', () => {
    const sb = createSandboxSession(vault, { allowWrite: true });

    // 验证笔记存在
    expect(vault.get('existing')).not.toBeNull();

    // 删除入队
    const r = sb.tools.delete_note({ id: 'existing' });
    expect(r.ok).toBe(true);

    // pending 中
    const pending = sb.pending()[0];
    expect(pending.op).toBe('delete');
    expect(pending.before).toBe('Original content');
    expect(pending.after).toBeNull();

    // 拒绝删除
    const rejected = sb.rejectAll();
    expect(rejected).toBe(1);
    expect(vault.get('existing')?.content).toBe('Original content');
  });

  it('allowWrite=false 时写操作被拒绝', () => {
    const sb = createSandboxSession(vault, { allowWrite: false });

    const w = sb.tools.write_note({ name: 'Test.md', content: 'Test' });
    expect(w.ok).toBe(false);
    expect(w.error).toContain('write disabled');

    const a = sb.tools.append_to_note({ id: 'existing', text: 'test' });
    expect(a.ok).toBe(false);
    expect(a.error).toContain('write disabled');

    const d = sb.tools.delete_note({ id: 'existing' });
    expect(d.ok).toBe(false);
    expect(d.error).toContain('write disabled');
  });

  it('幂等键确保重试不重复追加', () => {
    const sb = createSandboxSession(vault, { allowWrite: true });

    // 首次调用
    const r1 = sb.tools.append_to_note({
      id: 'existing',
      text: 'Once',
      idempotencyKey: 'unique-key-1',
    });
    expect(r1.ok).toBe(true);

    // 同幂等键再次调用应复用结果
    const r2 = sb.tools.append_to_note({
      id: 'existing',
      text: 'Twice (should not appear)',
      idempotencyKey: 'unique-key-1',
    });
    expect(r2.ok).toBe(true);

    // 内容只追加了一次
    const pending = sb.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].after).toContain('Once');
    expect(pending[0].after).not.toContain('Twice');
  });

  it('个别 accept/reject 操作', () => {
    const sb = createSandboxSession(vault, { allowWrite: true });

    sb.tools.write_note({ id: 'a', name: 'A.md', content: 'Content A' });
    sb.tools.write_note({ id: 'b', name: 'B.md', content: 'Content B' });

    expect(sb.pending()).toHaveLength(2);

    // 只接受 a
    const accepted = sb.accept('write:a');
    expect(accepted).toBe(true);
    expect(vault.get('a')?.content).toBe('Content A');
    expect(vault.get('b')).toBeNull();
    expect(sb.pending()).toHaveLength(1);

    // 拒绝 b
    const rejected = sb.reject('write:b');
    expect(rejected).toBe(true);
    expect(sb.pending()).toHaveLength(0);
    expect(vault.get('b')).toBeNull();
  });

  it('sandbox 读操作返回 pending 叠加视图', () => {
    const sb = createSandboxSession(vault, { allowWrite: true });

    // 写入修改
    sb.tools.write_note({ id: 'existing', name: 'Existing.md', content: 'Modified content' });

    // 读取应返回 pending 修改后的内容
    const r = sb.tools.read_note({ id: 'existing' });
    expect(r.ok).toBe(true);
    expect(r.data?.note.content).toBe('Modified content');

    // 原始 vault 未被修改
    expect(vault.get('existing')?.content).toBe('Original content');
  });

  it('sandbox 新建笔记可被读取', () => {
    const sb = createSandboxSession(vault, { allowWrite: true });

    // 新建笔记
    sb.tools.write_note({ id: 'brand-new', name: 'Brand New.md', content: 'Brand new content' });

    // 读取新建笔记（尚未 accept）
    const r = sb.tools.read_note({ id: 'brand-new' });
    expect(r.ok).toBe(true);
    expect(r.data?.note.content).toBe('Brand new content');

    // 原始 vault 中不存在
    expect(vault.get('brand-new')).toBeNull();
  });

  it('sandbox delete 后读取应返回 not found', () => {
    const sb = createSandboxSession(vault, { allowWrite: true });

    // 删除笔记
    sb.tools.delete_note({ id: 'existing' });

    // 读取应返回 not found
    const r = sb.tools.read_note({ id: 'existing' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not found');
  });
});
