/**
 * LLM 流式客户端（BYOK，provider 无关）：Ollama / OpenAI 兼容 / Anthropic(Claude)。
 * 纯逻辑、可单测（注入 fetch）；检索由上层注入，实现"先检索后生成"的 RAG Agent。
 */

import { clipMessages } from './context';

export type Role = 'system' | 'user' | 'assistant';
export interface ChatMessage {
  role: Role;
  content: string;
}

export interface LlmConfig {
  provider: string;
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

export interface ChatParams {
  messages: ChatMessage[];
  temperature?: number;
  stream?: boolean;
  maxTokens?: number;
}

export interface LlmTraceStep {
  tool: string;
  ok: boolean;
  summary: string;
}

export type ProviderKind = 'ollama' | 'openai' | 'anthropic';

interface ProviderDefault {
  baseUrl: string;
  needsKey: boolean;
  kind: ProviderKind;
}

const DEFAULTS: Record<string, ProviderDefault> = {
  ollama: { baseUrl: 'http://localhost:11434', needsKey: false, kind: 'ollama' },
  openai: { baseUrl: 'https://api.openai.com/v1', needsKey: true, kind: 'openai' },
  claude: { baseUrl: 'https://api.anthropic.com', needsKey: true, kind: 'anthropic' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', needsKey: true, kind: 'openai' },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    needsKey: true,
    kind: 'openai',
  },
  glm: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', needsKey: true, kind: 'openai' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', needsKey: true, kind: 'openai' },
  custom: { baseUrl: '', needsKey: false, kind: 'openai' },
};

export function resolveProvider(provider: string): ProviderDefault {
  return DEFAULTS[provider] ?? { baseUrl: '', needsKey: false, kind: 'openai' };
}

/** Ollama 走 OpenAI 兼容端点（baseUrl 已是 /v1 时），否则用原生 /api/chat */
export type EndpointKind = 'native' | 'openai-compat';

export function resolveEndpointKind(cfg: LlmConfig): EndpointKind {
  return cfg.provider === 'ollama' && cfg.baseUrl && /\/v1(\/|$)/.test(cfg.baseUrl)
    ? 'openai-compat'
    : 'native';
}

export const MAX_PROMPT_CHARS = 32_000;
export const MAX_HISTORY_CHARS = 16_000;
export const DEFAULT_HISTORY_LIMIT = 8;
export const EMPTY_RESPONSE_HINT = '[模型返回空响应]';
export const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export interface RetryInfo {
  attempt: number;
  status?: number;
  delayMs: number;
  reason: string;
}

export interface RetryPolicy {
  retries?: number;
  baseDelayMs?: number;
  onRetry?: (info: RetryInfo) => void;
}

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export function resolveBaseUrl(cfg: LlmConfig): string {
  const def = resolveProvider(cfg.provider);
  const base = (cfg.baseUrl || def.baseUrl || '').replace(/\/+$/, '');
  if (!base) {
    throw new Error(
      `未配置 baseUrl：provider "${cfg.provider}" 没有默认地址，请在设置中填写 baseUrl`
    );
  }
  return base;
}

/** 需要鉴权的 provider 缺失 apiKey 时提前失败，避免发出无鉴权请求白跑一趟 */
export function assertApiKey(cfg: LlmConfig): void {
  const def = resolveProvider(cfg.provider);
  if (def.needsKey && !cfg.apiKey) {
    throw new Error(`缺少 apiKey：provider "${cfg.provider}" 需要鉴权，请在设置中填写 apiKey`);
  }
}

/**
 * 把任意形态的取消原因归一化成标准 `AbortError`（DOMException）。
 *
 * `isAbortError` 判定为取消后，上层仍需一个 `name === 'AbortError'` 的标准异常：
 * 字符串 reason 直接上抛会让所有 `e.name === 'AbortError'` 的下游判定再次失配。
 */
export function normalizeAbortError(e: unknown): DOMException | Error {
  if (e instanceof DOMException) return e;
  if (e instanceof Error && e.name === 'AbortError') return e;
  const reason = typeof e === 'string' ? e : 'aborted';
  return new DOMException(reason, 'AbortError');
}

