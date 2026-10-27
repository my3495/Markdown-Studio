/**
 * 护城河 1 · 中英/中数自动间距（pangu 规则）。
 * 纯函数，仅作用于字符串，便于单测。
 */
const CJK = /[一-鿿㐀-䶿]/;
const LATIN_DIGIT = /[A-Za-z0-9]/;

/** 在 CJK 与 拉丁/数字 之间补空格（已存在空格则不重复添加） */
export function addCjkSpacing(text: string): string {
  let out = text;
  // CJK 后接 拉丁/数字/常见半角符号
  out = out.replace(/([一-鿿㐀-䶿])([A-Za-z0-9@#$%&])/g, '$1 $2');
  // 拉丁/数字 后接 CJK
  out = out.replace(/([A-Za-z0-9])([一-鿿㐀-䶿])/g, '$1 $2');
  return out;
}

export { CJK, LATIN_DIGIT };
