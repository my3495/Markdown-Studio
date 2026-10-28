import { create } from 'zustand';
import {
  sanitizeCustomVars,
  type NumberStyle,
  type RenderOptions,
  type TocPlaceholderOptions,
  type TypographyOptions,
} from '@md-studio/core';
import type { Locale } from '../i18n';
// Locale 现含 zh-CN | en | ja

export type ThemeMode = 'light' | 'dark' | 'system';
export type WidthMode = 'narrow' | 'medium' | 'wide' | 'full';
/** 主区视图：单栏编辑 / 单栏预览 / 左右分栏 */
export type MobileViewMode = 'edit' | 'preview' | 'split';

/** 视图偏好本地持久化（分栏比例、单栏/分栏选择） */
const VIEW_PREFS_KEY = 'md-studio:view-prefs';
/** 全量设置持久化（主题/语言/排版/Agent 等全部非函数状态） */
const SETTINGS_KEY = 'md-studio:settings';

interface ViewPrefs {
  mobileView?: MobileViewMode;
  splitRatio?: number;
  /** Agent 提供商与模型（持久化，避免刷新后被自动探测回退） */
  agentProvider?: string;
  agentModel?: string;
  /** Agent API Key（BYOK；本地 localStorage 明文保存，便于免重复输入） */
  agentApiKey?: string;
}

function loadViewPrefs(): ViewPrefs {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(VIEW_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      console.warn('[Settings] view-prefs 格式非法，已重置');
      return {};
    }
    return parsed as ViewPrefs;
  } catch (e) {
    console.warn('[Settings] view-prefs 解析失败，已重置', e);
    return {};
  }
}

/** 合并写入（保留未显式传入的既有偏好） */
function saveViewPrefs(patch: ViewPrefs) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify({ ...loadViewPrefs(), ...patch }));
  } catch {
    /* 隐私模式等场景静默忽略 */
  }
}

/** 读取全量持久化设置（新 key；损坏或不存在时返回空对象） */
function loadPersistedSettings(): Partial<PersistedSettings> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      console.warn('[Settings] persisted settings 格式非法，已重置');
      return {};
    }
    return parsed as Partial<PersistedSettings>;
  } catch (e) {
    console.warn('[Settings] persisted settings 解析失败，已重置', e);
    return {};
  }
}

export interface FooterSettings {
  enabled: boolean;
  text?: string;
  link?: string;
}

/** AI / Agent 配置（BYOK，v1 仅本地检索 Agent + 配置脚手架） */
export interface AgentSettings {
  /** 提供商：ollama / openai / claude / deepseek / qwen / glm / kimi / doubao / custom */
  provider: string;
  apiKey: string;
  model: string;
  /** 是否允许 Agent 写库（对齐 SoloMD --allow-write，默认关） */
  allowWrite: boolean;
  /** 启用远程 HttpEmbedder（神经网络级语义检索）；关闭则用离线 HashingEmbedder */
  useRemoteEmbed: boolean;
  /** 嵌入模型名；空则回退到上方 chat model */
  embedModel: string;
  /** 嵌入 API Base URL（可选） */
  embedBaseUrl: string;
}

interface SettingsState {
  theme: ThemeMode;
  width: WidthMode;
  typography: Partial<TypographyOptions>;
  autoNumber: false | NumberStyle;
  /**
   * 正文内目录占位符 `[TOC]`：开启后，正文里的 `[TOC]` 会渲染为可点击的目录。
   * `false` 表示关闭（`[TOC]` 保持为普通文本）。
   */
  tocPlaceholder: false | TocPlaceholderOptions;
  focusMode: boolean;
  typewriterMode: boolean;
  locale: Locale;
  customVars: Record<string, string>;
  footer: FooterSettings;
  agent: AgentSettings;
  /** A2-lite：保存时写入 IndexedDB 历史快照 */
  autoSnapshot: boolean;
  /** G4：主区编辑/预览/分栏切换（全宽度可用） */
  mobileView: MobileViewMode;
  /** 分栏模式下编辑区占比（0.2–0.8），可拖拽调整 */
  splitRatio: number;
  /** B2：Vim 键位 */
  vimMode: boolean;
  /** D3：保存时运行已启用的 on-save recipes */
  recipesOnSave: boolean;
  /** B3：英文拼写检查（轻量词表） */
  spellCheck: boolean;
  /** 代码块语法高亮（Shiki）。关闭后预览区代码块按纯文本渲染（修复 A：
   *  RenderOptions.highlight 此前在 UI 层硬编码为 true，用户无法关闭） */
  codeHighlight: boolean;
  /** B1-lite：阅读态（隐藏源码，近 WYSIWYG 预览） */
  readingMode: boolean;
  /** Agent 主模式：plan=只读（检索增强），build=可调用工具 + 可写 */
  agentMode: 'plan' | 'build';

