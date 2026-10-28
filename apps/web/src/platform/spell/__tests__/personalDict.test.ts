import { beforeEach, describe, expect, it } from 'vitest';
import {
  addToPersonalDict,
  clearAffText,
  importAffText,
  importWordListText,
  loadPersonalDict,
  loadedAffRuleCount,
} from '../personalDict';

/**
 * 个人词典与 .aff 规则导入。
 * 输入是用户粘贴的文本文件，脏数据（注释、计数行、非法字符、重复词）必须被挡在外面，
 * 否则整份辞典会被污染、拼写检查反而误报。
 */

beforeEach(() => {
  localStorage.clear();
});

describe('importWordListText', () => {
  it('F-38 一行一词，忽略空行与 # 注释，统一小写', () => {
    const n = importWordListText('Alpha\n\n# 注释\nBETA\n  gamma  ');
    expect(n).toBe(3);
    expect(loadPersonalDict()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('F-39 Hunspell .dic 首行计数被忽略，词干 /FLAGS 被剥离', () => {
    const n = importWordListText('3\nwork/S\nrunning/AB\nnote\n');
    expect(n).toBe(3);
    expect(loadPersonalDict()).toEqual(['work', 'running', 'note']);
  });

  it('F-40 非法词条（数字开头、中文、含符号）被跳过，返回真实导入数', () => {
    const n = importWordListText('123abc\n中文\nfoo_bar\nok-word\nok2');
    expect(n).toBe(1);
    expect(loadPersonalDict()).toEqual(['ok-word']);
  });

  it('F-41 重复导入不产生重复词条', () => {
    importWordListText('alpha\nbeta');
    const n = importWordListText('beta\ngamma');
    expect(n).toBe(2);
    expect(loadPersonalDict().sort()).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('addToPersonalDict', () => {
  it('F-42 新增词自动小写并去重', () => {
    addToPersonalDict('Foo');
    addToPersonalDict('foo');
    expect(loadPersonalDict()).toEqual(['foo']);
  });
});

describe('.aff 规则导入', () => {
  const AFF = [
    '# 注释行',
    'PFX U Y 1',
    'PFX U 0 un .',
    'SFX S Y 2',
    'SFX S 0 s .',
    'SFX S y ies [^aeiou]y',
  ].join('\n');

  it('F-43 统计 PFX+SFX 规则条数（header 行不算规则）', () => {
    expect(importAffText(AFF)).toBe(3);
    expect(loadedAffRuleCount()).toBe(3);
  });

  it('F-44 clearAffText 后规则数归零', () => {
    importAffText(AFF);
    clearAffText();
    expect(loadedAffRuleCount()).toBe(0);
  });

  it('F-45 空文本导入返回 0（不抛错）', () => {
    expect(importAffText('')).toBe(0);
    expect(loadedAffRuleCount()).toBe(0);
  });
});
