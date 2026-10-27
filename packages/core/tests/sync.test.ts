import { describe, it, expect } from 'vitest';
import {
  encryptSyncBundle,
  decryptSyncBundle,
  mergeSyncNotes,
  packSyncBundle,
} from '../src/sync/remote';

describe('sync remote', () => {
  it('加密往返', async () => {
    const bundle = packSyncBundle([
      { id: 'a', name: 'a.md', content: '# A', updatedAt: 1 },
    ]);
    const pack = await encryptSyncBundle(bundle, 'secret');
    const back = await decryptSyncBundle(pack, 'secret');
    expect(back.notes[0]?.content).toBe('# A');
  });

  it('merge 按 updatedAt', () => {
    const merged = mergeSyncNotes(
      [{ id: 'a', name: 'a.md', content: 'old', updatedAt: 1 }],
      [{ id: 'a', name: 'a.md', content: 'new', updatedAt: 2 }]
    );
    expect(merged[0]?.content).toBe('new');
  });
});
