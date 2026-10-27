import { useEffect, useState } from 'react';
import { useVault } from '../../stores/vault';
import { useDocuments } from '../../stores/document';
import { useSettings } from '../../stores/settings';
import { useUi } from '../../stores/ui';
import { shortcutLabel } from '../../platform/shortcut/registry';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n';

const KEY = 'md-studio-onboard-v1';

/** 首次使用轻量引导条（可关闭，写入 localStorage） */
export function OnboardingBanner() {
  const locale = useSettings((s) => s.locale);
  const persisted = useVault((s) => s.persisted);
  const orderLen = useDocuments((s) => s.order.length);
  const openPalette = useUi((s) => s.openPalette);
  const openFolder = useVault((s) => s.openFolder);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === '1') return;
    } catch {
      /* ignore */
    }
    // 已挂载知识库或文档较多时不再打扰
    if (persisted || orderLen > 2) return;
    setVisible(true);
  }, [persisted, orderLen]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <div className="onboard-banner" role="region" aria-label={t(locale, 'onboardTitle')}>
      <div className="onboard-body">
        <strong>{t(locale, 'onboardTitle')}</strong>
        <span className="onboard-hint">{t(locale, 'onboardHint')}</span>
        <div className="onboard-actions">
          <button
            type="button"
            className="tb-btn"
            onClick={() => {
              void openFolder();
              dismiss();
            }}
          >
            <Icon name="open" size={14} />
            <span className="tb-label">{t(locale, 'folder')}</span>
          </button>
          <button type="button" className="tb-btn" onClick={() => openPalette()}>
            <Icon name="search" size={14} />
            <span className="tb-label">
              {t(locale, 'commandPalette')} ({shortcutLabel('commandPalette')})
            </span>
          </button>
        </div>
      </div>
      <button type="button" className="icon-btn" onClick={dismiss} aria-label={t(locale, 'close')}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
