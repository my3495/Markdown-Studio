import { describe, expect, it } from 'vitest';
import { warningsToDiagnostics } from '../typography-lint';
import type { TypographyWarning } from '@md-studio/core';

/**
 * 排版告警 → CodeMirror 诊断的换算。
 * 关注三件事：行号越界不能崩、列号要夹在行内、波浪线长度取「问题原文」而非建议文本。
 */

/** 假文档：按 \\n 切分，from/to 与真实 Text 语义一致（行不含换行符） */
function fakeDoc(md: string) {
  const lines = md.split('\n');
  let offset = 0;
  const ranges = lines.map((text) => {
    const from = offset;
    offset += text.length + 1;
    return { from, to: from + text.length, length: text.length };
  });
  return {
    length: Math.max(0, offset - 1),
    line: (n: number) => ranges[n - 1],
  };
}

const warn = (w: Partial<TypographyWarning>): TypographyWarning =>
  ({ type: 'punctuation', message: '半角标点', line: 1, column: 1, ...w }) as TypographyWarning;

describe('warningsToDiagnostics', () => {
  it('F-08 行列换算为字符区间', () => {
    const doc = fakeDoc('第一行\nabcdef');
    const out = warningsToDiagnostics(doc, [warn({ line: 2, column: 3, length: 2 })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: 4 + 2, to: 4 + 4, severity: 'warning' });
  });

  it('F-09 行号 0 / 负数 / 超出文档时静默跳过', () => {
    const doc = fakeDoc('a\nb');
    expect(
      warningsToDiagnostics(doc, [warn({ line: 0 }), warn({ line: -3 }), warn({ line: 99 })])
    ).toEqual([]);
  });

  it('F-10 列号超出该行长度时夹到行尾，且波浪线不越行（from<to）', () => {
    const doc = fakeDoc('ab\ncd\nef');
    const out = warningsToDiagnostics(doc, [warn({ line: 2, column: 99, length: 3 })]);
    // 左移到本行最后一个字符，而不是产生零长度区间或溢出到下一行
    expect(out[0]!.from).toBe(4);
    expect(out[0]!.to).toBe(5);
  });

  it('F-11 缺 length 时用问题原文的 suggestion 长度', () => {
    const doc = fakeDoc('中文...');
    const out = warningsToDiagnostics(doc, [
      warn({ line: 1, column: 3, length: undefined, suggestion: '……' }),
    ]);
    expect(out[0]!.to - out[0]!.from).toBe(2);
  });

  it('F-12 波浪线不超过行尾', () => {
    const doc = fakeDoc('abc');
    const out = warningsToDiagnostics(doc, [warn({ line: 1, column: 2, length: 50 })]);
    expect(out[0]!.to).toBe(3);
  });

  it('F-13 有建议时把建议拼进消息，并带上 cjk-<type> 来源', () => {
    const doc = fakeDoc('x');
    const out = warningsToDiagnostics(doc, [
      warn({ type: 'ellipsis', message: '省略号', column: 1, length: 1, suggestion: '……' }),
    ]);
    expect(out[0]!.message).toBe('省略号 → ……');
    expect(out[0]!.source).toBe('cjk-ellipsis');
  });

  it('F-14 无建议时不追加箭头', () => {
    const doc = fakeDoc('x');
    const out = warningsToDiagnostics(doc, [warn({ message: '全角括号', column: 1, length: 1 })]);
    expect(out[0]!.message).toBe('全角括号');
  });
});
