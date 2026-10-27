/**
 * 回归：代码块（shiki 输出 style 属性）必须能渲染。
 *
 * 历史缺陷：hast-util-to-jsx-runtime 依赖的 style-to-js 在本环境默认导入拿到的是
 * 命名空间对象而非函数，导致 `Cannot parse 'style' attribute` —— 渲染期抛错会把
 * 整个应用卸载成白屏。MarkdownView 现在自己把 style 字符串归一化为对象。
 */

import { describe, it, expect } from 'vitest';
import { render as renderDom } from '@testing-library/react';
import { MarkdownView } from '@md-studio/ui';
import { render as renderMarkdown } from '@md-studio/core';

describe('MarkdownView style 归一化', () => {
  it('M-01 代码块：shiki 的 style 属性不再导致渲染失败', async () => {
    const r = await renderMarkdown('```js\nconst a = 1;\n```\n', { highlightTheme: 'light' });
    const { container } = renderDom(<MarkdownView hast={r.hast} />);
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.className).toContain('shiki');
    expect(container.textContent).toContain('const');
    // style 字符串必须真的转成 React 样式对象并落到 DOM 上（而不是被丢弃）
    expect(pre?.getAttribute('style') ?? '').toContain('background-color');
    const colored = container.querySelector('pre span[style]');
    expect(colored?.getAttribute('style') ?? '').toContain('color');
  });

  it('M-02 代码块：多语言/多块连续渲染', async () => {
    const md = ['```ts', 'const n: number = 1;', '```', '', '```bash', 'echo hi', '```', ''].join(
      '\n'
    );
    const r = await renderMarkdown(md, { highlightTheme: 'dark' });
    const { container } = renderDom(<MarkdownView hast={r.hast} />);
    expect(container.querySelectorAll('pre').length).toBe(2);
  });

  it('M-03 表格与标题不受影响', async () => {
    const md = '## 标题\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
    const r = await renderMarkdown(md, {});
    const { container } = renderDom(<MarkdownView hast={r.hast} />);
    expect(container.querySelector('h2')?.textContent).toBe('标题');
    expect(container.querySelectorAll('tbody tr').length).toBe(1);
  });
});
