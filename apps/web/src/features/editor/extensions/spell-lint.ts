import { linter, type Diagnostic } from '@codemirror/lint';
import { checkSpelling } from '@md-studio/core';
import {
  activeSpellAffix,
  activeSpellDictionary,
  addToPersonalDict,
} from '../../../platform/spell/personalDict';

const IGNORE_KEY = 'md-studio-spell-ignore';

export function loadSpellIgnore(): Set<string> {
  try {
    const raw = localStorage.getItem(IGNORE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr.map((w) => w.toLowerCase()) : []);
  } catch {
    return new Set();
  }
}

export function addSpellIgnore(word: string) {
  const set = loadSpellIgnore();
  set.add(word.toLowerCase());
  localStorage.setItem(IGNORE_KEY, JSON.stringify([...set]));
}

export function spellLinter(enabled: () => boolean) {
  return linter(
    (view) => {
      if (!enabled()) return [];
      const text = view.state.doc.toString();
      const issues = checkSpelling(text, {
        dictionary: activeSpellDictionary(),
        affix: activeSpellAffix(),
        ignore: loadSpellIgnore(),
      });
      const diags: Diagnostic[] = issues.map((i) => ({
        from: i.from,
        to: i.to,
        severity: 'info' as const,
        message: i.message,
        source: 'spell',
        actions: [
          {
            name: '忽略',
            apply: () => {
              addSpellIgnore(i.word);
            },
          },
          {
            name: '加入词典',
            apply: () => {
              addToPersonalDict(i.word);
            },
          },
        ],
      }));
      return diags;
    },
    { delay: 600 }
  );
}
