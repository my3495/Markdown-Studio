import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyTheme, resolveTheme, watchSystemTheme } from '../theme';

const root = () => document.documentElement;
const readVar = (name: string) => root().style.getPropertyValue(name);

describe('applyTheme', () => {
  beforeEach(() => {
    root().className = '';
    root().removeAttribute('style');
  });

  it('P-01 注入主题变量并切换 dark class', () => {
    applyTheme('dark', {});
    expect(root().classList.contains('dark')).toBe(true);
    expect(readVar('--md-color-bg')).toBe('#1a1815');

    applyTheme('light', {});
    expect(root().classList.contains('dark')).toBe(false);
    expect(readVar('--md-color-bg')).toBe('#ffffff');
  });

  it('P-02 自定义令牌覆盖主题默认值', () => {
    applyTheme('light', { '--md-color-accent': '#1f6feb', '--md-radius': '4px' });
    expect(readVar('--md-color-accent')).toBe('#1f6feb');
    expect(readVar('--md-radius')).toBe('4px');
  });

  it('P-03 空值回退主题默认，而不是残留上一次的自定义值', () => {
    applyTheme('light', { '--md-color-accent': '#1f6feb' });
    expect(readVar('--md-color-accent')).toBe('#1f6feb');

    applyTheme('light', { '--md-color-accent': '' });
    expect(readVar('--md-color-accent')).toBe('#a9501d');
  });

  it('P-04 字体令牌写 CSS 前被规整，书写区字体同步', () => {
    applyTheme('light', { '--md-font-family': 'PingFang SC, sans' });
    expect(readVar('--md-font-family')).toBe("'PingFang SC', sans-serif");
    expect(readVar('--md-font-editor')).toBe("'PingFang SC', sans-serif");
  });

  it('P-05 未自定义字体时书写区保持等宽', () => {
    applyTheme('light', {});
    expect(readVar('--md-font-editor')).toContain('monospace');
  });

  it('P-06 字体输入非法（继承关键字）时回退主题默认字体', () => {
    applyTheme('light', { '--md-font-family': 'inherit' });
    expect(readVar('--md-font-family')).toContain('PingFang SC');
    expect(readVar('--md-font-editor')).toContain('monospace');
  });

  it('P-07 丢弃白名单外的令牌与注入串', () => {
    applyTheme('light', {
      '--md-evil': 'red',
      '--md-color-accent': 'red; } body{display:none',
    });
    expect(readVar('--md-evil')).toBe('');
    expect(readVar('--md-color-accent')).toBe('#a9501d');
  });

  it('P-08 主题切换时清掉上一个主题派生出来的值（不残留 dark 令牌）', () => {
    applyTheme('dark', {});
    const darkSurface = readVar('--md-color-surface');
    applyTheme('light', {});
    expect(readVar('--md-color-surface')).not.toBe(darkSurface);
    expect(root().classList.contains('dark')).toBe(false);
  });
});

describe('resolveTheme / watchSystemTheme', () => {
  let matches = false;
  const listeners = new Set<() => void>();

  beforeEach(() => {
    matches = false;
    listeners.clear();
    const mql = {
      get matches() {
        return matches;
      },
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => mql),
    });
  });

  afterEach(() => {
    listeners.clear();
  });

  it('P-09 显式模式不受系统配色影响', () => {
    matches = true;
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('P-10 跟随系统时按 prefers-color-scheme 解析', () => {
    expect(resolveTheme('system')).toBe('light');
    matches = true;
    expect(resolveTheme('system')).toBe('dark');
  });

  it('P-11 系统配色变化触发回调，取消监听后不再触发且彻底解绑', () => {
    const cb = vi.fn();
    const stop = watchSystemTheme(cb);
    expect(listeners.size).toBe(1);

    matches = true;
    listeners.forEach((l) => l());
    expect(cb).toHaveBeenLastCalledWith('dark');

    stop();
    expect(listeners.size).toBe(0);
  });
});
