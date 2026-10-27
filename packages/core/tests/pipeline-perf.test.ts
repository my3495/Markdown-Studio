import { describe, it, expect } from 'vitest';
import { render } from '../src/parser/pipeline';
import { toHtml } from 'hast-util-to-html';
import {
  clearHighlightCache,
  resolveShikiTheme,
  warmupHighlight,
} from '../src/parser/plugins/rehype-shiki';

async function toHtmlString(md: string, opts = {}) {
  const { hast } = await render(md, opts);
  return toHtml(hast, { allowDangerousHtml: true });
}

describe('渲染管线：processor 复用下的上下文隔离', () => {
  it('顺序渲染两篇文档，TOC / 警告不串味', async () => {
    const a = await render('# 甲\n\n中文 test 用例\n\n...省略号');
    const b = await render('# 乙\n\n另一篇 no cjk spacing here');

    expect(a.toc.map((t) => t.text)).toEqual(['甲']);
    expect(b.toc.map((t) => t.text)).toEqual(['乙']);
    // 两篇互不包含对方的标题
    expect(b.toc.some((t) => t.text === '甲')).toBe(false);
  });

  it('并发渲染共享同一 processor，各自拿到自己的 TOC', async () => {
    const [a, b, c] = await Promise.all([
      render('# 一'),
      render('# 二\n\n## 二之一'),
      render('# 三'),
    ]);
    expect(a.toc.map((t) => t.text)).toEqual(['一']);
    expect(b.toc.map((t) => t.text)).toEqual(['二', '二之一']);
    expect(c.toc.map((t) => t.text)).toEqual(['三']);
  });

  it('不同选项各自组装 processor，互不干扰', async () => {
    const plain = await render('# A');
    const numbered = await render('# A', { autoNumber: 'arabic' });
    const htmlPlain = toHtml(plain.hast);
    const htmlNumbered = toHtml(numbered.hast);
    expect(htmlNumbered).toContain('1. ');
    expect(htmlPlain).not.toContain('1. ');
  });
});

describe('data-line 锚点收敛到块级元素', () => {
  it('内联元素不再注入 data-line', async () => {
    const html = await toHtmlString('段落 **粗体** 与 [链接](https://example.com)');
    expect(html).toMatch(/<p data-line="1"/);
    expect(html).not.toMatch(/<strong[^>]*data-line/);
    expect(html).not.toMatch(/<a[^>]*data-line/);
  });

  it('代码块（shiki 替换后的 pre）仍带 data-line，不留滚动同步盲区', async () => {
    const html = await toHtmlString('前言\n\n```ts\nconst a = 1;\n```\n');
    expect(html).toContain('shiki');
    expect(html).toMatch(/<pre[^>]*data-line="3"/);
  });
});

describe('Shiki 高亮缓存', () => {
  it('相同代码块重复渲染结果一致（缓存副本不污染）', async () => {
    const md = '```ts\nconst a = 1;\n```\n\n中间段\n\n```ts\nconst a = 1;\n```\n';
    const first = await toHtmlString(md);
    const second = await toHtmlString(md);
    expect(second).toBe(first);
    // 两处围栏都被高亮（缓存取出的是副本，不是同一个对象被插两次）
    expect(first.match(/class="shiki/g)?.length).toBe(2);
  });

  it('清空缓存后仍能正常高亮', async () => {
    const md = '```ts\nconst b = 2;\n```';
    const before = await toHtmlString(md);
    clearHighlightCache();
    const after = await toHtmlString(md);
    expect(after).toBe(before);
    expect(after).toContain('shiki');
  });

  it('主题解析：light/dark 与已注册主题名', () => {
    expect(resolveShikiTheme('dark')).toBe('github-dark');
    expect(resolveShikiTheme('light')).toBe('github-light');
    expect(resolveShikiTheme('github-dark')).toBe('github-dark');
    expect(resolveShikiTheme(undefined)).toBe('github-light');
    expect(resolveShikiTheme('不存在的主题')).toBe('github-light');
  });

  it('预热不抛错，且预热后渲染仍正确', async () => {
    await expect(warmupHighlight('light')).resolves.toBeUndefined();
    const html = await toHtmlString('```ts\nconst c = 3;\n```');
    expect(html).toContain('class="shiki github-light"');
  }, 60000);
});
