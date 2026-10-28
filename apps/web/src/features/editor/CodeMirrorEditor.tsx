import { useEffect, useRef } from 'react';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  highlightActiveLineGutter,
} from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import type { EditorView as EV } from '@codemirror/view';
import { vim } from '@replit/codemirror-vim';
import { focusMode } from './extensions/focus-mode';
import { lightSyntax, darkSyntax } from './extensions/syntax';
import { codeLanguages } from './extensions/code-languages';
import { typewriterMode } from './extensions/typewriter-mode';
import { typographyLinter } from './extensions/typography-lint';
import { spellLinter } from './extensions/spell-lint';
import { useSettings } from '../../stores/settings';
import { useDocuments } from '../../stores/document';
import type { ResolvedTheme } from '../../platform/theme';

const editorThemeSpec = {
  '&': {
    color: 'var(--md-color-fg)',
    backgroundColor: 'var(--md-color-bg)',
    fontSize: 'var(--md-font-size)',
    height: '100%',
  },
  '.cm-scroller': {
    lineHeight: 'var(--md-line-height)',
  },
  '.cm-content': {
    caretColor: 'var(--md-color-accent)',
    fontFamily: 'var(--md-font-mono)',
    maxWidth: 'var(--md-max-width, 820px)',
    margin: '0 auto',
    padding: '12px 20px',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--md-color-accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--md-color-accent) 26%, transparent)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in srgb, var(--md-color-accent) 16%, transparent)',
  },
  /* 查找命中（@codemirror/search）；selected 为「当前焦点命中项」，需更强区分度 */
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--md-color-accent) 22%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--md-color-accent) 45%, transparent)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--md-color-accent) 42%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--md-color-accent) 70%, transparent)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--md-color-bg)',
    color: 'var(--md-color-muted)',
    border: 'none',
    borderRight: '1px solid var(--md-color-border)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--md-color-accent) 6%, transparent)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--md-color-accent) 10%, transparent)',
    color: 'var(--md-color-fg)',
  },
};

const lightTheme = EditorView.theme(editorThemeSpec, { dark: false });

const darkTheme = EditorView.theme(editorThemeSpec, { dark: true });

/**
 * 空列表项上按 Enter 直接结束列表（删掉标记、保留一个空行）。
 * CodeMirror 自带的 insertNewlineContinueMarkup 在紧致单层列表里会先转成宽松列表，
 * 需要按三次 Enter 才能退出，导致「列表后直接写表格/段落」被误识别为列表续行。
 */
function exitEmptyListItem(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  if (!/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]?\]\s*)?$/.test(line.text)) return false;
  if (sel.head < line.from + line.text.trimEnd().length) return false;
  // 仅当光标确实位于 Markdown 列表项内时才接管：
  // 代码块里的 `- ` 行按 Enter 必须保持原样，不能被当成列表标记删掉。
  let inList = false;
  let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(
    view.state
  ).resolveInner(sel.head, -1);
  for (; node; node = node.parent) {
    if (node.name === 'ListItem') {
      inList = true;
      break;
    }
  }
  if (!inList) return false;
  // 上一行已是空行时只删标记；否则补一个换行，避免后续段落被当成列表续行
  const prevBlank =
    line.number > 1 && !view.state.doc.line(line.number - 1).text.trim();
  const insert = prevBlank ? '' : view.state.lineBreak;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert },
    selection: { anchor: line.from + insert.length },
  });
  return true;
}

/** 求两段文本的最小差异区间，用于把外部写入以最小变更应用到编辑器（保留光标与撤销粒度） */
function minimalChange(oldText: string, newText: string) {
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText[start] === newText[start]) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
    endOld--;
    endNew--;
  }
  return { from: start, to: endOld, insert: newText.slice(start, endNew) };
}

interface Opts {
  focusMode: boolean;
  typewriterMode: boolean;
  resolvedDark: boolean;
  vimMode: boolean;
  spellCheck: boolean;
}

interface Props {
  docId: string;
  content: string;
  onChange: (content: string) => void;
  editorRef: React.MutableRefObject<EV | null>;
  /** 视图创建/销毁时通知外层：ref.current 变化不会触发重渲染，需要状态化订阅 */
  onReady?: (view: EV | null) => void;
}

