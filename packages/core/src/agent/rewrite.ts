/**
 * 选中文字 → Agent 改写的纯逻辑层（平台无关、可单测）。
 *
 * 完整链路对应的函数：
 *   1. 选中文字      —— UI 层给出「预览区选中的纯文本」+ 可选行号提示
 *   2. 定位映射      —— `locateSelection()`：把预览文本映射回 Markdown 正文区间
 *   3. 生成         —— `buildRewriteMessages()` / `parseRewriteReply()`
 *   4. diff 展示    —— `diffTokens()`：词级（CJK 按字、拉丁按词）差异
 *   5. 应用结果      —— `applyRewrite()`：按区间替换，返回整篇新正文
 *
 * 语言一致性：`detectInputLang()` 依据**用户输入的指令**判定语言（zh/ja/en），
 * 供 UI 与提示词共用 —— 用户用中文下指令，确认弹窗与模型提示就都是中文。
 */

import type { ChatMessage } from './llm';

export type RewriteLang = 'zh' | 'en' | 'ja';

/** 定位可信度：精确 > 归一化（忽略 Markdown 标记）> 退化（前后缀锚定） */
export type MatchConfidence = 'exact' | 'normalized' | 'partial';

export interface TextRange {
  start: number;
  end: number;
}

export interface LocateResult {
  range: TextRange;
  /** 命中区间的原文（可能含 Markdown 标记），即 diff 的「前」 */
  text: string;
  confidence: MatchConfidence;
  /** 命中处所在行号（1 基） */
  line: number;
  /** 同一片段在正文里出现多次（已按行号提示择优，但仍有其它候选） */
  ambiguous: boolean;
  /** 候选命中数 */
  candidates: number;
}

export interface LocateOptions {
  /** 预览区给出的行号提示（1 基），多处命中时用于择优 */
  lineHint?: number;
}

