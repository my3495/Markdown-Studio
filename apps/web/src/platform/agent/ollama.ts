import { resolveProvider } from '@md-studio/core';

export interface OllamaProbeResult {
  ok: boolean;
  baseUrl: string;
  /** 已安装模型名（GET /api/tags） */
  models: string[];
  error?: string;
}

/**
 * 探测本地 Ollama 是否可达，并列出已安装模型。
 * 与聊天调用共用 core 的 provider 默认 baseUrl（http://localhost:11434），避免两处配置漂移。
 */
export async function probeOllama(timeoutMs = 2500): Promise<OllamaProbeResult> {
  const baseUrl = resolveProvider('ollama').baseUrl.replace(/\/+$/, '');
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: ctl.signal });
    if (!res.ok) {
      return { ok: false, baseUrl, models: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { models?: { name?: string }[] };
    const models = (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .sort((a, b) => a.localeCompare(b));
    return { ok: true, baseUrl, models };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    return { ok: false, baseUrl, models: [], error: aborted ? 'timeout' : String(e) };
  } finally {
    window.clearTimeout(timer);
  }
}
