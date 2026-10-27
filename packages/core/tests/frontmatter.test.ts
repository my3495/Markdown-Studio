import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  serializeFrontmatter,
  setFrontmatterField,
  removeFrontmatterField,
} from '../src/frontmatter';

describe('frontmatter', () => {
  it('解析并保留注释与引号', () => {
    const src = `---\n# meta\ntitle: "你好"\nauthor: 'Bob'\ntags: a\n---\n\n# Body\n`;
    const doc = parseFrontmatter(src);
    expect(doc.present).toBe(true);
    expect(doc.fields.some((f) => f.kind === 'comment')).toBe(true);
    const title = doc.fields.find((f) => f.key === 'title')!;
    expect(title.value).toBe('你好');
    expect(title.quote).toBe('"');
    const author = doc.fields.find((f) => f.key === 'author')!;
    expect(author.quote).toBe("'");
    expect(doc.body.startsWith('# Body') || doc.body.includes('# Body')).toBe(true);
  });

  it('回写保留注释行与引号风格', () => {
    const src = `---\n# keep\ntitle: "X"\n---\nbody`;
    const doc = setFrontmatterField(parseFrontmatter(src), 'title', 'Y');
    const out = serializeFrontmatter(doc);
    expect(out).toContain('# keep');
    expect(out).toContain('title: "Y"');
    expect(out).toContain('body');
  });

  it('无 frontmatter 时 set 会创建围栏', () => {
    const doc = setFrontmatterField(parseFrontmatter('# hi\n'), 'title', 'T');
    const out = serializeFrontmatter(doc);
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('title: T');
    expect(out).toContain('# hi');
  });

  it('删除字段', () => {
    const doc = removeFrontmatterField(
      parseFrontmatter(`---\na: 1\nb: 2\n---\nx`),
      'a'
    );
    const out = serializeFrontmatter(doc);
    expect(out).not.toContain('a: 1');
    expect(out).toContain('b: 2');
  });
});
