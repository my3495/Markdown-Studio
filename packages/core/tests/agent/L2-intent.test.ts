/**
 * L2 意图识别：recipes 触发匹配（trigger / enabled / pathPattern）、
 * 提示词模板渲染、cron 间隔归一化。纯逻辑，无网络。
 */

import { describe, it, expect } from 'vitest';
import {
  matchRecipes,
  recipeIntervalMs,
  renderRecipePrompt,
  type Recipe,
  type RecipeContext,
} from '../../src/agent/recipes';

const ctx: RecipeContext = { path: 'notes/a.md', name: 'a.md', content: '正文'.repeat(1000) };

function recipe(over: Partial<Recipe> & Pick<Recipe, 'id' | 'trigger' | 'prompt'>): Recipe {
  return { name: over.id, enabled: true, ...over };
}

describe('L2-1 触发点匹配', () => {
  it('L2-01 仅匹配 enabled 且 trigger 一致的 recipe', () => {
    const recipes: Recipe[] = [
      recipe({ id: 'r1', trigger: 'on-save', prompt: 'A' }),
      recipe({ id: 'r2', trigger: 'on-save', prompt: 'B', enabled: false }),
      recipe({ id: 'r3', trigger: 'manual', prompt: 'C' }),
    ];
    const hit = matchRecipes(recipes, 'on-save', ctx);
    expect(hit.map((h) => h.recipe.id)).toEqual(['r1']);
  });

  it('L2-02 on-commit / cron / manual 互不串台', () => {
    const recipes: Recipe[] = [
      recipe({ id: 'save', trigger: 'on-save', prompt: 'A' }),
      recipe({ id: 'commit', trigger: 'on-commit', prompt: 'B' }),
      recipe({ id: 'cron', trigger: 'cron', prompt: 'C' }),
    ];
    expect(matchRecipes(recipes, 'cron', ctx).map((h) => h.recipe.id)).toEqual(['cron']);
    expect(matchRecipes(recipes, 'on-commit', ctx).map((h) => h.recipe.id)).toEqual(['commit']);
    expect(matchRecipes(recipes, 'manual', ctx)).toHaveLength(0);
  });

  it('L2-03 无匹配时返回空数组而非抛错', () => {
    expect(matchRecipes([], 'on-save', ctx)).toEqual([]);
  });
});

describe('L2-2 pathPattern 分支', () => {
  const withPattern = (pathPattern: string) => [
    recipe({ id: 'p', trigger: 'on-save', prompt: 'X', pathPattern }),
  ];

  it('L2-04 前缀模式 notes/ 命中目录内文件', () => {
    expect(matchRecipes(withPattern('notes/'), 'on-save', ctx)).toHaveLength(1);
    expect(
      matchRecipes(withPattern('notes/'), 'on-save', { ...ctx, path: 'other/a.md' })
    ).toHaveLength(0);
  });

  it('L2-05 后缀模式 *.md 命中 .md、不命中 .txt', () => {
    expect(
      matchRecipes(withPattern('*.md'), 'on-save', { ...ctx, path: 'a.md' })
    ).toHaveLength(1);
    expect(
      matchRecipes(withPattern('*.md'), 'on-save', { ...ctx, path: 'a.txt' })
    ).toHaveLength(0);
  });

  it('L2-06 双端通配 *.draft* 退化为包含匹配', () => {
    expect(
      matchRecipes(withPattern('*.draft*'), 'on-save', { ...ctx, path: 'a.draft.md' })
    ).toHaveLength(1);
    expect(
      matchRecipes(withPattern('*.draft*'), 'on-save', { ...ctx, path: 'a.md' })
    ).toHaveLength(0);
  });

  it('L2-07 空 / 未设置 pattern 视为全匹配', () => {
    expect(matchRecipes(withPattern(''), 'on-save', ctx)).toHaveLength(1);
    expect(matchRecipes(withPattern('   '), 'on-save', ctx)).toHaveLength(1);
    expect(
      matchRecipes([recipe({ id: 'n', trigger: 'on-save', prompt: 'X' })], 'on-save', ctx)
    ).toHaveLength(1);
  });
});

