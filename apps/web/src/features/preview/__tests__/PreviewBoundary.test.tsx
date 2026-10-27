/**
 * 错误边界：预览渲染抛错时只降级预览区，不让整个应用消失。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PreviewBoundary } from '../PreviewBoundary';

function Boom(): JSX.Element {
  throw new Error('boom: cannot parse style attribute');
}

afterEach(cleanup);

describe('PreviewBoundary', () => {
  it('B-01 子组件抛错时展示降级面板而不是整页空白', () => {
    // React 会把边界捕获的错误打到 console.error，这里静默以保持输出干净
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <PreviewBoundary>
        <Boom />
      </PreviewBoundary>
    );
    expect(container.querySelector('.preview-error')).toBeTruthy();
    expect(screen.getByText('预览渲染失败')).toBeTruthy();
    expect(container.textContent).toContain('boom: cannot parse style attribute');
    spy.mockRestore();
  });

  it('B-02 正常子树直接透传，不产生额外包裹', () => {
    const { container } = render(
      <PreviewBoundary>
        <p>正常内容</p>
      </PreviewBoundary>
    );
    expect(container.querySelector('.preview-error')).toBeNull();
    expect(screen.getByText('正常内容')).toBeTruthy();
  });

  it('B-03 提供重试入口', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    function Maybe(): JSX.Element {
      if (shouldThrow) throw new Error('boom');
      return <p>恢复了</p>;
    }
    const { container } = render(
      <PreviewBoundary>
        <Maybe />
      </PreviewBoundary>
    );
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: '重新渲染' }));
    expect(container.querySelector('.preview-error')).toBeNull();
    expect(screen.getByText('恢复了')).toBeTruthy();
    spy.mockRestore();
  });
});
