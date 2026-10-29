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
import { flushEditor } from '../editor/flush';

interface Props {
  onClose: () => void;
}

/** 差异面板最多渲染多少行（防止超大 diff 一次性铺进 DOM 拖垮渲染） */
const DIFF_LIMIT = 200;

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
    // 恢复是外部写入：先落定编辑器输入，避免被随后的防抖 emit 覆盖回旧正文
    flushEditor();
    await docs.updateContent(active.id, preview);
    onClose();
  };

  // 修复 E3：原先静默截断到 200 行，用户无从得知还有未显示的差异
  const allOps = preview !== null ? diffLines(preview, active.content) : [];
  const ops = allOps.slice(0, DIFF_LIMIT);
  const truncated = allOps.length > DIFF_LIMIT;

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
                {truncated && (
                  <div className="history-diff-note">
                    {t(locale, 'historyDiffTruncated')
                      .replace('{n}', String(DIFF_LIMIT))
                      .replace('{total}', String(allOps.length))}
                  </div>
                )}
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
