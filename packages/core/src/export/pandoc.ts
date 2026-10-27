/**
 * Pandoc 导出辅助：生成 CLI 参数 / 命令；纯逻辑，由桌面或本机 shell 执行。
 */

export type PandocFormat = 'docx' | 'epub' | 'latex' | 'pdf';

const EXT: Record<PandocFormat, string> = {
  docx: 'docx',
  epub: 'epub',
  latex: 'tex',
  pdf: 'pdf',
};

export function pandocOutputExt(format: PandocFormat): string {
  return EXT[format];
}

/** 由输入路径推导输出路径（替换扩展名） */
export function suggestPandocOutput(inputPath: string, format: PandocFormat): string {
  const base = inputPath.replace(/\.[^.\\/]+$/, '') || inputPath;
  return `${base}.${EXT[format]}`;
}

export interface PandocOptions {
  /** 额外传给 pandoc 的参数，如 ['--toc', '-V', 'geometry:margin=1in'] */
  extraArgs?: string[];
  /** 指定 pandoc 可执行文件，默认 'pandoc' */
  bin?: string;
}

/** 构建 argv（不含可执行文件名） */
export function buildPandocArgs(
  inputPath: string,
  outputPath: string,
  format: PandocFormat,
  opts: PandocOptions = {}
): string[] {
  const args = [inputPath, '-o', outputPath, '-t', format === 'latex' ? 'latex' : format];
  if (opts.extraArgs?.length) args.push(...opts.extraArgs);
  return args;
}

/** 可复制到剪贴板的完整 shell 命令（POSIX 风格引号） */
export function buildPandocCommand(
  inputPath: string,
  outputPath: string,
  format: PandocFormat,
  opts: PandocOptions = {}
): string {
  const bin = opts.bin ?? 'pandoc';
  const args = buildPandocArgs(inputPath, outputPath, format, opts);
  const q = (s: string) => (/\s|"|'/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  return [bin, ...args.map(q)].join(' ');
}

/**
 * 极简 Markdown → LaTeX（无 Pandoc 时的回退）。
 * 覆盖标题、粗斜体、代码块、列表、链接；复杂文档仍建议本机 Pandoc。
 */
export function markdownToLatexLite(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [
    '\\documentclass[12pt]{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage{hyperref}',
    '\\usepackage{graphicx}',
    '\\usepackage{listings}',
    '\\begin{document}',
    '',
  ];
  let inCode = false;
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('\\end{itemize}');
      inList = false;
    }
  };

  for (const raw of lines) {
    if (/^```/.test(raw)) {
      closeList();
      if (!inCode) {
        out.push('\\begin{lstlisting}');
        inCode = true;
      } else {
        out.push('\\end{lstlisting}');
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      out.push(raw);
      continue;
    }
    if (/^#{1,6}\s/.test(raw)) {
      closeList();
      const m = /^(#{1,6})\s+(.*)$/.exec(raw)!;
      const level = m[1]!.length;
      const title = convertInline(m[2]!);
      const cmd = level === 1 ? 'section' : level === 2 ? 'subsection' : 'subsubsection';
      out.push(`\\${cmd}{${title}}`);
      continue;
    }
    if (/^[-*+]\s+/.test(raw)) {
      if (!inList) {
        out.push('\\begin{itemize}');
        inList = true;
      }
      out.push(`\\item ${convertInline(raw.replace(/^[-*+]\s+/, ''))}`);
      continue;
    }
    if (!raw.trim()) {
      closeList();
      out.push('');
      continue;
    }
    closeList();
    out.push(convertInline(raw));
  }
  closeList();
  if (inCode) out.push('\\end{lstlisting}');
  out.push('', '\\end{document}');
  return out.join('\n');
}

/** 先抽取行内标记再转义其余文本，避免 \\textbf 被二次转义 */
function convertInline(s: string): string {
  const slots: string[] = [];
  const park = (latex: string) => {
    slots.push(latex);
    return `\u0000${slots.length - 1}\u0000`;
  };
  let t = s.replace(/`([^`]+)`/g, (_, c: string) => park(`\\texttt{${escapeLatex(c)}}`));
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, c: string) => park(`\\textbf{${escapeLatex(c)}}`));
  t = t.replace(/\*([^*]+)\*/g, (_, c: string) => park(`\\emph{${escapeLatex(c)}}`));
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) =>
    park(`\\href{${escapeLatex(href)}}{${escapeLatex(label)}}`)
  );
  t = escapeLatex(t);
  return t.replace(/\u0000(\d+)\u0000/g, (_, i: string) => slots[Number(i)]!);
}

function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}');
}
