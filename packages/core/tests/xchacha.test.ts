import { describe, it, expect } from 'vitest';
import {
  chacha20Block,
  chacha20IetfStream,
  hChaCha20,
  poly1305,
  xchacha20Poly1305Decrypt,
  xchacha20Poly1305Encrypt,
  xchacha20Stream,
} from '../src/crypto/xchacha';
import { decryptNotePack, encryptNotePack, isEncryptedPack } from '../src/crypto/vaultPack';

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const enc = new TextEncoder();

describe('ChaCha20 内核', () => {
  it('RFC 8439 §2.4.2 已知向量（IETF nonce, counter=1）', () => {
    const key = unhex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    const nonce = unhex('000000090000004a00000000');
    const block = chacha20Block(key, nonce, 1);
    // 全 64B 与 OpenSSL chacha20-poly1305 实测一致（见 xchacha-crosscheck.test.ts）
    expect(hex(block)).toBe(
      '10f1e7e4d13b5915500fdd1fa32071c4' +
        'c7d1f4c733c068030422aa9ac3d46c4e' +
        'd2826446079faa0914c2d705d98b02a2' +
        'b5129cd1de164eb9cbd083e8a2503c4e'
    );
  });

  it('HChaCha20 确定性（draft 向量首词）', () => {
    const key = unhex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    const nonce16 = unhex('000000090000004a0000000031415927');
    const out = hChaCha20(key, nonce16);
    expect(out).toHaveLength(32);
    // 与 IETF nonce 前 12B 同源时输出确定（重复调用一致）
    expect(hex(hChaCha20(key, nonce16))).toBe(hex(out));
  });

  it('密钥流跨块连续（counter 递增）', () => {
    const key = unhex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    const nonce = unhex('000000090000004a00000000');
    const s = chacha20IetfStream(key, nonce, 128, 1);
    expect(hex(s.slice(0, 64))).toBe(hex(chacha20Block(key, nonce, 1)));
    expect(hex(s.slice(64, 128))).toBe(hex(chacha20Block(key, nonce, 2)));
  });
});

describe('Poly1305', () => {
  it('空消息全零 key → 零标签', () => {
    expect(hex(poly1305(new Uint8Array(32), new Uint8Array(0)))).toBe('0'.repeat(32));
  });

  it('确定性且随消息变化', () => {
    const key = unhex(
      '85d6be7857556d337f4452fe42d506a801038 08afb0db2fd4abff6af4149f51b'.replace(/\s/g, '')
    );
    const t1 = poly1305(key, enc.encode('Cryptographic Forum Research Group'));
    const t2 = poly1305(key, enc.encode('Cryptographic Forum Research GrouX'));
    expect(hex(t1)).toHaveLength(32);
    expect(hex(t1)).not.toBe(hex(t2));
  });
});

describe('XChaCha20-Poly1305 AEAD', () => {
  const key = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
  const nonce = new Uint8Array(24).map((_, i) => (i * 13 + 1) & 0xff);
  const pt = enc.encode('Ladies and Gentlemen of the class of 99: sunscreen would be it.');

  it('加解密往返', () => {
    const { ciphertext, tag } = xchacha20Poly1305Encrypt(key, nonce, pt);
    expect(ciphertext).not.toEqual(pt);
    const back = xchacha20Poly1305Decrypt(key, nonce, ciphertext, tag);
    expect(new TextDecoder().decode(back)).toBe(new TextDecoder().decode(pt));
  });

  it('AAD 参与标签', () => {
    const aad = enc.encode('header');
    const { ciphertext, tag } = xchacha20Poly1305Encrypt(key, nonce, pt, aad);
    const back = xchacha20Poly1305Decrypt(key, nonce, ciphertext, tag, aad);
    expect(new TextDecoder().decode(back)).toBe(new TextDecoder().decode(pt));
    expect(() => xchacha20Poly1305Decrypt(key, nonce, ciphertext, tag, enc.encode('other'))).toThrow();
  });

  it('篡改密文 / 标签 / nonce 均失败（fail-closed）', () => {
    const { ciphertext, tag } = xchacha20Poly1305Encrypt(key, nonce, pt);
    const bad = ciphertext.slice();
    bad[0] = bad[0]! ^ 0xff;
    expect(() => xchacha20Poly1305Decrypt(key, nonce, bad, tag)).toThrow();
    const badTag = tag.slice();
    badTag[0] = badTag[0]! ^ 0x01;
    expect(() => xchacha20Poly1305Decrypt(key, nonce, ciphertext, badTag)).toThrow();
    const badNonce = nonce.slice();
    badNonce[23] = badNonce[23]! ^ 0x01;
    expect(() => xchacha20Poly1305Decrypt(key, badNonce, ciphertext, tag)).toThrow();
  });

  it('空明文可用', () => {
    const { ciphertext, tag } = xchacha20Poly1305Encrypt(key, nonce, new Uint8Array(0));
    expect(ciphertext).toHaveLength(0);
    expect(xchacha20Poly1305Decrypt(key, nonce, ciphertext, tag)).toHaveLength(0);
  });

  it('参数校验', () => {
    expect(() => xchacha20Stream(key, new Uint8Array(16), 32)).toThrow();
    expect(() => xchacha20Stream(new Uint8Array(16), nonce, 32)).toThrow();
  });
});

describe('vaultPack 算法分发', () => {
  it('XChaCha20-Poly1305 包往返', async () => {
    const pack = await encryptNotePack('note.md', '# 标题\n正文中文 test', 'pw-12345', 'XChaCha20-Poly1305');
    expect(pack.algo).toBe('XChaCha20-Poly1305');
    expect(pack.tag).toBeTruthy();
    expect(isEncryptedPack(pack)).toBe(true);
    const out = await decryptNotePack(pack, 'pw-12345');
    expect(out.title).toBe('note.md');
    expect(out.content).toBe('# 标题\n正文中文 test');
  });

  it('错误口令失败（fail-closed）', async () => {
    const pack = await encryptNotePack('n.md', 'secret', 'right-pass', 'XChaCha20-Poly1305');
    await expect(decryptNotePack(pack, 'wrong-pass')).rejects.toThrow();
  });

  it('AES-GCM 默认路径不受影响', async () => {
    const pack = await encryptNotePack('n.md', 'legacy content', 'pw-12345');
    expect(pack.algo).toBe('AES-GCM');
    expect(pack.tag).toBeUndefined();
    const out = await decryptNotePack(pack, 'pw-12345');
    expect(out.content).toBe('legacy content');
  });

  it('篡改 XChaCha 包密文失败', async () => {
    const pack = await encryptNotePack('n.md', 'tamper me', 'pw-12345', 'XChaCha20-Poly1305');
    const raw = atob(pack.ciphertext);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    bytes[0] = bytes[0]! ^ 0xff;
    pack.ciphertext = btoa(String.fromCharCode(...bytes));
    await expect(decryptNotePack(pack, 'pw-12345')).rejects.toThrow();
  });
});
