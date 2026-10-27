/**
 * Function-calling Agent：让 LLM 自主决定调用哪些 Vault 工具（多轮工具循环）。
 * 支持 OpenAI 兼容、Ollama 与 Anthropic(Claude) tools；注入 fetch，可单测。
 * 最终答复支持流式输出（stream: true）。
 */

import type { VaultTools } from './tools';
import { summarizeToolResult } from './tools';
import { toAnthropicTools, toOpenAITools } from './toolschema';
import {
  EMPTY_RESPONSE_HINT,
  MAX_PROMPT_CHARS,
  assertApiKey,
  fetchWithRetry,
  isAbortError,
  normalizeAbortError,
  normalizeHistory,
  resolveBaseUrl,
  resolveEndpointKind,
  resolveProvider,
  toLines,
  type ChatMessage,
  type FetchLike,
  type LlmConfig,
  type ProviderKind,
  type ResponseLike,
  type RetryPolicy,
} from './llm';
import { clipMessages, type ClipMessage } from './context';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Agent 兜底文案（供上层做 i18n；缺省为内置中文，便于 headless 直接使用） */
export interface AgentHints {
  /** 模型返回空响应时 */
  emptyResponse?: string;
  /** 外部调用失败时，追加在错误原因前的说明 */
  callFailed?: string;
  /** 达到最大工具步数时 */
  maxSteps?: string;
}

export interface AssistantMessage {
  content: string;
  toolCalls: ToolCall[];
}

export interface JsonResponse {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  body?: unknown;
}

export type JsonFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<JsonResponse>;

function safeParseArgs(a: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; raw: string } {
  if (a && typeof a === 'object') return { ok: true, value: a as Record<string, unknown> };
  if (typeof a === 'string') {
    try {
      return { ok: true, value: JSON.parse(a) };
    } catch {
      // 解析失败：保留原文供调用方生成 notice（弱模型流式截断时常出现）
      return { ok: false, raw: a };
    }
  }
  return { ok: false, raw: '' };
}

export interface ToolsHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** 将含 system 的通用消息转为 Anthropic Messages API 形态 */
export function toAnthropicMessages(messages: unknown[]): {
  system?: string;
  messages: unknown[];
} {
  const systems: string[] = [];
  const out: unknown[] = [];
  for (const m of messages) {
    const msg = m as any;
    if (msg?.role === 'system') {
      if (typeof msg.content === 'string') systems.push(msg.content);
      continue;
    }
    out.push(msg);
  }
  return { system: systems.length ? systems.join('\n\n') : undefined, messages: out };
}

