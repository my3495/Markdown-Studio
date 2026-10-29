/**
 * 白板工具集细粒度 E2E：覆盖各绘图工具、颜色线宽、选择移动、橡皮擦、
 * 撤销重做、删除清空、快捷键、源码同步与异常容错。
 *
 * 断言口径统一落到「fence 源码」：白板任何操作都会自动写回 ```tldraw，
 * 因此以源码 JSON 作为唯一事实来源，避免依赖渲染细节。
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const EMPTY_FENCE = '{"v":1,"strokes":[],"shapes":[]}';

async function openBoard(page: Page, fenceBody: string = EMPTY_FENCE) {
  await page.goto('/');
  await page.waitForSelector('.cm-content');
  await page.click('.cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(['```tldraw', fenceBody, '```'].join('\n'));
  await expect(page.locator('.md-preview .tldraw-canvas')).toBeVisible();
  return page.locator('.md-preview .tldraw-block').first();
}

/** 读取源码里第一个 tldraw 围栏的 JSON */
async function fence(page: Page): Promise<{
  v: number;
  strokes: { color: string; width: number; points: { x: number; y: number }[] }[];
  shapes: any[];
}> {
  const txt = await page.locator('.cm-content').innerText();
  const m = txt.match(/```tldraw[^\n]*\n([\s\S]*?)```/);
  expect(m, '源码中应存在 tldraw 围栏').toBeTruthy();
  return JSON.parse(m![1]!.trim());
}

async function dragCanvas(
  page: Page,
  canvas: Locator,
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + from.x, b.y + from.y);
  await page.mouse.down();
  await page.mouse.move(b.x + to.x, b.y + to.y, { steps: 6 });
  await page.mouse.up();
}

async function tool(page: Page, board: Locator, label: string) {
  await board.locator(`button[aria-label="${label}"]`).click();
}

test('矩形工具：拖拽生成 rect，尺寸与起点落在画布内', async ({ page }) => {
  const board = await openBoard(page);
  await tool(page, board, '矩形');
  await dragCanvas(page, board.locator('.tldraw-canvas'), { x: 100, y: 80 }, { x: 200, y: 160 });

  const doc = await fence(page);
  const shapes = doc.shapes ?? [];
  expect(shapes).toHaveLength(1);
  expect(shapes[0].type).toBe('rect');
  expect(shapes[0].w).toBeGreaterThan(0);
  expect(shapes[0].h).toBeGreaterThan(0);
  expect(shapes[0].x).toBeGreaterThanOrEqual(0);
  expect(shapes[0].y).toBeGreaterThanOrEqual(0);
});

test('椭圆工具：拖拽生成 ellipse', async ({ page }) => {
  const board = await openBoard(page);
  await tool(page, board, '椭圆');
  await dragCanvas(page, board.locator('.tldraw-canvas'), { x: 120, y: 90 }, { x: 220, y: 150 });

  const shapes = (await fence(page)).shapes ?? [];
  expect(shapes).toHaveLength(1);
  expect(shapes[0].type).toBe('ellipse');
  expect(shapes[0].w).toBeGreaterThan(0);
});

test('箭头工具：拖拽生成 arrow（起终点不同）', async ({ page }) => {
  const board = await openBoard(page);
  await tool(page, board, '箭头');
  await dragCanvas(page, board.locator('.tldraw-canvas'), { x: 80, y: 100 }, { x: 240, y: 180 });

  const shapes = (await fence(page)).shapes ?? [];
  expect(shapes).toHaveLength(1);
  expect(shapes[0].type).toBe('arrow');
  expect(Math.abs(shapes[0].x2 - shapes[0].x1)).toBeGreaterThan(0);
});

