import { describe, it, expect } from 'vitest';
import {
  buildPandocCommand,
  markdownToLatexLite,
  suggestPandocOutput,
} from '../src/export/pandoc';

describe('pandoc helpers', () => {
  it('suggest output path', () => {
    expect(suggestPandocOutput('notes/a.md', 'docx')).toBe('notes/a.docx');
  });

  it('build command', () => {
    const cmd = buildPandocCommand('a.md', 'a.docx', 'docx');
    expect(cmd).toContain('pandoc');
    expect(cmd).toContain('a.md');
    expect(cmd).toContain('-t docx');
  });

  it('latex lite has document shell', () => {
    const tex = markdownToLatexLite('# Hello\n\n**bold** and `code`');
    expect(tex).toContain('\\begin{document}');
    expect(tex).toContain('\\section{Hello}');
    expect(tex).toContain('\\textbf{bold}');
    expect(tex).toContain('\\end{document}');
  });
});
