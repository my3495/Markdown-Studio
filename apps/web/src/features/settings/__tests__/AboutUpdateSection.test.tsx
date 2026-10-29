/**
 * 「关于与更新」在 Web 环境下的表现：
 * 不谎称支持自更新，但版本号必须是真实构建版本（曾经显示 0.0.0）。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AboutUpdateSection } from '../AboutUpdateSection';
import { APP_VERSION } from '../../../platform/version';
import { useSettings } from '../../../stores/settings';

describe('关于与更新（Web 端）', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettings.setState({ locale: 'zh-CN' });
  });

  afterEach(cleanup);

  it('A-01 显示真实版本号，并说明仅桌面端支持自更新', async () => {
    render(<AboutUpdateSection />);

    await waitFor(() => expect(screen.getByText(APP_VERSION)).toBeTruthy());
    expect(screen.queryByText('0.0.0')).toBeNull();
    expect(screen.getByText(/仅桌面端可用/)).toBeTruthy();
    // Web 端不渲染「检查更新」按钮，避免点了也没用
    expect(screen.queryByRole('button', { name: /检查更新/ })).toBeNull();
  });
});
