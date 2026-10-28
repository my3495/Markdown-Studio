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
import { remarkTocPlaceholder } from './plugins/remark-toc-placeholder';
import { remarkCjkTypography } from './plugins/remark-cjk-typography';
import { remarkImageSize } from './plugins/remark-image-size';
import { remarkAutoNumber } from './plugins/remark-auto-number';
import { remarkPagebreak } from './plugins/remark-pagebreak';
import { remarkEqualsHighlight } from './plugins/remark-equals-highlight';
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
    | 'equalsHighlight'
  >
> &
  RenderOptions;
/** processor 缓存上限：选项组合的实际取值空间很小，超限只做防御性淘汰 */
const PROCESSOR_CACHE_MAX = 32;
const processorCache = new Map<string, any>();

/** 文档内容特征：决定若干「按语法才需要」的插件是否注册 */
interface DocFeatures {
  math: boolean;
  wikilink: boolean;
  gfm: boolean;
  /** 含 `==`：`==高亮==` 语法的必要条件 */
  equals: boolean;
}

/**
 * GFM 语法触发字符（任缺其一都不算「没有 GFM 语法」）：
 * 表格 `|`、删除线 `~~`、autolink literal（`://` / `www.` / `@`）、任务列表 `[ ]`、脚注 `[^`。
 */
