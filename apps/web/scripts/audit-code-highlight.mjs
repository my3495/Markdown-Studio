/**
 * 代码块高亮在「编辑过程中」的行为审计。
 *
 * 用法：
 *   1) 先启动 dev server： pnpm --filter @md-studio/web dev
 *   2) node scripts/audit-code-highlight.mjs        （或 AUDIT_BASE=http://localhost:1420/）
 *
 * 关注点（这些是真会被后续改动弄坏的地方）：
 *   - 预览侧是 Shiki 静态高亮：每次输入后整块重新生成，颜色应随内容实时变化
 *   - 底色必须来自 `--md-code-bg`（Shiki 会写内联 style，靠 CSS !important 压回）
 *   - 切换语言标记（```ts → ```python）应立刻改用对应语法
 *   - 正在输入、fence 还没闭合时不能报错、也不能丢掉高亮
 *   - 空代码块不能崩
 *   - 编辑代码不应比编辑正文明显更慢（Shiki 重高亮的成本）
 *
 * 退出码 0 表示全部通过；任何一条断言失败即为 1。
 */
import { chromium } from '@playwright/test';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:1420/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

await page.goto(BASE);
await page.waitForSelector('.cm-editor', { timeout: 60_000 });

const setDoc = (md) =>
  page.evaluate((md) => {
    const v = document.querySelector('.cm-editor').__md_view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: md } });
  }, md);

const insertAt = (pos, text) =>
  page.evaluate(
    ({ pos, text }) => {
      const v = document.querySelector('.cm-editor').__md_view;
      v.dispatch({ changes: { from: Math.min(pos, v.state.doc.length), insert: text } });
    },
    { pos, text }
  );

const docText = () =>
  page.evaluate(() => document.querySelector('.cm-editor').__md_view.state.doc.toString());

async function waitCode(includes, timeout = 15_000) {
  await page.waitForFunction(
    (t) => (document.querySelector('.md-preview pre code')?.textContent ?? '').includes(t),
    includes,
    { timeout }
  );
}

const snap = (label) =>
  page.evaluate((label) => {
    const pre = document.querySelector('.md-preview pre');
    const code = pre?.querySelector('code');
    const tokens = code ? [...code.querySelectorAll('span[style]')] : [];
    return {
      label,
      hasShiki: !!pre?.classList.contains('shiki'),
      preClass: pre?.className ?? null,
      codeText: (code?.textContent ?? '').replace(/\n/g, '\\n'),
      tokenCount: tokens.length,
      distinctColors: new Set(tokens.map((t) => t.style.color)).size,
      lineSpans: code ? code.querySelectorAll('span.line').length : 0,
      bg: pre ? getComputedStyle(pre).backgroundColor : null,
    };
  }, label);

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

// S1 初始
await setDoc('# 标题\n\n```ts\nconst a = 1;\n```\n');
await waitCode('const a = 1;');
await page.waitForTimeout(600);
let s = await snap('S1');
check('初始 ts 代码块被 Shiki 高亮', s.hasShiki && s.preClass.includes('github-light'), s.preClass);
check('底色来自 --md-code-bg（内联 style 被压回）', s.bg === 'rgb(246, 242, 236)', s.bg);

// S2 代码内插入字符
const idPos = (await docText()).indexOf('const a') + 'const a'.length;
await insertAt(idPos, 'bc');
await waitCode('const abc = 1;');
await page.waitForTimeout(400);
s = await snap('S2');
check('代码内插入后内容与源码一致', s.codeText === 'const abc = 1;\\n', s.codeText);
check('插入后仍保持高亮', s.hasShiki && s.tokenCount > 0, `tokens=${s.tokenCount}`);

// S3 追加函数调用与字符串（新增 token 类型）
await insertAt((await docText()).length - 5, ' + add(2, "x")');
await waitCode('add(2');
await page.waitForTimeout(400);
s = await snap('S3');
check('新增字符串/调用后颜色种类增加', s.distinctColors >= 4, `colors=${s.distinctColors}`);

