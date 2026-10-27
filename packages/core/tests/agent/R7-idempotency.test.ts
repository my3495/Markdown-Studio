/**
 * R7 — 通用幂等缓存（idempotency.ts）的契约锁定。
 *
 * 关键契约（详见 packages/core/src/agent/idempotency.ts 注释）：
 * 1. 仅成功（ok:true）的结果被缓存。
 * 2. 失败结果不固化，下一次同 key 调用会重新执行。
 * 3. 缓存命中直接返回首次成功结果，run 不会被再次调用。
 * 4. key 非字符串 / 空串时不做去重，照常执行。
 * 5. clear() 清空缓存；size 用于观测。
 *
 * 该模块已被 sandbox 写工具采用，未来可用于任何需要「可修正重试」的副作用去重。
 */

import { describe, it, expect, vi } from 'vitest';
import { createIdempotencyCache } from '../../src/agent/idempotency';

describe('R7 通用幂等缓存（idempotency.ts）', () => {
  it('R7-01 命中已缓存的成功结果时不会再次执行 run', () => {
    const cache = createIdempotencyCache<{ ok: boolean; data?: string }>();
    const run = vi.fn(() => ({ ok: true, data: 'v1' }));
    expect(cache.run('k1', run)).toEqual({ ok: true, data: 'v1' });
    expect(cache.run('k1', run)).toEqual({ ok: true, data: 'v1' });
    expect(cache.run('k1', run)).toEqual({ ok: true, data: 'v1' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('R7-02 失败结果不缓存：同 key 再调用会重跑（修复前：失败被固化）', () => {
    const cache = createIdempotencyCache<{ ok: boolean; error?: string }>();
    const run = vi
      .fn<[], { ok: boolean; error?: string }>()
      .mockReturnValueOnce({ ok: false, error: 'first fail' })
      .mockReturnValueOnce({ ok: true });
    expect(cache.run('k', run)).toEqual({ ok: false, error: 'first fail' });
    // 第二次同 key：未命中（因为失败不入缓存），应重跑
    expect(cache.run('k', run)).toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('R7-03 失败 → 修正后再失败也仍能继续重试（连续失败不锁死）', () => {
    const cache = createIdempotencyCache<{ ok: boolean; error?: string }>();
    const run = vi.fn(() => ({ ok: false, error: 'still bad' }));
    for (let i = 0; i < 5; i++) {
      expect(cache.run('same', run)).toEqual({ ok: false, error: 'still bad' });
    }
    expect(run).toHaveBeenCalledTimes(5);
  });

  it('R7-04 不同 key 各自独立缓存', () => {
    const cache = createIdempotencyCache<{ ok: boolean; data?: string }>();
    expect(cache.run('a', () => ({ ok: true, data: 'A' }))).toEqual({ ok: true, data: 'A' });
    expect(cache.run('b', () => ({ ok: true, data: 'B' }))).toEqual({ ok: true, data: 'B' });
    // 再次 a / b：均直接返回缓存
    expect(cache.run('a', () => ({ ok: true, data: 'A2' }))).toEqual({ ok: true, data: 'A' });
    expect(cache.run('b', () => ({ ok: true, data: 'B2' }))).toEqual({ ok: true, data: 'B' });
    expect(cache.size).toBe(2);
  });

  it('R7-05 非字符串 key（undefined / number / null）不做去重', () => {
    const cache = createIdempotencyCache<{ ok: boolean; n: number }>();
    let n = 0;
    const run = () => ({ ok: true, n: ++n });
    expect(cache.run(undefined, run)).toEqual({ ok: true, n: 1 });
    expect(cache.run(undefined, run)).toEqual({ ok: true, n: 2 });
    expect(cache.run(123 as unknown as string, run)).toEqual({ ok: true, n: 3 });
    expect(cache.run(null as unknown as string, run)).toEqual({ ok: true, n: 4 });
    // 没有真 key 被写入
    expect(cache.size).toBe(0);
  });

  it('R7-06 空字符串 key 视为无 key（不做去重）', () => {
    const cache = createIdempotencyCache<{ ok: boolean; n: number }>();
    let n = 0;
    const run = () => ({ ok: true, n: ++n });
    expect(cache.run('', run)).toEqual({ ok: true, n: 1 });
    expect(cache.run('', run)).toEqual({ ok: true, n: 2 });
    expect(cache.size).toBe(0);
  });

  it('R7-07 clear() 后同 key 视为新调用', () => {
    const cache = createIdempotencyCache<{ ok: boolean; n: number }>();
    let n = 0;
    const run = () => ({ ok: true, n: ++n });
    expect(cache.run('k', run)).toEqual({ ok: true, n: 1 });
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.run('k', run)).toEqual({ ok: true, n: 2 });
  });

  it('R7-08 run 抛错时不应污染缓存（异常等于失败，不缓存）', () => {
    const cache = createIdempotencyCache<{ ok: boolean; data?: string }>();
    const run = vi
      .fn<[], { ok: boolean; data?: string }>()
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockReturnValueOnce({ ok: true, data: 'recovered' });
    expect(() => cache.run('k', run)).toThrow('boom');
    expect(cache.run('k', run)).toEqual({ ok: true, data: 'recovered' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('R7-09 缓存值是首次 run 的引用，外部修改可见（用于上层叠加 pending 视图）', () => {
    const cache = createIdempotencyCache<{ ok: boolean; data: { n: number } }>();
    const first = { ok: true as const, data: { n: 1 } };
    cache.run('k', () => first);
    const r2 = cache.run('k', () => ({ ok: true, data: { n: 999 } }));
    expect(r2).toBe(first);
    expect(r2.data.n).toBe(1);
  });
});
