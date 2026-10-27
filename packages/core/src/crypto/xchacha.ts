/**
 * A3 增强：XChaCha20-Poly1305 AEAD（draft-irtf-cfrg-xchacha）纯 TS 实现。
 *
 * 背景：WebCrypto 不提供 XChaCha20-Poly1305；为保证 Web / 桌面 / CLI 一致且
 * 不引入原生依赖，此处给出常量时间标签校验的参考实现。
 * 结构：HChaCha20(key, nonce[0:16]) → ChaCha20-IETF(subkey, nonce[16:24]) + Poly1305。
 *
 * 性能说明：面向笔记级负载（KB ~ 数百 KB）；ChaCha20 内核走 Uint32Array，
 * Poly1305 用 BigInt 累加器换取正确性。
 */

// ---------- 基础工具 ----------

function le32(bytes: Uint8Array, off: number): number {
  return (
    (bytes[off]! | (bytes[off + 1]! << 8) | (bytes[off + 2]! << 16) | (bytes[off + 3]! << 24)) >>> 0
  );
}

function writeLe32(out: Uint8Array, off: number, v: number): void {
  out[off] = v & 0xff;
  out[off + 1] = (v >>> 8) & 0xff;
  out[off + 2] = (v >>> 16) & 0xff;
  out[off + 3] = (v >>> 24) & 0xff;
}

function bytesToWords8(bytes: Uint8Array): Uint32Array {
  const w = new Uint32Array(8);
  for (let i = 0; i < 8; i++) w[i] = le32(bytes, i * 4);
  return w;
}

function nonceToWords3(bytes: Uint8Array): Uint32Array {
  const w = new Uint32Array(3);
  for (let i = 0; i < 3; i++) w[i] = le32(bytes, i * 4);
  return w;
}

// ---------- ChaCha20 ----------

const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d]! ^ s[a]!, 16);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b]! ^ s[c]!, 12);
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d]! ^ s[a]!, 8);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b]! ^ s[c]!, 7);
}

/** 20 轮（10 双轮）列/对角混合 */
function chachaRounds(s: Uint32Array): void {
  for (let i = 0; i < 10; i++) {
    quarterRound(s, 0, 4, 8, 12);
    quarterRound(s, 1, 5, 9, 13);
    quarterRound(s, 2, 6, 10, 14);
    quarterRound(s, 3, 7, 11, 15);
    quarterRound(s, 0, 5, 10, 15);
    quarterRound(s, 1, 6, 11, 12);
    quarterRound(s, 2, 7, 8, 13);
    quarterRound(s, 3, 4, 9, 14);
  }
}

/**
 * ChaCha20-IETF 单块（64 字节）。
 * key 32B；nonce 12B（4B counter 前缀 + 8B nonce）；counter 为 32 位。
 */
export function chacha20Block(key: Uint8Array, nonce: Uint8Array, counter: number): Uint8Array {
  if (key.length !== 32) throw new Error('chacha20: key must be 32 bytes');
  if (nonce.length !== 12) throw new Error('chacha20: nonce must be 12 bytes');
  const state = new Uint32Array(16);
  state.set(SIGMA, 0);
  state.set(bytesToWords8(key), 4);
  state[12] = counter >>> 0;
  state.set(nonceToWords3(nonce), 13);
  const w = state.slice();
  chachaRounds(w);
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) writeLe32(out, i * 4, (w[i]! + state[i]!) >>> 0);
  return out;
}

/**
 * HChaCha20：32B key + 16B nonce → 32B 子密钥（无最终加法，取词 0-3 与 12-15）。
 */
export function hChaCha20(key: Uint8Array, nonce16: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error('hchacha20: key must be 32 bytes');
  if (nonce16.length !== 16) throw new Error('hchacha20: nonce must be 16 bytes');
  const s = new Uint32Array(16);
  s.set(SIGMA, 0);
  s.set(bytesToWords8(key), 4);
  for (let i = 0; i < 4; i++) s[12 + i] = le32(nonce16, i * 4); // 16B nonce → 词 12-15
  chachaRounds(s);
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) writeLe32(out, i * 4, s[i]!);
  for (let i = 0; i < 4; i++) writeLe32(out, 16 + i * 4, s[12 + i]!);
  return out;
}

/**
 * ChaCha20-IETF 密钥流（从 startCounter 起的 length 字节）。
 */
