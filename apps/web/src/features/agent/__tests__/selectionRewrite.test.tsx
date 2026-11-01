/**
 * 「选中文字 → Agent 改写」交互测试：
 *  1. 预览区选区浮出气泡并进入指令输入；
 *  2. diff 确认弹窗的增删渲染、接受/拒绝回调、以及提示语言跟随输入语言。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { SelectionRewrite } from '../SelectionRewrite';
import { RewriteConfirmDialog } from '../RewriteConfirmDialog';
import { useSettings } from '../../../stores/settings';
import { useToast } from '../../../stores/toast';

function Host() {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div>
      <div ref={ref} data-testid="preview">
        <p data-line="3">这是重要的一段说明，需要改写。</p>
      </div>
      <SelectionRewrite
        containerRef={ref}
        getContent={() => '# 标题\n\n这是**重要**的一段说明，需要改写。\n'}
        onApply={() => undefined}
      />
    </div>
  );
}

/** jsdom 里造一个真实选区（跨浏览器 API 一致，便于断言定位链路） */
function selectText(textNode: Text) {
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 6);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return sel;
}

describe('预览区选中 → Agent 改写气泡', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSettings.getState().setAgent({ model: 'qwen2.5' });
    window.getSelection()?.removeAllRanges();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.getSelection()?.removeAllRanges();
  });

  it('拖选停顿后浮出「让 Agent 修改」气泡', () => {
    render(<Host />);
    const p = screen.getByTestId('preview').querySelector('p') as HTMLElement;
    selectText(p.firstChild as Text);
    fireEvent.mouseUp(screen.getByTestId('preview'));
    act(() => {
      vi.advanceTimersByTime(200);
    });

    const btn = screen.getByRole('button', { name: /让 Agent 修改/ });
    expect(btn).toBeTruthy();
    // 选区字符数提示
    expect(screen.getByText('6 字')).toBeTruthy();
  });

  it('点击气泡进入指令输入，Esc 收起', () => {
    render(<Host />);
    const p = screen.getByTestId('preview').querySelector('p') as HTMLElement;
    selectText(p.firstChild as Text);
    fireEvent.mouseUp(screen.getByTestId('preview'));
    act(() => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByRole('button', { name: /让 Agent 修改/ }));
    const input = screen.getByRole('textbox');
    expect(input).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('点击指令输入框后预览选区被折叠，面板也不会自我收起', () => {
    render(<Host />);
    const p = screen.getByTestId('preview').querySelector('p') as HTMLElement;
    selectText(p.firstChild as Text);
    fireEvent.mouseUp(screen.getByTestId('preview'));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.click(screen.getByRole('button', { name: /让 Agent 修改/ }));
    expect(screen.getByRole('textbox')).toBeTruthy();

    // 真实点击输入框会把预览里的文档选区折叠掉：随后的延时捕获不能把它当成「没有选区」
    window.getSelection()?.removeAllRanges();
    fireEvent.mouseUp(screen.getByTestId('preview'));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('气泡内部按下鼠标不会被「点击别处收起」逻辑误伤（可正常点击）', () => {
    render(<Host />);
    const p = screen.getByTestId('preview').querySelector('p') as HTMLElement;
    selectText(p.firstChild as Text);
    fireEvent.mouseUp(screen.getByTestId('preview'));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // 真实点击序列：mousedown 在气泡上 → 不应收起
    fireEvent.mouseDown(screen.getByRole('button', { name: /让 Agent 修改/ }));
    expect(screen.getByRole('button', { name: /让 Agent 修改/ })).toBeTruthy();
  });

  it('选区为空时不浮出气泡', () => {
    render(<Host />);
    window.getSelection()?.removeAllRanges();
    fireEvent.mouseUp(screen.getByTestId('preview'));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole('button', { name: /让 Agent 修改/ })).toBeNull();
  });
});

describe('diff 确认弹窗', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  const base = {
    before: '这是一个方案',
    after: '这是一个更好的方案',
    line: 3,
    confidence: 'normalized' as const,
    ambiguous: false,
    candidates: 1,
  };

  it('只把新增部分标为 add，未变部分不变色', () => {
    const { container } = render(
      <RewriteConfirmDialog
        locale="zh-CN"
        {...base}
        onAccept={() => undefined}
        onReject={() => undefined}
        onRegenerate={() => undefined}
      />
    );
    const add = container.querySelector('.rw-add');
    expect(add?.textContent).toBe('更好的');
    expect(container.querySelector('.rw-del')).toBeNull();
    expect(container.textContent).toContain('这是一个');
  });

  it('删除部分标为 del，并给出增删统计', () => {
    const { container } = render(
      <RewriteConfirmDialog
        locale="zh-CN"
        {...base}
        before="这是一个非常好的方案"
        after="这是一个方案"
        onAccept={() => undefined}
        onReject={() => undefined}
        onRegenerate={() => undefined}
      />
    );
    expect(container.querySelector('.rw-del')?.textContent).toContain('非常好');
    expect(screen.getByText('−4 字 / +0 字')).toBeTruthy();
  });

  it('接受 / 拒绝 / 重新生成各自触发对应回调', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onRegenerate = vi.fn();
    render(
      <RewriteConfirmDialog
        locale="zh-CN"
        {...base}
        onAccept={onAccept}
        onReject={onReject}
        onRegenerate={onRegenerate}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '接受' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('Esc 等同拒绝', () => {
    const onReject = vi.fn();
    render(
      <RewriteConfirmDialog
        locale="zh-CN"
        {...base}
        onAccept={() => undefined}
        onReject={onReject}
        onRegenerate={() => undefined}
      />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('提示语言跟随输入语言：英文 locale 显示英文文案', () => {
    render(
      <RewriteConfirmDialog
        locale="en"
        {...base}
        onAccept={() => undefined}
        onReject={() => undefined}
        onRegenerate={() => undefined}
      />
    );
    expect(screen.getByText('Confirm change')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
  });

  it('多处命中时给出歧义提示', () => {
    render(
      <RewriteConfirmDialog
        locale="zh-CN"
        {...base}
        ambiguous
        candidates={3}
        onAccept={() => undefined}
        onReject={() => undefined}
        onRegenerate={() => undefined}
      />
    );
    expect(screen.getByText(/出现 3 次/)).toBeTruthy();
  });
});

describe('定位失败提示', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToast.setState({ items: [] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('选区在正文里定位不到时提示，且不改动正文', () => {
    const onApply = vi.fn();
    function Host2() {
      const ref = useRef<HTMLDivElement | null>(null);
      return (
        <div>
          <div ref={ref} data-testid="preview">
            <p data-line="3">这是重要的一段说明，需要改写。</p>
          </div>
          <SelectionRewrite
            containerRef={ref}
            getContent={() => '完全不相干的正文。'}
            onApply={onApply}
          />
        </div>
      );
    }
    render(<Host2 />);
    const p = screen.getByTestId('preview').querySelector('p') as HTMLElement;
    selectText(p.firstChild as Text);
    fireEvent.mouseUp(screen.getByTestId('preview'));
    act(() => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.click(screen.getByRole('button', { name: /让 Agent 修改/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '更简洁' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    expect(useToast.getState().items.some((i) => i.message.includes('没能在正文里定位'))).toBe(
      true
    );
    expect(onApply).not.toHaveBeenCalled();
  });
});
