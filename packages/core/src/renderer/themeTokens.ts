/**
 * 用户可自定义主题令牌白名单（ADR-23：不开放任意 CSS）。
 */

export interface ThemeTokenDef {
  key: string;
  /** i18n key；界面优先用它本地化，缺失时回退 label */
  labelKey: string;
  /** 中文回退文案（core 不依赖 web 的 i18n 字典） */
  label: string;
  /** color | text */
  kind: 'color' | 'text';
  placeholder?: string;
}

export const CUSTOM_THEME_TOKENS: ThemeTokenDef[] = [
  { key: '--md-color-accent', labelKey: 'themeTokenAccent', label: '强调色', kind: 'color' },
  { key: '--md-color-fg', labelKey: 'themeTokenFg', label: '正文色', kind: 'color' },
  { key: '--md-color-bg', labelKey: 'themeTokenBg', label: '背景色', kind: 'color' },
  { key: '--md-color-muted', labelKey: 'themeTokenMuted', label: '次要文字', kind: 'color' },
  {
    key: '--md-font-family',
    labelKey: 'themeTokenFontFamily',
    label: '字体',
    kind: 'text',
    placeholder: 'PingFang SC, sans-serif',
  },
  { key: '--md-font-size', labelKey: 'themeTokenFontSize', label: '字号', kind: 'text', placeholder: '16px' },
  { key: '--md-line-height', labelKey: 'themeTokenLineHeight', label: '行高', kind: 'text', placeholder: '1.75' },
  { key: '--md-max-width', labelKey: 'themeTokenMaxWidth', label: '内容宽度', kind: 'text', placeholder: '780px' },
  { key: '--md-radius', labelKey: 'themeTokenRadius', label: '圆角', kind: 'text', placeholder: '12px' },
];

const ALLOWED = new Set(CUSTOM_THEME_TOKENS.map((t) => t.key));

/** 过滤非法 CSS 变量键，防止注入任意属性 */
export function sanitizeCustomVars(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED.has(k)) continue;
    if (typeof v !== 'string') continue;
    // 拒绝明显的注入
    if (/[;{}]|expression\s*\(|url\s*\(\s*['"]?\s*javascript:/i.test(v)) continue;
    out[k] = v.trim();
  }
  return out;
}

export function isAllowedThemeToken(key: string): boolean {
  return ALLOWED.has(key);
}
