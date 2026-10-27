import React, { useMemo, useRef } from 'react';
import { MarkdownView } from '@md-studio/ui';
import type { Components } from 'hast-util-to-jsx-runtime';
import type { Root } from 'hast';
import { Mermaid } from './components/Mermaid';
import { Image } from './components/Image';
import { TldrawBoard } from './components/TldrawBoard';
import { useSettings } from '../../stores/settings';
import { t } from '../../i18n';

/** hast 文本抽取（用于按正文定位围栏序号；区别于下方基于 React props 的 textOf） */
function hastTextOf(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return String(node.value ?? '');
  const kids = node.children;
  return Array.isArray(kids) ? kids.map(hastTextOf).join('') : '';
}

/**
 * 预扫描 hast，按文档顺序为每个 tldraw/whiteboard 围栏分配序号（键为围栏正文）。
 * 不能用「渲染时递增的计数器」：预览每次重渲染都会再次调用 Pre，
 * 计数会持续漂移（第 n 次渲染 → index=n），导致写回时 replaceTldrawFence
 * 找不到对应围栏而静默失效。
 */
function fenceIndexMap(hast: Root | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!hast) return map;
  let i = 0;
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'element' && node.tagName === 'pre') {
      const code = (node.children ?? []).find(
        (c: any) => c?.type === 'element' && c.tagName === 'code'
      );
      const cls = code?.properties?.className;
      const clsStr = Array.isArray(cls) ? cls.join(' ') : String(cls ?? '');
      if (code && /language-(tldraw|whiteboard)/.test(clsStr)) {
        const text = hastTextOf(code);
        if (!map.has(text)) map.set(text, i);
        i += 1;
      }
    }
    const kids = node.children;
    if (Array.isArray(kids)) for (const c of kids) walk(c);
  };
  walk(hast);
  return map;
}

function makePre(
  fenceIndexes: React.MutableRefObject<Map<string, number>>,
  onPersistBoard?: (fenceIndex: number, json: string) => void,
  readOnly?: boolean
) {
  return function Pre(props: any) {
    const children = props.children;
    const arr: any[] = Array.isArray(children) ? children : [children];
    for (const c of arr) {
      if (!React.isValidElement(c) || typeof (c as any).props?.className !== 'string') continue;
      const cls = (c as any).props.className as string;
      const text =
        typeof (c as any).props.children === 'string' ? (c as any).props.children : '';
      if (cls.includes('language-mermaid')) {
        return <Mermaid code={text} />;
      }
      if (cls.includes('language-tldraw') || cls.includes('language-whiteboard')) {
        const idx = fenceIndexes.current.get(text) ?? 0;
        return (
          <TldrawBoard
            code={text}
            fenceIndex={idx}
            onPersist={onPersistBoard}
            readOnly={readOnly}
          />
        );
      }
    }
    return <pre {...props}>{children}</pre>;
  };
}

function makeAnchor(onOpenWiki?: (name: string) => void) {
  return function Anchor(props: any) {
    const locale = useSettings((st) => st.locale);
    const isWiki = props['data-wikilink'] ?? props.dataWikilink ?? false;
    const target = props['data-target'] ?? props.dataTarget;
    if (isWiki && target && onOpenWiki) {
      return (
        <a
          className="wikilink"
          href="#"
          data-wikilink="true"
          data-target={String(target)}
          title={t(locale, 'openWikiLink').replace('{name}', String(target))}
          onClick={(e) => {
            e.preventDefault();
            onOpenWiki(String(target));
          }}
        >
          {props.children}
        </a>
      );
    }
    return <a {...props}>{props.children}</a>;
  };
}

function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  const n = node as { props?: { children?: unknown } };
  const ch = n.props?.children;
  if (Array.isArray(ch)) return ch.map(textOf).join('');
  return textOf(ch);
}

function makeHeading(
  Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6',
  onEditHeading?: (line: number, text: string) => void,
  readOnly?: boolean
) {
  return function Heading(props: any) {
    const line = Number(props['data-line'] ?? props.dataLine ?? 0);
    const editable = !readOnly && !!onEditHeading && line > 0;
    if (!editable) {
      return <Tag {...props} />;
    }
    return (
      <Tag
        {...props}
        contentEditable
        suppressContentEditableWarning
        className={`${props.className ?? ''} md-heading-edit`.trim()}
        onBlur={(e: React.FocusEvent<HTMLElement>) => {
          const next = (e.currentTarget.textContent ?? '').trim();
          const prev = textOf(props.children).trim();
          if (next && next !== prev) onEditHeading(line, next);
        }}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
          }
        }}
      />
    );
  };
}

interface Props {
  hast: Root | null;
  onOpenWiki?: (name: string) => void;
  onPersistBoard?: (fenceIndex: number, json: string) => void;
  onEditHeading?: (line: number, text: string) => void;
  readOnly?: boolean;
}

export function MarkdownPreview({
  hast,
  onOpenWiki,
  onPersistBoard,
  onEditHeading,
  readOnly,
}: Props) {
  const locale = useSettings((st) => st.locale);
  // 注意：依赖中刻意排除 `hast`。`hast` 是渲染输入，每次文档内容更新都会变化；
  // 若把它放进依赖，`makePre/makeHeading` 会重新执行并返回**新的函数组件类型**，
  // 导致 toJsxRuntime 生成的 <pre> 元素类型引用变化，React 协调时将其视为不同
  // 组件而整体重挂载（白板 TldrawBoard 随之卸载重建、full 状态丢失）。
  // 组件类型只需在注入的回调/只读标志真正变化时重建。
  // 每渲染重建围栏序号映射（渲染期纯派生）；用 ref 传递以保证 components 身份稳定，
  // 避免 toJsxRuntime 生成的元素类型变化导致白板被整体重挂载、full 状态丢失。
  const fenceIndexRef = useRef<Map<string, number>>(new Map());
  // 只在 hast 变化时重新预扫描；父级因其它状态重渲染时不要重复遍历整棵树
  const fenceIndexes = useMemo(() => fenceIndexMap(hast), [hast]);
  fenceIndexRef.current = fenceIndexes;

  const components: Partial<Components> = useMemo(
    () => ({
      pre: makePre(fenceIndexRef, onPersistBoard, readOnly),
      img: Image,
      a: makeAnchor(onOpenWiki),
      h1: makeHeading('h1', onEditHeading, readOnly),
      h2: makeHeading('h2', onEditHeading, readOnly),
      h3: makeHeading('h3', onEditHeading, readOnly),
      h4: makeHeading('h4', onEditHeading, readOnly),
      h5: makeHeading('h5', onEditHeading, readOnly),
      h6: makeHeading('h6', onEditHeading, readOnly),
    }),
    [onOpenWiki, onPersistBoard, onEditHeading, readOnly]
  );
  if (!hast) {
    return <div className="md-preview">{t(locale, 'rendering')}</div>;
  }
  return <MarkdownView hast={hast} components={components} className="md-preview" />;
}
