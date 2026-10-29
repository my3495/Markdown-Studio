import {
  FONT_FAMILY_TOKEN,
  getThemeVariables,
  normalizeFontFamily,
  sanitizeCustomVars,
} from '@md-studio/core';

export type ResolvedTheme = 'light' | 'dark';

/** 系统是否偏好深色；运行环境没有 matchMedia 时按浅色处理 */
function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches === true;
}

/**
 * 监听系统配色变化（`prefers-color-scheme`）。
 *
 * 只在「跟随系统」模式下需要：用户切系统深色时应用应立即跟随，
 * 而不是等下一次设置变更才重新算一次主题。
 */
export function watchSystemTheme(onChange: (resolved: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => onChange(mq.matches ? 'dark' : 'light');
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }
  // 旧版 Safari 只有 addListener
  mq.addListener?.(handler);
  return () => mq.removeListener?.(handler);
}

export function resolveTheme(mode: 'light' | 'dark' | 'system'): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

/** 将主题变量注入 :root（主题系统 v1.1，ADR-23） */
export function applyTheme(resolved: ResolvedTheme, customVars: Record<string, string>) {
  const custom = sanitizeCustomVars(customVars);
  const themeVars = getThemeVariables(resolved);
  const root = document.documentElement;

  /** 空值视为「未自定义」：用空串覆盖主题默认会让该变量变成无效值，:root 上还会残留上一次的旧值 */
  const vars: Record<string, string> = { ...themeVars };
  for (const [k, v] of Object.entries(custom)) {
    if (v.trim()) vars[k] = v;
  }

  /**
   * 「字体」是自由文本，写进 CSS 前必须规整：`PingFang SC, sans` 里的 sans 不是
   * 合法通用族，直接写会让整串失效退化成浏览器默认字体（用户以为没生效）。
   * 规范化的值只用于渲染，store 里保留原文，避免受控输入框边打字边被改写。
   */
  const fontStack = normalizeFontFamily(custom[FONT_FAMILY_TOKEN] ?? '');
  // 输入无效（空/继承关键字/注入）时回退主题默认字体，而不是让 root 上残留旧值
  vars[FONT_FAMILY_TOKEN] = fontStack || themeVars[FONT_FAMILY_TOKEN];

  for (const [k, v] of Object.entries(vars)) {
    // customVars 里保留了用户原文（含空白），写 CSS 前统一收边
    const value = v.trim();
    if (value) root.style.setProperty(k, value);
  }
  // 书写区字体：默认等宽（未自定义时保持原样）；用户选了字体后跟随正文，
  // 否则会出现“预览变了、书写区没反应”的割裂感。
  root.style.setProperty('--md-font-editor', fontStack || vars['--md-font-mono']);
  root.classList.toggle('dark', resolved === 'dark');
}
