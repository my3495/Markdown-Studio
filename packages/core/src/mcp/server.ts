/**
 * MCP 服务器（协议处理层）：把 VaultTools 以 JSON-RPC 暴露。
 * 纯逻辑、可单测；stdio / HTTP 传输由上层（Node CLI / Tauri 命令）接入。
 */

import type { Vault } from '../vault/vault';
import { createVaultTools } from '../agent/tools';
import {
  MCP_PROTOCOL_VERSION,
  toolDescriptors,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpTool,
} from './protocol';

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpServer {
  /** 处理一条 JSON-RPC 消息；返回 null 表示“通知无需响应” */
  handle(msg: JsonRpcRequest): JsonRpcResponse | null;
  /** 工具描述（等价于 tools/list 的 result.tools） */
  tools(): McpTool[];
}

export interface McpServerOptions {
  info?: McpServerInfo;
  allowWrite?: boolean;
}

const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INTERNAL = -32603;

export function createMcpServer(vault: Vault, opts: McpServerOptions = {}): McpServer {
  const tools = createVaultTools(vault, { allowWrite: opts.allowWrite ?? false });
  const info: McpServerInfo = opts.info ?? { name: 'markdown-studio-mcp', version: '1.0.0' };
  const descriptors = toolDescriptors(tools.manifest());

  const respond = (id: number | string | null, result: unknown): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  });
  const fail = (id: number | string | null, code: number, message: string, data?: unknown): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id: id ?? null,
    error: data === undefined ? { code, message } : { code, message, data },
  });

  return {
    tools: () => descriptors,

    handle(msg) {
      const id = msg.id ?? null;
      const isNotification = msg.id === undefined || msg.id === null;
      const params = (msg.params ?? {}) as Record<string, unknown>;
      try {
        switch (msg.method) {
          case 'initialize':
            return respond(id, {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: false } },
              serverInfo: info,
            });
          case 'ping':
            return respond(id, {});
          case 'tools/list':
            return respond(id, { tools: descriptors });
          case 'tools/call': {
            const name = String(params.name ?? '');
            const args = (params.arguments ?? {}) as Record<string, unknown>;
            const res = tools.call(name, args);
            return respond(id, {
              content: [{ type: 'text', text: JSON.stringify(res) }],
              isError: !res.ok,
            });
          }
          case 'notifications/initialized':
          case 'initialized':
            return null;
          default:
            return isNotification ? null : fail(id, ERR_METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
        }
      } catch (e) {
        return isNotification
          ? null
          : fail(id, ERR_INTERNAL, 'Internal error', e instanceof Error ? e.message : String(e));
      }
    },
  };
}