/* ───────────────────────── 归一化（带下标映射） ───────────────────────── */

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/;
const INLINE_MARKERS = new Set(['*', '_', '`', '~']);
/** 行首块级标记：标题 / 引用 / 列表 / 有序列表 */
const BLOCK_PREFIX = /^(#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s)/;

export interface NormalizedText {
  text: string;
  /** map[i] = 归一化后第 i 个字符在原文中的下标 */
  map: number[];
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '　';
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 跳过 `![alt](url)`：返回结束下标（不含），失败返回 -1 */
function skipImage(raw: string, at: number): number {
  const close = raw.indexOf('](', at + 1);
  if (close < 0) return -1;
  const end = raw.indexOf(')', close + 2);
  return end < 0 ? -1 : end + 1;
}

/** 跳过 `](url)`：at 指向 `]`，返回结束下标（不含），失败返回 -1 */
function skipLinkTail(raw: string, at: number): number {
  const end = raw.indexOf(')', at + 2);
  return end < 0 ? -1 : end + 1;
}

/**
 * 归一化 Markdown 正文，同时保留「归一化字符 → 原文下标」的映射。
 *
 * 这样预览区的纯文本（不含 `**`、`` ` ``、链接地址等）也能被定位回原文区间，
 * 而替换时仍然只动「用户看到的那段」，标记符号留在区间外。
 *
 * 注意：归一化后的文本只用于**匹配**，不用于展示（展示始终用原文切片）。
 */
export function normalizeWithMap(raw: string): NormalizedText {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  let i = 0;
  const emit = (ch: string, at: number) => {
    if (pendingSpace && out.length > 0) {
      out.push(' ');
      map.push(at);
    }
    pendingSpace = false;
    out.push(ch);
    map.push(at);
  };

  while (i < raw.length) {
    const ch = raw[i];
    // 转义：`\*` 之类，跳过反斜杠、保留字符本身
    if (ch === '\\' && i + 1 < raw.length) {
      emit(raw[i + 1], i + 1);
      i += 2;
      continue;
    }
    if (ZERO_WIDTH.test(ch)) {
      i += 1;
      continue;
    }
    if (isSpace(ch)) {
      // 换行一并归一为空格：跨行/跨段的选择在预览里本来就是连成一段的
      pendingSpace = true;
      i += 1;
      continue;
    }
    // 行首块级标记不属于「看到的文字」
    if (i === 0 || raw[i - 1] === '\n') {
      const m = BLOCK_PREFIX.exec(raw.slice(i));
      if (m) {
        i += m[0].length;
        continue;
      }
    }
    if (ch === '!' && raw[i + 1] === '[') {
      const end = skipImage(raw, i);
      if (end > 0) {
        i = end;
        continue;
      }
    }
    if (ch === '[') {
      i += 1;
      continue;
    }
    if (ch === ']' && raw[i + 1] === '(') {
      const end = skipLinkTail(raw, i);
      if (end > 0) {
        i = end;
        continue;
      }
    }
    // 行内 HTML 标签
    if (ch === '<') {
      const gt = raw.indexOf('>', i);
      if (gt > i && /^[a-zA-Z/!]/.test(raw.slice(i + 1))) {
        i = gt + 1;
        continue;
      }
    }
    // 表格竖线
    if (ch === '|') {
      i += 1;
      continue;
    }
    if (INLINE_MARKERS.has(ch)) {
      i += 1;
      // `**` / `__` / `~~` 连续标记一起跳过
      while (i < raw.length && (raw[i] === '*' || raw[i] === '_' || raw[i] === '~')) i += 1;
      continue;
    }
    emit(ch, i);
    i += 1;
  }
  return { text: out.join(''), map };
}

/* ───────────────────────── 定位映射 ───────────────────────── */

/** 退化匹配时锚定所需的最短片段长度 */
const MIN_ANCHOR = 6;

/**
 * 在归一化文本的基础上再去掉空格（保留映射）。
 * 选区跨行、或预览排版在 CJK 与拉丁之间插入空格时，正文里并没有这些空格，
 * 直接按带空格的片段去匹配会漏掉；去空格后匹配即可覆盖这类差异。
 */
function tighten(n: NormalizedText): NormalizedText {
  const out: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < n.text.length; i++) {
    if (n.text[i] === ' ') continue;
    out.push(n.text[i]);
    map.push(n.map[i]);
  }
  return { text: out.join(''), map };
}

function findAll(hay: string, needle: string): number[] {
  const hits: number[] = [];
  if (!needle) return hits;
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    hits.push(idx);
    from = idx + 1;
  }
  return hits;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') line += 1;
  }
  return line;
}

/** 收紧区间两端：去掉空白，避免替换时把首尾空格/换行一起吃掉 */
function trimRange(content: string, r: TextRange): TextRange {
  let start = Math.max(0, Math.min(r.start, content.length));
  let end = Math.max(start, Math.min(r.end, content.length));
  while (start < end && isSpace(content[start])) start += 1;
  while (end > start && isSpace(content[end - 1])) end -= 1;
  return { start, end };
}

