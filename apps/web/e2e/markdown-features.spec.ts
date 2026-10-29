/**
 * Markdown 语法与交互细节（Web 端）。
 *
 * 覆盖：GFM 任务列表/删除线、外链安全属性、双链、[TOC]、shiki 高亮、
 * 阅读态/对焦模式、大纲点击跳转、文件列表切换、空文档边界。
 */
import { expect, test, type Page } from '@playwright/test';

const MD = [
  '# 一级标题',
  '',
  '- [x] 已完成任务',
  '- [ ] 未完成任务',
  '',
  '~~删除线~~ 与 [外链](https://example.com/a) 与 [[双链目标]]',
  '',
  '[TOC]',
  '',
  '## 二级标题',
  '',
  '```ts',
  'const answer: number = 42;',
  '```',
  '',
  '结尾段落。',
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
  await setEditor(page, MD);
  await expect(page.locator('.md-preview')).toContainText('结尾段落');
});

test('GFM：任务列表勾选态与删除线', async ({ page }) => {
  const boxes = page.locator('.md-preview input[type="checkbox"]');
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).toBeChecked();
  await expect(boxes.nth(1)).not.toBeChecked();
  await expect(page.locator('.md-preview del')).toHaveCount(1);
});

test('外链带 target=_blank 与 rel=noopener', async ({ page }) => {
  const link = page.locator('.md-preview a[href^="https://example.com"]');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
});

test('双链渲染为 data-wikilink，[TOC] 渲染出目录', async ({ page }) => {
  await expect(page.locator('.md-preview a[data-wikilink]')).toHaveCount(1);
  const toc = page.locator('.md-preview .md-toc');
  await expect(toc).toBeVisible();
  await expect(toc.locator('a')).not.toHaveCount(0);
});

test('代码块经 shiki 高亮（产出 span）', async ({ page }) => {
  const pre = page.locator('.md-preview pre').first();
  await expect(pre).toBeVisible();
  await expect(pre.locator('span')).not.toHaveCount(0);
});

test('阅读态与对焦模式切换 app-shell 类名并可还原', async ({ page }) => {
  const shell = page.locator('.app-shell');
  const cls = async () => (await shell.getAttribute('class')) ?? '';

  await page.locator('.tb-btn', { hasText: '阅读态' }).click();
  await expect(shell).toHaveClass(/reading-mode/);
  await page.locator('.tb-btn', { hasText: '阅读态' }).click();
  await expect(shell).not.toHaveClass(/reading-mode/);

  const before = await cls();
  await page.click('.tb-btn[title="Ctrl+Shift+F"]');
  await expect(shell).toHaveClass(/focus-mode/);
  await page.click('.tb-btn[title="Ctrl+Shift+F"]');
  await expect.poll(cls).toBe(before);
});

test('大纲点击可跳转到文档后部（编辑器滚动）', async ({ page }) => {
  const long = Array.from({ length: 120 }, (_, i) => `第 ${i + 1} 段内容。`).join('\n\n');
  await setEditor(page, `# 顶部标题\n\n${long}\n\n## 底部标题\n\n最后一段。\n`);
  await expect(page.locator('.md-preview')).toContainText('最后一段');

  await page.click('.side-tab:has-text("大纲")');
  const items = page.locator('.side-tab-body .outline-item');
  await expect(items).toHaveCount(2);
  // 等大纲换成新文档的标题（旧文档同样是 2 条，只看数量会拿到过期条目）
  await expect(items.last()).toContainText('底部标题');

  const scrollTop = () => page.evaluate(() => document.querySelector('.cm-scroller')?.scrollTop ?? 0);
  const before = await scrollTop();
  await items.last().click();
  await expect.poll(scrollTop, { timeout: 10_000 }).toBeGreaterThan(before);
});

test('文件列表可切换文档且编辑器内容随之变化', async ({ page }) => {
  await page.click('.side-tab:has-text("文件")');
  const items = page.locator('.side-tab-body .outline-item');
  await expect(items).not.toHaveCount(0);

  const content = () => page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '');
  const before = await content();
  await items.nth(1).click();
  await expect.poll(content).not.toBe(before);
});

test('清空全部内容后预览不崩且无错误边界', async ({ page }) => {
  await page.click('.cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');

  await expect(page.locator('.md-preview')).toBeVisible();
  await expect(page.locator('.preview-error')).toHaveCount(0);
  await expect(page.locator('.md-preview')).toHaveText('');
});
