/**
 * CJK 文本编码探测：UTF-8 / GBK / Big5 / Shift_JIS。
 * 零依赖，使用 TextDecoder（浏览器与 Node 18+ 均支持上述标签）。
 */

export type DetectedEncoding = 'utf-8' | 'gbk' | 'big5' | 'shift_jis';

export interface DetectResult {
  encoding: DetectedEncoding;
  /** 0–1，启发式置信度 */
  confidence: number;
  text: string;
}

const CANDIDATES: { encoding: DetectedEncoding; label: string }[] = [
  { encoding: 'utf-8', label: 'utf-8' },
  { encoding: 'gbk', label: 'gbk' },
  { encoding: 'big5', label: 'big5' },
  { encoding: 'shift_jis', label: 'shift_jis' },
];

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function decode(bytes: Uint8Array, label: string, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

/** 启发式打分：越少替换符、越多 CJK / 可打印字符越好 */
function scoreText(text: string): number {
  if (!text) return -1e9;
  let repl = 0;
  let cjk = 0;
  let printable = 0;
  const n = Math.min(text.length, 8000);
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 0xfffd) repl++;
    else if (
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0x3040 && c <= 0x30ff) ||
      (c >= 0xac00 && c <= 0xd7af)
    ) {
      cjk++;
      printable++;
    } else if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c > 127) {
      printable++;
    }
  }
  const ratio = n ? printable / n : 0;
  return cjk * 3 + ratio * 100 - repl * 80;
}

/**
 * 探测字节序列编码并解码为字符串。
 * 优先 UTF-8（含 BOM）；否则在 GBK/Big5/Shift_JIS 中选最高分。
 */
export function detectTextEncoding(bytes: Uint8Array): DetectResult {
  if (bytes.length === 0) {
    return { encoding: 'utf-8', confidence: 1, text: '' };
  }
  if (hasUtf8Bom(bytes)) {
    const text = decode(bytes, 'utf-8', false) ?? '';
    return { encoding: 'utf-8', confidence: 1, text };
  }

  const utf8Strict = decode(bytes, 'utf-8', true);
  if (utf8Strict !== null) {
    // 合法 UTF-8：若几乎无 CJK 也仍优先（英文文档）
    return { encoding: 'utf-8', confidence: 0.95, text: utf8Strict };
  }

  let best: DetectResult | null = null;
  for (const c of CANDIDATES) {
    const text = decode(bytes, c.label, false);
    if (text === null) continue;
    const s = scoreText(text);
    if (!best || s > scoreText(best.text)) {
      best = { encoding: c.encoding, confidence: 0.5, text };
    }
  }
  if (!best) {
    const text = decode(bytes, 'utf-8', false) ?? '';
    return { encoding: 'utf-8', confidence: 0.2, text };
  }
  // 归一化置信度：相对分数粗略映射
  const s = scoreText(best.text);
  best.confidence = Math.max(0.35, Math.min(0.92, 0.4 + s / 500));
  return best;
}

/** 便捷：从 ArrayBuffer / Uint8Array 得到文本 */
export function decodeBytes(input: ArrayBuffer | Uint8Array): DetectResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return detectTextEncoding(bytes);
}
