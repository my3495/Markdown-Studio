import { describe, it, expect } from 'vitest';
import {
  TokenMeter,
  estimateRoundUsage,
  parseUsageFromResponse,
} from '../src/agent/tokens';

describe('token usage', () => {
  it('parseUsageFromResponse OpenAI', () => {
    expect(
      parseUsageFromResponse({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
    ).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it('parseUsageFromResponse Anthropic', () => {
    expect(
      parseUsageFromResponse({ usage: { input_tokens: 8, output_tokens: 2 } })
    ).toEqual({ promptTokens: 8, completionTokens: 2, totalTokens: 10 });
  });

  it('TokenMeter 累计', () => {
    const m = new TokenMeter();
    m.record({
      ...estimateRoundUsage('你好世界', '答案'),
      provider: 'ollama',
      model: 'qwen',
      estimated: true,
    });
    expect(m.totals().totalTokens).toBeGreaterThan(0);
    expect(m.history()).toHaveLength(1);
  });
});
