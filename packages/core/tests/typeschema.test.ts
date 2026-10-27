import { describe, it, expect } from 'vitest';
import {
  getNoteType,
  missingTypeFields,
  typedOutgoing,
} from '../src/vault/typeschema';

describe('typeschema', () => {
  it('解析 type 并列出缺失字段', () => {
    const md = '---\ntype: person\norg: Acme\n---\n# Alice';
    expect(getNoteType(md)?.id).toBe('person');
    const missing = missingTypeFields(md).map((f) => f.key);
    expect(missing).toContain('role');
    expect(missing).toContain('related');
    expect(missing).not.toContain('org');
  });

  it('typedOutgoing 解析关系', () => {
    const note = {
      id: 'a.md',
      name: 'a.md',
      content: '---\ntype: project\nowner: Bob\ndepends: [x, y]\n---\n# P',
    };
    const links = typedOutgoing(note);
    expect(links.map((l) => `${l.field}:${l.target}`).sort()).toEqual([
      'depends:x',
      'depends:y',
      'owner:Bob',
    ]);
  });
});
