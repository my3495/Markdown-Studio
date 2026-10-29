import { EditorView, ViewPlugin } from '@codemirror/view';

/**
 * 打字机模式（ADR-19）：光标始终居中（±误差由 smooth 滚动自然收敛）。
 * IME 组合期间不滚动，避免跳动（ADR-12）。
 *
 * 关键前提：**必须给内容上下留白**（`.cm-typewriter .cm-content` 的 padding-block）。
 * 否则光标在文档末尾时，居中所需的位移超过可滚动范围（实测 929px vs 上限 670px），
 * scroller.scrollTop 会被浏览器夹到最大值 —— 表现为「开了打字机模式毫无变化」，
 * 而这恰好是写作时最常见的状态（永远在文末输入）。
 *
 * 另外用瞬时赋值而不是 `scrollTo({behavior:'smooth'})`：CodeMirror 在每次文档变化后
 * 会自己 scrollIntoView 把光标拉进视口，平滑动画会被这次滚动打断，结果同样是不居中。
 */
export const typewriterMode = (enabled: () => boolean) =>
  ViewPlugin.fromClass(
    class {
      private view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
        view.dom.addEventListener('keyup', this.onKey);
        view.dom.addEventListener('click', this.onKey);
        this.syncClass();
        // 打开时就地居中一次，不必等到下一次按键。
        // 必须延到下一帧：插件 constructor 是在 CodeMirror 的 update 流程里跑的，
        // 期间读布局会被直接判成 "Reading the editor layout isn't allowed during an update"。
        if (enabled()) requestAnimationFrame(() => this.center());
      }

      private syncClass() {
        this.view.dom.classList.toggle('cm-typewriter', enabled());
      }

      private center() {
        const view = this.view;
        if (view.composing) return;
        const scroller = view.scrollDOM;
        // 用光标在视口里的实际坐标做增量修正，而不是 lineBlockAt 的文档坐标：
        // 后者不含 .cm-content 的留白，直接相减会固定偏上「paddingTop」那么多
        const coords = view.coordsAtPos(view.state.selection.main.head);
        if (!coords) return;
        const rect = scroller.getBoundingClientRect();
        const delta = coords.top - (rect.top + scroller.clientHeight / 2);
        if (Math.abs(delta) < 2) return;
        scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
      }

      onKey = () => {
        if (!enabled()) return;
        this.center();
      };

      update(u: { view: EditorView }) {
        // Compartment 重配置会新建插件实例；这里兜住「同实例内开关切换」的情况
        this.syncClass();
        if (u.view.composing) return;
      }

      destroy() {
        this.view.dom.removeEventListener('keyup', this.onKey);
        this.view.dom.removeEventListener('click', this.onKey);
        this.view.dom.classList.remove('cm-typewriter');
      }
    }
  );
