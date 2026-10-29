/**
 * 键盘工作流回归（模拟真人打字节奏，而非一次性 insertText）。
 *
 * 这两条曾经是真故障：
 * 1. 保存竞态：编辑器输入防抖 150ms 才同步进 store，`saveActive` 直接读 store，
 *    「打完字立刻 Ctrl+S」导出的是 150ms 前的旧文本（实测整段输入全丢）。
 * 2. 打字机模式：内容没有上下留白，文末光标居中所需位移超过可滚动上限被夹住，
 *    开关打开后毫无视觉变化（写作时几乎永远在文末）。
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function clearEditor(page: Page) {
  await page.click('.cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.cm-content');
});

test('打完字立刻 Ctrl+S：保存内容包含全部输入且状态为已保存', async ({ page }) => {
  await clearEditor(page);
  const typed = 'AAAA-BBBB-CCCC-DDDD-EEEE';
  await page.keyboard.type(typed, { delay: 0 });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.keyboard.press('Control+s'),
  ]);
  const content = readFileSync(await download.path(), 'utf8');

  expect(content).toContain(typed);
  await expect(page.locator('.sb-save')).toContainText(/已保存|已存/);
});

test('打字机模式开启后光标保持在编辑器中部', async ({ page }) => {
  const caretRatio = async () => {
    await page.waitForTimeout(250);
    return page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller');
      const caret = document.querySelector('.cm-cursor');
      if (!scroller || !caret) return null;
      const s = scroller.getBoundingClientRect();
      const c = caret.getBoundingClientRect();
      return (c.top - s.top) / s.height;
    });
  };

  await clearEditor(page);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.type(`第 ${i + 1} 行内容。`, { delay: 0 });
    await page.keyboard.press('Enter');
  }
  const off = await caretRatio();
  expect(off).not.toBeNull();
  expect(off!).toBeGreaterThan(0.7); // 关闭时贴底

  await page.keyboard.press('Control+Shift+T');
  await expect(page.locator('.sb-chip', { hasText: '打字机模式' })).toBeVisible();

  for (let i = 0; i < 3; i++) {
    await page.keyboard.type('打字机模式行。', { delay: 0 });
    await page.keyboard.press('Enter');
  }
  const on = await caretRatio();
  expect(on).not.toBeNull();
  // 视口中部 ±20%
  expect(on!).toBeGreaterThan(0.3);
  expect(on!).toBeLessThan(0.7);

  await page.keyboard.press('Control+Shift+T'); // 复原
});

test('Ctrl+Z 撤销会同步回退预览，Ctrl+Y 重做恢复', async ({ page }) => {
  await clearEditor(page);
  await page.keyboard.type('撤销标记 ZZMARK', { delay: 5 });
  await expect(page.locator('.md-preview')).toContainText('ZZMARK');

  await page.keyboard.press('Control+z');
  await expect(page.locator('.md-preview')).not.toContainText('ZZMARK');

  await page.keyboard.press('Control+y');
  await expect(page.locator('.md-preview')).toContainText('ZZMARK');
});
