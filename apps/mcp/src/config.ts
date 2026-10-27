/**
 * MCP 客户端配置生成 / 一键写入（Cursor / Claude Desktop）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type McpClient = 'cursor' | 'claude';

export interface McpConfigOptions {
  workspace: string;
  allowWrite?: boolean;
  client?: McpClient;
  /** 使用 npx 而非全局 bin */
  useNpx?: boolean;
}

export function buildServerEntry(opts: McpConfigOptions): Record<string, unknown> {
  const args: string[] = [];
  if (opts.useNpx) {
    args.push('-y', '@md-studio/mcp');
  }
  args.push('--workspace', opts.workspace);
  if (opts.allowWrite) args.push('--allow-write');
  return {
    command: opts.useNpx ? 'npx' : 'md-studio-mcp',
    args: opts.useNpx ? args : args,
  };
}

export function buildMcpServersJson(opts: McpConfigOptions): { mcpServers: Record<string, unknown> } {
  return {
    mcpServers: {
      'markdown-studio': buildServerEntry(opts),
    },
  };
}

export function clientConfigPath(client: McpClient): string {
  const home = homedir();
  if (client === 'claude') {
    if (process.platform === 'darwin') {
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    }
    if (process.platform === 'win32') {
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    }
    return join(home, '.config', 'Claude', 'claude_desktop_config.json');
  }
  // Cursor
  if (process.platform === 'win32') {
    return join(process.env.USERPROFILE ?? home, '.cursor', 'mcp.json');
  }
  return join(home, '.cursor', 'mcp.json');
}

/** 合并写入客户端 MCP 配置，返回写入路径 */
export function installMcpConfig(opts: McpConfigOptions): { path: string; created: boolean } {
  const client = opts.client ?? 'cursor';
  const path = clientConfigPath(client);
  const entry = buildServerEntry(opts);
  let created = false;
  let root: any = { mcpServers: {} };
  if (existsSync(path)) {
    try {
      root = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      root = { mcpServers: {} };
    }
  } else {
    created = true;
    mkdirSync(dirname(path), { recursive: true });
  }
  if (!root.mcpServers || typeof root.mcpServers !== 'object') root.mcpServers = {};
  root.mcpServers['markdown-studio'] = entry;
  writeFileSync(path, JSON.stringify(root, null, 2) + '\n', 'utf8');
  return { path, created };
}
