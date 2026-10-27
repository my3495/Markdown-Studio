import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createMcpServer } from '@md-studio/core/mcp';
import { serveOverLines } from '@md-studio/core/mcp/stdio';
import { handleHttp } from '@md-studio/core/mcp/http';
import { handleRest } from '@md-studio/core';
import { buildMcpServersJson, installMcpConfig, type McpClient } from './config';
import { collectWorkspaces, loadWorkspaces } from './workspace';

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function printHelp(): void {
  process.stderr.write(`md-studio-mcp — Markdown Studio MCP 服务器

用法:
  md-studio-mcp [--workspace <dir>]... [--allow-write] [--http|--rest] [--port N] [--token T]
  md-studio-mcp config  --workspace <dir> [--allow-write] [--client cursor|claude] [--npx]
  md-studio-mcp install --workspace <dir> [--allow-write] [--client cursor|claude] [--npx]

多库联邦:
  md-studio-mcp --workspace ~/Notes --workspace ~/Work
  md-studio-mcp --workspace ~/Notes,~/Work

传输:
  (默认) stdio MCP
  --http   MCP over HTTP（/mcp）
  --rest   REST API（/notes /search，供 Alfred/Raycast/n8n）

子命令:
  config   打印 mcpServers JSON（可粘贴到客户端配置）
  install  写入 Cursor (~/.cursor/mcp.json) 或 Claude Desktop 配置

示例:
  npx -y @md-studio/mcp --workspace ~/Notes
  md-studio-mcp --rest --workspace ~/Notes --token secret --port 3722
  md-studio-mcp install --workspace ~/Notes --client cursor --npx
`);
}

function runConfigCommands(cmd: 'config' | 'install', argv: string[]): void {
  const workspace = resolve(argValue(argv, '--workspace') ?? process.cwd());
  const allowWrite = argv.includes('--allow-write');
  const client = (argValue(argv, '--client') as McpClient | undefined) ?? 'cursor';
  const useNpx = argv.includes('--npx');
  if (cmd === 'config') {
    const json = buildMcpServersJson({ workspace, allowWrite, client, useNpx });
    process.stdout.write(JSON.stringify(json, null, 2) + '\n');
    return;
  }
  const { path, created } = installMcpConfig({ workspace, allowWrite, client, useNpx });
  process.stderr.write(
    `[md-studio-mcp] ${created ? 'created' : 'updated'} ${path} (client=${client}, workspace=${workspace})\n`
  );
}

function runServer(argv: string[]): void {
  const workspaces = collectWorkspaces(argv);
  const dirs = workspaces.length ? workspaces : [process.cwd()];
  const allowWrite = argv.includes('--allow-write');
  const vault = loadWorkspaces(dirs);
  const server = createMcpServer(vault, {
    allowWrite,
    info: { name: 'markdown-studio-mcp', version: '1.0.0' },
  });

  const useRest = argv.includes('--rest');
  const useHttp = argv.includes('--http') || useRest;
  if (useHttp) {
    const port = Number(argValue(argv, '--port') ?? (useRest ? 3722 : 3721));
    const token = argValue(argv, '--token');
    const http = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 1e7) req.destroy();
      });
      req.on('end', () => {
        const common = {
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          headers: req.headers as Record<string, string | undefined>,
          body,
        };
        const out = useRest
          ? handleRest(vault, common, { token, allowWrite })
          : handleHttp(server, common, { token });
        res.writeHead(out.status, out.headers);
        res.end(out.body);
      });
    });
    http.listen(port, '127.0.0.1', () => {
      const mode = useRest ? 'REST' : 'MCP-HTTP';
      const path = useRest ? '/notes' : '/mcp';
      process.stderr.write(
        `[md-studio-mcp] ${mode} http://127.0.0.1:${port}${path} notes=${vault.size} workspaces=${dirs.length} allowWrite=${allowWrite} auth=${token ? 'on' : 'off'}\n`
      );
    });
  } else {
    const rl = createInterface({ input: process.stdin, terminal: false });
    serveOverLines(server, {
      onLine: (cb) => {
        rl.on('line', cb);
      },
      write: (line) => {
        process.stdout.write(line);
      },
    });
    process.stderr.write(
      `[md-studio-mcp] stdio workspaces=${dirs.join(';')} notes=${vault.size} allowWrite=${allowWrite}\n`
    );
  }
}

const argv = process.argv.slice(2);
const cmd = argv[0];
if (cmd === '-h' || cmd === '--help' || cmd === 'help') {
  printHelp();
} else if (cmd === 'config' || cmd === 'install') {
  runConfigCommands(cmd, argv.slice(1));
} else {
  runServer(argv);
}
