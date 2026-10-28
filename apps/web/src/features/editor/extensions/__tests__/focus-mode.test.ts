import { describe, expect, it } from 'vitest';
import { paragraphRange } from '../focus-mode';

/**
 * 对焦模式的段落判定（ADR-19）。
 * 这里不挂 CM6：`paragraphRange` 只依赖 `{lines, line(n)}` 两个成员，
 * 用最小假文档就能把边界（首行/末行/空行/超长段落）全覆盖。
 */

function fakeDoc(md: string) {
  const lines = md.split('\n');
  return {
    lines: lines.length,
    line: (n: number) => ({ text: lines[n - 1] ?? '' }),
  };
}

describe('paragraphRange', () => {
  it('F-01 中间段落以空行为界', () => {
    const doc = fakeDoc('第一段\n\n第二段第一行\n第二段第二行\n\n第三段');
    expect(paragraphRange(doc, 4)).toEqual({ startLine: 3, endLine: 4 });
  });

  it('F-02 首行段落不会向上越界', () => {
    const doc = fakeDoc('第一行\n第二行\n\n第三段');
    expect(paragraphRange(doc, 1)).toEqual({ startLine: 1, endLine: 2 });
  });

  it('F-03 末行段落不会向下越界', () => {
    const doc = fakeDoc('甲\n\n乙行一\n乙行二');
    expect(paragraphRange(doc, 4)).toEqual({ startLine: 3, endLine: 4 });
  });

  it('F-04 单行文档范围就是该行', () => {
    expect(paragraphRange(fakeDoc('只有一行'), 1)).toEqual({ startLine: 1, endLine: 1 });
  });

  it('F-05 空行上的光标会把前后两段一起纳入（当前实现的语义）', () => {
    const doc = fakeDoc('甲行一\n甲行二\n\n乙段');
    // 空行上下都不是空行，于是向上、向下各扩一段：1..4
    expect(paragraphRange(doc, 3)).toEqual({ startLine: 1, endLine: 4 });
  });

  it('F-06 全文无空行时范围覆盖整篇', () => {
    const doc = fakeDoc('a\nb\nc\nd');
    expect(paragraphRange(doc, 2)).toEqual({ startLine: 1, endLine: 4 });
  });

  it('F-07 超长段落被 MAX_PARAGRAPH_SCAN（400 行）截断', () => {
    const doc = fakeDoc(Array.from({ length: 1000 }, (_, i) => `行${i + 1}`).join('\n'));
    const r = paragraphRange(doc, 500);
    // 上下各最多扩 400 行：500 ± 400 → 100..900
    expect(r).toEqual({ startLine: 100, endLine: 900 });
  });
});
