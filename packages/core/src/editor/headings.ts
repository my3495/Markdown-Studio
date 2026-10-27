/**
 * B1-lite：按源行号替换 Markdown 标题文本（预览 contentEditable 回写）。
 */

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** 1-based 行号；若该行不是标题则返回原文档 */
export function replaceHeadingAtLine(md: string, line: number, newText: string): string {
  if (line < 1) return md;
  const lines = md.split(/\n/);
  const idx = line - 1;
  if (idx >= lines.length) return md;
  const m = HEADING.exec(lines[idx] ?? '');
  if (!m) return md;
  const hashes = m[1]!;
  const text = newText.replace(/\n/g, ' ').trim();
  lines[idx] = `${hashes} ${text}`;
  return lines.join('\n');
}

export function isHeadingLine(line: string): boolean {
  return HEADING.test(line);
}
