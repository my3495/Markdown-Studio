import { useMemo, useState } from 'react';
import {
  buildAgentBranchHint,
  buildConflictHint,
  buildGitCommitHint,
  buildSnapshotCommands,
  type ConflictStrategy,
} from '@md-studio/core';
import { useDocuments } from '../../stores/document';
import { useSettings } from '../../stores/settings';
import { t } from '../../i18n';

/** A2-lite：生成本机 git 命令（需用户自行执行） */
export function GitPanel() {
  const docs = useDocuments();
  const { locale } = useSettings();
  const active = docs.activeId ? docs.docs[docs.activeId] : null;
  const [msg, setMsg] = useState('chore: snapshot from Markdown Studio');
  const [copied, setCopied] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<ConflictStrategy>('manual');

  const hint = useMemo(
    () => buildGitCommitHint(msg, active?.path ? [active.path] : ['.']),
    [msg, active?.path]
  );
  const branchCmds = useMemo(() => buildAgentBranchHint('agent/sandbox'), []);
  const snapshotCmds = useMemo(() => buildSnapshotCommands(20), []);
  const conflictCmds = useMemo(() => buildConflictHint(strategy), [strategy]);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="panel-pane">
      <div className="panel-body">
          <p className="vault-empty" style={{ marginBottom: 12 }}>
            {t(locale, 'gitHint')}
          </p>
          <div className="ui-field">
            <span>{t(locale, 'gitMessage')}</span>
            <input
              className="ui-input"
              style={{ width: '100%' }}
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
            />
          </div>
          <pre className="agent-answer" style={{ maxHeight: 160 }}>
            {hint.script}
          </pre>
          <div className="agent-actions">
            <button type="button" className="ui-btn" onClick={() => void copy(hint.script, 'script')}>
              {t(locale, 'gitCopyScript')}
            </button>
            <button
              type="button"
              className="ui-btn"
              onClick={() => void copy(hint.gitignore, 'ignore')}
            >
              {t(locale, 'gitCopyIgnore')}
            </button>
          </div>
          <h5 style={{ marginTop: 16 }}>{t(locale, 'gitAgentBranch')}</h5>
          <pre className="agent-answer" style={{ maxHeight: 140 }}>
            {branchCmds.join('\n')}
          </pre>
          <button
            type="button"
            className="ui-btn"
            onClick={() => void copy(branchCmds.join('\n'), 'branch')}
          >
            {t(locale, 'gitCopyBranch')}
          </button>

          <h5 style={{ marginTop: 16 }}>{t(locale, 'gitSnapshot')}</h5>
          <p className="vault-empty" style={{ marginBottom: 8 }}>
            {t(locale, 'gitSnapshotHint')}
          </p>
          <pre className="agent-answer" style={{ maxHeight: 160 }}>
            {snapshotCmds.join('\n')}
          </pre>
          <button
            type="button"
            className="ui-btn"
            onClick={() => void copy(snapshotCmds.join('\n'), 'snapshot')}
          >
            {t(locale, 'gitCopySnapshot')}
          </button>

          <h5 style={{ marginTop: 16 }}>{t(locale, 'gitConflict')}</h5>
          <div className="ui-field">
            <span>{t(locale, 'gitConflictStrategy')}</span>
            <select
              className="ui-input"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as ConflictStrategy)}
            >
              <option value="manual">{t(locale, 'gitStrategyManual')}</option>
              <option value="ours">{t(locale, 'gitStrategyOurs')}</option>
              <option value="theirs">{t(locale, 'gitStrategyTheirs')}</option>
            </select>
          </div>
          <pre className="agent-answer" style={{ maxHeight: 140 }}>
            {conflictCmds.join('\n')}
          </pre>
          <button
            type="button"
            className="ui-btn"
            onClick={() => void copy(conflictCmds.join('\n'), 'conflict')}
          >
            {t(locale, 'gitCopyConflict')}
          </button>
          {copied && (
            <div className="vault-empty" style={{ marginTop: 8 }}>
              {t(locale, 'gitCopied')}: {copied}
            </div>
          )}
        </div>
      </div>
  );
}
