import { describe, it, expect } from 'vitest';
import {
  buildPandocArgs,
  buildPandocCommand,
  markdownToLatexLite,
  pandocOutputExt,
  suggestPandocOutput,
} from '../src/export/pandoc';

/**
 * Pandoc 导出辅助（F1）的细粒度验收：
 * - 路径推导与扩展名映射：错了会让 CLI 写到意外位置；
 * - argv/quoted command：错了在 shell 里会被空格拆成两个参数；
 * - latex lite 回退：没有本机 pandoc 时的兜底产物，至少要能编译通过。
 */

describe('路径与扩展名', () => {
  it('E-P01 格式 → 扩展名映射完整', () => {
    expect(pandocOutputExt('docx')).toBe('docx');
    expect(pandocOutputExt('epub')).toBe('epub');
    expect(pandocOutputExt('latex')).toBe('tex');
    expect(pandocOutputExt('pdf')).toBe('pdf');
  });

  it('E-P02 输出路径替换扩展名（保留目录）', () => {
    expect(suggestPandocOutput('notes/a.md', 'docx')).toBe('notes/a.docx');
    expect(suggestPandocOutput('a.markdown', 'epub')).toBe('a.epub');
    expect(suggestPandocOutput('C:\\docs\\a.md', 'pdf')).toBe('C:\\docs\\a.pdf');
  });

  it('E-P03 输入没有扩展名时直接追加', () => {
    expect(suggestPandocOutput('README', 'pdf')).toBe('README.pdf');
  });
});

describe('argv 与命令字符串', () => {
  it('E-P04 latex 用 -t latex，其余用同名 writer；pdf 不带 -t', () => {
    expect(buildPandocArgs('a.md', 'a.tex', 'latex')).toEqual(['a.md', '-o', 'a.tex', '-t', 'latex']);
    expect(buildPandocArgs('a.md', 'a.docx', 'docx')).toEqual(['a.md', '-o', 'a.docx', '-t', 'docx']);
    // pandoc 没有 pdf writer：-t pdf 会直接报 Unknown output format
    expect(buildPandocArgs('a.md', 'a.pdf', 'pdf')).toEqual(['a.md', '-o', 'a.pdf']);
  });

  it('E-P05 extraArgs 追加在末尾、顺序保持', () => {
    const args = buildPandocArgs('a.md', 'a.pdf', 'pdf', {
      extraArgs: ['--toc', '-V', 'geometry:margin=1in'],
    });
    expect(args.slice(-3)).toEqual(['--toc', '-V', 'geometry:margin=1in']);
  });

  it('E-P06 默认 bin 为 pandoc，可自定义', () => {
    expect(buildPandocCommand('a.md', 'a.docx', 'docx')).toMatch(/^pandoc /);
    expect(buildPandocCommand('a.md', 'a.docx', 'docx', { bin: '/opt/homebrew/bin/pandoc' })).toMatch(
      /^\/opt\/homebrew\/bin\/pandoc /
    );
  });

  it('E-P07 含空格的路径必须加引号（否则 shell 会拆参数）', () => {
    const cmd = buildPandocCommand('my notes/a.md', 'out dir/a.docx', 'docx');
    expect(cmd).toContain('"my notes/a.md"');
    expect(cmd).toContain('"out dir/a.docx"');
  });

  it('E-P08 路径内的双引号被转义，不会截断命令', () => {
    const cmd = buildPandocCommand('a"b.md', 'o.docx', 'docx');
    expect(cmd).toContain('"a\\"b.md"');
  });

  it('E-P09 无特殊字符的路径不加多余引号', () => {
    expect(buildPandocCommand('a.md', 'a.docx', 'docx')).toBe('pandoc a.md -o a.docx -t docx');
  });
});

