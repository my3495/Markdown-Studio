/**
 * 通用「内容块 + 字符预算」拼装器。
 *
 * Agent 系统的 system prompt 由「system 段 + 检索/工具回执 + 历史 + 用户问题 + 附件」等多段组成，
 * 每一段都可能被外部输入撑爆：长附件、长历史、模型返回长篇 trace。直接拼接会导致：
 * 1. provider 单条消息超过上限 → 400 / 422
 * 2. 总 prompt 超过模型窗口 → 截断发生在用户看不到的位置
 *
 * 该模块提供「单块预算 + 整体余量」双层保护，是 system prompt 工程的通用范式。
 *
 * 设计要点：
 * - 纯字符串预算（按 `string.length` 计，简化实现；模型 provider 自身按 token 计，会在更上层再校准）。
 * - `fitToBudget(value, budget)`：把单段裁到 budget 以内，必要时加省略号标记。
 * - `composeWithBudget(parts, opts)`：把多段按 `header` / `separator` 拼好，并保证总长 ≤ totalBudget。
 *   超总预算时按从后往前的顺序（即用户最新内容优先）逐块裁剪。
 *
 * 该模块被 web 端的「附件正文预算」与 core 端的「system prompt 拼装」共用。
 */

/** 单段预算裁剪：超出时保留前 budget-1 字符 + 省略号 */
export function fitToBudget(value: string, budget: number): string {
  if (budget <= 0) return '';
  if (value.length <= budget) return value;
  // 留 1 字符给省略号；browsers 的 '…' 长度按 1 计算
  return `${value.slice(0, Math.max(0, budget - 1))}…`;
}

export interface BudgetPart {
  /** 块在最终 prompt 里的展示名（不计入预算，仅用于调试 / 日志） */
  name: string;
  /** 块的原始字符串 */
  text: string;
  /**
   * 该块自身的字符预算。设为 0 表示不裁；设为正数表示裁到该长度。
   * 未提供则视为「不裁」，与 budget=Infinity 等价。
   */
  budget?: number;
}

export interface ComposeWithBudgetOptions {
  /** 最终拼装字符串的硬上限（含 separator）。 */
  totalBudget: number;
  /** 拼装头（每段前面加；用于「system:」「user:」之类的标签）。缺省不加。 */
  header?: (name: string, text: string) => string;
  /** 段与段之间的分隔。缺省为双换行。 */
  separator?: string;
  /**
   * 裁剪顺序：'newest-first'（默认）= 从最后一段往前逐块裁掉，
   * 'oldest-first' = 从最前一段往后裁。
   * Agent 场景下用户最新消息更重要，因此默认 newest-first。
   */
  trimOrder?: 'newest-first' | 'oldest-first';
  /**
   * 整体 headroom：把 totalBudget 再扣掉这些字符（给未来插入的「请回答」等留余地）。
   * 最终可用 = totalBudget - headroom。
   */
  headroom?: number;
}

export interface ComposeResult {
  /** 拼装好的字符串（已按预算裁剪） */
  text: string;
  /** 被裁掉 / 截断的块名列表（用于 trace / toast） */
  trimmed: string[];
  /** 拼装前的原始总字符数（用于 trace） */
  originalLength: number;
  /** 拼装后的实际字符数 */
  finalLength: number;
}

/**
 * 多块拼装 + 字符预算。
 * 流程：
 * 1. 先按各块自身 budget 做单段裁剪（fitToBudget）。
 * 2. 拼出中间文本，量总长。
 * 3. 若总长 > totalBudget-headroom，按 trimOrder 顺序逐块按 25% 缩，直至达标。
 */