const GFM_HINT = /\||~~|:\/\/|www\.|@|\[[ xX]\]|\[\^/;

/**
 * 只在源码确实可能出现对应语法时才注册相关插件。
 *
 * 判据取**必要条件**：不含 `$` 就不可能有行内/块级公式（连 `\$` 转义也含 `$`），
 * 不含 `[[` 就不可能有双链，不含任何 GFM 触发字符就不可能有 GFM 语法。
 * 命中只是让插件少跑一遍，渲染结果完全相同；反之（代码块里恰有 `$`、正文里路过
 * `[[` 或 `@`）会保守地走原路径，宁可多跑也绝不漏渲染。
 *
 * 实测收益（320 块 / 20KB 文档）：
 * - 无公式：remark-math + rehype-katex 空转 60–80ms；
 * - 无任何 GFM 语法的纯叙述文档：remark-gfm 的 micromark 扩展约 24ms
 *   （含表格时反而更高，8KB 表格文档 +71ms —— 但这种文档必然命中判据，不会被跳过）。
 */
function detectFeatures(source: string): DocFeatures {
  return {
    math: source.includes('$'),
    wikilink: source.includes('[['),
    gfm: GFM_HINT.test(source),
    equals: source.includes('=='),
  };
}

/** 把影响插件注册顺序与参数的选项压成稳定字符串（不含 ctx：ctx 走 tree.data） */
function processorKey(o: ResolvedOptions, f: DocFeatures): string {
  const t = o.typography ?? {};
  return [
    // 特征也进 key：含/不含某类语法的文档必须拿到不同的 processor，否则缓存会串味
    o.gfm && f.gfm ? 1 : 0,
    o.frontmatter ? 1 : 0,
    o.math && f.math ? 1 : 0,
    o.wikilinks && f.wikilink ? 1 : 0,
    o.equalsHighlight && f.equals ? 1 : 0,
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
    tocPlaceholderKey(o.tocPlaceholder),
  ].join('|');
}

/** `[TOC]` 占位符选项 → 稳定的缓存键（选项影响插件行为，必须进 key） */
function tocPlaceholderKey(v: RenderOptions['tocPlaceholder']): string {
  if (!v) return '-';
  return [
    v.maxDepth ?? 6,
    v.includeH1 === true ? 1 : 0,
    v.title ?? '',
  ].join(',');
}

/**
 * 组装渲染管线（顺序即正确性，见方案 7.2）。
 * 同一组选项只组装一次并缓存：连续输入时每次 render 都重新 `.use()` 十几个插件
 * 是不必要的固定开销（unified 每次 use 都要 copy 一个 processor 实例）。
 */
function buildProcessor(opts: ResolvedOptions, features: DocFeatures): any {
  // unified 在混用 remark/rehype 插件时其泛型 Processor 联合签名无法被 TS 解析，
  // 这里以 any 承接（运行时行为正确，已通过 16 个单测）。
  let processor: any = unified().use(remarkParse);

  // 无任何 GFM 触发字符时不注册（micromark 扩展的成本按文档长度摊在每一次 parse 上）
  if (opts.gfm && features.gfm) processor = processor.use(remarkGfm, { singleTilde: false });

  // 无 `$` 时不注册：remark-math 只提供 micromark 扩展，位置保持在 gfm 之后
  if (opts.math && features.math) processor = processor.use(remarkMath);

  processor = processor
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkHeadingId)
    // ctx 不在这里传：见 remarkToc / remarkCjkTypography 的 tree.data.pipelineCtx
    .use(remarkToc)
    .use(remarkCjkTypography, { typography: opts.typography ?? {} })
    .use(remarkImageSize)
    .use(remarkPagebreak);

  // `==高亮==` → <mark>：必须在 CJK 排版之后（排版会改写 text 值，先切分会被它二次处理），
  // 且只碰 text 节点，代码块/行内代码里的 `==` 不受影响。
  // 无 `==` 的文档不注册：插件本身要遍历全部 text 节点，跳过即省一次全树访问。
  if (opts.equalsHighlight && features.equals) {
    processor = processor.use(remarkEqualsHighlight);
  }

  if (opts.autoNumber) {
    processor = processor.use(remarkAutoNumber, opts.autoNumber);
  }

  // 正文内目录占位符 `[TOC]`：
  // - 必须在 remarkToc 之后（依赖 ctx.toc 收集到的标题）
  // - 必须在 remarkAutoNumber 之后（目录项要显示与标题相同的编号）
  if (opts.tocPlaceholder) {
    processor = processor.use(remarkTocPlaceholder, {
      options: opts.tocPlaceholder,
    });
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
  if (opts.wikilinks && features.wikilink) {
    processor = processor.use(rehypeWikilink);
  }

  // 无 `$` 时跳过：rehype-katex 会遍历整棵树找 math 节点，无公式文档纯属空转
  if (opts.math && features.math) {
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

// ------------------------------------------------------------ 增量解析
// 单次 parse 是 render 的大头（320 块 / 20KB 文档约 170–230ms，见 NEXT-STEPS 的剖析表），
// 而写作时绝大多数编辑只影响**尾部一个块**。这里缓存上一次 parse 出的顶层块，
// 命中公共前缀时只重解析尾部，其余块直接复用。
//
// 关键取舍：只跳过 parse，**不跳过任何后续插件**。标题编号、TOC、脚注编号、
// CJK 排版、sanitize、shiki、data-line 都在拼接后的完整树上重跑 ——
// 全局依赖因此天然保持正确，这也是这个方案敢上线的前提。

interface ParseCache {
  /** processor 缓存键：不同选项解析同一文本可能得到不同结果，必须绑定 */
  key: string;
  /** 解析用的源文本（已过 normalizeImageSize） */
  source: string;
  /** run 之前的顶层块快照（深拷贝，避免被 run 阶段就地改写污染） */
  children: any[];
}

let parseCache: ParseCache | null = null;

/**
 * 出现「链接引用定义 / 脚注定义」时禁用增量。
 *
 * 这类定义是**全局作用域**的：可以写在任意位置、被任意位置引用。
 * 把文档切成块单独解析会让引用解析不到，结果与全篇解析不等价 ——
 * 这类文档直接走全量，宁可慢也不能渲染错。
 */
const HAS_REF_DEF = /^ {0,3}\[[^\]\n]+\]:/m;

/**
 * 保守回退的块数：切点前的最后一块也要重新解析。
 * 覆盖「追加会改变上一块」的常见情形——表格续行、列表续项、引用块续写、
 * 未闭合代码块/HTML 块、以及 setext 标题（段落下一行写 `---`）。
 */
const RECEDE_BLOCKS = 1;

function countNewlines(text: string, upTo: number): number {
  let n = 0;
  for (let i = 0; i < upTo; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** 把子树里所有 position 平移到全文坐标系（行号与字符偏移） */
function shiftPositions(nodes: any[], offsetDelta: number, lineDelta: number): void {
  if (offsetDelta === 0 && lineDelta === 0) return;
  for (const node of nodes) {
    const p = node?.position;
    if (p?.start && typeof p.start.offset === 'number') p.start.offset += offsetDelta;
    if (p?.start && typeof p.start.line === 'number') p.start.line += lineDelta;
    if (p?.end && typeof p.end.offset === 'number') p.end.offset += offsetDelta;
    if (p?.end && typeof p.end.line === 'number') p.end.line += lineDelta;
    if (Array.isArray(node?.children)) shiftPositions(node.children, offsetDelta, lineDelta);
  }
}

/** 深拷贝：缓存必须与 run 用的树彻底分离 */
function snapshot(nodes: any[]): any[] {
  return typeof structuredClone === 'function'
    ? structuredClone(nodes)
    : JSON.parse(JSON.stringify(nodes));
}

/**
 * 尝试增量解析。任何不确定的情形都返回 null（调用方回退全量）。
 *
 * 切点必须落在**行首**，否则尾部文本会和上一行拼在一起被解析成别的东西。
 * 块级节点的 `position.start` 天然在行首，因此直接用它当切点。
 */
function incrementalParse(processor: any, source: string, key: string): any[] | null {
  const cache = parseCache;
  if (!cache || cache.key !== key) return null;
  if (HAS_REF_DEF.test(source)) return null;

  const prev = cache.source;
  const max = Math.min(prev.length, source.length);
  let common = 0;
  while (common < max && prev.charCodeAt(common) === source.charCodeAt(common)) common++;

  const children = cache.children;
  // 找到第一个「起点不在公共前缀内」的块：从它开始才是被编辑触及的区域
  let firstTouched = children.length;
  for (let i = 0; i < children.length; i++) {
    const start = children[i]?.position?.start?.offset;
    if (typeof start !== 'number') return null;
    if (start > common) {
      firstTouched = i;
      break;
    }
  }

  let reuse = firstTouched - RECEDE_BLOCKS;
  if (reuse <= 0) return null;

  const boundary = children[reuse]?.position?.start?.offset;
  if (typeof boundary !== 'number' || boundary > common) return null;

  const tail = processor.parse(source.slice(boundary));
  const lineDelta = countNewlines(source, boundary);
  shiftPositions(tail.children, boundary, lineDelta);
  return [...children.slice(0, reuse), ...tail.children];
}

/** 仅供测试：清空增量缓存，强制下一次走全量解析 */
export function __clearParseCache(): void {
  parseCache = null;
}

/** 仅供测试：观察最近一次 render 是否真的走了增量路径（否则等价性测试是空转） */
export const __parseStats = { lastIncremental: false };

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
    equalsHighlight: true,
    ...options,
  } as ResolvedOptions;

  const features = detectFeatures(source);
  const key = processorKey(opts, features);
  let processor = processorCache.get(key);
  if (!processor) {
    processor = buildProcessor(opts, features);
    if (processorCache.size >= PROCESSOR_CACHE_MAX) {
      const oldest = processorCache.keys().next();
      if (!oldest.done) processorCache.delete(oldest.value);
    }
    processorCache.set(key, processor);
  }

  const reused = incrementalParse(processor, source, key);
  __parseStats.lastIncremental = reused !== null;

  // 缓存必须是「没被 run 触碰过」的纯 parse 输出：run 阶段的插件会就地改写树
  // （CJK 排版改文本、自动编号改标题），交给 run 的那份必须另做一份深拷贝，
  // 否则下次复用到的是被改过的节点 —— 这类污染会让渲染结果静默走样。
  const parsedChildren: any[] = reused ?? ((processor.parse(source) as any).children as any[]);
  parseCache = { key, source, children: parsedChildren };

  const mdast: any = { type: 'root', children: snapshot(parsedChildren) };
  // 旁路上下文挂在树上：processor 是共享的，ctx 必须每份文档独立（且并发安全）
  mdast.data = { pipelineCtx: ctx };
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
