/**
 * 导出全格式验收测试（core 层）：HTML / LaTeX / Pandoc 命令。
 *
 * 与既有细粒度测试的分工：
 * - export-html.test.ts：单点行为（骨架、页脚、主题、安全过滤…）
 * - export-pandoc.test.ts：路径推导与命令拼接
 * - 本文件：**验收维度** —— 结构合规、内容无损、边界（空 / 超大批量 / 并发）、
 *   以及「目标软件能否读」的可判定证据（标签配对、环境配对、writer 合法性）。
 *
 * 标 `it.fails` 的用例是已确认缺陷：期望正确行为，实际不满足；修好后该用例会变红，
 * 提示删除标记（见测试报告 docs/export-test-report.md）。
 */
import { describe, expect, it } from 'vitest';
import { exportHtml } from '../src/export/html';
import {
  buildPandocArgs,
  buildPandocCommand,
  markdownToLatexLite,
  suggestPandocOutput,
  type PandocFormat,
} from '../src/export/pandoc';

const FAST = { highlight: false } as const;

/**
 * 取正文容器。
 *
 * 必须从 `</head>` 之后开始找：导出 CSS 的注释里引用了 `<body>` /
 * `<article class="md-preview">` 作为说明文字，按首个匹配会截进样式块。
 */
const bodyOf = (html: string) => {
  const headEnd = html.indexOf('</head>');
  return headEnd < 0 ? html : html.slice(headEnd);
};

const articleOf = (html: string) => {
  const body = bodyOf(html);
  const start = body.indexOf('<article class="md-preview">');
  const end = body.indexOf('</article>', start);
  return start < 0 || end < 0 ? '' : body.slice(start, end);
};

/** 段落计数：`<p` 会误匹配 `<pre`，必须带分隔符 */
const paragraphCount = (html: string) => (html.match(/<p[\s>]/g) ?? []).length;

/** hast 序列化会输出数字实体（&#x3C;），这里统一还原成字符用于逐字比对 */
const unescapeHtml = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** 单文件 HTML 体积上限：只做「不失控」约束，避免机器差异误报 */
const MAX_HTML_BYTES = 20 * 1024 * 1024;

/** 统计 LaTeX 环境开闭，用于判断「目标软件能否编译」 */
const latexEnvs = (tex: string) => ({
  begins: [...tex.matchAll(/\\begin\{([\w*]+)\}/g)].map((m) => m[1]!),
  ends: [...tex.matchAll(/\\end\{([\w*]+)\}/g)].map((m) => m[1]!),
});

