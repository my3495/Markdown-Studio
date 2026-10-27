import { describe, it, expect } from 'vitest';
import { buildMcpServersJson, buildServerEntry, clientConfigPath } from '../src/config';

describe('mcp config', () => {
  it('buildServerEntry 默认用 bin', () => {
    const e = buildServerEntry({ workspace: '/notes' });
    expect(e.command).toBe('md-studio-mcp');
    expect(e.args).toEqual(['--workspace', '/notes']);
  });

  it('buildServerEntry --npx 形态', () => {
    const e = buildServerEntry({ workspace: '/notes', useNpx: true, allowWrite: true });
    expect(e.command).toBe('npx');
    expect(e.args).toEqual(['-y', '@md-studio/mcp', '--workspace', '/notes', '--allow-write']);
  });

  it('buildMcpServersJson 含 markdown-studio', () => {
    const j = buildMcpServersJson({ workspace: '/v' });
    expect(j.mcpServers['markdown-studio']).toBeTruthy();
  });

  it('clientConfigPath 返回路径', () => {
    expect(clientConfigPath('cursor')).toMatch(/mcp\.json$/);
    expect(clientConfigPath('claude')).toMatch(/claude_desktop_config\.json$/);
  });
});
