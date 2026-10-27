/**
 * 声明式 recipes：on-save / manual 触发 Agent 提示模板。
 * 纯逻辑 + 匹配；真正调用 LLM 由上层注入 runner。
 */

export type RecipeTrigger = 'on-save' | 'manual' | 'cron' | 'on-commit';

export interface Recipe {
  id: string;
  name: string;
  trigger: RecipeTrigger;
  /** 支持 {{path}} {{name}} {{content}} {{excerpt}} */
  prompt: string;
  enabled: boolean;
  /** 可选：仅当路径匹配 glob 风格前缀/后缀时触发，如 "*.md" 或 "notes/" */
  pathPattern?: string;
  /** cron 触发间隔（分钟），仅 trigger=cron 时有效，默认 60 */
  intervalMinutes?: number;
}

export interface RecipeContext {
  path: string;
  name: string;
  content: string;
}

export interface RecipeMatch {
  recipe: Recipe;
  prompt: string;
}

const DEFAULT_EXCERPT = 1200;

export function renderRecipePrompt(template: string, ctx: RecipeContext, excerptLen = DEFAULT_EXCERPT): string {
  const excerpt =
    ctx.content.length <= excerptLen
      ? ctx.content
      : `${ctx.content.slice(0, excerptLen)}\n…`;
  // 用函数式替换：替换串中的 $& / $' / $` / $$ 会被解释为特殊替换模式，
  // 笔记名或正文含 $ 时会导致提示词被重写（并构成提示词注入面）
  const value = (v: string) => () => v;
  return template
    .replace(/\{\{path\}\}/g, value(ctx.path))
    .replace(/\{\{name\}\}/g, value(ctx.name))
    .replace(/\{\{content\}\}/g, value(ctx.content))
    .replace(/\{\{excerpt\}\}/g, value(excerpt));
}

function matchPath(pattern: string | undefined, path: string): boolean {
  if (!pattern || !pattern.trim()) return true;
  const p = pattern.trim();
  if (p.startsWith('*') && p.endsWith('*')) return path.includes(p.slice(1, -1));
  if (p.startsWith('*')) return path.endsWith(p.slice(1));
  if (p.endsWith('*')) return path.startsWith(p.slice(0, -1));
  return path.includes(p);
}

/** 收集应在某触发点执行的 recipes */
export function matchRecipes(
  recipes: Recipe[],
  trigger: RecipeTrigger,
  ctx: RecipeContext
): RecipeMatch[] {
  return recipes
    // 空提示词不入队：否则会把一条空 user 消息塞给 Agent，白白触发一次调用
    .filter(
      (r) =>
        r.enabled &&
        r.trigger === trigger &&
        typeof r.prompt === 'string' &&
        r.prompt.trim() !== '' &&
        matchPath(r.pathPattern, ctx.path)
    )
    .map((recipe) => ({
      recipe,
      prompt: renderRecipePrompt(recipe.prompt, ctx),
    }));
}

/** 内置示例（默认关闭，由 UI 启用） */
export const BUILTIN_RECIPES: Recipe[] = [
  {
    id: 'summarize-on-save',
    name: '保存后摘要',
    trigger: 'on-save',
    enabled: false,
    prompt:
      '请用中文为笔记「{{name}}」写一段不超过 80 字的摘要，并列出 3 个关键词。正文摘录：\n{{excerpt}}',
  },
  {
    id: 'lint-inbox',
    name: 'Inbox 整理建议',
    trigger: 'manual',
    enabled: true,
    pathPattern: '',
    prompt:
      '笔记「{{name}}」可能在 Inbox。请建议 status/tags 应如何调整，并给出下一步行动。\n{{excerpt}}',
  },
  {
    id: 'daily-review',
    name: '定时回顾',
    trigger: 'cron',
    enabled: false,
    intervalMinutes: 120,
    prompt:
      '请根据当前笔记「{{name}}」给出简短回顾：还有哪些未完成项？\n{{excerpt}}',
  },
  {
    id: 'commit-changelog',
    name: '提交后变更说明',
    trigger: 'on-commit',
    enabled: false,
    prompt:
      '笔记「{{name}}」刚写入本地快照（commit）。请用一句话描述本版变更要点：\n{{excerpt}}',
  },
];

/** 规范化 cron 间隔（分钟），下限 1；NaN / 非数字回落 60 */
export function recipeIntervalMs(recipe: Recipe): number {
  const raw = recipe.intervalMinutes;
  const mins = Number.isFinite(raw) ? Math.max(1, Math.floor(raw as number)) : 60;
  return mins * 60_000;
}
