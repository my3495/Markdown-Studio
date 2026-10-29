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

/** 字体令牌的 key（需要额外规整，见 normalizeFontFamily） */
export const FONT_FAMILY_TOKEN = '--md-font-family';

/** 通用族：浏览器查不到具体字体时用它兜底，永远不会“匹配不到” */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);

/** 常见手写简写 → 合法通用族（用户写 `sans` 时会整串失效，这里补全） */
const GENERIC_ALIASES: Record<string, string> = {
  sans: 'sans-serif',
  'sans serif': 'sans-serif',
  sansserif: 'sans-serif',
  mono: 'monospace',
};

/** 这些关键字会干扰整站继承，直接判为无效输入 */
const REJECTED_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default']);

const UNQUOTED_OK = /^[a-zA-Z_][\w-]*$/;

function quoteFamily(name: string): string {
  if (GENERIC_FAMILIES.has(name.toLowerCase())) return name;
  if (UNQUOTED_OK.test(name)) return name;
  // 去掉单引号再包一层，避免用户手写引号导致语法错误
  return `'${name.replace(/'/g, '').trim()}'`;
}

/**
 * 规整用户输入的 font-family 栈。
 *
 * 输入框是自由文本，直接写进 CSS 很容易出现「看着填了、实际没生效」：
 * - `PingFang SC, sans` → `sans` 不是合法通用族，整串会退化成浏览器默认字体；
 * - `Microsoft YaHei` → 含空格却不加引号，同样可能匹配失败。
 * 因此这里补通用族兜底、给含空格的名字加引号、并把 sans/mono 等简写补全。
 * 返回空串表示输入无效（调用方应忽略该令牌，回退主题默认值）。
 */
export function normalizeFontFamily(input: string): string {
  if (typeof input !== 'string') return '';
  const families: string[] = [];
  for (const part of input.split(',')) {
    const bare = part.trim().replace(/^['"]|['"]$/g, '').trim();
    if (!bare) continue;
    const lower = bare.toLowerCase();
    if (REJECTED_KEYWORDS.has(lower)) return '';
    if (/[;{}()\\]|expression|url/i.test(bare)) return '';
    const name = GENERIC_ALIASES[lower] ?? bare;
    const quoted = quoteFamily(name);
    if (!families.includes(quoted)) families.push(quoted);
  }
  if (families.length === 0) return '';
  const hasGeneric = families.some((f) =>
    GENERIC_FAMILIES.has(f.replace(/^'|'$/g, '').toLowerCase())
  );
  if (!hasGeneric) families.push('sans-serif');
  return families.join(', ');
}

/**
 * 字体候选：设置面板下拉里给的常用组合（值本身即完整的 font-family 栈）。
 *
 * 每个栈都按「本机常见字体优先、跨平台名兜底」排列，保证 Windows 上也能命中真实字体；
 * 若只写 macOS 专有字体（PingFang SC / LXGW WenKai 等），用户选了却只是回退通用族，
 * 观感上等于「没变化」。
 */
export const FONT_FAMILY_PRESETS: string[] = [
  'system-ui, sans-serif',
  "'PingFang SC', 'Microsoft YaHei', sans-serif",
  "'Microsoft YaHei', sans-serif",
  "'Noto Sans SC', 'Source Han Sans SC', sans-serif",
  "'Songti SC', SimSun, serif",
  "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif",
  'KaiTi, STKaiti, serif',
  'STFangsong, FangSong, serif',
  'Georgia, serif',
  "Consolas, 'JetBrains Mono', monospace",
];

/** 过滤非法 CSS 变量键，防止注入任意属性 */
export function sanitizeCustomVars(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED.has(k)) continue;
    if (typeof v !== 'string') continue;
    // 拒绝明显的注入
    if (/[;{}]|expression\s*\(|url\s*\(\s*['"]?\s*javascript:/i.test(v)) continue;
    /**
     * 这里刻意不 trim：输入框是受控组件（value 直接来自 customVars），
     * 一旦 trim，用户敲空格会被立刻吃掉 —— 于是 `PingFang SC` 只剩 `PingFangSC`
     * （字体名对不上，看起来就是“改了字体没反应”）。空白在写入 CSS 前再处理。
     */
    out[k] = v;
  }
  return out;
}

export function isAllowedThemeToken(key: string): boolean {
  return ALLOWED.has(key);
}