/**
 * 判断异常是否来自「主动取消」。
 *
 * `AbortController.abort()` 不传参时，fetch 以 `DOMException{name:'AbortError'}` 拒绝；
 * 但一旦传入 reason（如 `abort('user_cancelled')`），拒绝值就变成 **该 reason 本身**
 * （可能是字符串），`instanceof DOMException` / `e.name` 全部失效，取消会被误判成
 * 「模型调用失败：user_cancelled」。
 *
 * 因此这里同时识别两种形态：
 *  1. DOMException / Error 且 name 为 AbortError
 *  2. 字符串 reason 命中常见的取消语义
 */
export function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException || e instanceof Error) {
    return e.name === 'AbortError';
  }
  if (typeof e === 'string') {
    return /^(user_cancelled|user_canceled|aborted|cancelled|canceled|timeout)$/i.test(e);
  }
  return false;
}

/** 截断到上限，超限以省略号收尾 */
export function truncateText(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * 历史净化：角色白名单（只保留 user/assistant）+ 条数窗口 + 字符预算 + 相邻同角色合并。
 */
export function normalizeHistory(
  history: ChatMessage[] | undefined,
  limit: number = DEFAULT_HISTORY_LIMIT,
  budget: number = MAX_HISTORY_CHARS
): ChatMessage[] {
  if (!history || history.length === 0) return [];
  const picked = history
    .filter(
      (m) =>
        !!m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim() !== ''
    )
    .slice(-Math.max(0, limit));
  if (picked.length === 0) return [];

  // 相邻同角色合并
  const merged: ChatMessage[] = [];
  for (const m of picked) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      merged[merged.length - 1] = {
        role: last.role,
        content: `${last.content}\n\n${m.content}`,
      };
    } else {
      merged.push({ role: m.role, content: m.content });
    }
  }

  // 从最新往前累加，超预算则截断该条并停止
  const out: ChatMessage[] = [];
  let used = 0;
  for (let i = merged.length - 1; i >= 0; i--) {
    const m = merged[i]!;
    const remain = budget - used;
    if (remain <= 0) break;
    if (m.content.length <= remain) {
      used += m.content.length;
      out.unshift({ role: m.role, content: m.content });
    } else {
      if (remain <= 1) break;
      const clipped = `${m.content.slice(0, Math.max(0, remain - 1))}…`;
      used += clipped.length;
      out.unshift({ role: m.role, content: clipped });
      break;
    }
  }
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isRetryable(status: number | undefined): boolean {
  if (status === undefined) return true;
  return RETRYABLE_STATUS.has(status);
}

/**
 * 带重试的请求：仅对可重试状态码重试；`validate` 返回非空字符串视为业务失败。
 */
