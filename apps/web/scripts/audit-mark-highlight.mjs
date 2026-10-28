/**
 * 右侧预览「部分文字高亮」自动化验证（<mark>）。
 *
 * 用法：
 *   1) 先启动 dev server： pnpm --filter @md-studio/web dev
 *   2) node scripts/audit-mark-highlight.mjs
 *
 * 背景：`<mark>` 曾不在 rehype-sanitize 的 defaultSchema 里，导致标记连同文字被整段剥掉；
 * 现已放行并加了 `.md-preview mark` 样式。这个脚本守住三件事：
 *   1) 各种上下文里的 <mark> 都能渲染出来（段落/列表/表格/引用/标题）；
 *   2) 代码块与行内代码里的 <mark> 必须是字面量，不能被解析成元素；
 *   3) 高亮必须是可见的（有实际背景），且不改文字颜色。
 */
import { chromium } from '@playwright/test';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:1420/';

const DOC = `# 高亮测试

普通段落，其中 <mark>这一句被高亮</mark>，后面继续普通文字。

同一段可以有 <mark>多处</mark> 高亮，<mark>中文与 English 混排</mark> 也要正常。

- 列表项里 <mark>高亮</mark> 一项
- 另一项普通

| 列 A | 列 B |
| --- | --- |
| <mark>单元格高亮</mark> | 普通 |

> 引用块里的 <mark>高亮</mark>。

## 小节 <mark>标题内高亮</mark>

行内代码 \`<mark>x</mark>\` 应原样显示。

\`\`\`html
<mark>代码块里的不解析</mark>
\`\`\`

等号语法 ==也要高亮==，加粗 **<mark>加粗内高亮</mark>** 也要生效。
`;

const EXPECTED_TEXTS = [
  '这一句被高亮',
  '多处',
  '中文与 English 混排',
  '高亮', // 列表
  '单元格高亮',
  '高亮', // 引用
  '标题内高亮',
  '加粗内高亮',
  '也要高亮', // == 语法
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

await page.goto(BASE);
await page.waitForSelector('.cm-editor', { timeout: 60_000 });

await page.evaluate((md) => {
  const v = document.querySelector('.cm-editor').__md_view;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: md } });
}, DOC);

await page.waitForSelector('.md-preview h1', { timeout: 60_000 });
await page.waitForTimeout(1500);

const data = await page.evaluate(() => {
  const marks = [...document.querySelectorAll('.md-preview mark')].map((m) => {
    const cs = getComputedStyle(m);
    const rect = m.getBoundingClientRect();
    return {
      text: m.textContent,
      bg: cs.backgroundColor,
      color: cs.color,
      parentColor: m.parentElement ? getComputedStyle(m.parentElement).color : null,
      radius: cs.borderRadius,
      padding: cs.paddingLeft,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      parentTag: m.parentElement?.tagName.toLowerCase() ?? null,
    };
  });

  const pre = document.querySelector('.md-preview pre');
  const inlineCode = [...document.querySelectorAll('.md-preview p code')].find((c) =>
    c.textContent.includes('<mark>')
  );

  return {
    previewVisible: !!document.querySelector('.md-preview'),
    previewWidth: Math.round(document.querySelector('.md-preview')?.getBoundingClientRect().width ?? 0),
    markCount: marks.length,
    marks,
    insidePre: document.querySelectorAll('.md-preview pre mark').length,
    preText: pre?.textContent ?? '',
    inlineCodeText: inlineCode?.textContent ?? null,
    inlineCodeHasMarkEl: !!inlineCode?.querySelector('mark'),
    /** `==` 语法生效后，正文里不应再残留裸的等号标记 */
    equalsSyntaxLeftover: [...document.querySelectorAll('.md-preview p')].some((p) =>
      p.textContent.includes('==也要高亮==')
    ),
    bodyBg: getComputedStyle(document.querySelector('.md-preview')).backgroundColor,
    bodyColor: getComputedStyle(document.querySelector('.md-preview')).color,
  };
});

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

check('右侧预览面板可见', data.previewVisible && data.previewWidth > 300, `width=${data.previewWidth}px`);
check(
  `<mark> 全部渲染（${EXPECTED_TEXTS.length} 处，覆盖段落/列表/表格/引用/标题/加粗内/== 语法）`,
  data.markCount === EXPECTED_TEXTS.length,
  `实际 ${data.markCount} 处`
);

const counts = new Map();
for (const m of data.marks) counts.set(m.text, (counts.get(m.text) ?? 0) + 1);
const expectedCounts = new Map();
for (const t of EXPECTED_TEXTS) expectedCounts.set(t, (expectedCounts.get(t) ?? 0) + 1);
for (const [text, need] of expectedCounts) {
  const got = counts.get(text) ?? 0;
  check(`高亮文本「${text}」存在 ${need} 处`, got === need, `实际 ${got} 处`);
}

const invisible = data.marks.filter(
  (m) => !m.bg || m.bg === 'rgba(0, 0, 0, 0)' || m.bg === 'transparent'
);
check('每处高亮都有可见背景', invisible.length === 0, invisible.map((m) => `${m.text}:${m.bg}`).join(', '));

const zeroSize = data.marks.filter((m) => m.width === 0 || m.height === 0);
check('高亮元素尺寸正常（未被折叠）', zeroSize.length === 0, zeroSize.map((m) => m.text).join(','));

// 文字颜色应继承父级（高亮只加底色，不改字色）
const whiteText = data.marks.filter((m) => m.color === 'rgb(255, 255, 255)');
check(
  '高亮未出现白字（文字颜色可读）',
  whiteText.length === 0,
  whiteText.map((m) => m.text).join(',')
);
// 高亮只加底色：「color: inherit」意味着字色必须与直接父元素一致，
// 不应在 mark 上单独染色（父元素可能是引用块灰字、加粗深色等，各不相同）。
const toRgb = (c) => {
  if (!c) return null;
  const rgba = c.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b] = rgba[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return [r, g, b].map((n) => Math.round(n)).join(',');
  }
  const srgb = c.match(/^color\(srgb\s+([^)]+)\)$/);
  if (srgb) {
    const [r, g, b] = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
    // srgb 分量是 0-1 的线性值，浏览器展示时会转成 8bit
    return [r, g, b].map((n) => Math.round(n * 255)).join(',');
  }
  return c;
};
const oddColor = data.marks.filter(
  (m) => m.parentColor && toRgb(m.color) !== toRgb(m.parentColor)
);
check(
  '高亮只加底色、字色继承父级',
  oddColor.length === 0,
  oddColor.map((m) => `${m.text}:${m.color}≠${m.parentColor}`).join(',')
);

check('代码块内 <mark> 未被解析成元素', data.insidePre === 0 && data.preText.includes('<mark>'), data.preText.slice(0, 60));
check(
  '行内代码里的 <mark> 保持字面量',
  data.inlineCodeText === '<mark>x</mark>' && !data.inlineCodeHasMarkEl,
  String(data.inlineCodeText)
);
check('==等号语法== 渲染为高亮（不再残留裸标记）', !data.equalsSyntaxLeftover);
check('全程无控制台错误', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();

for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
console.log(`高亮样例：${data.marks[0]?.bg} / radius=${data.marks[0]?.radius} / color=${data.marks[0]?.color}`);
if (failed.length) process.exitCode = 1;
