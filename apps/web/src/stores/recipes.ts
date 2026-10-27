import { create } from 'zustand';
import { BUILTIN_RECIPES, type Recipe } from '@md-studio/core';

const STORAGE_KEY = 'md-studio-recipes';

function load(): Recipe[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return BUILTIN_RECIPES.map((r) => ({ ...r }));
    const parsed = JSON.parse(raw) as Recipe[];
    return Array.isArray(parsed) && parsed.length ? parsed : BUILTIN_RECIPES.map((r) => ({ ...r }));
  } catch {
    return BUILTIN_RECIPES.map((r) => ({ ...r }));
  }
}

function persist(recipes: Recipe[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
}

interface RecipesState {
  recipes: Recipe[];
  lastRun: { at: number; id: string; name: string; prompt: string } | null;
  /** 待送入 Agent 面板的提示词（由 recipes 触发写入，Agent 消费后清空） */
  pendingPrompt: string | null;
  setEnabled: (id: string, enabled: boolean) => void;
  upsert: (recipe: Recipe) => void;
  remove: (id: string) => void;
  markRun: (id: string, name: string, prompt: string) => void;
  setPendingPrompt: (prompt: string | null) => void;
  resetBuiltins: () => void;
}

export const useRecipes = create<RecipesState>((set, get) => ({
  recipes: typeof localStorage !== 'undefined' ? load() : BUILTIN_RECIPES.map((r) => ({ ...r })),
  lastRun: null,
  pendingPrompt: null,
  setEnabled: (id, enabled) => {
    const recipes = get().recipes.map((r) => (r.id === id ? { ...r, enabled } : r));
    persist(recipes);
    set({ recipes });
  },
  upsert: (recipe) => {
    const list = get().recipes;
    const i = list.findIndex((r) => r.id === recipe.id);
    const recipes = i >= 0 ? list.map((r, idx) => (idx === i ? recipe : r)) : [...list, recipe];
    persist(recipes);
    set({ recipes });
  },
  remove: (id) => {
    const recipes = get().recipes.filter((r) => r.id !== id);
    persist(recipes);
    set({ recipes });
  },
  markRun: (id, name, prompt) => set({ lastRun: { at: Date.now(), id, name, prompt } }),
  setPendingPrompt: (pendingPrompt) => set({ pendingPrompt }),
  resetBuiltins: () => {
    const recipes = BUILTIN_RECIPES.map((r) => ({ ...r }));
    persist(recipes);
    set({ recipes });
  },
}));
