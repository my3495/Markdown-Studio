import type { EditorView } from '@codemirror/view';

/** 选区格式气泡支持的动作 */
export type FormatKind = 'bold' | 'italic' | 'code' | 'link' | 'h2' | 'listUl' | 'quote';

const WRAP: Record<string, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  code: ['`', '`'],
};

/** 对选区两端包裹标记；若选区（或紧邻外侧）已带标记则反转去除 */
function toggleWrap(view: EditorView, before: string, after: string) {
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  const doc = view.state.doc;
  const sel = doc.sliceString(from, to);

  // 情况一：标记在选区外侧 —— **x**
  const oFrom = from - before.length;
  const oTo = to + after.length;
  if (oFrom >= 0 && oTo <= doc.length && doc.sliceString(oFrom, oTo) === before + sel + after) {
    view.dispatch({
      changes: { from: oFrom, to: oTo, insert: sel },
      selection: { anchor: oFrom, head: oFrom + sel.length },
    });
    return;
  }

  // 情况二：选区自身已包含标记 —— **x**
  let inner = sel;
  if (
    inner.length >= before.length + after.length &&
    inner.startsWith(before) &&
    inner.endsWith(after)
  ) {
    inner = inner.slice(before.length, inner.length - after.length);
  }

  view.dispatch({
    changes: { from, to, insert: before + inner + after },
    selection: { anchor: from + before.length, head: from + before.length + inner.length },
  });
}

/** 对选中的每一行加/去行首前缀（标题、列表、引用） */
function toggleLinePrefix(view: EditorView, prefix: string) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(to).number;

  let allHave = true;
  for (let n = first; n <= last; n++) {
    if (!doc.line(n).text.startsWith(prefix)) {
      allHave = false;
      break;
    }
  }

  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    if (allHave) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: '' });
    } else if (!line.text.startsWith(prefix)) {
      changes.push({ from: line.from, to: line.from, insert: prefix });
    }
  }
  if (changes.length) view.dispatch({ changes });
}

/** 把选区替换为 [文字](url) 形式的链接 */
function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.doc.sliceString(from, to);
  const text = `[${sel}](url)`;
  const urlStart = from + sel.length + 3;
  view.dispatch({
    changes: { from, to, insert: text },
    // 选中 url 占位符，便于直接覆盖输入
    selection: { anchor: urlStart, head: urlStart + 3 },
  });
}

export function applyFormat(view: EditorView, kind: FormatKind) {
  const wrap = WRAP[kind];
  if (wrap) {
    toggleWrap(view, wrap[0], wrap[1]);
  } else if (kind === 'link') {
    insertLink(view);
  } else if (kind === 'h2') {
    toggleLinePrefix(view, '## ');
  } else if (kind === 'listUl') {
    toggleLinePrefix(view, '- ');
  } else if (kind === 'quote') {
    toggleLinePrefix(view, '> ');
  }
  view.focus();
}
