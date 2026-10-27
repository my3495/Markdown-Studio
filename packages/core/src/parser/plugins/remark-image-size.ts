import { visit } from 'unist-util-visit';

/**
 * 图像大小解析（兼容 Typora 语法）：`![alt](url =300x200)`
 * 解析出宽高，写入 hProperties，渲染为 <img width height>。
 */
export function remarkImageSize() {
  return (tree: any) => {
    visit(tree, 'image', (node: any) => {
      const match = /^(\S+?)\s*=(\d+)?x?(\d+)?$/.exec(node.url ?? '');
      if (!match) return;
      node.url = match[1];
      node.data = node.data || {};
      node.data.hProperties = node.data.hProperties || {};
      if (match[2]) node.data.hProperties.width = Number(match[2]);
      if (match[3]) node.data.hProperties.height = Number(match[3]);
    });
  };
}
