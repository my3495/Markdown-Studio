/**
 * 编辑器 ↔ 预览主路径（Web 端）。
 *
 * 覆盖：启动渲染、Markdown 输入到预览的联动、字数统计、三种视图模式、
 * 侧栏大纲/属性/收起、命令面板过滤与空状态、未保存→保存状态、主题切换与持久化。
 */
import { expect, test, type Page } from '@playwright/test';

const MD = [
  '# 一级标题',
  '',
  '正文含 **加粗**、*斜体*、`行内代码`。',
  '',
  '## 二级标题',
  '',
  '- 列表一',
  '- 列表二',
  '',
  '| 列 A | 列 B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```js',
  'const n = 42;',
  '```',
  '',
  '行内公式 $a^2+b^2=c^2$。',
  '',
  '---',
  '',
  'frontmatter 之外的最后一段。',
].join('\n');

async function setEditor(page: Page, md: string) {
  await page.click('.cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(md);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.cm-content');
  await expect(page.locator('.md-preview')).toBeVisible();
});

test('启动后编辑器与预览同时存在，且无控制台错误', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('.md-preview')).toBeVisible();
  expect(errors).toEqual([]);
});

test('输入 Markdown 后预览渲染出标题/加粗/列表/表格/代码/公式', async ({ page }) => {
  await setEditor(page, MD);
  await expect(page.locator('.md-preview')).toContainText('最后一段');

  const preview = page.locator('.md-preview');
  await expect(preview.locator('h1')).toHaveText(['一级标题']);
  await expect(preview.locator('h2')).toHaveText(['二级标题']);
  await expect(preview.locator('strong')).toHaveCount(1);
  await expect(preview.locator('em')).toHaveCount(1);
  await expect(preview.locator('table tr')).toHaveCount(2);
  await expect(preview.locator('.katex')).not.toHaveCount(0);
  await expect(preview.locator('pre')).toHaveCount(1);
  await expect(preview.locator('hr')).toHaveCount(1);
});

test('状态栏字数随内容增长', async ({ page }) => {
  const words = page.locator('.sb-words');
  const before = Number.parseInt((await words.textContent()) ?? '0', 10);

  await page.click('.cm-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\n追加一句话用于字数检查。\n');

  await expect
    .poll(async () => Number.parseInt((await words.textContent()) ?? '0', 10))
    .toBeGreaterThan(before);
});

test('编辑 / 预览 / 分栏 三种视图切换', async ({ page }) => {
  const editor = page.locator('.cm-content');
  const preview = page.locator('.md-preview');
  const viewBtn = (label: string) => page.locator('.tb-viewswitch button', { hasText: label });

  await viewBtn('预览').click();
  await expect(editor).toBeHidden();
  await expect(preview).toBeVisible();

  await viewBtn('编辑').click();
  await expect(editor).toBeVisible();
  await expect(preview).toBeHidden();

  await viewBtn('分栏').click();
  await expect(editor).toBeVisible();
  await expect(preview).toBeVisible();
});

test('侧栏：大纲条目、属性面板、显示/隐藏切换', async ({ page }) => {
  await setEditor(page, MD);
  await expect(page.locator('.md-preview')).toContainText('最后一段');

  await page.click('.side-tab:has-text("大纲")');
  const outline = page.locator('.side-tab-body .outline-item');
  await expect(outline).toHaveCount(2);
  await expect(outline.first()).toContainText('一级标题');

  await page.click('.side-tab:has-text("属性")');
  await expect(page.locator('.side-tab-body')).not.toBeEmpty();

  await page.click('.tb-sidetoggle');
  // 侧栏整体容器是 .app-side（.side-tab 是里面的三个 tab 按钮）
  await expect(page.locator('.app-side')).toBeHidden();
  await page.click('.tb-sidetoggle');
  await expect(page.locator('.app-side')).toBeVisible();
});

test('命令面板：Ctrl+K 打开、按关键词过滤、无匹配时显示空状态', async ({ page }) => {
  await page.click('.cm-content');
  await page.keyboard.press('Control+k');

  const items = page.locator('.cmd-item');
  await expect(items).not.toHaveCount(0);
  const total = await items.count();
  expect(total).toBeGreaterThan(5);

  await page.fill('.cmd-input', '设置');
  await expect(items.first()).toContainText('设置');

  await page.fill('.cmd-input', 'zzzz-nomatch');
  await expect(items).toHaveCount(0);
  await expect(page.locator('.cmd-empty')).not.toBeEmpty();

  await page.keyboard.press('Escape');
  await expect(page.locator('.cmd-palette')).toHaveCount(0);
});

test('编辑后显示未保存，Ctrl+S 后变为已保存', async ({ page }) => {
  const saveState = page.locator('.sb-save');

  await page.click('.cm-content');
  await page.keyboard.insertText('x');
  await expect(saveState).toContainText('未保存');

  await page.keyboard.press('Control+s');
  await expect(saveState).toContainText(/已保存|已存/);
});

test('切换深色主题后生效，刷新仍保持', async ({ page }) => {
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const before = await bg();

  await page.click('.tb-btn[title="设置"]');
  await expect(page.locator('.settings-pane')).toBeVisible();

  const nav = page.locator('.settings-nav-item');
  const themeNav = nav.filter({ hasText: /主题|外观/ }).first();
  await themeNav.click();

  await page.locator('.settings-content-body button', { hasText: /深色|暗色|Dark/ }).first().click();
  await expect.poll(bg).not.toBe(before);

  const theme = await page.evaluate(() => {
    const raw = localStorage.getItem('md-studio:settings');
    return raw ? JSON.parse(raw).theme : null;
  });
  expect(theme).toBe('dark');

  await page.reload();
  await page.waitForSelector('.cm-content');
  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('md-studio:settings');
    return raw ? JSON.parse(raw).theme : null;
  });
  expect(persisted).toBe('dark');
});
