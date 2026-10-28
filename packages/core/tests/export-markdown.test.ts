import { describe, it, expect } from 'vitest';
import { markdownFromLineRange, normalizeMarkdown } from '../src/export/markdown';

/**
 * 导出/复制用的 Markdown 文本工具。
 * 两个函数都被 UI 直接消费（复制选区、另存为 .md），边界行为必须钉死：
 * 行号是 1-based、范围闭区间、越界要夹取，而不是抛错或悄悄少一行。
 */

const DOC = ['# 标题', '', '第一段', '第二段', '', '结尾'].join('\n');

describe('markdownFromLineRange（1-based 闭区间）', () => {
  it('E-M01 单行', () => {
    expect(markdownFromLineRange(DOC, 1, 1)).toBe('# 标题');
    expect(markdownFromLineRange(DOC, 3, 3)).toBe('第一段');
  });

  it('E-M02 多行按原样拼接', () => {
    expect(markdownFromLineRange(DOC, 3, 4)).toBe('第一段\n第二段');
  });

  it('E-M03 起始行 0 或负数夹到第 1 行', () => {
    expect(markdownFromLineRange(DOC, 0, 1)).toBe('# 标题');
    expect(markdownFromLineRange(DOC, -5, 2)).toBe('# 标题\n');
  });

  it('E-M04 结束行超出文档时夹到末行', () => {
    expect(markdownFromLineRange(DOC, 6, 99)).toBe('结尾');
  });

  it('E-M05 结束行 0 或小于起始行时返回空串（不抛错）', () => {
    expect(markdownFromLineRange(DOC, 2, 0)).toBe('');
    expect(markdownFromLineRange(DOC, 5, 2)).toBe('');
  });

  it('E-M06 末尾换行会产生一个空行元素，按行号可达', () => {
    const withTrailing = 'a\nb\n';
    expect(markdownFromLineRange(withTrailing, 1, 3)).toBe('a\nb\n');
  });
});

describe('normalizeMarkdown（另存为 .md 前的规范化）', () => {
  it('E-M07 CRLF 归一为 LF', () => {
    expect(normalizeMarkdown('a\r\nb\r\n')).toBe('a\nb\n');
  });

  it('E-M08 连续空行压缩为一个空行', () => {
    expect(normalizeMarkdown('a\n\n\n\nb')).toBe('a\n\nb\n');
  });

  it('E-M09 去掉尾部空白并保证恰好一个换行', () => {
    expect(normalizeMarkdown('a   ')).toBe('a\n');
    expect(normalizeMarkdown('a\n\n\n')).toBe('a\n');
  });

  it('E-M10 空串与纯空白文档', () => {
    expect(normalizeMarkdown('')).toBe('\n');
    expect(normalizeMarkdown('   \n  ')).toBe('\n');
  });

  it('E-M11 幂等：规范化两次结果一致', () => {
    const src = '# 标题\r\n\r\n\r\n\r\n正文   \r\n';
    const once = normalizeMarkdown(src);
    expect(normalizeMarkdown(once)).toBe(once);
  });

  it('E-M12 行首内容不被改动（只处理尾部空白）', () => {
    expect(normalizeMarkdown('  缩进代码行\n正文')).toBe('  缩进代码行\n正文\n');
  });
});
