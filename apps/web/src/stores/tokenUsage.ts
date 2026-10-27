import { create } from 'zustand';
import {
  TokenMeter,
  estimateRoundUsage,
  parseUsageFromResponse,
  type TokenUsage,
  type TokenUsageEvent,
} from '@md-studio/core';

const meter = new TokenMeter();

interface TokenUsageState {
  last: TokenUsageEvent | null;
  totals: TokenUsage;
  recordEstimated: (opts: {
    prompt: string;
    completion: string;
    provider: string;
    model: string;
  }) => void;
  recordFromJson: (opts: {
    json: unknown;
    prompt: string;
    completion: string;
    provider: string;
    model: string;
  }) => void;
  clear: () => void;
}

function syncTotals(): TokenUsage {
  return meter.totals();
}

export const useTokenUsage = create<TokenUsageState>((set) => ({
  last: null,
  totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },

  recordEstimated: ({ prompt, completion, provider, model }) => {
    const usage = estimateRoundUsage(prompt, completion);
    const last = meter.record({ ...usage, provider, model, estimated: true });
    set({ last, totals: syncTotals() });
  },

  recordFromJson: ({ json, prompt, completion, provider, model }) => {
    const parsed = parseUsageFromResponse(json);
    const usage = parsed ?? estimateRoundUsage(prompt, completion);
    const last = meter.record({
      ...usage,
      provider,
      model,
      estimated: !parsed,
    });
    set({ last, totals: syncTotals() });
  },

  clear: () => {
    meter.clear();
    set({
      last: null,
      totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
  },
}));
