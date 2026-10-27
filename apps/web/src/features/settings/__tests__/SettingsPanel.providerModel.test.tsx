/**
 * SettingsPanel 的「供应商 → 模型选择」匹配测试（UI 层，jsdom + RTL）。
 *
 * 真实渲染 SettingsPanel，模拟在「提供商」下拉切换各 provider，
 * 断言「模型」下拉项与 models.ts 中的预定义兜底列表一一对应；
 * 并验证 Ollama 走独立 store、custom 无预定义列表时退化为文本输入。
 *
 * 依赖（网络/平台/重型）全部 mock；models.ts 的兜底逻辑为真实代码路径。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

/* ───────────── 外部依赖 mock ───────────── */

const ollamaState = vi.hoisted(() => ({
  status: 'unknown' as const,
  baseUrl: 'http://localhost:11434',
  models: ['qwen2.5', 'llama3'],
  error: undefined as string | undefined,
  check: vi.fn(),
}));

vi.mock('@md-studio/core', () => ({
  CUSTOM_THEME_TOKENS: [{ key: '--accent', label: 'Accent', kind: 'color', placeholder: '' }],
  getThemeVariables: () => ({}),
  sanitizeCustomVars: (v: Record<string, string>) => v,
  // models.ts 仅用到 baseUrl / kind；此处返回通用值即可（fetch 已被 stub 拒绝）
  resolveProvider: () => ({ baseUrl: '', needsKey: false, kind: 'openai' as const }),
}));

vi.mock('../../../stores/ollama', () => ({
  useOllama: (sel: (s: typeof ollamaState) => unknown) => sel(ollamaState),
}));
vi.mock('../../../stores/recipes', () => ({ useRecipes: () => ({ recipes: [] }) }));
vi.mock('../../../stores/document', () => ({ useDocuments: () => ({ activeId: null, docs: {} }) }));
vi.mock('../../../i18n', () => ({
  t: (_l: string, key: string) => key,
  LOCALES: [
    { id: 'zh-CN', label: '中文' },
    { id: 'en', label: 'English' },
    { id: 'ja', label: '日本語' },
  ],
}));
vi.mock('../../../components/Icon', async () => {
  const { jsx } = await import('react/jsx-runtime');
  return { Icon: (props: { name: string }) => jsx('span', { 'data-icon': props.name }) };
});
vi.mock('../McpDesktopSection', () => ({ McpDesktopSection: () => null }));
vi.mock('../../../platform/recipes/runner', () => ({ runMatchedRecipes: vi.fn(() => 0) }));
vi.mock('../../../stores/toast', () => ({ toast: vi.fn() }));
vi.mock('../../../platform/spell/personalDict', () => ({
  clearAffText: vi.fn(),
  importAffText: vi.fn(() => 0),
  importWordListText: vi.fn(() => 0),
  loadedAffRuleCount: vi.fn(() => 0),
  loadPersonalDict: vi.fn(() => []),
}));

/* ───────────── 被测组件 + 真实 store ───────────── */

import { SettingsPanel } from '../SettingsPanel';
import { useSettings } from '../../../stores/settings';
import { useModels } from '../../../stores/models';

/* ───────────── 各 provider 期望的预定义模型列表（与 models.ts 对齐） ───────────── */

