/**
 * 公开只读分享：生成可序列化快照 + 短 id。
 * 实际上传/托管由上层（IndexedDB / 静态托管）完成。
 */

export interface ShareSnapshot {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  /** 只读标记 */
  readOnly: true;
}

export function createShareId(seed?: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return (seed ? `${seed}-` : '') + rand;
}

export function createShareSnapshot(title: string, content: string, id?: string): ShareSnapshot {
  return {
    id: id ?? createShareId(),
    title,
    content,
    createdAt: Date.now(),
    readOnly: true,
  };
}

const B64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const out = new Uint8Array((len * 3) >> 2);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64.indexOf(clean[i]!);
    const b = B64.indexOf(clean[i + 1]!);
    const c = B64.indexOf(clean[i + 2]!);
    const d = B64.indexOf(clean[i + 3]!);
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[o++] = ((c & 3) << 6) | d;
  }
  return out.slice(0, o);
}

/** 编码为 URL-safe base64 */
export function encodeSharePayload(snap: ShareSnapshot): string {
  const json = JSON.stringify(snap);
  return bytesToBase64(new TextEncoder().encode(json))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeSharePayload(payload: string): ShareSnapshot | null {
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = new TextDecoder().decode(base64ToBytes(b64 + pad));
    const obj = JSON.parse(json) as ShareSnapshot;
    if (!obj?.id || typeof obj.content !== 'string') return null;
    return { ...obj, readOnly: true };
  } catch {
    return null;
  }
}
