import { describe, it, expect } from 'vitest';
import { checkSpelling, DEFAULT_EN_DICT } from '../src/spell/check';

describe('spell check', () => {
  it('检出未知英文词', () => {
    const issues = checkSpelling('This is a xyzzyword test', {
      dictionary: DEFAULT_EN_DICT,
    });
    expect(issues.some((i) => i.word === 'xyzzyword')).toBe(true);
  });

  it('忽略列表与代码块', () => {
    const md = 'Hello xyzzyword\n\n```\nxyzzyword\n```\n';
    const issues = checkSpelling(md, {
      dictionary: DEFAULT_EN_DICT,
      ignore: new Set(['xyzzyword']),
    });
    expect(issues).toHaveLength(0);
  });
});
