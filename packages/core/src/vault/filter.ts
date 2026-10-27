/**
 * 保存的过滤视图 / Inbox：按 frontmatter 字段匹配笔记。
 */

import { parseFrontmatter } from '../frontmatter';
import type { VaultNote } from './vault';

export type FilterOp = 'eq' | 'contains' | 'exists' | 'missing';

export interface FilterRule {
  /** frontmatter key，如 status / tags */
  field: string;
  op: FilterOp;
  /** eq / contains 时使用 */
  value?: string;
}

export interface SavedView {
  id: string;
  name: string;
  rules: FilterRule[];
}

/** 内置 Inbox：status=inbox 或 tags 含 inbox */
export const INBOX_VIEW: SavedView = {
  id: 'inbox',
  name: 'Inbox',
  rules: [
    { field: 'status', op: 'eq', value: 'inbox' },
    { field: 'tags', op: 'contains', value: 'inbox' },
  ],
};

function fieldValue(content: string, field: string): string | null {
  const doc = parseFrontmatter(content);
  if (!doc.present) return null;
  const f = doc.fields.find((x) => x.kind === 'pair' && x.key === field);
  return f ? f.value : null;
}

function matchRule(content: string, rule: FilterRule): boolean {
  const raw = fieldValue(content, rule.field);
  switch (rule.op) {
    case 'exists':
      return raw !== null && raw.trim() !== '';
    case 'missing':
      return raw === null || raw.trim() === '';
    case 'eq':
      return (raw ?? '').trim().toLowerCase() === (rule.value ?? '').trim().toLowerCase();
    case 'contains': {
      const v = (rule.value ?? '').trim().toLowerCase();
      if (!v) return false;
      return (raw ?? '').toLowerCase().includes(v);
    }
    default:
      return false;
  }
}

/** 任一规则命中即通过（OR）；空 rules 匹配全部 */
export function noteMatchesView(note: VaultNote, view: SavedView): boolean {
  if (view.rules.length === 0) return true;
  return view.rules.some((r) => matchRule(note.content, r));
}

export function filterNotes(notes: VaultNote[], view: SavedView): VaultNote[] {
  return notes.filter((n) => noteMatchesView(n, view));
}
