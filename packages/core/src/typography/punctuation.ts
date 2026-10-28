/**
 * 护城河 1 · 中文标点 / 省略号 / 引号 校验（仅提示，不改内容）。
 * 返回基于字符偏移的 issue，由调用方映射为行/列。
 */

export interface OffsetIssue {
  index: number;
  message: string;
  suggestion: string;
  /**
   * 问题原文的长度（用于把波浪线画在正确的字符上）。
   * 上层此前用 suggestion 的长度顶替，那在语义上是错的
   * （建议文本与问题文本长度往往不同，如 `...` 建议为 `……`）。
   */
  length?: number;
}

const HALF_TO_FULL: Record<string, string> = {
  ',': '，',
  '.': '。',
  ';': '；',
  ':': '：',
  '!': '！',
  '?': '？',
};

/** 中文后接半角标点 */
export function lintPunctuation(text: string): OffsetIssue[] {
  const issues: OffsetIssue[] = [];
  const re = /([一-鿿])([,;.!:?])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const suggestion = m[1] + (HALF_TO_FULL[m[2]] ?? m[2]);
    issues.push({
      index: m.index + 1,
      message: `中文标点应为全角：${m[1]}${m[2]}`,
      suggestion,
      length: 1,
    });
  }
  return issues;
}

/** 连续半角点 → 全角省略号 */
export function lintEllipsis(text: string): OffsetIssue[] {
  const issues: OffsetIssue[] = [];
  const re = /\.{3,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    issues.push({
      index: m.index + 1,
      message: `省略号应使用全角……而非 ${m[0]}`,
      suggestion: '……',
      length: m[0].length,
    });
  }
  return issues;
}

/** 半角引号包裹中文 → 全角引号 */
export function lintQuotes(text: string): OffsetIssue[] {
  const issues: OffsetIssue[] = [];
  const re = /"([一-鿿][^"]*[一-鿿])"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    issues.push({
      index: m.index + 1,
      message: `中文引号应使用全角：“${m[1]}”`,
      suggestion: `“${m[1]}”`,
      // index 指向左引号之后的字符，故覆盖到右引号为止需减 1
      length: m[0].length - 1,
    });
  }
  return issues;
}
