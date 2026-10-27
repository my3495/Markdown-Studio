import { describe, it, expect } from 'vitest';
import {
  parseWikilinks,
  normalizeName,
  buildNameIndex,
  buildLinkGraph,
  backlinksOf,
  outgoingOf,
  unresolvedLinks,
} from '../src/links/wikilinks';

describe('wikilinks 解析', () => {
  it('解析 target / alias / heading', () => {
    const links = parseWikilinks('见 [[Alpha]] 与 [[Beta|贝塔]]，参考 [[Gamma#小节]]');
    expect(links.map((l) => l.target)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(links[1]!.alias).toBe('贝塔');
    expect(links[2]!.heading).toBe('小节');
  });

  it('忽略空目标', () => {
    expect(parseWikilinks('[[]] [[   ]]')).toHaveLength(0);
  });

  it('normalizeName 去 .md 与目录并小写', () => {
    expect(normalizeName('Notes/Idea.MD')).toBe('idea');
  });
});

describe('链接图与反链', () => {
  const notes = [
    { id: 'a', content: '链接到 [[B]] 和 [[C]]' },
    { id: 'b', content: '回到 [[A]]' },
    { id: 'c', content: '无链接，悬空 [[Missing]]' },
  ];
  const idx = buildNameIndex([
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ]);
  const g = buildLinkGraph(notes, idx);

  it('出链/入链正确', () => {
    expect([...g.outgoing.get('a')!].sort()).toEqual(['b', 'c']);
    expect(backlinksOf(g, 'a')).toEqual(['b']);
    expect(outgoingOf(g, 'c')).toEqual([]);
  });

  it('悬空链接可被检测', () => {
    expect(unresolvedLinks(notes, idx)).toEqual([{ target: 'Missing', from: 'c' }]);
  });
});
