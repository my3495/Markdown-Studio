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
  const args = [inputPath, '-o', outputPath];
  // pdf 由输出扩展名推断，pandoc **没有** pdf writer：
  // `-t pdf` 会直接报 `Unknown output format pdf`，整条命令必然失败。
  // latex 的 writer 名与格式名一致，其余 docx/epub 亦然。
  if (format !== 'pdf') args.push('-t', format === 'latex' ? 'latex' : format);
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
 * 覆盖标题、粗斜体、代码块、有序/无序列表、链接；复杂文档仍建议本机 Pandoc。
 */
export function markdownToLatexLite(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [
    '\\documentclass[12pt]{article}',
    // ctex 同时解决中文与 UTF-8 编码：缺了它，中文文档用 pdflatex 必然编译失败
    // （xelatex 也需要它来配置 CJK 字体）。纯西文文档加载无副作用。
    '\\usepackage[UTF8]{ctex}',
    '\\usepackage{hyperref}',
    '\\usepackage{graphicx}',
    '\\usepackage{listings}',
    '\\begin{document}',
    '',
  ];
  let inCode = false;
  let listEnv: 'itemize' | 'enumerate' | null = null;

  const closeList = () => {
    if (listEnv) {
      out.push(`\\end{${listEnv}}`);
      listEnv = null;
    }
  };
  /** 切换到目标列表环境：同类复用，异类先闭合再开（避免 itemize 套 enumerate 错位） */
  const openList = (kind: 'itemize' | 'enumerate') => {
    if (listEnv === kind) return;
    closeList();
    out.push(`\\begin{${kind}}`);
    listEnv = kind;
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
      openList('itemize');
      out.push(`\\item ${convertInline(raw.replace(/^[-*+]\s+/, ''))}`);
      continue;
    }
    // 有序列表：`1.` / `1)` 开头；数字后面必须跟分隔符，避免把 `2024. 计划` 之外
    // 的小数（`2.2 说明`）误判为列表项
    if (/^\d+[.)]\s+/.test(raw)) {
      openList('enumerate');
      out.push(`\\item ${convertInline(raw.replace(/^\d+[.)]\s+/, ''))}`);
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

/**
 * LaTeX 特殊字符转义。
 *
 * 必须**单遍**替换：分多步做时，先插入的 `\textbackslash{}` 会被后续的
 * 「给 `{}` 加反斜杠」规则二次转义成 `\textbackslash\{\}`，产物直接编译失败。
 * 同理 `^` 在 LaTeX 里是上标，漏转义会让正文里的 `^` 吞掉后一个字符。
 */
const LATEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

function escapeLatex(s: string): string {
  return s.replace(/[\\{}&%$#_~^]/g, (c) => LATEX_ESCAPES[c]!);
}
