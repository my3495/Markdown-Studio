/**
 * 幻灯片分页：Marp 风格以独立行 `---` 分隔；也支持 `<!-- pagebreak -->`。
 * 文档头部 YAML frontmatter（首个 ---...---）不计入分页。
 */

import { parseFrontmatter } from '../frontmatter';

function isSlideSeparator(line: string): boolean {
  if (line === '---') return true;
  return /^\s*<!--\s*pagebreak\s*-->\s*$/i.test(line);
}

/** 将 Markdown 拆成若干幻灯片正文（已去掉 frontmatter） */
export function splitSlides(markdown: string): string[] {
  const { body } = parseFrontmatter(markdown);
  const lines = body.split(/\r?\n/);
  const chunks: string[][] = [[]];
  for (const line of lines) {
    if (isSlideSeparator(line)) {
      chunks.push([]);
    } else {
      chunks[chunks.length - 1]!.push(line);
    }
  }
  const slides = chunks
    .map((c) => c.join('\n').trim())
    .filter((s) => s.length > 0);
  return slides.length > 0 ? slides : [body.trim()];
}
