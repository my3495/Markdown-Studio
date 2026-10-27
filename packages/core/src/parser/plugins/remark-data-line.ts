import { visit } from 'unist-util-visit';
import { DATA_LINE_TAGS } from '../util';

/**
 * ADR-04：净化先行，行号注入在后。
 * 在 rehype-sanitize / shiki / katex 之后，为带 position 的**块级**元素注入
 * `data-line`（系统元数据，与用户内容严格隔离，便于滚动同步）。
 * 内联元素一律跳过：它们与所在块同处一行，注入只会重复占位并拖慢索引构建。
 * 若上游 sanitize 剥离了 position，则由主线程 ScrollSync 降级处理。
 */
export function remarkDataLine() {
  return (tree: any) => {
    visit(tree, 'element', (node: any) => {
      if (!DATA_LINE_TAGS.has(node.tagName)) return;
      const line = node?.position?.start?.line;
      if (typeof line === 'number') {
        node.properties = node.properties || {};
        node.properties['data-line'] = String(line);
      }
    });
  };
}