  setTheme: (t: ThemeMode) => void;
  setWidth: (w: WidthMode) => void;
  setTypography: (key: keyof TypographyOptions, value: boolean) => void;
  setAutoNumber: (v: false | NumberStyle) => void;
  setTocPlaceholder: (v: false | TocPlaceholderOptions) => void;
  toggleFocus: () => void;
  toggleTypewriter: () => void;
  setLocale: (l: Locale) => void;
  setCustomVar: (k: string, v: string) => void;
  clearCustomVars: () => void;
  setFooter: (f: FooterSettings) => void;
  setAgent: (patch: Partial<AgentSettings>) => void;
  setAgentMode: (m: 'plan' | 'build') => void;
  setAutoSnapshot: (v: boolean) => void;
  setMobileView: (v: MobileViewMode) => void;
  setSplitRatio: (r: number) => void;
  setVimMode: (v: boolean) => void;
  setRecipesOnSave: (v: boolean) => void;
  setSpellCheck: (v: boolean) => void;
  setCodeHighlight: (v: boolean) => void;
  setReadingMode: (v: boolean) => void;
  toggleReadingMode: () => void;
}

/** 可持久化的设置（state 中除 action 函数外的全部字段） */
type PersistedSettings = {
  [K in keyof SettingsState as SettingsState[K] extends (...args: never[]) => unknown ? never : K]: SettingsState[K];
};

const viewPrefs = loadViewPrefs();
const persisted = loadPersistedSettings();

export const useSettings = create<SettingsState>((set, get) => ({
  theme: persisted.theme ?? 'system',
  width: persisted.width ?? 'medium',
  typography: { spacing: true, numberSpacing: true, punctuation: true, ellipsis: true, quotes: true, ...persisted.typography },
  autoNumber: persisted.autoNumber ?? false,
  // 正文内目录默认开启：Typora / Obsidian 用户写 `[TOC]` 时期望看到目录
  // title 留空 → 由 getRenderOptions 按界面语言填入（目录/Contents/目次）
  tocPlaceholder: persisted.tocPlaceholder ?? { maxDepth: 3 },
  focusMode: persisted.focusMode ?? false,
  typewriterMode: persisted.typewriterMode ?? false,
  locale: persisted.locale ?? 'zh-CN',
  customVars: persisted.customVars ?? {},
  footer: { enabled: true, ...persisted.footer },
  agent: {
    provider: persisted.agent?.provider ?? viewPrefs.agentProvider ?? 'ollama',
    apiKey: persisted.agent?.apiKey ?? viewPrefs.agentApiKey ?? '',
    model: persisted.agent?.model ?? viewPrefs.agentModel ?? '',
    allowWrite: persisted.agent?.allowWrite ?? false,
    useRemoteEmbed: persisted.agent?.useRemoteEmbed ?? false,
    embedModel: persisted.agent?.embedModel ?? '',
    embedBaseUrl: persisted.agent?.embedBaseUrl ?? '',
  },
  autoSnapshot: persisted.autoSnapshot ?? true,
  mobileView: persisted.mobileView ?? viewPrefs.mobileView ?? 'split',
  splitRatio: persisted.splitRatio ?? viewPrefs.splitRatio ?? 0.5,
  vimMode: persisted.vimMode ?? false,
  recipesOnSave: persisted.recipesOnSave ?? false,
  spellCheck: persisted.spellCheck ?? false,
  codeHighlight: persisted.codeHighlight ?? true,
  readingMode: persisted.readingMode ?? false,
  // 老版本可能持久化了 'agent' mode —— 与 'build' 行为完全一致，归并到 'build'
  agentMode:
    persisted.agentMode === 'plan'
      ? 'plan'
      : persisted.agentMode === 'build'
        ? 'build'
        : 'build',

  setTheme: (theme) => set({ theme }),
  setWidth: (width) => set({ width }),
  setTypography: (key, value) =>
    set((s) => ({ typography: { ...s.typography, [key]: value } })),
  setAutoNumber: (autoNumber) => set({ autoNumber }),
  setTocPlaceholder: (tocPlaceholder) => set({ tocPlaceholder }),
  toggleFocus: () => set((s) => ({ focusMode: !s.focusMode })),
  toggleTypewriter: () => set((s) => ({ typewriterMode: !s.typewriterMode })),
  setLocale: (locale) => set({ locale }),
  setCustomVar: (k, v) =>
    set((s) => ({
      customVars: sanitizeCustomVars({ ...s.customVars, [k]: v }),
    })),
  clearCustomVars: () => set({ customVars: {} }),
  setFooter: (footer) => set({ footer }),
  setAgent: (patch) => {
    set((s) => ({ agent: { ...s.agent, ...patch } }));
    const a = get().agent;
    saveViewPrefs({ agentProvider: a.provider, agentModel: a.model, agentApiKey: a.apiKey });
  },
  setAgentMode: (agentMode) => set({ agentMode }),
  setAutoSnapshot: (autoSnapshot) => set({ autoSnapshot }),
  setMobileView: (mobileView) => {
    set({ mobileView });
    saveViewPrefs({ mobileView, splitRatio: get().splitRatio });
  },
  setSplitRatio: (splitRatio) => {
    const clamped = Math.min(0.8, Math.max(0.2, splitRatio));
    set({ splitRatio: clamped });
    saveViewPrefs({ mobileView: get().mobileView, splitRatio: clamped });
  },
  setVimMode: (vimMode) => set({ vimMode }),
  setRecipesOnSave: (recipesOnSave) => set({ recipesOnSave }),
  setSpellCheck: (spellCheck) => set({ spellCheck }),
  setCodeHighlight: (codeHighlight) => set({ codeHighlight }),
  setReadingMode: (readingMode) => set({ readingMode }),
  toggleReadingMode: () => set((s) => ({ readingMode: !s.readingMode })),
}));

