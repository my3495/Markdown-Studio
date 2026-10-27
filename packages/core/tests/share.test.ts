import { describe, it, expect } from 'vitest';
import {
  createShareSnapshot,
  decodeSharePayload,
  encodeSharePayload,
} from '../src/share/snapshot';

describe('share snapshot', () => {
  it('往返编码', () => {
    const snap = createShareSnapshot('Demo', '# Hello\n\nworld');
    const payload = encodeSharePayload(snap);
    const back = decodeSharePayload(payload);
    expect(back?.title).toBe('Demo');
    expect(back?.content).toContain('# Hello');
    expect(back?.readOnly).toBe(true);
  });

  it('非法 payload 返回 null', () => {
    expect(decodeSharePayload('!!!')).toBeNull();
  });
});