export function CodeMirrorEditor({ docId, content, onChange, editorRef, onReady }: Props) {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const settings = useSettings();
  const optsRef = useRef<Opts>({
    focusMode: settings.focusMode,
    typewriterMode: settings.typewriterMode,
    resolvedDark: settings.theme === 'dark',
    vimMode: settings.vimMode,
    spellCheck: settings.spellCheck,
  });
  const contentRef = useRef(content);
  contentRef.current = content;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const docIdRef = useRef(docId);
  docIdRef.current = docId;
  /** 本编辑器最近一次向外发出的文本，用于区分「自己打字」与「外部写入」 */
  const lastEmittedRef = useRef<string | null>(null);
  /** 尚未同步到 store 的本地输入定时器；存在时 store 内容必然落后于视图 */
  const pendingEmitRef = useRef<number | null>(null);
  const themeComp = useRef(new Compartment());
  const syntaxComp = useRef(new Compartment());
  const focusComp = useRef(new Compartment());
  const typeComp = useRef(new Compartment());
  const vimComp = useRef(new Compartment());
  const spellComp = useRef(new Compartment());

  const buildExtensions = (o: Opts) => [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    history(),
    EditorView.lineWrapping,
    syntaxComp.current.of(
      syntaxHighlighting(o.resolvedDark ? darkSyntax : lightSyntax, { fallback: true })
    ),
    markdown({ base: markdownLanguage, codeLanguages }),
    /* 查找：面板 + 命中高亮 + 选中同词高亮（修复 C1 / D2） */
    search(),
    highlightSelectionMatches(),
    /* 空列表项按 Enter 优先直接退出列表（高于 markdown 内置的续行键位） */
    Prec.highest(keymap.of([{ key: 'Enter', run: exitEmptyListItem }])),
    keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    themeComp.current.of(o.resolvedDark ? darkTheme : lightTheme),
    focusComp.current.of(focusMode(() => optsRef.current.focusMode)),
    typeComp.current.of(typewriterMode(() => optsRef.current.typewriterMode)),
    vimComp.current.of(o.vimMode ? vim() : []),
    // B3-lite：中文排版 lint 波浪线（来自渲染管线 warnings）
    typographyLinter(() => {
      const id = docIdRef.current;
      return useDocuments.getState().docs[id]?.warnings ?? [];
    }),
    spellComp.current.of(
      o.spellCheck ? spellLinter(() => useSettings.getState().spellCheck) : []
    ),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      lastEmittedRef.current = u.state.doc.toString();
      if (pendingEmitRef.current) window.clearTimeout(pendingEmitRef.current);
      pendingEmitRef.current = window.setTimeout(() => {
        pendingEmitRef.current = null;
        onChangeRef.current(u.state.doc.toString());
      }, 150);
    }),
  ];

  // 注意：不能用字符串长度作 anchor —— CM 会把 \r\n 等换行符归一化，
  // Text 长度会小于 JS 字符串长度，CRLF 文件会因此抛
  // "Selection points outside of document"（渲染期抛出会导致整棵 React 树卸载、窗口空白）。
  const buildState = (doc: string) => {
    const state = EditorState.create({ doc, extensions: buildExtensions(optsRef.current) });
    return state.update({ selection: { anchor: state.doc.length } }).state;
  };

  // 单次挂载，全局唯一 EditorView（ADR-03）
  useEffect(() => {
    const view = new EditorView({
      state: buildState(contentRef.current),
      parent: document.getElementById('cm-host')!,
    });
    editorRef.current = view;
    // 调试/E2E 句柄：CM6 无官方 DOM→view 查找 API，挂到根节点便于外部读取文档模型
    (view.dom as unknown as { __md_view?: EV }).__md_view = view;
    onReadyRef.current?.(view);
    return () => {
      if (pendingEmitRef.current) {
        window.clearTimeout(pendingEmitRef.current);
        pendingEmitRef.current = null;
      }
      view.destroy();
      editorRef.current = null;
      onReadyRef.current?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换标签：setState 切换文档（ADR-03）
  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    // 上一文档的待同步输入不能落到新文档上
    if (pendingEmitRef.current) {
      window.clearTimeout(pendingEmitRef.current);
      pendingEmitRef.current = null;
    }
    view.setState(buildState(contentRef.current));
    lastEmittedRef.current = contentRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // 外部写入（Agent 插入 / 预览内联编辑标题 / 白板写回）同步进编辑器视图。
  // 仅当内容不是本编辑器刚发出的才应用，避免打字过程中被回写覆盖或重置光标。
  useEffect(() => {
    const view = editorRef.current;
    if (!view || content === lastEmittedRef.current) return;
    // 本地输入尚未防抖同步到 store：此刻的 content 必然落后于视图，
    // 直接应用会回滚/重复刚输入的字符（连续输入者的真实故障），必须丢弃。
    if (pendingEmitRef.current) return;
    const current = view.state.doc.toString();
    if (content === current) return;
    view.dispatch({ changes: minimalChange(current, content) });
  }, [content]);

  // 设置变更：Compartment 动态重配置（ADR-03 主题切换）
  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    const resolvedDark: ResolvedTheme =
      settings.theme === 'dark' ||
      (settings.theme === 'system' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches)
        ? 'dark'
        : 'light';
    optsRef.current = {
      focusMode: settings.focusMode,
      typewriterMode: settings.typewriterMode,
      resolvedDark: resolvedDark === 'dark',
      vimMode: settings.vimMode,
      spellCheck: settings.spellCheck,
    };
    view.dispatch({
      effects: [
        themeComp.current.reconfigure(resolvedDark ? darkTheme : lightTheme),
        syntaxComp.current.reconfigure(
          syntaxHighlighting(resolvedDark === 'dark' ? darkSyntax : lightSyntax, {
            fallback: true,
          })
        ),
        focusComp.current.reconfigure(focusMode(() => optsRef.current.focusMode)),
        typeComp.current.reconfigure(
          typewriterMode(() => optsRef.current.typewriterMode)
        ),
        vimComp.current.reconfigure(settings.vimMode ? vim() : []),
        spellComp.current.reconfigure(
          settings.spellCheck ? spellLinter(() => useSettings.getState().spellCheck) : []
        ),
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.theme,
    settings.focusMode,
    settings.typewriterMode,
    settings.vimMode,
    settings.spellCheck,
  ]);

  return <div id="cm-host" className="cm-host" style={{ height: '100%', overflow: 'auto' }} />;
}
