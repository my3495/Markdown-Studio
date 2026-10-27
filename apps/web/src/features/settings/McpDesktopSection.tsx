import { useEffect, useState } from 'react';
import { useSettings } from '../../stores/settings';
import {
  mcpDesktopAvailable,
  mcpStart,
  mcpStatus,
  mcpStop,
  type McpServerInfo,
} from '../../platform/mcp/desktop';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n';

/** 桌面端 MCP HTTP 启停（仅 Tauri 可见） */
export function McpDesktopSection({ showTitle = true }: { showTitle?: boolean }) {
  const s = useSettings();
  const locale = s.locale;
  const available = mcpDesktopAvailable();
  const [info, setInfo] = useState<McpServerInfo | null>(null);
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!available) return;
    void mcpStatus().then(setInfo).catch(() => setInfo(null));
  }, [available]);

  if (!available) return null;

  const start = async () => {
    const ws = workspace.trim();
    if (!ws) {
      setError(t(locale, 'mcpWorkspaceRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await mcpStart({
        workspace: ws,
        allowWrite: s.agent.allowWrite,
      });
      setInfo(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError('');
    try {
      await mcpStop();
      setInfo(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={showTitle ? 'settings-group' : undefined}>
      {showTitle && (
        <h4>
          <Icon name="agent" size={14} />
          {t(locale, 'mcpDesktopTitle')}
        </h4>
      )}
      <div className="settings-card">
        <div className="ui-field">
          <span>{t(locale, 'mcpVaultPath')}</span>
          <input
            className="ui-input"
            style={{ width: '100%' }}
            placeholder={t(locale, 'mcpVaultPathHint')}
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            disabled={!!info}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {!info ? (
            <button type="button" className="ui-btn" disabled={busy} onClick={() => void start()}>
              {t(locale, 'mcpStart')}
            </button>
          ) : (
            <button type="button" className="ui-btn" disabled={busy} onClick={() => void stop()}>
              {t(locale, 'mcpStop')}
            </button>
          )}
        </div>
        {info && (
          <div className="vault-empty" style={{ marginTop: 8, lineHeight: 1.5 }}>
            <div>
              URL：<code>{info.url}</code>
            </div>
            <div>
              Token：<code>{info.token}</code>
            </div>
            <div>
              {t(locale, 'mcpInstallHint')} <code>md-studio-mcp</code>（npm i -g @md-studio/mcp）
            </div>
          </div>
        )}
        {error && (
          <div className="vault-empty" style={{ color: 'var(--md-color-danger, #c44)', marginTop: 8 }}>
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
