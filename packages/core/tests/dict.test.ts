import { describe, it, expect } from 'vitest';
import { buildSpellDictionary, parseWordList } from '../src/spell/dict';

describe('spell dict', () => {
  it('解析纯文本词表', () => {
    const words = parseWordList('# c\nFoo\nbar/S\n');
    expect(words).toEqual(['foo', 'bar']);
  });

  it('解析 dic 首行计数', () => {
    expect(parseWordList('2\nalpha\nbeta')).toEqual(['alpha', 'beta']);
  });

  it('合并默认词典', () => {
    const d = buildSpellDictionary(['customword']);
    expect(d.has('the')).toBe(true);
    expect(d.has('customword')).toBe(true);
  });
});
