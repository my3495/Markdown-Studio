import { getThemeVariables, sanitizeCustomVars } from '@md-studio/core';

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
  const vars = { ...getThemeVariables(resolved), ...sanitizeCustomVars(customVars) };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  root.classList.toggle('dark', resolved === 'dark');
}
