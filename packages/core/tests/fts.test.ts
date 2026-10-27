import { describe, it, expect } from 'vitest';
import { tokenize, FullTextIndex, SemanticIndex, cosine } from '../src/search/fts';

describe('CJK 分词', () => {
  it('英文按词、中文按字 + 二元组', () => {
    const t = tokenize('Hello 世界 foo');
    expect(t).toContain('hello');
    expect(t).toContain('foo');
    expect(t).toContain('世');
    expect(t).toContain('世界');
    expect(t).toContain('界');
  });
});

describe('BM25 全文索引', () => {
  it('命中与按词频排序', () => {
    const idx = new FullTextIndex();
    idx.add('1', '苹果 香蕉 苹果');
    idx.add('2', '香蕉');
    idx.add('3', 'totally different words here');
    const hits = idx.search('苹果');
    expect(hits[0]!.id).toBe('1');
    expect(idx.search('不存在的词xyz')).toHaveLength(0);
  });

  it('remove 后不再命中', () => {
    const idx = new FullTextIndex();
    idx.add('1', '猫');
    idx.add('2', '狗');
    idx.remove('1');
    expect(idx.search('猫')).toHaveLength(0);
    expect(idx.search('狗')[0]!.id).toBe('2');
  });
});

describe('语义索引', () => {
  it('余弦最近邻', () => {
    const s = new SemanticIndex();
    s.set('a', [1, 0, 0]);
    s.set('b', [0, 1, 0]);
    s.set('c', [0.9, 0.1, 0]);
    expect(s.search([1, 0, 0])[0]!.id).toBe('a');
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
  });
});
