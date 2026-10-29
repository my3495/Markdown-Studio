import { describe, it, expect } from 'vitest';
import {
  CUSTOM_THEME_TOKENS,
  FONT_FAMILY_PRESETS,
  isAllowedThemeToken,
  normalizeFontFamily,
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

  it('normalizeFontFamily 补通用族兜底并给含空格的名字加引号', () => {
    // 用户实际写法：sans 不是合法通用族，不补全会整串失效
    expect(normalizeFontFamily('PingFang SC, sans')).toBe("'PingFang SC', sans-serif");
    expect(normalizeFontFamily('Microsoft YaHei')).toBe("'Microsoft YaHei', sans-serif");
    expect(normalizeFontFamily('PingFang SC, sans-serif')).toBe("'PingFang SC', sans-serif");
    // 已合规的栈保持原样（仅统一引号与空格）
    expect(normalizeFontFamily("'PingFang SC', 'Microsoft YaHei', sans-serif")).toBe(
      "'PingFang SC', 'Microsoft YaHei', sans-serif"
    );
    expect(normalizeFontFamily('mono')).toBe('monospace');
    expect(normalizeFontFamily('system-ui')).toBe('system-ui');
  });

  it('normalizeFontFamily 拒绝空串/注入/继承关键字', () => {
    expect(normalizeFontFamily('')).toBe('');
    expect(normalizeFontFamily('   ,  ')).toBe('');
    expect(normalizeFontFamily('inherit')).toBe('');
    expect(normalizeFontFamily('serif; } body{display:none')).toBe('');
  });

  it('sanitize 保留字体原文（受控输入框不能边打字边改写），注入仍被拦截', () => {
    expect(sanitizeCustomVars({ '--md-font-family': 'PingFang SC, sans' })).toEqual({
      '--md-font-family': 'PingFang SC, sans',
    });
    expect(sanitizeCustomVars({ '--md-font-family': 'serif; } body{display:none' })).toEqual({});
  });

  it('sanitize 不做 trim（否则输入框里的空格会被立刻吃掉）', () => {
    expect(sanitizeCustomVars({ '--md-font-family': 'PingFang SC' })).toEqual({
      '--md-font-family': 'PingFang SC',
    });
    expect(sanitizeCustomVars({ '--md-max-width': ' 780px ' })).toEqual({
      '--md-max-width': ' 780px ',
    });
  });

  it('字体候选都是合法 font-family 栈（规整后稳定不变）', () => {
    for (const preset of FONT_FAMILY_PRESETS) {
      const once = normalizeFontFamily(preset);
      // 预设本身必须完全合规（不会被补通用族、不会被加/去引号改变语义）
      expect(normalizeFontFamily(once)).toBe(once);
      expect(once.split(', ').length).toBe(preset.split(',').length);
    }
  });
});
