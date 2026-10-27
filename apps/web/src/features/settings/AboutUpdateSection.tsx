/**
 * 「关于与更新」分区（设置面板第 9 个分区）。
 *
 * 桌面端接入 tauri-plugin-updater：检查 GitHub Releases → 下载 → 安装 → 重启。
 * Web 端后端不可用时仅展示版本号，更新入口自动隐藏。
 */
import { useEffect, useState } from 'react';
import { useSettings } from '../../stores/settings';
import { toast } from '../../stores/toast';
import { t } from '../../i18n';
import { Icon } from '../../components/Icon';
import { getUpdateBackend, type UpdateInfo } from '../../platform/update/registry';

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; current: string }
  | { kind: 'available'; info: UpdateInfo }
  | { kind: 'downloading'; percent: number }
  | { kind: 'error'; message: string };

export function AboutUpdateSection() {
  const s = useSettings();
  const locale = s.locale;
  const backend = getUpdateBackend();
  const supported = backend.available();

  const [current, setCurrent] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  useEffect(() => {
    let alive = true;
    void backend.currentVersion().then((v) => {
      if (alive) setCurrent(v);
    });
    return () => {
      alive = false;
    };
  }, [backend]);

  const doCheck = async () => {
    setPhase({ kind: 'checking' });
    try {
      const info = await backend.check();
      if (!info) {
        setPhase({ kind: 'up-to-date', current });
        toast(t(locale, 'updateUpToDate'), { tone: 'success' });
      } else {
        setPhase({ kind: 'available', info });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase({ kind: 'error', message });
      toast(t(locale, 'updateCheckFailed'), { tone: 'danger' });
    }
  };

  const doInstall = async () => {
    setPhase({ kind: 'downloading', percent: 0 });
    try {
      await backend.downloadAndInstall((percent) => {
        setPhase({ kind: 'downloading', percent });
      });
      // tauri 后端会在安装后自动重启；此处仅作为兜底提示
      setPhase({ kind: 'idle' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase({ kind: 'error', message });
      toast(t(locale, 'updateInstallFailed'), { tone: 'danger' });
    }
  };

  return (
    <div className="settings-card">
      <div className="ui-field">
        <span>{t(locale, 'updateCurrentVersion')}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{current || '—'}</span>
      </div>

      {supported ? (
        <>
          <button
            type="button"
            className="ui-btn"
            disabled={phase.kind === 'checking' || phase.kind === 'downloading'}
            onClick={() => void doCheck()}
          >
            <Icon name="refresh" size={14} />
            {phase.kind === 'checking' ? t(locale, 'updateChecking') : t(locale, 'updateCheck')}
          </button>

          {phase.kind === 'up-to-date' && (
            <p className="vault-empty" style={{ margin: '8px 0' }}>
              {t(locale, 'updateUpToDate')}
            </p>
          )}

          {phase.kind === 'available' && (
            <div className="update-available" style={{ margin: '8px 0' }}>
              <div>
                {t(locale, 'updateNewVersion')}: <strong>{phase.info.version}</strong>
              </div>
              {phase.info.date && (
                <div className="vault-empty" style={{ fontSize: 12 }}>
                  {phase.info.date.slice(0, 10)}
                </div>
              )}
              {phase.info.body && (
                <pre className="update-notes">{phase.info.body}</pre>
              )}
              <button type="button" className="ui-btn" onClick={() => void doInstall()}>
                <Icon name="download" size={14} />
                {t(locale, 'updateInstall')}
              </button>
            </div>
          )}

          {phase.kind === 'downloading' && (
            <div style={{ margin: '8px 0' }}>
              <div>{t(locale, 'updateDownloading')}</div>
              <progress value={phase.percent} max={100} style={{ width: '100%' }} />
            </div>
          )}

          {phase.kind === 'error' && (
            <p className="vault-empty" style={{ color: 'var(--orange)', margin: '8px 0' }}>
              {t(locale, 'updateError')}: {phase.message}
            </p>
          )}
        </>
      ) : (
        <p className="vault-empty" style={{ margin: '8px 0' }}>
          {t(locale, 'updateUnsupported')}
        </p>
      )}
    </div>
  );
}
