/**
 * MCP over HTTP（Streamable，简化版）：POST JSON-RPC ↔ JSON 响应，支持批量、
 * 通知(202)、Bearer 鉴权、CORS 预检与 /health。纯函数、可单测；
 * Node 侧用 node:http 接入（见 apps/mcp）。
 */

import type { McpServer } from './server';
import type { JsonRpcRequest } from './protocol';

export interface HttpReq {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body?: string;
}

export interface HttpRes {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HttpOptions {
  /** 命中路径（默认 /mcp） */
  path?: string;
  /** 设置后要求 Authorization: Bearer <token> */
  token?: string;
}

const CORS = { 'access-control-allow-origin': '*' };

function json(status: number, obj: unknown, extra: Record<string, string> = {}): HttpRes {
  return { status, headers: { 'content-type': 'application/json', ...CORS, ...extra }, body: JSON.stringify(obj) };
}

function pathnameOf(url: string): string {
  return (url.split('?')[0] || '/').replace(/\/+$/, '') || '/';
}

/** 处理一个 HTTP 请求 → 响应（POST 支持单体/批量/通知） */
export function handleHttp(server: McpServer, req: HttpReq, opts: HttpOptions = {}): HttpRes {
  const path = opts.path ?? '/mcp';

  if (req.method === 'OPTIONS') {
    return {
      status: 204,
      headers: {
        ...CORS,
        'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version',
        'access-control-allow-methods': 'POST, GET, OPTIONS',
        'access-control-max-age': '86400',
      },
      body: '',
    };
  }

  if (opts.token) {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${opts.token}`) {
      return json(401, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Unauthorized' } });
    }
  }

  const pathname = pathnameOf(req.url);

  if (req.method === 'GET') {
    if (pathname === '/health' || pathname === '/') {
      return json(200, { ok: true, name: 'markdown-studio-mcp', transport: 'http' });
    }
    return json(404, { error: 'Not found' });
  }

  if (req.method === 'POST') {
    if (pathname !== path && pathname !== '/') {
      return json(404, { error: 'Not found' });
    }
    let msg: JsonRpcRequest | JsonRpcRequest[];
    try {
      msg = JSON.parse(req.body || '') as JsonRpcRequest | JsonRpcRequest[];
    } catch {
      return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    if (Array.isArray(msg)) {
      const responses = msg.map((m) => server.handle(m)).filter((r): r is NonNullable<typeof r> => r !== null);
      if (responses.length === 0) return { status: 202, headers: { ...CORS }, body: '' };
      return json(200, responses);
    }
    const res = server.handle(msg);
    if (!res) return { status: 202, headers: { ...CORS }, body: '' };
    return json(200, res);
  }

  return { status: 405, headers: { allow: 'POST, GET, OPTIONS', ...CORS }, body: '' };
}
