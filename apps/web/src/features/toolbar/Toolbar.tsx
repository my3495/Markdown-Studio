import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';
import { useSettings } from '../../stores/settings';
import { useDocuments } from '../../stores/document';
import { toast } from '../../stores/toast';
import { t } from '../../i18n';
import { shortcutLabel } from '../../platform/shortcut/registry';
import { getFsBackend } from '../../platform/fs/registry';
import { idbSnapshotFs } from '../../platform/fs/idbSnapshot';
import {
  createShareSnapshot,
  createSnapshot,
  encodeSharePayload,
  type PandocFormat,
} from '@md-studio/core';
import {
  downloadHtml,
  downloadShareHtml,
  printPdf,
  exportShareCard,
  exportViaPandoc,
} from '../export/exporter';
import { getRenderOptions } from '../../stores/settings';
import { runMatchedRecipes } from '../../platform/recipes/runner';
import { saveShare, shareUrlForId, shareUrlForPayload } from '../../platform/share/store';
import { Icon } from '../../components/Icon';
import { flushEditor } from '../editor/flush';
import { useUi } from '../../stores/ui';
import { useVault } from '../../stores/vault';

interface Props {
  editorView: EditorView | null;
  onSlides: () => void;
  onOpenFolder: () => void;
  folderActive: boolean;
}

/**
 * 工具栏下拉面板：通过 Portal 渲染到 body。
 * 工具栏带 backdrop-filter（会为 fixed 元素创建包含块）且 overflow-x:auto，
 * 直接内嵌会被裁剪 —— 这是「点更多无反应」的根因。
 */
function Dropdown({
  open,
  pos,
  wide,
  panelRef,
  children,
}: {
  open: boolean;
  pos: { top: number; right: number } | null;
  wide?: boolean;
  panelRef: React.RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      className={`tb-menu-panel${wide ? ' tb-menu-panel-wide' : ''}`}
      role="menu"
      style={pos ? { position: 'fixed', top: pos.top, right: pos.right, left: 'auto' } : undefined}
    >
      {children}
    </div>,
    document.body
  );
}

