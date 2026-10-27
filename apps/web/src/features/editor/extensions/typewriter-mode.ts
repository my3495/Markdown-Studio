import { EditorView, ViewPlugin } from '@codemirror/view';

/**
 * 打字机模式（ADR-19）：光标始终居中（±误差由 smooth 滚动自然收敛）。
 * IME 组合期间不滚动，避免跳动（ADR-12）。
 */
export const typewriterMode = (enabled: () => boolean) =>
  ViewPlugin.fromClass(
    class {
      private view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
        view.dom.addEventListener('keyup', this.onKey);
        view.dom.addEventListener('click', this.onKey);
      }
      onKey = () => {
        if (!enabled()) return;
        if (this.view.composing) return;
        const pos = this.view.state.selection.main.head;
        const block = this.view.lineBlockAt(pos);
        const scroller = this.view.scrollDOM;
        const target =
          block.top - scroller.clientHeight / 2 + block.height / 2;
        scroller.scrollTo({ top: target, behavior: 'smooth' });
      };
      destroy() {
        this.view.dom.removeEventListener('keyup', this.onKey);
        this.view.dom.removeEventListener('click', this.onKey);
      }
    }
  );
