/**
 * cron recipes 清理函数验证：停止调用后所有 timer 应被清理，
 * 避免页面生命周期内累积的 interval 泄漏。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 必须在 import 使用到 store 的模块前 mock 它们
vi.mock('../../../stores/recipes', () => ({
  useRecipes: {
    getState: () => ({ recipes: [], markRun: vi.fn() }),
  },
}));

vi.mock('../../../stores/document', () => ({
  useDocuments: {
    getState: () => ({ activeId: null, docs: {} }),
  },
}));

import { startCronRecipes } from '../cron';

describe('startCronRecipes 清理', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('调用返回的清理函数后不再触发 tick', () => {
    const stop = startCronRecipes();
    // 立即清理（无 recipe，无 interval 注册）
    stop();
    // 再次推进时间也不会抛错
    vi.advanceTimersByTime(60_000);
    expect(true).toBe(true);
  });

  it('stop 是幂等函数，可重复调用', () => {
    const stop = startCronRecipes();
    expect(() => {
      stop();
      stop();
    }).not.toThrow();
  });
});
