/**
 * 用户个人词典（localStorage），与忽略列表分离。
 * 支持 Hunspell .aff 规则文本（B3）：导入后拼写检查按规则派生词形。
 */

import {
  buildSpellDictionaryWithAffix,
  parseAffixRules,
  parseWordList,
  type AffixRules,
} from '@md-studio/core';

const DICT_KEY = 'md-studio-spell-dict';
const AFF_KEY = 'md-studio-spell-aff';

export function loadPersonalDict(): string[] {
  try {
    const raw = localStorage.getItem(DICT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr.map((w) => w.toLowerCase()) : [];
  } catch {
    return [];
  }
}

export function savePersonalDict(words: string[]) {
  const uniq = [...new Set(words.map((w) => w.toLowerCase()).filter(Boolean))];
  localStorage.setItem(DICT_KEY, JSON.stringify(uniq));
}

export function addToPersonalDict(word: string) {
  const list = loadPersonalDict();
  list.push(word.toLowerCase());
  savePersonalDict(list);
}

export function importWordListText(text: string): number {
  const extra = parseWordList(text);
  const merged = [...loadPersonalDict(), ...extra];
  savePersonalDict(merged);
  return extra.length;
}

/** ---- .aff 规则（B3） ---- */

export function loadAffText(): string {
  try {
    return localStorage.getItem(AFF_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveAffText(text: string) {
  localStorage.setItem(AFF_KEY, text);
}

/** 导入 .aff 文本；返回解析出的规则数（PFX+SFX） */
export function importAffText(text: string): number {
  saveAffText(text);
  return countAffRules(text);
}

export function clearAffText() {
  localStorage.removeItem(AFF_KEY);
}

/** 当前已加载 .aff 的规则数（供设置面板展示） */
export function loadedAffRuleCount(): number {
  const text = loadAffText();
  return text ? countAffRules(text) : 0;
}

function countAffRules(text: string): number {
  const rules = parseAffixRules(text);
  const n =
    [...rules.suffixes.values()].reduce((a, l) => a + l.length, 0) +
    [...rules.prefixes.values()].reduce((a, l) => a + l.length, 0);
  return n;
}

let cache: { key: string; dict: Set<string>; affix: AffixRules | undefined } | null = null;

/** 当前生效的可接受词集合（含 affix 展开；带模块级缓存避免重复展开） */
export function activeSpellDictionary(): Set<string> {
  const words = loadPersonalDict();
  const affText = loadAffText();
  const key = affText + '\u0000' + words.join(',');
  if (!cache || cache.key !== key) {
    const dict = affText
      ? buildSpellDictionaryWithAffix(words, affText)
      : buildSpellDictionaryWithAffix(words, '');
    cache = { key, dict, affix: affText ? parseAffixRules(affText) : undefined };
  }
  return cache.dict;
}

/** 当前生效的 affix 规则（无则 undefined） */
export function activeSpellAffix(): AffixRules | undefined {
  const affText = loadAffText();
  if (!affText) return undefined;
  if (cache?.key === affText + '\u0000' + loadPersonalDict().join(',')) {
    return cache.affix;
  }
  return parseAffixRules(affText);
}
