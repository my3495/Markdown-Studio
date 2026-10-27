import { visit } from 'unist-util-visit';
import { getNodeText } from '../util';
import type { TocItem, TocPlaceholderOptions, PipelineContext } from '../../types';

/**
 * 正文内目录占位符（Typora / Obsidian 风格）：`[TOC]` → 可点击的目录列表。
 *
 * 与 `remarkToc` 的分工：
 * - `remarkToc` 是**旁路**：抽取全文标题到 `ctx.toc`，交给侧栏「大纲」面板，不改正文结构。
 * - 本插件是**就地替换**：把正文里那个写着 `[TOC]` 的段落换成真正的目录列表。
 *
 * 两条路径共享同一份标题数据（`ctx.toc`），所以侧栏大纲与正文内目录永远一致。
 *
 * 实现要点：
 * 1. 目录是**渲染期产物**，源文件不被修改（与 ADR-21 标题编号的取向一致）。
 * 2. 直接产出 **hast**（经 `data.hChildren` 注入），不走 mdast→hast 的 list 转换：
 *    那条路径会按 loose/tight 规则决定是否保留 `<p>` 包裹，并插入换行文本节点，
 *    给目录项带来多余的上下外边距。目录结构固定，直接构造 hast 更可控。
 * 3. 净化（rehype-sanitize）会剥离 `nav` 标签，因此容器用 `div` + `role="navigation"`
 *    承载语义；`role` / `className` 在 schema 中显式放行。
 * 4. 锚点 href 使用 `#user-content-<id>`：`rehype-sanitize` 的 clobberPrefix 会给
 *    正文标题的 id 加 `user-content-` 前缀，目录必须指向带前缀的真实 id 才能跳中。
 */

/** 占位符字面量：仅 `[TOC]` / `[toc]`（允许两侧空白） */
const PLACEHOLDER_RE = /^\s*\[(?:TOC|toc)\]\s*$/;

/** 与 sanitize 的 clobberPrefix 保持一致（defaultSchema.clobberPrefix = 'user-content-'） */
const CLOBBER_PREFIX = 'user-content-';

export function remarkTocPlaceholder(settings?: {
  options?: TocPlaceholderOptions;
  ctx?: PipelineContext;
}) {
  const fallbackCtx = settings?.ctx;
  const options = settings?.options ?? {};

  return (tree: any) => {
    // 同 remarkToc：ctx 从树上取，避免缓存的 processor 把结果写进过期的上下文
    const ctx: PipelineContext | undefined = tree?.data?.pipelineCtx ?? fallbackCtx;
    if (!ctx) return;

    const items = selectItems(
      ctx.toc,
      clampDepth(options.maxDepth),
      options.includeH1 === true
    );
    const title = options.title ?? '';
    // 标题最终文本（含自动编号前缀），按源行号索引
    const finalText = collectHeadingText(tree);

    visit(tree, 'paragraph', (node: any, index?: number, parent?: any) => {
      if (index == null || !parent) return;
      // 只替换**顶层**段落：列表项 / 引用块里的 [TOC] 视为正文
      if (parent.type !== 'root') return;
      if (!isPlaceholderParagraph(node)) return;

      const children = buildTocChildren(items, title, finalText);
      // 保留原段落节点（其 position 用于 data-line 滚动同步锚点），
      // 只把标签换成 div、内容换成目录
      node.data = {
        ...(node.data ?? {}),
        hName: 'div',
        hProperties: { className: ['md-toc'], role: 'navigation' },
        hChildren: children,
      };
      node.children = [];
    });
  };
}

/** 段落文本是否恰好是占位符 */
function isPlaceholderParagraph(node: any): boolean {
  const children = node.children;
  if (!Array.isArray(children) || children.length !== 1) return false;
  const child = children[0];
  // 段落里只允许一个 text 节点：
  // - 有强调/链接等内联标记 → 是正文
  // - `[TOC]: https://…` 会让 `[TOC]` 变成链接引用 → 节点是 link，同样排除
  if (child?.type !== 'text') return false;
  return PLACEHOLDER_RE.test(child.value ?? '');
}

