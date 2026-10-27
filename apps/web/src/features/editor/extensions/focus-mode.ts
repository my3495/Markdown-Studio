import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

/**
 * 对焦模式（护城河体验，ADR-19）：CM6 装饰淡化非当前段落。
 * enabled 为闭包，由主题 Compartment 切换时重建；IME 组合期间不重建（ADR-12）。
 */
export const focusMode = (enabled: () => boolean) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged) {
          if (u.view.composing) return; // IME 期间跳过重排
          this.decorations = this.build(u.view);
        }
      }
      build(view: EditorView): DecorationSet {
        if (!enabled()) return Decoration.none;
        const cursorLine = view.state.doc.lineAt(
          view.state.selection.main.head
        ).number;
        const builder = new RangeSetBuilder<Decoration>();
        for (let i = 1; i <= view.state.doc.lines; i++) {
          if (i === cursorLine) continue;
          const line = view.state.doc.line(i);
          builder.add(line.from, line.from, Decoration.line({ class: 'cm-dim' }));
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
