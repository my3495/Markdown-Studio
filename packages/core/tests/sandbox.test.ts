import { describe, it, expect } from 'vitest';
import { Vault } from '../src/vault/vault';
import { createSandboxSession } from '../src/agent/sandbox';

describe('agent sandbox', () => {
  it('写入先入队，Accept 后落库', () => {
    const vault = new Vault();
    vault.upsert({ id: 'a', name: 'a.md', content: 'old' });
    const sb = createSandboxSession(vault, { allowWrite: true });
    const w = sb.tools.write_note({ id: 'a', name: 'a.md', content: 'new' });
    expect(w.ok).toBe(true);
    expect(vault.get('a')!.content).toBe('old');
    expect(sb.pending()).toHaveLength(1);
    expect(sb.acceptAll()).toBe(1);
    expect(vault.get('a')!.content).toBe('new');
  });

  it('Reject 丢弃变更', () => {
    const vault = new Vault();
    const sb = createSandboxSession(vault, { allowWrite: true });
    sb.tools.write_note({ name: 'x.md', content: 'x', id: 'x' });
    expect(sb.rejectAll()).toBe(1);
    expect(vault.get('x')).toBeNull();
  });
});
