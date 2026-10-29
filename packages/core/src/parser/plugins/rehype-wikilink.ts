import { visit } from 'unist-util-visit';

// 字符类里的 `[` 无需转义（只有 `]` 需要）：写成 [^[\]] 与 [^\[\]] 等价
const WIKILINK_RE = /\[\[([^[\]]+?)\]\]/g;

/**
 * 将 hast 文本中的 [[target|alias]] 转为可点击链接元素：
 * <a data-wikilink data-target="target" href="#">alias</a>
 * 置于 sanitize 之后运行，故不会被安全 schema 剥离；点击由上层（React 组件）拦截处理。
 */
export function rehypeWikilink() {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index?: number, parent?: any) => {
      if (index == null || !parent) return;
      // 跳过代码块 / 行内代码内的文本
      if (parent.tagName === 'code' || parent.tagName === 'pre') return;
      const value = node.value as string;
      if (!value || value.indexOf('[[') === -1) return;

      WIKILINK_RE.lastIndex = 0;
      const parts: any[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = WIKILINK_RE.exec(value))) {
        if (m.index > last) {
          parts.push({ type: 'text', value: value.slice(last, m.index) });
        }
        const inner = m[1];
        const pipe = inner.indexOf('|');
        let target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
        const alias = (pipe >= 0 ? inner.slice(pipe + 1) : target).trim() || target;
        const hash = target.indexOf('#');
        if (hash >= 0) target = target.slice(0, hash).trim();
        if (target) {
          parts.push({
            type: 'element',
            tagName: 'a',
            properties: { dataWikilink: true, dataTarget: target, href: '#' },
            children: [{ type: 'text', value: alias }],
          });
        } else {
          parts.push({ type: 'text', value: m[0] });
        }
        last = m.index + m[0].length;
      }
      if (last < value.length) {
        parts.push({ type: 'text', value: value.slice(last) });
      }
      if (parts.length) parent.children.splice(index, 1, ...parts);
    });
  };
}
