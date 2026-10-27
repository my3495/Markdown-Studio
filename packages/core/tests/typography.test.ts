import { describe, it, expect } from 'vitest';
import { addCjkSpacing } from '../src/typography/pangu';
import {
  lintPunctuation,
  lintEllipsis,
  lintQuotes,
} from '../src/typography/punctuation';

describe('中文排版 · 间距 (pangu)', () => {
  it('中英文之间补空格', () => {
    expect(addCjkSpacing('使用React框架')).toBe('使用 React 框架');
  });
  it('中数之间补空格', () => {
    expect(addCjkSpacing('共10个')).toBe('共 10 个');
  });
  it('已有空格不重复添加', () => {
    expect(addCjkSpacing('使用 React 框架')).toBe('使用 React 框架');
  });
  it('拉丁后接中文补空格', () => {
    expect(addCjkSpacing('React是框架')).toBe('React 是框架');
  });
});

describe('中文排版 · 标点 lint', () => {
  it('半角逗号提示全角', () => {
    const r = lintPunctuation('你好, 世界');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].suggestion).toBe('好，');
  });
  it('省略号建议全角', () => {
    const r = lintEllipsis('等等...');
    expect(r[0].suggestion).toBe('……');
  });
  it('引号建议全角', () => {
    const r = lintQuotes('"中文"');
    expect(r[0].suggestion).toBe('“中文”');
  });
});
