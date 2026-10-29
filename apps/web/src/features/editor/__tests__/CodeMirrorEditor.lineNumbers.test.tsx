/**
 * 行号显隐：设置项「显示行号」必须即时作用到已挂载的 CodeMirror 视图。
 *
 * 编辑器是单例、只在挂载时创建一次（ADR-03），若把 lineNumbers() 直接写死在
 * buildExtensions 里，切换设置只能靠 `setState` 重建整棵 state —— 那会丢撤销栈、
 * 也会让光标跳回文首。这里验证走 Compartment 动态重配置的路径。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import type { EditorView } from '@codemirror/view';
import { CodeMirrorEditor } from '../CodeMirrorEditor';
import { useSettings } from '../../../stores/settings';

function renderEditor() {
  const ref = createRef<EditorView>() as { current: EditorView | null };
  const utils = render(
    <CodeMirrorEditor
      docId="doc-line-numbers"
      content={'# 标题\n\n正文一行\n正文两行'}
      onChange={() => {}}
      editorRef={ref as never}
    />
  );
  return { ...utils, ref };
}

const gutterCount = (root: HTMLElement) => root.querySelectorAll('.cm-gutters').length;
const lineNumberCount = (root: HTMLElement) => root.querySelectorAll('.cm-lineNumbers').length;

describe('编辑器行号', () => {
  beforeEach(() => {
    localStorage.clear();
    // 每个用例从「显示行号」的默认态开始
    useSettings.setState({ showLineNumbers: true });
  });

  afterEach(cleanup);

  it('L-01 默认设置下显示行号（老用户观感不变）', () => {
    expect(useSettings.getState().showLineNumbers).toBe(true);

    const { container } = renderEditor();
    expect(gutterCount(container)).toBe(1);
    expect(lineNumberCount(container)).toBe(1);
  });

  it('L-02 关闭设置后旧视图上的行号 gutter 立即移除，且不需要重建编辑器', () => {
    const { container, ref } = renderEditor();
    const view = ref.current!;
    expect(gutterCount(container)).toBe(1);

    act(() => useSettings.getState().setShowLineNumbers(false));

    expect(useSettings.getState().showLineNumbers).toBe(false);
    expect(gutterCount(container)).toBe(0);
    expect(lineNumberCount(container)).toBe(0);
    // 同一个视图实例：没有重建 state（撤销栈与光标都不受影响）
    expect(ref.current).toBe(view);
    expect(view.state.doc.toString()).toContain('正文两行');
  });

  it('L-03 重新打开设置后行号恢复', () => {
    const { container } = renderEditor();
    act(() => useSettings.getState().setShowLineNumbers(false));
    expect(gutterCount(container)).toBe(0);

    act(() => useSettings.getState().setShowLineNumbers(true));
    expect(gutterCount(container)).toBe(1);
    expect(lineNumberCount(container)).toBe(1);
    // 行号列渲染的是真实行号文本
    expect(container.querySelector('.cm-lineNumbers')?.textContent).toContain('1');
  });
});
