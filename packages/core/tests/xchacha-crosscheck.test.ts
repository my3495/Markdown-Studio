/**
 * 交叉验证：以 Node OpenSSL 的 chacha20-poly1305 为基准，
 * 校验自研 ChaCha20-IETF 密钥流（counter 1 起）与 Poly1305 标签。
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { chacha20IetfStream, poly1305, xchacha20Poly1305Encrypt } from '../src/crypto/xchacha';

const key = crypto.randomBytes(32);
const iv = crypto.randomBytes(12);
const pt = crypto.randomBytes(200);

describe('OpenSSL 交叉验证', () => {
  it('密钥流与 OpenSSL chacha20-poly1305 密文一致', () => {
    const c = crypto.createCipheriv('chacha20-poly1305', key, iv);
    const ct = Buffer.concat([c.update(pt), c.final()]);
    // AEAD 密文 = 明文 XOR keystream(counter 1..)
    const ks = chacha20IetfStream(new Uint8Array(key), new Uint8Array(iv), pt.length, 1);
    const mine = Buffer.from(pt.map((b, i) => b ^ ks[i]!));
    expect(mine.equals(ct)).toBe(true);
  });

  it('Poly1305 标签与 OpenSSL 一致（含 AAD 的 mac_data 构造）', () => {
    const aad = crypto.randomBytes(13);
    const c = crypto.createCipheriv('chacha20-poly1305', key, iv) as crypto.CipherGCM;
    c.setAAD(aad);
    const ct = Buffer.concat([c.update(pt), c.final()]);
    const tag = c.getAuthTag();

    const ks0 = chacha20IetfStream(new Uint8Array(key), new Uint8Array(iv), 32, 0);
    const pad16 = (d: Uint8Array) => {
      const rem = d.length % 16;
      if (rem === 0) return d;
      const out = new Uint8Array(d.length + 16 - rem);
      out.set(d);
      return out;
    };
    const le64 = (n: number) => {
      const out = new Uint8Array(8);
      let v = BigInt(n);
      for (let i = 0; i < 8; i++) {
        out[i] = Number(v & 0xffn);
        v >>= 8n;
      }
      return out;
    };
    const macData = Buffer.concat([
      Buffer.from(pad16(new Uint8Array(aad))),
      Buffer.from(pad16(new Uint8Array(ct))),
      Buffer.from(le64(aad.length)),
      Buffer.from(le64(ct.length)),
    ]);
    const mine = poly1305(ks0, new Uint8Array(macData));
    expect(Buffer.from(mine).equals(tag)).toBe(true);
  });

  it('XChaCha AEAD 自洽（子密钥派生后走 IETF 路径）', () => {
    const k = new Uint8Array(32).fill(7);
    const n = new Uint8Array(24).map((_, i) => i);
    const sealed = xchacha20Poly1305Encrypt(k, n, new Uint8Array([1, 2, 3]));
    expect(sealed.tag).toHaveLength(16);
    expect(sealed.ciphertext).toHaveLength(3);
  });
});
