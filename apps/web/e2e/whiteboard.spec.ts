/**
 * 白板（```tldraw fence）交互回归。
 *
 * 重点覆盖用户报告的缺陷：「白板里选了文字工具，点画布却无法输入文字」。
 * 根因是浏览器 mousedown 的默认聚焦把焦点从刚挂载的 textarea 抢到画布容器上，
 * textarea 立刻 blur → onBlur 提交空文本并关闭输入层。
 */
import { expect, test, type Page } from '@playwright/test';

const BOARD_MD = ['```tldraw', '{"v":1,"strokes":[],"shapes":[]}', '```'].join('\n');

async function openBoard(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(BOARD_MD);
  await expect(page.locator('.md-preview .tldraw-canvas')).toBeVisible();
  return page.locator('.md-preview .tldraw-block').first();
}

test('轻量白板：文字工具点击画布即出现输入框并获得焦点', async ({ page }) => {
  const board = await openBoard(page);
  await board.locator('button[aria-label="文字"]').click();
  await board.locator('.tldraw-canvas').click({ position: { x: 120, y: 100 } });

  const input = board.locator('.tldraw-text-input');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
});

test('轻量白板：输入文字回车后落到画板并写回 fence 源码', async ({ page }) => {
  const board = await openBoard(page);
  await board.locator('button[aria-label="文字"]').click();
  await board.locator('.tldraw-canvas').click({ position: { x: 120, y: 100 } });

  const input = board.locator('.tldraw-text-input');
  await expect(input).toBeVisible();
  await input.fill('白板文字');
  await input.press('Enter');

  await expect(input).toHaveCount(0);
  await expect(board.locator('text', { hasText: '白板文字' })).toHaveCount(1);
  await expect(page.locator('.cm-content')).toContainText('白板文字');
});

test('轻量白板：点击别处失焦也会提交（不丢字）', async ({ page }) => {
  const board = await openBoard(page);
  await board.locator('button[aria-label="文字"]').click();
  await board.locator('.tldraw-canvas').click({ position: { x: 120, y: 100 } });

  const input = board.locator('.tldraw-text-input');
  await input.fill('失焦提交');
  // 点画布另一处：此时 editing 仍在，pointerdown 被忽略，但 blur 触发提交
  await board.locator('.tldraw-canvas').click({ position: { x: 300, y: 220 } });

  await expect(input).toHaveCount(0);
  await expect(board.locator('text', { hasText: '失焦提交' })).toHaveCount(1);
  await expect(page.locator('.cm-content')).toContainText('失焦提交');
});

test('轻量白板：文字工具不影响画笔绘制', async ({ page }) => {
  const board = await openBoard(page);
  await board.locator('button[aria-label="文字"]').click();
  await board.locator('.tldraw-canvas').click({ position: { x: 120, y: 100 } });
  await page.keyboard.press('Escape');

  await board.locator('button[aria-label="画笔"]').click();
  const canvas = board.locator('.tldraw-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120, { steps: 5 });
  await page.mouse.move(box.x + 200, box.y + 90, { steps: 5 });
  await page.mouse.up();

  await expect(board.locator('.tldraw-svg path')).not.toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('points');
});

test('完整白板：tldraw 文字工具输入后写回 fence', async ({ page }) => {
  const board = await openBoard(page);
  await board.locator('button[aria-label="完整白板"]').click();

  const tlCanvas = page.locator('.md-preview .tl-canvas').first();
  await expect(tlCanvas).toBeVisible();
  const box = (await tlCanvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.click(cx, cy);
  await page.keyboard.press('t');
  await page.mouse.click(cx, cy);
  await page.keyboard.type('完整白板文字');

  await expect(page.locator('.cm-content')).toContainText('完整白板文字');
});
