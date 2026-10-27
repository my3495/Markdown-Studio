import { describe, it, expect } from 'vitest';
import { filterNotes, INBOX_VIEW, type SavedView } from '../src/vault/filter';
import type { VaultNote } from '../src/vault/vault';

function note(id: string, content: string): VaultNote {
  return { id, name: `${id}.md`, content };
}

describe('filter / Inbox', () => {
  const notes = [
    note('a', '---\nstatus: inbox\n---\n# A'),
    note('b', '---\ntags: [work, inbox]\n---\n# B'),
    note('c', '---\nstatus: done\n---\n# C'),
    note('d', '# no fm'),
  ];

  it('Inbox 匹配 status 或 tags', () => {
    const hit = filterNotes(notes, INBOX_VIEW).map((n) => n.id);
    expect(hit).toEqual(['a', 'b']);
  });

  it('自定义 eq 视图', () => {
    const view: SavedView = {
      id: 'done',
      name: 'Done',
      rules: [{ field: 'status', op: 'eq', value: 'done' }],
    };
    expect(filterNotes(notes, view).map((n) => n.id)).toEqual(['c']);
  });
});
