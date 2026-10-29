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

  it('T-01 渲染全部区块：主题模式 + 4 个颜色 + 字体下拉 + 4 个数值下拉 + 重置按钮', () => {
    const { container } = render(<ThemeSection />);
    expect(container.querySelectorAll('.theme-mode-item').length).toBe(3);
    expect(container.querySelectorAll('input[type="color"]').length).toBe(4);
    expect(container.querySelectorAll('select.ui-select-font').length).toBe(1);
    // 排版四项改为下拉选择：不再有任何文本框，用户无从手写 CSS 片段
    expect(container.querySelectorAll('input[type="text"]').length).toBe(0);
    expect(container.querySelectorAll('input[type="range"]').length).toBe(0);
    expect(container.querySelectorAll('select.ui-select-token').length).toBe(4);
    expect(container.querySelectorAll('.ui-field').length).toBe(10);
    expect(screen.getByRole('button', { name: '重置主题令牌' })).toBeTruthy();
  });

  it('T-02 未自定义时色板展示当前主题真实默认色；切到深色后跟着变', () => {
    render(<ThemeSection />);
    const accent = screen.getByLabelText('强调色') as HTMLInputElement;
    expect(accent.value).toBe('#a9501d');

    // 主题模式已归位到本分区，点「深色」即可（无需再去工具栏）
    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    expect(useSettings.getState().theme).toBe('dark');
    expect((screen.getByLabelText('强调色') as HTMLInputElement).value).toBe('#df8a4e');
    expect((screen.getByLabelText('背景色') as HTMLInputElement).value).toBe('#1a1815');
  });

  it('T-09 主题模式三分段：切换写入 store，高亮与 aria-pressed 跟随', () => {
    const { container } = render(<ThemeSection />);
    const buttons = [...container.querySelectorAll('.theme-mode-item')];
    expect(buttons.map((b) => b.textContent)).toEqual(['浅色', '深色', '跟随系统']);
    // 初始为 system
    expect(container.querySelector('.theme-mode-item.active')?.textContent).toBe('跟随系统');
    expect(screen.getByRole('button', { name: '跟随系统' }).getAttribute('aria-pressed')).toBe(
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: '浅色' }));
    expect(useSettings.getState().theme).toBe('light');
    expect(container.querySelector('.theme-mode-item.active')?.textContent).toBe('浅色');
    expect(screen.getByRole('button', { name: '浅色' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '跟随系统' }).getAttribute('aria-pressed')).toBe(
      'false'
    );

    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    expect(useSettings.getState().theme).toBe('dark');
    act(() => useSettings.setState({ theme: 'system' }));
    expect(container.querySelector('.theme-mode-item.active')?.textContent).toBe('跟随系统');
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

  it('T-04 下拉选择写入规范值；选「跟随主题」即恢复默认且不残留空串', () => {
    render(<ThemeSection />);
    const fontSize = screen.getByLabelText('字号') as HTMLSelectElement;
    // 首项就是「跟随主题」，并带上主题真实默认值（不是空框 + 灰 placeholder）
    expect(fontSize.value).toBe('');
    expect(fontSize.options[0].textContent).toBe('跟随主题（当前 16px）');

    fireEvent.change(fontSize, { target: { value: '18px' } });
    expect(vars()['--md-font-size']).toBe('18px');

    fireEvent.change(fontSize, { target: { value: '' } });
    expect(vars()['--md-font-size']).toBeUndefined();
    expect(Object.keys(vars())).toHaveLength(0);
  });

  it('T-10 选项只给合法档位：长度项自带 px，行高不带单位', () => {
    render(<ThemeSection />);
    const sizeValues = [...(screen.getByLabelText('字号') as HTMLSelectElement).options]
      .map((o) => o.value)
      .filter(Boolean);
    expect(sizeValues).toContain('16px');
    expect(sizeValues.every((v) => /^\d+px$/.test(v))).toBe(true);

    const widthValues = [...(screen.getByLabelText('内容宽度') as HTMLSelectElement).options]
      .map((o) => o.value)
      .filter(Boolean);
    expect(widthValues).toContain('780px');
    // 越界值（旧版手输能写进去的 2000px）根本不在选项里
    expect(widthValues).not.toContain('2000px');

    const lhValues = [...(screen.getByLabelText('行高') as HTMLSelectElement).options]
      .map((o) => o.value)
      .filter(Boolean);
    expect(lhValues).toContain('1.75');
    expect(lhValues.every((v) => /^\d(\.\d+)?$/.test(v))).toBe(true);
  });

  it('T-11 档位外的历史值作为额外选项显示，下拉不会变空白且可改回档位', () => {
    useSettings.setState({ customVars: { '--md-font-size': '19px' } });
    render(<ThemeSection />);
    const fontSize = screen.getByLabelText('字号') as HTMLSelectElement;
    expect(fontSize.value).toBe('19px');
    expect([...fontSize.options].some((o) => o.value === '19px')).toBe(true);

    fireEvent.change(fontSize, { target: { value: '20px' } });
    expect(vars()['--md-font-size']).toBe('20px');
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
