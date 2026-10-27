import { visitParents } from 'unist-util-visit-parents';
import { inSafeZone } from '../util';
import { addCjkSpacing } from '../../typography/pangu';
import { lintTypography } from '../../typography/lint';
import type { TypographyOptions, PipelineContext } from '../../types';

/**
 * 护城河 1：中文技术文档排版。
 * 仅作用于 text 节点；绝不进入代码块/行内代码/链接/公式/HTML 属性。
 * - spacing/numberSpacing：中英自动间距（渲染期表现，不改源文件）
 * - punctuation / ellipsis / quotes：仅 lint 提示，不改内容
 */
export interface CjkTypographySettings {
  typography: Partial<TypographyOptions>;
  ctx: PipelineContext;
}

export function remarkCjkTypography(settings?: Partial<CjkTypographySettings>) {
  const options = settings?.typography ?? {};
  const fallbackCtx = settings?.ctx;
  const opts: TypographyOptions = {
    spacing: true,
    numberSpacing: true,
    punctuation: true,
    ellipsis: true,
    quotes: true,
    safeZones: true,
    ...options,
  };

  return (tree: any) => {
    // 同 remarkToc：ctx 从树上取，避免缓存的 processor 把警告写进过期的上下文
    const ctx: PipelineContext | undefined = tree?.data?.pipelineCtx ?? fallbackCtx;
    visitParents(tree, 'text', (node: any, ancestors: any[]) => {
      if (opts.safeZones && inSafeZone(ancestors)) return;

      const original = node.value as string;
      let value = original;

      if (opts.spacing || opts.numberSpacing) {
        value = addCjkSpacing(value);
      }

      if (value !== original) {
        node.value = value;
      }

      if (ctx && (opts.punctuation || opts.ellipsis || opts.quotes)) {
        const warnings = lintTypography(
          {
            text: original,
            line: node?.position?.start?.line ?? 0,
            column: node?.position?.start?.column ?? 0,
          },
          {
            punctuation: opts.punctuation,
            ellipsis: opts.ellipsis,
            quotes: opts.quotes,
          }
        );
        ctx.warnings.push(...warnings);
      }
    });
  };
}
