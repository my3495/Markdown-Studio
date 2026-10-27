import { visit } from 'unist-util-visit';
import type { NumberStyle } from '../../types';

/**
 * ADR-21：标题自动编号在渲染层实现，不改源文件。
 * 在 heading 文本前注入编号文本节点（如 "1. " / "一、" / "第一章"）。
 */
export function remarkAutoNumber(style: NumberStyle) {
  return (tree: any) => {
    const counters = [0, 0, 0, 0, 0, 0];
    visit(tree, 'heading', (node: any) => {
      const d = node.depth as number;
      if (d < 1 || d > 6) return;
      counters[d - 1]++;
      for (let i = d; i < counters.length; i++) counters[i] = 0;

      const num = formatNumber(counters.slice(0, d), style);
      if (num) {
        node.children.unshift({ type: 'text', value: `${num} ` });
      }
    });
  };
}

export function formatNumber(parts: number[], style: NumberStyle): string {
  switch (style) {
    case 'arabic':
      return parts.join('.') + '.';
    case 'chinese':
      return parts.map(toChinese).join('、');
    case 'chapter':
      return parts.length === 1
        ? `第${toChinese(parts[0]!)}章`
        : parts.join('.');
    default:
      return '';
  }
}

export function toChinese(n: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return digits[n]!;
  if (n < 20) return '十' + (n % 10 ? digits[n % 10] : '');
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return digits[tens] + '十' + (ones ? digits[ones] : '');
  }
  return String(n);
}
