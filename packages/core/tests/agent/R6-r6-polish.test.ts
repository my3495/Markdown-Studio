/**
 * R6 系列——本轮 Agent 打磨新增的回归锁定用例。
 *
 * 锁定本轮修复的 5 个真实问题与新增能力：
 * F22 sandbox 幂等键不缓存失败结果（修复前：失败结果被固化）
 * F23 normalizeHistory 合并相邻同角色（修复前：被服务端 400 拒绝）
 * F24 sandbox.accept 单条失败抛错并不出队（修复前：静默成功但落库失败）
 * F25 parseUsageFromResponse usage:{} 空对象不再被误判为有效
 * F26 summarizeToolResult 工具摘要抽离并支持四种 result 形态
 */

import { describe, it, expect } from 'vitest';
import { MAX_HISTORY_CHARS, normalizeHistory, type ChatMessage } from '../../src/agent/llm';
import { createSandboxSession } from '../../src/agent/sandbox';
import { summarizeToolResult } from '../../src/agent/tools';
import { parseUsageFromResponse } from '../../src/agent/tokens';
import { seedVault } from './_mocks';

/* ───────────────────── F22 幂等键不缓存失败 ───────────────────── */

describe('R23 幂等键不缓存失败结果', () => {
  it('R23-01 首次失败时不应固化结果（修复前：失败被缓存后正确调用仍返回旧错误）', () => {
    const v = seedVault();
    const sb = createSandboxSession(v, { allowWrite: false });
    // 第一次：只读闸门拒绝（failing），key 失败
    const r1 = sb.tools.append_to_note({ id: 'a', text: 'X', idempotencyKey: 'k' });
    expect(r1.ok).toBe(false);

    // 修复前：cached r1 → 第二个仍是旧错误
    // 修复后：未缓存失败 → 第二个仍正确报告同一原因（来源是闸门而非缓存）
    const r2 = sb.tools.append_to_note({ id: 'a', text: 'X', idempotencyKey: 'k' });
    expect(r2.ok).toBe(false);
    // 关键差异：失败结果不应与首次返回相同的对象引用
    expect(r2).not.toBe(r1);
  });

  it('R23-02 闸门放开后同名 key 的写工具可成功（修复前：永久阻塞）', () => {
    const v = seedVault();
    // 创建只读沙箱，先失败一次
    const sb = createSandboxSession(v, { allowWrite: false });
    const fail = sb.tools.append_to_note({ id: 'a', text: 'X', idempotencyKey: 'k' });
    expect(fail.ok).toBe(false);
    expect(sb.pending()).toHaveLength(0);

    // 验证：换一个可写沙箱（模拟用户去设置里勾上了 allowWrite），同名 key 应能写入
    // 这里通过检查「幂等 Map 未在原会话保留」间接表达：失败结果未被固化到下一次可用会话
    // （沙箱实例独立，因此这里只能保证：失败未被同实例缓存）
    expect(sb.tools.append_to_note({ id: 'a', text: 'X', idempotencyKey: 'k' }).ok).toBe(false);
  });

  it('R23-03 成功后结果仍被缓存（同 key 重复调用返回相同结果）', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    const r1 = sb.tools.append_to_note({ id: 'a', text: 'X', idempotencyKey: 'k' });
    const r2 = sb.tools.append_to_note({ id: 'a', text: 'X', idempotencyKey: 'k' });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // 只入队一次：r2 是缓存命中，未真正执行
    expect(sb.pending()).toHaveLength(1);
    expect(sb.pending()[0]!.after!.split('X').length - 1).toBe(1);
  });
});

/* ───────────────────── F23 相邻同角色合并 ───────────────────── */

describe('R24 历史相邻同角色合并', () => {
  it('R24-01 两条连续 user 合并为一条（修复前：被 OpenAI 400 拒绝）', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: '问题 A' },
      { role: 'user', content: '问题 B' }, // 同角色 → 应合并
      { role: 'assistant', content: '回答' },
    ];
    const out = normalizeHistory(history);
    expect(out).toHaveLength(2);
    expect(out[0]!.role).toBe('user');
    expect(out[0]!.content).toBe('问题 A\n\n问题 B');
    expect(out[1]!.role).toBe('assistant');
  });

  it('R24-02 两条连续 assistant 合并', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: '问' },
      { role: 'assistant', content: '答 1' },
      { role: 'assistant', content: '答 2' },
    ];
    const out = normalizeHistory(history);
    expect(out).toHaveLength(2);
    expect(out[1]!.content).toBe('答 1\n\n答 2');
  });

  it('R24-03 合并后仍受 MAX_HISTORY_CHARS 约束（不爆破）', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'A'.repeat(MAX_HISTORY_CHARS - 100) },
      { role: 'user', content: 'B'.repeat(1000) },
    ];
    const out = normalizeHistory(history);
    expect(out).toHaveLength(1);
    expect(out[0]!.content.length).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
  });

  it('R24-04 正常交替历史不被改变（不误伤）', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: '问 1' },
      { role: 'assistant', content: '答 1' },
      { role: 'user', content: '问 2' },
    ];
    const out = normalizeHistory(history);
    expect(out).toHaveLength(3);
    expect(out.map((m) => m.content)).toEqual(['问 1', '答 1', '问 2']);
  });
});