/** 构造带 tools 的聊天请求（默认非流式；stream=true 用于最终答复） */
export function buildToolsRequest(
  cfg: LlmConfig,
  messages: unknown[],
  tools: VaultTools,
  opts: { stream?: boolean } = {}
): ToolsHttpRequest {
  const def = resolveProvider(cfg.provider);
  const base = resolveBaseUrl(cfg);
  assertApiKey(cfg);
  const stream = opts.stream ?? false;
  const endpointKind = resolveEndpointKind(cfg);
  if (def.kind === 'ollama' && endpointKind === 'openai-compat') {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
    return {
      url: `${base.replace(/\/+$/, '')}/chat/completions`,
      headers,
      body: { model: cfg.model, messages, tools: toOpenAITools(tools), stream },
    };
  }
  if (def.kind === 'ollama') {
    return {
      url: `${base}/api/chat`,
      headers: { 'content-type': 'application/json' },
      body: { model: cfg.model, messages, tools: toOpenAITools(tools), stream },
    };
  }
  if (def.kind === 'anthropic') {
    const { system, messages: msgs } = toAnthropicMessages(messages);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
    return {
      url: `${base}/v1/messages`,
      headers,
      body: {
        model: cfg.model,
        max_tokens: 4096,
        stream,
        ...(system ? { system } : {}),
        messages: msgs,
        tools: toAnthropicTools(tools),
      },
    };
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  return {
    url: `${base}/chat/completions`,
    headers,
    body: { model: cfg.model, messages, tools: toOpenAITools(tools), stream },
  };
}

/** 解析非流式响应为 AssistantMessage（兼容 ollama / openai / anthropic） */
export function parseToolsResponse(
  json: unknown,
  provider: string,
  baseUrl?: string
): AssistantMessage {
  const def = resolveProvider(provider);
  const endpointKind =
    def.kind === 'ollama'
      ? baseUrl && /\/v1(\/|$)/.test(baseUrl)
        ? 'openai-compat'
        : 'native'
      : 'native';
  const j = json as any;
  if (def.kind === 'ollama' && endpointKind === 'openai-compat') {
    // 走 OpenAI 兼容协议（choices[0].message）
    const msg = j?.choices?.[0]?.message ?? {};
    const tcs = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    return {
      content: typeof msg.content === 'string' ? msg.content : '',
      toolCalls: tcs.map((tc: any, i: number) => {
        const r = safeParseArgs(tc?.function?.arguments);
        return {
          id: tc?.id ?? `call_${i}`,
          name: tc?.function?.name ?? '',
          arguments: r.ok ? r.value : {},
        };
      }),
    };
  }
  if (def.kind === 'ollama') {
    const m = j?.message ?? {};
    const tcs = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    return {
      content: typeof m.content === 'string' ? m.content : '',
      toolCalls: tcs.map((tc: any, i: number) => {
        const r = safeParseArgs(tc?.function?.arguments);
        return {
          id: `call_${i}`,
          name: tc?.function?.name ?? '',
          arguments: r.ok ? r.value : {},
        };
      }),
    };
  }
  if (def.kind === 'anthropic') {
    const blocks = Array.isArray(j?.content) ? j.content : [];
    let content = '';
    const toolCalls: ToolCall[] = [];
    for (const b of blocks) {
      if (b?.type === 'text' && typeof b.text === 'string') content += b.text;
      if (b?.type === 'tool_use') {
        const r = safeParseArgs(b.input);
        toolCalls.push({
          id: b.id ?? `call_${toolCalls.length}`,
          name: b.name ?? '',
          arguments: r.ok ? r.value : {},
        });
      }
    }
    return { content, toolCalls };
  }
  const msg = j?.choices?.[0]?.message ?? {};
  const tcs = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  return {
    content: typeof msg.content === 'string' ? msg.content : '',
    toolCalls: tcs.map((tc: any, i: number) => {
      const r = safeParseArgs(tc?.function?.arguments);
      return {
        id: tc?.id ?? `call_${i}`,
        name: tc?.function?.name ?? '',
        arguments: r.ok ? r.value : {},
      };
    }),
  };
}

/** 一次带工具的聊天，返回助手消息（5xx/429/网络异常自动退避重试） */
export async function chatWithTools(
  cfg: LlmConfig,
  messages: unknown[],
  tools: VaultTools,
  fetchImpl: JsonFetch,
  policy?: RetryPolicy
): Promise<AssistantMessage> {
  const req = buildToolsRequest(cfg, messages, tools, { stream: false });
  const res = await fetchWithRetry<JsonResponse>(
    fetchImpl,
    req,
    async (r) => {
      if (!r.ok || !r.json) {
        const detail = r.text ? await r.text().catch(() => '') : '';
        return `chat failed status=${r.status ?? '?'} ${detail.slice(0, 160)}`;
      }
      return null;
    },
    policy
  );
  let json: unknown;
  try {
    json = await res.json!();
  } catch (e) {
    // 网关返回 200 + HTML 错误页时，原始 SyntaxError 没有任何上下文
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `chat failed status=${res.status ?? '?'} 响应 JSON 解析失败：${detail.slice(0, 160)}`
    );
  }
  return parseToolsResponse(json, cfg.provider, cfg.baseUrl);
}