export function composeWithBudget(parts: BudgetPart[], opts: ComposeWithBudgetOptions): ComposeResult {
  const separator = opts.separator ?? '\n\n';
  const headroom = opts.headroom ?? 0;
  const cap = Math.max(0, opts.totalBudget - headroom);
  const header = opts.header ?? ((_name, text) => text);
  const trimOrder = opts.trimOrder ?? 'newest-first';

  // 1) 单段裁剪
  const perPartBudget = parts.map((p) => p.budget);
  const fitted = parts.map((p, i) => {
    const budget = perPartBudget[i];
    const text = typeof budget === 'number' ? fitToBudget(p.text, budget) : p.text;
    return { name: p.name, text, wasTrimmed: text !== p.text };
  });
  const originalLength = parts.reduce((n, p) => n + p.text.length, 0);

  // 2) 拼装
  const join = (xs: { name: string; text: string }[]) =>
    xs.map((x) => header(x.name, x.text)).join(separator);

  const texts = fitted.map((f) => f.text);
  let result = join(fitted);
  if (result.length <= cap) {
    return {
      text: result,
      trimmed: fitted.filter((f) => f.wasTrimmed).map((f) => f.name),
      originalLength,
      finalLength: result.length,
    };
  }

  // 3) 整体超 cap：按 trimOrder 顺序从 fitted.texts 末端/首端逐块缩小
  const order = trimOrder === 'newest-first'
    ? texts.map((_, i) => i).reverse()
    : texts.map((_, i) => i);
  // 未显式给 budget 的块视作 cap 起步（避免 Infinity * 0.75 = Infinity 的退化）
  const currentBudgets = perPartBudget.map((b) => (typeof b === 'number' ? b : cap));
  // 每次裁当前块到 75%，直至总长达标或所有块都已压缩到 0
  let safety = 64; // 最多 64 轮，避免极端输入下死循环
  while (result.length > cap && safety-- > 0) {
    let changed = false;
    for (const i of order) {
      if (result.length <= cap) break;
      const cur = currentBudgets[i];
      // 已被裁到 0 的块直接清空文本（不再做 0.75 缩，避免无意义的循环）
      if (cur === 0) {
        if (texts[i] !== '') {
          texts[i] = '';
          result = join(fitted.map((f, j) => ({ name: f.name, text: texts[j] })));
          changed = true;
        }
        continue;
      }
      const next = Math.floor(cur * 0.75);
      const trimmed = fitToBudget(fitted[i].text, next);
      texts[i] = trimmed;
      currentBudgets[i] = next;
      result = join(fitted.map((f, j) => ({ name: f.name, text: texts[j] })));
      changed = true;
    }
    if (!changed) break;
  }

  // 收集被裁的块（含单段裁与整体裁）
  const trimmedSet = new Set<string>();
  fitted.forEach((f) => {
    if (f.wasTrimmed) trimmedSet.add(f.name);
  });
  fitted.forEach((f, i) => {
    if (texts[i] !== f.text || texts[i].length === 0) trimmedSet.add(f.name);
  });
  return {
    text: result,
    trimmed: [...trimmedSet],
    originalLength,
    finalLength: result.length,
  };
}

/* ─────────────── 消息级封装：messages[] 字符预算 ─────────────── */

export interface ClipMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ClipMessagesOptions {
  /** system 段字符预算（缺省 4k） */
  systemBudget?: number;
  /** 单条 user/assistant 消息字符预算（缺省 8k） */
  perMessageBudget?: number;
  /** 所有 message 字符总预算（缺省 96k，留余量给 provider 自身 token 计数） */
  totalBudget?: number;
  /**
   * 命中裁剪时是否给消息内容加 [截断] 提示（缺省 true，便于在 UI 中可视化）。
   * 实现为在末尾追加 `'\n…[已截断，原 N 字符]'`。
   */
  markTrimmed?: boolean;
}

export interface ClipMessagesResult {
  messages: ClipMessage[];
  trimmed: string[]; // 被裁剪的消息角色+索引（"user#0" 形式）
  originalLength: number;
  finalLength: number;
}

/**
 * 把传给 LLM 的 messages 数组按预算裁剪：
 * - 每条消息按 `perMessageBudget` 裁到上限；
 * - 总字符（不含 role 标记）按 `totalBudget` 控制。
 *
 * 设计动机：长附件 / 长历史 / 长 tool 回执都可能在不知情时撑爆模型窗口；
 * provider 多按 token 拒，但我们能控制的是字符，先用字符预算给出确定上界。
 */
export function clipMessages(
  messages: ClipMessage[],
  opts: ClipMessagesOptions = {}
): ClipMessagesResult {
  const sysBudget = opts.systemBudget ?? 4_000;
  const perBudget = opts.perMessageBudget ?? 8_000;
  const totalCap = opts.totalBudget ?? 96_000;
  const mark = opts.markTrimmed !== false;

  const trimmed: string[] = [];
  const originalLength = messages.reduce((n, m) => n + m.content.length, 0);

  // 1) 单条裁剪
  const clipped = messages.map((m, i) => {
    const budget = m.role === 'system' ? sysBudget : perBudget;
    if (m.content.length <= budget) return m;
    trimmed.push(`${m.role}#${i}`);
    const marker = mark
      ? `\n…[已截断，原 ${m.content.length} 字符]`
      : '';
    return {
      role: m.role,
      content: fitToBudget(m.content, Math.max(0, budget - marker.length)) + marker,
    };
  });

  // 2) 总量裁剪：按从最后一条（用户最近消息）往前逐条缩
  let finalLength = clipped.reduce((n, m) => n + m.content.length, 0);
  let safety = clipped.length * 4;
  while (finalLength > totalCap && safety-- > 0) {
    let changed = false;
    for (let i = clipped.length - 1; i >= 0 && finalLength > totalCap; i--) {
      const m = clipped[i];
      if (m.content.length === 0) continue;
      const next = Math.floor(m.content.length * 0.75);
      const marker = mark ? `\n…[已截断]` : '';
      clipped[i] = {
        role: m.role,
        content: fitToBudget(m.content, Math.max(0, next - marker.length)) + marker,
      };
      changed = true;
      finalLength = clipped.reduce((n, mm) => n + mm.content.length, 0);
      if (!trimmed.includes(`${m.role}#${i}`)) trimmed.push(`${m.role}#${i}`);
    }
    if (!changed) break;
  }
  return {
    messages: clipped,
    trimmed,
    originalLength,
    finalLength,
  };
}
