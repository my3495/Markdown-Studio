import { describe, it, expect } from 'vitest';
import { Vault } from '../src/vault/vault';
import { createMcpServer } from '../src/mcp/server';
import { handleHttp, type HttpReq } from '../src/mcp/http';

function seed() {
  const v = new Vault();
  v.upsert({ id: 'a', name: 'Alpha.md', content: '# Alpha 苹果' });
  return v;
}

const post = (body: string, headers: Record<string, string> = {}, url = '/mcp'): HttpReq => ({
  method: 'POST',
  url,
  headers: { 'content-type': 'application/json', ...headers },
  body,
});

describe('MCP over HTTP', () => {
  it('POST initialize → 200 JSON', () => {
    const res = handleHttp(createMcpServer(seed()), post('{"jsonrpc":"2.0","id":1,"method":"initialize"}'));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).result.serverInfo.name).toBe('markdown-studio-mcp');
  });

  it('POST 通知 → 202 空体', () => {
    const res = handleHttp(createMcpServer(seed()), post('{"jsonrpc":"2.0","method":"notifications/initialized"}'));
    expect(res.status).toBe(202);
    expect(res.body).toBe('');
  });

  it('POST 批量 → 数组响应', () => {
    const res = handleHttp(
      createMcpServer(seed()),
      post('[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"tools/list"}]')
    );
    const arr = JSON.parse(res.body);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(2);
  });

  it('坏 JSON → 400 解析错误', () => {
    const res = handleHttp(createMcpServer(seed()), post('{bad'));
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe(-32700);
  });

  it('GET /health → 200', () => {
    const res = handleHttp(createMcpServer(seed()), { method: 'GET', url: '/health', headers: {} });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('OPTIONS 预检 → 204 带 CORS', () => {
    const res = handleHttp(createMcpServer(seed()), { method: 'OPTIONS', url: '/mcp', headers: {} });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('Bearer 鉴权：缺/错 → 401，正确 → 200', () => {
    const server = createMcpServer(seed());
    const noAuth = handleHttp(server, post('{"jsonrpc":"2.0","id":1,"method":"ping"}'), { token: 'sekret' });
    expect(noAuth.status).toBe(401);
    const wrong = handleHttp(server, post('{"jsonrpc":"2.0","id":1,"method":"ping"}', { authorization: 'Bearer nope' }), { token: 'sekret' });
    expect(wrong.status).toBe(401);
    const ok = handleHttp(server, post('{"jsonrpc":"2.0","id":1,"method":"ping"}', { authorization: 'Bearer sekret' }), { token: 'sekret' });
    expect(ok.status).toBe(200);
  });

  it('只读模式 tools/call 写 → isError', () => {
    const res = handleHttp(
      createMcpServer(seed()),
      post('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"write_note","arguments":{"name":"X","content":"y"}}}')
    );
    expect(JSON.parse(res.body).result.isError).toBe(true);
  });
});