/**
 * 流式带工具聊天：边流边 yield 文本；结束时返回完整 AssistantMessage（含 tool_calls）。
 * 用于最终答复流式展示；若模型发起 tool_calls，文本增量仍可出现，但以完整消息为准。
 */
export async function* streamChatWithTools(
  cfg: LlmConfig,
  messages: unknown[],
  tools: VaultTools,
  fetchImpl: FetchLike,
  policy?: RetryPolicy
): AsyncGenerator<
  | { type: 'delta'; text: string }
  | { type: 'message'; message: AssistantMessage }
  | { type: 'notice'; code: 'truncated' | 'badToolFormat'; detail: string }
> {
  const req = buildToolsRequest(cfg, messages, tools, { stream: true });
  const res = await fetchWithRetry<ResponseLike>(
    fetchImpl,
    req,
    async (r) => {
      if (!r.ok || !r.body) {
        const detail = r.text ? await r.text().catch(() => '') : '';
        return `chat failed status=${r.status ?? '?'} ${detail.slice(0, 160)}`;
      }
      return null;
    },
    policy
  );

  const kind = resolveProvider(cfg.provider).kind;
  const endpointKind = resolveEndpointKind(cfg);
  /** Ollama + openai-compat：按 OpenAI 兼容协议解析流（SSE） */
  const isOllamaOpenAi = kind === 'ollama' && endpointKind === 'openai-compat';
  let content = '';
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  let anthropicTools: ToolCall[] = [];
  /**
   * Anthropic 多 tool_use 块按 index 并行累积，避免单变量被新块覆盖丢 delta。
   * 部分代理会交错 block_start / block_stop，用 Map<index, ...> 更稳。
   */
  const anthropicCurrent = new Map<
    number,
    { id: string; name: string; args: string }
  >();
  /** 解析失败时暂存，流结束前一次性 yield —— 避免在流循环里 yield 与下游消费错乱 */
  const notices: { type: 'notice'; code: 'truncated' | 'badToolFormat'; detail: string }[] = [];

  for await (const line of toLines(res.body)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Ollama 原生 NDJSON（default）走此分支；openai-compat 走 OpenAI SSE 分支
    if (kind === 'ollama' && !isOllamaOpenAi) {
      try {
        const obj = JSON.parse(trimmed);
        const piece = obj?.message?.content;
        if (typeof piece === 'string' && piece) {
          content += piece;
          yield { type: 'delta', text: piece };
        }
        const tcs = obj?.message?.tool_calls;
        if (Array.isArray(tcs) && tcs.length) {
          for (let i = 0; i < tcs.length; i++) {
            const tc = tcs[i];
            const prev = toolAcc.get(i) ?? { id: '', name: '', args: '' };
            // Ollama 标准：每 chunk 完整 args 替换；代理变体可能增量。
            // 检测：上游 args 是 prev 的真前缀（增量）→ 追加；否则替换。
            // 这里采取更稳的策略：上游 id 变化 → 新一轮，全量；否则增量追加。
            if (tc?.id && tc.id !== prev.id) {
              toolAcc.set(i, {
                id: tc.id,
                name: tc?.function?.name ?? '',
                args:
                  typeof tc?.function?.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc?.function?.arguments ?? {}),
              });
            } else {
              // 累加 args（也兼容对象形态的代理）
              const newArgs =
                typeof tc?.function?.arguments === 'string'
                  ? tc.function.arguments
                  : tc?.function?.arguments !== undefined
                    ? JSON.stringify(tc.function.arguments)
                    : '';
              const incremental =
                newArgs && prev.args && newArgs.startsWith(prev.args)
                  ? newArgs.slice(prev.args.length)
                  : newArgs;
              toolAcc.set(i, {
                id: prev.id || `call_${i}`,
                name: prev.name || (tc?.function?.name ?? ''),
                args: prev.args + incremental,
              });
            }
          }
        }
        if (obj?.done) break;
      } catch {
        /* ignore */
      }
      continue;
    }

    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') break;
    let obj: any;
    try {
      obj = JSON.parse(payload);
    } catch {
      continue;
    }

    if (kind === 'anthropic') {
      // 优先用 obj.index；缺失时用 content_block 内部 index；都没有则用 -1（仅一份）
      const blockIndex =
        typeof obj.index === 'number'
          ? obj.index
          : typeof obj.content_block?.index === 'number'
            ? obj.content_block.index
            : -1;
      if (obj.type === 'content_block_start' && obj.content_block?.type === 'tool_use') {
        anthropicCurrent.set(blockIndex, {
          id: obj.content_block.id ?? `call_${anthropicTools.length}`,
          name: obj.content_block.name ?? '',
          args: '',
        });
      } else if (obj.type === 'content_block_delta') {
        let current = anthropicCurrent.get(blockIndex);
        // 隐式 start：弱流省略 content_block_start 但仍能正常累积
        if (!current && obj.delta?.type === 'input_json_delta') {
          current = {
            id: `call_${anthropicTools.length}`,
            name: '',
            args: '',
          };
          anthropicCurrent.set(blockIndex, current);
        }
        if (obj.delta?.type === 'text_delta' && typeof obj.delta.text === 'string') {
          content += obj.delta.text;
          yield { type: 'delta', text: obj.delta.text };
        } else if (obj.delta?.type === 'input_json_delta' && current) {
          current.args += obj.delta.partial_json ?? '';
        }
      } else if (obj.type === 'content_block_stop') {
        const current = anthropicCurrent.get(blockIndex);
        if (current) {
          const r = safeParseArgs(current.args || '{}');
          anthropicTools.push({
            id: current.id,
            name: current.name,
            arguments: r.ok ? r.value : {},
          });
          if (!r.ok && current.args) {
            // 流式截断导致 args 不是合法 JSON：通知 UI 但不中断
            notices.push({
              type: 'notice',
              code: 'badToolFormat',
              detail: `tool_use ${current.name} args truncated`,
            });
          }
          anthropicCurrent.delete(blockIndex);
        }
      } else if (obj.type === 'message_stop') break;
      continue;
    }

    // OpenAI 兼容
    const delta = obj?.choices?.[0]?.delta;
    if (typeof delta?.content === 'string' && delta.content) {
      content += delta.content;
      yield { type: 'delta', text: delta.content };
    }
    if (Array.isArray(delta?.tool_calls)) {
      // 异常协议检测：≥2 个 tool_calls 但都缺 index 字段时，全部合到 idx=0 会丢数据
      // 一次性提示后兜底累加（不阻断流程）
      if (
        delta.tool_calls.length >= 2 &&
        delta.tool_calls.every((tc: any) => typeof tc?.index !== 'number')
      ) {
        notices.push({
          type: 'notice',
          code: 'badToolFormat',
          detail: `openai multi-tool_calls missing index (n=${delta.tool_calls.length})`,
        });
      }
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === 'number' ? tc.index : 0;
        const prev = toolAcc.get(idx) ?? { id: '', name: '', args: '' };
        if (tc.id) prev.id = tc.id;
        // 部分 provider 会在多个 delta 里重复下发 function.name，
        // 累加会得到 'searchsearch'；名称只在首次出现时写入
        if (tc.function?.name && !prev.name) prev.name = tc.function.name;
        if (typeof tc.function?.arguments === 'string') prev.args += tc.function.arguments;
        toolAcc.set(idx, prev);
      }
    }
    if (obj?.choices?.[0]?.finish_reason) {
      /* continue until stream ends */
    }
  }

  const toolCalls: ToolCall[] =
    kind === 'anthropic'
      ? anthropicTools
      : [...toolAcc.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, t], i) => {
            const r = safeParseArgs(t.args || '{}');
            if (!r.ok && t.args) {
              // 流式截断 / 弱模型导致 args 不是合法 JSON：通知 UI
              notices.push({
                type: 'notice',
                code: 'badToolFormat',
                detail: `tool_call ${t.name || '?'} args truncated`,
              });
            }
            return {
              id: t.id || `call_${i}`,
              name: t.name,
              arguments: r.ok ? r.value : {},
            };
          });

  // 把累积的 notices 在 message 事件前一次性 yield（生成器内多 yield 不会乱序）
  for (const n of notices) yield n;
  yield { type: 'message', message: { content, toolCalls } };
}