const EXPECTED: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1-mini', 'gpt-4.5'],
  claude: [
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-sonnet-4-20250514',
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
    'claude-3-opus-latest',
    'claude-3-sonnet-latest',
    'claude-3-haiku-latest',
  ],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v3', 'deepseek-coder'],
  qwen: [
    'qwen3-32b',
    'qwen3-14b',
    'qwen3-7b',
    'qwen3-4b',
    'qwen3-1.5b',
    'qwen2.5-72b-instruct',
    'qwen2.5-32b-instruct',
    'qwen2.5-14b-instruct',
    'qwen2.5-7b-instruct',
    'qwen2.5-coder-32b-instruct',
    'qwen2.5-coder-7b-instruct',
    'qwen2.5-math-72b',
    'qwq-32b-preview',
    'qwen2-72b-instruct',
    'qwen2-7b-instruct',
  ],
  glm: [
    'glm-5.3',
    'glm-5',
    'glm-5-turbo',
    'glm-5.1',
    'glm-4.7',
    'glm-4.6',
    'glm-4-plus',
    'glm-4-airx',
    'glm-4-air',
    'glm-4-flash',
    'glm-4-long',
    'glm-4v',
    'glm-4-0520',
  ],
  kimi: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k3', 'kimi-k2.5', 'kimi-k2'],
  doubao: [
    'doubao-pro-32k',
    'doubao-pro-32k-241215',
    'doubao-pro-128k',
    'doubao-pro-256k',
    'doubao-lite-32k',
    'doubao-lite-128k',
    'doubao-vision-pro-32k',
    'doubao-vision-lite-32k',
    'doubao-seed-2.1-pro',
    'doubao-seed-2.1-turbo',
    'doubao-seed-2.0-pro',
    'doubao-seed-2.0-lite',
    'doubao-seed-2.0-mini',
  ],
  // ollama 走独立 store（见 ollamaState.models）
  // custom 无预定义列表 → 退化为文本输入
};

/* ───────────── 辅助：定位「提供商 / 模型」字段的下拉/输入 ───────────── */

/**
 * 设置面板改为「左侧目录 + 右侧单分区」布局，AI/Agent 分区默认不渲染，
 * 因此先切到该分区再取字段。
 * i18n 在本测试中被 mock 成「原样返回 key」，故按钮文案为 settingsNavAgent。
 */
async function gotoAgentSection(container: HTMLElement) {
  const navBtn = [...container.querySelectorAll('.settings-nav-item')].find((b) =>
    b.textContent?.includes('settingsNavAgent')
  );
  expect(navBtn).toBeTruthy();
  await act(async () => {
    fireEvent.click(navBtn as HTMLElement);
  });
}

function fieldSelect(container: HTMLElement, label: string): HTMLSelectElement | null {
  const field = [...container.querySelectorAll('.ui-field')].find((f) =>
    f.textContent?.includes(label)
  );
  return (field?.querySelector('select') as HTMLSelectElement) ?? null;
}

function fieldInput(container: HTMLElement, label: string): HTMLInputElement | null {
  const field = [...container.querySelectorAll('.ui-field')].find((f) =>
    f.textContent?.includes(label)
  );
  return (field?.querySelector('input') as HTMLInputElement) ?? null;
}

const optionsOf = (sel: HTMLSelectElement) =>
  Array.from(sel.options).map((o) => o.value);

/* ───────────── 用例 ───────────── */

