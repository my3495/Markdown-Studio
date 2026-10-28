/**
 * 导出功能端到端审计（真实浏览器 + 真实下载）。
 *
 * 单测覆盖了 core 的 HTML 拼装与 exporter 的浏览器动作，但有两件事只有真浏览器能证实：
 *   1) `.css?raw` 的 KaTeX 样式是否真的被打进产物（vitest 里 CSS 资源会被置空）；
 *   2) 工具栏菜单 → 下载 / 打印 这条链路是否接通（选择器、下载名、弹窗写入）。
 *
 * 用法：
 *   1) pnpm --filter @md-studio/web dev
 *   2) node scripts/audit-export.mjs
 * 可用 AUDIT_BASE 覆盖地址（默认 http://localhost:1420/）。
 */
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:1420/';

const DOC = `# 导出审计

段落里有 ==等号高亮==、**粗体** 与 \`行内代码\`。

| A | B |
| - | - |
| 1 | 2 |

\`\`\`js
const answer = 42;
\`\`\`

行内公式 $E = mc^2$

<script>window.__xss = 1</script>
`;

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true });
// 打印被 headless 拦下也无所谓：只要证明「弹窗里写了文档并调用了 print」
await context.addInitScript(() => {
  window.print = () => {
    window.__printCalled = true;
  };
});
const page = await context.newPage();

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
await page.waitForTimeout(1200);

/** 打开「导出」菜单并点某一项 */
async function clickMenuItem(text) {
  await page.click('button[title="导出"]');
  await page.click(`.tb-menu-item:has-text("${text}")`);
}

// ---------------------------------------------------------------- 导出 HTML
const htmlDownload = page.waitForEvent('download', { timeout: 60_000 });
await clickMenuItem('导出 HTML');
const download = await htmlDownload;
const htmlPath = join(tmpdir(), `md-export-audit-${Date.now()}.html`);
await download.saveAs(htmlPath);
const html = await readFile(htmlPath, 'utf8');

const fileName = download.suggestedFilename();
check(
  '下载被触发且文件名没有双扩展名（.md.html）',
  fileName.endsWith('.html') && !/\.(md|markdown)\.html$/i.test(fileName),
  fileName
);
check('文档骨架完整', html.startsWith('<!doctype html>') && html.includes('<article class="md-preview">'));
check('标题来自当前文档名', /<title>[^<]+<\/title>/.test(html), (/<title>([^<]*)<\/title>/.exec(html) ?? [])[1]);

const styleBlocks = (html.match(/<style>/g) ?? []).length;
check('基础样式 + KaTeX 样式两块（.css?raw 真的进了产物）', styleBlocks === 2, `实际 ${styleBlocks} 块`);
check('KaTeX 样式内容非空', /\.katex\s*\{/.test(html) || /\.katex\{/.test(html));
check('主题变量已内联', html.includes('--md-color-bg'));

const headEnd = html.indexOf('</head>');
check('公式渲染为 KaTeX 结构', html.includes('class="katex"'));
check('== 语法导出为 <mark>', html.includes('<mark>等号高亮</mark>'));
check('代码块由 Shiki 高亮且颜色内联', /<pre[^>]*class="shiki/.test(html) && /style="color:/.test(html));
check('表格与标题都在', html.includes('<table') && /<h1[^>]*>/.test(html));
check('页脚存在（默认开启）', html.includes('<footer class="md-footer">'));
check('页脚含来源文案', html.includes('Markdown Studio'));
check('脚本被净化（无 <script>）', !/<script/i.test(html));
check('引用的外部样式/脚本为空', !/<link[^>]+stylesheet/i.test(html) && !/<script[^>]+src=/i.test(html));
check('正文在 </head> 之后（样式块未被正文截断）', headEnd > -1 && html.indexOf('等号高亮') > headEnd);

// ---------------------------------------------------------------- 导出 PDF（打印）
const popupPromise = page.waitForEvent('popup', { timeout: 60_000 });
await clickMenuItem('导出 PDF');
const popup = await popupPromise;
await popup.waitForLoadState('domcontentloaded').catch(() => {});
await popup.waitForTimeout(800);

const popupHtml = await popup.evaluate(() => document.documentElement.outerHTML);
check('打印窗口写入了导出文档', popupHtml.includes('md-preview') && popupHtml.includes('<mark>等号高亮</mark>'));
check('打印窗口同样有 KaTeX 样式与公式', popupHtml.includes('katex'));
const printed = await popup.evaluate(() => window.__printCalled === true);
check('load 后调用了 window.print()', printed);

// ---------------------------------------------------------------- 汇总
check('全程无控制台错误', consoleErrors.length === 0, consoleErrors.join(' | '));
await browser.close();

for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) process.exitCode = 1;
