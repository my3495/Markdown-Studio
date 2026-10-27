/**
 * AgentChat 的纯逻辑助手：从组件中抽出，便于在无 DOM / 无 store 的环境下单测。
 * 这里不放任何 React、zustand、平台 API 依赖。
 */
import { type BudgetPart, composeWithBudget, excerptFor } from '@md-studio/core';
import type { LlmTraceStep, ToolAgentEvent } from '@md-studio/core';
import { t, type Locale } from '../../i18n';

/** 再导出，方便 AgentChat 复用 */
export { excerptFor };

/** 连接 dot 状态值（AgentChat 与 StatusBar 共用） */
export type ConnDotStatus = 'ok' | 'checking' | 'offline' | 'idle' | 'online' | '';

/**
 * Agent 连接状态计算（AgentChat 与 StatusBar 共用）。
 *
 * Ollama：看真实连通性（online/checking/offline）
 * 其他 provider：看是否已选模型
 */
export function agentConnStatus(opts: {
  provider: string;
  model: string;
  apiKey?: string;
  ollamaStatus?: ConnDotStatus;
  locale: Locale;
}): { dot: ConnDotStatus; title: string } {
  const { provider, model, apiKey, ollamaStatus, locale } = opts;
  const isOllama = provider === 'ollama';
  const canLlm = !!model && (isOllama || !!apiKey);

  if (isOllama) {
    const dot: ConnDotStatus =
      ollamaStatus === 'online'
        ? 'ok'
        : ollamaStatus === 'checking'
          ? 'checking'
          : ollamaStatus === 'offline'
            ? 'offline'
            : '';
    const title =
      ollamaStatus === 'online'
        ? `${t(locale, 'agentConnOnline')}${model ? ` · ${model}` : ''}`
        : ollamaStatus === 'checking'
          ? t(locale, 'agentConnChecking')
          : ollamaStatus === 'offline'
            ? t(locale, 'agentConnOffline')
            : t(locale, 'agentConnOffline');
    return { dot, title };
  }

  const dot: ConnDotStatus = canLlm ? 'ok' : '';
  const title = model || t(locale, 'agentNoLlm');
  return { dot, title };
}

/** 送入模型的历史条数上限（以消息条数计，避免长对话 token 膨胀） */
export const HISTORY_LIMIT = 8;
/** 附件约束：个数与单文件体积上限，避免把上下文预算吃光 */
export const MAX_ATTACH_FILES = 5;
export const MAX_ATTACH_BYTES = 256 * 1024;
/** 附件正文总预算（字符）：与 core 的 MAX_PROMPT_CHARS 留出余量，避免整条提示词被截断 */
export const ATTACH_TEXT_BUDGET = 24_000;
/** 单个附件配额保底值：预算再小也至少给 1000 字符，避免空附件 */
export const ATTACH_SHARE_FLOOR = 1_000;
/** 附件总预算硬上限之外的额外安全余量（留 6KB 给问题+系统提示） */

/** 主流提供商建议模型（与 settings store 的 provider 字符串对齐）。
 * 这里只列常见名字；用户实际设置里可以是任何 model id。
 * 返回「去重 + 包含当前 model」的下拉候选。 */