describe('HTML 导出：结构合规与可打开性', () => {
  it('A-H01 文档具备完整可解析骨架（doctype/html/head/body 各一次且顺序正确）', async () => {
    const html = await exportHtml('# 标题\n\n正文', FAST);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(count(html, '<html')).toBe(1);
    expect(count(html, '<head>')).toBe(1);
    expect(count(html, '</head>')).toBe(1);
    // body 容器只在 </head> 之后统计：样式注释里也写了 `<body>`
    expect(count(bodyOf(html), '<body>')).toBe(1);
    expect(count(bodyOf(html), '</body>')).toBe(1);

    const headEnd = html.indexOf('</head>');
    // body 标签从 </head> 之后开始找：样式注释里也写了 `<body>`
    const order = [
      html.indexOf('<!doctype html>'),
      html.indexOf('<html'),
      html.indexOf('<head>'),
      headEnd,
      html.indexOf('<body>', headEnd),
      html.indexOf('</body>', headEnd),
      html.indexOf('</html>', headEnd),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
    // 单文件自足：不引用外部资源（离线可打开）
    expect(html).not.toMatch(/<(script|link)\b/i);
    expect(articleOf(html)).not.toBe('');
  });

  it('A-H02 空数据：空串 / 纯空白 / 仅 frontmatter 都能产出合法文档', async () => {
    const cases = ['', '   \n\n\t\n', '---\ntitle: 只有元数据\n---\n'];
    for (const md of cases) {
      const html = await exportHtml(md, FAST);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html.trimEnd().endsWith('</html>')).toBe(true);
      expect(count(bodyOf(html), '<article class="md-preview">')).toBe(1);
      // 空正文不应留下未闭合容器或渲染占位
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('[object Object]');
      expect(html).toContain('<footer class="md-footer">');
    }
  });

  it('A-H03 特殊字符在代码块内逐字符无损（转义后仍可还原）', async () => {
    const payload = `<script>alert("x")</script> & 'single' ${'${'}var} {{tpl}} \\ / </style> 👨‍👩‍👧‍👦`;
    const html = await exportHtml('`' + payload + '`', FAST);
    const article = articleOf(html);

    // 代码块内容必须整体保留在一处，且不得产生真实标签
    expect(article).not.toContain('<script');
    expect(article).not.toContain('</style>');
    const code = /<code[^>]*>([\s\S]*?)<\/code>/.exec(article)?.[1] ?? '';
    expect(code).not.toBe('');
    // 反转义后必须与原文逐字符相等（emoji ZWJ 序列、$、花括号、反斜杠都不能丢）
    expect(unescapeHtml(code)).toBe(payload);
  });

  it('A-H04 多语言与 RTL 原样保留，不被转义成实体', async () => {
    const md = ['# 中文标题', 'مرحبا بالعالم — RTL', 'English text', '日本語のテキスト', '한국어 텍스트', 'é（组合字符 e + ́）'].join('\n\n');
    const html = await exportHtml(md, FAST);
    const article = articleOf(html);

    for (const text of ['中文标题', 'مرحبا بالعالم', 'English text', '日本語のテキスト', '한국어 텍스트', 'é']) {
      expect(article).toContain(text);
    }
    // 标题渲染为 h1，说明不是被当成纯文本兜底
    expect(article).toMatch(/<h1[^>]*>中文标题<\/h1>/);
  });

  it(
    'A-H05 大数据量：5000 段落完整导出（无截断、无占位、耗时可控）',
    async () => {
      const N = 5000;
      const blocks: string[] = [];
      for (let i = 1; i <= N; i += 1) {
        blocks.push(`段落 ${i}：一致性检查 PAYLOAD-${i}-END`);
      }
      const md = blocks.join('\n\n');

      const started = Date.now();
      const html = await exportHtml(md, FAST);
      const elapsed = Date.now() - started;

      const article = articleOf(html);
      expect(article).toContain('段落 1：');
      expect(article).toContain(`PAYLOAD-${N}-END`);
      expect(paragraphCount(article)).toBe(N);
      expect(article).not.toContain('PAYLOAD-0-END');
      // 体积与耗时只做「不失控」约束，避免机器差异导致误报
      expect(html.length).toBeGreaterThan(200_000);
      expect(html.length).toBeLessThan(MAX_HTML_BYTES);
      expect(elapsed).toBeLessThan(60_000);
      expect(html.trimEnd().endsWith('</html>')).toBe(true);
    },
    120_000
  );

  it(
    'A-H06 并发导出：16 个文档互不串扰、结果确定',
    async () => {
      const CONCURRENCY = 16;
      const inputs = Array.from({ length: CONCURRENCY }, (_, i) => `# 文档 ${i}\n\n唯一标记 CONC-MARK-${i}`);
      const htmls = await Promise.all(inputs.map((md) => exportHtml(md, FAST)));

      htmls.forEach((html, i) => {
        expect(html).toContain(`CONC-MARK-${i}`);
        expect(html).toContain(`文档 ${i}`);
        const others = (i + 1) % CONCURRENCY;
        expect(html).not.toContain(`CONC-MARK-${others}`);
      });
      // 同一输入重复导出仍稳定（无跨请求缓存污染）
      const again = await exportHtml(inputs[3]!, FAST);
      expect(again).toBe(htmls[3]);
    },
    120_000
  );
});

