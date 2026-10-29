/**
 * 统一模型列表 store：各 provider 统一暴露 models + loading + error。
 * Ollama 用已有 store（platform/agent/ollama），其余走本文件动态拉取。
 */
import { create } from 'zustand';
import { resolveProvider } from '@md-studio/core';

export interface ModelsState {
  /** 当前 provider 的模型列表 */
  models: string[];
  loading: boolean;
  error?: string;
  /** 拉取当前 provider 的模型列表（需 apiKey + baseUrl） */
  fetch: (provider: string, apiKey: string, baseUrl?: string) => Promise<void>;
}

interface ModelListResult {
  models: string[];
  error?: string;
}

/* ─────────────── 各 Provider 专用 API ─────────────── */

/** 通用 OpenAI 兼容 endpoint：GET /v1/models */
async function fetchOpenAiModels(
  baseUrl: string,
  apiKey: string
): Promise<ModelListResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  if (import.meta.env.DEV) console.log('[Models] Fetching:', url);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      if (import.meta.env.DEV) console.log('[Models] HTTP error:', res.status, res.statusText);
      return { models: [], error: `HTTP ${res.status} ${res.statusText}` };
    }
    const data = (await res.json()) as {
      data?: { id?: string }[];
    };
    const models = (data.data ?? [])
      .map((m) => m.id)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .sort((a, b) => a.localeCompare(b));
    if (import.meta.env.DEV) console.log('[Models] Got models:', models.length);
    return { models };
  } catch (e) {
    // CORS 或网络错误
    const msg = String(e);
    if (import.meta.env.DEV) console.log('[Models] Fetch error:', msg);
    // 区分 CORS 错误和其他错误
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
      return { models: [], error: 'CORS/网络错误（请检查 API 是否支持浏览器调用）' };
    }
    return { models: [], error: msg };
  }
}

/** DeepSeek: 通过 Vite 代理（开发环境） */
async function fetchDeepSeekModels(apiKey: string): Promise<ModelListResult> {
  if (import.meta.env.DEV) console.log('[Models] Fetching DeepSeek via proxy...');
  // 开发环境走 /api/deepseek 代理（避免浏览器 CORS 限制）
  const result = await fetchOpenAiModels('/api/deepseek', apiKey);
  if (import.meta.env.DEV) console.log('[Models] DeepSeek result:', result);
  return result;
}

/** Qwen/DashScope: 通过 Vite 代理（开发环境） */
async function fetchQwenModels(apiKey: string): Promise<ModelListResult> {
  return fetchOpenAiModels('/api/qwen/compatible-mode/v1', apiKey);
}

/** Kimi/Moonshot: 通过 Vite 代理（开发环境） */
async function fetchKimiModels(apiKey: string): Promise<ModelListResult> {
  return fetchOpenAiModels('/api/kimi/v1', apiKey);
}

/** GLM/Zhipu: 通过 Vite 代理（开发环境） */
async function fetchGlmModels(apiKey: string): Promise<ModelListResult> {
  return fetchOpenAiModels('/api/glm/api/paas/v4', apiKey);
}

/** Doubao/Volcengine: 无标准 OpenAI 兼容 models 端点，使用预定义列表 */
async function fetchDoubaoModels(_apiKey: string): Promise<ModelListResult> {
  // 豆包模型列表从预定义获取（方舟 API 需要 HMAC 签名，浏览器端不适用）
  return { models: getFallbackModels('doubao') };
}

/* ─────────────── 预定义模型兜底列表 ─────────────── */

