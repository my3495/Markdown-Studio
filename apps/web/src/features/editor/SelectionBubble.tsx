import { useEffect, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { useSettings } from '../../stores/settings';
import { Icon, type IconName } from '../../components/Icon';
import { t } from '../../i18n';
import { applyFormat, type FormatKind } from './format';

interface Props {
  view: EditorView | null;
}

const ACTIONS: { kind: FormatKind; icon: IconName; labelKey: string }[] = [
  { kind: 'bold', icon: 'bold', labelKey: 'fmtBold' },
  { kind: 'italic', icon: 'italic', labelKey: 'fmtItalic' },
  { kind: 'code', icon: 'code', labelKey: 'fmtCode' },
  { kind: 'link', icon: 'link', labelKey: 'fmtLink' },
  { kind: 'h2', icon: 'heading', labelKey: 'fmtHeading' },
  { kind: 'listUl', icon: 'listUl', labelKey: 'fmtList' },
  { kind: 'quote', icon: 'quote', labelKey: 'fmtQuote' },
];

/** 拖选后停顿 150ms 浮出的选区格式气泡；输入/滚动/失焦即隐藏 */
export function SelectionBubble({ view }: Props) {
  const locale = useSettings((s) => s.locale);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);

  useEffect(() => {
    if (!view) return;
    let showTimer = 0;

    const schedule = () => {
      window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => {
        const sel = view.state.selection.main;
        if (sel.empty) {
          setPos(null);
          return;
        }
        const a = view.coordsAtPos(sel.from);
        const b = view.coordsAtPos(sel.to);
        if (!a) {
          setPos(null);
          return;
        }
        const x = (a.left + (b?.right ?? a.right)) / 2;
        // 选区贴近视口顶部时气泡翻转到下方，避免遮住正在选中的行
        const below = a.top < 56;
        const y = below ? (b?.bottom ?? a.bottom) + 8 : Math.min(a.top, b?.top ?? a.top) - 10;
        setPos({ x, y, below });
      }, 150);
    };

    const hide = () => {
      window.clearTimeout(showTimer);
      setPos(null);
    };

    const onMouseUp = () => {
      if (view.state.selection.main.empty) hide();
      else schedule();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      // 仅 Shift+方向键扩选时保留气泡，其余键入即隐藏
      if (e.shiftKey && e.key.startsWith('Arrow')) onMouseUp();
      else hide();
    };

    const dom = view.dom;
    dom.addEventListener('mouseup', onMouseUp);
    dom.addEventListener('keyup', onKeyUp as EventListener);
    dom.addEventListener('mousedown', hide);
    dom.addEventListener('wheel', hide, { passive: true });
    window.addEventListener('blur', hide);
    const scroller = dom.querySelector('.cm-scroller');
    scroller?.addEventListener('scroll', hide, { passive: true });

    return () => {
      window.clearTimeout(showTimer);
      dom.removeEventListener('mouseup', onMouseUp);
      dom.removeEventListener('keyup', onKeyUp as EventListener);
      dom.removeEventListener('mousedown', hide);
      dom.removeEventListener('wheel', hide);
      window.removeEventListener('blur', hide);
      scroller?.removeEventListener('scroll', hide);
    };
  }, [view]);

  if (!pos) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1000;
  const x = Math.min(Math.max(pos.x, 150), Math.max(150, vw - 150));

  return (
    <div
      className={`sel-bubble${pos.below ? ' sel-bubble-below' : ''}`}
      style={{ left: x, top: pos.y }}
      onMouseDown={(e) => e.preventDefault()}
      role="toolbar"
      aria-label={t(locale, 'fmtBold')}
    >
      {ACTIONS.map((a) => (
        <button
          key={a.kind}
          type="button"
          className="sel-bubble-btn"
          title={t(locale, a.labelKey)}
          aria-label={t(locale, a.labelKey)}
          onClick={() => {
            if (view) applyFormat(view, a.kind);
            setPos(null);
          }}
        >
          <Icon name={a.icon} size={15} />
        </button>
      ))}
    </div>
  );
}
