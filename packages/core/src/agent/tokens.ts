/**
 * Token 用量估计与累计（D4）。
 * 无 tokenizer 时用启发式：CJK≈1 token/字，拉丁≈1 token/4 字符。
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TokenUsageEvent extends TokenUsage {
  at: number;
  provider: string;
  model: string;
  estimated: boolean;
}

/** 启发式估计 token 数 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let korean = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x4e00 && c <= 0x9fff) {
      cjk++; // CJK 统一表意文字
    } else if (c >= 0x3400 && c <= 0x4dbf) {
      cjk++; // CJK 扩展 A
    } else if (c >= 0x3040 && c <= 0x30ff) {
      cjk++; // 日文假名
    } else if (c >= 0xac00 && c <= 0xd7af) {
      korean++; // 韩文字母（音节音节，每 token 约 2-3 字符，0.35 系数更接近实际）
    } else {
      other++;
    }
  }
  return Math.max(1, Math.ceil(cjk * 1.2 + korean * 0.35 + other / 4));
}

/** 从 OpenAI / Anthropic / Ollama 响应 JSON 解析 usage（若有） */
export function parseUsageFromResponse(json: unknown): TokenUsage | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as any;
  const u = j?.usage;
  // usage 必须是对象且至少一个字段是数字（避免 usage:{} / usage:"0" 误判）
  if (u && typeof u === 'object') {
    const promptRaw = u.prompt_tokens ?? u.input_tokens ?? u.prompt_eval_count;
    const completionRaw = u.completion_tokens ?? u.output_tokens ?? u.eval_count;
    const totalRaw = u.total_tokens;
    const prompt = Number(promptRaw);
    const completion = Number(completionRaw);
    const total = Number(totalRaw);
    const ok = [prompt, completion, total].some((n) => Number.isFinite(n) && n > 0);
    if (ok) {
      return {
        promptTokens: Number.isFinite(prompt) ? prompt : 0,
        completionTokens: Number.isFinite(completion) ? completion : 0,
        totalTokens: Number.isFinite(total) ? total : (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(completion) ? completion : 0),
      };
    }
  }
  // Ollama 的计数在响应顶层（prompt_eval_count / eval_count），没有 usage 对象，
  // 漏掉这一分支会导致 Ollama 的用量永远统计不到
  const pe = Number(j?.prompt_eval_count);
  const ev = Number(j?.eval_count);
  if (Number.isFinite(pe) || Number.isFinite(ev)) {
    const prompt = Number.isFinite(pe) ? pe : 0;
    const completion = Number.isFinite(ev) ? ev : 0;
    return { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion };
  }
  return null;
}

/** 用提示与回复估算一轮用量 */
export function estimateRoundUsage(prompt: string, completion: string): TokenUsage {
  const promptTokens = estimateTokens(prompt);
  const completionTokens = estimateTokens(completion);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

export class TokenMeter {
  private events: TokenUsageEvent[] = [];
  /** 超过此容量时丢弃最早的 50% 事件，防止内存无限增长 */
  private readonly maxEvents = 1000;

  record(ev: Omit<TokenUsageEvent, 'at'>): TokenUsageEvent {
    const full: TokenUsageEvent = { ...ev, at: Date.now() };
    this.events.push(full);
    // 超过容量时持续裁剪到 50%（避免长会话累积过多事件）
    while (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-Math.floor(this.maxEvents * 0.5));
    }
    return full;
  }

  /** 本会话累计 */
  totals(): TokenUsage {
    return this.events.reduce(
      (a, e) => ({
        promptTokens: a.promptTokens + e.promptTokens,
        completionTokens: a.completionTokens + e.completionTokens,
        totalTokens: a.totalTokens + e.totalTokens,
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    );
  }

  history(): TokenUsageEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}
