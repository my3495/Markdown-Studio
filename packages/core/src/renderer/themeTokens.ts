/**
 * 用户可自定义主题令牌白名单（ADR-23：不开放任意 CSS）。
 */

/**
 * 数值型令牌的输入约束。
 *
 * 这些字段早期是自由文本框：用户必须手写 `16px` / `1.75`（且行高不能带单位），
 * 少个 px、写成全角、或写成 `1.75px` 都会被浏览器静默丢弃 —— 界面上「没反应」，
 * 排版却已经回退到继承值。把类型/范围/单位/档位放在数据层，界面就能只给出
 * 合法选项（下拉选择框），从源头消掉这类输入错误。
 *
 * 这里仍保留 min/max/step：历史数据归一化、导入外部主题、store 写入防线都要用它
 * 做收敛校验，不能只依赖界面「选不出非法值」。
 */
export interface ThemeTokenInput {
  /** length=带单位长度（px）；ratio=无单位倍数（行高） */
  type: 'length' | 'ratio';
  min: number;
  max: number;
  step: number;
  /** length 类型的固定单位，界面选项自带后缀，用户无需输入 */
  unit?: string;
  /** 可选档位（界面下拉框的选项，按升序排列） */
  presets?: number[];
}

export interface ThemeTokenDef {
  key: string;
  /** i18n key；界面优先用它本地化，缺失时回退 label */
  labelKey: string;
  /** 中文回退文案（core 不依赖 web 的 i18n 字典） */
  label: string;
  /** color | text */
  kind: 'color' | 'text';
  placeholder?: string;
  /** 存在即表示该令牌应渲染为数值控件（而不是文本框） */
  input?: ThemeTokenInput;
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
  {
    key: '--md-font-size',
    labelKey: 'themeTokenFontSize',
    label: '字号',
    kind: 'text',
    placeholder: '16px',
    input: {
      type: 'length',
      min: 12,
      max: 24,
      step: 1,
      unit: 'px',
      presets: [12, 13, 14, 15, 16, 17, 18, 20, 22, 24],
    },
  },
  {
    key: '--md-line-height',
    labelKey: 'themeTokenLineHeight',
    label: '行高',
    kind: 'text',
    placeholder: '1.75',
    input: {
      type: 'ratio',
      min: 1.2,
      max: 2.2,
      step: 0.05,
      presets: [1.2, 1.4, 1.5, 1.6, 1.7, 1.75, 1.8, 1.9, 2, 2.2],
    },
  },
  {
    key: '--md-max-width',
    labelKey: 'themeTokenMaxWidth',
    label: '内容宽度',
    kind: 'text',
    placeholder: '780px',
    input: {
      type: 'length',
      min: 560,
      max: 1200,
      step: 20,
      unit: 'px',
      presets: [560, 600, 640, 680, 720, 780, 840, 900, 960, 1040, 1120, 1200],
    },
  },
  {
    key: '--md-radius',
    labelKey: 'themeTokenRadius',
    label: '圆角',
    kind: 'text',
    placeholder: '12px',
    input: {
      type: 'length',
      min: 0,
      max: 24,
      step: 1,
      unit: 'px',
      presets: [0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24],
    },
  },
];

const ALLOWED = new Set(CUSTOM_THEME_TOKENS.map((t) => t.key));

const TOKEN_BY_KEY = new Map(CUSTOM_THEME_TOKENS.map((t) => [t.key, t]));

/** 按 key 取令牌定义（含输入约束）；未知 key 返回 undefined */
export function getTokenDef(key: string): ThemeTokenDef | undefined {
  return TOKEN_BY_KEY.get(key);
}

/**
 * 全角转半角：中文输入法下 `１６ｐｘ` 很常见，直接判非法会让用户一头雾水。
 * 只处理全角 ASCII 区与全角空格，不碰其它字符。
 */
