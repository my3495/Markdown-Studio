import { describe, expect, it } from 'vitest';
import { filterCommands, groupOrder, type CommandItem, type CommandGroup } from '../commands';

/**
 * 命令面板的检索与排序。
 * 输入是纯数据结构，不需要挂 React——把「子序列匹配 / 标签优先 / 分组顺序」钉死即可。
 */

function item(id: string, label: string, keywords = '', group: CommandGroup = 'action'): CommandItem {
  return { id, label, keywords: keywords || label.toLowerCase(), group, icon: 'new', run: () => {} };
}

const ITEMS = [
  item('theme', '主题', 'theme dark light'),
  item('focus', '专注模式', 'focus'),
  item('export', '导出 HTML', 'export html'),
  item('nav-outline', '大纲', 'outline side', 'nav'),
];

describe('filterCommands', () => {
  it('F-15 空查询原样返回全部条目', () => {
    expect(filterCommands(ITEMS, '').map((i) => i.id)).toEqual(ITEMS.map((i) => i.id));
    expect(filterCommands(ITEMS, '   ')).toHaveLength(ITEMS.length);
  });

  it('F-16 命中标签（中文）', () => {
    expect(filterCommands(ITEMS, '专注').map((i) => i.id)).toEqual(['focus']);
  });

  it('F-17 命中关键词（英文）也能查到中文标签条目', () => {
    expect(filterCommands(ITEMS, 'dark').map((i) => i.id)).toEqual(['theme']);
  });

  it('F-18 大小写与首尾空格无关', () => {
    expect(filterCommands(ITEMS, '  EXPORT ').map((i) => i.id)).toEqual(['export']);
  });

  it('F-19 子序列匹配（非连续字符也算命中）', () => {
    expect(filterCommands(ITEMS, 'thm').map((i) => i.id)).toEqual(['theme']);
  });

  it('F-20 完全不匹配时返回空数组', () => {
    expect(filterCommands(ITEMS, 'zzzz')).toEqual([]);
  });

  it('F-21 标签命中排序高于仅关键词命中', () => {
    const kwOnly = item('a', '甲', 'theme');
    const labelHit = item('b', 'theme 设置', 'theme');
    const out = filterCommands([kwOnly, labelHit], 'theme');
    expect(out.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('F-22 结果按分数降序（前缀连续命中最高）', () => {
    const strong = item('s', 'export 导出', 'export');
    const weak = item('w', 'ex 与 port', 'export');
    const out = filterCommands([weak, strong], 'export');
    expect(out[0]!.id).toBe('s');
  });
});

describe('groupOrder', () => {
  it('F-23 动作 → 导航 → 笔记 的展示顺序', () => {
    expect(groupOrder('action')).toBeLessThan(groupOrder('nav'));
    expect(groupOrder('nav')).toBeLessThan(groupOrder('note'));
  });
});
