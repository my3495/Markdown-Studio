import { visit } from 'unist-util-visit';

/**
 * 分页符（v1.2）：`<!-- pagebreak -->` → 渲染为分页 div。
 * 导出 PDF 时通过 CSS `@media print { .pagebreak { page-break-after: always } }` 生效。
 */
export function remarkPagebreak() {
  return (tree: any) => {
    visit(tree, 'html', (node: any) => {
      if (
        typeof node.value === 'string' &&
        /<!--\s*pagebreak\s*-->/i.test(node.value)
      ) {
        node.value =
          '<div class="pagebreak" data-pagebreak="true" aria-hidden="true"></div>';
      }
    });
  };
}