export type ToolAgentEvent =
  | { type: 'tool'; name: string; args: Record<string, unknown>; ok: boolean; summary: string }
  | { type: 'delta'; text: string }
  /** 发生重试：让上层能展示「重试中」，避免静默等待 */
  | { type: 'retry'; attempt: number; status?: number; delayMs: number; reason: string }
  /** 非致命提示（如上下文被截断）；code 供上层做 i18n，不带用户可见文案 */
  | { type: 'notice'; code: 'truncated' | 'badToolFormat'; detail: string }
  /** 外部依赖失败：错误以事件形式暴露，流仍以 done 正常收尾 */
  | { type: 'error'; message: string }
  | { type: 'done' };

function assistantHistory(msg: AssistantMessage, kind: ProviderKind): unknown {
  if (kind === 'ollama') {
    return {
      role: 'assistant',
      content: msg.content || '',
      tool_calls: msg.toolCalls.map((tc) => ({
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
  }
  if (kind === 'anthropic') {
    const content: unknown[] = [];
    if (msg.content) content.push({ type: 'text', text: msg.content });
    for (const tc of msg.toolCalls) {
      content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
    }
    return { role: 'assistant', content };
  }
  return {
    role: 'assistant',
    content: msg.content || null,
    tool_calls: msg.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    })),
  };
}

function toolResultHistory(call: ToolCall, result: unknown, kind: ProviderKind): unknown {
  const text = JSON.stringify(result);
  if (kind === 'ollama') return { role: 'tool', content: text };
  if (kind === 'anthropic') {
    // 单条时也可用；多工具时由 batchAnthropicToolResults 合并
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: call.id, content: text }],
    };
  }
  return { role: 'tool', tool_call_id: call.id, content: text };
}

