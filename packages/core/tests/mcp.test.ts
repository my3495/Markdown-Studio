import { describe, it, expect } from 'vitest';
import { Vault } from '../src/vault/vault';
import { createMcpServer } from '../src/mcp/server';
import { serveOverLines, type LineIO } from '../src/mcp/stdio';
import { MCP_PROTOCOL_VERSION } from '../src/mcp/protocol';

function seed() {
  const v = new Vault();
  v.upsert({ id: 'a', name: 'Alpha.md', content: '# Alpha\n[[Beta]] 苹果 笔记' });
  v.upsert({ id: 'b', name: 'Beta.md', content: '# Beta\n回到 [[Alpha]]，香蕉' });
  return v;
}

describe('MCP 服务器', () => {
  it('initialize 返回协议版本与 serverInfo', () => {
    const srv = createMcpServer(seed());
    const r = srv.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(r?.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: 'markdown-studio-mcp' },
    });
  });

  it('tools/list 返回 9 个带 inputSchema 的工具', () => {
    const srv = createMcpServer(seed());
    const r = srv.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (r?.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
    expect(tools).toHaveLength(9);
    expect(tools.every((t) => typeof t.inputSchema === 'object')).toBe(true);
    expect(tools.map((t) => t.name)).toContain('search');
    expect(tools.map((t) => t.name)).toContain('write_note');
  });

  it('tools/call search 返回文本内容', () => {
    const srv = createMcpServer(seed());
    const r = srv.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: '苹果' } },
    });
    const res = r?.result as { content: { text: string }[]; isError: boolean };
    expect(res.isError).toBe(false);
    const payload = JSON.parse(res.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.data.map((h: any) => h.name)).toContain('Alpha.md');
  });

  it('只读模式下 tools/call write_note 被判为 isError', () => {
    const srv = createMcpServer(seed());
    const r = srv.handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'write_note', arguments: { name: 'X.md', content: 'y' } },
    });
    const res = r?.result as { isError: boolean };
    expect(res.isError).toBe(true);
  });

  it('allowWrite 后可写并读回', () => {
    const v = seed();
    const srv = createMcpServer(v, { allowWrite: true });
    const w = srv.handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'write_note', arguments: { name: 'Gamma.md', content: '# Gamma' } },
    });
    expect((w?.result as { isError: boolean }).isError).toBe(false);
    expect(v.list().some((n) => n.name === 'Gamma.md')).toBe(true);
  });

  it('未知方法返回 -32601，通知不响应', () => {
    const srv = createMcpServer(seed());
    const bad = srv.handle({ jsonrpc: '2.0', id: 6, method: 'nope' });
    expect(bad?.error?.code).toBe(-32601);
    const note = srv.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(note).toBeNull();
  });
});

describe('MCP stdio 桥接', () => {
  function fakeIo() {
    const out: string[] = [];
    let cb: (line: string) => void = () => {};
    const io: LineIO = {
      onLine: (fn) => {
        cb = fn;
      },
      write: (line) => out.push(line),
    };
    return { io, out, feed: (l: string) => cb(l) };
  }

  it('请求→响应行；通知→无输出；坏 JSON→解析错误', () => {
    const { io, out, feed } = fakeIo();
    serveOverLines(createMcpServer(seed()), io);

    feed(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    feed(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    feed('{ not json');

    expect(out).toHaveLength(2); // initialize 响应 + 解析错误
    expect(JSON.parse(out[0]!).result.serverInfo.name).toBe('markdown-studio-mcp');
    expect(JSON.parse(out[1]!).error.code).toBe(-32700);
  });
});
