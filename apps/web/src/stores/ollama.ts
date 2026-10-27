import { create } from 'zustand';
import { probeOllama } from '../platform/agent/ollama';
import { useSettings } from './settings';

export type OllamaStatus = 'idle' | 'checking' | 'online' | 'offline';

interface OllamaState {
  status: OllamaStatus;
  baseUrl: string;
  models: string[];
  error?: string;
  /** 探测本地 Ollama 连通性；可达时若模型名为空则自动选用第一个已安装模型 */
  check: () => Promise<void>;
}

export const useOllama = create<OllamaState>((set) => ({
  status: 'idle',
  baseUrl: '',
  models: [],

  check: async () => {
    set({ status: 'checking' });
    const r = await probeOllama();
    set({
      status: r.ok ? 'online' : 'offline',
      baseUrl: r.baseUrl,
      models: r.models,
      error: r.error,
    });
    const s = useSettings.getState();
    if (r.ok && r.models.length > 0 && !s.agent.model) {
      s.setAgent({ model: r.models[0] });
    }
  },
}));