test('直线工具：生成两点笔迹', async ({ page }) => {
  const board = await openBoard(page);
  await tool(page, board, '直线');
  await dragCanvas(page, board.locator('.tldraw-canvas'), { x: 60, y: 60 }, { x: 260, y: 200 });

  const { strokes, shapes } = await fence(page);
  expect(shapes ?? []).toHaveLength(0);
  expect(strokes).toHaveLength(1);
  expect(strokes[0]!.points).toHaveLength(2);
});

test('画笔：颜色与线宽随选择落盘', async ({ page }) => {
  const board = await openBoard(page);
  await board.locator('button[aria-label="red"]').click();
  await board.locator('button[aria-label="线宽 XL"]').click();
  await tool(page, board, '画笔');
  await dragCanvas(page, board.locator('.tldraw-canvas'), { x: 70, y: 70 }, { x: 210, y: 130 });

  const { strokes } = await fence(page);
  expect(strokes).toHaveLength(1);
  expect(strokes[0]!.color).toBe('#e5484d');
  expect(strokes[0]!.width).toBe(6);
  expect(strokes[0]!.points.length).toBeGreaterThan(1);
});

test('橡皮擦：命中笔迹后删除并写回', async ({ page }) => {
  const board = await openBoard(page);
  await tool(page, board, '直线');
  await dragCanvas(page, board.locator('.tldraw-canvas'), { x: 100, y: 100 }, { x: 220, y: 160 });
  await expect.poll(async () => (await fence(page)).strokes.length).toBe(1);

  await tool(page, board, '橡皮擦');
  await dragCanvas(page, board.locator('.tldraw-canvas'), { x: 100, y: 100 }, { x: 220, y: 160 });

  await expect.poll(async () => (await fence(page)).strokes.length).toBe(0);
});

test('选择/移动：拖动形状后坐标变化', async ({ page }) => {
  const board = await openBoard(page);
  await tool(page, board, '矩形');
  await dragCanvas(page, board.locator('.tldraw-canvas'), { x: 100, y: 80 }, { x: 180, y: 140 });
  const before = ((await fence(page)).shapes ?? [])[0]!;

  await tool(page, board, '选择/移动');
  await dragCanvas(page, board.locator('.tldraw-canvas'), { x: 140, y: 110 }, { x: 200, y: 160 });

  const after = ((await fence(page)).shapes ?? [])[0]!;
  expect(after.type).toBe('rect');
  expect(after.x).toBeGreaterThan(before.x);
  expect(after.y).toBeGreaterThan(before.y);
});

test('撤销/重做：笔迹可回退与恢复，按钮禁用态正确', async ({ page }) => {
  const board = await openBoard(page);
  const undoBtn = board.locator('button[aria-label="撤销"]');
  const redoBtn = board.locator('button[aria-label="重做"]');
  await expect(undoBtn).toBeDisabled();
  await expect(redoBtn).toBeDisabled();

  await tool(page, board, '画笔');
  await dragCanvas(page, board.locator('.tldraw-canvas'), { x: 80, y: 80 }, { x: 200, y: 140 });
  await expect.poll(async () => (await fence(page)).strokes.length).toBe(1);
  await expect(undoBtn).toBeEnabled();

  await undoBtn.click();
  await expect.poll(async () => (await fence(page)).strokes.length).toBe(0);
  await expect(redoBtn).toBeEnabled();

  await redoBtn.click();
  await expect.poll(async () => (await fence(page)).strokes.length).toBe(1);
});

test('删除选中与清空：只影响目标元素 / 全清', async ({ page }) => {
  const board = await openBoard(page);

  // 先画两个形状：矩形 + 椭圆
  await tool(page, board, '矩形');
  await dragCanvas(page, board.locator('.tldraw-canvas'), { x: 60, y: 60 }, { x: 140, y: 120 });
  await tool(page, board, '椭圆');
  await dragCanvas(page, board.locator('.tldraw-canvas'), { x: 200, y: 150 }, { x: 280, y: 210 });
  await expect.poll(async () => ((await fence(page)).shapes ?? []).length).toBe(2);

  // 选中矩形并删除
  await tool(page, board, '选择/移动');
  await board.locator('.tldraw-canvas').click({ position: { x: 100, y: 90 } });
  await expect(board.locator('.tldraw-sel')).toHaveCount(1);
  await board.locator('button[aria-label="删除选中"]').click();
  await expect.poll(async () => ((await fence(page)).shapes ?? []).length).toBe(1);

  await board.locator('button[aria-label="清空"]').click();
  await expect.poll(async () => ((await fence(page)).shapes ?? []).length).toBe(0);
});

