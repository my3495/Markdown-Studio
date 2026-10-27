import { describe, it, expect } from 'vitest';
import { detectTextEncoding } from '../src/encoding/detect';

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('detectTextEncoding', () => {
  it('UTF-8 文本', () => {
    const r = detectTextEncoding(encodeUtf8('# 你好世界 Hello'));
    expect(r.encoding).toBe('utf-8');
    expect(r.text).toContain('你好');
  });

  it('UTF-8 BOM', () => {
    const body = encodeUtf8('bom测试');
    const bytes = new Uint8Array(3 + body.length);
    bytes.set([0xef, 0xbb, 0xbf], 0);
    bytes.set(body, 3);
    const r = detectTextEncoding(bytes);
    expect(r.encoding).toBe('utf-8');
    expect(r.text).toContain('测试');
  });

  it('空字节', () => {
    expect(detectTextEncoding(new Uint8Array()).encoding).toBe('utf-8');
  });
});

/** 构造非法 UTF-8 再以 GBK 标签解码（若运行时支持） */
describe('非 UTF-8 候选', () => {
  it('非法 UTF-8 字节会走候选探测', () => {
    // GBK「你好」常见双字节
    const gbkNiHao = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
    const r = detectTextEncoding(gbkNiHao);
    expect(['gbk', 'big5', 'shift_jis', 'utf-8']).toContain(r.encoding);
    expect(r.text.length).toBeGreaterThan(0);
  });
});