/** Provider → 预定义模型列表（API 调用失败时的兜底） */
const FALLBACK_MODELS: Record<string, string[]> = {
  openai: [
    // 2026 主流模型
    'gpt-4o',
    'gpt-4o-mini',
    'o3-mini',
    'o1-mini',
    'gpt-4.5',
  ],
  claude: [
    // Claude 4 系列（2025）
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-sonnet-4-20250514',
    // Claude 3.5 系列（仍常用）
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
    'claude-3-opus-latest',
    'claude-3-sonnet-latest',
    'claude-3-haiku-latest',
  ],
  deepseek: [
    // DeepSeek 当前活跃模型 (2026)
    'deepseek-flash', // 官方主推，已升级为 V4.1，所有请求按 Flash 价格计费
    'deepseek-v4-pro', // 高端版本
    'deepseek-v3', // 通用模型
    'deepseek-coder', // 代码专用
  ],
  qwen: [
    // Qwen3 系列（2025）
    'qwen3-32b',
    'qwen3-14b',
    'qwen3-7b',
    'qwen3-4b',
    'qwen3-1.5b',
    // Qwen2.5 系列（仍常用）
    'qwen2.5-72b-instruct',
    'qwen2.5-32b-instruct',
    'qwen2.5-14b-instruct',
    'qwen2.5-7b-instruct',
    'qwen2.5-coder-32b-instruct',
    'qwen2.5-coder-7b-instruct',
    'qwen2.5-math-72b',
    'qwq-32b-preview',
    // Qwen2 系列
    'qwen2-72b-instruct',
    'qwen2-7b-instruct',
  ],
  glm: [
    // GLM-5 系列（2025）
    'glm-5.3',
    'glm-5',
    'glm-5-turbo',
    'glm-5.1',
    // GLM-4 系列（仍常用）
    'glm-4.7',
    'glm-4.6',
    'glm-4-plus',
    'glm-4-airx',
    'glm-4-air',
    'glm-4-flash',
    'glm-4-long',
    'glm-4v',
    'glm-4-0520',
  ],
  kimi: [
    // Kimi 系列
    'moonshot-v1-8k',
    'moonshot-v1-32k',
    'moonshot-v1-128k',
    // Kimi 新模型
    'kimi-k3',
    'kimi-k2.5',
    'kimi-k2',
  ],
  doubao: [
    // Doubao-pro 系列（带版本号，官方推荐格式）
    'doubao-pro-32k',
    'doubao-pro-32k-241215',
    'doubao-pro-128k',
    'doubao-pro-256k',
    // Doubao-lite 系列
    'doubao-lite-32k',
    'doubao-lite-128k',
    // Doubao-vision 系列
    'doubao-vision-pro-32k',
    'doubao-vision-lite-32k',
    // Doubao-seed 系列（最新）
    'doubao-seed-2.1-pro',
    'doubao-seed-2.1-turbo',
    'doubao-seed-2.0-pro',
    'doubao-seed-2.0-lite',
    'doubao-seed-2.0-mini',
  ],
};

/** 获取预定义模型列表 */
function getFallbackModels(provider: string): string[] {
  return FALLBACK_MODELS[provider] ?? [];
}

/** Anthropic（无公开 API，使用预定义） */
function getAnthropicModels(): string[] {
  return FALLBACK_MODELS['claude'] ?? [];
}

export const useModels = create<ModelsState>((set) => ({
  models: [],
  loading: false,
  error: undefined,

  fetch: async (provider, apiKey, baseUrl) => {
    // 切换 provider 时先清空旧数据，避免下拉框显示上一个 provider 的模型
    set({ loading: true, error: undefined, models: [] });

    // Ollama：模型列表由 useOllama.check() 单独处理
    if (provider === 'ollama') {
      set({ loading: false });
      return;
    }

    const def = resolveProvider(provider);
    const base = baseUrl || def.baseUrl;
    // 下面 if/else 链已穷尽所有 provider，初始值永远不会被读到，故不初始化
    let result: ModelListResult;

    if (provider === 'claude') {
      // Anthropic 无公开模型列表 API，使用预定义列表
      result = { models: getAnthropicModels() };
    } else if (provider === 'deepseek') {
      result = await fetchDeepSeekModels(apiKey);
    } else if (provider === 'qwen') {
      result = await fetchQwenModels(apiKey);
    } else if (provider === 'kimi') {
      result = await fetchKimiModels(apiKey);
    } else if (provider === 'glm') {
      result = await fetchGlmModels(apiKey);
    } else if (provider === 'doubao') {
      result = await fetchDoubaoModels(apiKey);
    } else if (apiKey && base) {
      // 通用的 OpenAI 兼容 endpoint（custom 或其他）
      result = await fetchOpenAiModels(base, apiKey);
    } else {
      // 无 apiKey 或未知 provider，使用预定义列表兜底
      result = { models: getFallbackModels(provider) };
    }

    // API 失败时用预定义列表兜底
    if (result.models.length === 0) {
      result.models = getFallbackModels(provider);
    }

    set({
      models: result.models,
      error: result.error,
      loading: false,
    });
  },
}));
