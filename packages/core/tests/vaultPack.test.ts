import { describe, it, expect } from 'vitest';
import { decryptNotePack, encryptNotePack, isEncryptedPack } from '../src/crypto/vaultPack';

describe('vaultPack crypto', () => {
  it('往返加密', async () => {
    const pack = await encryptNotePack('a.md', '# Secret\n\nhello', 'correct horse');
    expect(isEncryptedPack(pack)).toBe(true);
    const out = await decryptNotePack(pack, 'correct horse');
    expect(out.content).toContain('# Secret');
    expect(out.title).toBe('a.md');
  });

  it('错误口令 fail-closed', async () => {
    const pack = await encryptNotePack('a.md', 'top secret', 'right');
    await expect(decryptNotePack(pack, 'wrong')).rejects.toThrow(/decrypt failed/);
  });
});
