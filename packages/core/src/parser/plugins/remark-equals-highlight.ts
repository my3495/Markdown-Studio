import { visit } from 'unist-util-visit';

/**
 * `==高亮==` → `<mark>`（Typora / Obsidian 风格的等号高亮）。
 *
 * 为什么在 mdast 阶段做，而不是预处理字符串？
 * - 字符串替换会连代码块、行内代码、链接 URL 一起改，`==` 在这些位置是**数据**不是语法；
 *   走 mdast 只碰 `text` 节点，代码（`code` / `inlineCode` 的 value）天然不被波及。
 * - 依赖 remarkRehype 的未知节点机制：节点带 `data.hName = 'mark'`，序列化时直接产出
 *   <mark> 元素，不需要额外注册 handler；随后 rehype-sanitize 已放行 mark（见 sanitize.ts）。
 *
 * 语法判定（贴近常见实现，宁可少认也不误吞）：
 * - 开标记右侧、闭标记左侧都不能是空白：`== 高亮 ==` 保持原样，避免和普通比较文本打架；
 * - 不允许跨软换行：同一行的 `==` 才配对，`==a\nb==` 不被强行连成一个高亮；
 * - 不匹配空内容：`====` 原样输出。
 *
 * 已知取舍：标记内部按**纯文本**处理，`==**粗**==` 里的 `**` 会原样显示。
 * 支持嵌套需要写完整的 micromark 扩展（改写 inline tokenizer），成本远高于收益；
 * 若确实需要「高亮 + 加粗」，写成 `**==粗==**` 即可，外层强调由标准语法解析。
 */

/** 全局扫描：不匹配的位置由引擎自动前移，天然跳过 `==` 开头的非法组合 */
const MARK_RE = /==(?=\S)([^\n]*?\S)==/g;

/** 高亮节点：类型名自定，`data.hName` 决定最终标签 */
function markNode(value: string) {
  return {
    type: 'mdHighlight',
    data: { hName: 'mark' },
    children: [{ type: 'text', value }],
  };
}

/** 把含 `==` 的文本切成 [text, mark, text, ...]；不含可用组合时返回 null */
function splitText(value: string) {
  MARK_RE.lastIndex = 0;
  const out: any[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = MARK_RE.exec(value))) {
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
    out.push(markNode(m[1]));
    last = m.index + m[0].length;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

export function remarkEqualsHighlight() {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index: any, parent: any) => {
      if (typeof index !== 'number' || !parent || !Array.isArray(parent.children)) return;
      const value: string = node.value;
      // 快速否定：绝大多数文本节点没有 `==`，连正则都不用起
      if (!value.includes('==')) return;
      const parts = splitText(value);
      if (!parts) return;
      parent.children.splice(index, 1, ...parts);
      // 跳过刚插入的节点：其文本内容是配对后的结果，再扫一遍没有意义
      // （返回索引 = 继续处理该位置之后的兄弟节点）
      return index + parts.length;
    });
  };
}