/**
 * 统一持久化：任意设置变更后（100ms 防抖，避免拖拽分栏频繁写盘）
 * 把全部非函数字段写入 SETTINGS_KEY。旧 VIEW_PREFS_KEY 仍由
 * setAgent / setMobileView / setSplitRatio 镜像写入，用于降级兼容。
 * 页面卸载（关窗/刷新）时同步 flush，避免防抖窗口内的最后一次变更丢失。
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingState: SettingsState | null = null;

function writeSettingsSnapshot(state: SettingsState) {
  try {
    const snapshot: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(state)) {
      if (typeof value !== 'function') snapshot[key] = value;
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot));
  } catch {
    /* 隐私模式/配额超限时静默忽略 */
  }
}

useSettings.subscribe((state) => {
  if (typeof localStorage === 'undefined') return;
  pendingState = state;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (pendingState) writeSettingsSnapshot(pendingState);
  }, 100);
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (!pendingState) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    writeSettingsSnapshot(pendingState);
  });
}

/** 由设置推导渲染选项 */
export function getRenderOptions(s: SettingsState): RenderOptions {
  const resolvedDark =
    s.theme === 'dark' ||
    (s.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return {
    gfm: true,
    frontmatter: true,
    math: true,
    highlight: s.codeHighlight,
    dataLine: true,
    externalLinksNewTab: true,
    typography: s.typography,
    autoNumber: s.autoNumber,
    // 正文内目录 `[TOC]`：标题文案随界面语言本地化
    tocPlaceholder: !s.tocPlaceholder
      ? false
      : {
          ...s.tocPlaceholder,
          title:
            s.tocPlaceholder.title ??
            (s.locale === 'en' ? 'Contents' : s.locale === 'ja' ? '目次' : '目录'),
        },
    highlightTheme: resolvedDark ? 'dark' : 'light',
    // 脚注区标题/返回按钮是 sr-only 文案，随界面语言本地化
    footnoteLabel: s.locale === 'en' ? 'Footnotes' : '脚注',
    footnoteBackLabel:
      s.locale === 'en' ? 'Back to reference' : s.locale === 'ja' ? '引用元に戻る' : '返回引用',
  };
}
