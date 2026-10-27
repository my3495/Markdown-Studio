// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { Root } from 'hast';
import { MarkdownView } from '../index';

const tree = (children: unknown[]): Root =>
  ({
    type: 'root',
    children,
  }) as unknown as Root;

describe('MarkdownView', () => {
  it('渲染基础 hast 节点', () => {
    const hast = tree([
      { type: 'element', tagName: 'h1', properties: {}, children: [{ type: 'text', value: '标题' }] },
    ]);
    const { container } = render(<MarkdownView hast={hast} />);
    expect(container.querySelector('h1')?.textContent).toBe('标题');
  });

  it('把 style 字符串解析为 React 样式对象（含自定义属性）', () => {
    const hast = tree([
      {
        type: 'element',
        tagName: 'span',
        properties: { style: 'color: red; background-color: #eee; --shiki-dark: #fff' },
        children: [{ type: 'text', value: '彩色' }],
      },
    ]);
    const { container } = render(<MarkdownView hast={hast} />);
    const el = container.querySelector('span')!;
    expect(el.style.color).toBe('red');
    expect(el.style.backgroundColor).toBe('rgb(238, 238, 238)');
    expect(el.style.getPropertyValue('--shiki-dark')).toBe('#fff');
  });

  it('无法解析的 style 声明被丢弃而不是抛错（避免整树渲染失败）', () => {
    const hast = tree([
      {
        type: 'element',
        tagName: 'span',
        properties: { style: 'garbage' },
        children: [{ type: 'text', value: 'ok' }],
      },
    ]);
    expect(() => render(<MarkdownView hast={hast} />)).not.toThrow();
    const { container } = render(<MarkdownView hast={hast} />);
    expect(container.querySelector('span')?.hasAttribute('style')).toBe(false);
  });

  it('自定义 components 覆盖默认元素', () => {
    const hast = tree([
      {
        type: 'element',
        tagName: 'strong',
        properties: {},
        children: [{ type: 'text', value: '重点' }],
      },
    ]);
    const { container } = render(
      <MarkdownView hast={hast} components={{ strong: (props) => <em {...props} /> }} />
    );
    expect(container.querySelector('em')?.textContent).toBe('重点');
  });
});
