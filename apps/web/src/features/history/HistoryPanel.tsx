import { useEffect, useState } from 'react';
import {
  diffLines,
  listSnapshots,
  readSnapshot,
  type SnapshotMeta,
} from '@md-studio/core';
import { idbSnapshotFs } from '../../platform/fs/idbSnapshot';
import { useDocuments } from '../../stores/document';
import { useSettings } from '../../stores/settings';
import { t } from '../../i18n';

interface Props {
  onClose: () => void;
}

/** A2：本地快照历史 — 列表 / diff / 恢复 */
export function HistoryPanel({ onClose }: Props) {
  const docs = useDocuments();
  const { locale } = useSettings();
  const active = docs.activeId ? docs.docs[docs.activeId] : null;
  const [list, setList] = useState<SnapshotMeta[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [selected, setSelected] = useState<SnapshotMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const docPath = active?.path ?? active?.name ?? '';

  useEffect(() => {
    if (!docPath) return;
    void listSnapshots(idbSnapshotFs, docPath)
      .then(setList)
      .catch(() => setList([]));
  }, [docPath, active?.dirty]);

  if (!active) {
    return (
      <div className="panel-pane">
        <div className="panel-body vault-empty">{t(locale, 'historyEmpty')}</div>
      </div>
    );
  }

  const showDiff = async (meta: SnapshotMeta) => {
    setSelected(meta);
    setErr(null);
    try {
      const old = await readSnapshot(idbSnapshotFs, meta);
      setPreview(old);
    } catch {
      setErr(t(locale, 'historyReadFail'));
      setPreview(null);
    }
  };

  const restore = async () => {
    if (!selected || preview === null) return;
    if (!window.confirm(t(locale, 'historyRestoreConfirm'))) return;
    await docs.updateContent(active.id, preview);
    onClose();
  };

  const ops =
    preview !== null ? diffLines(preview, active.content).slice(0, 200) : [];

  return (
    <div className="panel-pane">
      <div className="panel-body history-body">
          <div className="history-list">
            {list.length === 0 && <div className="vault-empty">{t(locale, 'historyEmpty')}</div>}
            {list.map((m) => (
              <button
                key={m.path}
                type="button"
                className={`history-item ${selected?.path === m.path ? 'active' : ''}`}
                onClick={() => void showDiff(m)}
              >
                {new Date(m.ts).toLocaleString()}
              </button>
            ))}
          </div>
          <div className="history-diff">
            {err && <div className="vault-empty">{err}</div>}
            {!err && preview === null && (
              <div className="vault-empty">{t(locale, 'historyPick')}</div>
            )}
            {preview !== null && (
              <>
                <div className="history-actions">
                  <button type="button" className="ui-btn" onClick={() => void restore()}>
                    {t(locale, 'historyRestore')}
                  </button>
                </div>
                <pre className="history-diff-pre">
                  {ops.map((op, i) => (
                    <div key={i} className={`diff-${op.type}`}>
                      {op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' '}
                      {op.text}
                    </div>
                  ))}
                </pre>
              </>
            )}
          </div>
        </div>
      </div>
  );
}
