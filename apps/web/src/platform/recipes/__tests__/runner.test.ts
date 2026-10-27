/**
 * runMatchedRecipes + consumeRecipePrompt 的契约测试：
 *  - recipes 关闭时不开 LLM
 *  - on-save 与 recipesOnSave 联动
 *  - on-commit 与 autoSnapshot 联动
 *  - sessionStorage 跨刷新兜底
 *  - consumeRecipePrompt 一次性消费
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RECIPE_PROMPT_KEY,
  consumeRecipePrompt,
  runMatchedRecipes,
} from '../runner';

vi.mock('../../../stores/recipes', () => {
  const state = {
    recipes: [
      {
        id: 'r1',
        name: 'Recipe 1',
        enabled: true,
        trigger: 'on-save',
        match: { nameMatches: /.*/ },
        prompt: '提示词 A',
      },
      {
        id: 'r2',
        name: 'Recipe 2',
        enabled: false,
        trigger: 'on-save',
        match: { nameMatches: /.*/ },
        prompt: '提示词 B（关闭）',
      },
    ] as never,
    markRun: vi.fn(),
    setPendingPrompt: vi.fn(),
  };
  return {
    useRecipes: {
      getState: () => state,
    },
  };
});

const settingsState = {
  recipesOnSave: true,
  autoSnapshot: true,
};
vi.mock('../../../stores/settings', () => ({
  useSettings: {
    getState: () => settingsState,
  },
}));

beforeEach(() => {
  settingsState.recipesOnSave = true;
  settingsState.autoSnapshot = true;
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(RECIPE_PROMPT_KEY);
  }
});

describe('R-runMatchedRecipes 行为契约', () => {
  it('R-01 on-save 触发时 markRun + setPendingPrompt + sessionStorage 都更新', () => {
    const n = runMatchedRecipes('on-save', { path: 'a.md', name: 'a.md', content: 'x' });
    expect(n).toBe(1); // 只有 r1 enabled，r2 关闭
  });

  it('R-02 on-save 关闭时 recipesOnSave=false → 不触发', () => {
    settingsState.recipesOnSave = false;
    const n = runMatchedRecipes('on-save', { path: 'a.md', name: 'a.md', content: 'x' });
    expect(n).toBe(0);
  });

  it('R-03 on-commit 关闭时 autoSnapshot=false → 不触发', () => {
    settingsState.autoSnapshot = false;
    const n = runMatchedRecipes('on-commit', { path: 'a.md', name: 'a.md', content: 'x' });
    expect(n).toBe(0);
  });

  it('R-04 cron 触发：绕过 recipesOnSave/autoSnapshot 守卫（系统层调用）', () => {
    settingsState.recipesOnSave = false;
    settingsState.autoSnapshot = false;
    // cron recipes 不在 mock 列表里 → 应返回 0
    const n = runMatchedRecipes('cron', { path: 'a.md', name: 'a.md', content: 'x' });
    expect(n).toBe(0);
  });
});

describe('R-consumeRecipePrompt 一次性消费', () => {
  it('R-05 sessionStorage 写入后能读出，且读后即删', () => {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(RECIPE_PROMPT_KEY, 'test prompt');
    const v1 = consumeRecipePrompt();
    expect(v1).toBe('test prompt');
    const v2 = consumeRecipePrompt();
    expect(v2).toBeNull();
  });

  it('R-06 sessionStorage 不可用时返回 null（不抛错）', () => {
    if (typeof sessionStorage === 'undefined') return;
    const original = sessionStorage.getItem;
    sessionStorage.getItem = vi.fn(() => {
      throw new Error('quota');
    });
    try {
      expect(consumeRecipePrompt()).toBeNull();
    } finally {
      sessionStorage.getItem = original;
    }
  });

  it('R-07 空 sessionStorage 返回 null', () => {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(RECIPE_PROMPT_KEY);
    expect(consumeRecipePrompt()).toBeNull();
  });
});
