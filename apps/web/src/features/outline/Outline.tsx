import type { TocItem } from '@md-studio/core';
import type { EditorView } from '@codemirror/view';
import type { Locale } from '../../i18n';
import { t } from '../../i18n';

interface Props {
  toc: TocItem[];
  editorView: EditorView | null;
  previewEl: HTMLElement | null;
  locale: Locale;
}

export function Outline({ toc, editorView, previewEl, locale }: Props) {
  if (toc.length === 0) {
    return <div className="side-section" style={{ color: 'var(--md-color-muted)', fontSize: 13 }}>—</div>;
  }
  const go = (item: TocItem) => {
    // 预览：滚动到对应 id。rehype-sanitize 会给 id 加 `user-content-` 前缀，
    // 目录里保存的是 slug 原文，两种都要尝试，否则点击大纲无法定位。
    const el =
      previewEl?.querySelector<HTMLElement>(`#${cssEscape(item.id)}`) ??
      previewEl?.querySelector<HTMLElement>(`#user-content-${cssEscape(item.id)}`);
    if (el && previewEl) {
      previewEl.scrollTop =
        el.getBoundingClientRect().top -
        previewEl.getBoundingClientRect().top +
        previewEl.scrollTop -
        16;
    }
    // 编辑器：滚动到对应行（data-line 由源行近似，这里用标题在源中的行）
    if (editorView && item.line > 0) {
      const block = editorView.lineBlockAt(editorView.state.doc.line(item.line).from);
      editorView.scrollDOM.scrollTop =
        block.top - editorView.scrollDOM.clientHeight / 2;
      editorView.dispatch({ selection: { anchor: editorView.state.doc.line(item.line).from } });
    }
  };
  return (
    <div className="side-section">
      {toc.map((item, i) => (
        <div
          key={i}
          className="outline-item"
          style={{ paddingLeft: (item.depth - 1) * 12 }}
          onClick={() => go(item)}
        >
          {item.text || t(locale, 'outlineEmptyHeading')}
        </div>
      ))}
    </div>
  );
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
