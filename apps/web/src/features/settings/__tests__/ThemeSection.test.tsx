import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeSection } from '../SettingsSections';
import { useSettings } from '../../../stores/settings';
import { FONT_FAMILY_PRESETS } from '@md-studio/core';

/** 每个用例都从「跟随系统 + 无自定义 + 中文」的干净状态开始 */
function resetState() {
  localStorage.clear();
  useSettings.setState({ theme: 'system', customVars: {}, locale: 'zh-CN' });
}

const vars = () => useSettings.getState().customVars;

describe('主题与配色分区', () => {
  beforeEach(resetState);
  afterEach(cleanup);

  it('T-01 渲染全部令牌：4 个颜色、字体下拉、4 个数值、重置按钮', () => {
    const { container } = render(<ThemeSection />);
    expect(container.querySelectorAll('input[type="color"]').length).toBe(4);
    expect(container.querySelectorAll('select.ui-select-font').length).toBe(1);
    // 4 个数值输入；字体自定义输入框只在「自定义…」后才出现
    expect(container.querySelectorAll('input[type="text"]').length).toBe(4);
    expect(container.querySelectorAll('.ui-field').length).toBe(9);
    expect(screen.getByRole('button', { name: '重置主题令牌' })).toBeTruthy();
  });

  it('T-02 未自定义时色板展示当前主题真实默认色；切到深色后跟着变', () => {
    render(<ThemeSection />);
    const accent = screen.getByLabelText('强调色') as HTMLInputElement;
    expect(accent.value).toBe('#a9501d');

    // 深色模式入口在工具栏，这里直接改 store 验证令牌联动
    act(() => useSettings.setState({ theme: 'dark' }));
    expect((screen.getByLabelText('强调色') as HTMLInputElement).value).toBe('#df8a4e');
    expect((screen.getByLabelText('背景色') as HTMLInputElement).value).toBe('#1a1815');
  });

  it('T-03 选色写入 customVars，重复选色不会丢键', () => {
    render(<ThemeSection />);
    const accent = screen.getByLabelText('强调色') as HTMLInputElement;
    fireEvent.change(accent, { target: { value: '#1f6feb' } });
    expect(vars()['--md-color-accent']).toBe('#1f6feb');

    const bg = screen.getByLabelText('背景色') as HTMLInputElement;
    fireEvent.change(bg, { target: { value: '#fffdf7' } });
    expect(vars()['--md-color-accent']).toBe('#1f6feb');
    expect(vars()['--md-color-bg']).toBe('#fffdf7');
  });

  it('T-04 数值输入写入并用空值恢复默认（不残留空串）', () => {
    render(<ThemeSection />);
    const fontSize = screen.getByLabelText('字号') as HTMLInputElement;
    fireEvent.change(fontSize, { target: { value: '18px' } });
    expect(vars()['--md-font-size']).toBe('18px');

    fireEvent.change(fontSize, { target: { value: '' } });
    expect(vars()['--md-font-size']).toBeUndefined();
    expect(Object.keys(vars())).toHaveLength(0);
  });

  it('T-05 字体下拉：选预设写入，切默认删除，自定义值保留原文', () => {
    const { container } = render(<ThemeSection />);
    const select = container.querySelector('select.ui-select-font') as HTMLSelectElement;
    const preset = FONT_FAMILY_PRESETS[8];

    fireEvent.change(select, { target: { value: preset } });
    expect(vars()['--md-font-family']).toBe(preset);

    fireEvent.change(select, { target: { value: '__custom__' } });
    expect(vars()['--md-font-family']).toBeUndefined();
    const custom = container.querySelector('.ui-input-font-custom') as HTMLInputElement;
    expect(custom).toBeTruthy();
    fireEvent.change(custom, { target: { value: 'PingFang SC' } });
    expect(vars()['--md-font-family']).toBe('PingFang SC');

    fireEvent.change(select, { target: { value: '' } });
    expect(vars()['--md-font-family']).toBeUndefined();
  });

  it('T-06 自定义字体没填就失焦：退出自定义模式，不留空输入框', () => {
    const { container } = render(<ThemeSection />);
    const select = container.querySelector('select.ui-select-font') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__custom__' } });
    const custom = container.querySelector('.ui-input-font-custom') as HTMLInputElement;
    expect(custom).toBeTruthy();

    fireEvent.blur(custom);
    expect(container.querySelector('.ui-input-font-custom')).toBeNull();
    expect((container.querySelector('select.ui-select-font') as HTMLSelectElement).value).toBe('');
  });

  it('T-07 重置按钮清空全部自定义令牌', () => {
    useSettings.setState({
      customVars: { '--md-color-accent': '#1f6feb', '--md-radius': '4px' },
    });
    render(<ThemeSection />);
    fireEvent.click(screen.getByRole('button', { name: '重置主题令牌' }));
    expect(vars()).toEqual({});
  });

  it('T-08 每个控件都有可读的无障碍名称（不是内部变量名）', () => {
    render(<ThemeSection />);
    for (const label of ['强调色', '正文色', '背景色', '次要文字']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    for (const label of ['字号', '行高', '内容宽度', '圆角']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect((screen.getByLabelText('强调色') as HTMLInputElement).title).toBe('强调色');
  });
});
