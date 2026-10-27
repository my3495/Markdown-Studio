import { describe, it, expect } from 'vitest';
import { render } from '../src/parser/pipeline';
import { toHtml } from 'hast-util-to-html';

async function toHtmlString(md: string, opts = {}) {
  const { hast } = await render(md, opts);
  return toHtml(hast, { allowDangerousHtml: true });
}

const DOC = `# 主标题

[TOC]

## 一级小节 A

### 更深层 B

## 二级小节 C
`;

describe('正文内目录占位符 [TOC]', () => {
  it('未开启时，[TOC] 保持为普通文本', async () => {
    const html = await toHtmlString(DOC);
    expect(html).toContain('<p data-line="3">[TOC]</p>');
    expect(html).not.toContain('md-toc');
  });

  it('开启后，占位符被替换为目录容器', async () => {
    const html = await toHtmlString(DOC, { tocPlaceholder: { title: '目录' } });
    expect(html).toContain('class="md-toc"');
    expect(html).toContain('目录');
    // 原占位符文本不应再出现
    expect(html).not.toContain('>[TOC]<');
  });

  it('目录项指向带 user-content- 前缀的真实标题 id', async () => {
    const html = await toHtmlString(DOC, { tocPlaceholder: { title: '目录' } });
    // sanitize 的 clobberPrefix 会给标题 id 加前缀，目录必须指向同一个值
    expect(html).toContain('href="#user-content-一级小节-a"');
    expect(html).toContain('id="user-content-一级小节-a"');
  });

  it('默认排除首个 h1（文档主标题）', async () => {
    const html = await toHtmlString(DOC, { tocPlaceholder: { title: '目录' } });
    // 主标题是 h1，不该出现在目录里
    expect(html).not.toContain('href="#user-content-主标题"');
    expect(html).toContain('href="#user-content-一级小节-a"');
  });

  it('includeH1 时保留首个 h1', async () => {
    const html = await toHtmlString(DOC, {
      tocPlaceholder: { title: '目录', includeH1: true },
    });
    expect(html).toContain('href="#user-content-主标题"');
  });

  it('maxDepth 限制目录层级', async () => {
    const html = await toHtmlString(DOC, { tocPlaceholder: { maxDepth: 2 } });
    expect(html).toContain('href="#user-content-一级小节-a"');
    // h3 超出 maxDepth
    expect(html).not.toContain('href="#user-content-更深层-b"');
  });

  it('层级正确嵌套（h2 → h3 变成子级 ul）', async () => {
    const html = await toHtmlString(DOC, { tocPlaceholder: { title: '目录' } });
    // 「更深层 B」必须落在「一级小节 A」之后的嵌套 ul 里
    const aIdx = html.indexOf('href="#user-content-一级小节-a"');
    const bIdx = html.indexOf('href="#user-content-更深层-b"');
    const cIdx = html.indexOf('href="#user-content-二级小节-c"');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
    expect(cIdx).toBeGreaterThan(bIdx);
    // 更深层 B 与二级小节 C 不在同一层：两者之间至少有一个 </ul>
    const between = html.slice(bIdx, cIdx);
    expect(between).toContain('</ul>');
  });

  it('标题跳级（h2 → h4）时按连续层级渲染，不丢条目', async () => {
    const md = '# 标题\n\n[TOC]\n\n## A\n\n#### D\n';
    const html = await toHtmlString(md, { tocPlaceholder: { title: '目录' } });
    expect(html).toContain('href="#user-content-a"');
    expect(html).toContain('href="#user-content-d"');
  });

  it('目录项文本与标题一致（不含自动编号前缀）', async () => {
    const html = await toHtmlString(DOC, { tocPlaceholder: { title: '目录' } });
    expect(html).toContain('>一级小节 A</a>');
  });

  it('开启标题自动编号时，目录项显示同样的编号', async () => {
    const html = await toHtmlString(DOC, {
      autoNumber: 'arabic',
      tocPlaceholder: { title: '目录' },
    });
    // 标题渲染为「1.1. 一级小节 A」，目录项也应带编号
    expect(html).toContain('1.1. 一级小节 A');
    // 目录里那一份也要带编号
    const tocStart = html.indexOf('md-toc');
    const tocEnd = html.indexOf('</div>', tocStart);
    const tocHtml = html.slice(tocStart, tocEnd);
    expect(tocHtml).toContain('1.1. 一级小节 A');
  });

  it('段落里含其它内容时不算占位符', async () => {
    const html = await toHtmlString('这是 [TOC] 的说明文字', {
      tocPlaceholder: { title: '目录' },
    });
    expect(html).not.toContain('md-toc');
    expect(html).toContain('这是 [TOC] 的说明文字');
  });

  it('代码块里的 [TOC] 不被替换', async () => {
    const html = await toHtmlString('```\n[TOC]\n```', {
      tocPlaceholder: { title: '目录' },
    });
    expect(html).not.toContain('md-toc');
  });

  it('列表项里的 [TOC] 不被替换', async () => {
    const html = await toHtmlString('- [TOC]', { tocPlaceholder: { title: '目录' } });
    expect(html).not.toContain('md-toc');
  });

  it('链接引用形式的 [TOC] 不被替换', async () => {
    const html = await toHtmlString('[TOC]\n\n[TOC]: https://example.com', {
      tocPlaceholder: { title: '目录' },
    });
    expect(html).not.toContain('md-toc');
    expect(html).toContain('example.com');
  });

  it('目录为空（无标题）时渲染空容器，不报错', async () => {
    const html = await toHtmlString('[TOC]', { tocPlaceholder: { title: '目录' } });
    expect(html).toContain('md-toc');
  });

  it('占位符出现在文末时，目录仍列出全文标题', async () => {
    const html = await toHtmlString('## A\n\n正文\n\n[TOC]', {
      tocPlaceholder: { title: '目录' },
    });
    expect(html).toContain('href="#user-content-a"');
  });

  it('保留 data-line（滚动同步锚点不失效）', async () => {
    const html = await toHtmlString(DOC, { tocPlaceholder: { title: '目录' } });
    expect(html).toMatch(/<div class="md-toc"[^>]*data-line="3"/);
  });
});

describe('标题 id 稳定性', () => {
  it('同一文档重复渲染，id 不漂移', async () => {
    const a = await render('# 标题\n\n## 小节');
    const b = await render('# 标题\n\n## 小节');
    const c = await render('# 标题\n\n## 小节');
    expect(a.toc.map((t) => t.id)).toEqual(['标题', '小节']);
    expect(b.toc.map((t) => t.id)).toEqual(['标题', '小节']);
    expect(c.toc.map((t) => t.id)).toEqual(['标题', '小节']);
  });

  it('重复标题的 id 在同一次渲染内正确去重', async () => {
    const r = await render('# 标题\n\n# 标题');
    expect(r.toc.map((t) => t.id)).toEqual(['标题', '标题-1']);
  });

  it('不同文档各自独立计数', async () => {
    await render('# 甲');
    const b = await render('# 乙');
    expect(b.toc.map((t) => t.id)).toEqual(['乙']);
  });
});
