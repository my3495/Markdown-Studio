/**
 * MCP stdio 传输桥接（传输无关）：按行读取 JSON-RPC（NDJSON），写回响应行。
 * 不依赖 Node API，可在任意环境用注入的 io 单测；Node 侧用 readline 接入即可。
 */

import type { McpServer } from './server';
import type { JsonRpcRequest } from './protocol';

export interface LineIO {
  onLine(cb: (line: string) => void): void;
  write(line: string): void;
}

const ERR_PARSE = -32700;

/** 将 MCP 服务器桥接到按行的 IO（stdio / socket / 测试假流） */
export function serveOverLines(server: McpServer, io: LineIO): void {
  io.onLine((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      io.write(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: ERR_PARSE, message: 'Parse error' } }) + '\n'
      );
      return;
    }
    const res = server.handle(msg);
    if (res) io.write(JSON.stringify(res) + '\n');
  });
}
