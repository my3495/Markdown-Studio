import { useCallback, useEffect, useRef } from 'react';
import { Tldraw, createShapeId, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { tlShapesToWb, wbToTlShapes, type WbDocument } from '@md-studio/core';
import { tldrawUiAssetUrls } from '../../../../tldrawAssets';

interface Props {
  doc: WbDocument;
  onChange: (doc: WbDocument) => void;
  /** 跟随应用主题的暗色模式 */
  dark?: boolean;
}

const WRITEBACK_DEBOUNCE_MS = 600;

/**
 * C4：真实 tldraw 白板（懒加载 chunk，含 tldraw.css）。
 * - 挂载：wbToTlShapes → editor.createShapes（partials，自动补默认 props）；
 * - 变更：store.listen（仅 document + user 来源）防抖 600ms → tlShapesToWb → onChange（由上层写回 fence）；
 * - 卸载：先落盘待写回的改动再取消订阅，避免丢失最后一次编辑；
 * - 主题：由 dark 驱动 editor.user 的 colorScheme（显式跟随应用主题，不依赖系统推断）。
 */
export default function TldrawFullEditor({ doc, onChange, dark }: Props) {
  const editorRef = useRef<Editor | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const timerRef = useRef(0);
  const pendingRef = useRef(false);
  const readyRef = useRef(false);
  const docRef = useRef(doc);
  const onChangeRef = useRef(onChange);
  docRef.current = doc;
  onChangeRef.current = onChange;

  /** 立即把 tldraw 当前页面形状转换为 WbDocument 并写回 */
  const writeBack = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    pendingRef.current = false;
    window.clearTimeout(timerRef.current);
    onChangeRef.current(tlShapesToWb(editor.getCurrentPageShapes()));
  }, []);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      const initial = wbToTlShapes(docRef.current).map((s) => ({ ...s, id: createShapeId(s.id) }));
      if (initial.length > 0) {
        editor.createShapes(initial);
        editor.zoomToFit({ animation: { duration: 0 } });
      }
      // 忽略挂载阶段（初始 createShapes）产生的 store 事件，避免启动即重复写回
      window.setTimeout(() => {
        readyRef.current = true;
      }, 0);

      const flush = () => {
        if (!readyRef.current) return;
        pendingRef.current = true;
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(writeBack, WRITEBACK_DEBOUNCE_MS);
      };
      // 仅响应「文档范围 + 用户来源」：相机/缩放/会话/远程变更不触发写回
      unsubRef.current = editor.store.listen(flush, { scope: 'document', source: 'user' });
    },
    [writeBack]
  );

  // 主题跟随应用（切换明暗/强调色后白板即时生效）
  useEffect(() => {
    editorRef.current?.user.updateUserPreferences({
      colorScheme: dark ? 'dark' : 'light',
    });
  }, [dark]);

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
      // 卸载前落盘未写回的改动（此时 editor 仍然有效）
      if (pendingRef.current) writeBack();
      unsubRef.current?.();
      unsubRef.current = null;
      editorRef.current = null;
      readyRef.current = false;
    },
    [writeBack]
  );

  return (
    <div className="tldraw-block tldraw-full" style={{ height: 360 }}>
      <Tldraw
        autoFocus
        assetUrls={tldrawUiAssetUrls}
        onMount={handleMount}
        options={{ maxShapesPerPage: 2000 }}
      />
    </div>
  );
}