describe('markdownToLatexLite（无 pandoc 时的回退）', () => {
  it('E-P10 文档骨架（documentclass / begin{document} / end）', () => {
    const tex = markdownToLatexLite('# T');
    expect(tex.startsWith('\\documentclass')).toBe(true);
    expect(tex).toContain('\\begin{document}');
    expect(tex.trimEnd().endsWith('\\end{document}')).toBe(true);
  });

  it('E-P11 标题层级映射（h1→section / h2→subsection / h3+→subsubsection）', () => {
    const tex = markdownToLatexLite('# A\n\n## B\n\n### C\n\n#### D');
    expect(tex).toContain('\\section{A}');
    expect(tex).toContain('\\subsection{B}');
    expect(tex.match(/\\subsubsection\{C\}/)).toBeTruthy();
    expect(tex.match(/\\subsubsection\{D\}/)).toBeTruthy();
  });

  it('E-P12 行内标记：粗体/斜体/行内代码/链接', () => {
    const tex = markdownToLatexLite('**粗** *斜* `码` [站点](https://example.com)');
    expect(tex).toContain('\\textbf{粗}');
    expect(tex).toContain('\\emph{斜}');
    expect(tex).toContain('\\texttt{码}');
    expect(tex).toContain('\\href{https://example.com}{站点}');
  });

  it('E-P13 有序列表转 enumerate（1. 与 1) 都识别）', () => {
    const dotted = markdownToLatexLite('1. 第一\n2. 第二');
    expect(dotted).toContain('\\begin{enumerate}');
    expect(dotted).toContain('\\item 第一');
    expect(dotted).toContain('\\item 第二');

    const paren = markdownToLatexLite('1) 甲\n2) 乙');
    expect(paren).toContain('\\begin{enumerate}');
    expect(paren).toContain('\\item 甲');
  });

  it('E-P14 无序列表包裹 itemize，连续项只在首尾各开合一次', () => {
    const tex = markdownToLatexLite('- 甲\n- 乙\n\n正文');
    expect(tex.match(/\\begin\{itemize\}/g)!.length).toBe(1);
    expect(tex.match(/\\end\{itemize\}/g)!.length).toBe(1);
    expect(tex).toContain('\\item 甲');
    expect(tex).toContain('\\item 乙');
  });

  it('E-P15 代码块进入 lstlisting，内容不做转义', () => {
    const tex = markdownToLatexLite('```js\nconst a = {b: 1};\n```');
    expect(tex).toContain('\\begin{lstlisting}');
    expect(tex).toContain('\\end{lstlisting}');
    expect(tex).toContain('const a = {b: 1};');
  });

  it('E-P16 未闭合代码块在结尾自动补 end（保证可编译）', () => {
    const tex = markdownToLatexLite('```\n未闭合');
    expect(tex.match(/\\begin\{lstlisting\}/g)!.length).toBe(1);
    expect(tex.match(/\\end\{lstlisting\}/g)!.length).toBe(1);
  });

  it('E-P17 CRLF 输入按行处理，不会把 \\r 带进输出', () => {
    const tex = markdownToLatexLite('# A\r\n\r\n正文');
    expect(tex).not.toContain('\r');
    expect(tex).toContain('\\section{A}');
  });

  it('E-P18 特殊字符转义（& % $ # _ { } ~ ^ \\）', () => {
    const tex = markdownToLatexLite('100% & $5 #1 a_b {c} ~ ^ \\');
    expect(tex).toContain('100\\%');
    expect(tex).toContain('\\&');
    expect(tex).toContain('\\$5');
    expect(tex).toContain('\\#1');
    expect(tex).toContain('a\\_b');
    expect(tex).toContain('\\{c\\}');
    expect(tex).toContain('\\textasciitilde{}');
    expect(tex).toContain('\\textasciicircum{}');
    expect(tex).toContain('\\textbackslash{}');
  });

  it('E-P19 转义后仍是合法 LaTeX：转义命令本身不被二次转义', () => {
    const tex = markdownToLatexLite('反斜杠 \\ 与 ~ 与 **粗_体**');
    // \textbackslash{} 里的花括号若被二次转义，会变成 \textbackslash\{\}（编译报错）
    expect(tex).not.toContain('\\textbackslash\\{\\}');
    expect(tex).not.toContain('\\textasciitilde\\{\\}');
    expect(tex).toContain('\\textbf{粗\\_体}');
  });
});
