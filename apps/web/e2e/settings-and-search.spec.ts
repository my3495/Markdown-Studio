/**
 * 设置面板、库内搜索、导出菜单、分栏拖拽与大文档性能（Web 端）。
 */
import { expect, test, type Page } from '@playwright/test';

async function setEditor(page: Page, md: string) {
  await page.click('.cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(md);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.cm-content');
});

test('设置面板 9 个分组都能打开且有内容（含 Web 端 MCP 说明）', async ({ page }) => {
  await page.click('.tb-btn[title="设置"]');
  await expect(page.locator('.settings-pane')).toBeVisible();

  const nav = page.locator('.settings-nav-item');
  const count = await nav.count();
  expect(count).toBeGreaterThanOrEqual(9);

  for (let i = 0; i < count; i++) {
    const label = ((await nav.nth(i).textContent()) ?? '').trim();
    await nav.nth(i).click();
    // 每个分组都必须有内容：MCP 在 Web 端曾经是空白面板
    await expect
      .poll(async () => ((await page.locator('.settings-content-body').textContent()) ?? '').trim().length, {
        message: `分组「${label}」渲染为空`,
      })
      .toBeGreaterThan(1);
  }

  // 定位到 MCP 分组时应有「仅桌面端可用」的说明
  await nav.filter({ hasText: 'MCP 服务' }).first().click();
  await expect(page.locator('.settings-content-body')).toContainText('仅桌面端可用');
});

test('图片尺寸语法、块级公式渲染正确', async ({ page }) => {
  const svg =
    'data:image/svg+xml;base64,' +
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
    ).toString('base64');

  await setEditor(page, `# 图片\n\n![示例](${svg} =300x200)\n\n$$\n\\frac{a}{b} = c\n$$\n`);
  await expect(page.locator('.md-preview img')).toHaveAttribute('width', '300');
  await expect(page.locator('.md-preview img')).toHaveAttribute('height', '200');
  await expect(page.locator('.md-preview .katex-display')).toHaveCount(1);
});

test('库内搜索：命中词出结果，无关词显示空状态', async ({ page }) => {
  await page.click('.side-tab:has-text("文件")');
  await expect(page.locator('.side-tab-body .outline-item')).not.toHaveCount(0);

  const hits = page.locator('.vault-results .vault-result');
  await page.fill('.vault-search', '指南');
  await expect(hits).not.toHaveCount(0);
  // 结果按 FTS 得分排序，不保证文件名就是命中词，只要求列表里出现相关内容
  await expect(page.locator('.vault-results')).toContainText('使用指南');

  await page.fill('.vault-search', 'zzzz-nomatch');
  await expect(hits).toHaveCount(0);
  await expect(page.locator('.vault-results .vault-empty')).not.toBeEmpty();
});

test('导出菜单包含 HTML/PDF/LaTeX/DOCX/EPUB', async ({ page }) => {
  await page.click('.tb-btn[title="导出"]');
  const items = page.locator('.tb-menu button, [role="menu"] button');
  await expect(items).not.toHaveCount(0);

  const texts = await items.allTextContents();
  const joined = texts.join('|').toUpperCase();
  for (const need of ['HTML', 'PDF', 'LATEX', 'DOCX', 'EPUB']) {
    expect(joined).toContain(need);
  }

  await page.keyboard.press('Escape');
});

test('拖拽分隔条改变编辑器宽度', async ({ page }) => {
  const editorWidth = () =>
    page.evaluate(() => document.querySelector('.app-editor')?.getBoundingClientRect().width ?? 0);

  const before = await editorWidth();
  const box = await page.locator('.pane-divider').first().boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x - 120, box!.y + box!.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect.poll(editorWidth).not.toBe(before);
});

test('3000 段大文档：粘贴后 3 秒内完成全量渲染', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const big = Array.from({ length: 3000 }, (_, i) => `第 ${i + 1} 段：内容用于性能观察。`).join('\n\n');
  await page.click('.cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.evaluate((t) => navigator.clipboard.writeText(t), big);

  const started = Date.now();
  await page.keyboard.press('Control+v');
  await expect(page.locator('.md-preview')).toContainText('第 3000 段', { timeout: 15_000 });
  const cost = Date.now() - started;

  expect(cost).toBeLessThan(3000);
});