const PROVIDER_MODEL_HINTS: Record<string, string[]> = {
  ollama: ['qwen2.5:7b', 'llama3.1:8b', 'gemma2:9b', 'mistral:7b', 'codellama:7b'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'o1-mini', 'o3-mini'],
  claude: ['claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-opus'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
  qwen: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
  glm: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'],
  kimi: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  doubao: ['doubao-pro-32k', 'doubao-lite-32k'],
  custom: [],
};
export function modelSuggestions(provider: string, currentModel: string): string[] {
  const hint = PROVIDER_MODEL_HINTS[provider] ?? [];
  const all = [...new Set([currentModel, ...hint].filter(Boolean))];
  return all;
}
export const ATTACH_OVERALL_HEADROOM = 6_000;

export const TEXT_EXTS = [
  'md',
  'markdown',
  'txt',
  'json',
  'csv',
  'tsv',
  'yaml',
  'yml',
  'log',
  'html',
  'htm',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'sh',
  'toml',
  'ini',
  'xml',
  'sql',
];

/** 取扩展名（大小写不敏感，总返回非空字符串） */
export const fileExt = (name: string) => (name.toLowerCase().split('.').pop() || '');
/** 是否文本类附件：MIME 命中 text/* 或扩展名命中白名单 */
export const isTextFile = (f: { type: string; name: string }) =>
  f.type.startsWith('text/') || TEXT_EXTS.includes(fileExt(f.name));
/** 体积友好展示：B < 1024 时显示 B，否则显示 KB */
export const fmtSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
/** token 估算：CJK≈1 token/字，拉丁≈1 token/4 字符 */
export const fmtTokens = (n: number) =>
  n < 1000 ? `${n}` : `${(n / 1000).toFixed(n < 10000 ? 2 : 1)}k`;

export interface AgentAttachment {
  id: string;
  name: string;
  size: number;
  text: string;
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  /** 送入模型的完整文本（含附件正文）；缺省回落到 text */
  context?: string;
}

/** 附件正文总预算按个数均摊（保底 ATTACH_SHARE_FLOOR 字符） */
export const attachShare = (count: number) =>
  Math.max(ATTACH_SHARE_FLOOR, Math.floor(ATTACH_TEXT_BUDGET / Math.max(1, count)));

/**
 * 组装送入模型的提问文本：附件正文按配额拼接，超长截断。
 * 返回被截断的文件名列表（由调用方弹 toast），不在这里产生副作用。
 *
 * 双重预算（与 core 的 `composeWithBudget` / `clipMessages` 共享同一套裁剪契约）：
 * - 单个附件：按 attachShare 均摊
 * - 整体：附加头部正文总长 + 附件总长 ≤ ATTACH_TEXT_BUDGET + 余量
 * 第二层防止「5 个文件恰好都不超 share，但合起来仍超窗」的边界 case。
 */
export function composeModelPrompt(
  q: string,
  atts: AgentAttachment[],
  fallbackPrompt: string
): { modelPrompt: string; trimmed: string[] } {
  if (!atts.length) return { modelPrompt: q, trimmed: [] };
  const share = attachShare(atts.length);
  // 扣除问题+头部 + 附件 prefix 的开销，估算正文总预算
  const headroomForBodies = Math.max(0, ATTACH_TEXT_BUDGET - q.length - ATTACH_OVERALL_HEADROOM);
  const perShare = Math.max(ATTACH_SHARE_FLOOR, Math.floor(headroomForBodies / Math.max(1, atts.length)));
  const parts: BudgetPart[] = atts.map((a) => ({
    name: a.name,
    text: `【附件：${a.name}】\n${a.text}`,
    budget: Math.min(share, perShare),
  }));
  const result = composeWithBudget(parts, {
    totalBudget: ATTACH_TEXT_BUDGET + q.length,
    headroom: ATTACH_OVERALL_HEADROOM,
    separator: '\n\n',
    trimOrder: 'oldest-first', // 附件按顺序追加时，旧的优先裁
  });
  return {
    modelPrompt: `${q || fallbackPrompt}\n\n${result.text}`,
    trimmed: result.trimmed,
  };
}

/** 多轮上下文：取最近 limit 条有正文的消息（不含本轮提问，content 用 context 优先） */
export function buildHistory(
  msgs: HistoryMessage[],
  limit: number = HISTORY_LIMIT
): { role: 'user' | 'assistant'; content: string }[] {
  return msgs
    .filter((m) => (m.context ?? m.text).trim())
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.context ?? m.text }));
}

/**
 * 给附件 chip 提供可访问的完整描述：name + size + 截断状态。
 * 单一来源；既给 title 也给 aria-label。
 */
export function attachmentLabel(
  att: { name: string; size: number },
  trimmed: string[],
  locale: Locale
): string {
  const base = `${att.name} · ${fmtSize(att.size)}`;
  return trimmed.includes(att.name) ? `${base}（${t(locale, 'agentAttachTrimmed')}: ${att.name}）` : base;
}

/**
 * 「插入笔记」专用 block：引用样式包住最终回答，附本地化小标题。
 * 提取出来便于单测；调用方负责把返回的 block 拼到 note 末尾。
 */
export function buildInsertBlock(finalAnswer: string, title: string): string {
  // 末尾补一个空行，避免与下一段紧贴
  return `\n\n> ${title}\n\n${finalAnswer}\n`;
}

/**
 * 通用「按 locale 查表」助手。
 * 给定 {en, zh-CN, ja} 三张表，返回 name 对应的本地化字符串：
 * - 命中 locale 表则用之
 * - 否则回落到 en 表
 * - 再否则原样透传（让 UI 安全显示未知 id 而不抛错）
 *
 * 抽出原因：tool name / recipe name / 任何字符串标识都遵循同一套「en + zh-CN + ja」三语 fallback 链，
 * 各处都重复写 `table[locale] ?? table.en ?? name` 容易漏写某一支。
 */
export function lookupLocalized(
  tables: { en: Record<string, string>; 'zh-CN': Record<string, string>; ja: Record<string, string> },
  name: string,
  locale: Locale
): string {
  if (!name) return '';
  if (locale === 'zh-CN') return tables['zh-CN'][name] ?? tables.en[name] ?? name;
  if (locale === 'ja') return tables.ja[name] ?? tables.en[name] ?? name;
  return tables.en[name] ?? name;
}

/**
 * 把工具原始名映射为更友好的展示名（仅 UI 用，不影响上游）。
 * core 工具名是英文 snake_case，这里翻成中文 / 英文视 locale 而定。
 */