describe('L2-3 提示词模板渲染', () => {
  it('L2-08 四个占位符全部渲染', () => {
    const p = renderRecipePrompt('{{name}}|{{path}}|{{excerpt}}|{{content}}', ctx);
    expect(p.startsWith('a.md|notes/a.md|')).toBe(true);
    expect(p).not.toContain('{{');
  });

  it('L2-09 excerpt 截断到 1200 字符并追加省略号', () => {
    const p = renderRecipePrompt('{{excerpt}}', ctx);
    expect(p).toContain('…');
    expect(p.length).toBeLessThanOrEqual(1200 + 3);
  });

  it('L2-10 content 不截断（与 excerpt 语义区分）', () => {
    const p = renderRecipePrompt('{{content}}', ctx);
    expect(p).toBe(ctx.content);
  });

  it('L2-11 未知占位符原样保留（不误替换）', () => {
    expect(renderRecipePrompt('{{foo}} {{name}}', ctx)).toBe('{{foo}} a.md');
  });

  it('L2-12 渲染值含 $& 特殊替换模式不应被解释', () => {
    const p = renderRecipePrompt('{{name}}', { ...ctx, name: 'A$&B' });
    expect(p).toBe('A$&B');
  });

  it('L2-13 渲染值含 $\' 与 $$ 不应被解释', () => {
    expect(renderRecipePrompt('{{name}}', { ...ctx, name: "A$'B" })).toBe("A$'B");
    expect(renderRecipePrompt('{{name}}', { ...ctx, name: 'A$$B' })).toBe('A$$B');
  });
});

describe('L2-4 cron 间隔归一化', () => {
  it('L2-14 未设置回落 60 分钟', () => {
    expect(recipeIntervalMs(recipe({ id: 'x', trigger: 'cron', prompt: '' }))).toBe(60 * 60_000);
  });

  it('L2-15 0 与负值下限收敛到 1 分钟', () => {
    expect(
      recipeIntervalMs(recipe({ id: 'x', trigger: 'cron', prompt: '', intervalMinutes: 0 }))
    ).toBe(60_000);
    expect(
      recipeIntervalMs(recipe({ id: 'x', trigger: 'cron', prompt: '', intervalMinutes: -5 }))
    ).toBe(60_000);
  });

  it('L2-16 非法值 (NaN) 应回落默认 60 分钟而非 NaN', () => {
    expect(
      recipeIntervalMs(recipe({ id: 'x', trigger: 'cron', prompt: '', intervalMinutes: Number('abc') }))
    ).toBe(60 * 60_000);
  });
});

describe('L2-5 匹配结果的健壮性', () => {
  it('L2-17 空提示词的 recipe 不应产出（避免无效 LLM 调用）', () => {
    const recipes: Recipe[] = [recipe({ id: 'empty', trigger: 'on-save', prompt: '   ' })];
    expect(matchRecipes(recipes, 'on-save', ctx)).toHaveLength(0);
  });

  it('L2-18 多条命中按声明顺序返回且各自渲染', () => {
    const recipes: Recipe[] = [
      recipe({ id: 'r1', trigger: 'manual', prompt: 'P1-{{name}}' }),
      recipe({ id: 'r2', trigger: 'manual', prompt: 'P2-{{name}}' }),
    ];
    const hit = matchRecipes(recipes, 'manual', ctx);
    expect(hit.map((h) => h.prompt)).toEqual(['P1-a.md', 'P2-a.md']);
  });

  it('L2-19 空正文时 excerpt 渲染为空串且不抛错', () => {
    expect(renderRecipePrompt('[{{excerpt}}]', { ...ctx, content: '' })).toBe('[]');
  });
});
