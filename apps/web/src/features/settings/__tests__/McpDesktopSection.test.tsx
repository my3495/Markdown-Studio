/**
 * 「MCP 服务」设置分组在 Web 端点必须有明确说明。
 *
 * 回归背景：组件在 `mcpDesktopAvailable() === false` 时直接 `return null`，
 * 于是 Web 端点开该分组是一片空白，用户无法区分「环境不支持」和「加载失败」。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useSettings } from '../../../stores/settings';

const available = vi.fn(() => false);

vi.mock('../../../platform/mcp/desktop', () => ({
  mcpDesktopAvailable: () => available(),
  mcpStatus: vi.fn(async () => ({ running: false })),
  mcpStart: vi.fn(),
  mcpStop: vi.fn(),
}));

const { McpDesktopSection } = await import('../McpDesktopSection');

describe('MCP 服务（Web 端）', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettings.setState({ locale: 'zh-CN' });
  });

  afterEach(() => {
    cleanup();
    available.mockReset();
  });

  it('桌面能力不可用时给出「仅桌面端可用」说明，而不是空白', async () => {
    available.mockReturnValue(false);
    const { container } = render(<McpDesktopSection showTitle={false} />);

    await waitFor(() => expect(screen.getByText(/仅桌面端可用/)).toBeTruthy());
    expect(container.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('桌面能力可用时不渲染该说明', async () => {
    available.mockReturnValue(true);
    render(<McpDesktopSection showTitle={false} />);

    await waitFor(() => expect(screen.queryByText(/仅桌面端可用/)).toBeNull());
  });
});