const TOOL_NAME_EN: Record<string, string> = {
  list_notes: 'list_notes',
  read_note: 'read_note',
  search: 'search',
  get_outline: 'get_outline',
  get_backlinks: 'get_backlinks',
  get_outgoing: 'get_outgoing',
  write_note: 'write_note',
  append_to_note: 'append_to_note',
  delete_note: 'delete_note',
  // core 内部 trace 上报的工具名：本地化与工具调用工具名一致
  compose: 'compose',
  llm: 'llm',
};
const TOOL_NAME_ZH: Record<string, string> = {
  list_notes: '列出笔记',
  read_note: '读取笔记',
  search: '全文搜索',
  get_outline: '获取大纲',
  get_backlinks: '反向链接',
  get_outgoing: '出链',
  write_note: '写入笔记',
  append_to_note: '追加内容',
  delete_note: '删除笔记',
  compose: '组装回答',
  llm: '模型调用',
};
const TOOL_NAME_JA: Record<string, string> = {
  list_notes: 'ノート一覧',
  read_note: 'ノート読み込み',
  search: '全文検索',
  get_outline: 'アウトライン取得',
  get_backlinks: 'バックリンク',
  get_outgoing: '前方リンク',
  write_note: 'ノート書き込み',
  append_to_note: '追記',
  delete_note: 'ノート削除',
  compose: '回答を構成',
  llm: 'モデル呼び出し',
};
/** 工具名本地化展示；未知工具原样透传 */
export function localizeToolName(name: string, locale: Locale): string {
  return lookupLocalized({ en: TOOL_NAME_EN, 'zh-CN': TOOL_NAME_ZH, ja: TOOL_NAME_JA }, name, locale);
}

/* ──────────── Sandbox op → 工具名（消除调用处的三目嵌套） ──────────── */

/** sandbox pending change 的 op 字段 → 对应核心工具名；未知 op 原样透传 */
export function sandboxOpToTool(op: string): string {
  if (op === 'delete') return 'delete_note';
  if (op === 'append') return 'append_to_note';
  if (op === 'write') return 'write_note';
  return op;
}

/* ──────────── Recipe 名本地化（与 tool name 同套 fallback 链） ──────────── */

const RECIPE_NAME_EN: Record<string, string> = {
  'summarize-on-save': 'Summarize on save',
  'lint-inbox': 'Inbox tidy suggestions',
  'daily-review': 'Scheduled review',
  'commit-changelog': 'Post-commit changelog',
};
const RECIPE_NAME_ZH: Record<string, string> = {
  'summarize-on-save': '保存后摘要',
  'lint-inbox': 'Inbox 整理建议',
  'daily-review': '定时回顾',
  'commit-changelog': '提交后变更说明',
};
const RECIPE_NAME_JA: Record<string, string> = {
  'summarize-on-save': '保存後に要約',
  'lint-inbox': 'Inbox 整理の提案',
  'daily-review': '定期レビュー',
  'commit-changelog': 'コミット後の変更点',
};

/** Recipe id → 本地化展示名；用户自建 recipe 原样回退到原名 */
export function localizeRecipeName(id: string, fallbackName: string, locale: Locale): string {
  const localized = lookupLocalized(
    { en: RECIPE_NAME_EN, 'zh-CN': RECIPE_NAME_ZH, ja: RECIPE_NAME_JA },
    id,
    locale
  );
  // 命中三语表 → 用之；未命中（用户自建 recipe）→ 用 Recipe.name 原文
  return localized === id ? fallbackName : localized;
}

/**
 * runToolAgent 的 error/retry/notice 事件 → 可读的追踪步骤（文案走 i18n）。
 * 非这三类事件返回 null，由调用方按原逻辑处理。
 */
export function eventTraceStep(ev: ToolAgentEvent, locale: Locale): LlmTraceStep | null {
  if (ev.type === 'error') {
    // 外部依赖失败：core 已保证流不会中断，这里补一条失败步骤便于排查
    return { tool: 'llm', ok: false, summary: `${t(locale, 'agentLlmError')}：${ev.message}` };
  }
  if (ev.type === 'retry') {
    // 重试会带来最多数百毫秒静默等待，显式告知用户
    return {
      tool: 'llm',
      ok: true,
      summary: t(locale, 'agentRetry')
        .replace('{n}', String(ev.attempt))
        .replace('{reason}', ev.status ? `，HTTP ${ev.status}` : ''),
    };
  }
  if (ev.type === 'notice') {
    if (ev.code === 'truncated') {
      return { tool: 'llm', ok: true, summary: t(locale, 'agentTruncated') };
    }
    if (ev.code === 'badToolFormat') {
      // 弱模型把工具调用当正文输出：用 err 样式提示，避免用户把 JSON 当回答
      return { tool: 'llm', ok: false, summary: t(locale, 'agentBadToolFormat') };
    }
    return null;
  }
  return null;
}
