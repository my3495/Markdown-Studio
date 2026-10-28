import { describe, it, expect } from 'vitest';
import { exportHtml } from '../src/export/html';
import { getThemeVariables } from '../src/renderer/styles';

/**
 * 导出 HTML 的细粒度验收（US-08：单文件、内联样式、离线可用）。
 *
 * 断言按「骨架 / 头部 / 样式 / 页脚 / 正文 / 安全 / 稳定性」分组，
 * 任何一组挂掉都能直接定位是哪一层回归，而不是笼统的「导出坏了」。
 *
 * 大部分用例传 `highlight: false`：Shiki 成本高且已有渲染层用例覆盖，
 * 与「导出封装」无关；只有一条专门验证「高亮后仍自带内联样式」。
 */

/** 渲染选项：关掉 Shiki，只测导出封装 */
const NO_CODE_HL = { highlight: false };

/** 取 <style> 块内容，便于单独断言 CSS 层 */
function styles(html: string): string[] {
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
}

/**
 * 取正文容器内部。
 * 注意必须锚定到 `<body>` 之后的 article：导出 CSS 的注释里也写着
 * `<article class="md-preview">`，单独按标签匹配会把整段 CSS 当正文。
 */
function body(html: string): string {
  const m = /<body>\s*<article class="md-preview">([\s\S]*)<\/article>/.exec(html);
  return m ? m[1]! : '';
}

