import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseShareHash, shareUrlForId, shareUrlForPayload } from '../share/store';
import { applyTheme, resolveTheme } from '../theme';

/**
 * 平台层的两段纯逻辑：
 * - 分享 hash 路由（`#share/<id>` / `#share/p/<payload>`）：解析错了就打不开分享页；
 * - 主题解析与注入：system 跟随系统、自定义变量必须过滤。
 */

describe('parseShareHash', () => {
  it('F-28 普通分享 id', () => {
    expect(parseShareHash('#share/abc123')).toEqual({ id: 'abc123' });
  });

  it('F-29 payload 分享（#share/p/...）', () => {
    expect(parseShareHash('#share/p/eyJ2IjoxfQ')).toEqual({ payload: 'eyJ2IjoxfQ' });
  });

  it('F-30 不带 # 前缀也能解析', () => {
    expect(parseShareHash('share/abc')).toEqual({ id: 'abc' });
  });

  it('F-31 非分享 hash 返回 null', () => {
    expect(parseShareHash('')).toBeNull();
    expect(parseShareHash('#')).toBeNull();
    expect(parseShareHash('#settings')).toBeNull();
  });

  it('F-32 结构不完整时返回 null（不做模糊匹配）', () => {
    expect(parseShareHash('#share/')).toBeNull();
    expect(parseShareHash('#share/p/')).toBeNull();
    expect(parseShareHash('#share/a/b')).toBeNull();
  });

  it('F-33 生成 URL 与解析往返一致', () => {
    const idUrl = shareUrlForId('xyz');
    expect(idUrl).toContain('#share/xyz');
    expect(parseShareHash(idUrl.slice(idUrl.indexOf('#')))).toEqual({ id: 'xyz' });

    const pUrl = shareUrlForPayload('PAYLOAD');
    expect(pUrl).toContain('#share/p/PAYLOAD');
    expect(parseShareHash(pUrl.slice(pUrl.indexOf('#')))).toEqual({ payload: 'PAYLOAD' });
  });
});

describe('resolveTheme / applyTheme', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
  });

  it('F-34 显式 light/dark 直接返回', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('F-35 system 跟随 prefers-color-scheme', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) =>
        ({
          matches: q.includes('dark'),
          media: q,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList
    );
    expect(resolveTheme('system')).toBe('dark');
  });

  it('F-36 applyTheme 写入主题变量并切换 dark 类', () => {
    applyTheme('dark', {});
    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.style.getPropertyValue('--md-color-bg')).toBe('#1a1815');

    applyTheme('light', {});
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.style.getPropertyValue('--md-color-bg')).toBe('#ffffff');
  });

  it('F-37 自定义变量生效，非法键/注入值被过滤', () => {
    applyTheme('light', {
      '--md-font-size': '18px',
      '--md-evil': 'red', // 未在允许清单内
      '--md-color-bg': 'red; background-image:url(javascript:alert(1))', // 注入
    });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--md-font-size')).toBe('18px');
    expect(root.style.getPropertyValue('--md-evil')).toBe('');
    // 被拒绝的变量应保持主题默认值
    expect(root.style.getPropertyValue('--md-color-bg')).toBe('#ffffff');
  });
});
