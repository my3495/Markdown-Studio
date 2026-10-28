import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

/** 单个段落最多向上/向下延伸多少行：防止没有空行的超大文档退化成 O(n) 扫描 */
const MAX_PARAGRAPH_SCAN = 400;

/** 非当前段落的淡化装饰 */
const DIM_LINE = Decoration.line({ class: 'cm-dim' });

/**
 * 求光标所在**段落**的行区间（以空行为界）。
 * 对齐 ADR-19 的「淡化非当前段落」语义：原先实现按「非当前行」淡化，
 * 导致中文文档里一个段落内的软换行行也被一起淡化，对焦粒度明显偏细。
 */
export function paragraphRange(
  doc: { lines: number; line: (n: number) => { text: string } },
  lineNumber: number
): { startLine: number; endLine: number } {
  let startLine = lineNumber;
  let endLine = lineNumber;
  while (
    startLine > 1 &&
    lineNumber - startLine < MAX_PARAGRAPH_SCAN &&
    doc.line(startLine - 1).text.trim() !== ''
  ) {
    startLine--;
  }
  while (
    endLine < doc.lines &&
    endLine - lineNumber < MAX_PARAGRAPH_SCAN &&
    doc.line(endLine + 1).text.trim() !== ''
  ) {
    endLine++;
  }
  return { startLine, endLine };
}

/**
 * 对焦模式（护城河体验，ADR-19）：CM6 装饰淡化非当前段落。
 * - 只处理视口内可见行（修复 G2）：原先遍历 1..doc.lines 全量重建，
 *   万行文档下每次移动光标/滚动都要创建上万个 Decoration；
 * - 淡化的是**文字颜色**而非整行 opacity（修复 G3）：原先 `.cm-dim { opacity: .35 }`
 *   作用于行容器，会把该行的语法着色、选区背景、lint 波浪线一并压到 35%；
 * - IME 组合期间不重建（ADR-12）。
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
        const doc = view.state.doc;
        const cursorLine = doc.lineAt(view.state.selection.main.head).number;
        const { startLine, endLine } = paragraphRange(doc, cursorLine);
        const builder = new RangeSetBuilder<Decoration>();
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = doc.lineAt(pos);
            if (line.number < startLine || line.number > endLine) {
              builder.add(line.from, line.from, DIM_LINE);
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
