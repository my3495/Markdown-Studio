import { visit } from 'unist-util-visit';

/** 提取节点纯文本（用于 TOC / 字数） */
export function getNodeText(node: any): string {
  let text = '';
  visit(node, (n: any) => {
    if (typeof n.value === 'string') {
      // 跳过 HTML 原始节点内容
      if (n.type === 'html') return;
      text += n.value;
    }
  });
  return text;
}

/** 提取 code 元素文本（hast） */
export function getCodeText(node: any): string {
  let text = '';
  visit(node, 'text', (n: any) => {
    text += n.value;
  });
  return text;
}

/** 判断字符是否为 CJK（含中文标点全角区） */
export function isCJK(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意
    (code >= 0x3400 && code <= 0x4dbf) || // 扩展A
    (code >= 0x3000 && code <= 0x303f) || // CJK 符号和标点
    (code >= 0xff00 && code <= 0xffef) // 全角字符
  );
}

/** 判断字符是否为 ASCII 字母/数字（拉丁与数字） */
export function isLatinOrDigit(ch: string): boolean {
  return /[A-Za-z0-9]/.test(ch);
}

/**
 * 护城河 1 安全区：绝不进入代码块、行内代码、链接 URL、公式、HTML 属性。
 * 依据祖先节点类型判断当前文本节点是否处于禁用区。
 */
export function inSafeZone(ancestors: any[]): boolean {
  for (const a of ancestors) {
    const t = a?.type;
    if (
      t === 'code' ||
      t === 'inlineCode' ||
      t === 'math' ||
      t === 'inlineMath' ||
      t === 'html' ||
      t === 'link' // 链接 URL 不动；链接文本同样规避以保证一致
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 注入 `data-line` 的块级标签白名单。
 * 内联元素（strong/em/a/span/code/td…）同样带 position，但它们与所在块同级行号、
 * 只会重复占位：实测一份 50KB 文档里 2,264 个 `[data-line]` 中有约 79% 来自内联元素，
 * 既放大 DOM 体积，也让滚动同步的 `buildIndex()` 多做 4 倍的 `getBoundingClientRect()`。
 */
export const DATA_LINE_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'hr',
  'div',
  'section',
  'figure',
  'figcaption',
  'dl',
  'dt',
  'dd',
  'details',
  'summary',
]);

/** 块级节点类型：仅这些节点注入 data-line 用于滚动同步 */
export const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'listItem',
  'code',
  'table',
  'thematicBreak',
  'html',
  'definition',
  'footnoteDefinition',
]);
