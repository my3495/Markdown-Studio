import { visit } from 'unist-util-visit';
import { getNodeText } from '../util';
import type { TocItem, PipelineContext } from '../../types';

/**
 * 旁路抽取目录（在 heading-id 之后运行，复用已生成的 id）。
 *
 * ctx 优先从 `tree.data.pipelineCtx` 取：管线会按选项缓存 processor（见 pipeline.ts），
 * 若把 ctx 固化在插件闭包里，缓存的 processor 会把所有渲染的目录都写进第一次的 ctx。
 * 直接调用 `remarkToc(ctx)` 时仍按闭包 ctx 收集，兼容旧用法。
 */
export function remarkToc(ctx?: PipelineContext) {
  return (tree: any) => {
    const target: PipelineContext | undefined = tree?.data?.pipelineCtx ?? ctx;
    if (!target) return;
    visit(tree, 'heading', (node: any) => {
      const item: TocItem = {
        depth: node.depth,
        text: getNodeText(node).trim(),
        id: node.data?.id ?? '',
        line: node.position?.start?.line ?? 0,
      };
      target.toc.push(item);
    });
  };
}