describe('LaTeX 导出：结构合规与转义正确', () => {
  it('A-L01 输出带完整文档壳，且环境开闭配对（可直接交给 latex 引擎）', () => {
    const md = [
      '# 一级',
      '## 二级',
      '正文 **粗体** 与 *斜体* 和 `代码`，链接 [官网](https://example.com)。',
      '',
      '- 项目一',
      '- 项目二',
      '',
      '```js',
      'const a = 1 < 2 && "x";',
      '```',
    ].join('\n');
    const tex = markdownToLatexLite(md);

    expect(tex.startsWith('\\documentclass')).toBe(true);
    expect(tex).toContain('\\begin{document}');
    expect(tex.trimEnd().endsWith('\\end{document}')).toBe(true);
    expect(tex).toContain('\\section{一级}');
    expect(tex).toContain('\\subsection{二级}');
    expect(tex).toContain('\\textbf{粗体}');
    expect(tex).toContain('\\emph{斜体}');
    expect(tex).toContain('\\texttt{代码}');
    expect(tex).toContain('\\href{https://example.com}{官网}');
    expect(tex).toContain('\\begin{itemize}');
    expect(tex).toContain('\\begin{lstlisting}');

    const { begins, ends } = latexEnvs(tex);
    expect(begins.length).toBe(ends.length);
    expect([...begins].sort()).toEqual([...ends].sort());
  });

  it('A-L02 特殊字符单遍转义：不出现双重转义（\\textbackslash\\{\\}）', () => {
    const dangers = 'a\\b{c}&d%e$f#g_h~i^j';
    const tex = markdownToLatexLite(dangers);

    expect(tex).toContain('\\textbackslash{}');
    expect(tex).toContain('\\{');
    expect(tex).toContain('\\}');
    expect(tex).toContain('\\&');
    expect(tex).toContain('\\%');
    expect(tex).toContain('\\$');
    expect(tex).toContain('\\#');
    expect(tex).toContain('\\_');
    expect(tex).toContain('\\textasciitilde{}');
    expect(tex).toContain('\\textasciicircum{}');
    // 双重转义会让 pdftex 直接报错
    expect(tex).not.toContain('\\textbackslash\\{\\}');
    expect(tex).not.toContain('\\\\textbackslash');
  });

  it('A-L03 空数据只产出最小合法文档，不出现空 item / 未闭合环境', () => {
    for (const md of ['', '   \n\n', '\n\n\n']) {
      const tex = markdownToLatexLite(md);
      expect(tex).toContain('\\begin{document}');
      expect(tex.trimEnd().endsWith('\\end{document}')).toBe(true);
      expect(tex).not.toContain('\\item \n');
      const { begins, ends } = latexEnvs(tex);
      expect(begins.length).toBe(ends.length);
    }
  });

  it('A-L04 未闭合代码块 / 交错列表也不会漏出未闭合环境', () => {
    const md = ['- 列表项', '```', '未闭合代码', '- 列表缩进'].join('\n');
    const tex = markdownToLatexLite(md);
    const { begins, ends } = latexEnvs(tex);
    expect(begins.length).toBe(ends.length);
    expect(tex).toContain('\\end{lstlisting}');
  });

  it('A-L05 批量 3000 行：行数线性增长且首尾完整', () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `第 ${i + 1} 行 L-LINE-${i + 1}`);
    const tex = markdownToLatexLite(lines.join('\n\n'));
    expect(tex).toContain('第 1 行');
    expect(tex).toContain('L-LINE-3000');
    expect(tex.split('\n').length).toBeGreaterThan(6000);
    expect(tex.trimEnd().endsWith('\\end{document}')).toBe(true);
  });

  it('A-L06 中文正文以 UTF-8 原文输出，并加载 ctex（否则 pdflatex 编译中文必然失败）', () => {
    const tex = markdownToLatexLite('# 中文标题\n\n中文正文，含标点。');
    expect(tex).toContain('\\section{中文标题}');
    expect(tex).toContain('中文正文，含标点。');
    expect(tex).toContain('\\usepackage[UTF8]{ctex}');
  });

  it('A-L07 链接里的 # 必须转义（裸 # 在宏参数里会直接让 TeX 报错）', () => {
    const tex = markdownToLatexLite('[锚点](https://example.com/page#section-2)');
    // hyperref 的第一参数里裸 `#` 会被当成宏参数标记 → "Illegal parameter number"；
    // 转义成 \# 才是可编译且语义正确的写法。
    expect(tex).toContain('\\href{https://example.com/page\\#section-2}{锚点}');
    expect(tex).not.toContain('page#section-2');
  });

  it('A-L08 有序列表转为 enumerate，且与无序列表切换时环境仍然配对', () => {
    const ordered = markdownToLatexLite('1. 第一步\n2. 第二步');
    expect(ordered).toContain('\\begin{enumerate}');
    expect(ordered).toContain('\\item 第一步');
    expect(ordered).toContain('\\item 第二步');
    expect(ordered).not.toContain('1. 第一步');

    // 混合：有序 → 无序 → 有序，必须每次切换都闭合上一个环境
    const mixed = markdownToLatexLite('1. 甲\n2. 乙\n\n- 丙\n- 丁\n\n1. 戊');
    const { begins, ends } = latexEnvs(mixed);
    expect(begins.length).toBe(ends.length);
    expect([...begins].sort()).toEqual([...ends].sort());
    expect(mixed.match(/\\begin\{enumerate\}/g)!.length).toBe(2);
    expect(mixed.match(/\\end\{enumerate\}/g)!.length).toBe(2);
    expect(mixed.match(/\\begin\{itemize\}/g)!.length).toBe(1);
    expect(mixed.match(/\\end\{itemize\}/g)!.length).toBe(1);
  });

  it('A-L09 小数开头的正文不被误判为有序列表', () => {
    const tex = markdownToLatexLite('2.2 版本的说明文字');
    expect(tex).not.toContain('\\begin{enumerate}');
    expect(tex).toContain('2.2 版本的说明文字');
  });
});

