// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Root } from 'hast';
import { MarkdownView } from '../index';

const tree = (children: unknown[]): Root => ({ type: 'root', children }) as unknown as Root;

const p = (value: string) => ({
  type: 'element',
  tagName: 'p',
  properties: {},
  children: [{ type: 'text', value }],
});

/**
 * 用自定义 p 组件的执行次数衡量「真正被 reconcile 的块数」：
 * Block 被 memo bailout 时，其子树不会再执行组件函数。
 */
function counter() {
  let n = 0;
  const components = {
    p: (props: { children?: ReactNode }) => {
      n++;
      return <p>{props.children}</p>;
    },
  };
  return { components, hits: () => n };
}

describe('MarkdownView 块级增量渲染', () => {
  it('只改尾部块时，前面的块不重新渲染', () => {
    const c = counter();
    const { rerender } = render(
      <MarkdownView hast={tree([p('A'), p('B'), p('C')])} components={c.components} />
    );
    expect(c.hits()).toBe(3);

    rerender(<MarkdownView hast={tree([p('A'), p('B'), p('D')])} components={c.components} />);
    // 只有被改的第三块重新执行
    expect(c.hits()).toBe(4);
  });

  it('中间插入：插入点之前的块完全不重新渲染', () => {
    // [A,B,C] → [A,X,B,C]：位置 1/2/3 的 DOM 内容确实变了（块被挤位），
    // 但位置 0 不受影响，必须 bailout。这里按「哪几块被执行」断言，而不是只看次数。
    const log: string[] = [];
    const components = {
      p: (props: { children?: ReactNode }) => {
        log.push(String(props.children));
        return <p>{props.children}</p>;
      },
    };
    const { rerender } = render(
      <MarkdownView hast={tree([p('A'), p('B'), p('C')])} components={components} />
    );
    log.length = 0;

    rerender(<MarkdownView hast={tree([p('A'), p('X'), p('B'), p('C')])} components={components} />);
    expect(log).not.toContain('A');
    expect(log).toContain('X');
    expect(log).toHaveLength(3);
  });

  it('长文档末尾追加只重渲染最后一块', () => {
    const c = counter();
    const before = Array.from({ length: 120 }, (_, i) => p(`块${i}`));
    const after = [...before.slice(0, 119), p('块119-新')];
    const { rerender } = render(<MarkdownView hast={tree(before)} components={c.components} />);
    const base = c.hits();

    rerender(<MarkdownView hast={tree(after)} components={c.components} />);
    expect(c.hits() - base).toBe(1);
  });

  it('两处相隔较远的块各自改动时只重渲染这两块', () => {
    const c = counter();
    const { rerender } = render(
      <MarkdownView
        hast={tree([p('A'), p('B'), p('C'), p('D'), p('E')])}
        components={c.components}
      />
    );
    const before = c.hits();

    rerender(
      <MarkdownView
        hast={tree([p('A2'), p('B'), p('C'), p('D'), p('E2')])}
        components={c.components}
      />
    );
    expect(c.hits() - before).toBe(2);
  });

  it('内容变化一定反映到 DOM（不允许复用旧节点）', () => {
    const { container, rerender } = render(<MarkdownView hast={tree([p('旧内容')])} />);
    expect(container.textContent).toContain('旧内容');

    rerender(<MarkdownView hast={tree([p('新内容')])} />);
    expect(container.textContent).toContain('新内容');
    expect(container.textContent).not.toContain('旧内容');
  });

  it('块数变化后 DOM 顺序与内容仍正确', () => {
    const { container, rerender } = render(<MarkdownView hast={tree([p('1'), p('2')])} />);
    rerender(<MarkdownView hast={tree([p('0'), p('1'), p('2')])} />);
    expect([...container.querySelectorAll('p')].map((el) => el.textContent)).toEqual([
      '0',
      '1',
      '2',
    ]);

    rerender(<MarkdownView hast={tree([p('1')])} />);
    expect([...container.querySelectorAll('p')].map((el) => el.textContent)).toEqual(['1']);
  });

  it('hast 未变（父级重渲染）时不重建任何块', () => {
    const c = counter();
    const hast = tree([p('A'), p('B')]);
    const { rerender } = render(<MarkdownView hast={hast} components={c.components} />);
    const before = c.hits();

    rerender(<MarkdownView hast={hast} components={c.components} />);
    expect(c.hits()).toBe(before);
  });

  it('属性值（数组 className / style 对象）变化能触发重渲染', () => {
    const mk = (cls: string[], style: string) => ({
      type: 'element',
      tagName: 'span',
      properties: { className: cls, style },
      children: [{ type: 'text', value: 'x' }],
    });
    const { container, rerender } = render(<MarkdownView hast={tree([mk(['a'], 'color: red')])} />);
    expect(container.querySelector('span')?.className).toBe('a');

    // className 数组内容变化（新数组、同长度）
    rerender(<MarkdownView hast={tree([mk(['b'], 'color: red')])} />);
    expect(container.querySelector('span')?.className).toBe('b');

    // style 对象内容变化
    rerender(<MarkdownView hast={tree([mk(['b'], 'color: blue')])} />);
    expect(container.querySelector('span')?.style.color).toBe('blue');
  });
});
