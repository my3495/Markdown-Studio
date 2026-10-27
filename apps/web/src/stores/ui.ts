import { create } from 'zustand';

/** 主区面板标签（Agent 由右侧栏承载，不在此列） */
export type PanelId = 'settings' | 'history' | 'crypto' | 'git' | 'sync' | 'graph';

/** 左侧导航互斥 Tab */
export type SideTab = 'files' | 'outline' | 'props' | 'graph';

/** 侧栏宽度的可调范围与默认值（与 css --md-side-width / --md-rail-width 对齐） */
export const SIDE_WIDTH_MIN = 180;
export const SIDE_WIDTH_MAX = 480;
export const SIDE_WIDTH_DEFAULT = 260;
export const SIDE_WIDTH_STORAGE_KEY = 'md-studio:side-width';
export const RAIL_WIDTH_MIN = 240;
export const RAIL_WIDTH_MAX = 640;
export const RAIL_WIDTH_DEFAULT = 340;
export const RAIL_WIDTH_STORAGE_KEY = 'md-studio:rail-width';

function clampWidth(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function loadNumber(key: string): number | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

interface UiState {
  /** 已打开的主区面板标签（有序） */
  panelTabs: PanelId[];
  /** 当前主区显示的面板；null = 显示文档 */
  activePanel: PanelId | null;
  openPanel: (id: PanelId) => void;
  closePanelTab: (id: PanelId) => void;
  setActivePanel: (id: PanelId) => void;
  showDocument: () => void;

  /** 右侧栏（Agent 对话）是否展开 */
  agentOpen: boolean;
  toggleAgent: () => void;
  setAgentOpen: (open: boolean) => void;

  /** 左侧 Agent 会话侧栏（Cursor 风格）是否展开 */
  agentSidebarOpen: boolean;
  toggleAgentSidebar: () => void;
  setAgentSidebarOpen: (open: boolean) => void;

  sideTab: SideTab;
  setSideTab: (tab: SideTab) => void;

  /** 窄屏侧栏抽屉是否展开 */
  sideOpen: boolean;
  setSideOpen: (open: boolean) => void;
  toggleSide: () => void;

  /** 宽屏（>1024）时左侧栏是否隐藏：桌面端需要独立的显隐入口 */
  sideCollapsed: boolean;
  setSideCollapsed: (collapsed: boolean) => void;
  toggleSideCollapsed: () => void;

  /** 左侧栏宽度（px）；持久化到 localStorage，刷新后保留 */
  sideWidth: number;
  setSideWidth: (w: number) => void;

  /** 右侧栏宽度（px）；持久化到 localStorage，刷新后保留 */
  railWidth: number;
  setRailWidth: (w: number) => void;

  /** ⌘K 命令面板 */
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
}

const initialSideWidth = clampWidth(
  loadNumber(SIDE_WIDTH_STORAGE_KEY),
  SIDE_WIDTH_MIN,
  SIDE_WIDTH_MAX,
  SIDE_WIDTH_DEFAULT
);
const initialRailWidth = clampWidth(
  loadNumber(RAIL_WIDTH_STORAGE_KEY),
  RAIL_WIDTH_MIN,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_DEFAULT
);

/** 写一个 number 到 localStorage（失败静默——隐私模式/无 storage） */
function persistNumber(key: string, value: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* 忽略：隐私模式/配额超限等 */
  }
}

export const useUi = create<UiState>((set) => ({
  panelTabs: [],
  activePanel: null,
  openPanel: (id) =>
    set((s) => ({
      panelTabs: s.panelTabs.includes(id) ? s.panelTabs : [...s.panelTabs, id],
      activePanel: id,
      paletteOpen: false,
    })),
  closePanelTab: (id) =>
    set((s) => ({
      panelTabs: s.panelTabs.filter((p) => p !== id),
      // 关闭激活标签时回落到文档视图（其余已打开标签仍保留在标签栏）
      activePanel: s.activePanel === id ? null : s.activePanel,
    })),
  setActivePanel: (id) => set({ activePanel: id, paletteOpen: false }),
  showDocument: () => set({ activePanel: null }),

  // 右侧 Agent 栏默认收起，避免首屏被挤占；用户可通过工具栏或主区右缘按钮展开
  agentOpen: false,
  toggleAgent: () => set((s) => ({ agentOpen: !s.agentOpen })),
  setAgentOpen: (agentOpen) => set({ agentOpen }),

  agentSidebarOpen: true,
  toggleAgentSidebar: () => set((s) => ({ agentSidebarOpen: !s.agentSidebarOpen })),
  setAgentSidebarOpen: (agentSidebarOpen) => set({ agentSidebarOpen }),

  sideTab: 'files',
  setSideTab: (sideTab) => set({ sideTab, sideOpen: true }),

  sideOpen: false,
  setSideOpen: (sideOpen) => set({ sideOpen }),
  toggleSide: () => set((s) => ({ sideOpen: !s.sideOpen })),

  sideCollapsed: false,
  setSideCollapsed: (sideCollapsed) => set({ sideCollapsed }),
  toggleSideCollapsed: () => set((s) => ({ sideCollapsed: !s.sideCollapsed })),

  sideWidth: initialSideWidth,
  setSideWidth: (w) => {
    const clamped = clampWidth(w, SIDE_WIDTH_MIN, SIDE_WIDTH_MAX, SIDE_WIDTH_DEFAULT);
    persistNumber(SIDE_WIDTH_STORAGE_KEY, clamped);
    set({ sideWidth: clamped });
  },

  railWidth: initialRailWidth,
  setRailWidth: (w) => {
    const clamped = clampWidth(w, RAIL_WIDTH_MIN, RAIL_WIDTH_MAX, RAIL_WIDTH_DEFAULT);
    persistNumber(RAIL_WIDTH_STORAGE_KEY, clamped);
    set({ railWidth: clamped });
  },

  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
}));
