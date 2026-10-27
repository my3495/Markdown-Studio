import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { visit } from 'unist-util-visit';

import { remarkHeadingId } from './plugins/remark-heading-id';
import { remarkToc } from './plugins/remark-toc';
import { remarkCjkTypography } from './plugins/remark-cjk-typography';
import { remarkImageSize } from './plugins/remark-image-size';
import { remarkAutoNumber } from './plugins/remark-auto-number';
import { remarkPagebreak } from './plugins/remark-pagebreak';
import { rehypeShiki, resolveShikiTheme } from './plugins/rehype-shiki';
import { rehypeNormalizeRaw } from './plugins/rehype-normalize-raw';
import { rehypeWikilink } from './plugins/rehype-wikilink';
import { remarkDataLine } from './plugins/remark-data-line';
import { buildSanitizeSchema } from './sanitize';
import { isCJK } from './util';
import type { RenderOptions, RenderResult, PipelineContext } from '../types';

/** 外链新标签打开 */
function rehypeExternalLinks() {
  return (tree: any) => {
    visit(tree, 'element', (node: any) => {
      if (
        node.tagName === 'a' &&
        typeof node.properties?.href === 'string' &&
        /^https?:\/\//.test(node.properties.href)
      ) {
        node.properties.target = '_blank';
        node.properties.rel = 'noopener noreferrer';
      }
    });
  };
}

/** 字数统计：CJK 逐字 + 拉丁词 */
function countWords(tree: any): number {
  let cjk = 0;
  let words = 0;
  visit(tree, 'text', (n: any) => {
    const t = n.value as string;
    for (const ch of t) if (isCJK(ch)) cjk++;
    const latin = t.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9]+/g);
    words += latin ? latin.length : 0;
  });
  return cjk + words;
}

/**
 * 预处理：将 Typora 风格图像大小语法 `![alt](url =300x200)` 规整为
 * `![alt](url=300x200)`（标准 Markdown 不允许 URL 含空格），
 * 使 remark-parse 能正确识别为 image 节点，后续 remark-image-size 解析宽高。
 */
function normalizeImageSize(md: string): string {
  return md.replace(
    /!\[([^\]]*)\]\(\s*(\S+?)\s*=(\d+)?x?(\d+)?\s*\)/g,
    (_m, alt, url, w, h) =>
      `![${alt}](${url}=${w ?? ''}${h ? 'x' + h : ''})`
  );
}

type ResolvedOptions = Required<
  Pick<
    RenderOptions,
    | 'gfm'
    | 'frontmatter'
    | 'math'
    | 'highlight'
    | 'dataLine'
    | 'externalLinksNewTab'
    | 'wikilinks'
  >
> &
  RenderOptions;

/** processor 缓存上限：选项组合的实际取值空间很小，超限只做防御性淘汰 */
const PROCESSOR_CACHE_MAX = 32;
const processorCache = new Map<string, any>();

/** 把影响插件注册顺序与参数的选项压成稳定字符串（不含 ctx：ctx 走 tree.data） */
function processorKey(o: ResolvedOptions): string {
  const t = o.typography ?? {};
  return [
    o.gfm ? 1 : 0,
    o.frontmatter ? 1 : 0,
    o.math ? 1 : 0,
    o.highlight ? 1 : 0,
    o.dataLine ? 1 : 0,
    o.externalLinksNewTab ? 1 : 0,
    o.wikilinks ? 1 : 0,
    resolveShikiTheme(o.highlightTheme),
    o.autoNumber === false || o.autoNumber === undefined ? '-' : o.autoNumber,
    t.spacing === false ? 0 : 1,
    t.numberSpacing === false ? 0 : 1,
    t.punctuation === false ? 0 : 1,
    t.ellipsis === false ? 0 : 1,
    t.quotes === false ? 0 : 1,
    t.safeZones === false ? 0 : 1,
    o.footnoteLabel ?? '',
    o.footnoteBackLabel ?? '',
  ].join('|');
}

