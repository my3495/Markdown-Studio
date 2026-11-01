/**
 * 选中文字 → Agent 改写 E2E。
 *
 * 与 e2e/agent.spec.ts（真实 DeepSeek key）不同，这里用**伪造的 Ollama 流式响应**
 * 拦截 /api/chat 端点，因此在没有模型、没有 key 的环境里也能回归整条链路：
 * 选区 → 气泡 → 指令 → 定位映射 → diff 确认 → 接受/拒绝 → 应用。
 *
 * 覆盖四个关键点：
 *  1. 提示语言跟随输入语言（中文指令 → 中文弹窗；英文指令 → 英文弹窗）；
 *  2. 定位映射（忽略 "**" 等 Markdown 标记命中，并给出源码行号）；
 *  3. 多处命中时的歧义提示与行号择优；
 *  4. 拒绝 / Esc / 未配置模型等「不改正文」的分支。
 */

import { test, expect, type Page } from '@playwright/test';

const MOCK_REPLY = '这是重要的一段说明，已精简。';

/** 注入设置 + 伪造 LLM 响应 + 打开首页 */
async function bootstrap(page: Page, model = 'qwen2.5') {
  await page.addInitScript(
    ([m]) => {
      localStorage.setItem(
        'md-studio:settings',
        JSON.stringify({
          theme: 'light',
          locale: 'zh-CN',
          width: 'medium',
          agent: {
            provider: 'ollama',
            model: m,
            apiKey: '',
            allowWrite: false,
            useRemoteEmbed: false,
            embedModel: '',
            embedBaseUrl: '',
          },
          autoSnapshot: false,
          mobileView: 'split',
          splitRatio: 0.5,
          agentMode: 'build',
        })
      );
      localStorage.setItem(
        'md-studio:view-prefs',
        JSON.stringify({ agentProvider: 'ollama', agentModel: m })
      );
    },
    [model] as const
  );
  await page.route('**/api/chat', async (route) => {
    const body =
      [
        JSON.stringify({
          model: 'qwen2.5',
          message: { role: 'assistant', content: MOCK_REPLY },
          done: false,
        }),
        JSON.stringify({
          model: 'qwen2.5',
          message: { role: 'assistant', content: '' },
          done: true,
        }),
      ].join('\n') + '\n';
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
      body,
    });
  });
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 });
}