export function Toolbar({ editorView, onSlides, onOpenFolder, folderActive }: Props) {
  const s = useSettings();
  const docs = useDocuments();
  const vault = useVault();
  const ui = useUi();
  const active = docs.activeId ? docs.docs[docs.activeId] : null;
  const locale = s.locale;
  const agentActive = ui.agentOpen;
  const [moreOpen, setMoreOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /** 下拉面板改为 fixed 定位：工具栏是 overflow 容器，绝对定位会被裁剪（原「点更多无反应」的根因） */
  const [dropPos, setDropPos] = useState<{ top: number; right: number } | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  /** 菜单面板通过 Portal 渲染到 body，需单独记录引用（外部点击判定用） */
  const morePanelRef = useRef<HTMLDivElement>(null);
  const exportPanelRef = useRef<HTMLDivElement>(null);
  const viewSwitchRef = useRef<HTMLDivElement>(null);
  const [viewThumb, setViewThumb] = useState({ left: 0, width: 0 });

  // 分段控件滑块：测量当前激活按钮的位置/宽度，语言或尺寸变化时重算
  useLayoutEffect(() => {
    const el = viewSwitchRef.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLElement>('.tb-btn.active');
      if (!active) return;
      setViewThumb({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [locale, s.mobileView]);

  useEffect(() => {
    if (!moreOpen && !exportOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        moreOpen &&
        moreRef.current &&
        !moreRef.current.contains(target) &&
        !morePanelRef.current?.contains(target)
      ) {
        setMoreOpen(false);
      }
      if (
        exportOpen &&
        exportRef.current &&
        !exportRef.current.contains(target) &&
        !exportPanelRef.current?.contains(target)
      ) {
        setExportOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreOpen(false);
        setExportOpen(false);
      }
    };
    // 视口变化后锚点失效，直接收起，避免菜单悬空
    const onResize = () => {
      setMoreOpen(false);
      setExportOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [moreOpen, exportOpen]);

  /** 根据触发按钮的位置计算下拉面板坐标（右对齐，保证不越界） */
  const anchorTo = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setDropPos({ top: Math.round(r.bottom + 6), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
  };

  /** 侧栏显隐：窄屏切抽屉，宽屏切桌面侧栏 */
  const toggleSidebar = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches) {
      ui.toggleSide();
    } else {
      ui.toggleSideCollapsed();
    }
  };

  const getSelectedText = (): string => {
    const sel = editorView?.state.selection.main;
    if (sel && !sel.empty) {
      return editorView!.state.doc.sliceString(sel.from, sel.to);
    }
    return window.getSelection()?.toString() ?? '';
  };

  const onNew = () => {
    // 与 newTab 快捷键保持一致：已绑定知识库时直接在知识库内创建落盘笔记
    if (vault.persisted) {
      void vault.createNote();
      return;
    }
    docs.newDoc();
  };
  const onOpen = async () => {
    const f = await getFsBackend().openFile();
    if (!f) return;
    docs.openDoc({ id: f.id, name: f.name, path: f.path, content: f.content });
    if (f.encoding && f.encoding !== 'utf-8') {
      toast(t(locale, 'encodingDetected').replace('{enc}', f.encoding.toUpperCase()), {
        tone: 'info',
      });
    }
  };
  const runSaveSideEffects = (doc: NonNullable<typeof active>, path: string) => {
    if (s.autoSnapshot) {
      void createSnapshot(idbSnapshotFs, path, doc.content)
        .then(() => {
          runMatchedRecipes('on-commit', {
            path,
            name: doc.name,
            content: doc.content,
          });
        })
        .catch(() => undefined);
    }
    runMatchedRecipes('on-save', {
      path,
      name: doc.name,
      content: doc.content,
    });
    toast(t(locale, 'saved'), { tone: 'success', duration: 2200 });
  };

  const onSave = () => {
    if (!active) return;
    const doc = active;
    // 与 Ctrl+S 快捷键保持一致：只有知识库笔记写回知识库（相对路径），
    // 打开/拖入的外部文档走 FsBackend 写回原文件（桌面端为绝对路径）。
    const isVaultNote = vault.persisted && vault.notes.some((n) => n.id === doc.id);
    if (isVaultNote) {
      void vault.saveActiveToStore(doc.id, doc.content).then((ok) => {
        if (!ok) {
          void getFsBackend()
            .saveFile(doc.path ?? null, doc.name, doc.content)
            .then((name) => {
              docs.markSaved(doc.id, name);
              runSaveSideEffects(doc, name);
            });
          return;
        }
        runSaveSideEffects(doc, doc.path ?? doc.name);
      });
      return;
    }
    void getFsBackend()
      .saveFile(doc.path ?? null, doc.name, doc.content)
      .then((name) => {
        docs.markSaved(doc.id, name);
        runSaveSideEffects(doc, name);
      });
  };
  const onExportHtml = () => {
    if (!active) return;
    downloadHtml(active.content, {
      title: active.name,
      mode: s.theme === 'dark' ? 'dark' : 'light',
      footer: s.footer,
      renderOpts: getRenderOptions(s),
    });
    setExportOpen(false);
  };
  const onExportPdf = () => {
    if (!active) return;
    void printPdf(active.content, {
      title: active.name,
      mode: s.theme === 'dark' ? 'dark' : 'light',
      footer: s.footer,
      renderOpts: getRenderOptions(s),
    }).then((r) => {
      // 弹窗被拦截时用户会以为「点了没反应」，必须给明确提示
      if (!r.ok) {
        toast(t(locale, r.reason === 'popup-blocked' ? 'pdfPopupBlocked' : 'pdfPrintFailed'), {
          tone: 'danger',
        });
      }
    });
    setExportOpen(false);
  };
  const onShareCard = () => {
    if (!active) return;
    const text = getSelectedText() || active.content.slice(0, 200);
    void exportShareCard(text, active.name).then((ok) => {
      if (!ok) toast(t(locale, 'shareCardFailed'), { tone: 'danger' });
    });
    setMoreOpen(false);
  };
  const onShareLink = async () => {
    if (!active) return;
    const snap = createShareSnapshot(active.name, active.content);
    await saveShare(snap);
    const url =
      active.content.length < 12_000
        ? shareUrlForPayload(encodeSharePayload(snap))
        : shareUrlForId(snap.id);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
    downloadShareHtml(active.content, {
      title: active.name,
      mode: s.theme === 'dark' ? 'dark' : 'light',
      footer: s.footer,
      renderOpts: getRenderOptions(s),
    });
    toast(`${t(locale, 'shareLinkCopied')} (+ ${t(locale, 'shareHtml')})`, {
      detail: url,
      tone: 'success',
      duration: 8000,
    });
    setMoreOpen(false);
  };
  const onInsertBoard = () => {
    if (!active) return;
    // 先落定编辑器里未同步的输入：否则刚打完字就插入，正文会被防抖回写覆盖
    flushEditor();
    const st = useDocuments.getState();
    const cur = st.docs[active.id]?.content ?? active.content;
    void st.updateContent(
      active.id,
      `${cur.replace(/\s*$/, '')}\n\n\`\`\`tldraw\n{"v":1,"strokes":[]}\n\`\`\`\n`
    );
    setMoreOpen(false);
  };
  const onPandoc = (format: PandocFormat) => {
    if (!active) return;
    void exportViaPandoc(active.content, format, active.name).then((r) => {
      if (r.mode === 'command' && r.command) {
        toast(t(locale, 'pandocCopied'), { detail: r.command, tone: 'success', duration: 8000 });
      }
    });
    setExportOpen(false);
    setMoreOpen(false);
  };
  const toggleTypo = () => {
    const next = !s.typography.spacing;
    s.setTypography('spacing', next);
    s.setTypography('numberSpacing', next);
  };

  return (
    <div className="toolbar">
      <button
        className="tb-btn icon-only tb-sidetoggle"
        onClick={toggleSidebar}
        title={t(locale, 'toggleSide')}
        aria-label={t(locale, 'toggleSide')}
        aria-pressed={!ui.sideCollapsed}
      >
        <Icon name="menu" />
      </button>
      <span className="tb-brand" />

      <span className="tb-sep" />
      <button className="tb-btn primary" onClick={onNew} title={shortcutLabel('newTab')}>
        <Icon name="new" />
        <span className="tb-label">{t(locale, 'new')}</span>
      </button>
      <button className="tb-btn" onClick={onOpen} title={t(locale, 'open')}>
        <Icon name="open" />
        <span className="tb-label">{t(locale, 'open')}</span>
      </button>
      <button className="tb-btn" onClick={onSave} title={shortcutLabel('save')}>
        <Icon name="save" />
        <span className="tb-label">{t(locale, 'save')}</span>
      </button>
      <button
        className={`tb-btn ${folderActive ? 'active' : ''}`}
        onClick={onOpenFolder}
        title={t(locale, 'folderHint')}
      >
        <Icon name="open" />
        <span className="tb-label">{t(locale, 'folder')}</span>
      </button>

      <span className="tb-sep" />
      <button
        className={`tb-btn tb-optional ${s.focusMode ? 'active' : ''}`}
        onClick={s.toggleFocus}
        title={shortcutLabel('focusMode')}
      >
        <Icon name="focus" />
        <span className="tb-label">{t(locale, 'focus')}</span>
      </button>
      <button
        className={`tb-btn tb-optional ${s.readingMode ? 'active' : ''}`}
        onClick={s.toggleReadingMode}
        title={t(locale, 'readingMode')}
      >
        <Icon name="preview" />
        <span className="tb-label">{t(locale, 'readingMode')}</span>
      </button>

      <span className="tb-sep" />
      <div
        className="tb-viewswitch"
        role="group"
        aria-label={t(locale, 'viewSplit')}
        ref={viewSwitchRef}
      >
        <span
          className="tb-viewswitch-thumb"
          aria-hidden="true"
          style={{ transform: `translateX(${viewThumb.left}px)`, width: viewThumb.width }}
        />
        <button
          className={`tb-btn ${s.mobileView === 'edit' ? 'active' : ''}`}
          onClick={() => s.setMobileView('edit')}
          title={t(locale, 'viewEdit')}
        >
          <Icon name="edit" size={16} />
          <span className="tb-label">{t(locale, 'viewEdit')}</span>
        </button>
        <button
          className={`tb-btn ${s.mobileView === 'preview' ? 'active' : ''}`}
          onClick={() => s.setMobileView('preview')}
          title={t(locale, 'viewPreview')}
        >
          <Icon name="preview" size={16} />
          <span className="tb-label">{t(locale, 'viewPreview')}</span>
        </button>
        <button
          className={`tb-btn ${s.mobileView === 'split' ? 'active' : ''}`}
          onClick={() => s.setMobileView('split')}
          title={t(locale, 'viewSplit')}
        >
          <Icon name="split" size={16} />
          <span className="tb-label">{t(locale, 'viewSplit')}</span>
        </button>
      </div>

      <button
        className="tb-btn"
        onClick={() => ui.openPalette()}
        title={shortcutLabel('commandPalette')}
      >
        <Icon name="search" />
        <span className="tb-label">{t(locale, 'commandPalette')}</span>
      </button>

      {/* 图谱已升格为主区面板：主菜单提供直达入口 */}
      <button
        className="tb-btn"
        onClick={() => ui.openPanel('graph')}
        title={t(locale, 'graph')}
      >
        <Icon name="graph" />
        <span className="tb-label">{t(locale, 'sideGraph')}</span>
      </button>

      <span className="tb-sep" />
      <div className="tb-dropdown" ref={exportRef}>
        <button
          className={`tb-btn ${exportOpen ? 'active' : ''}`}
          onClick={(e) => {
            anchorTo(e.currentTarget);
            setExportOpen((v) => !v);
            setMoreOpen(false);
          }}
          title={t(locale, 'exportMenu')}
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          disabled={!active}
        >
          <Icon name="exportHtml" />
          <span className="tb-label">{t(locale, 'exportMenu')}</span>
        </button>
        <Dropdown open={exportOpen} pos={dropPos} panelRef={exportPanelRef}>
            <button type="button" className="tb-menu-item" onClick={onExportHtml}>
              <Icon name="exportHtml" size={16} />
              {t(locale, 'exportHtml')}
            </button>
            <button type="button" className="tb-menu-item" onClick={onExportPdf}>
              <Icon name="exportPdf" size={16} />
              {t(locale, 'exportPdf')}
            </button>
            <div className="tb-menu-sep" />
            <div className="tb-menu-label">{t(locale, 'exportPandoc')}</div>
            {(['latex', 'docx', 'epub', 'pdf'] as PandocFormat[]).map((fmt) => (
              <button key={fmt} type="button" className="tb-menu-item" onClick={() => onPandoc(fmt)}>
                {fmt.toUpperCase()}
              </button>
            ))}
            <div className="tb-menu-sep" />
            <button type="button" className="tb-menu-item" onClick={() => void onShareLink()}>
              <Icon name="share" size={16} />
              {t(locale, 'shareLink')}
            </button>
            <button type="button" className="tb-menu-item" onClick={onShareCard}>
              <Icon name="shareCard" size={16} />
              {t(locale, 'shareCard')}
            </button>
        </Dropdown>
      </div>

      <div className="tb-dropdown" ref={moreRef}>
        <button
          className={`tb-btn icon-only ${moreOpen ? 'active' : ''}`}
          onClick={(e) => {
            anchorTo(e.currentTarget);
            setMoreOpen((v) => !v);
            setExportOpen(false);
          }}
          title={t(locale, 'more')}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
        >
          <Icon name="more" />
        </button>
        <Dropdown open={moreOpen} pos={dropPos} wide panelRef={morePanelRef}>
            <button
              type="button"
              className={`tb-menu-item ${s.typewriterMode ? 'active' : ''}`}
              onClick={() => {
                s.toggleTypewriter();
                setMoreOpen(false);
              }}
            >
              <Icon name="typewriter" size={16} />
              {t(locale, 'typewriter')}
            </button>
            <button
              type="button"
              className={`tb-menu-item ${s.typography.spacing ? 'active' : ''}`}
              onClick={() => {
                toggleTypo();
                setMoreOpen(false);
              }}
            >
              <Icon name="typography" size={16} />
              {t(locale, 'typography')}
            </button>
            <button
              type="button"
              className="tb-menu-item"
              disabled={!active}
              onClick={() => {
                ui.openPanel('history');
                setMoreOpen(false);
              }}
            >
              <Icon name="history" size={16} />
              {t(locale, 'history')}
            </button>
            <button
              type="button"
              className="tb-menu-item"
              onClick={() => {
                ui.openPanel('crypto');
                setMoreOpen(false);
              }}
            >
              <Icon name="crypto" size={16} />
              {t(locale, 'cryptoTitle')}
            </button>
            <button
              type="button"
              className="tb-menu-item"
              onClick={() => {
                ui.openPanel('git');
                setMoreOpen(false);
              }}
            >
              <Icon name="git" size={16} />
              {t(locale, 'gitTitle')}
            </button>
            <button
              type="button"
              className="tb-menu-item"
              onClick={() => {
                ui.openPanel('sync');
                setMoreOpen(false);
              }}
            >
              <Icon name="sync" size={16} />
              {t(locale, 'syncTitle')}
            </button>
            <button
              type="button"
              className="tb-menu-item"
              disabled={!active}
              onClick={() => {
                onSlides();
                setMoreOpen(false);
              }}
            >
              <Icon name="slides" size={16} />
              {t(locale, 'slides')}
            </button>
            <button
              type="button"
              className="tb-menu-item"
              disabled={!active}
              onClick={onInsertBoard}
            >
              <Icon name="board" size={16} />
              {t(locale, 'insertBoard')}
            </button>

            <div className="tb-menu-sep" />
            <div className="tb-menu-row">
              <span>{t(locale, 'autoNumber')}</span>
              <select
                value={s.autoNumber || 'none'}
                onChange={(e) =>
                  s.setAutoNumber(e.target.value === 'none' ? false : (e.target.value as any))
                }
              >
                <option value="none">{t(locale, 'none')}</option>
                <option value="arabic">{t(locale, 'arabic')}</option>
                <option value="chinese">{t(locale, 'chinese')}</option>
                <option value="chapter">{t(locale, 'chapter')}</option>
              </select>
            </div>
            <div className="tb-menu-row">
              <span>{t(locale, 'tocPlaceholder')}</span>
              <select
                value={
                  !s.tocPlaceholder
                    ? 'none'
                    : String(s.tocPlaceholder.maxDepth ?? 6)
                }
                onChange={(e) => {
                  const v = e.target.value;
                  s.setTocPlaceholder(v === 'none' ? false : { maxDepth: Number(v) });
                }}
              >
                <option value="none">{t(locale, 'none')}</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="6">6</option>
              </select>
            </div>
            <div className="tb-menu-row">
              <span>{t(locale, 'theme')}</span>
              <select value={s.theme} onChange={(e) => s.setTheme(e.target.value as any)}>
                <option value="light">{t(locale, 'light')}</option>
                <option value="dark">{t(locale, 'dark')}</option>
                <option value="system">{t(locale, 'system')}</option>
              </select>
            </div>
            <div className="tb-menu-row">
              <span>{t(locale, 'width')}</span>
              <select value={s.width} onChange={(e) => s.setWidth(e.target.value as any)}>
                <option value="narrow">{t(locale, 'widthNarrow')}</option>
                <option value="medium">{t(locale, 'widthMedium')}</option>
                <option value="wide">{t(locale, 'widthWide')}</option>
                <option value="full">{t(locale, 'widthFull')}</option>
              </select>
            </div>
        </Dropdown>
      </div>

      <span className="tb-spacer" />
      <button
        className={`tb-btn ${ui.activePanel === 'settings' ? 'active' : ''}`}
        onClick={() => ui.openPanel('settings')}
        title={t(locale, 'settings')}
      >
        <Icon name="settings" />
        <span className="tb-label">{t(locale, 'settings')}</span>
      </button>
      <button
        className={`tb-btn tb-agent-toggle ${agentActive ? 'active' : ''}`}
        onClick={() => ui.toggleAgent()}
        title={t(locale, 'agent')}
        aria-pressed={agentActive}
      >
        <Icon name="agent" />
        <span className="tb-label">{t(locale, 'agent')}</span>
      </button>
      {/* 右侧栏显隐（与左侧栏对称；图标也跟 Cursor 的 panel-right 一致） */}
      <button
        className="tb-btn icon-only tb-panel-toggle tb-panel-toggle-right"
        onClick={() => ui.toggleAgent()}
        title={agentActive ? t(locale, 'collapseRight') : t(locale, 'expandRight')}
        aria-label={t(locale, 'toggleRight')}
        aria-pressed={agentActive}
      >
        <Icon name={agentActive ? 'panelRightClose' : 'panelRightOpen'} />
      </button>
    </div>
  );
}