// S4 切换语言标记
await page.evaluate(() => {
  const v = document.querySelector('.cm-editor').__md_view;
  const at = v.state.doc.toString().indexOf('```ts');
  v.dispatch({ changes: { from: at, to: at + 5, insert: '```python' } });
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const v = document.querySelector('.cm-editor').__md_view;
  const s = v.state.doc.toString();
  const start = s.indexOf('```python') + '```python\n'.length;
  v.dispatch({ changes: { from: start, to: s.indexOf('\n```', start), insert: 'def f(): return 1' } });
});
await waitCode('def f');
await page.waitForTimeout(500);
s = await snap('S4');
check('切换语言标记后按新语言高亮', s.hasShiki && s.codeText.includes('def f'), s.codeText);
check('python 关键字着不同颜色', s.distinctColors >= 3, `colors=${s.distinctColors}`);

// S5 未闭合 fence（正在输入）
await setDoc('# 标题\n\n```ts\nconst a = 1;\n');
await page.waitForTimeout(900);
s = await snap('S5');
check('未闭合 fence 仍按代码块高亮且无报错', s.hasShiki && s.codeText.includes('const a = 1;'), s.codeText);

// S6 补上闭合
await insertAt((await docText()).length, '```\n');
await waitCode('const a = 1;');
await page.waitForTimeout(400);
s = await snap('S6');
check('补上闭合 fence 后高亮正常', s.hasShiki && s.tokenCount > 0, `tokens=${s.tokenCount}`);

// S7 空代码块
await setDoc('# 标题\n\n```ts\n\n```\n');
await page.waitForTimeout(900);
s = await snap('S7');
check('空代码块不崩（0 token / 单个空行）', s.hasShiki && s.tokenCount === 0 && s.lineSpans === 1, `tokens=${s.tokenCount}, lines=${s.lineSpans}`);

// S8 编辑器侧（CodeMirror / lezer）是否对代码内容着色
await setDoc('# 标题\n\n```ts\nconst total = add(1, 2);\n```\n');
await page.waitForTimeout(800);
const editor = await page.evaluate(() => {
  const line = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent.includes('const total'));
  if (!line) return { found: false, styles: 0 };
  const spans = [...line.querySelectorAll('span')];
  return { found: true, styles: new Set(spans.map((s) => s.className)).size };
});
check('编辑器内代码有语法着色（CM6/lezer）', editor.found && editor.styles >= 4, `styles=${editor.styles}`);

// S9 编辑代码 vs 编辑正文的追平耗时
const DOC2 = `# 计时\n\n正文段落内容。\n\n\`\`\`ts\nconst a = 1;\nconst b = 2;\n\`\`\`\n\n结尾段落。\n`;
await setDoc(DOC2);
await page.waitForSelector('.md-preview pre.shiki');
await page.waitForTimeout(1500);

async function measure(pos, ch, probe) {
  return page.evaluate(
    async ({ pos, ch, probe }) => {
      const v = document.querySelector('.cm-editor').__md_view;
      const start = performance.now();
      v.dispatch({ changes: { from: pos, insert: ch } });
      while (performance.now() - start < 15_000) {
        const el = document.querySelector(probe);
        if (el && el.textContent.includes(ch)) return performance.now() - start;
        await new Promise((r) => setTimeout(r, 8));
      }
      return -1;
    },
    { pos, ch, probe }
  );
}

const bodyPos = DOC2.indexOf('正文段落内容。') + '正文段落内容。'.length;
const codePos = DOC2.indexOf('const b = 2;') + 'const b = 2;'.length;
const marks = ['甲', '乙', '丙', '丁', '戊'];
const bodyTimes = [];
const codeTimes = [];
for (let i = 0; i < 5; i++) bodyTimes.push(await measure(bodyPos + i, marks[i], '.md-preview p'));
// 代码块位置要加上前面插入的 5 个字符
for (let i = 0; i < 5; i++) codeTimes.push(await measure(codePos + 5 + i, marks[i], '.md-preview pre code'));

const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const bodyMed = Math.round(med(bodyTimes));
const codeMed = Math.round(med(codeTimes));
check(
  '编辑代码不比编辑正文明显更慢（< 80ms 差）',
  Math.abs(codeMed - bodyMed) < 80,
  `正文 ${bodyMed}ms / 代码 ${codeMed}ms`
);

check('全程无控制台错误', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) process.exitCode = 1;
