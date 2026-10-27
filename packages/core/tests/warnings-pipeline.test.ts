import { describe, it, expect } from 'vitest';
import { render } from '../src/parser/pipeline';

describe('render warnings', () => {
  it('返回中文排版 lint warnings', async () => {
    const r = await render('使用React框架和...', {
      typography: { punctuation: true, ellipsis: true, quotes: true, spacing: false },
    });
    expect(Array.isArray(r.warnings)).toBe(true);
    expect((r.warnings?.length ?? 0) + (r.strictIssues ?? 0)).toBeGreaterThan(0);
  });
});
