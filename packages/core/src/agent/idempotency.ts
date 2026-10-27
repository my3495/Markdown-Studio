/**
 * 通用「仅成功才缓存」幂等包装。
 *
 * 适用场景：副作用操作（写库 / 发请求 / 入队）可能被上游重试、模型重发、网络层重试，
 * 直接缓存所有结果会把「权限拒绝」「参数错误」之类的失败永久固化，下游同 key 重试永远拿不到
 * 修正后的结果。
 *
 * 设计契约：
 * 1. 仅当 `run()` 返回 truthy 且 `result.ok === true` 时才把结果写入缓存；
 *    失败结果不缓存，下次同 key 调用会重新执行。
 * 2. 缓存命中后直接返回首次成功的引用，不再次执行 `run`。
 * 3. 不存在的 key / 非字符串 key / 空字符串 key 一律视为无幂等保护，照常执行 `run`。
 * 4. `clear()` 提供测试与显式重置入口。
 *
 * 该模式适用于：
 * - Agent 写工具沙箱（防止 `append_to_note` 因模型重发而重复追加）
 * - 任何「失败后用户可修正参数后重试」的去重键
 * - 不适用于：需要固化失败结果用于审计 / 排障的场景
 */

/** 仅与「成功结果」打交道的最小契约；失败结果不缓存。 */
export interface IdempotentResult {
  ok: boolean;
}

export interface IdempotencyCache<T extends IdempotentResult> {
  /** 取 key（字符串）并执行 run：命中成功缓存直接返回，否则跑 run 并按 ok 决定是否写入。 */
  run: (key: string | undefined, run: () => T) => T;
  /** 清空缓存（测试 / 显式重置用）。 */
  clear: () => void;
  /** 当前已缓存 key 数量（仅观测 / 调试用）。 */
  readonly size: number;
}

export function createIdempotencyCache<T extends IdempotentResult>(): IdempotencyCache<T> {
  const cache = new Map<string, T>();
  return {
    run(key, run) {
      if (typeof key !== 'string' || key === '') return run();
      const seen = cache.get(key);
      if (seen) return seen;
      const r = run();
      if (r && r.ok) cache.set(key, r);
      return r;
    },
    clear() {
      cache.clear();
    },
    get size() {
      return cache.size;
    },
  };
}
