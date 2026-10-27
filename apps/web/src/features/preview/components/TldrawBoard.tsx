import { lazy, Suspense, useMemo, useState } from 'react';
import { useSettings } from '../../../stores/settings';
import { parseTldrawFence, serializeTldrawFence, type WbDocument } from '@md-studio/core';
import { t } from '../../../i18n';
import { Icon } from '../../../components/Icon';
import { WbArrowMarker, WbShapeView, WbStrokeView } from './whiteboard/WbShapeView';

const BoardEditor = lazy(() => import('./TldrawBoardEditor'));
const BoardFull = lazy(() => import('./whiteboard/TldrawFullEditor'));

interface Props {
  code: string;
  fenceIndex: number;
  onPersist?: (fenceIndex: number, json: string) => void;
  readOnly?: boolean;
}

/**
 * 白板容器（C4）：在「轻量 SVG 编辑器」与「真实 tldraw 完整白板」间切换。
 * - full 状态保留在本组件（useState）。为防止预览重渲染导致本组件被整体重挂载、
 *   full 丢失，MarkdownPreview 的 components 必须在 hast 变化时保持稳定（pre 组件
 *   类型不重建），详见 MarkdownPreview.tsx。
 */
export function TldrawBoard({ code, fenceIndex, onPersist, readOnly }: Props) {
  const doc = useMemo(() => parseTldrawFence(code), [code]);
  const [full, setFull] = useState(false);
  const s = useSettings();
  const locale = s.locale;
  const dark =
    s.theme === 'dark' ||
    (s.theme === 'system' &&
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  const persist = (next: WbDocument) => onPersist?.(fenceIndex, serializeTldrawFence(next));

  const requestFull = () => setFull(true);

  if (readOnly || !onPersist) {
    return <BoardSvg doc={doc} />;
  }

  if (full) {
    return (
      <div className="tldraw-block tldraw-edit">
        <div className="tldraw-toolbar" role="toolbar" aria-label={t(locale, 'wbCanvas')}>
          <button
            type="button"
            className="tldraw-icon-btn"
            aria-label={t(locale, 'wbLite')}
            title={t(locale, 'wbLite')}
            onClick={() => setFull(false)}
          >
            <Icon name="edit" size={16} />
          </button>
          <span className="tldraw-hint">
            {t(locale, 'wbFull')} · {t(locale, 'wbHint')}
          </span>
        </div>
        <Suspense
          fallback={
            <div className="tldraw-empty" style={{ height: 360 }}>
              正在加载 tldraw…
            </div>
          }
        >
          <BoardFull doc={doc} onChange={persist} dark={dark} />
        </Suspense>
      </div>
    );
  }

  return (
    <Suspense fallback={<BoardSvg doc={doc} />}>
      <BoardEditor doc={doc} onChange={persist} onRequestFull={requestFull} />
    </Suspense>
  );
}

/** 只读 / 静态白板：与轻量编辑器共用同一套 SVG 渲染，保证观感一致 */
export function BoardSvg({ doc }: { doc: WbDocument }) {
  const locale = useSettings().locale;
  const shapes = doc.shapes ?? [];
  const empty = doc.strokes.length === 0 && shapes.length === 0;
  return (
    <div className="tldraw-block">
      <div className="tldraw-canvas">
        <svg viewBox="0 0 640 360" className="tldraw-svg">
          <defs>
            <WbArrowMarker />
          </defs>
          <rect width="640" height="360" fill="var(--md-color-surface, #f8fafc)" />
          {shapes.map((sh, i) => (
            <WbShapeView key={sh.id ?? `shape-${i}`} el={sh} />
          ))}
          {doc.strokes.map((s, i) => (
            <WbStrokeView key={s.id ?? `stroke-${i}`} el={s} />
          ))}
        </svg>
        {empty && (
          <div className="tldraw-empty">
            {t(locale, 'wbCanvas')} — ```tldraw
          </div>
        )}
      </div>
    </div>
  );
}
