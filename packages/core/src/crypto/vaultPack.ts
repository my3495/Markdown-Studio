/**
 * A3-lite：口令加密笔记包（PBKDF2 + AES-GCM / XChaCha20-Poly1305）。
 * fail-closed：解密失败抛错，不返回部分明文。
 */

import {
  xchacha20Poly1305Decrypt,
  xchacha20Poly1305Encrypt,
} from './xchacha';

export type PackAlgo = 'AES-GCM' | 'XChaCha20-Poly1305';

export interface EncryptedPack {
  v: 1;
  kdf: 'PBKDF2';
  algo: PackAlgo;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  /** XChaCha20-Poly1305 的 16B 标签（AES-GCM 标签内嵌于 ciphertext，无此字段） */
  tag?: string;
  meta: { title: string; createdAt: number };
}

const ITERATIONS = 210_000;
const IV_LEN = 12;
const SALT_LEN = 16;

function getSubtle(): SubtleCrypto {
  const c = globalThis.crypto?.subtle;
  if (!c) throw new Error('Web Crypto API unavailable');
  return c;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64Encode(bytes: Uint8Array): string {
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

function b64Decode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
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

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtle();
  const base = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** PBKDF2 派生 32B 原始密钥（供 XChaCha20-Poly1305 使用） */
async function deriveKeyBits(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtle();
  const base = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    256
  );
  return new Uint8Array(bits);
}

/** 用口令加密 Markdown 正文（默认 AES-GCM；可选 XChaCha20-Poly1305） */
export async function encryptNotePack(
  title: string,
  content: string,
  passphrase: string,
  algo: PackAlgo = 'AES-GCM'
): Promise<EncryptedPack> {
  if (!passphrase) throw new Error('passphrase required');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LEN));
  const meta = { title, createdAt: Date.now() };
  if (algo === 'XChaCha20-Poly1305') {
    // 24B nonce：12B 随机 IV + 12B 追加随机（HChaCha 仅用前 16B）
    const nonce = new Uint8Array(24);
    nonce.set(iv, 0);
    nonce.set(globalThis.crypto.getRandomValues(new Uint8Array(12)), 12);
    const key = await deriveKeyBits(passphrase, salt);
    const { ciphertext, tag } = xchacha20Poly1305Encrypt(
      key,
      nonce,
      new TextEncoder().encode(content)
    );
    return {
      v: 1,
      kdf: 'PBKDF2',
      algo,
      iterations: ITERATIONS,
      salt: b64Encode(salt),
      iv: b64Encode(nonce),
      ciphertext: b64Encode(ciphertext),
      tag: b64Encode(tag),
      meta,
    };
  }
  const key = await deriveKey(passphrase, salt);
  const ct = await getSubtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(content)
  );
  return {
    v: 1,
    kdf: 'PBKDF2',
    algo,
    iterations: ITERATIONS,
    salt: b64Encode(salt),
    iv: b64Encode(iv),
    ciphertext: b64Encode(new Uint8Array(ct)),
    meta,
  };
}

/** 解密；失败抛错（fail-closed）。按 pack.algo 分发 AES-GCM / XChaCha20-Poly1305 */
export async function decryptNotePack(
  pack: EncryptedPack,
  passphrase: string
): Promise<{ title: string; content: string }> {
  if (!passphrase) throw new Error('passphrase required');
  if (pack?.v !== 1) throw new Error('unsupported pack');
  const salt = b64Decode(pack.salt);
  const nonce = b64Decode(pack.iv);
  const ct = b64Decode(pack.ciphertext);
  const title = pack.meta?.title || 'note.md';
  if (pack.algo === 'XChaCha20-Poly1305') {
    if (nonce.length !== 24 || !pack.tag) throw new Error('unsupported pack');
    const key = await deriveKeyBits(passphrase, salt);
    try {
      const pt = xchacha20Poly1305Decrypt(key, nonce, ct, b64Decode(pack.tag));
      return { title, content: new TextDecoder().decode(pt) };
    } catch {
      throw new Error('decrypt failed');
    }
  }
  if (pack.algo !== 'AES-GCM') throw new Error('unsupported pack');
  const key = await deriveKey(passphrase, salt);
  try {
    const pt = await getSubtle().decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      key,
      ct as BufferSource
    );
    return { title, content: new TextDecoder().decode(pt) };
  } catch {
    throw new Error('decrypt failed');
  }
}

export function isEncryptedPack(obj: unknown): obj is EncryptedPack {
  const p = obj as EncryptedPack;
  return !!p && p.v === 1 && typeof p.ciphertext === 'string' && typeof p.salt === 'string';
}