function toHalfWidth(input: string): string {
  return input
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

const NUMERIC = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';

export type TokenParseResult =
  | { ok: true; number: number; value: string; inRange: boolean }
  | { ok: false; reason: 'empty' | 'not-number' | 'unit' };

/** step 的小数位数（1.2→0，0.05→2），用于消除滑块浮点累积误差 */
function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : Math.min(4, text.length - dot - 1);
}

/** 只输出数字部分（不带单位），供数值输入框直接展示 */
export function formatTokenNumber(key: string, n: number): string {
  const spec = getTokenDef(key)?.input;
  if (!spec) return String(n);
  return String(Number(n.toFixed(decimalsOf(spec.step))));
}

/** 输出可写入 CSS 的规范值，如 `16px` / `1.75` */
export function serializeTokenValue(key: string, n: number): string {
  const spec = getTokenDef(key)?.input;
  if (!spec) return String(n);
  const num = formatTokenNumber(key, n);
  return spec.type === 'ratio' ? num : `${num}${spec.unit ?? 'px'}`;
}

/** 越界收敛到 [min, max]，并重新序列化 */
export function clampTokenValue(key: string, n: number): string {
  const spec = getTokenDef(key)?.input;
  if (!spec) return serializeTokenValue(key, n);
  return serializeTokenValue(key, Math.min(spec.max, Math.max(spec.min, n)));
}

/**
 * 解析用户输入。
 *
 * 宽容：`16` / `16px` / `16 px` / 全角 `１６px` 都接受（长度令牌自动补单位）。
 * 严格：行高带单位（`1.75px` / `175%`）直接判错 —— 那是另一套语义（固定行距），
 * 写进去会让正文行距不随字号缩放，属于「看起来生效、实际是坑」。
 * 越界不算错：返回 `inRange:false`，由调用方决定收敛并提示。
 */
export function parseTokenValue(key: string, raw: string): TokenParseResult {
  const spec = getTokenDef(key)?.input;
  const text = toHalfWidth(String(raw ?? '')).trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (!spec) {
    // 非数值令牌（颜色 / 字体）：不参与数值解析，原样返回去空白后的文本
    return { ok: true, number: Number.NaN, value: text, inRange: true };
  }
  const matched = new RegExp(`^(${NUMERIC})\\s*([a-zA-Z%]*)$`).exec(text);
  if (!matched) return { ok: false, reason: 'not-number' };
  const unit = matched[2].toLowerCase();
  if (spec.type === 'ratio') {
    if (unit) return { ok: false, reason: 'unit' };
  } else if (unit && unit !== (spec.unit ?? 'px')) {
    return { ok: false, reason: 'unit' };
  }
  const n = Number(matched[1]);
  if (!Number.isFinite(n)) return { ok: false, reason: 'not-number' };
  return {
    ok: true,
    number: n,
    value: serializeTokenValue(key, n),
    inRange: n >= spec.min && n <= spec.max,
  };
}

/**
 * 规整为可写入 CSS 的值；无法解析时返回 null（调用方应保留旧值 / 丢弃脏值）。
 *
 * 注意：只对数值令牌做收敛，文本令牌（字体）不走这里 —— 字体需要在输入过程中
 * 保留原文（含空格），否则受控输入框会吃掉用户刚敲的空格。
 */
export function normalizeTokenValue(key: string, raw: string): string | null {
  const spec = getTokenDef(key)?.input;
  if (!spec) {
    const text = String(raw ?? '').trim();
    return text || null;
  }
  const parsed = parseTokenValue(key, raw);
  if (!parsed.ok) return null;
  return parsed.inRange ? parsed.value : clampTokenValue(key, parsed.number);
}

/**
 * 读取历史持久化数据时的归一化：`16` → `16px`、`1.5` 行高保留、越界收敛、
 * 真正解析不了的脏值丢弃（回退主题默认，而不是把无效 CSS 写进 :root）。
 */
export function normalizeCustomVars(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sanitizeCustomVars(input))) {
    if (!getTokenDef(k)?.input) {
      out[k] = v;
      continue;
    }
    const normalized = normalizeTokenValue(k, v);
    if (normalized !== null) out[k] = normalized;
  }
  return out;
}

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