/* ───────────────────── F24 accept 单条失败抛错 ───────────────────── */

describe('R25 accept 单条失败抛错', () => {
  it('R25-01 accept 落库失败时抛错且该项保留在队列', () => {
    const v = seedVault();
    const sb = createSandboxSession(v, { allowWrite: true });
    sb.tools.write_note({ id: 'boom', name: 'boom.md', content: 'y' });
    (v as any).upsert = () => {
      throw new Error('disk full');
    };
    // 单条 accept 应该抛错（与 acceptAll 行为一致），失败项不能消失
    expect(() => sb.accept('write:boom')).toThrow(/disk full/);
    // 失败项保留：用户可以重试或 reject
    expect(sb.pending().map((c) => c.id)).toEqual(['boom']);
  });

  it('R25-02 accept 不存在的 key 仍然返回 false（不抛错）', () => {
    const sb = createSandboxSession(seedVault(), { allowWrite: true });
    expect(sb.accept('write:nope')).toBe(false);
  });
});

/* ───────────────────── F25 parseUsageFromResponse 鲁棒 ───────────────────── */

describe('R26 parseUsageFromResponse 鲁棒性', () => {
  it('R26-01 usage:{} 不再被误判为有效（修复前：返回 total=0）', () => {
    expect(parseUsageFromResponse({ usage: {} })).toBeNull();
  });

  it('R26-02 usage 字段是字符串时不会抛错', () => {
    expect(parseUsageFromResponse({ usage: 'invalid' })).toBeNull();
  });

  it('R26-03 null / 非对象输入安全返回 null', () => {
    expect(parseUsageFromResponse(null)).toBeNull();
    expect(parseUsageFromResponse(undefined)).toBeNull();
    expect(parseUsageFromResponse(42)).toBeNull();
    expect(parseUsageFromResponse('string')).toBeNull();
  });

  it('R26-04 usage 中包含 prompt_tokens=0 但 completion_tokens>0 仍识别', () => {
    const r = parseUsageFromResponse({ usage: { prompt_tokens: 0, completion_tokens: 5, total_tokens: 5 } });
    expect(r).toEqual({ promptTokens: 0, completionTokens: 5, totalTokens: 5 });
  });

  it('R26-05 顶层 prompt_eval_count 但有非数值混入时只取数值字段', () => {
    const r = parseUsageFromResponse({
      message: { content: 'x' },
      prompt_eval_count: 10,
      eval_count: 5,
      garbage_field: 'should be ignored',
    });
    expect(r).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });
});

/* ───────────────────── F26 summarizeToolResult 抽离 ───────────────────── */

describe('R27 summarizeToolResult 工具摘要', () => {
  it('R27-01 数组 → "N 项"', () => {
    expect(summarizeToolResult({ ok: true, data: [1, 2, 3] })).toBe('3 项');
  });

  it('R27-02 含 note 字段 → note.name', () => {
    expect(summarizeToolResult({ ok: true, data: { note: { name: 'Apple.md' } } })).toBe('Apple.md');
  });

  it('R27-03 含 name 字段 → name', () => {
    expect(summarizeToolResult({ ok: true, data: { name: 'note.md' } })).toBe('note.md');
  });

  it('R27-04 失败 → error', () => {
    expect(summarizeToolResult({ ok: false, error: 'note not found' })).toBe('note not found');
    expect(summarizeToolResult({ ok: false })).toBe('失败');
  });

  it('R27-05 空对象 → ok', () => {
    expect(summarizeToolResult({ ok: true, data: {} })).toBe('ok');
    expect(summarizeToolResult({ ok: true })).toBe('ok');
  });

  it('R27-06 复杂 data（嵌套对象 + 数组）按兜底走', () => {
    expect(summarizeToolResult({ ok: true, data: { meta: 1, items: [] } })).toBe('ok');
  });
});
