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
