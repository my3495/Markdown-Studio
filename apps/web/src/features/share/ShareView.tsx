import { useEffect, useState } from 'react';
import { decodeSharePayload, render, type ShareSnapshot } from '@md-studio/core';
import type { Root } from 'hast';
import { MarkdownPreview } from '../preview/MarkdownPreview';
import { loadShare, parseShareHash } from '../../platform/share/store';
import { Icon } from '../../components/Icon';
import { useSettings } from '../../stores/settings';
import { t } from '../../i18n';

/** 只读分享页（F2-lite） */
export function ShareView({ onExit }: { onExit: () => void }) {
  const locale = useSettings((st) => st.locale);
  const [snap, setSnap] = useState<ShareSnapshot | null>(null);
  const [hast, setHast] = useState<Root | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const parsed = parseShareHash();
      if (!parsed) {
        setErr(t(useSettings.getState().locale, 'shareInvalid'));
        return;
      }
      let s: ShareSnapshot | null = null;
      if (parsed.payload) s = decodeSharePayload(parsed.payload);
      else if (parsed.id) s = await loadShare(parsed.id);
      if (cancelled) return;
      if (!s) {
        setErr(t(useSettings.getState().locale, 'shareNotFound'));
        return;
      }
      setSnap(s);
      const r = await render(s.content, { gfm: true, frontmatter: true, highlight: true });
      if (!cancelled) setHast(r.hast);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="share-view">
      <div className="share-bar">
        <strong>{snap?.title ?? t(locale, 'shareTitle')}</strong>
        <span className="share-badge">{t(locale, 'shareReadOnly')}</span>
        <button type="button" className="tb-btn" onClick={onExit} title={t(locale, 'shareExit')}>
          <Icon name="close" />
          <span className="tb-label">{t(locale, 'shareExit')}</span>
        </button>
      </div>
      {err && <div className="vault-empty" style={{ padding: 24 }}>{err}</div>}
      {!err && (
        <div className="share-body">
          <MarkdownPreview hast={hast} readOnly />
        </div>
      )}
    </div>
  );
}
