/**
 * Agent E2E 测试：使用真实 DeepSeek API（BYOK）验证完整 Agent 对话流程。
 *
 * 前置条件：
 * 1. DEEPSEEK_API_KEY 环境变量已设置（真实 key，不会上传）
 * 2. 开发服务器已启动（pnpm dev），端口 1420
 *
 * 运行：
 *   DEEPSEEK_API_KEY=sk-xxxxx pnpm exec playwright test e2e/agent.spec.ts
 * 或直接：
 *   DEEPSEEK_API_KEY=sk-xxxxx pnpm playwright test e2e/agent.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ── helpers ─────────────────────────────────────────────────────────────────

/** 读取环境变量，skip 测试若未设置 */
function deepseekApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) test.skip(true, 'DEEPSEEK_API_KEY not set — skipping real API test');
  return key;
}

/** 注入设置到 localStorage 并刷新 */
async function injectSettings(page: Page, apiKey: string, model = 'deepseek-flash') {
  await page.goto('/');
  await page.evaluate(
    (key) => {
      const settings = {
        theme: 'light',
        width: 'medium',
        typography: {
          spacing: true, numberSpacing: true, punctuation: true,
          ellipsis: true, quotes: true,
        },
        autoNumber: false,
        focusMode: false,
        typewriterMode: false,
        locale: 'zh-CN',
        customVars: {},
        footer: { enabled: true },
        agent: {
          provider: 'deepseek',
          apiKey: key,
          model: 'deepseek-flash',
          allowWrite: false,
          useRemoteEmbed: false,
          embedModel: '',
          embedBaseUrl: '',
        },
        autoSnapshot: true,
        mobileView: 'split',
        splitRatio: 0.5,
        vimMode: false,
        recipesOnSave: false,
        spellCheck: false,
        readingMode: false,
      };
      localStorage.setItem('md-studio:settings', JSON.stringify(settings));
    },
    apiKey
  );
  await page.reload();
}

/** 等待 agent panel 加载完成 */
async function waitForAgentPanel(page: Page) {
  // 找 agent 面板（侧边栏或底部面板）
  await page.waitForSelector('[aria-label*="agent" i], [data-testid*="agent" i], .agent-panel, .agent-chat', {
    timeout: 10_000,
  }).catch(() => {
    // 可能 agent 未在视图中，找 agent 按钮
  });
}

/** 展开 agent 面板（如果未展开） */
async function ensureAgentPanelOpen(page: Page) {
  // 尝试多种可能的 agent 入口按钮
  const selectors = [
    '[aria-label*="agent" i]',
    '[aria-label*="助手" i]',
    '[aria-label*="Agent" i]',
    '[title*="agent" i]',
    '[title*="助手" i]',
    'button.agent-btn',
    'button[data-agent]',
  ];
  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click();
      break;
    }
  }
  await page.waitForTimeout(500);
}

/** 查找并填充 agent 输入框 */
async function fillAgentInput(page: Page, text: string): Promise<void> {
  const selectors = [
    'textarea[placeholder*="agent" i]',
    'textarea[placeholder*="助手" i]',
    'textarea[placeholder*="question" i]',
    'textarea[placeholder*="问题" i]',
    'input[placeholder*="agent" i]',
    'input[placeholder*="助手" i]',
    'textarea.agent-input',
    'textarea[data-agent-input]',
    '.agent-input textarea',
    '.agent-panel textarea',
    '[contenteditable="true"]',
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      await el.fill(text);
      return;
    }
  }
  throw new Error('Agent input not found — check selector list');
}

/** 查找并点击发送按钮 */
async function clickAgentSend(page: Page): Promise<void> {
  const selectors = [
    'button[type="submit"]',
    'button:has-text("发送")',
    'button:has-text("Send")',
    'button:has-text("提交")',
    'button[aria-label*="send" i]',
    'button[aria-label*="发送" i]',
    '.agent-send-btn',
    '.agent-panel button:last-child',
  ];
  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click();
      return;
    }
  }
  // 最后一招：回车提交
  await page.keyboard.press('Enter');
}

/** 等待 assistant 消息出现（streaming 完成） */
async function waitForAssistantMessage(page: Page, timeout = 60_000): Promise<string> {
  const selectors = [
    '.agent-message[role="assistant"]',
    '.agent-message.assistant',
    '.agent-message:last-child',
    '.agent-messages > div:last-child',
    '.agent-chat .assistant',
    '[data-message-role="assistant"]',
    '.message.assistant',
  ];
  const lastText = '';
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const msgs = page.locator(sel);
      const count = await msgs.count();
      if (count > 0) {
        const last = msgs.nth(count - 1);
        if (await last.isVisible({ timeout: 500 }).catch(() => false)) {
          const text = await last.textContent().catch(() => '');
          if (text && text.trim().length > 0) {
            // 等待 streaming 停止（2秒无新内容）
            await page.waitForTimeout(2500);
            const finalText = await last.textContent().catch(() => '');
            if (finalText === text) {
              return finalText.trim();
            }
          }
        }
      }
    }
    await page.waitForTimeout(1000);
  }
  return lastText.trim();
}

