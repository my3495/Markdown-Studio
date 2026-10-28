/**
 * 应用整体功能审计（真实浏览器，覆盖主链路而非单点组件）。
 *
 * 单测覆盖的是纯逻辑与组件契约；这里验证「用户真的能走通」的那些链路：
 *   编辑 → 预览 → 大纲跳转 → 命令面板 → 主题/视图/专注 → 幻灯片 → 保存快捷键。
 *
 * 用法：
 *   1) pnpm --filter @md-studio/web dev
 *   2) node scripts/audit-app-functionality.mjs
 * 可用 AUDIT_BASE 覆盖地址（默认 http://localhost:1420/）。
 */
import { chromium } from '@playwright/test';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:1420/';

const DOC = [
  '# 第一节',
  '',
  '第一段，包含 ==高亮== 与 `code`。',
  '',
  '[TOC]',
  '',
  '## 第二节',
  '',
  '| A | B |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '---',
  '',
  '# 幻灯片二',
  '',
  '第二页内容。',
].join('\n');

const SECOND_HEADING_LINE = DOC.split('\n').findIndex((l) => l.startsWith('## 第二节')) + 1;

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 950 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

await page.goto(BASE);
await page.waitForSelector('.cm-editor', { timeout: 60_000 });
// 启动阶段 app 会异步装载工作区/文档，等首屏真的画出预览再开始操作，
// 否则注入的内容可能被随后的状态恢复覆盖（曾导致首轮断言偶发失败）
await page.waitForSelector('.md-preview p, .md-preview h1', { timeout: 60_000 });

/**
 * 用编辑器实例整篇替换（快捷键与 input 路径另有检查，避免相互干扰）。
 * 注入后必须等到预览真的出现 marker 再继续：渲染走 Worker，冷启动时首帧可能 >1s。
 */
async function setDoc(md, marker = '第一节') {
  await page.evaluate((content) => {
    const v = document.querySelector('.cm-editor').__md_view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: content } });
  }, md);
  await page.waitForFunction(
    (t) => (document.querySelector('.md-preview')?.textContent ?? '').includes(t),
    marker,
    { timeout: 60_000 }
  );
  await page.waitForTimeout(300);
}