function pick(
  content: string,
  ranges: TextRange[],
  confidence: MatchConfidence,
  lineHint?: number
): LocateResult {
  let best = ranges[0];
  if (lineHint && lineHint > 0 && ranges.length > 1) {
    let bestDist = Number.POSITIVE_INFINITY;
    for (const r of ranges) {
      const d = Math.abs(lineOf(content, r.start) - lineHint);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
  }
  return {
    range: best,
    text: content.slice(best.start, best.end),
    confidence,
    line: lineOf(content, best.start),
    ambiguous: ranges.length > 1,
    candidates: ranges.length,
  };
}

/**
 * 把「预览区选中的文字」映射回 Markdown 正文区间。
 *
 * 三级定位，从左到右由准到宽：
 *  1. 原文精确命中；
 *  2. 归一化命中（忽略 `**`、`` ` ``、链接地址、行首 `#`/`>`/`-` 等标记）；
 *  3. 退化命中：取最长前缀与最长后缀分别锚定两端（模型或前端只拿到片段时兜底）。
 *
 * 多处命中时用 `lineHint`（预览区 `data-line`）挑最近的一处，并把
 * `ambiguous` 置为 true，供 UI 提示用户「这段文字在正文里出现多次」。
 */
export function locateSelection(
  content: string,
  selected: string,
  opts: LocateOptions = {}
): LocateResult | null {
  if (!content || !selected) return null;
  const needle = collapseSpaces(selected.replace(/[\u200B-\u200D\uFEFF]/g, ''));
  if (!needle) return null;

  // 1) 原文精确命中
  const exact = findAll(content, needle);
  if (exact.length > 0) {
    return pick(
      content,
      exact.map((i) => ({ start: i, end: i + needle.length })),
      'exact',
      opts.lineHint
    );
  }

  // 2) 归一化命中（忽略 Markdown 标记）
  const n = normalizeWithMap(content);
  const nn = collapseSpaces(normalizeWithMap(needle).text);
  if (!nn) return null;
  const hits = findAll(n.text, nn);
  if (hits.length > 0) {
    const ranges = hits.map((i) =>
      trimRange(content, { start: n.map[i], end: n.map[i + nn.length - 1] + 1 })
    );
    return pick(content, ranges, 'normalized', opts.lineHint);
  }

  // 2') 去空格后再试：选区跨行/排版插入空格时，正文里并没有这些空格
  const t = tighten(n);
  const tt = nn.replace(/ /g, '');
  const tightHits = findAll(t.text, tt);
  if (tightHits.length > 0) {
    const ranges = tightHits.map((i) =>
      trimRange(content, { start: t.map[i], end: t.map[i + tt.length - 1] + 1 })
    );
    return pick(content, ranges, 'normalized', opts.lineHint);
  }

  // 3) 退化：在去空格的归一化文本上，用最长前缀 + 最长后缀分别锚定两端
  if (tt.length <= MIN_ANCHOR * 2) return null;
  let head = -1;
  let headLen = 0;
  for (let len = tt.length - 1; len >= MIN_ANCHOR; len--) {
    const idx = t.text.indexOf(tt.slice(0, len));
    if (idx >= 0) {
      head = idx;
      headLen = len;
      break;
    }
  }
  let tail = -1;
  let tailLen = 0;
  for (let len = tt.length - 1; len >= MIN_ANCHOR; len--) {
    const idx = t.text.indexOf(tt.slice(tt.length - len));
    if (idx >= 0) {
      tail = idx;
      tailLen = len;
      break;
    }
  }
  // 后缀必须落在前缀之后，否则两个锚点互相矛盾（多半是片段本身不来自这篇正文）
  if (head < 0 || tail < 0 || tail + tailLen < head + headLen) return null;
  const partial = trimRange(content, { start: t.map[head], end: t.map[tail + tailLen - 1] + 1 });
  if (partial.end <= partial.start) return null;
  return pick(content, [partial], 'partial', opts.lineHint);
}

/** 取命中区间的上下文（供模型判断语气/指代），默认前后各 120 字符 */
export function contextAround(
  content: string,
  range: TextRange,
  radius = 120
): { before: string; after: string } {
  return {
    before: content.slice(Math.max(0, range.start - radius), range.start).trim(),
    after: content.slice(range.end, Math.min(content.length, range.end + radius)).trim(),
  };
}

/* ───────────────────────── 差异与应用 ───────────────────────── */

const CJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
const WORDISH = /[0-9A-Za-z_'`-]/;

/**
 * 词级切分：CJK 逐字、拉丁/数字按词、其余（标点/空白）逐字符。
 * 中文没有空格，按字切才是「看起来像改了一句」的正确粒度。
 */
export function tokenizeForDiff(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (CJK.test(ch)) {
      out.push(ch);
      i += 1;
      continue;
    }
    if (WORDISH.test(ch)) {
      let j = i + 1;
      while (j < text.length && WORDISH.test(text[j])) j += 1;
      out.push(text.slice(i, j));
      i = j;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out;
}

export type RewriteDiffOp = { type: 'eq' | 'add' | 'del'; text: string };

/** LCS 表上限（约 8MB number）；超限退化为「公共前后缀 + 整段替换」 */
const MAX_DIFF_CELLS = 1_000_000;

function prefixSuffixOps(a: string[], b: string[]): RewriteDiffOp[] {
  const ops: RewriteDiffOp[] = [];
  let start = 0;
  const minLen = Math.min(a.length, b.length);
  while (start < minLen && a[start] === b[start]) {
    ops.push({ type: 'eq', text: a[start] });
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  for (let i = start; i < endA; i++) ops.push({ type: 'del', text: a[i] });
  for (let j = start; j < endB; j++) ops.push({ type: 'add', text: b[j] });
  for (let i = endA; i < a.length; i++) ops.push({ type: 'eq', text: a[i] });
  return ops;
}

/** 合并相邻同类 op，避免渲染出一长串碎片段 */
function mergeOps(ops: RewriteDiffOp[]): RewriteDiffOp[] {
  const out: RewriteDiffOp[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (last && last.type === op.type) last.text += op.text;
    else out.push({ ...op });
  }
  return out;
}

/** 词级 diff（CJK 按字），用于「确认修改」弹窗 */
export function diffTokens(before: string, after: string): RewriteDiffOp[] {
  const a = tokenizeForDiff(before);
  const b = tokenizeForDiff(after);
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return mergeOps(prefixSuffixOps(a, b));

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: RewriteDiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i] });
      i += 1;
    } else {
      ops.push({ type: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < n) ops.push({ type: 'del', text: a[i++] });
  while (j < m) ops.push({ type: 'add', text: b[j++] });
  return mergeOps(ops);
}

/** diff 统计：删除/新增的字符数（用于「−12 +20」这类摘要） */
export function diffStat(ops: RewriteDiffOp[]): { del: number; add: number } {
  let del = 0;
  let add = 0;
  for (const op of ops) {
    if (op.type === 'del') del += op.text.length;
    else if (op.type === 'add') add += op.text.length;
  }
  return { del, add };
}

/** 按区间替换；返回整篇新正文 + 替换前后的片段（供 diff 与提示） */
export function applyRewrite(
  content: string,
  range: TextRange,
  replacement: string
): { content: string; before: string; after: string } {
  const start = Math.max(0, Math.min(range.start, content.length));
  const end = Math.max(start, Math.min(range.end, content.length));
  const before = content.slice(start, end);
  return {
    content: content.slice(0, start) + replacement + content.slice(end),
    before,
    after: replacement,
  };
}

/* ───────────────────────── 语言一致性 ───────────────────────── */

const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const KANA = /[\u3040-\u30FF]/;

/**
 * 依据**用户输入的指令**判定语言，保证「提示语言与输入语言一致」：
 * 用户用中文下指令 → 确认弹窗与模型提示都是中文；英文下指令 → 全链路英文。
 * 假名优先判日语（日文里也有汉字），其余含汉字判中文，否则英文。
 */
export function detectInputLang(text: string): RewriteLang {
  let han = 0;
  let kana = 0;
  for (const ch of text) {
    if (KANA.test(ch)) kana += 1;
    else if (HAN.test(ch)) han += 1;
  }
  if (kana > 0) return 'ja';
  if (han > 0) return 'zh';
  return 'en';
}

/* ───────────────────────── 提示词与回包解析 ───────────────────────── */

const SYSTEM_PROMPT: Record<RewriteLang, string> = {
  zh: '你是 Markdown Studio 的改写助手。用户会给你一段正文和一条修改指令。只输出修改后的文字本身：不要解释、不要用代码块包裹、不要加引号、不要带标题的 # 号或列表符号、不要复述指令。保持原文的语言与事实，只改指令要求的部分。',
  en: 'You are the rewrite assistant for Markdown Studio. You receive a passage and one revision instruction. Output ONLY the revised passage: no explanations, no code fences, no surrounding quotes, no heading "#" or list markers, no restating of the instruction. Keep the original language and facts, change only what the instruction asks.',
  ja: 'あなたは Markdown Studio の書き換えアシスタントです。本文と修正指示が渡されます。修正後の本文のみを出力してください：説明、コードブロック、引用符、見出しの # やリスト記号、指示の繰り返しは不要です。元の言語と事実を保ち、指示された部分だけを変更してください。',
};

const LABELS: Record<RewriteLang, { instruction: string; target: string; before: string; after: string }> = {
  zh: { instruction: '修改指令', target: '待修改文字', before: '上文', after: '下文' },
  en: { instruction: 'Instruction', target: 'Passage to revise', before: 'Text before', after: 'Text after' },
  ja: { instruction: '修正指示', target: '修正対象', before: '前文', after: '後文' },
};

export interface RewritePromptInput {
  lang: RewriteLang;
  /** 用户指令（原始输入，不翻译） */
  instruction: string;
  /** 命中区间的原文 */
  target: string;
  /** 命中处上下文（可选，帮助模型判断语气与指代） */
  before?: string;
  after?: string;
}

/** 构造改写请求；系统提示与标签均使用 `lang`，与用户输入语言一致 */
export function buildRewriteMessages(input: RewritePromptInput): ChatMessage[] {
  const lang = input.lang ?? 'en';
  const label = LABELS[lang] ?? LABELS.en;
  const parts = [`### ${label.instruction}\n${input.instruction}`, `### ${label.target}\n<<<\n${input.target}\n>>>`];
  if (input.before) parts.push(`### ${label.before}\n${input.before}`);
  if (input.after) parts.push(`### ${label.after}\n${input.after}`);
  const tail =
    lang === 'zh'
      ? '请只输出修改后的文字。'
      : lang === 'ja'
        ? '修正後の本文のみを出力してください。'
        : 'Output only the revised passage.';
  parts.push(tail);
  return [
    { role: 'system', content: SYSTEM_PROMPT[lang] ?? SYSTEM_PROMPT.en },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** 模型回包里常见的「结果标签」前缀 */
const REPLY_LABEL =
  /^(改写结果|修改后的文字|修改后|修订后|改写后|Rewritten( text)?|Revised( text)?|Output|Result|Answer)\s*[:：]\s*/i;

const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['「', '」'],
  ['『', '』'],
];

function stripWrappingQuotes(s: string): string {
  if (s.length < 2) return s;
  for (const [l, r] of QUOTE_PAIRS) {
    if (s.startsWith(l) && s.endsWith(r)) return s.slice(1, -1).trim();
  }
  return s;
}

/**
 * 解析模型回包，取出「修改后的文字」。
 * 模型常会加代码块围栏、结果标签或成对引号，这里统一剥掉；
 * 剥不掉也不要紧 —— 返回原文由调用方判定「是否无改动」。
 */
export function parseRewriteReply(raw: string): string {
  let s = (raw ?? '').trim();
  if (!s) return '';
  const fenced = /^```[a-zA-Z0-9_+-]*\s*\n([\s\S]*?)\n?```$/.exec(s);
  if (fenced) {
    s = fenced[1].trim();
  } else if (s.startsWith('```')) {
    s = s
      .replace(/^```[a-zA-Z0-9_+-]*\s*/, '')
      .replace(/```\s*$/, '')
      .trim();
  }
  s = s.replace(REPLY_LABEL, '');
  if (s.startsWith('<<<') && s.endsWith('>>>')) s = s.slice(3, -3).trim();
  return stripWrappingQuotes(s).trim();
}
