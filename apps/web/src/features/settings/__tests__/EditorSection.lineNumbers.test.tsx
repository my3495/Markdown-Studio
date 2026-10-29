/**
 * 设置 → 编辑器：「显示行号」开关。
 *
 * 开关本身只是写入 store，真正的显隐由 CodeMirrorEditor 的 Compartment 完成
 * （见 features/editor/__tests__/CodeMirrorEditor.lineNumbers.test.tsx）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorSection } from '../SettingsSections';
import { useSettings } from '../../../stores/settings';

describe('设置 → 编辑器：显示行号', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettings.setState({ showLineNumbers: true, locale: 'zh-CN' });
  });

  afterEach(cleanup);

  it('S-L01 开关默认开启，并有可读的无障碍名称', () => {
    render(<EditorSection />);
    const sw = screen.getByRole('switch', { name: '显示行号' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('S-L02 点击关闭写入 store，再点恢复', () => {
    render(<EditorSection />);
    const sw = screen.getByRole('switch', { name: '显示行号' });

    fireEvent.click(sw);
    expect(useSettings.getState().showLineNumbers).toBe(false);
    expect(screen.getByRole('switch', { name: '显示行号' }).getAttribute('aria-checked')).toBe(
      'false'
    );

    fireEvent.click(screen.getByRole('switch', { name: '显示行号' }));
    expect(useSettings.getState().showLineNumbers).toBe(true);
  });

  it('S-L03 设置会持久化（刷新后保持关闭）', async () => {
    render(<EditorSection />);
    fireEvent.click(screen.getByRole('switch', { name: '显示行号' }));
    expect(useSettings.getState().showLineNumbers).toBe(false);

    // 持久化订阅是 100ms 防抖：等它落盘后检查快照
    await new Promise((resolve) => setTimeout(resolve, 200));
    const raw = localStorage.getItem('md-studio:settings');
    expect(raw && JSON.parse(raw).showLineNumbers).toBe(false);
  });
});
