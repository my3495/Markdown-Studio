/**
 * R7 — 通用消息预算（context.ts）的契约锁定。
 *
 * 关键契约：
 * 1. `fitToBudget`：超 budget 时保留前 budget-1 字符并加省略号；不超则原样返回。
 * 2. `composeWithBudget`：单块预算 + 总量 headroom；超总预算时按 trimOrder 缩。
 * 3. `clipMessages`：messages[] 整体保护；user/system 分别有预算；总量超限时优先裁旧消息。
 * 4. 裁剪不能改变消息顺序与角色，只能改 content。
 */

import { describe, it, expect } from 'vitest';
import { fitToBudget, composeWithBudget, clipMessages } from '../../src/agent/context';

describe('R7 通用消息预算（context.ts）', () => {
  /* ───────────── fitToBudget ───────────── */
  it('R7-10 fitToBudget 不超预算时原样返回', () => {
    expect(fitToBudget('hello', 10)).toBe('hello');
  });
  it('R7-11 fitToBudget 超出时返回 budget-1 字符 + 省略号', () => {
    const out = fitToBudget('hello world', 6);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBe(6);
    expect(out.slice(0, 5)).toBe('hello');
  });
  it('R7-12 fitToBudget 预算为 0 时返回空串', () => {
    expect(fitToBudget('x', 0)).toBe('');
  });
  it('R7-13 fitToBudget 预算为负时也返回空串', () => {
    expect(fitToBudget('x', -3)).toBe('');
  });

  /* ───────────── composeWithBudget ───────────── */
  it('R7-14 composeWithBudget 不超总预算时 trimmed 为空', () => {
    const r = composeWithBudget(
      [
        { name: 'a', text: 'short' },
        { name: 'b', text: 'also short' },
      ],
      { totalBudget: 1000 }
    );
    expect(r.text).toContain('short');
    expect(r.text).toContain('also short');
    expect(r.trimmed).toEqual([]);
  });
  it('R7-15 composeWithBudget 单块超自身预算时该块名进 trimmed', () => {
    const r = composeWithBudget(
      [
        { name: 'small', text: 'abc' },
        { name: 'big', text: 'x'.repeat(200), budget: 10 },
      ],
      { totalBudget: 1000 }
    );
    expect(r.trimmed).toContain('big');
    // 块被裁到 10 字符
    const segs = r.text.split('\n\n');
    expect(segs[1].length).toBe(10);
  });
  it('R7-16 composeWithBudget 超总量时按 trimOrder=newest-first 从末往前缩', () => {
    const r = composeWithBudget(
      [
        { name: 'old', text: 'x'.repeat(200) },
        { name: 'mid', text: 'y'.repeat(200) },
        { name: 'new', text: 'z'.repeat(200) },
      ],
      { totalBudget: 200, trimOrder: 'newest-first' }
    );
    // 'new' 应接近原长（200），'old' 应被裁到接近 0（保护 newer）
    const newSeg = r.text.slice(-200);
    expect(newSeg.length).toBeGreaterThanOrEqual(150);
  });
  it('R7-17 composeWithBudget headroom 把 totalBudget 再扣掉', () => {
    const r = composeWithBudget(
      [{ name: 'p', text: 'x'.repeat(100) }],
      { totalBudget: 100, headroom: 80 }
    );
    // 实际可用 20 字符
    expect(r.finalLength).toBeLessThanOrEqual(20);
  });
  it('R7-18 composeWithBudget headroom 留出的余量给未来插入', () => {
    const r = composeWithBudget(
      [{ name: 'p', text: 'abcde' }],
      { totalBudget: 5, headroom: 0 }
    );
    expect(r.text).toBe('abcde');
    const r2 = composeWithBudget(
      [{ name: 'p', text: 'abcde' }],
      { totalBudget: 5, headroom: 10 }
    );
    // 总量超可用：被裁
    expect(r2.text.length).toBeLessThan(5);
  });
  it('R7-19 composeWithBudget trimOrder=oldest-first 时先裁首段，再裁末段', () => {
    // 总长 400 > 250，oldest-first 模式下先压缩 old；若仍超 cap 才动 new。
    // 验证：finalLength ≤ totalBudget，且 'old' 必被裁。
    const r = composeWithBudget(
      [
        { name: 'old', text: 'x'.repeat(200) },
        { name: 'new', text: 'y'.repeat(200) },
      ],
      { totalBudget: 250, trimOrder: 'oldest-first' }
    );
    expect(r.finalLength).toBeLessThanOrEqual(250);
    expect(r.trimmed).toContain('old');
  });

  /* ───────────── clipMessages ───────────── */
  it('R7-20 clipMessages 不超总预算时不裁任何消息', () => {
    const r = clipMessages(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      { totalBudget: 1000 }
    );
    expect(r.trimmed).toEqual([]);
    expect(r.messages).toHaveLength(2);
  });
  it('R7-21 clipMessages 单条超 perMessageBudget 时该条被裁', () => {
    const r = clipMessages(
      [{ role: 'user', content: 'x'.repeat(5000) }],
      { perMessageBudget: 100, totalBudget: 100_000 }
    );
    expect(r.messages[0].content.length).toBeLessThanOrEqual(120); // 留 marker
    expect(r.trimmed).toContain('user#0');
  });
  it('R7-22 clipMessages system 走 systemBudget，其他走 perMessageBudget', () => {
    const r = clipMessages(
      [
        { role: 'system', content: 's'.repeat(2000) },
        { role: 'user', content: 'u'.repeat(2000) },
      ],
      { systemBudget: 100, perMessageBudget: 8000, totalBudget: 100_000 }
    );
    expect(r.messages[0].content.length).toBeLessThanOrEqual(120);
    expect(r.messages[1].content.length).toBe(2000); // 没动
  });
  it('R7-23 clipMessages 超总预算时按从后往前逐条缩，旧消息至少被压缩 1 次', () => {
    const r = clipMessages(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'u'.repeat(900) },
        { role: 'assistant', content: 'a'.repeat(900) },
        { role: 'user', content: 'u2'.repeat(900) },
      ],
      { perMessageBudget: 8000, totalBudget: 1000, markTrimmed: false }
    );
    // 总量已压到 totalBudget 以内
    expect(r.finalLength).toBeLessThanOrEqual(1000);
    // 旧消息（user#1）至少被缩 1 次：从 900 缩到 < 900
    expect(r.messages[1].content.length).toBeLessThan(900);
  });
  it('R7-24 clipMessages markTrimmed=false 时不追加 [已截断] 标记', () => {
    const r = clipMessages(
      [{ role: 'user', content: 'x'.repeat(5000) }],
      { perMessageBudget: 100, totalBudget: 100_000, markTrimmed: false }
    );
    expect(r.messages[0].content).not.toContain('[已截断');
  });
  it('R7-25 clipMessages 不改变消息顺序与角色', () => {
    const r = clipMessages(
      [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
      ],
      { totalBudget: 1000 }
    );
    expect(r.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });
  it('R7-26 clipMessages 报告 originalLength / finalLength', () => {
    const r = clipMessages(
      [{ role: 'user', content: 'x'.repeat(5000) }],
      { perMessageBudget: 100, totalBudget: 100_000 }
    );
    expect(r.originalLength).toBe(5000);
    expect(r.finalLength).toBeLessThan(5000);
  });
});