export function chacha20IetfStream(
  key: Uint8Array,
  nonce12: Uint8Array,
  length: number,
  startCounter = 1
): Uint8Array {
  const kw = bytesToWords8(key);
  const nw = nonceToWords3(nonce12);
  const out = new Uint8Array(length);
  let counter = startCounter >>> 0;
  for (let off = 0; off < length; off += 64) {
    const state = new Uint32Array(16);
    state.set(SIGMA, 0);
    state.set(kw, 4);
    state[12] = counter;
    state.set(nw, 13);
    const w = state.slice();
    chachaRounds(w);
    const block = new Uint32Array(16);
    for (let i = 0; i < 16; i++) block[i] = (w[i]! + state[i]!) >>> 0;
    const n = Math.min(64, length - off);
    for (let i = 0; i < n; i++) {
      out[off + i] = block[i >> 2]! >>> ((i & 3) * 8);
    }
    counter = (counter + 1) >>> 0;
  }
  return out;
}

/**
 * XChaCha20 密钥流：HChaCha20 派生子密钥 + 12B 内层 nonce（后 8B 置于 4..11）。
 */
export function xchacha20Stream(
  key: Uint8Array,
  nonce24: Uint8Array,
  length: number,
  startCounter = 1
): Uint8Array {
  if (key.length !== 32) throw new Error('xchacha20: key must be 32 bytes');
  if (nonce24.length !== 24) throw new Error('xchacha20: nonce must be 24 bytes');
  const subkey = hChaCha20(key, nonce24.subarray(0, 16));
  const nonce12 = new Uint8Array(12);
  nonce12.set(nonce24.subarray(16, 24), 4);
  return chacha20IetfStream(subkey, nonce12, length, startCounter);
}

// ---------- Poly1305 ----------

const P1305 = (1n << 130n) - 5n;
const CLAMP = 0x0ffffffc0ffffffc0ffffffc0fffffffn;

function leBytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]!);
  return v;
}

function bigIntToLe16(v: bigint): Uint8Array {
  const out = new Uint8Array(16);
  let x = v & ((1n << 128n) - 1n);
  for (let i = 0; i < 16; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/** Poly1305 MAC（RFC 8439）：key 32B（r||s），返回 16B 标签 */
export function poly1305(key: Uint8Array, msg: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error('poly1305: key must be 32 bytes');
  const r = leBytesToBigInt(key.subarray(0, 16)) & CLAMP;
  const s = leBytesToBigInt(key.subarray(16, 32));
  let a = 0n;
  for (let off = 0; off < msg.length; off += 16) {
    const block = msg.subarray(off, Math.min(off + 16, msg.length));
    // n = int_le(block) + 2^(8*len)
    let n = leBytesToBigInt(block) | (1n << BigInt(8 * block.length));
    a = ((a + n) * r) % P1305;
  }
  return bigIntToLe16(a + s);
}

// ---------- AEAD ----------

function pad16(data: Uint8Array): Uint8Array {
  const rem = data.length % 16;
  if (rem === 0) return data;
  const out = new Uint8Array(data.length + (16 - rem));
  out.set(data, 0);
  return out;
}

function le64(n: number): Uint8Array {
  const out = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! ^ b[i]!;
  return out;
}

function buildMacData(aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const parts = [pad16(aad), pad16(ciphertext), le64(aad.length), le64(ciphertext.length)];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export interface XChaChaSealed {
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

/**
 * XChaCha20-Poly1305 加密。
 * key 32B；nonce 24B；aad 可选。返回密文 + 16B 标签。
 */
export function xchacha20Poly1305Encrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array = new Uint8Array(0)
): XChaChaSealed {
  const polyKey = xchacha20Stream(key, nonce, 32, 0);
  const keystream = xchacha20Stream(key, nonce, plaintext.length, 1);
  const ciphertext = xorBytes(plaintext, keystream);
  const tag = poly1305(polyKey, buildMacData(aad, ciphertext));
  return { ciphertext, tag };
}

/**
 * XChaCha20-Poly1305 解密（fail-closed）：标签不符即抛错，不返回部分明文。
 */
export function xchacha20Poly1305Decrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array,
  aad: Uint8Array = new Uint8Array(0)
): Uint8Array {
  const polyKey = xchacha20Stream(key, nonce, 32, 0);
  const expected = poly1305(polyKey, buildMacData(aad, ciphertext));
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= expected[i]! ^ (tag[i] ?? 0);
  if (diff !== 0) throw new Error('xchacha20-poly1305: tag mismatch');
  const keystream = xchacha20Stream(key, nonce, ciphertext.length, 1);
  return xorBytes(ciphertext, keystream);
}