/** Anthropic 要求同一轮多个 tool_result 合并为一条 user 消息 */
function batchAnthropicToolResults(
  calls: { call: ToolCall; result: unknown }[]
): unknown {
  return {
    role: 'user',
    content: calls.map(({ call, result }) => ({
      type: 'tool_result',
      tool_use_id: call.id,
      content: JSON.stringify(result),
    })),
  };
}

/**
 * 识别「伪工具调用」：小参数模型有时不走 tool_calls 协议，而是把
 * `{"name":"search","arguments":{...}}` 当成正文输出。用于给上层发 notice，
 * 避免用户把原始 JSON 误当回答。
 *
 * 只接受完整的 JSON 对象（而非前缀正则），正文长度上限 2000，降低误判。
 */
export function looksLikeToolCallJson(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t.startsWith('{') || t.length > 2000) return false;
  try {
    const obj = JSON.parse(t) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object') return false;
    const name = obj.name ?? obj.tool ?? obj.function;
    const args = obj.arguments ?? obj.args ?? obj.parameters ?? obj.input;
    return typeof name === 'string' && args !== undefined;
  } catch {
    return false;
  }
}

/**
 * 工具调用 Agent 循环：模型自主选择工具 → 执行 → 回填 → 直至给出最终答复。
 * 最终答复默认流式（streamFinal=true）；中间工具轮次用非流式以保证 tool_calls 完整。
 */
