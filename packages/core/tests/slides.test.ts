import { describe, it, expect } from 'vitest';
import { splitSlides } from '../src/slides/split';

describe('splitSlides', () => {
  it('按 --- 分页且忽略 frontmatter', () => {
    const md = `---
title: Demo
---
# One

hello
---
# Two

world
`;
    const slides = splitSlides(md);
    expect(slides).toHaveLength(2);
    expect(slides[0]).toContain('# One');
    expect(slides[1]).toContain('# Two');
  });

  it('支持 pagebreak 注释', () => {
    const slides = splitSlides('# A\n\n<!-- pagebreak -->\n\n# B');
    expect(slides).toHaveLength(2);
    expect(slides[0]).toContain('# A');
    expect(slides[1]).toContain('# B');
  });

  it('无分隔符时整篇一页', () => {
    expect(splitSlides('# Solo\n\ntext')).toEqual(['# Solo\n\ntext']);
  });
});