test('快捷键：V/P/L/R/O/A/T/E 切换工具', async ({ page }) => {
  const board = await openBoard(page);
  await board.locator('.tldraw-canvas').click({ position: { x: 320, y: 220 } });

  const expectPressed = async (label: string) =>
    await expect(board.locator(`button[aria-label="${label}"]`)).toHaveAttribute(
      'aria-pressed',
      'true'
    );

  await page.keyboard.press('r');
  await expectPressed('矩形');
  await page.keyboard.press('o');
  await expectPressed('椭圆');
  await page.keyboard.press('l');
  await expectPressed('直线');
  await page.keyboard.press('a');
  await expectPressed('箭头');
  await page.keyboard.press('t');
  await expectPressed('文字');
  await page.keyboard.press('e');
  await expectPressed('橡皮擦');
  await page.keyboard.press('p');
  await expectPressed('画笔');
  await page.keyboard.press('v');
  await expectPressed('选择/移动');
});

test('文字：Escape 取消不落盘', async ({ page }) => {
  const board = await openBoard(page);
  await tool(page, board, '文字');
  await board.locator('.tldraw-canvas').click({ position: { x: 120, y: 100 } });
  const input = board.locator('.tldraw-text-input');
  await input.fill('这段文字要丢弃');
  await input.press('Escape');

  await expect(input).toHaveCount(0);
  await expect.poll(async () => ((await fence(page)).shapes ?? []).length).toBe(0);
  await expect(page.locator('.cm-content')).not.toContainText('这段文字要丢弃');
});

test('源码编辑 → 白板同步（外部改动重新解析）', async ({ page }) => {
  const board = await openBoard(page);
  await expect(board.locator('.tldraw-empty')).toHaveCount(1);

  await page.click('.cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['```tldraw', '{"v":1,"strokes":[],"shapes":[{"type":"rect","x":10,"y":10,"w":80,"h":40,"color":"#3b82f6"}]}', '```'].join(
      '\n'
    )
  );

  await expect(board.locator('svg.tldraw-svg > rect[stroke]')).toHaveCount(1);
  await expect(board.locator('.tldraw-empty')).toHaveCount(0);
});

test('容错：空 fence 与非法 JSON 不崩溃', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const board = await openBoard(page, '');
  await expect(board.locator('.tldraw-empty')).toHaveCount(1);

  await page.click('.cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(['```tldraw', '{not-json', '```'].join('\n'));
  await expect(board.locator('.tldraw-empty')).toHaveCount(1);
  await expect(board.locator('svg.tldraw-svg')).toBeVisible();
  expect(errors).toEqual([]);
});

test('完整白板与轻量模式互切保留形状', async ({ page }) => {
  const board = await openBoard(page);
  await tool(page, board, '文字');
  await board.locator('.tldraw-canvas').click({ position: { x: 120, y: 100 } });
  const input = board.locator('.tldraw-text-input');
  await input.fill('互切保留');
  await input.press('Enter');
  await expect(page.locator('.cm-content')).toContainText('互切保留');

  await board.locator('button[aria-label="完整白板"]').click();
  await expect(page.locator('.md-preview .tl-canvas').first()).toBeVisible();

  await board.locator('button[aria-label="轻量模式"]').click();
  await expect(board.locator('text', { hasText: '互切保留' })).toHaveCount(1);
});
