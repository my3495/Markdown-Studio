/**
 * B3 增强：Hunspell .aff 规则解析与词形展开（轻量子集）。
 *
 * 支持：
 * - `PFX` / `SFX` 规则（strip / add / condition），header 行（flag + cross-product + 计数）自动跳过；
 * - condition 形态：`.`（任意至少一字符）、字面量（如 `e`）、字符类 `[abc]` / `[^abc]`；
 * - 其他指令（REP/TRY/SET/IGNORE/FLAG…）与注释行安全忽略。
 *
 * 说明：词典中 `word/FLAGS` 的逐词标记在本轻量实现中不参与过滤，
 * 统一把规则应用到全部词干（宽容方向：宁漏不错报）。
 */

export interface AffixRule {
  /** 从词干剥离的前缀/后缀（'' 表示不剥离） */
  strip: string;
  /** 追加到词干的前缀/后缀（'' 表示纯剥离） */
  add: string;
  /** 匹配条件，作用于词干对应端；'.' 表示任意（至少一字符） */
  condition: string;
}

export interface AffixRules {
  prefixes: Map<string, AffixRule[]>;
  suffixes: Map<string, AffixRule[]>;
}

export const EMPTY_AFFIX: AffixRules = {
  prefixes: new Map(),
  suffixes: new Map(),
};

function stripMorph(field: string): string {
  // affix 字段可能带形态描述：'ied/[^aeiou]y' → 'ied'
  const slash = field.indexOf('/');
  return slash >= 0 ? field.slice(0, slash) : field;
}

const WORD_OK = /^[a-z][a-z'-]*$/;

function parseRuleLine(line: string): AffixRule | null {
  // 完整行格式: PFX|SFX flag strip add [condition]
  // 形如: PFX A 0 re .   |   SFX Y y ied [^aeiou]y   |   SFX S 0 s/[NOUN] . NAMED_TO
  const parts = line.trim().split(/\s+/);
  if (!/^(PFX|SFX)$/i.test(parts[0] ?? '') || parts.length < 4) return null;
  const strip = parts[2] === '0' ? '' : stripMorph(parts[2]!);
  const add = parts[3] === '0' ? '' : stripMorph(parts[3]!);
  const condition = parts[4] ?? '.';
  return { strip, add, condition };
}

/** 解析 .aff 文本 */
export function parseAffixRules(aff: string): AffixRules {
  const rules: AffixRules = {
    prefixes: new Map(),
    suffixes: new Map(),
  };
  if (!aff) return rules;
  const lines = aff.replace(/\r\n/g, '\n').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const head = line.split(/\s+/, 1)[0]!.toUpperCase();
    if (head !== 'PFX' && head !== 'SFX') continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const flag = parts[1]!;
    // header 行：PFX A Y 1 —— 第 3 字段为 Y/N，无 strip/add/condition
    if (/^[YN]$/i.test(parts[2]!) && /^\d+$/.test(parts[3] ?? '')) continue;
    const rule = parseRuleLine(line);
    if (!rule) continue;
    const bucket = head === 'PFX' ? rules.prefixes : rules.suffixes;
    const list = bucket.get(flag);
    if (list) list.push(rule);
    else bucket.set(flag, [rule]);
  }
  return rules;
}

/** 将 hunspell 条件转为锚定正则片段：'.'/字面量/字符类，其余原样转义 */
function conditionToRegex(condition: string): string {
  let out = '';
  let i = 0;
  while (i < condition.length) {
    const ch = condition[i]!;
    if (ch === '[') {
      const close = condition.indexOf(']', i);
      if (close < 0) {
        out += '\\[';
        i++;
        continue;
      }
      out += condition.slice(i, close + 1); // [abc] / [^abc]
      i = close + 1;
      continue;
    }
    if (ch === '.') {
      out += '.';
      i++;
      continue;
    }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    i++;
  }
  return out;
}

/** 条件匹配：end=false 测词干开头（前缀），end=true 测词干结尾（后缀） */
export function matchCondition(stem: string, condition: string, end: boolean): boolean {
  if (!condition) return true;
  const pattern = conditionToRegex(condition);
  try {
    const re = end ? new RegExp(pattern + '$') : new RegExp('^' + pattern);
    return re.test(stem);
  } catch {
    return stem.length > 0;
  }
}

/** 应用后缀规则；不满足条件返回 null */
export function applySuffixRule(stem: string, rule: AffixRule): string | null {
  if (rule.strip.length > stem.length) return null;
  if (!matchCondition(stem, rule.condition, true)) return null;
  const base = rule.strip ? stem.slice(0, -rule.strip.length) : stem;
  return base + rule.add;
}

/** 应用前缀规则；不满足条件返回 null */
export function applyPrefixRule(stem: string, rule: AffixRule): string | null {
  if (rule.strip.length > stem.length) return null;
  if (!matchCondition(stem, rule.condition, false)) return null;
  const base = rule.strip ? stem.slice(rule.strip.length) : stem;
  return rule.add + base;
}

/**
 * 用词干集合 + affix 规则展开全部可接受词形。
 * 两阶段：先套前缀，再对「原词干 + 前缀形式」统一套后缀（即 cross-product 组合），
 * 使 reread + s → rereads 这类组合词也可接受；带规模上限防御病态词典。
 */
export function expandWithAffix(
  stems: Iterable<string>,
  rules: AffixRules,
  opts: ExpandOptions = {}
): Set<string> {
  return expandEntries(
    [...stems].map((stem) => ({ stem, flags: [] as string[] })),
    rules,
    opts
  );
}