describe('导出 HTML · 文档骨架', () => {
  it('E-H01 单文件骨架完整（doctype / lang / charset / viewport / article）', async () => {
    const html = await exportHtml('# 标题', NO_CODE_HL);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('<article class="md-preview">');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('E-H02 空文档与纯空白也能导出（不抛错、骨架仍在）', async () => {
    for (const md of ['', '   ', '\n\n\n']) {
      const html = await exportHtml(md, NO_CODE_HL);
      expect(html).toContain('<article class="md-preview">');
      expect(html).toContain('</article>');
    }
  });

  it('E-H03 单文件自足：不引用任何外部样式表/脚本', async () => {
    const html = await exportHtml('# 标题\n\n正文', NO_CODE_HL);
    expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(styles(html).length).toBe(1);
  });
});

describe('导出 HTML · 标题与页脚', () => {
  it('E-H04 标题默认值与 HTML 转义（不会被当作标签解析）', async () => {
    const def = await exportHtml('x', NO_CODE_HL);
    expect(def).toContain('<title>Markdown Studio</title>');

    const html = await exportHtml('x', NO_CODE_HL, { title: `a<b>&"'</b>` });
    const title = /<title>([\s\S]*?)<\/title>/.exec(html)![1]!;
    expect(title).toBe('a&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  });

  it('E-H05 页脚默认开启且文案固定', async () => {
    const html = await exportHtml('x', NO_CODE_HL);
    expect(html).toContain('<footer class="md-footer">');
    expect(html).toContain('由 Markdown Studio 生成');
  });

  it('E-H06 footer.enabled=false 时完全不输出页脚', async () => {
    const html = await exportHtml('x', NO_CODE_HL, { footer: { enabled: false } });
    expect(html).not.toContain('<footer');
  });

  it('E-H07 页脚自定义文案与链接（文案转义、链接编码）', async () => {
    const html = await exportHtml('x', NO_CODE_HL, {
      footer: { enabled: true, text: '<b>甲</b>', link: 'https://example.com/a b' },
    });
    expect(html).toContain('&lt;b&gt;甲&lt;/b&gt;');
    expect(html).not.toContain('<b>甲</b>');
    expect(html).toContain('href="https://example.com/a%20b"');
  });
});

describe('导出 HTML · 主题与样式', () => {
  it('E-H08 light/dark 使用各自主题变量', async () => {
    const light = await exportHtml('x', NO_CODE_HL, { mode: 'light' });
    const dark = await exportHtml('x', NO_CODE_HL, { mode: 'dark' });
    expect(light).toContain(getThemeVariables('light')['--md-color-bg']!);
    expect(dark).toContain(getThemeVariables('dark')['--md-color-bg']!);
    expect(light).not.toContain(getThemeVariables('dark')['--md-color-bg']!);
  });

  it('E-H09 customVars 覆盖单个变量、其余变量保留', async () => {
    const html = await exportHtml('x', NO_CODE_HL, {
      customVars: { '--md-color-accent': '#ff0000' },
    });
    expect(styles(html)[0]).toContain('--md-color-accent: #ff0000;');
    expect(styles(html)[0]).toContain('--md-font-family');
  });

  it('E-H10 baseCss 完全接管样式（不再注入默认主题）', async () => {
    const html = await exportHtml('x', NO_CODE_HL, { baseCss: '.only{color:red}' });
    expect(styles(html)).toEqual(['.only{color:red}']);
  });

  it('E-H11 katexCss 单独成块；未提供时不产生空 style', async () => {
    const withKatex = await exportHtml('x', NO_CODE_HL, { katexCss: '.katex{}' });
    expect(styles(withKatex).length).toBe(2);
    expect(styles(withKatex)[1]).toBe('.katex{}');

    const without = await exportHtml('x', NO_CODE_HL);
    expect(styles(without).length).toBe(1);
  });

  it('E-H12 代码高亮开启时样式内联进 <pre>（离线可读）', async () => {
    const html = await exportHtml('```js\nconst a = 1;\n```', { highlight: true });
    expect(body(html)).toMatch(/<pre[^>]*class="shiki/);
    expect(body(html)).toContain('style="color:');
  });
});

describe('导出 HTML · 正文保真', () => {
  const DOC = [
    '# 一级标题',
    '',
    '段落里有 **粗体**、`行内代码`、<kbd>Ctrl</kbd> 与 ==等号高亮==。',
    '',
    '- 列表项',
    '',
    '| A | B |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '> 引用块',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
    '![图](pic.png =320x200)',
    '',
    '行内公式 $E = mc^2$',
  ].join('\n');

  it('E-H13 常用块级/行内语法齐备', async () => {
    const b = body(await exportHtml(DOC, NO_CODE_HL));
    // 块级元素都带 data-line 属性，标签断言要容忍属性
    expect(b).toMatch(/<h1[\s>]/);
    expect(b).toContain('<strong>粗体</strong>');
    expect(b).toContain('<code>行内代码</code>');
    expect(b).toContain('<kbd>Ctrl</kbd>');
    expect(b).toMatch(/<ul[\s>]/);
    expect(b).toMatch(/<table[\s>]/);
    expect(b).toMatch(/<blockquote[\s>]/);
    expect(b).toMatch(/<pre[\s>]/);
    expect(b).toContain('width="320"');
    expect(b).toContain('height="200"');
  });

  it('E-H14 ==高亮== 导出为 <mark>（与预览同源）', async () => {
    const html = await exportHtml('前后 ==重点== 结尾', NO_CODE_HL);
    expect(body(html)).toContain('<mark>重点</mark>');
  });

  it('E-H15 数学公式导出为 KaTeX 结构（不依赖外部脚本）', async () => {
    const b = body(await exportHtml('公式 $E=mc^2$', NO_CODE_HL));
    expect(b).toContain('class="katex"');
    expect(b).not.toMatch(/<script[^>]+katex/i);
  });

  it('E-H16 frontmatter 不进入正文', async () => {
    const b = body(await exportHtml('---\ntitle: 元数据\ntags: [a]\n---\n\n正文', NO_CODE_HL));
    expect(b).not.toContain('tags: [a]');
    expect(b).toContain('正文');
  });

  it('E-H17 外链在新标签打开且带 noopener', async () => {
    const b = body(await exportHtml('[外站](https://example.com)', NO_CODE_HL));
    expect(b).toMatch(/target="_blank"/);
    expect(b).toMatch(/rel="noopener noreferrer"/);
  });

  it('E-H18 导出保留 data-line 锚点（与预览共用渲染管线）', async () => {
    const b = body(await exportHtml('# A\n\n段落', NO_CODE_HL));
    expect(b).toContain('data-line=');
  });
});

describe('导出 HTML · 安全', () => {
  it('E-H19 脚本、事件属性、javascript: 链接一律剥离', async () => {
    const b = body(
      await exportHtml(
        '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[链](javascript:alert(1))\n\n<mark onclick="alert(1)">x</mark>',
        NO_CODE_HL
      )
    );
    expect(b).not.toContain('<script');
    expect(b).not.toContain('onerror');
    expect(b).not.toContain('onclick');
    expect(b).not.toContain('javascript:');
    expect(b).toContain('<mark>x</mark>');
  });

  it('E-H20 正文里的 </style> 不会截断头部样式块', async () => {
    const html = await exportHtml('正文 </style><b>x</b> 结尾', NO_CODE_HL);
    // 用户写下的闭合标签被净化掉，整篇只剩样式块自身那一个 </style>
    expect(styles(html).length).toBe(1);
    expect(html.match(/<\/style>/g)!.length).toBe(1);
    expect(body(html)).not.toContain('</style>');
    expect(body(html)).toContain('<b>x</b>');
  });
});

describe('导出 HTML · 稳定性', () => {
  it('E-H21 同一输入重复导出结果完全一致（processor 缓存无副作用）', async () => {
    const md = '# 标题\n\n段落 ==高亮== 与 `code`';
    const a = await exportHtml(md, NO_CODE_HL);
    // 中间插一次别的文档，确保缓存键不会串味
    await exportHtml('另一篇 $x^2$ 文档', NO_CODE_HL);
    const b = await exportHtml(md, NO_CODE_HL);
    expect(b).toBe(a);
  });

  it('E-H22 导出不受上一次 dark 模式影响', async () => {
    const dark = await exportHtml('x', NO_CODE_HL, { mode: 'dark' });
    const light = await exportHtml('x', NO_CODE_HL, { mode: 'light' });
    expect(dark).not.toBe(light);
    expect(light).toContain('--md-color-bg: #ffffff;');
  });
});
