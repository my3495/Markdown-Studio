/**
 * 拼写词典扩展：合并词表、解析 .dic / 纯文本词列表（Hunspell-lite）。
 */

import { DEFAULT_EN_DICT } from './check';
import {
  buildDictionaryWithAffix,
  expandEntries,
  parseAffixRules,
  parseDicEntries,
} from './affix';

/** 解析 Hunspell .dic 词干列表（忽略首行计数、注释与 /FLAGS 标记） */
export function parseDicStems(text: string): string[] {
  return parseWordList(text);
}

/** 解析词表文本：支持一行一词，或 Hunspell .dic 首行计数后的词条（忽略 /affix） */
export function parseWordList(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let start = 0;
  if (lines[0] && /^\d+\s*$/.test(lines[0].trim())) start = 1;
  for (let i = start; i < lines.length; i++) {
    let w = (lines[i] ?? '').trim();
    if (!w || w.startsWith('#')) continue;
    const slash = w.indexOf('/');
    if (slash >= 0) w = w.slice(0, slash);
    w = w.toLowerCase();
    if (/^[a-z][a-z'-]*$/.test(w)) out.push(w);
  }
  return out;
}

export function mergeDictionaries(...dicts: Iterable<string>[]): Set<string> {
  const set = new Set<string>();
  for (const d of dicts) {
    for (const w of d) {
      const x = String(w).toLowerCase().trim();
      if (x) set.add(x);
    }
  }
  return set;
}

/** 默认词表 + 用户词表 */
export function buildSpellDictionary(extra: Iterable<string> = []): Set<string> {
  return mergeDictionaries(DEFAULT_EN_DICT, extra);
}

/**
 * B3：.dic 词干 + .aff 规则 → 可接受词集合（含 affix 展开）。
 * aff 文本为空时退化为纯词表。
 */
export function buildSpellDictionaryWithAffix(
  dicWords: Iterable<string>,
  affText = ''
): Set<string> {
  const merged = mergeDictionaries(DEFAULT_EN_DICT, dicWords);
  return affText ? buildDictionaryWithAffix(merged, affText) : merged;
}

/**
 * B3 增强：.dic 文本（保留词级 flags）+ .aff 规则 → 可接受词集合。
 * flags 决定每个词干应用哪些规则；无 flags 的词干应用全部规则（宽容方向）。
 * 支持单/双 affix 链与形态描述（`word/FLAGS po:noun`）。
 */
export function buildSpellDictionaryFromDic(dicText: string, affText = ''): Set<string> {
  const entries = parseDicEntries(dicText);
  const rules = parseAffixRules(affText);
  const extra = new Set(entries.map((e) => e.stem));
  const merged = mergeDictionaries(DEFAULT_EN_DICT, extra);
  // 有 aff 规则时按 flags 精确展开；否则纯词表
  if (!affText) return merged;
  const expanded = expandEntries(
    [...entries, ...[...merged].map((stem) => ({ stem, flags: [] as string[] }))],
    rules
  );
  return expanded;
}
