/**
 * MCP（Model Context Protocol）协议类型与工具描述。
 * 纯类型/纯数据，无运行时依赖；供 createMcpServer 与测试复用。
 */

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

/** MCP 工具描述（tools/list 返回项） */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** 供 read_note / get_* 复用：按 id 或 name 定位 */
const ID_OR_NAME = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '笔记 id' },
    name: { type: 'string', description: '笔记名（可无 .md 后缀）' },
  },
};

const SCHEMAS: Record<string, Record<string, unknown>> = {
  list_notes: { type: 'object', properties: {}, additionalProperties: false },
  read_note: { ...ID_OR_NAME },
  search: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'number', default: 20 },
    },
    required: ['query'],
  },
  get_outline: { ...ID_OR_NAME },
  get_backlinks: { ...ID_OR_NAME },
  get_outgoing: { ...ID_OR_NAME },
  write_note: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      content: { type: 'string' },
      id: { type: 'string' },
    },
    required: ['name', 'content'],
  },
  append_to_note: {
    type: 'object',
    properties: { text: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' } },
    required: ['text'],
  },
  delete_note: { ...ID_OR_NAME },
};

/** 将 VaultTools.manifest() 转为 MCP 工具描述（附带 inputSchema） */
export function toolDescriptors(
  manifest: { name: string; write: boolean; description: string }[]
): McpTool[] {
  return manifest.map((m) => ({
    name: m.name,
    description: m.write ? `${m.description}（写操作，需 allowWrite）` : m.description,
    inputSchema: SCHEMAS[m.name] ?? { type: 'object', properties: {} },
  }));
}