export async function fetchWithRetry<T extends { ok: boolean; status?: number } = ResponseLike>(
  fetchImpl: FetchLike,
  req: HttpRequest,
  validate: (res: ResponseLike) => Promise<string | void | null>,
  policy: RetryPolicy = {}
): Promise<T> {
  const retries = Math.max(0, policy.retries ?? 2);
  const base = policy.baseDelayMs ?? 200;
  let last: unknown = new Error('LLM 请求失败');
  for (let attempt = 0; attempt <= retries; attempt++) {
    let status: number | undefined;
    try {
      const res = await fetchImpl(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
      });
      status = res.status;
      const bad = await validate(res);
      if (!bad) return res as T;
      last = new Error(bad);
    } catch (e) {
      // 主动取消直接透传，不重试
      if (isAbortError(e)) throw normalizeAbortError(e);
      last = e;
    }
    if (attempt < retries && isRetryable(status)) {
      const delayMs = base * 2 ** attempt;
      policy.onRetry?.({
        attempt: attempt + 1,
        status,
        delayMs,
        reason: last instanceof Error ? last.message : String(last),
      });
      await sleep(delayMs);
    } else break;
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** 拆出 system，供 Anthropic Messages API 使用 */
export function splitSystem(messages: ChatMessage[]): { system?: string; messages: ChatMessage[] } {
  const systems = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const rest = messages.filter((m) => m.role !== 'system');
  return { system: systems.length ? systems.join('\n\n') : undefined, messages: rest };
}

/** 依据 provider 构造聊天请求（URL/头/体） */
export function buildChatRequest(cfg: LlmConfig, params: ChatParams): HttpRequest {
  const def = resolveProvider(cfg.provider);
  const base = resolveBaseUrl(cfg);
  assertApiKey(cfg);
  const temperature = params.temperature ?? 0.3;
  const stream = params.stream ?? true;
  const kind = resolveEndpointKind(cfg);

  // Ollama 走 OpenAI 兼容端点
  if (def.kind === 'ollama' && kind === 'openai-compat') {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
    return {
      url: `${base.replace(/\/+$/, '')}/chat/completions`,
      headers,
      body: { model: cfg.model, messages: params.messages, stream, temperature },
    };
  }

  if (def.kind === 'ollama') {
    return {
      url: `${base}/api/chat`,
      headers: { 'content-type': 'application/json' },
      body: {
        model: cfg.model,
        messages: params.messages,
        stream,
        options: { temperature },
      },
    };
  }

  if (def.kind === 'anthropic') {
    const { system, messages } = splitSystem(params.messages);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
    const maxTokens = Math.min(params.maxTokens ?? 4096, 8192);
    return {
      url: `${base}/v1/messages`,
      headers,
      body: {
        model: cfg.model,
        max_tokens: maxTokens,
        temperature,
        stream,
        ...(system ? { system } : {}),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      },
    };
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  return {
    url: `${base}/chat/completions`,
    headers,
    body: {
      model: cfg.model,
      messages: params.messages,
      stream,
      temperature,
    },
  };
}

export interface ParsedChunk {
  text?: string;
  done?: boolean;
}

/** 解析一行流式输出：Ollama NDJSON / OpenAI SSE / Anthropic SSE */
export function parseStreamLine(
  line: string,
  provider: string,
  kind: EndpointKind = 'native'
): ParsedChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const def = resolveProvider(provider);

  if (def.kind === 'ollama' && kind === 'native') {
    try {
      const obj = JSON.parse(trimmed);
      const text = obj?.message?.content;
      return { text: typeof text === 'string' ? text : undefined, done: obj?.done === true };
    } catch {
      return null;
    }
  }

  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (payload === '[DONE]') return { done: true };
  try {
    const obj = JSON.parse(payload);
    if (def.kind === 'anthropic') {
      if (obj?.type === 'message_stop') return { done: true };
      if (obj?.type === 'content_block_delta' && obj?.delta?.type === 'text_delta') {
        const text = obj.delta.text;
        return { text: typeof text === 'string' ? text : undefined };
      }
      return null;
    }
    const delta = obj?.choices?.[0]?.delta?.content;
    return { text: typeof delta === 'string' ? delta : undefined };
  } catch {
    return null;
  }
}

/** 归一化字节来源：兼容异步可迭代与 ReadableStream(getReader) */
export async function* chunksOf(body: unknown): AsyncGenerator<Uint8Array> {
  if (body && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    for await (const c of body as AsyncIterable<Uint8Array>) yield c;
    return;
  }
  if (body && typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
    return;
  }
  throw new Error('响应体不是可读流：需要 AsyncIterable 或 ReadableStream');
}

/** 字节流 → 行迭代器（处理跨 chunk 的半行） */
export async function* toLines(body: unknown): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of chunksOf(body)) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      yield buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}

export interface ResponseLike {
  ok: boolean;
  status?: number;
  /** 异步可迭代 或 ReadableStream（getReader），运行时两者皆可读取；非流式场景可缺省 */
  body?: unknown;
  text?: () => Promise<string>;
  /** 非流式响应体解析（FC 工具调用路径需要） */
  json?: () => Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<ResponseLike>;

/**
 * 流式聊天（带重试）：逐段 yield 文本增量。
 *
 * 断流（已吐出部分内容）不可回滚重放，因此只有「尚未吐出任何内容」时才重试；
 * 一旦已向调用方 yield 过内容，失败直接上抛。
 */
export async function* streamChat(
  cfg: LlmConfig,
  params: ChatParams,
  fetchImpl: FetchLike,
  policy?: RetryPolicy
): AsyncGenerator<string> {
  const req = buildChatRequest(cfg, { ...params, stream: true });
  const retries = Math.max(0, policy?.retries ?? 2);
  const base = policy?.baseDelayMs ?? 200;
  let yielded = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let status: number | undefined;
    let phase: 'request' | 'stream' = 'request';
    try {
      const res = await fetchImpl(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
      });
      status = res.status;
      if (!res.ok || !res.body) {
        const detail = res.text ? await res.text().catch(() => '') : '';
        throw new Error(`LLM 请求失败 status=${res.status ?? '?'} ${detail.slice(0, 200)}`);
      }
      phase = 'stream';
      for await (const line of toLines(res.body)) {
        const chunk = parseStreamLine(line, cfg.provider, resolveEndpointKind(cfg));
        if (chunk?.text) {
          yielded += chunk.text.length;
          yield chunk.text;
        }
        if (chunk?.done) return;
      }
      return;
    } catch (e) {
      // 主动取消直接透传，不重试
      if (isAbortError(e)) throw normalizeAbortError(e);
      // 已向调用方吐出过内容：无法回滚重放，直接上抛
      if (yielded > 0) throw e;
      const reason = e instanceof Error ? e.message : String(e);
      // 断流属于传输故障，即使 HTTP 状态是 200 也应重试
      const retryable = phase === 'stream' ? true : isRetryable(status);
      if (attempt >= retries || !retryable) throw e;
      const delayMs = base * 2 ** attempt;
      policy?.onRetry?.({ attempt: attempt + 1, status, delayMs, reason });
      await sleep(delayMs);
    }
  }
}

