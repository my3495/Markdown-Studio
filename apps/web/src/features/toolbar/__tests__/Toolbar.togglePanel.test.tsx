/**
 * Toolbar 显隐按钮测试（左侧栏折叠 + 右侧 Agent 栏 + 左侧 Agent 会话栏）。
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  const ResizeObserverStub = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

const uiState: {
  sideCollapsed: boolean;
  agentOpen: boolean;
  agentSidebarOpen: boolean;
  sideOpen: boolean;
  toggleSideCollapsed: ReturnType<typeof vi.fn>;
  toggleSide: ReturnType<typeof vi.fn>;
  toggleAgent: ReturnType<typeof vi.fn>;
  toggleAgentSidebar: ReturnType<typeof vi.fn>;
  togglePalette: ReturnType<typeof vi.fn>;
  openPalette: ReturnType<typeof vi.fn>;
  setAgentOpen: ReturnType<typeof vi.fn>;
  setAgentSidebarOpen: ReturnType<typeof vi.fn>;
  openPanel: ReturnType<typeof vi.fn>;
  activePanel: string | null;
  panelTabs: string[];
} = {
  sideCollapsed: false,
  agentOpen: true,
  agentSidebarOpen: true,
  sideOpen: false,
  toggleSideCollapsed: vi.fn(),
  toggleSide: vi.fn(),
  toggleAgent: vi.fn(),
  toggleAgentSidebar: vi.fn(),
  togglePalette: vi.fn(),
  openPalette: vi.fn(),
  setAgentOpen: vi.fn(),
  setAgentSidebarOpen: vi.fn(),
  openPanel: vi.fn(),
  activePanel: null,
  panelTabs: [],
};

vi.mock('../../../stores/ui', () => ({
  useUi: (sel?: (s: typeof uiState) => unknown) => (sel ? sel(uiState) : uiState),
  useUi_sel: () => uiState,
}));

const settingsState = {
  locale: 'zh-CN',
  mobileView: 'split',
  focusMode: false,
  readingMode: false,
  typography: { spacing: true, numberSpacing: true, punctuation: true, ellipsis: true, quotes: true },
  autoNumber: false,
  tocPlaceholder: { maxDepth: 3 },
  typewriterMode: false,
  theme: 'system',
  width: 'medium',
  footer: { enabled: true },
  setMobileView: vi.fn(),
  toggleFocus: vi.fn(),
  toggleReadingMode: vi.fn(),
  toggleTypewriter: vi.fn(),
  setTypography: vi.fn(),
  setAutoNumber: vi.fn(),
  setTocPlaceholder: vi.fn(),
  setTheme: vi.fn(),
  setWidth: vi.fn(),
  setFooter: vi.fn(),
  setAgent: vi.fn(),
  agent: { provider: 'openai', apiKey: 'k', model: 'm', allowWrite: false, useRemoteEmbed: false, embedModel: '', embedBaseUrl: '' },
};
vi.mock('../../../stores/settings', () => ({
  useSettings: (sel?: (s: typeof settingsState) => unknown) =>
    sel ? sel(settingsState) : settingsState,
}));

const docsState = { activeId: null, docs: {}, order: [] };
vi.mock('../../../stores/document', () => ({
  useDocuments: (sel?: (s: typeof docsState) => unknown) =>
    sel ? sel(docsState) : docsState,
}));

const vaultState = { vault: null, persisted: false, openFolder: vi.fn(), createNote: vi.fn() };
vi.mock('../../../stores/vault', () => ({
  useVault: (sel?: (s: typeof vaultState) => unknown) =>
    sel ? sel(vaultState) : vaultState,
}));

vi.mock('../../../stores/recipes', () => ({
  useRecipes: () => ({ recipes: [], pendingPrompt: null, setPendingPrompt: vi.fn() }),
}));

vi.mock('../../../components/Icon', async () => {
  const { jsx } = await import('react/jsx-runtime');
  return {
    Icon: (props: { name: string; size?: number }) =>
      jsx('span', { 'data-icon': props.name, 'data-size': props.size }),
  };
});

import { Toolbar } from '../Toolbar';

/**
 * jsdom 默认 innerWidth=1024，会命中 `(max-width: 1024px)`；
 * 这里显式控制两个测试分支（窄屏切抽屉 / 宽屏折叠侧栏）。
 */