/** 写入正文；expectText 必须是**预览里可见**的片段（不能含 Markdown 标记） */
async function setDoc(page: Page, text: string, expectText: string) {
  await page.click('.cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
  await expect(page.locator('.app-preview')).toContainText(expectText, { timeout: 20_000 });
  // 预览走 Worker + 防抖，可能还有一次重渲染：等它稳定，否则选区会随节点替换被清掉
  await page.waitForTimeout(900);
}

/**
 * 在预览区选中一段文字。
 * 预览 DOM 会把段落拆成多个文本节点（排版 / 加粗标记），因此先在段落**完整文本**里
 * 定位子串得到全局偏移，再用 TreeWalker 把它映射回具体节点 —— 直接按节点下标取会
 * 因为节点拆分而选中完全不同的文字。
 */
async function selectInPreview(page: Page, paragraphKeyword: string, text: string) {
  const select = async () => {
    await page.evaluate(
      ([kw, needle]) => {
        const p = [...document.querySelectorAll('.app-preview p')].find((el) =>
          el.textContent?.includes(kw)
        );
        if (!p) {
          throw new Error('paragraph not found: ' + kw);
        }
        const full = p.textContent ?? '';
        const a = full.indexOf(needle);
        if (a < 0) {
          throw new Error('text not found: ' + needle);
        }
        const b = a + needle.length;
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let acc = 0;
        let start: { node: Text; offset: number } | null = null;
        let end: { node: Text; offset: number } | null = null;
        while (node) {
          const len = (node.textContent ?? '').length;
          if (start === null && acc + len >= a) start = { node: node as Text, offset: a - acc };
          if (acc + len >= b) {
            end = { node: node as Text, offset: b - acc };
            break;
          }
          acc += len;
          node = walker.nextNode();
        }
        if (!start || !end) {
          throw new Error('range mapping failed: ' + needle);
        }
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return;
      },
      [paragraphKeyword, text] as const
    );
  };
  // 预览重渲染会清空选区：最多重试 3 次
  for (let i = 0; i < 3; i++) {
    await select();
    try {
      await expect(page.locator('.rw-bubble')).toBeVisible({ timeout: 2500 });
      return;
    } catch {
      /* 继续重试 */
    }
  }
  throw new Error('bubble not shown: ' + paragraphKeyword + ' / ' + text);
}

async function runRewrite(page: Page, instruction: string) {
  await page.click('.rw-bubble-main');
  await expect(page.locator('.rw-panel')).toBeVisible({ timeout: 10_000 });
  await page.fill('.rw-input', instruction);
  await page.keyboard.press('Enter');
  await expect(page.locator('.rw-backdrop')).toBeVisible({ timeout: 30_000 });
}

test.describe('选中文字 → Agent 改写', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrap(page);
  });

  test('中文指令：中文弹窗 + 忽略标记定位 + 接受后写入正文', async ({ page }) => {
    await setDoc(
      page,
      '# 产品说明\n\n这是**重要**的一段说明，需要改得更简洁一些。\n\n另一段文字。\n',
      '这是'
    );
    // 选整句（含被加粗隐藏的 ** 之后的部分），便于断言旧措辞被整体替换
    await selectInPreview(page, '这是', '这是重要的一段说明，需要改得更简洁一些');
    await runRewrite(page, '更简洁一点');

    const card = page.locator('.rw-card');
    await expect(card.locator('strong')).toHaveText('确认修改');
    // 归一化的定位会忽略 "**"，因此标记留在替换区间外
    await expect(card.locator('.rw-meta')).toContainText('已忽略标记定位');
    await expect(card.locator('.rw-meta')).toContainText('第 3 行');
    // diff：新增片段可能有多个（词级切分），但拼接后必须能看到改写结果
    await expect(card.locator('.rw-add').first()).toBeVisible();
    await expect(card.locator('.rw-diff')).toContainText('已精简');
    await expect(card.locator('.rw-del').first()).toBeVisible();
    await expect(card.locator('button', { hasText: '接受' })).toBeVisible();

    await page.click('.rw-card button:has-text("接受")');
    await expect(page.locator('.cm-content')).toContainText('已精简');
    await expect(page.locator('.cm-content')).not.toContainText('需要改得更');
    await expect(page.locator('.toast-msg')).toContainText('已应用修改');
  });

  test('英文指令：英文弹窗 + 拒绝后正文不变', async ({ page }) => {
    await setDoc(
      page,
      '# Release Note\n\nThis legacy paragraph is overly verbose and must be trimmed down.\n\nTail.\n',
      'This legacy'
    );
    await selectInPreview(page, 'This legacy', 'This legacy paragraph');
    await runRewrite(page, 'make it shorter, keep the meaning');

    const card = page.locator('.rw-card');
    await expect(card.locator('strong')).toHaveText('Confirm change');
    await expect(card.locator('button', { hasText: 'Accept' })).toBeVisible();

    const before = await page.locator('.cm-content').textContent();
    await page.click('.rw-card button:has-text("Reject")');
    await expect(page.locator('.rw-backdrop')).toHaveCount(0);
    expect(await page.locator('.cm-content').textContent()).toBe(before);
  });

  test('多处命中：歧义提示 + 按行号择优', async ({ page }) => {
    await setDoc(page, '# 重复片段\n\n第一段坑。\n\n第二段坑。\n\n第三段坑。\n', '第三段坑');
    // “段坑”在正文里出现 3 次（第 3/5/7 行），选区落在第 3 段 → 应择优到第 7 行
    await selectInPreview(page, '第三段坑', '段坑');
    await runRewrite(page, '改写得更正式');

    const card = page.locator('.rw-card');
    await expect(card.locator('.rw-warn')).toContainText('出现 3 次');
    await expect(card.locator('.rw-meta')).toContainText('第 7 行');

    // 重新生成 → 再次出弹窗；Esc → 关闭
    await page.click('.rw-card button:has-text("重新生成")');
    await expect(page.locator('.rw-backdrop')).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.rw-backdrop')).toHaveCount(0);
  });

  test('Esc 收起指令面板，且不改正文', async ({ page }) => {
    await setDoc(page, '# 标题\n\n这是一段用于测试取消路径的正文。\n', '这是一段');
    await selectInPreview(page, '这是一段', '这是一段用于测试取消路径的正文');
    const before = await page.locator('.cm-content').textContent();

    await page.click('.rw-bubble-main');
    await expect(page.locator('.rw-panel')).toBeVisible({ timeout: 10_000 });
    await page.fill('.rw-input', '更简洁');
    await page.keyboard.press('Escape');
    await expect(page.locator('.rw-panel')).toHaveCount(0);
    expect(await page.locator('.cm-content').textContent()).toBe(before);
  });
});

test.describe('选中文字 → Agent 改写（异常分支）', () => {
  test('未配置模型：提示且不改正文', async ({ page }) => {
    // 模型留空：run() 应在调模型之前就停住
    await bootstrap(page, '');
    await setDoc(page, '# 标题\n\n这是一段需要改写的正文。\n', '这是一段');
    const before = await page.locator('.cm-content').textContent();

    await selectInPreview(page, '这是一段', '这是一段需要改写');
    await page.click('.rw-bubble-main');
    await expect(page.locator('.rw-panel')).toBeVisible({ timeout: 10_000 });
    await page.fill('.rw-input', '更简洁');
    await page.keyboard.press('Enter');

    await expect(page.locator('.toast-msg')).toContainText('未配置模型');
    // 仍停在指令输入态，正文未被改动
    await expect(page.locator('.rw-panel')).toBeVisible();
    await expect(page.locator('.rw-backdrop')).toHaveCount(0);
    expect(await page.locator('.cm-content').textContent()).toBe(before);
  });
});
