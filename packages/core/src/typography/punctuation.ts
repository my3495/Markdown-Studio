/**
 * 护城河 1 · 中文标点 / 省略号 / 引号 校验（仅提示，不改内容）。
 * 返回基于字符偏移的 issue，由调用方映射为行/列。
 */

export interface OffsetIssue {
  index: number;
  message: string;
  suggestion: string;
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
    });
  }
  return issues;
}
