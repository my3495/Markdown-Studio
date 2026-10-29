import {
  FONT_FAMILY_TOKEN,
  getThemeVariables,
  normalizeFontFamily,
  sanitizeCustomVars,
} from '@md-studio/core';

export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(mode: 'light' | 'dark' | 'system'): ResolvedTheme {
  if (mode === 'system') {
    return typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return mode;
}

/** 将主题变量注入 :root（主题系统 v1.1，ADR-23） */
export function applyTheme(resolved: ResolvedTheme, customVars: Record<string, string>) {
  const custom = sanitizeCustomVars(customVars);
  const themeVars = getThemeVariables(resolved);
  const vars: Record<string, string> = { ...themeVars, ...custom };
  const root = document.documentElement;

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
