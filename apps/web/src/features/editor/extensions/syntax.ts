import { HighlightStyle } from '@codemirror/language';
// tags 由 @lezer/highlight 提供（@codemirror/language 并未重新导出它）
import { tags } from '@lezer/highlight';

/**
 * 编辑器语法着色（修复 B2）：原先直接复用 CM6 内置 defaultHighlightStyle，
 * 它是固定配色且未纳入任何 Compartment，切换明暗主题后 token 颜色不随之变化，
 * 与新背景色对比度失配。改为两套 HighlightStyle 由 syntaxComp 切换。
 *
 * 单独成文件（.ts 而非 .tsx）：这里是纯配置，与编辑器组件解耦，
 * 同时避免在主组件里堆 100+ 行配色表。
 */
function buildSyntax(dark: boolean) {
  const fg = dark ? '#e6edf3' : '#24292f';
  const muted = dark ? '#8b949e' : '#6e7781';
  const accent = dark ? '#79c0ff' : '#0969da';
  const green = dark ? '#7ee787' : '#116329';
  const red = dark ? '#ff7b72' : '#cf222e';
  const purple = dark ? '#d2a8ff' : '#8250df';
  const orange = dark ? '#ffa657' : '#953800';
  return HighlightStyle.define(
    [
      // --- Markdown 标记 ---
      { tag: tags.heading1, color: accent, fontWeight: '700', fontSize: '1.25em' },
      { tag: tags.heading2, color: accent, fontWeight: '700', fontSize: '1.15em' },
      { tag: tags.heading3, color: accent, fontWeight: '700', fontSize: '1.05em' },
      {
        tag: [tags.heading4, tags.heading5, tags.heading6],
        color: accent,
        fontWeight: '700',
      },
      { tag: tags.strong, color: fg, fontWeight: '700' },
      { tag: tags.emphasis, color: fg, fontStyle: 'italic' },
      { tag: tags.strikethrough, color: muted, textDecoration: 'line-through' },
      { tag: tags.link, color: accent, textDecoration: 'underline' },
      { tag: tags.url, color: muted },
      { tag: tags.monospace, color: orange },
      { tag: tags.quote, color: muted, fontStyle: 'italic' },
      { tag: tags.list, color: red },
      { tag: tags.processingInstruction, color: muted },
      { tag: tags.contentSeparator, color: muted },
      // --- 围栏代码块内（嵌套语言着色）---
      { tag: tags.keyword, color: red },
      { tag: [tags.string, tags.special(tags.string)], color: accent },
      { tag: [tags.number, tags.bool, tags.null], color: purple },
      {
        tag: [tags.comment, tags.lineComment, tags.blockComment],
        color: muted,
        fontStyle: 'italic',
      },
      { tag: [tags.variableName, tags.propertyName], color: fg },
      {
        tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
        color: purple,
      },
      { tag: [tags.typeName, tags.className, tags.namespace], color: orange },
      { tag: tags.operator, color: red },
      { tag: tags.punctuation, color: muted },
      { tag: tags.regexp, color: green },
      { tag: [tags.tagName, tags.angleBracket], color: green },
      { tag: tags.attributeName, color: purple },
      { tag: tags.meta, color: muted },
    ],
    { themeType: dark ? 'dark' : 'light' }
  );
}

export const lightSyntax = buildSyntax(false);
export const darkSyntax = buildSyntax(true);
