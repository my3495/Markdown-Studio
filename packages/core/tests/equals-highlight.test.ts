import { describe, it, expect } from 'vitest';
import { render } from '../src/parser/pipeline';
import { toHtml } from 'hast-util-to-html';

async function toHtmlString(md: string, opts = {}) {
  const { hast } = await render(md, opts);
  return toHtml(hast, { allowDangerousHtml: true });
}

/** 统计 HTML 里的 <mark> 数量（用正则即可，测试不追求解析精度） */
function countMarks(html: string): number {
  return (html.match(/<mark>/g) ?? []).length;
}

describe('==高亮== 语法（Typora / Obsidian 风格）', () => {
  it('段落内联高亮渲染为 <mark>', async () => {
    const html = await toHtmlString('前面 ==被高亮== 后面');
    expect(html).toContain('<mark>被高亮</mark>');
    expect(countMarks(html)).toBe(1);
  });

  it('同一段多处高亮、中英混排都成立', async () => {
    const html = await toHtmlString('==第一处== 普通 ==English mixed 中文== 结尾');
    expect(countMarks(html)).toBe(2);
    expect(html).toContain('<mark>第一处</mark>');
    expect(html).toContain('<mark>English mixed 中文</mark>');
  });

  it('标题 / 列表 / 表格 / 引用里同样生效', async () => {
    const html = await toHtmlString(
      [
        '## 小节 ==标题高亮==',
        '',
        '- 列表 ==项高亮==',
        '',
        '| A | B |',
        '| - | - |',
        '| ==单元格== | x |',
        '',
        '> 引用 ==块高亮==',
      ].join('\n')
    );
    expect(html).toContain('<h2');
    expect(countMarks(html)).toBe(4);
    expect(html).toContain('<mark>标题高亮</mark>');
    expect(html).toContain('<mark>项高亮</mark>');
    expect(html).toContain('<mark>单元格</mark>');
    expect(html).toContain('<mark>块高亮</mark>');
  });

  it('代码块与行内代码里的 == 保持字面量', async () => {
    const html = await toHtmlString('```\n==代码里不解析==\n```\n\n行内 `==也不解析==` 结尾');
    expect(countMarks(html)).toBe(0);
    expect(html).toContain('==代码里不解析==');
    expect(html).toContain('==也不解析==');
  });

  it('贴空白的等号不当作语法（避免误吞比较文本）', async () => {
    const html = await toHtmlString('a == b == c 与 ==== 以及 ==');
    expect(countMarks(html)).toBe(0);
    expect(html).toContain('a == b == c');
  });

  it('不跨软换行配对', async () => {
    const html = await toHtmlString('==第一行\n第二行==');
    expect(countMarks(html)).toBe(0);
  });

  it('高亮内不允许注入脚本', async () => {
    const html = await toHtmlString('==<script>alert(1)</script>==');
    expect(html).not.toContain('<script>');
    // 内联 HTML 是独立节点，等号不被跨节点配对，原样保留也不构成高亮
    expect(countMarks(html)).toBe(0);
  });

  it('equalsHighlight: false 时整体关闭', async () => {
    const html = await toHtmlString('==高亮==', { equalsHighlight: false });
    expect(countMarks(html)).toBe(0);
    expect(html).toContain('==高亮==');
  });

  it('含/不含 == 的文档交替渲染时 processor 缓存不串味', async () => {
    const withEq = await toHtmlString('==甲==');
    const plain = await toHtmlString('没有等号语法的普通段落');
    const withEq2 = await toHtmlString('==乙==');
    expect(countMarks(withEq)).toBe(1);
    expect(countMarks(plain)).toBe(0);
    expect(countMarks(withEq2)).toBe(1);
    expect(withEq2).toContain('<mark>乙</mark>');
  });
});