export async function* runToolAgent(opts: {
  cfg: LlmConfig;
  tools: VaultTools;
  prompt: string;
  /** 之前轮次的对话（不含本轮 prompt），用于多轮上下文 */
  history?: ChatMessage[];
  fetchImpl: JsonFetch;
  /** 流式最终答复时使用；缺省则复用 fetchImpl（需支持 body 流） */
  streamFetch?: FetchLike;
  maxSteps?: number;
  systemPrompt?: string;
  /** 最终无工具调用时是否流式输出（默认 true） */
  streamFinal?: boolean;
  /** 失败重试策略 */
  retry?: RetryPolicy;
  /** 兜底文案注入：headless 场景用内置中文，UI 可传入已翻译文案 */
  hints?: AgentHints;
}): AsyncGenerator<ToolAgentEvent> {
  const hints: Required<AgentHints> = {
    emptyResponse: opts.hints?.emptyResponse ?? EMPTY_RESPONSE_HINT,
    callFailed: opts.hints?.callFailed ?? '[模型调用失败]',
    maxSteps: opts.hints?.maxSteps ?? '\n[已达最大工具调用步数]',
  };
  const kind = resolveProvider(opts.cfg.provider).kind;
  const sys =
    opts.systemPrompt ||
    '你是 Markdown Studio 知识库助手。可调用工具检索/阅读/管理笔记（search、read_note、get_backlinks 等）。需要资料时先调用工具，回答须标注来源，切勿编造。';
  // 空输入短路：不发起任何请求
  const prompt = typeof opts.prompt === 'string' ? opts.prompt.trim() : '';
  if (!prompt) throw new Error('prompt 为空：请输入问题后再调用 Agent');
  const history = normalizeHistory(opts.history);
  const rawMessages: ClipMessage[] = [
    { role: 'system', content: sys },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: prompt },
  ];
  // 通用消息裁剪：system/per/total 三层预算
  const clipped = clipMessages(rawMessages, {
    systemBudget: 4_000,
    perMessageBudget: MAX_PROMPT_CHARS,
    totalBudget: MAX_PROMPT_CHARS * 3,
  });
  const messages: unknown[] = clipped.messages;
  const maxSteps = opts.maxSteps ?? 6;
  const streamFinal = opts.streamFinal !== false;
  const streamFetch = opts.streamFetch;

  // 重试回调在 await 期间触发，生成器无法在回调里 yield，先入队再于安全点排出
  const queued: ToolAgentEvent[] = [];
  const policy: RetryPolicy = {
    ...opts.retry,
    onRetry: (info) => {
      opts.retry?.onRetry?.(info);
      queued.push({ type: 'retry', ...info });
    },
  };
  const drain = function* () {
    while (queued.length) yield queued.shift()!;
  };

  // 上下文被静默截断对用户不可见，这里显式告知
  const trimmedHistory = (opts.history ?? []).length > history.length;
  const truncatedPrompt = prompt.length > MAX_PROMPT_CHARS;
  if (truncatedPrompt || trimmedHistory) {
    yield {
      type: 'notice',
      code: 'truncated',
      detail: `prompt=${prompt.length}/${MAX_PROMPT_CHARS}; history=${history.length}/${(opts.history ?? []).length}`,
    };
  }

  try {
  // 工具循环检测：同一 (toolName, arguments) 组合出现超过 3 次视为异常
  const callCounts = new Map<string, number>();

  for (let step = 0; step < maxSteps; step++) {
    // 流式路径：实时 delta；若本轮含 tool_calls，中间正文通常为空或可忽略
    if (streamFinal && streamFetch) {
      let msg: AssistantMessage | null = null;
      let yielded = 0;
      for await (const ev of streamChatWithTools(opts.cfg, messages, opts.tools, streamFetch, policy)) {
        if (ev.type === 'delta') {
          yielded += ev.text.length;
          yield { type: 'delta', text: ev.text };
        } else if (ev.type === 'message') {
          msg = ev.message;
        } else if (ev.type === 'notice') {
          // badToolFormat / truncated 透传给上层（AgentChat → eventTraceStep 转 trace 步骤）
          yield { type: 'notice', code: ev.code, detail: ev.detail };
        }
      }
      yield* drain();
      if (!msg) throw new Error('empty stream response');
      if (msg.toolCalls.length === 0) {
        if (!yielded) yield { type: 'delta', text: msg.content || hints.emptyResponse };
        if (looksLikeToolCallJson(msg.content)) {
          yield { type: 'notice', code: 'badToolFormat', detail: msg.content.slice(0, 200) };
        }
        yield { type: 'done' };
        return;
      }
      messages.push(assistantHistory(msg, kind));
      {
        const batch: { call: ToolCall; result: unknown }[] = [];
        for (const call of msg.toolCalls) {
          // 工具循环检测：同一 (name, args) 组合出现 3 次则停止循环并报错
          const callKey = `${call.name}:${JSON.stringify(call.arguments)}`;
          const count = (callCounts.get(callKey) ?? 0) + 1;
          callCounts.set(callKey, count);
          if (count > 3) {
            yield {
              type: 'tool',
              name: call.name,
              args: call.arguments,
              ok: false,
              summary: `重复调用检测：${call.name} 已被调用 3 次以上，停止循环`,
            };
            yield { type: 'done' };
            return;
          }
          const result = opts.tools.call(call.name, call.arguments);
          yield {
            type: 'tool',
            name: call.name,
            args: call.arguments,
            ok: result.ok,
            summary: summarizeToolResult(result),
          };
          batch.push({ call, result });
        }
        if (kind === 'anthropic') messages.push(batchAnthropicToolResults(batch));
        else for (const { call, result } of batch) messages.push(toolResultHistory(call, result, kind));
      }
      continue;
    }

    // 非流式回退（单测 / 未注入 streamFetch）
    const msg = await chatWithTools(opts.cfg, messages, opts.tools, opts.fetchImpl, policy);
    yield* drain();
    if (msg.toolCalls.length === 0) {
      yield { type: 'delta', text: msg.content || hints.emptyResponse };
      if (looksLikeToolCallJson(msg.content)) {
        yield { type: 'notice', code: 'badToolFormat', detail: msg.content.slice(0, 200) };
      }
      yield { type: 'done' };
      return;
    }
messages.push(assistantHistory(msg, kind));
    {
      const batch: { call: ToolCall; result: unknown }[] = [];
      for (const call of msg.toolCalls) {
        // 工具循环检测（与非流式路径共用）
        const callKey = `${call.name}:${JSON.stringify(call.arguments)}`;
        const count = (callCounts.get(callKey) ?? 0) + 1;
        callCounts.set(callKey, count);
        if (count > 3) {
          yield {
            type: 'tool',
            name: call.name,
            args: call.arguments,
            ok: false,
            summary: `重复调用检测：${call.name} 已被调用 3 次以上，停止循环`,
          };
          yield { type: 'done' };
          return;
        }
        const result = opts.tools.call(call.name, call.arguments);
        yield {
          type: 'tool',
          name: call.name,
          args: call.arguments,
          ok: result.ok,
          summary: summarizeToolResult(result),
        };
        batch.push({ call, result });
      }
      if (kind === 'anthropic') messages.push(batchAnthropicToolResults(batch));
      else for (const { call, result } of batch) messages.push(toolResultHistory(call, result, kind));
    }
  }
    yield { type: 'delta', text: hints.maxSteps };
  } catch (e) {
    // 用户主动取消不视为"模型调用失败"——冒到上层后 UI 会显示"已取消"。
    // 用 isAbortError 兼容 abort(reason) 传入字符串的情形（否则 reason 本身会成为
    // 错误消息，trace 里出现"模型调用失败：user_cancelled"）。
    if (isAbortError(e)) throw normalizeAbortError(e);
    // 外部依赖失败不向上抛：以 error 事件暴露原因，并保证流以 done 收尾
    // 错误只走 error 事件，不混入 delta —— 避免 UI 把"模型调用失败"当成模型正文
    // callFailed 文案保留在 hints 里供上层做 i18n；UI 端通过 eventTraceStep 把 error 转成 trace 步骤
    void hints;
    const message = e instanceof Error ? e.message : String(e);
    yield { type: 'error', message };
  }
  yield { type: 'done' };
}
