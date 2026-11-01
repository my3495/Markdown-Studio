import { useEffect, useMemo } from 'react';
import { diffStat, diffTokens, type MatchConfidence } from '@md-studio/core';
import { t, type Locale } from '../../i18n';
import { Icon } from '../../components/Icon';

interface Props {
  locale: Locale;
  /** 命中区间的原文（改前） */
  before: string;
  /** Agent 给出的改后文字 */
  after: string;
  line: number;
  confidence: MatchConfidence;
  ambiguous: boolean;
  candidates: number;
  onAccept: () => void;
  onReject: () => void;
  onRegenerate: () => void;
}

const CONFIDENCE_KEY: Record<MatchConfidence, string> = {
  exact: 'rwLocateExact',
  normalized: 'rwLocateNormalized',
  partial: 'rwLocatePartial',
};

/**
 * 「确认修改」弹窗：以词级 diff（中文逐字）展示 Agent 的改动，
 * 由用户**显式接受**后才写入正文 —— 与代码改动的 review 流程一致。
 *
 * Esc = 拒绝；点击遮罩空白处 = 拒绝。
 */
export function RewriteConfirmDialog({
  locale,
  before,
  after,
  line,
  confidence,
  ambiguous,
  candidates,
  onAccept,
  onReject,
  onRegenerate,
}: Props) {
  const ops = useMemo(() => diffTokens(before, after), [before, after]);
  const stat = useMemo(() => diffStat(ops), [ops]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onReject();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onReject]);

  return (
    <div
      className="rw-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t(locale, 'rwConfirmTitle')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onReject();
      }}
    >
      <div className="rw-card">
        <div className="rw-card-head">
          <Icon name="pen" size={15} />
          <strong>{t(locale, 'rwConfirmTitle')}</strong>
          <span className="rw-meta">
            {t(locale, CONFIDENCE_KEY[confidence])} ·{' '}
            {t(locale, 'rwLineAt').replace('{line}', String(line))}
          </span>
        </div>

        <div className="rw-card-body">
          <p className="rw-hint">{t(locale, 'rwConfirmHint')}</p>
          {ambiguous && (
            <p className="rw-warn">
              {t(locale, 'rwAmbiguous').replace('{n}', String(candidates))}
            </p>
          )}
          <div className="rw-diff">
            {ops.map((op, i) =>
              op.type === 'eq' ? (
                <span key={i}>{op.text}</span>
              ) : (
                <span key={i} className={op.type === 'del' ? 'rw-del' : 'rw-add'}>
                  {op.text}
                </span>
              )
            )}
          </div>
          <div className="rw-stat">
            {t(locale, 'rwDiffStat')
              .replace('{del}', String(stat.del))
              .replace('{add}', String(stat.add))}
          </div>
        </div>

        <div className="rw-card-actions">
          <button type="button" className="ui-btn" onClick={onReject}>
            {t(locale, 'rwReject')}
          </button>
          <button type="button" className="ui-btn" onClick={onRegenerate}>
            {t(locale, 'rwRegenerate')}
          </button>
          <button type="button" className="ui-btn primary" onClick={onAccept} autoFocus>
            {t(locale, 'rwAccept')}
          </button>
        </div>
      </div>
    </div>
  );
}
