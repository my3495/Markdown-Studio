/**
 * 白板（```tldraw fence）交互回归。
 *
 * 覆盖用户报告的缺陷：
 * 1. 「白板里选了文字工具，点画布却无法输入文字」——浏览器 mousedown 的默认聚焦
 *    把焦点从刚挂载的 textarea 抢到画布容器上，textarea 立刻 blur → 提交空文本并关层；
 * 2. 「未确认前无法移动、无法设置文字大小」——文字字号硬编码、线宽控件对非笔迹禁用，
 *    且点工具栏会用 blur 把未确认的文字提交掉。
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

test('轻量白板：输入过程中即可设置字号（不会被 blur 打断）', async ({ page }) => {
  const board = await openBoard(page);
  await board.locator('button[aria-label="文字"]').click();
  await board.locator('.tldraw-canvas').click({ position: { x: 120, y: 100 } });

  const input = board.locator('.tldraw-text-input');
  await expect(input).toBeVisible();

  // 输入层仍在时点字号：不应提交/关闭输入层
  await board.locator('button[aria-label="字号 L"]').click();
  await expect(input).toBeVisible();
  await expect(input).toHaveCSS('font-size', '24px');

  await input.fill('大号文字');
  await input.press('Enter');

  const text = board.locator('text', { hasText: '大号文字' });
  await expect(text).toHaveAttribute('font-size', '24');
  await expect(page.locator('.cm-content')).toContainText('"size":"l"');
});

test('轻量白板：选中文字后仍可改字号', async ({ page }) => {
  const board = await openBoard(page);
  await board.locator('button[aria-label="文字"]').click();
  await board.locator('.tldraw-canvas').click({ position: { x: 120, y: 100 } });
  const input = board.locator('.tldraw-text-input');
  await input.fill('可调字号');
  await input.press('Enter');

  const text = board.locator('text', { hasText: '可调字号' });
  await expect(text).toBeVisible();
  const box = (await text.boundingBox())!;

  await board.locator('button[aria-label="选择/移动"]').click();
  await page.mouse.click(box.x + 6, box.y + box.height / 2);
  await expect(board.locator('.tldraw-sel')).toHaveCount(1);

  await board.locator('button[aria-label="字号 XL"]').click();
  await expect(text).toHaveAttribute('font-size', '32');
  await expect(page.locator('.cm-content')).toContainText('"size":"xl"');
});

test('轻量白板：未确认前可拖动文字位置', async ({ page }) => {
  const board = await openBoard(page);
  await board.locator('button[aria-label="文字"]').click();
  await board.locator('.tldraw-canvas').click({ position: { x: 120, y: 100 } });

  const input = board.locator('.tldraw-text-input');
  await input.fill('拖动文字');
  const before = (await input.boundingBox())!;

  const handle = board.locator('.tldraw-text-handle');
  const hb = (await handle.boundingBox())!;
  const cx = hb.x + hb.width / 2;
  const cy = hb.y + hb.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 50, { steps: 8 });
  await page.mouse.up();

  const after = (await input.boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(60);
  expect(after.y - before.y).toBeGreaterThan(35);

  await input.press('Enter');
  await expect(board.locator('text', { hasText: '拖动文字' })).toHaveCount(1);
  await expect(page.locator('.cm-content')).toContainText('拖动文字');
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
