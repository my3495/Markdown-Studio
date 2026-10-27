import { describe, it, expect } from 'vitest';
import {
  CUSTOM_THEME_TOKENS,
  isAllowedThemeToken,
  sanitizeCustomVars,
} from '../src/renderer/themeTokens';

describe('themeTokens', () => {
  it('白名单含常用令牌', () => {
    expect(CUSTOM_THEME_TOKENS.some((t) => t.key === '--md-color-accent')).toBe(true);
    expect(isAllowedThemeToken('--md-font-size')).toBe(true);
    expect(isAllowedThemeToken('--md-evil')).toBe(false);
  });

  it('sanitize 丢弃非法键与注入', () => {
    const out = sanitizeCustomVars({
      '--md-color-accent': '#ff0000',
      '--md-evil': 'red',
      '--md-font-size': '18px; } body { display:none',
      '--md-line-height': '1.8',
    });
    expect(out).toEqual({
      '--md-color-accent': '#ff0000',
      '--md-line-height': '1.8',
    });
  });
});