export type AgentEvent =
  | { type: 'retrieve'; step: LlmTraceStep }
  | { type: 'delta'; text: string }
  /** 非致命提示（如上下文被裁剪）；code 供上层做 i18n，不带用户可见文案 */
  | { type: 'notice'; code: 'truncated' | 'badToolFormat'; detail: string }
  | { type: 'done' };

export interface RetrieveResult {
  context: string;
  trace: LlmTraceStep[];
}


/**
 * RAG Agent：先检索（注入 retrieve）注入上下文，再流式生成；LLM 失败回退本地资料。
 */
export async function* runAgent(opts: {
  cfg: LlmConfig;
  prompt: string;
  /**
   * 检索回调。允许返回 Promise（语义检索 / 远程 Embedder 常为异步），
   * 其核心价值是：异步失败也能被下面的 try 捕获并降级，而不是击穿整条链路。
   */
  retrieve: (query: string) => RetrieveResult | Promise<RetrieveResult>;
  fetchImpl: FetchLike;
  systemPrompt?: string;
  /** 之前轮次的对话（不含本轮 prompt），用于多轮上下文 */
  history?: ChatMessage[];
  retry?: RetryPolicy;
}): AsyncGenerator<AgentEvent> {
  const prompt = typeof opts.prompt === 'string' ? opts.prompt.trim() : '';
  if (!prompt) throw new Error('prompt 为空：请输入问题后再调用 Agent');

  let context = '';
  let trace: LlmTraceStep[] = [];
  try {
    const r = await Promise.resolve(opts.retrieve(prompt));
    context = typeof r?.context === 'string' ? r.context : '';
    trace = Array.isArray(r?.trace) ? r.trace : [];
  } catch (e) {
    context = '';
    trace = [
      { tool: 'retrieve', ok: false, summary: e instanceof Error ? e.message : String(e) },
    ];
  }
  for (const step of trace) yield { type: 'retrieve', step };

  const sys =
    opts.systemPrompt ??
    '你是 Markdown Studio 的本地知识库助手。请仅基于给定资料简洁作答并标注来源；资料不足则如实说明，不要编造。';
  const history = normalizeHistory(opts.history);
  const rawMessages: ChatMessage[] = [
    { role: 'system', content: sys },
    ...history,
    { role: 'user', content: `问题：${prompt}\n\n相关资料：\n${context || '（无）'}` },
  ];
  // 走通用消息裁剪：单条 + 总量双预算
  const clipped = clipMessages(rawMessages, {
    systemBudget: 4_000,
    perMessageBudget: MAX_PROMPT_CHARS,
    totalBudget: MAX_PROMPT_CHARS * 3,
  });
  const messages: ChatMessage[] = clipped.messages;
  if (clipped.trimmed.length) {
    yield { type: 'notice', code: 'truncated', detail: clipped.trimmed.join(',') };
  }

  try {
    for await (const piece of streamChat(
      opts.cfg,
      { messages, stream: true },
      opts.fetchImpl,
      opts.retry
    )) {
      if (piece) yield { type: 'delta', text: piece };
    }
  } catch (e) {
    // 主动取消不当作"LLM 失败"：直接上抛，让 UI 显示"已取消"。
    if (isAbortError(e)) throw normalizeAbortError(e);
    yield {
      type: 'delta',
      text: `\n[LLM 调用失败，回退本地检索]\n${e instanceof Error ? e.message : String(e)}\n\n${context}`,
    };
  }
  yield { type: 'done' };
}