/** 按层级与首标题规则挑选要进目录的条目 */
function selectItems(
  toc: TocItem[],
  maxDepth: number,
  includeH1: boolean
): TocItem[] {
  const filtered = toc.filter((item) => item.depth <= maxDepth);
  if (includeH1) return filtered;
  // 去掉首个 h1（文档主标题）：它通常是文档名，列在目录里是冗余
  const firstH1 = filtered.findIndex((item) => item.depth === 1);
  if (firstH1 === -1) return filtered;
  return filtered.filter((_, i) => i !== firstH1);
}

function clampDepth(depth: number | undefined): number {
  if (typeof depth !== 'number' || !Number.isFinite(depth)) return 6;
  return Math.min(6, Math.max(1, Math.floor(depth)));
}

/**
 * 采集标题的最终文本 → 源行号。
 * 开启标题自动编号（ADR-21）时，标题实际渲染为「1. 一、xxx」，
 * 目录里也应显示同样的编号，否则目录与正文对不上。
 */
function collectHeadingText(tree: any): Map<number, string> {
  const map = new Map<number, string>();
  visit(tree, 'heading', (node: any) => {
    const line = node?.position?.start?.line;
    if (typeof line !== 'number') return;
    map.set(line, getNodeText(node).trim());
  });
  return map;
}

/* ---------------- hast 构造 ---------------- */

function el(tagName: string, properties: any, children: any[]): any {
  return { type: 'element', tagName, properties, children };
}

/** 目录区块的子节点：标题行 + 列表 */
function buildTocChildren(
  items: TocItem[],
  title: string,
  finalText: Map<number, string>
): any[] {
  const children: any[] = [];

  if (title) {
    children.push(
      el('p', { className: ['md-toc-title'] }, [{ type: 'text', value: title }])
    );
  }

  const list = buildList(items, finalText);
  if (list) children.push(list);

  return children;
}

/**
 * 把扁平条目按层级还原成嵌套列表。
 *
 * 下沉时**一次只下沉一层**：标题层级可能跳级（h2 → h4），
 * HTML 嵌套列表要求层级连续，否则浏览器会渲染出错位的缩进。
 */
function buildList(items: TocItem[], finalText: Map<number, string>): any {
  if (items.length === 0) return null;

  const root = el('ul', {}, []);
  // 栈：每层记录「承载该层条目的 ul」与「该层对应的源标题深度」
  const stack: { list: any; depth: number }[] = [
    { list: root, depth: items[0]!.depth },
  ];

  for (const item of items) {
    // 上浮：弹出所有比当前条目更深的层
    while (stack.length > 1 && stack[stack.length - 1]!.depth > item.depth) {
      stack.pop();
    }
    const top = stack[stack.length - 1]!;

    if (item.depth > top.depth) {
      // 下沉一层：挂在上一条的子列表里
      const parentLi = top.list.children[top.list.children.length - 1];
      if (!parentLi) {
        // 理论上不会发生（首条总是同层）；兜底：挂到当前层，绝不丢条目
        top.list.children.push(makeListItem(item, finalText));
        continue;
      }
      const sub = el('ul', {}, []);
      parentLi.children.push(sub);
      stack.push({ list: sub, depth: top.depth + 1 });
      sub.children.push(makeListItem(item, finalText));
      continue;
    }

    top.list.children.push(makeListItem(item, finalText));
  }

  return root;
}

/** 单个目录条目：<li><a href="#…">标题</a></li> */
function makeListItem(item: TocItem, finalText: Map<number, string>): any {
  return el('li', {}, [buildLink(item, finalText)]);
}

/** 目录项 → 锚点链接（href 指向净化后的真实 id） */
function buildLink(item: TocItem, finalText: Map<number, string>): any {
  const text = finalText.get(item.line) ?? item.text;
  return el('a', { href: `#${CLOBBER_PREFIX}${item.id}` }, [
    { type: 'text', value: text },
  ]);
}
