import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { useMemo } from 'react';
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
  // 生成的 React 元素树按 (hast, components) 缓存：
  // 父级（设置/侧栏/知识库等）频繁重渲染时，若 hast 没变，元素对象保持同一引用，
  // React 会整棵子树提前 bailout，省掉上千个节点的重复协调；
  // 组件内部由外部 store（zustand / context）驱动的更新仍会被正确调度。
  const element = useMemo(
    () => toJsxRuntime(safeHast, { Fragment, jsx, jsxs, components }),
    [safeHast, components]
  );
  return <div className={className ?? 'md-preview'}>{element}</div>;
}

export type { Components };
