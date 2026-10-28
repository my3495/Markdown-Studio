import { describe, it, expect } from 'vitest';
import { render } from '../src/parser/pipeline';
import { toHtml } from 'hast-util-to-html';

async function toHtmlString(md: string, opts = {}) {
  const { hast } = await render(md, opts);
  return toHtml(hast, { allowDangerousHtml: true });
}

describe('渲染管线', () => {
  it('基本渲染并提取 TOC', async () => {
    const md = '# 标题\n\n正文 **粗体**';
    const r = await render(md);
    expect(r.toc.length).toBe(1);
    expect(r.toc[0].text).toBe('标题');
    expect(r.toc[0].id).toBeTruthy();
    expect(r.words).toBeGreaterThan(0);
  });

  it('data-line 注入（滚动同步）', async () => {
    const html = await toHtmlString('# A\n\npara1\n\npara2');
    expect(html).toContain('data-line');
  });

  it('图像大小解析（Typora 语法）', async () => {
    const html = await toHtmlString('![alt](img.png =300x200)');
    expect(html).toContain('width="300"');
    expect(html).toContain('height="200"');
  });

  it('标题自动编号（arabic）', async () => {
    const html = await toHtmlString('# A\n\n## B\n\n## C', {
      autoNumber: 'arabic',
    });
    expect(html).toContain('1. ');
    expect(html).toContain('1.1');
  });

  it('XSS 净化（US-09）', async () => {
    const md =
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[link](javascript:alert(1))';
    const html = await toHtmlString(md);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
  });

  it('内联语义标签放行（mark/kbd/sup/sub），危险内容仍剥离', async () => {
    const html = await toHtmlString(
      '正文 <mark>高亮</mark> <kbd>Ctrl</kbd> <sup>1</sup> <sub>2</sub>'
    );
    expect(html).toContain('<mark>高亮</mark>');
    expect(html).toContain('<kbd>Ctrl</kbd>');
    expect(html).toContain('<sup>1</sup>');
    expect(html).toContain('<sub>2</sub>');
    // 放行 mark 不能顺带放宽事件属性
    const evil = await toHtmlString('<mark onclick="alert(1)">x</mark>');
    expect(evil).toContain('<mark>x</mark>');
    expect(evil).not.toContain('onclick');
  });

  it('含/不含公式与双链交替渲染时 processor 缓存不串味', async () => {
    // 无 `$`/`[[` 的文档会复用少注册两个插件的 processor，
    // 这里正反两向交替渲染，确认缓存键把特征算进去、不会拿错 processor。
    const withMath = await toHtmlString('公式 $x^2$');
    const plain = await toHtmlString('普通文本，没有公式');
    const withLink = await toHtmlString('链接 [[笔记]]');
    const plain2 = await toHtmlString('另一段普通文本');

    expect(withMath).toContain('katex');
    expect(plain).not.toContain('katex');
    expect(withLink).toContain('data-wikilink');
    expect(plain2).not.toContain('data-wikilink');

    const plain3 = await toHtmlString('再来一段普通文本');
    const withMath2 = await toHtmlString('公式 $y^2$');
    expect(plain3).not.toContain('katex');
    expect(withMath2).toContain('katex');
  });

  it('含/不含 GFM 语法交替渲染时 processor 缓存不串味', async () => {
    // 纯叙述文本会走「不注册 remark-gfm」的 processor，正反交替验证缓存键隔离
    const table = await toHtmlString('| a | b |\n| - | - |\n| 1 | 2 |');
    const plain = await toHtmlString('纯叙述段落，没有任何 GFM 语法');
    const strike = await toHtmlString('删除线 ~~x~~');
    const task = await toHtmlString('- [x] 已完成');
    const plain2 = await toHtmlString('又一段纯叙述');

    // 表格元素带 data-line 属性，只断言标签开头
    expect(table).toContain('<table');
    expect(strike).toContain('<del>');
    expect(task).toContain('checkbox');
    expect(plain).not.toContain('<table');
    expect(plain2).not.toContain('checkbox');

    // 交替后再来一次表格，确认切回含 GFM 的 processor 仍正确
    const table2 = await toHtmlString('| c | d |\n| - | - |\n| 3 | 4 |');
    expect(table2).toContain('<table');
  });

  it('代码块里的 $ 与 [[ 只触发保守分支，不会误渲染成公式/双链', async () => {
    const html = await toHtmlString('```js\nconst p = "$5"; const l = "[[x]]";\n```');
    expect(html).toContain('$5');
    expect(html).toContain('[[x]]');
    expect(html).not.toContain('katex');
    expect(html).not.toContain('data-wikilink');
  });

  it('分页符渲染为 div.pagebreak', async () => {
    const html = await toHtmlString('前\n\n<!-- pagebreak -->\n\n后');
    expect(html).toContain('class="pagebreak"');
  });

  it('数学公式（KaTeX）', async () => {
    const html = await toHtmlString('行内 $E=mc^2$ 公式');
    expect(html).toContain('katex');
  });

  it('Shiki 高亮（.use 必须以插件+options 注册，回归 F14）', async () => {
    const html = await toHtmlString('```ts\nconst answer = 42;\n```', { highlight: true, highlightTheme: 'light' });
    expect(html).toContain('class="shiki github-light"');
    expect(html).toContain('<span class="line">');
    const html2 = await toHtmlString('```ts\nconst a = 1;\n```', { highlight: true, highlightTheme: 'dark' });
    expect(html2).toContain('class="shiki github-dark"');
  });
});
