/** 选区 → Markdown（复制为 MD / 分享卡片文本来源） */
export function markdownFromLineRange(
  md: string,
  startLine: number,
  endLine: number
): string {
  const lines = md.split('\n');
  const s = Math.max(1, startLine) - 1;
  const e = Math.min(lines.length, endLine);
  return lines.slice(s, e).join('\n');
}

/** 规范化 Markdown（统一换行、压缩空行、保证末尾换行） */
export function normalizeMarkdown(md: string): string {
  return (
    md
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+$/, '') + '\n'
  );
}