export interface ExpandOptions {
  /** 允许双 affix 链（PFX+SFX / SFX+SFX / PFX+PFX），默认 true */
  allowDouble?: boolean;
  /** 展开规模上限，默认 200k */
  maxForms?: number;
  /** 单个词干的双规则组合上限，默认 64 */
  maxPairsPerStem?: number;
}

/** .dic 词条：词干 + 词级 flags（Hunspell `word/FLAGS`；无 flags 时为空数组） */
export interface DicEntry {
  stem: string;
  flags: string[];
}

/** 解析 .dic 文本为词条（含词级 flags；忽略首行计数/注释/形态描述） */
export function parseDicEntries(text: string): DicEntry[] {
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: DicEntry[] = [];
  let start = 0;
  if (lines[0] && /^\d+\s*$/.test(lines[0].trim())) start = 1;
  for (let i = start; i < lines.length; i++) {
    let w = (lines[i] ?? '').trim();
    if (!w || w.startsWith('#')) continue;
    const slash = w.indexOf('/');
    let flags: string[] = [];
    if (slash >= 0) {
      const flagPart = w.slice(slash + 1);
      w = w.slice(0, slash);
      // 形态描述（如 `word/AB po:noun`）以空白分隔，取第一段为 flags
      const flagField = flagPart.split(/\s+/)[0] ?? '';
      flags = [...flagField];
    }
    w = w.toLowerCase();
    if (/^[a-z][a-z'-]*$/.test(w)) out.push({ stem: w, flags });
  }
  return out;
}

/**
 * 词条 + affix 规则展开（Hunspell 语义lite）：
 * - 有词级 flags 时只应用对应 flag 的规则；无 flags 时应用全部规则（宽容）；
 * - 单 affix + 双 affix 链（PFX+SFX、SFX+SFX、PFX+PFX），带上限防御。
 */
export function expandEntries(
  entries: Iterable<DicEntry>,
  rules: AffixRules,
  opts: ExpandOptions = {}
): Set<string> {
  const out = new Set<string>();
  const maxForms = opts.maxForms ?? 200_000;
  const maxPairs = opts.maxPairsPerStem ?? 64;
  const allowDouble = opts.allowDouble !== false;
  const allSuffix = [...rules.suffixes.values()].flat();
  const allPrefix = [...rules.prefixes.values()].flat();

  for (const entry of entries) {
    const stem = String(entry.stem).toLowerCase().trim();
    if (!stem) continue;
    out.add(stem);
    const hasFlags = entry.flags.length > 0;
    const flagSet = new Set(entry.flags);
    const suffixList = hasFlags
      ? allSuffix.filter((r) => flagSet.has(suffixFlagOf(r, rules.suffixes)))
      : allSuffix;
    const prefixList = hasFlags
      ? allPrefix.filter((r) => flagSet.has(prefixFlagOf(r, rules.prefixes)))
      : allPrefix;

    const apply = (
      base: string,
      r: AffixRule,
      kind: 'sfx' | 'pfx'
    ): string | null =>
      kind === 'sfx' ? applySuffixRule(base, r) : applyPrefixRule(base, r);

    // 单 affix
    const singleSfx: string[] = [];
    for (const r of suffixList) {
      const w = apply(stem, r, 'sfx');
      if (w && WORD_OK.test(w)) {
        out.add(w);
        singleSfx.push(w);
      }
    }
    const singlePfx: string[] = [];
    for (const r of prefixList) {
      const w = apply(stem, r, 'pfx');
      if (w && WORD_OK.test(w)) {
        out.add(w);
        singlePfx.push(w);
      }
    }

    if (allowDouble) {
      let pairs = 0;
      const canPair = () => pairs < maxPairs;
      // PFX + SFX
      for (const p of singlePfx) {
        for (const r of suffixList) {
          if (!canPair()) break;
          pairs++;
          const w = apply(p, r, 'sfx');
          if (w && WORD_OK.test(w)) out.add(w);
        }
      }
      // SFX + SFX（双后缀链）
      for (const s of singleSfx) {
        for (const r of suffixList) {
          if (!canPair()) break;
          pairs++;
          const w = apply(s, r, 'sfx');
          if (w && WORD_OK.test(w)) out.add(w);
        }
      }
      // PFX + PFX（双前缀链）
      for (const p of singlePfx) {
        for (const r of prefixList) {
          if (!canPair()) break;
          pairs++;
          const w = apply(p, r, 'pfx');
          if (w && WORD_OK.test(w)) out.add(w);
        }
      }
    }
    if (out.size > maxForms) break;
  }
  return out;
}

/** 反查规则所属 flag（规则对象不携带 flag，由调用方容器反查） */
function suffixFlagOf(rule: AffixRule, map: Map<string, AffixRule[]>): string {
  for (const [flag, list] of map) if (list.includes(rule)) return flag;
  return '';
}

function prefixFlagOf(rule: AffixRule, map: Map<string, AffixRule[]>): string {
  return suffixFlagOf(rule, map);
}

/** 便捷：.dic 文本（含 flags）+ .aff 文本 → 可接受词集合 */
export function buildDictionaryFromDic(dicText: string, affText: string): Set<string> {
  return expandEntries(parseDicEntries(dicText), parseAffixRules(affText));
}

/** 便捷：.dic 词表文本 + .aff 文本 → 可接受词集合（词干数组形式，无 flags） */
export function buildDictionaryWithAffix(
  dicWords: Iterable<string>,
  affText: string
): Set<string> {
  const rules = parseAffixRules(affText);
  return expandWithAffix(dicWords, rules);
}
