/**
 * 本地 REST API（E3）：供 Alfred / Raycast / n8n 等调用。
 * 纯函数处理 HTTP 请求；鉴权 Bearer token；读写分离。
 */

import type { Vault } from '../vault/vault';
import { createVaultTools, type ToolsOptions } from '../agent/tools';

export interface RestReq {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body?: string;
}

export interface RestRes {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface RestOptions extends ToolsOptions {
  /** Authorization: Bearer <token>；未设置则不鉴权（仅建议本机） */
  token?: string;
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

function json(status: number, data: unknown): RestRes {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
    body: JSON.stringify(data),
  };
}

function pathnameOf(url: string): string {
  return (url.split('?')[0] || '/').replace(/\/+$/, '') || '/';
}

function queryOf(url: string): URLSearchParams {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  return new URLSearchParams(q);
}

function parseBody(body?: string): Record<string, unknown> {
  if (!body) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 处理 REST 请求 */
export function handleRest(vault: Vault, req: RestReq, opts: RestOptions = {}): RestRes {
  if (req.method === 'OPTIONS') {
    return { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' }, body: '' };
  }

  if (opts.token) {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${opts.token}`) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
  }

  const path = pathnameOf(req.url);
  const qs = queryOf(req.url);
  const tools = createVaultTools(vault, { allowWrite: opts.allowWrite });

  if (req.method === 'GET' && (path === '/' || path === '/health')) {
    return json(200, { ok: true, name: 'markdown-studio-rest', notes: vault.size });
  }

  if (req.method === 'GET' && path === '/notes') {
    const r = tools.list_notes();
    return json(r.ok ? 200 : 500, r);
  }

  if (req.method === 'GET' && path.startsWith('/notes/')) {
    const id = decodeURIComponent(path.slice('/notes/'.length));
    const r = tools.read_note({ id });
    return json(r.ok ? 200 : 404, r);
  }

  if (req.method === 'GET' && path === '/search') {
    const query = qs.get('q') ?? qs.get('query') ?? '';
    const limit = Number(qs.get('limit') ?? 20);
    const r = tools.search({ query, limit });
    // 入参非法（如缺 q）时与「未找到」区分开，返回 400 而非 200
    return json(r.ok ? 200 : 400, r);
  }

  if (req.method === 'GET' && path.startsWith('/backlinks/')) {
    const id = decodeURIComponent(path.slice('/backlinks/'.length));
    const r = tools.get_backlinks({ id });
    return json(r.ok ? 200 : 404, r);
  }

  if (req.method === 'POST' && path === '/notes') {
    const body = parseBody(req.body);
    const r = tools.write_note({
      name: String(body.name ?? 'untitled.md'),
      content: String(body.content ?? ''),
      id: body.id ? String(body.id) : undefined,
    });
    return json(r.ok ? 201 : 403, r);
  }

  if (req.method === 'PUT' && path.startsWith('/notes/')) {
    const id = decodeURIComponent(path.slice('/notes/'.length));
    const body = parseBody(req.body);
    const existing = tools.read_note({ id });
    if (!existing.ok || !existing.data) return json(404, existing);
    const name = String(body.name ?? existing.data.note.name);
    const content =
      body.content !== undefined ? String(body.content) : existing.data.note.content;
    const r = tools.write_note({ id, name, content });
    return json(r.ok ? 200 : 403, r);
  }

  if (req.method === 'DELETE' && path.startsWith('/notes/')) {
    const id = decodeURIComponent(path.slice('/notes/'.length));
    const r = tools.delete_note({ id });
    return json(r.ok ? 200 : 403, r);
  }

  if (req.method === 'POST' && path === '/search') {
    const body = parseBody(req.body);
    const r = tools.search({
      query: String(body.query ?? ''),
      limit: typeof body.limit === 'number' ? body.limit : 20,
    });
    return json(r.ok ? 200 : 400, r);
  }

  return json(404, { ok: false, error: 'not found' });
}
