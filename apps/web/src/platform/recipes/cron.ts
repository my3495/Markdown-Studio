/**
 * cron recipes：按 intervalMinutes 定时对当前活动文档排队。
 */

import { matchRecipes, recipeIntervalMs, type Recipe } from '@md-studio/core';
import { useRecipes } from '../../stores/recipes';
import { useDocuments } from '../../stores/document';
import { RECIPE_PROMPT_KEY } from './runner';

const timers = new Map<string, number>();

export function startCronRecipes(): () => void {
  const tick = () => {
    const recipes = useRecipes.getState().recipes as Recipe[];
    const cronOnes = recipes.filter((r) => r.enabled && r.trigger === 'cron');
    const activeId = useDocuments.getState().activeId;
    const active = activeId ? useDocuments.getState().docs[activeId] : null;
    if (!active) return;

    for (const r of cronOnes) {
      if (timers.has(r.id)) continue;
      const ms = recipeIntervalMs(r);
      const id = window.setInterval(() => {
        const docs = useDocuments.getState();
        const cur = docs.activeId ? docs.docs[docs.activeId] : null;
        if (!cur) return;
        const hits = matchRecipes([r], 'cron', {
          path: cur.path ?? cur.name,
          name: cur.name,
          content: cur.content,
        });
        if (hits.length === 0) return;
        useRecipes.getState().markRun(hits[0]!.recipe.id, hits[0]!.recipe.name, hits[0]!.prompt);
        try {
          sessionStorage.setItem(RECIPE_PROMPT_KEY, hits[0]!.prompt);
        } catch {
          /* ignore */
        }
      }, ms);
      timers.set(r.id, id);
    }

    // 清理已禁用/删除的
    for (const [id, handle] of timers) {
      if (!cronOnes.some((r) => r.id === id)) {
        window.clearInterval(handle);
        timers.delete(id);
      }
    }
  };

  tick();
  const poll = window.setInterval(tick, 15_000);
  return () => {
    window.clearInterval(poll);
    for (const handle of timers.values()) window.clearInterval(handle);
    timers.clear();
  };
}
