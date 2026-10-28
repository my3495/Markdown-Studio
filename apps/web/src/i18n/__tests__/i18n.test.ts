import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES, t, type Locale } from '../index';

/**
 * i18n 完整性守卫。
 *
 * 字典没有导出，但 `t()` 在缺 key 时会**原样返回 key**——这正好可以反查漏翻译：
 * 扫描源码里所有 `t(<任意变量>, '静态key')` 的调用，逐语言断言返回值不等于 key 本身。
 * 这样新增界面文案时若只补了中文，测试立刻失败。
 */

/**
 * 不能用 `new URL('../../', import.meta.url)`：jsdom 环境下 import.meta.url 不是 file: 协议，
 * fileURLToPath 会直接抛 ERR_INVALID_URL_SCHEME。改为从工作目录定位。
 */
const SRC = [resolve(process.cwd(), 'src'), resolve(process.cwd(), 'apps/web/src')].find((p) =>
  existsSync(join(p, 'i18n/index.ts'))
) as string;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const KEY_RE = /\bt\(\s*[A-Za-z_$][\w$]*\s*,\s*'([^']+)'/g;

function collectKeys(): string[] {
  const keys = new Set<string>();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(KEY_RE)) keys.add(m[1]!);
  }
  return [...keys].sort();
}

const KEYS = collectKeys();

describe('i18n 字典完整性', () => {
  it('F-24 从源码中收集到足够多的静态 key（扫描逻辑本身有效）', () => {
    expect(KEYS.length).toBeGreaterThan(100);
    expect(KEYS).toContain('exportHtml');
  });

  it('F-25 三种语言的 key 集合一致，且非空', () => {
    const missing: string[] = [];
    for (const { id } of LOCALES as { id: Locale }[]) {
      for (const key of KEYS) {
        const value = t(id, key);
        if (value === key || value.trim() === '') missing.push(`${id}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('F-26 未知 key 原样返回（UI 不会渲染出 undefined）', () => {
    expect(t('zh-CN', 'no-such-key-xyz')).toBe('no-such-key-xyz');
  });

  it('F-27 同一 key 在不同语言下取值互相独立（不是同一份字典）', () => {
    expect(t('zh-CN', 'exportHtml')).not.toBe(t('en', 'exportHtml'));
    expect(t('en', 'exportHtml')).not.toBe(t('ja', 'exportHtml'));
  });
});