/**
 * 组装渲染管线（顺序即正确性，见方案 7.2）。
 * 同一组选项只组装一次并缓存：连续输入时每次 render 都重新 `.use()` 十几个插件
 * 是不必要的固定开销（unified 每次 use 都要 copy 一个 processor 实例）。
 */
function buildProcessor(opts: ResolvedOptions): any {
  // unified 在混用 remark/rehype 插件时其泛型 Processor 联合签名无法被 TS 解析，
  // 这里以 any 承接（运行时行为正确，已通过 16 个单测）。
  let processor: any = unified()
    .use(remarkParse)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkMath)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkHeadingId)
    // ctx 不在这里传：见 remarkToc / remarkCjkTypography 的 tree.data.pipelineCtx
    .use(remarkToc)
    .use(remarkCjkTypography, { typography: opts.typography ?? {} })
    .use(remarkImageSize)
    .use(remarkPagebreak);

  if (opts.autoNumber) {
    processor = processor.use(remarkAutoNumber, opts.autoNumber);
  }

  // rehype 阶段
  processor = processor
    .use(remarkRehype, {
      allowDangerousHtml: true,
      footnoteLabel: opts.footnoteLabel ?? 'Footnotes',
      footnoteBackLabel: opts.footnoteBackLabel ?? 'Back to reference',
    })
    // 原始 HTML 归一化（保留分页符，丢弃脚本等）
    .use(rehypeNormalizeRaw)
    // ADR-04：净化先行
    .use(rehypeSanitize, buildSanitizeSchema());

  // 双链渲染在净化之后（避免被 schema 剥离）
  if (opts.wikilinks) {
    processor = processor.use(rehypeWikilink);
  }

  if (opts.math) {
    processor = processor.use(rehypeKatex, { throwOnError: false });
  }
  if (opts.highlight) {
    // 注意：必须以 (插件, options) 形式注册。若写成 .use(rehypeShiki({ theme }))，
    // unified 会把已创建的 transformer 当作 plugin 二次调用（无参），
    // tree 为 undefined 直接 return，整个高亮插件静默 no-op。
    processor = processor.use(rehypeShiki, {
      theme: resolveShikiTheme(opts.highlightTheme),
    });
  }
  if (opts.externalLinksNewTab) {
    processor = processor.use(rehypeExternalLinks);
  }
  // ADR-04：行号注入在后（系统元数据）
  if (opts.dataLine) {
    processor = processor.use(remarkDataLine);
  }
  return processor;
}

/**
 * 核心渲染管线。
 * 返回 hast（跨 Worker 边界用纯 JSON）+ 旁路 TOC + 字数。
 */
export async function render(
  md: string,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const source = normalizeImageSize(md);
  const ctx: PipelineContext = { toc: [], warnings: [] };
  const opts = {
    gfm: true,
    frontmatter: true,
    math: true,
    highlight: true,
    dataLine: true,
    externalLinksNewTab: true,
    wikilinks: true,
    ...options,
  } as ResolvedOptions;

  const key = processorKey(opts);
  let processor = processorCache.get(key);
  if (!processor) {
    processor = buildProcessor(opts);
    if (processorCache.size >= PROCESSOR_CACHE_MAX) {
      const oldest = processorCache.keys().next();
      if (!oldest.done) processorCache.delete(oldest.value);
    }
    processorCache.set(key, processor);
  }

  const mdast = processor.parse(source);
  // 旁路上下文挂在树上：processor 是共享的，ctx 必须每份文档独立（且并发安全）
  mdast.data = { ...(mdast.data ?? {}), pipelineCtx: ctx };
  const hast = (await processor.run(mdast)) as RenderResult['hast'];
  const words = countWords(hast);

  return {
    hast,
    toc: ctx.toc,
    words,
    warnings: ctx.warnings,
    strictIssues: ctx.warnings.length,
  };
}