describe('Pandoc 导出：目标格式与命令合法性', () => {
  it('A-P01 四种格式的输出扩展名与建议路径正确', () => {
    const expectExt: Record<PandocFormat, string> = { docx: 'docx', epub: 'epub', latex: 'tex', pdf: 'pdf' };
    for (const fmt of Object.keys(expectExt) as PandocFormat[]) {
      expect(suggestPandocOutput('note.md', fmt)).toBe(`note.${expectExt[fmt]}`);
      expect(suggestPandocOutput('a.b.md', fmt)).toBe(`a.b.${expectExt[fmt]}`);
      expect(suggestPandocOutput('README', fmt)).toBe(`README.${expectExt[fmt]}`);
      expect(suggestPandocOutput('C:\\docs\\note.md', fmt)).toBe(`C:\\docs\\note.${expectExt[fmt]}`);
    }
  });

  it('A-P02 命令包含输入/输出与 writer，路径含空格时整体加引号', () => {
    const cmd = buildPandocCommand('My Note.md', 'My Note.docx', 'docx');
    expect(cmd).toBe('pandoc "My Note.md" -o "My Note.docx" -t docx');
    expect(cmd).toContain('"My Note.md"');
    expect(cmd).toContain('"My Note.docx"');
  });

  it('A-P03 extraArgs 原样追加在末尾（--toc / geometry 等）', () => {
    const args = buildPandocArgs('a.md', 'a.pdf', 'pdf', { extraArgs: ['--toc', '-V', 'geometry:margin=1in'] });
    expect(args.slice(-3)).toEqual(['--toc', '-V', 'geometry:margin=1in']);
  });

  it('A-P04 pdf 分支不带 -t（pandoc 没有 pdf writer，由 -o 扩展名推断）', () => {
    expect(buildPandocArgs('a.md', 'a.pdf', 'pdf')).toEqual(['a.md', '-o', 'a.pdf']);
    // 其余 writer 必须保留，否则 docx/epub/latex 的输出格式会退化成默认
    expect(buildPandocArgs('a.md', 'a.docx', 'docx')).toEqual(['a.md', '-o', 'a.docx', '-t', 'docx']);
    expect(buildPandocArgs('a.md', 'a.epub', 'epub')).toEqual(['a.md', '-o', 'a.epub', '-t', 'epub']);
    expect(buildPandocArgs('a.md', 'a.tex', 'latex')).toEqual(['a.md', '-o', 'a.tex', '-t', 'latex']);
    // 命令里不能再出现 `-t pdf`
    expect(buildPandocCommand('a.md', 'a.pdf', 'pdf')).toBe('pandoc a.md -o a.pdf');
  });

  it('A-P05 单引号路径在 POSIX shell 里仍被双引号包裹（不会断词）', () => {
    const cmd = buildPandocCommand("it's.md", "it's.docx", 'docx');
    expect(cmd.startsWith('pandoc "it\'s.md"')).toBe(true);
  });
});
