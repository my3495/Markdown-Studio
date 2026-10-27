import { parseFragment } from 'parse5';
import { fromParse5 } from 'hast-util-from-parse5';
import { toHtml } from 'hast-util-to-html';

/** from-parse5 需要一个 VFile 形状的对象来收集位置信息；这里只做结构转换 */
const vfile = { messages: [], value: '' } as never;

/** 转义纯文本节点，避免被 parse5 误判为标签（如 `a < b`） */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 把一段原始 HTML 解析为 hast 子节点（剥离注释；失败返回 null） */
function rawToHast(value: string): any[] | null {
  try {
    const fragment = parseFragment(value, { sourceCodeLocationInfo: false });
    const tree = fromParse5(fragment as never, { space: 'html', file: vfile }) as any;
    return ((tree.children ?? []) as any[]).filter((n) => n.type !== 'comment');
  } catch {
    return null;
  }
}

/**
 * 重新拼装一个父节点的全部子节点：把 text / raw / element 序列化为一段 HTML 再用
 * parse5 解析。用途：markdown 会把内联 HTML（如 `<kbd>Ctrl</kbd>`）拆成
 * 「开标签 raw + 文本 + 闭标签 raw」三段，逐段解析会得到空 `<kbd>` ；整体拼装后
 * 解析才能正确还原「`<kbd>` 内含文本」的结构。
 */
function reassembleChildren(parent: any): any[] | null {
  try {
    const html = (parent.children ?? [])
      .map((c: any) => {
        if (c.type === 'text') return escapeText(c.value);
        if (c.type === 'raw') return c.value;
        if (c.type === 'element') return toHtml(c);
        return '';
      })
      .join('');
    const fragment = parseFragment(html, { sourceCodeLocationInfo: false });
    const tree = fromParse5(fragment as never, { space: 'html', file: vfile }) as any;
    const kids = ((tree.children ?? []) as any[]).filter((n) => n.type !== 'comment');
    return kids.length ? kids : null;
  } catch {
    return null;
  }
}

/** 根级（块级）raw 节点：自包含，逐条解析即可 */
function processRootChildren(children: any[]): any[] {
  const out: any[] = [];
  for (const c of children) {
    if (c.type !== 'raw') {
      out.push(c);
      continue;
    }
    // 纯注释没有渲染价值
    if (/^\s*<!--[\s\S]*-->\s*$/.test(c.value)) continue;
    // 分页符：转语义化元素（供打印/PDF 分页）
    if (/data-pagebreak="true"/.test(c.value) || /class="pagebreak"/.test(c.value)) {
      out.push({
        type: 'element',
        tagName: 'div',
        properties: {
          className: ['pagebreak'],
          'data-pagebreak': 'true',
          'aria-hidden': 'true',
        },
        children: [],
      });
      continue;
    }
    const parsed = rawToHast(c.value);
    if (parsed && parsed.length) out.push(...parsed);
    // 解析为空或失败 → 丢弃该片段（宁可少渲染，也不喷裸 HTML）
  }
  return out;
}

/**
 * 在 remark-rehype 之后、sanitize 之前处理原始 HTML 节点：
 * - 元素父节点含 raw → 整体拼装子节点再解析（修复内联 HTML 开/闭标签被拆分的问题）
 * - 根级块级 raw → 逐条解析（div/span/kbd/br/script…，自包含）
 * - 分页符 → 语义化 div.pagebreak；纯注释 → 移除
 * - 解析失败 → 丢弃该片段
 *
 * 安全边界：本插件只负责「解析」，不负责「放行」。`<script>`、`onclick` 等危险内容
 * 由紧随其后的 rehype-sanitize（defaultSchema）剥离，因此放开内联 HTML 不会扩大 XSS 面。
 */
export function rehypeNormalizeRaw() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      const kids: any[] = node.children;
      if (!Array.isArray(kids)) return;

      if (node.type === 'root') {
        node.children = processRootChildren(kids);
        for (const c of node.children) walk(c);
        return;
      }

      // 元素父节点：含 raw 则整体拼装后解析（内联 HTML 关键修复）
      const hasRaw = kids.some((c: any) => c.type === 'raw');
      if (hasRaw) {
        const reassembled = reassembleChildren(node);
        if (reassembled) node.children = reassembled;
        else node.children = kids.filter((c: any) => c.type !== 'raw');
        walk(node); // 重新检查（新解析出的元素内若仍含 raw，极少见）
        return;
      }

      for (const c of kids) walk(c);
    };

    walk(tree);
    return tree;
  };
}