describe('SettingsPanel 供应商 → 模型选择匹配', () => {
  beforeEach(() => {
    // 网络 fetch 一律拒绝，使 models.ts 走「预定义兜底」分支（与生产离线行为一致）
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no-network')));
    ollamaState.models = ['qwen2.5', 'llama3'];
    ollamaState.status = 'unknown';
    ollamaState.check = vi.fn();
    useModels.setState({ models: [], loading: false, error: undefined });
    useSettings.setState({
      agent: {
        provider: 'ollama',
        apiKey: '',
        model: '',
        allowWrite: false,
        useRemoteEmbed: false,
        embedModel: '',
        embedBaseUrl: '',
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('UI-01 默认（Ollama）显示 Ollama store 中的模型列表', async () => {
    const { container } = render(<SettingsPanel />);
    await gotoAgentSection(container);
    const sel = await waitFor(() => {
      const s = fieldSelect(container, 'agentModel');
      expect(s).not.toBeNull();
      return s as HTMLSelectElement;
    });
    expect(optionsOf(sel!)).toEqual(['qwen2.5', 'llama3']);
  });

  it.each(Object.keys(EXPECTED))('UI-02 %s 切换后模型下拉匹配预定义列表', async (provider) => {
    const { container } = render(<SettingsPanel />);
    await gotoAgentSection(container);
    const providerSel = fieldSelect(container, 'agentProvider')!;
    expect(providerSel).not.toBeNull();

    await act(async () => {
      fireEvent.change(providerSel, { target: { value: provider } });
    });

    const sel = await waitFor(() => {
      const s = fieldSelect(container, 'agentModel');
      expect(s).not.toBeNull();
      return s as HTMLSelectElement;
    });
    expect(optionsOf(sel!)).toEqual(EXPECTED[provider]);
  });

  it('UI-03 custom 无预定义列表时退化为模型名文本输入', async () => {
    const { container } = render(<SettingsPanel />);
    await gotoAgentSection(container);
    const providerSel = fieldSelect(container, 'agentProvider')!;
    await act(async () => {
      fireEvent.change(providerSel, { target: { value: 'custom' } });
    });
    // 下拉消失，出现文本输入框
    await waitFor(() => expect(fieldSelect(container, 'agentModel')).toBeNull());
    expect(fieldInput(container, 'agentModel')).not.toBeNull();
  });

  it('UI-04 从 custom 切回 openai 后恢复模型下拉', async () => {
    const { container } = render(<SettingsPanel />);
    await gotoAgentSection(container);
    const providerSel = fieldSelect(container, 'agentProvider')!;
    await act(async () => {
      fireEvent.change(providerSel, { target: { value: 'custom' } });
    });
    await waitFor(() => expect(fieldSelect(container, 'agentModel')).toBeNull());

    await act(async () => {
      fireEvent.change(providerSel, { target: { value: 'openai' } });
    });
    const sel = await waitFor(() => {
      const s = fieldSelect(container, 'agentModel');
      expect(s).not.toBeNull();
      return s as HTMLSelectElement;
    });
    expect(optionsOf(sel!)).toEqual(EXPECTED.openai);
  });

  it('UI-05 切换供应商会清空上一家的模型选择（避免串台）', async () => {
    const { container } = render(<SettingsPanel />);
    await gotoAgentSection(container);
    const providerSel = fieldSelect(container, 'agentProvider')!;

    // 先选 deepseek，等待模型加载
    await act(async () => {
      fireEvent.change(providerSel, { target: { value: 'deepseek' } });
    });
    await waitFor(() => {
      const s = fieldSelect(container, 'agentModel');
      expect(optionsOf(s!)).toEqual(EXPECTED.deepseek);
    });

    // 再切到 glm：下拉项应整体替换为 glm 列表，而非在 deepseek 列表中追加
    await act(async () => {
      fireEvent.change(providerSel, { target: { value: 'glm' } });
    });
    const sel = await waitFor(() => {
      const s = fieldSelect(container, 'agentModel');
      expect(optionsOf(s!)).toEqual(EXPECTED.glm);
      return s as HTMLSelectElement;
    });
    expect(optionsOf(sel!).length).toBe(EXPECTED.glm.length);
    expect(optionsOf(sel!)).not.toContain('deepseek-flash');
  });

  it('UI-06 左侧目录切换分区：默认中文排版，切到 AI 后再切回', async () => {
    const { container } = render(<SettingsPanel />);

    // 默认显示中文排版分区
    expect(container.querySelector('.settings-content-title')?.textContent).toContain(
      'typography'
    );
    // 未选中分区不渲染（AI 字段此时不在 DOM 中）
    expect(fieldSelect(container, 'agentProvider')).toBeNull();

    // 切到 AI 分区
    await gotoAgentSection(container);
    expect(container.querySelector('.settings-content-title')?.textContent).toContain(
      'settingsNavAgent'
    );
    await waitFor(() => expect(fieldSelect(container, 'agentProvider')).not.toBeNull());

    // 切回中文排版
    const typoBtn = [...container.querySelectorAll('.settings-nav-item')].find((b) =>
      b.textContent?.includes('settingsNavTypography')
    );
    await act(async () => {
      fireEvent.click(typoBtn as HTMLElement);
    });
    expect(container.querySelector('.settings-content-title')?.textContent).toContain(
      'typography'
    );
    expect(fieldSelect(container, 'agentProvider')).toBeNull();
  });
});
