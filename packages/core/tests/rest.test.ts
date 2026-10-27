import { describe, it, expect } from 'vitest';
import { Vault } from '../src/vault/vault';
import { handleRest } from '../src/rest/api';

function seed() {
  const v = new Vault();
  v.upsert({ id: 'a.md', name: 'a.md', content: '# A 苹果 [[b]]' });
  v.upsert({ id: 'b.md', name: 'b.md', content: '# B' });
  return v;
}

describe('REST API', () => {
  it('GET /notes 列出笔记', () => {
    const res = handleRest(seed(), { method: 'GET', url: '/notes', headers: {} });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.length).toBe(2);
  });

  it('GET /search?q=', () => {
    const res = handleRest(seed(), { method: 'GET', url: '/search?q=苹果', headers: {} });
    const body = JSON.parse(res.body);
    expect(body.data.some((x: any) => x.id === 'a.md')).toBe(true);
  });

  it('Bearer 鉴权', () => {
    const v = seed();
    const denied = handleRest(
      v,
      { method: 'GET', url: '/notes', headers: {} },
      { token: 'secret' }
    );
    expect(denied.status).toBe(401);
    const ok = handleRest(
      v,
      { method: 'GET', url: '/notes', headers: { authorization: 'Bearer secret' } },
      { token: 'secret' }
    );
    expect(ok.status).toBe(200);
  });

  it('写操作默认拒绝', () => {
    const res = handleRest(seed(), {
      method: 'POST',
      url: '/notes',
      headers: {},
      body: JSON.stringify({ name: 'c.md', content: '# C' }),
    });
    expect(res.status).toBe(403);
  });

  it('allowWrite 可创建', () => {
    const v = seed();
    const res = handleRest(
      v,
      {
        method: 'POST',
        url: '/notes',
        headers: {},
        body: JSON.stringify({ id: 'c.md', name: 'c.md', content: '# C' }),
      },
      { allowWrite: true }
    );
    expect(res.status).toBe(201);
    expect(v.get('c.md')?.content).toContain('# C');
  });
});
