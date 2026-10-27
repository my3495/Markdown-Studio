import { useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { useSettings } from '../../stores/settings';
import { useDocuments } from '../../stores/document';
import { useOllama } from '../../stores/ollama';
import { useUi } from '../../stores/ui';
import { toast } from '../../stores/toast';
import { shortcutLabel } from '../../platform/shortcut/registry';
import { t } from '../../i18n';
import { Icon } from '../../components/Icon';

interface Props {
  editorView: EditorView | null;
  persisted?: boolean;
  /** 主动保存（与 Ctrl+S 同一条路径）；为空时保存项不可点 */
  onSave?: () => void;
}

/** 路径过长时保留尾部：文件名与最后两级目录信息量最大 */
const shortPath = (p: string, max = 44) => (p.length <= max ? p : `…${p.slice(-(max - 1))}`);

/**
 * 底部状态栏（三区）：
 *   左 = 文档身份（名称 / 路径）与保存状态
 *   中 = 排版告警与写作模式（专注 / 打字机 / 标题编号）
 *   右 = 计量（字数 / 光标 / 选区 / 视图）与模型连接
 * 字数项点击展开详情弹层（原统计胶囊的能力保留，不再遮挡正文）。
 */
export function StatusBar({ editorView, persisted, onSave }: Props) {
  const locale = useSettings((st) => st.locale);
  const focusMode = useSettings((st) => st.focusMode);
  const typewriterMode = useSettings((st) => st.typewriterMode);
  const autoNumber = useSettings((st) => st.autoNumber);
  const viewMode = useSettings((st) => st.mobileView);
  const provider = useSettings((st) => st.agent.provider);
  const model = useSettings((st) => st.agent.model);
  const active = useDocuments((st) => (st.activeId ? st.docs[st.activeId] ?? null : null));
  const ollamaStatus = useOllama((st) => st.status);

  const [line, setLine] = useState(1);
  const [col, setCol] = useState(1);
  const [selLen, setSelLen] = useState(0);
  const [details, setDetails] = useState(false);
  const statsRef = useRef<HTMLDivElement | null>(null);

  // 光标/选区：DOM 事件覆盖手动移动，selectionchange 覆盖鼠标拖选与外部改动
  useEffect(() => {
    if (!editorView) return;
    const update = () => {
      const sel = editorView.state.selection.main;
      const pos = editorView.state.doc.lineAt(sel.head);
      setLine(pos.number);
      setCol(sel.head - pos.from + 1);
      setSelLen(sel.to - sel.from);
    };
    update();
    const dom = editorView.dom;
    const onSel = () => {
      if (editorView.hasFocus) update();
    };
    dom.addEventListener('keyup', update);
    dom.addEventListener('mouseup', update);
    dom.addEventListener('input', update);
    document.addEventListener('selectionchange', onSel);
    return () => {
      dom.removeEventListener('keyup', update);
      dom.removeEventListener('mouseup', update);
      dom.removeEventListener('input', update);
      document.removeEventListener('selectionchange', onSel);
    };
  }, [editorView]);

  // 详情弹层：点击外部 / Esc 收起
  useEffect(() => {
    if (!details) return;
    const onDoc = (e: MouseEvent) => {
      if (statsRef.current && !statsRef.current.contains(e.target as Node)) setDetails(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetails(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [details]);

  const dirty = !!active?.dirty;
  const words = active?.words ?? 0;
  const chars = active?.content.length ?? 0;
  const warnCount = active?.warnings.length ?? 0;
  const hasBadges = !!persisted || focusMode || typewriterMode || !!autoNumber;
  /** 路径与文件名相同时（Web 端本地存储）不再重复显示，避免「未命名.md 未命名.md」 */
  const pathLabel = !active
    ? null
    : active.path
      ? active.path === active.name
        ? null
        : shortPath(active.path)
      : t(locale, 'sbNoPath');

  const openSettings = () => useUi.getState().openPanel('settings');

  // 连接状态：Ollama 看真实连通性，其他 provider 看是否已选模型
  const isOllama = provider === 'ollama';
  const connDot = isOllama
    ? ollamaStatus === 'online'
      ? 'ok'
      : ollamaStatus === 'checking'
        ? 'checking'
        : ollamaStatus === 'offline'
          ? 'offline'
          : ''
    : model
      ? 'ok'
      : '';
  const connText = isOllama
    ? ollamaStatus === 'online'
      ? t(locale, 'agentConnOnline')
      : ollamaStatus === 'checking'
        ? t(locale, 'agentConnChecking')
        : ollamaStatus === 'offline'
          ? t(locale, 'agentConnOffline')
          : t(locale, 'sbConnUnknown')
    : model
      ? `${provider} · ${model}`
      : `${provider}（${t(locale, 'sbConnUnset')}）`;

  const viewKey =
    viewMode === 'edit' ? 'viewEdit' : viewMode === 'preview' ? 'viewPreview' : 'viewSplit';

  const copyPath = () => {
    if (!active?.path) return;
    const task = navigator.clipboard?.writeText(active.path);
    if (!task) return;
    void task.then(
      () => toast(t(locale, 'sbCopied'), { tone: 'success' }),
      () => {
        /* 剪贴板不可用时静默 */
      }
    );
  };

  return (
    <footer className="statusbar" role="contentinfo" aria-label={t(locale, 'sbLabel')}>
      <div className="sb-left">
        {active ? (
          <>
            <span
              className="sb-item sb-name"
              title={active.path ? `${active.path}\n${t(locale, 'sbPathCopy')}` : active.name}
              onDoubleClick={copyPath}
            >
              {active.name}
            </span>
            {pathLabel && (
              <span
                className={`sb-item sb-path ${active.path ? '' : 'is-muted'}`}
                title={
                  active.path
                    ? `${active.path}\n${t(locale, 'sbPathCopy')}`
                    : t(locale, 'sbNoPath')
                }
                onDoubleClick={copyPath}
              >
                {pathLabel}
              </span>
            )}
            <button
              type="button"
              className="sb-item sb-save"
              onClick={onSave}
              disabled={!onSave || !dirty}
              title={
                dirty
                  ? t(locale, 'sbSaveHint').replace('{key}', shortcutLabel('save'))
                  : t(locale, 'saved')
              }
            >
              <span className={`sb-dot ${dirty ? 'dirty' : 'ok'}`} />
              {dirty ? t(locale, 'unsaved') : t(locale, 'saved')}
            </button>
          </>
        ) : (
          <span className="sb-item is-muted">{t(locale, 'sbNoDoc')}</span>
        )}
      </div>

      <div className="sb-mid">
        {active && warnCount > 0 && (
          <button
            type="button"
            className="sb-item sb-warn"
            onClick={openSettings}
            title={t(locale, 'sbWarnHint').replace('{n}', String(warnCount))}
          >
            <Icon name="typography" size={12} />
            {warnCount}
          </button>
        )}
        {focusMode && (
          <span className="sb-chip">
            <Icon name="focus" size={11} />
            {t(locale, 'focus')}
          </span>
        )}
        {typewriterMode && (
          <span className="sb-chip">
            <Icon name="typewriter" size={11} />
            {t(locale, 'typewriter')}
          </span>
        )}
        {autoNumber && (
          <span className="sb-chip">
            <Icon name="autoNumber" size={11} />
            {t(locale, 'autoNumber')}
          </span>
        )}
      </div>

      <div className="sb-right">
        {active && (
          <>
            <div className="sb-stats" ref={statsRef}>
              <button
                type="button"
                className="sb-item sb-words"
                onClick={() => setDetails((v) => !v)}
                aria-expanded={details}
                title={t(locale, 'words')}
              >
                <Icon name="words" size={12} />
                {words.toLocaleString()}
              </button>
              {details && (
                <div className="stats-pop sb-pop" role="dialog" aria-label={t(locale, 'words')}>
                  <div className="stats-pop-row">
                    <span className="k">
                      <Icon name="words" size={13} />
                      {t(locale, 'words')}
                    </span>
                    <span className="v">{words.toLocaleString()}</span>
                  </div>
                  <div className="stats-pop-row">
                    <span className="k">
                      <Icon name="line" size={13} />
                      {t(locale, 'line')}
                    </span>
                    <span className="v">
                      {line}:{col}
                    </span>
                  </div>
                  <div className="stats-pop-row">
                    <span className="k">{t(locale, 'sbChars')}</span>
                    <span className="v">{chars.toLocaleString()}</span>
                  </div>
                  <div className="stats-pop-row">
                    <span className="k">{t(locale, 'selection')}</span>
                    <span className="v">{selLen}</span>
                  </div>
                  <div className="stats-pop-row">
                    <span className="k">{t(locale, dirty ? 'unsaved' : 'saved')}</span>
                    <span className="v">
                      <span className={`sb-dot ${dirty ? 'dirty' : 'ok'}`} />
                    </span>
                  </div>
                  {hasBadges && (
                    <div className="stats-pop-badges">
                      {persisted && (
                        <span className="sb-badge">
                          <Icon name="save" size={12} />
                          {t(locale, 'folder')}
                        </span>
                      )}
                      {focusMode && (
                        <span className="sb-badge">
                          <Icon name="focus" size={12} />
                          {t(locale, 'focus')}
                        </span>
                      )}
                      {typewriterMode && (
                        <span className="sb-badge">
                          <Icon name="typewriter" size={12} />
                          {t(locale, 'typewriter')}
                        </span>
                      )}
                      {autoNumber && (
                        <span className="sb-badge">
                          {t(locale, 'autoNumber')}: {autoNumber}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {editorView && (
              <>
                <span className="sb-sep" />
                <span className="sb-item" title={t(locale, 'line')}>
                  <Icon name="line" size={12} />
                  {line}:{col}
                </span>
              </>
            )}

            {selLen > 0 && (
              <>
                <span className="sb-sep" />
                <span className="sb-item">
                  {t(locale, 'selection')} {selLen}
                </span>
              </>
            )}

            <span className="sb-sep sb-optional" />
            <span className="sb-item sb-optional">{t(locale, viewKey)}</span>
          </>
        )}

        <span className="sb-sep" />
        <button
          type="button"
          className="sb-item sb-conn"
          onClick={openSettings}
          title={t(locale, 'sbConnHint')}
        >
          <span className={`sb-dot ${connDot}`} />
          <span className="sb-conn-label">{connText}</span>
        </button>
      </div>
    </footer>
  );
}