/** 命令面板内执行某条命令（按 id 精确定位，避免文案差异） */
async function runCommand(id, { query } = {}) {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.cmd-palette', { timeout: 10_000 });
  if (query) await page.fill('.cmd-input', query);
  await page.click(`#cmd-item-${id}`);
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------- A. 骨架与编辑链路
check(
  'A1 三栏骨架齐备（工具栏/编辑器/预览/状态栏）',
  (await page.$('.toolbar')) !== null &&
    (await page.$('.app-editor .cm-editor')) !== null &&
    (await page.$('.app-preview')) !== null &&
    (await page.$('.statusbar')) !== null
);

await setDoc(DOC);

const preview = await page.evaluate(() => {
  const el = document.querySelector('.md-preview');
  return {
    hasH1: !!el.querySelector('h1'),
    hasH2: !!el.querySelector('h2'),
    hasTable: !!el.querySelector('table'),
    hasMark: el.innerHTML.includes('<mark>高亮</mark>'),
    hasShiki: !!el.querySelector('pre.shiki'),
    hasToc: !!el.querySelector('.md-toc'),
    hasHr: !!el.querySelector('hr'),
  };
});
check('A2 Markdown 渲染：标题/表格/等号高亮/代码高亮/HR', 
  preview.hasH1 && preview.hasH2 && preview.hasTable && preview.hasMark && preview.hasShiki && preview.hasHr);
check('A3 [TOC] 占位符渲染为目录', preview.hasToc);

// 真实键盘输入路径（onChange → store → 渲染 Worker → 预览）
// 字数由编辑器变化后的副作用异步刷新，先等它落到非 0（文档刚注入时可能还是上一版）
await page.waitForFunction(
  () => Number((document.querySelector('.sb-words')?.textContent ?? '0').replace(/[^\d]/g, '')) > 0,
  null,
  { timeout: 30_000 }
);
const beforeWords = Number((await page.textContent('.sb-words')).replace(/[^\d]/g, ''));
await page.click('.cm-content');
await page.keyboard.press('Control+End');
await page.keyboard.type(' KEYBOARD_INPUT');
await page
  .waitForFunction(
    () => (document.querySelector('.md-preview')?.textContent ?? '').includes('KEYBOARD_INPUT'),
    null,
    { timeout: 30_000 }
  )
  .catch(() => {});
const previewText = await page.textContent('.md-preview');
check('A4 键盘输入实时同步到预览', previewText.includes('KEYBOARD_INPUT'));

const afterWords = Number((await page.textContent('.sb-words')).replace(/[^\d]/g, ''));
check('A5 状态栏字数随输入增长', afterWords > beforeWords, `${beforeWords} → ${afterWords}`);

// ---------------------------------------------------------------- B. 大纲
await page.click('.side-tab[title="大纲"]');
await page.waitForTimeout(300);
const outlineTexts = await page.$$eval('.outline-item', (els) => els.map((e) => e.textContent));
check(
  'B1 大纲列出文档标题（含层级）',
  ['第一节', '第二节', '幻灯片二'].every((x) => outlineTexts.some((t) => t.includes(x))),
  outlineTexts.join(' | ')
);

const secondIdx = outlineTexts.findIndex((t) => t.includes('第二节'));
await page.click(`.outline-item >> nth=${secondIdx}`);
await page.waitForTimeout(200);
const cursorLine = await page.evaluate(() => {
  const v = document.querySelector('.cm-editor').__md_view;
  return v.state.doc.lineAt(v.state.selection.main.head).number;
});
check('B2 点击大纲项把光标定位到对应标题行', cursorLine === SECOND_HEADING_LINE, `line=${cursorLine} 期望 ${SECOND_HEADING_LINE}`);

// ---------------------------------------------------------------- C. 命令面板与专注模式
await page.keyboard.press('Control+k');
await page.waitForSelector('.cmd-palette', { timeout: 10_000 });
const totalItems = (await page.$$('.cmd-item')).length;
await page.fill('.cmd-input', '对焦');
await page.waitForTimeout(200);
const filteredItems = (await page.$$('.cmd-item')).length;
check('C1 Ctrl+K 打开命令面板', (await page.$('.cmd-palette')) !== null);
check('C2 输入即过滤（条目数减少且仍能命中）', filteredItems > 0 && filteredItems < totalItems, `${totalItems} → ${filteredItems}`);
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('C3 Enter 执行命令（进入对焦模式）', await page.$('.app-shell.focus-mode') !== null);

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('C4 Esc 退出对焦模式', (await page.$('.app-shell.focus-mode')) === null);

// ---------------------------------------------------------------- D. 主题 / 视图
const themeBefore = await page.evaluate(() => ({
  dark: document.documentElement.classList.contains('dark'),
  bg: getComputedStyle(document.documentElement).getPropertyValue('--md-color-bg').trim(),
}));
await runCommand('theme');
const themeAfter = await page.evaluate(() => ({
  dark: document.documentElement.classList.contains('dark'),
  bg: getComputedStyle(document.documentElement).getPropertyValue('--md-color-bg').trim(),
}));
check('D1 主题命令切换 dark 类与背景变量', themeAfter.dark !== themeBefore.dark && themeAfter.bg !== themeBefore.bg, `${themeBefore.bg} → ${themeAfter.bg}`);

await runCommand('theme'); // 复原，避免影响后续断言
const themeRestored = await page.evaluate(() => document.documentElement.classList.contains('dark'));
check('D2 再次执行可切回原主题', themeRestored === themeBefore.dark);

await page.click('button[title="预览"]');
await page.waitForTimeout(300);
check('D3 视图切换为「预览」只显示预览', await page.$('.app-shell.view-preview') !== null);
await page.click('button[title="分栏"]');
await page.waitForTimeout(300);
check('D4 视图切回「分栏」', await page.$('.app-shell.view-split') !== null);

// ---------------------------------------------------------------- E. 幻灯片
await runCommand('slides');
await page.waitForSelector('.slideshow', { timeout: 10_000 });
const progress1 = await page.textContent('.slideshow-progress');
check('E1 幻灯片打开并分页（--- 分隔）', /^1 \/ \d+$/.test(progress1.trim()), progress1.trim());
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
const progress2 = await page.textContent('.slideshow-progress');
check('E2 右方向键翻页', progress2.trim().startsWith('2 /'), progress2.trim());
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('E3 Esc 关闭幻灯片', (await page.$('.slideshow')) === null);

// ---------------------------------------------------------------- F. 更多菜单（打字机）
await page.click('button[title="更多"]');
await page.click('.tb-menu-item:has-text("打字机模式")');
await page.waitForTimeout(300);
const chips = await page.$$eval('.sb-chip', (els) => els.map((e) => e.textContent));
check('F1 更多菜单可切换打字机模式并显示状态胶囊', chips.some((c) => c.includes('打字机模式')), chips.join(','));

// ---------------------------------------------------------------- G. 保存链路
const dirtyBefore = await page.$('.sb-save .sb-dot.dirty');
const downloadPromise = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
await page.keyboard.press('Control+s');
const saveDownload = await downloadPromise;
check('G1 编辑后状态栏显示「未保存」', dirtyBefore !== null);
check(
  'G2 Ctrl+S 触发 Markdown 下载（Web 端保存路径）',
  saveDownload !== null && /\.(md|markdown)$/i.test(saveDownload.suggestedFilename()),
  saveDownload?.suggestedFilename() ?? 'no download'
);
await page.waitForTimeout(500);
check('G3 保存后状态回到「已保存」', (await page.$('.sb-save .sb-dot.ok')) !== null);

// ---------------------------------------------------------------- H. 标签快捷键
const tabCountBefore = (await page.$$('.tab:not(.panel-tab)')).length;
await page.keyboard.press('Control+n');
await page.waitForTimeout(500);
const tabCountAfterNew = (await page.$$('.tab:not(.panel-tab)')).length;
check('H1 Ctrl+N 新建标签', tabCountAfterNew === tabCountBefore + 1, `${tabCountBefore} → ${tabCountAfterNew}`);

await page.keyboard.press('Control+w');
await page.waitForTimeout(500);
const tabCountAfterClose = (await page.$$('.tab:not(.panel-tab)')).length;
check('H2 Ctrl+W 关闭当前标签', tabCountAfterClose === tabCountBefore, `${tabCountAfterNew} → ${tabCountAfterClose}`);

// ---------------------------------------------------------------- I. 书写宽度快捷键
const widthBefore = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--md-max-width').trim()
);
await page.keyboard.press('Control+Shift+W');
await page.waitForTimeout(400);
const widthAfter = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--md-max-width').trim()
);
check('I1 Ctrl+Shift+W 切换书写宽度', widthAfter !== widthBefore && widthAfter !== '', `${widthBefore} → ${widthAfter}`);

for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Control+Shift+W');
  await page.waitForTimeout(250);
}
const widthCycled = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--md-max-width').trim()
);
check('I2 连续四次循环回到原档位', widthCycled === widthBefore, `${widthAfter} → ${widthCycled}`);

// ---------------------------------------------------------------- J. 分享卡片快捷键
const cardDownloadPromise = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
await page.keyboard.press('Control+Shift+C');
const cardDownload = await cardDownloadPromise;
check(
  'J1 Ctrl+Shift+C 生成分享卡片 PNG',
  cardDownload !== null && cardDownload.suggestedFilename() === 'share-card.png',
  cardDownload?.suggestedFilename() ?? 'no download'
);

// ---------------------------------------------------------------- 汇总
check('Z1 全程无控制台错误', consoleErrors.length === 0, consoleErrors.join(' | '));
await browser.close();

for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) process.exitCode = 1;
