import { useSettings } from '../../stores/settings';
import type { PanelId } from '../../stores/ui';
import { Icon, type IconName } from '../../components/Icon';
import { t } from '../../i18n';
import { SettingsPanel } from '../settings/SettingsPanel';
import { HistoryPanel } from '../history/HistoryPanel';
import { CryptoPanel } from '../crypto/CryptoPanel';
import { GitPanel } from '../git/GitPanel';
import { SyncPanel } from '../sync/SyncPanel';
import { VaultGraph } from '../vault/VaultGraph';

export const PANEL_META: Record<PanelId, { icon: IconName; labelKey: string }> = {
  settings: { icon: 'settings', labelKey: 'settings' },
  history: { icon: 'history', labelKey: 'history' },
  crypto: { icon: 'crypto', labelKey: 'cryptoTitle' },
  git: { icon: 'git', labelKey: 'gitTitle' },
  sync: { icon: 'sync', labelKey: 'syncTitle' },
  graph: { icon: 'graph', labelKey: 'graph' },
};

/** 主显示区的面板标签内容：统一头部（zone-head）+ 各面板内容（自带 panel-pane/panel-body） */
export function PanelView({ id, onClose }: { id: PanelId; onClose: () => void }) {
  const locale = useSettings((s) => s.locale);
  const meta = PANEL_META[id];

  return (
    <div className="panel-view">
      <div className="zone-head">
        <span className="zone-title">
          <Icon name={meta.icon} size={15} />
          {t(locale, meta.labelKey)}
        </span>
        <span className="zone-head-actions">
          <button
            type="button"
            className="icon-btn"
            title={t(locale, 'close')}
            aria-label={t(locale, 'close')}
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </span>
      </div>

      {id === 'settings' && <SettingsPanel />}
      {id === 'history' && <HistoryPanel onClose={onClose} />}
      {id === 'crypto' && <CryptoPanel />}
      {id === 'git' && <GitPanel />}
      {id === 'sync' && <SyncPanel />}
      {id === 'graph' && <VaultGraph variant="main" />}
    </div>
  );
}
