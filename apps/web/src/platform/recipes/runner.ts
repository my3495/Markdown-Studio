/**
 * 执行匹配的 recipes：记录最近一次，并把 prompt 交给 Agent 面板预填。
 * 不在保存路径上自动打 LLM（避免意外花费）；真正调用由用户在 Agent 面板确认。
 */

import {
  matchRecipes,
  type Recipe,
  type RecipeContext,
  type RecipeTrigger,
} from '@md-studio/core';
import { useRecipes } from '../../stores/recipes';
import { useSettings } from '../../stores/settings';

export const RECIPE_PROMPT_KEY = 'md-studio-recipe-prompt';

export function runMatchedRecipes(trigger: RecipeTrigger, ctx: RecipeContext): number {
  const s = useSettings.getState();
  if (trigger === 'on-save' && !s.recipesOnSave) return 0;
  // on-commit 与快照开关对齐：未开 autoSnapshot 时也不排队
  if (trigger === 'on-commit' && !s.autoSnapshot) return 0;

  const recipes = useRecipes.getState().recipes as Recipe[];
  const matches = matchRecipes(recipes, trigger, ctx);
  if (matches.length === 0) return 0;

  for (const m of matches) {
    useRecipes.getState().markRun(m.recipe.id, m.recipe.name, m.prompt);
  }

  // 实时投递到常驻的 Agent 右栏（sessionStorage 仅作跨刷新的兜底）
  const prompt = matches[0]!.prompt;
  useRecipes.getState().setPendingPrompt(prompt);
  try {
    sessionStorage.setItem(RECIPE_PROMPT_KEY, JSON.stringify({ prompt, ts: Date.now() }));
  } catch {
    /* ignore */
  }
  return matches.length;
}

export function consumeRecipePrompt(): string | null {
  try {
    const v = sessionStorage.getItem(RECIPE_PROMPT_KEY);
    if (v) sessionStorage.removeItem(RECIPE_PROMPT_KEY);
    return v;
  } catch {
    return null;
  }
}
