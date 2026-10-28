import type { TypographyWarning } from '../types';
import { lintPunctuation, lintEllipsis, lintQuotes } from './punctuation';

export interface LintInput {
  text: string;
  /** 节点起始行 */
  line: number;
  /** 节点起始列 */
  column: number;
}

export interface LintFlags {
  punctuation?: boolean;
  ellipsis?: boolean;
  quotes?: boolean;
}

/** 编排三种中文标点 lint，输出带行列的警告（不改内容） */
export function lintTypography(input: LintInput, flags: LintFlags): TypographyWarning[] {
  const { text, line, column } = input;
  const warnings: TypographyWarning[] = [];
  const push = (
    type: TypographyWarning['type'],
    issues: { index: number; message: string; suggestion: string; length?: number }[]
  ) => {
    for (const i of issues) {
      warnings.push({
        type,
        line,
        column: column + i.index,
        message: i.message,
        suggestion: i.suggestion,
        length: i.length,
      });
    }
  };
  if (flags.punctuation) push('punctuation', lintPunctuation(text));
  if (flags.ellipsis) push('ellipsis', lintEllipsis(text));
  if (flags.quotes) push('quotes', lintQuotes(text));
  return warnings;
}
