/**
 * 轻量拼写检查（B3 增强）：英文词表 + affix 规则 + 忽略列表。
 * affix 支持 Hunspell .aff 子集（见 ./affix.ts）；CJK 仍走排版 lint。
 */

import { expandWithAffix, type AffixRules } from './affix';

export interface SpellIssue {
  word: string;
  from: number;
  to: number;
  line: number;
  column: number;
  message: string;
}

/** 精简常用英文词表（可被上层合并扩展） */
export const DEFAULT_EN_DICT = new Set(
  `
the be to of and a in that have i it for not on with he as you do at this but his by from
they we say her she or an will my one all would there their what so up out if about who get
which go me when make can like time no just him know take people into year your good some
could them see other than then now look only come its over think also back after use two
how our work first well way even new want because any these give day most us is are was were
been has had did does am writing markdown studio note notes project meeting person related
status tags inbox done draft todo read write file folder vault agent recipe slide vim latex
pandoc html pdf export import search graph outline property frontmatter encode token hello
`.split(/\s+/).filter(Boolean)
);

const WORD_RE = /\b[A-Za-z][A-Za-z'-]{1,}\b/g;

export interface SpellOptions {
  dictionary?: Set<string>;
  ignore?: Set<string>;
  /** Hunspell affix 规则（可选）；提供后按规则展开词干 */
  affix?: AffixRules;
  /** 跳过代码围栏与行内代码 */
  skipCode?: boolean;
}

/** 词表 + affix 展开后的可接受集合（带缓存，避免逐词重复展开） */
const acceptedCache = new WeakMap<Set<string>, Map<AffixRules, Set<string>>>();

function buildAccepted(dict: Set<string>, affix: AffixRules | undefined): Set<string> {
  if (!affix) return dict;
  let perDict = acceptedCache.get(dict);
  if (!perDict) {
    perDict = new Map();
    acceptedCache.set(dict, perDict);
  }
  let accepted = perDict.get(affix);
  if (!accepted) {
    accepted = expandWithAffix(dict, affix);
    perDict.set(affix, accepted);
  }
  return accepted;
}

function stripCode(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
    .replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
}

export function checkSpelling(text: string, opts: SpellOptions = {}): SpellIssue[] {
  const base = opts.dictionary ?? DEFAULT_EN_DICT;
  const dict = buildAccepted(base, opts.affix);
  const ignore = opts.ignore ?? new Set<string>();
  const source = opts.skipCode === false ? text : stripCode(text);
  const issues: SpellIssue[] = [];
  const lines = text.split(/\n/);
  // 用原始 text 算行列，在 source 上找词（代码区已空格化）
  let offset = 0;
  const srcLines = source.split(/\n/);
  for (let li = 0; li < srcLines.length; li++) {
    const line = srcLines[li] ?? '';
    const orig = lines[li] ?? line;
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(line))) {
      const word = m[0];
      const lower = word.toLowerCase();
      if (ignore.has(lower) || dict.has(lower)) continue;
      // 全大写缩写跳过
      if (/^[A-Z]{2,}$/.test(word)) continue;
      const from = offset + m.index;
      issues.push({
        word,
        from,
        to: from + word.length,
        line: li + 1,
        column: m.index + 1,
        message: `可能的拼写错误：${word}`,
      });
      // 限制单次结果数量
      if (issues.length >= 80) return issues;
    }
    offset += orig.length + 1;
  }
  return issues;
}
