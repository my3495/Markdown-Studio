import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { memo, useMemo } from 'react';
import type { Root } from 'hast';
import type { Components } from 'hast-util-to-jsx-runtime';
import type { ReactElement } from 'react';

export interface MarkdownViewProps {
  hast: Root;
  /** 自定义元素组件（code/mermaid/img 等由 web 注入） */
  components?: Partial<Components>;
  className?: string;
}

/**
 * 把 hast 的 `style` 字符串解析成 React 需要的对象。
 *
 * 背景：`hast-util-to-jsx-runtime` 内部用 `style-to-js` 做这件事，但该包 1.0.0 的
 * CJS 产物只写了 `exports.default` 而没有 `__esModule`，Node / Vite 的默认导入拿到的是
 * 命名空间对象而不是函数 —— 一调用就抛错，并被包装成 `Cannot parse 'style' attribute`。
 * 后果不是「样式丢失」，而是整棵 Markdown 树渲染失败；在没有错误边界时会把整个应用
 * 卸载成白屏（文档里只要有一个 shiki 代码块就会触发）。
 *
 * 因此在这里自行解析：单条声明解析不出来就把它丢掉（降级为无内联样式），绝不抛错。
 */
function parseStyle(value: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const decl of value.split(';')) {
    const i = decl.indexOf(':');
    if (i <= 0) continue;
    const prop = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (!prop || !val) continue;
    // 自定义属性（--shiki-dark 等）保持原样，其余转 camelCase
    const key = prop.startsWith('--')
      ? prop
      : prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 只复制含 style 的节点及其祖先，其余保持原引用（结构共享，避免整棵树重建） */
function normalizeStyles(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as {
    properties?: Record<string, unknown>;
    children?: unknown[];
  };

  let properties = n.properties;
  if (properties && typeof properties.style === 'string') {
    const parsed = parseStyle(properties.style);
    properties = { ...properties };
    if (parsed) properties.style = parsed;
    else delete properties.style;
  }

  let children = n.children;
  if (Array.isArray(n.children)) {
    // 先原地比较再按需复制：绝大多数子树没有 style，避免为每个节点都分配一个新数组
    let changed = false;
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];
      const r = normalizeStyles(c);
      if (r !== c) {
        if (!changed) {
          children = n.children.slice();
          changed = true;
        }
        (children as unknown[])[i] = r;
      }
    }
  }

  if (properties === n.properties && children === n.children) return node;
  return { ...n, properties, children };
}

// ------------------------------------------------------------------ 块级增量
// 每次输入都会产出全新的 hast 树，`toJsxRuntime` 又会为整棵树生成新的 React 元素，
// 于是「改一个字」也要协调全部节点（实测 2241 节点 / 321 个顶层块，单次约 350ms）。
//
// 这里把顶层块切成各自记忆化的独立单元：渲染前逐块做一次**内容**比较，
// 内容没变的块直接 bailout —— 不执行 toJsxRuntime、不产生 React 元素、不碰 DOM。
//
// 为什么按内容比而不是按引用比：编辑器在中间插入一段时，后续块的位置全都会平移。
// 若只认引用，这些「内容没变、只是换了位置」的块会全部重渲染；按内容比则一律跳过，
// 且因为 key 仍是位置，DOM 节点原地不动，块内组件（白板/图表）的状态也不会丢。
//
// 只做块级复用、不做视口裁剪 —— DOM 结构与全量渲染完全一致，
// 因此滚动同步锚点、TOC、打印/导出都不受影响。

interface HastNodeLike {
  type?: string;
  tagName?: string;
  value?: unknown;
  properties?: Record<string, unknown>;
  children?: unknown[];
}

/** 属性值比较：className 是数组、style 归一化后是对象，都需要按内容比 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
    return true;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const oa = a as Record<string, unknown>;
    const ob = b as Record<string, unknown>;
    const ka = Object.keys(oa);
    if (ka.length !== Object.keys(ob).length) return false;
    for (const k of ka) if (!sameValue(oa[k], ob[k])) return false;
    return true;
  }
  return false;
}

/**
 * 严谨的 hast 结构比较。
 * 必须「宁严勿宽」：漏判一次就会把旧节点当成新内容保留下来（白板甚至会写回错 fence），
 * 所以逐层比对 type/tagName/value/properties/children，不掺哈希。
 * 代价是一次纯内存遍历（2241 个节点约 1ms 量级），远低于 React 协调 + DOM 补丁。
 */
function sameNode(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = a as HastNodeLike;
  const y = b as HastNodeLike;
  if (x.type !== y.type || x.tagName !== y.tagName || x.value !== y.value) return false;

  const px = x.properties;
  const py = y.properties;
  if (px !== py) {
    if (!px || !py) return false;
    const kx = Object.keys(px);
    if (kx.length !== Object.keys(py).length) return false;
    for (const k of kx) if (!sameValue(px[k], py[k])) return false;
  }

  const cx = x.children;
  const cy = y.children;
  if (cx !== cy) {
    if (!cx || !cy || cx.length !== cy.length) return false;
    for (let i = 0; i < cx.length; i++) if (!sameNode(cx[i], cy[i])) return false;
  }
  return true;
}

interface BlockProps {
  node: unknown;
  components?: Partial<Components>;
}

/**
 * 单个顶层块。
 * 自定义比较器让「内容未变」的块直接 bailout（连内部的 useMemo 都不会执行）；
 * 一旦内容有变，useMemo 因 node 引用变化自然重算。
 */
const Block = memo(
  function Block({ node, components }: BlockProps) {
    return useMemo(
      () =>
        toJsxRuntime({ type: 'root', children: [node] } as unknown as Root, {
          Fragment,
          jsx,
          jsxs,
          components,
        }),
      [node, components]
    );
  },
  (prev, next) => prev.components === next.components && sameNode(prev.node, next.node)
);

/**
 * 将 core 解析出的 hast 渲染为 React 树（主线程，ADR-01）。
 * 复用 core 在 Worker 中完成的 hast，避免重复解析。
 */
export function MarkdownView({
  hast,
  components,
  className,
}: MarkdownViewProps): ReactElement {
  const safeHast = useMemo(() => normalizeStyles(hast) as Root, [hast]);

  // 元素列表按 (hast, components) 缓存：父级因设置/侧栏等状态重渲染时，
  // hast 引用没变则整列表保持同一引用，React 无需再逐块比较。
  const elements = useMemo(
    () =>
      ((safeHast.children ?? []) as unknown[]).map((node, i) => (
        <Block key={i} node={node} components={components} />
      )),
    [safeHast, components]
  );

  return <div className={className ?? 'md-preview'}>{elements}</div>;
}

export type { Components };