function setNarrowViewport(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: narrow && query.includes('max-width: 1024px'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  setNarrowViewport(false);
  uiState.sideCollapsed = false;
  uiState.agentOpen = true;
  uiState.agentSidebarOpen = true;
  uiState.sideOpen = false;
  uiState.toggleSideCollapsed.mockClear();
  uiState.toggleAgent.mockClear();
  uiState.toggleAgentSidebar.mockClear();
  cleanup();
});

describe('Toolbar 左/右栏显隐按钮', () => {
  it('侧栏按钮：未折叠时 aria-pressed=true', () => {
    uiState.sideCollapsed = false;
    const { container } = render(
      <Toolbar
        editorView={null}
        onSlides={vi.fn()}
        onOpenFolder={vi.fn()}
        folderActive={false}
      />
    );
    const btn = container.querySelector('.tb-sidetoggle');
    expect(btn).toBeTruthy();
    expect(btn?.getAttribute('aria-label')).toBe('显示/隐藏侧栏');
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('侧栏按钮：折叠时 aria-pressed=false', () => {
    uiState.sideCollapsed = true;
    const { container } = render(
      <Toolbar
        editorView={null}
        onSlides={vi.fn()}
        onOpenFolder={vi.fn()}
        folderActive={false}
      />
    );
    const btn = container.querySelector('.tb-sidetoggle');
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
  });

  it('宽屏点击侧栏按钮调用 toggleSideCollapsed', () => {
    setNarrowViewport(false);
    const { container } = render(
      <Toolbar
        editorView={null}
        onSlides={vi.fn()}
        onOpenFolder={vi.fn()}
        folderActive={false}
      />
    );
    const btn = container.querySelector('.tb-sidetoggle') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(uiState.toggleSideCollapsed).toHaveBeenCalledTimes(1);
    expect(uiState.toggleSide).not.toHaveBeenCalled();
  });

  it('窄屏点击侧栏按钮改为切抽屉（toggleSide）', () => {
    setNarrowViewport(true);
    const { container } = render(
      <Toolbar
        editorView={null}
        onSlides={vi.fn()}
        onOpenFolder={vi.fn()}
        folderActive={false}
      />
    );
    const btn = container.querySelector('.tb-sidetoggle') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(uiState.toggleSide).toHaveBeenCalledTimes(1);
    expect(uiState.toggleSideCollapsed).not.toHaveBeenCalled();
  });

  it('右栏按钮：agentOpen=true 时显示 panel-right-close + aria-pressed=true', () => {
    uiState.agentOpen = true;
    const { container } = render(
      <Toolbar
        editorView={null}
        onSlides={vi.fn()}
        onOpenFolder={vi.fn()}
        folderActive={false}
      />
    );
    const rightBtn = container.querySelector('.tb-panel-toggle-right');
    expect(rightBtn).toBeTruthy();
    expect(rightBtn?.getAttribute('aria-label')).toBe('显示/隐藏右侧栏（Agent）');
    expect(rightBtn?.getAttribute('aria-pressed')).toBe('true');
    const rightIcon = container.querySelector(
      '.tb-panel-toggle-right span[data-icon="panelRightClose"]'
    );
    expect(rightIcon).toBeTruthy();
  });

  it('右栏按钮：agentOpen=false 时显示 panel-right-open + aria-pressed=false', () => {
    uiState.agentOpen = false;
    const { container } = render(
      <Toolbar
        editorView={null}
        onSlides={vi.fn()}
        onOpenFolder={vi.fn()}
        folderActive={false}
      />
    );
    const rightBtn = container.querySelector('.tb-panel-toggle-right');
    expect(rightBtn?.getAttribute('aria-pressed')).toBe('false');
    const rightIcon = container.querySelector(
      '.tb-panel-toggle-right span[data-icon="panelRightOpen"]'
    );
    expect(rightIcon).toBeTruthy();
  });

  it('点击右栏按钮调用 toggleAgent', () => {
    const { container } = render(
      <Toolbar
        editorView={null}
        onSlides={vi.fn()}
        onOpenFolder={vi.fn()}
        folderActive={false}
      />
    );
    const rightBtn = container.querySelector(
      '.tb-panel-toggle-right'
    ) as HTMLButtonElement;
    fireEvent.click(rightBtn);
    expect(uiState.toggleAgent).toHaveBeenCalledTimes(1);
  });
});
