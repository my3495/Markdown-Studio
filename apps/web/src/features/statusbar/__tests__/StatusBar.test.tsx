/**
 * StatusBar 组件测试：三区信息、保存态、路径、告警、光标选区、连接状态、详情弹层。
 * stores 与平台 API 全部 mock，不依赖真实编辑器/网络。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';

const ui = vi.hoisted(() => ({
  settings: {
    locale: 'zh-CN',
    focusMode: false,
    typewriterMode: false,
    autoNumber: false as false | string,
    mobileView: 'split' as 'edit' | 'preview' | 'split',
    agent: { provider: 'ollama', model: 'qwen2.5:1.5b' },
  },
  docs: {
    activeId: null as string | null,
    docs: {} as Record<string, unknown>,
  },
  ollama: { status: 'online' as string },
  openPanel: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../../stores/settings', () => ({
  useSettings: (sel?: (s: typeof ui.settings) => unknown) =>
    sel ? sel(ui.settings) : ui.settings,
}));
vi.mock('../../../stores/document', () => ({
  useDocuments: (sel?: (s: typeof ui.docs) => unknown) => (sel ? sel(ui.docs) : ui.docs),
}));
vi.mock('../../../stores/ollama', () => ({
  useOllama: (sel?: (s: typeof ui.ollama) => unknown) => (sel ? sel(ui.ollama) : ui.ollama),
}));
vi.mock('../../../stores/ui', () => ({
  useUi: Object.assign(() => ({}), { getState: () => ({ openPanel: ui.openPanel }) }),
}));
vi.mock('../../../stores/toast', () => ({ toast: ui.toast }));
vi.mock('../../../platform/shortcut/registry', () => ({ shortcutLabel: () => 'Ctrl+S' }));

import { StatusBar } from '../StatusBar';

const doc = (patch: Record<string, unknown> = {}) => ({
  id: 'd1',
  name: '使用指南.md',
  path: 'D:/笔记/写作/使用指南.md',
  content: '# 标题\n正文若干字符。',
  words: 1284,
  dirty: false,
  warnings: [] as unknown[],
  ...patch,
});

const setDoc = (patch: Record<string, unknown> | null) => {
  if (!patch) {
    ui.docs.activeId = null;
    ui.docs.docs = {};
    return;
  }
  ui.docs.activeId = 'd1';
  ui.docs.docs = { d1: doc(patch) };
};

beforeEach(() => {
  ui.settings.focusMode = false;
  ui.settings.typewriterMode = false;
  ui.settings.autoNumber = false;
  ui.settings.mobileView = 'split';
  ui.settings.agent = { provider: 'ollama', model: 'qwen2.5:1.5b' };
  ui.ollama.status = 'online';
  ui.openPanel.mockReset();
  ui.toast.mockReset();
  setDoc(null);
});

afterEach(cleanup);

describe('StatusBar 三区渲染', () => {
  it('S-01 无文档：左区提示未打开文档，不渲染字数与光标', () => {
    const { container } = render(<StatusBar editorView={null} />);
    expect(container.querySelector('.sb-left')?.textContent).toContain('未打开文档');
    expect(container.querySelector('.sb-words')).toBeNull();
  });

  it('S-02 已保存且有路径：显示文件名、路径、已保存，保存按钮禁用', () => {
    setDoc({});
    const { container } = render(<StatusBar editorView={null} onSave={vi.fn()} />);
    expect(screen.getByText('使用指南.md')).toBeTruthy();
    expect(container.querySelector('.sb-path')?.textContent).toContain('使用指南.md');
    const save = container.querySelector('.sb-save') as HTMLButtonElement;
    expect(save.textContent).toContain('已保存');
    expect(save.disabled).toBe(true);
  });

  it('S-03 未保存：显示未保存并把点击转给 onSave', () => {
    setDoc({ dirty: true });
    const onSave = vi.fn();
    const { container } = render(<StatusBar editorView={null} onSave={onSave} />);
    const save = container.querySelector('.sb-save') as HTMLButtonElement;
    expect(save.textContent).toContain('未保存');
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('S-04 未落盘：path 为空时显示未保存到磁盘', () => {
    setDoc({ path: null });
    const { container } = render(<StatusBar editorView={null} />);
    expect(container.querySelector('.sb-path')?.textContent).toBe('未保存到磁盘');
  });

  it('S-04b 路径与文件名相同（Web 本地存储）时不重复渲染', () => {
    setDoc({ path: '使用指南.md' });
    const { container } = render(<StatusBar editorView={null} />);
    expect(container.querySelector('.sb-path')).toBeNull();
    expect(container.querySelectorAll('.sb-left .sb-item').length).toBe(2);
  });

  it('S-05 排版告警：显示数量，点击打开设置面板', () => {
    setDoc({ warnings: [{}, {}] });
    const { container } = render(<StatusBar editorView={null} />);
    const warn = container.querySelector('.sb-warn') as HTMLButtonElement;
    expect(warn.textContent).toContain('2');
    fireEvent.click(warn);
    expect(ui.openPanel).toHaveBeenCalledWith('settings');
  });

  it('S-06 字数与视图模式按当前设置渲染', () => {
    setDoc({ words: 1284 });
    ui.settings.mobileView = 'split';
    const { container } = render(<StatusBar editorView={null} />);
    expect(container.querySelector('.sb-words')?.textContent).toContain('1,284');
    expect(container.querySelector('.sb-item.sb-optional')?.textContent).toBe('分栏');
  });

  it('S-07 光标与选区：按编辑器 selection 计算行列与选区长度', () => {
    setDoc({});
    const view = {
      state: {
        selection: { main: { head: 10, to: 12, from: 8 } },
        doc: { lineAt: () => ({ number: 3, from: 5 }) },
      },
      dom: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      hasFocus: true,
    } as unknown as EditorView;
    const { container } = render(<StatusBar editorView={view} />);
    const text = container.querySelector('.sb-right')?.textContent ?? '';
    expect(text).toContain('3:6');
    expect(text).toContain('选区 4');
  });

  it('S-08 连接状态：Ollama 在线时显示已连接与 ok 状态点', () => {
    setDoc({});
    const { container } = render(<StatusBar editorView={null} />);
    const conn = container.querySelector('.sb-conn');
    expect(conn?.textContent).toContain('Ollama 已连接');
    expect(conn?.querySelector('.sb-dot')?.className).toContain('ok');
  });

  it('S-09 离线状态：显示未连接与 offline 状态点', () => {
    setDoc({});
    ui.ollama.status = 'offline';
    const { container } = render(<StatusBar editorView={null} />);
    expect(container.querySelector('.sb-conn')?.textContent).toContain('Ollama 未连接');
    expect(container.querySelector('.sb-conn .sb-dot')?.className).toContain('offline');
  });

  it('S-10 字数详情：点击展开弹层，包含字符数与选区', () => {
    setDoc({});
    const { container } = render(<StatusBar editorView={null} />);
    expect(container.querySelector('.sb-pop')).toBeNull();
    fireEvent.click(container.querySelector('.sb-words') as HTMLElement);
    const pop = container.querySelector('.sb-pop');
    expect(pop).toBeTruthy();
    expect(pop?.textContent).toContain('字符');
    expect(pop?.textContent).toContain('选区');
  });

  it('S-11 专注模式：中区模式胶囊渲染在 bar 内（非悬浮）', () => {
    setDoc({});
    ui.settings.focusMode = true;
    ui.settings.typewriterMode = true;
    ui.settings.autoNumber = 'arabic';
    const { container } = render(<StatusBar editorView={null} />);
    const chips = container.querySelectorAll('.sb-mid .sb-chip');
    expect(chips.length).toBe(3);
    expect(container.querySelector('.statusbar')).toBeTruthy();
  });

  it('S-12 无 onSave 时保存按钮不可点（避免误触）', () => {
    setDoc({ dirty: true });
    const { container } = render(<StatusBar editorView={null} />);
    expect((container.querySelector('.sb-save') as HTMLButtonElement).disabled).toBe(true);
  });
});