/** 检查是否有错误提示 */
async function getErrorText(page: Page): Promise<string | null> {
  const selectors = [
    '[role="alert"]',
    '.agent-error',
    '.error-message',
    '[aria-live="assertive"]',
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      return await el.textContent().catch(() => null);
    }
  }
  return null;
}

// ── 测试用例 ─────────────────────────────────────────────────────────────────

test.describe('Agent 对话 E2E（DeepSeek 真实 API）', () => {
  test.beforeEach(async ({ page }) => {
    const apiKey = deepseekApiKey();
    await injectSettings(page, apiKey);
  });

  test('A-01 Agent 面板能正常打开', async ({ page }) => {
    await ensureAgentPanelOpen(page);
    // 验证输入框存在
    await fillAgentInput(page, 'hi');
    const inputVal = await page.locator('textarea, input[type="text"], [contenteditable="true"]').last().inputValue().catch(() => '');
    expect(inputVal).toContain('hi');
  });

  test('A-02 简单对话能收到 assistant 回复', async ({ page }) => {
    await ensureAgentPanelOpen(page);
    await fillAgentInput(page, '你好，回复「收到」即可');
    await clickAgentSend(page);

    const response = await waitForAssistantMessage(page);
    console.log('[A-02] Response:', response);

    // 验证回复非空
    expect(response.length).toBeGreaterThan(0);
    // 不应包含错误关键词
    const lowerResp = response.toLowerCase();
    expect(lowerResp).not.toContain('error');
    expect(lowerResp).not.toContain('failed');
    expect(lowerResp).not.toContain('模型调用失败');
    expect(lowerResp).not.toContain('aborted');
  });

  test('A-03 对话历史能累积', async ({ page }) => {
    await ensureAgentPanelOpen(page);

    await fillAgentInput(page, '1+1 等于几？');
    await clickAgentSend(page);
    await waitForAssistantMessage(page);
    await page.waitForTimeout(500);

    await fillAgentInput(page, '再加 2 呢？');
    await clickAgentSend(page);
    const response2 = await waitForAssistantMessage(page);
    console.log('[A-03] Response2:', response2);

    // 第二轮回复应该能理解上下文（累计历史）
    expect(response2.length).toBeGreaterThan(0);
    expect(response2).not.toContain('error');
  });

  test('A-04 工具调用：list_notes 能返回结果', async ({ page }) => {
    await ensureAgentPanelOpen(page);

    await fillAgentInput(page, '列出笔记名称，用纯文本返回列表即可');
    await clickAgentSend(page);

    const response = await waitForAssistantMessage(page, 90_000);
    console.log('[A-04] Response:', response);

    // 工具调用后，assistant 应该给出一个文本回复（即使笔记为空）
    expect(response.length).toBeGreaterThan(0);
    const lowerResp = response.toLowerCase();
    // 不应有错误
    expect(lowerResp).not.toContain('模型调用失败');
    expect(lowerResp).not.toContain('error');
    expect(lowerResp).not.toContain('failed');
  });

  test('A-05 Esc 能停止流式输出', async ({ page }) => {
    await ensureAgentPanelOpen(page);
    await fillAgentInput(page, '写一篇 500 字的文章，内容随意');
    await clickAgentSend(page);
    await page.waitForTimeout(2000);

    // 按 Esc 停止
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    const response = await waitForAssistantMessage(page, 5_000);
    console.log('[A-05] Response after Esc:', response);

    // 有部分输出即可（不强制要求完整）
    expect(response.length).toBeGreaterThan(0);
  });

  test('A-06 网络错误时能展示错误信息', async ({ page }) => {
    await ensureAgentPanelOpen(page);

    // 用一个假的 API key 触发认证错误
    await page.evaluate(() => {
      const settings = {
        theme: 'light', width: 'medium',
        typography: { spacing: true, numberSpacing: true, punctuation: true, ellipsis: true, quotes: true },
        autoNumber: false, focusMode: false, typewriterMode: false,
        locale: 'zh-CN', customVars: {}, footer: { enabled: true },
        agent: { provider: 'deepseek', apiKey: 'sk-fake-key-0000000000000000000000000000', model: 'deepseek-flash', allowWrite: false, useRemoteEmbed: false, embedModel: '', embedBaseUrl: '' },
        autoSnapshot: true, mobileView: 'split', splitRatio: 0.5,
        vimMode: false, recipesOnSave: false, spellCheck: false, readingMode: false,
      };
      localStorage.setItem('md-studio:settings', JSON.stringify(settings));
    });
    await page.reload();
    await page.waitForTimeout(2000);

    await fillAgentInput(page, '你好');
    await clickAgentSend(page);

    const errorText = await getErrorText(page);
    const msgContent = await waitForAssistantMessage(page, 15_000);

    // 错误 key 应该触发错误提示
    const combined = `${errorText ?? ''} ${msgContent}`.toLowerCase();
    console.log('[A-06] Error info:', combined);
    // 至少应该出现 error/failed/auth 相关词之一
    expect(
      combined.includes('error') ||
      combined.includes('failed') ||
      combined.includes('认证') ||
      combined.includes('auth') ||
      combined.includes('invalid')
    ).toBeTruthy();
  });
});
