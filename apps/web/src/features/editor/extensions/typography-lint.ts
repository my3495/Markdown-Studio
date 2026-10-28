import { linter, type Diagnostic } from '@codemirror/lint';
import type { TypographyWarning } from '@md-studio/core';

/** 将管线输出的中文排版警告转为 CodeMirror Diagnostic */
export function warningsToDiagnostics(
  doc: { line: (n: number) => { from: number; to: number; length: number } | undefined; length: number },
  warnings: TypographyWarning[]
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const w of warnings) {
    if (!w.line || w.line < 1) continue;
    const line = doc.line(w.line);
    if (!line) continue;
    const col = Math.max(1, w.column || 1);
    let from = line.from + col - 1;
    if (from > line.to) from = line.to;
    if (from < line.from) from = line.from;
    // 高亮长度取「问题原文」长度（修复 H1）：此前用 suggestion 的长度顶替，
    // 两者常不相等（如 `...` 建议为 `……`），会把波浪线画长或画短。
    const span = Math.max(1, w.length ?? ((w.suggestion || '').length || 1));
    let to = Math.min(from + span, line.to);
    if (to <= from) to = Math.min(from + 1, doc.length);
    out.push({
      from,
      to,
      severity: 'warning',
      message: w.suggestion ? `${w.message} → ${w.suggestion}` : w.message,
      source: `cjk-${w.type}`,
    });
  }
  return out;
}

/** 从外部警告源创建 linter（由文档 store 注入最新 warnings） */
export function typographyLinter(getWarnings: () => TypographyWarning[]) {
  return linter((view) => warningsToDiagnostics(view.state.doc, getWarnings()), {
    delay: 400,
  });
}
