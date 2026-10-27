import { describe, it, expect } from 'vitest';
import { replaceHeadingAtLine } from '../src/editor/headings';

describe('replaceHeadingAtLine', () => {
  it('替换指定行标题', () => {
    const md = '# One\n\n## Two\n';
    expect(replaceHeadingAtLine(md, 3, 'Deux')).toContain('## Deux');
    expect(replaceHeadingAtLine(md, 3, 'Deux')).toContain('# One');
  });

  it('非标题行不改', () => {
    const md = 'hello\n';
    expect(replaceHeadingAtLine(md, 1, 'x')).toBe(md);
  });
});
