import { describe, it, expect } from 'vitest';
import {
  matchRecipes,
  recipeIntervalMs,
  renderRecipePrompt,
  type Recipe,
} from '../src/agent/recipes';

describe('recipes', () => {
  it('渲染模板变量', () => {
    const p = renderRecipePrompt('{{name}} @ {{path}}\n{{excerpt}}', {
      path: 'a.md',
      name: 'A',
      content: 'hello',
    });
    expect(p).toContain('A @ a.md');
    expect(p).toContain('hello');
  });

  it('on-save 匹配启用项与路径', () => {
    const recipes: Recipe[] = [
      {
        id: '1',
        name: 's',
        trigger: 'on-save',
        enabled: true,
        prompt: 'p {{name}}',
        pathPattern: 'notes/',
      },
      {
        id: '2',
        name: 'off',
        trigger: 'on-save',
        enabled: false,
        prompt: 'x',
      },
      {
        id: '3',
        name: 'manual',
        trigger: 'manual',
        enabled: true,
        prompt: 'm',
      },
    ];
    const hit = matchRecipes(recipes, 'on-save', {
      path: 'notes/a.md',
      name: 'a.md',
      content: 'c',
    });
    expect(hit).toHaveLength(1);
    expect(hit[0]!.prompt).toBe('p a.md');
    expect(
      matchRecipes(recipes, 'on-save', { path: 'other.md', name: 'o', content: '' })
    ).toHaveLength(0);
  });

  it('cron 间隔', () => {
    expect(recipeIntervalMs({ id: 'x', name: 'x', trigger: 'cron', prompt: '', enabled: true })).toBe(
      60 * 60_000
    );
    expect(
      recipeIntervalMs({
        id: 'x',
        name: 'x',
        trigger: 'cron',
        prompt: '',
        enabled: true,
        intervalMinutes: 5,
      })
    ).toBe(5 * 60_000);
  });
});
