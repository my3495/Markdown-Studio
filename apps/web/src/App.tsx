import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { useSettings } from './stores/settings';
import { useDocuments } from './stores/document';
import { applyTheme, resolveTheme } from './platform/theme';
import { shortcutLabel, useShortcuts } from './platform/shortcut/registry';
import { getFsBackend, type OpenedFile } from './platform/fs/registry';
import { getFileDropSource } from './platform/fs/drop';
import { idbSnapshotFs } from './platform/fs/idbSnapshot';
import { CodeMirrorEditor } from './features/editor/CodeMirrorEditor';
import { SelectionBubble } from './features/editor/SelectionBubble';
import { MarkdownPreview } from './features/preview/MarkdownPreview';
import { PreviewBoundary } from './features/preview/PreviewBoundary';
import { Toolbar } from './features/toolbar/Toolbar';
import { StatusBar } from './features/statusbar/StatusBar';
import { SlideShow } from './features/slides/SlideShow';
import { ScrollSync } from './features/sync/ScrollSync';
import { SideRail } from './features/shell/SideRail';
import { PanelView, PANEL_META } from './features/shell/PanelView';
import { AgentChat } from './features/agent/AgentChat';
import { CommandPalette } from './features/command/CommandPalette';
import { useVault } from './stores/vault';
import { useUi } from './stores/ui';
import { currentVaultStore } from './platform/vault/registry';
import {
  createSnapshot,
  decodeBytes,
  normalizeNoteName,
  replaceHeadingAtLine,
  replaceTldrawFence,
  saveNote,
} from '@md-studio/core';
import { warmupRender } from './platform/render-offthread';
import { runMatchedRecipes } from './platform/recipes/runner';
import { startCronRecipes } from './platform/recipes/cron';
import { parseShareHash } from './platform/share/store';
import { exportShareCard } from './features/export/exporter';
import { ShareView } from './features/share/ShareView';
import { Icon } from './components/Icon';
import { ToastHost } from './features/toast/ToastHost';
import { toast } from './stores/toast';
import { t } from './i18n';

const WIDTH_PX: Record<string, string> = {
  narrow: '600px',
  medium: '780px',
  wide: '920px',
  full: '1100px',
};

/** Ctrl+Shift+W 的循环顺序（与设置面板里的宽度档位一致） */
const WIDTH_ORDER = ['narrow', 'medium', 'wide', 'full'] as const;
const WIDTH_LABEL_KEY = {
  narrow: 'widthNarrow',
  medium: 'widthMedium',
  wide: 'widthWide',
  full: 'widthFull',
} as const;

export function App() {
  const s = useSettings();
  const docs = useDocuments();
  const vault = useVault();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  /**
   * 提交标签重命名：知识库笔记同步重命名磁盘文件（id 即相对路径），
   * 其他文档仅改标签显示名（新建文档的名字会作为「保存」时的默认文件名）。
   */
  const commitRename = useCallback(async (id: string) => {
    const doc = docs.docs[id];
    const value = renameValue;
    setRenamingId(null);
    setRenameValue('');
    if (!doc) return;
    const next = normalizeNoteName(value);
    if (!next || next === doc.name) return;
    if (useVault.getState().persisted && doc.path && doc.path === id) {
      const ok = await useVault.getState().renameNote(id, next);
      if (!ok) toast(t(s.locale, 'renameFailed'), { tone: 'danger' });
      return;
    }
    docs.renameDoc(id, next);
  }, [docs, renameValue, s.locale]);

  const [dropActive, setDropActive] = useState(false);

  const notifyEncoding = useCallback(
    (enc: string) => {
      if (enc && enc !== 'utf-8') {
        toast(t(s.locale, 'encodingDetected').replace('{enc}', enc.toUpperCase()), {
          tone: 'info',
        });
      }
    },
    [s.locale]
  );

  /** 打开拖入的文档：已通过同一 path 打开过的标签直接激活，避免覆盖未保存内容 */
  const openDropped = useCallback(
    (files: OpenedFile[]) => {
      if (files.length === 0) return;
      let target: string | null = null;
      for (const f of files) {
        const st = useDocuments.getState();
        const existing = Object.values(st.docs).find((d) => d.path && d.path === f.path);
        if (existing) {
          target = existing.id;
        } else {
          st.openDoc({ id: f.id, name: f.name, path: f.path, content: f.content });
          target = f.id;
        }
        notifyEncoding(f.encoding ?? '');
      }
      if (target) useDocuments.getState().setActive(target);
    },
    [notifyEncoding]
  );

  // 拖入文档：桌面端走 Tauri 原生拖放（带绝对路径），Web 回退到 HTML5 拖放
  useEffect(() => {
    const src = getFileDropSource();
    if (src) {
      return src.subscribe((e) => {
        if (e.type === 'enter') setDropActive(true);
        else if (e.type === 'leave') setDropActive(false);
        else {
          setDropActive(false);
          openDropped(e.files);
        }
      });
    }

    let depth = 0;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDropActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropActive(false);
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDropActive(false);
      const list = Array.from(e.dataTransfer?.files ?? [])
        .filter((f) => /\.(md|markdown|mdx)$/i.test(f.name) && f.size <= 20 * 1024 * 1024)
        .slice(0, 20);
      const opened: OpenedFile[] = [];
      for (const f of list) {
        try {
          const detected = decodeBytes(await f.arrayBuffer());
          opened.push({
            id: `file-${f.name}-${Date.now()}-${opened.length}`,
            name: f.name,
            path: f.name,
            content: detected.text,
            encoding: detected.encoding,
          });
        } catch {
          /* 读取失败的文件跳过，不影响其余文件 */
        }
      }
      openDropped(opened);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [openDropped]);

  const sideOpen = useUi((st) => st.sideOpen);
  const setSideOpen = useUi((st) => st.setSideOpen);
  const sideCollapsed = useUi((st) => st.sideCollapsed);
  const togglePalette = useUi((st) => st.togglePalette);
  const agentOpen = useUi((st) => st.agentOpen);
  const setAgentOpen = useUi((st) => st.setAgentOpen);
  const panelTabs = useUi((st) => st.panelTabs);
  const activePanel = useUi((st) => st.activePanel);
  const setActivePanel = useUi((st) => st.setActivePanel);
  const closePanelTab = useUi((st) => st.closePanelTab);
  const showDocument = useUi((st) => st.showDocument);
  const [slidesOpen, setSlidesOpen] = useState(false);
  const [shareMode, setShareMode] = useState(() => !!parseShareHash());

  const maybeSnapshot = (path: string, name: string, content: string) => {
    if (!s.autoSnapshot) return;
    void createSnapshot(idbSnapshotFs, path, content)
      .then(() => {
        runMatchedRecipes('on-commit', { path, name, content });
      })
      .catch(() => {
        /* IndexedDB 不可用时静默跳过 */
      });
  };

  const maybeRecipes = (path: string, name: string, content: string) => {
    runMatchedRecipes('on-save', { path, name, content });
  };

  // 稳定的预览回调：内部从 store 读取最新活跃文档，避免闭包捕获 active.content
  // 导致每次写回都重建函数引用 → MarkdownPreview 的 components 重建 → 白板重挂载。
  const onOpenWiki = useCallback((name: string) => {
    useVault.getState().openByName(name);
  }, []);

  const onPersistBoard = useCallback((idx: number, json: string) => {
    const st = useDocuments.getState();
    const d = st.activeId ? st.docs[st.activeId] : null;
    if (!d) return;
    const next = replaceTldrawFence(d.content, idx, json);
    void st.updateContent(d.id, next);
  }, []);

  const onEditHeading = useCallback((line: number, text: string) => {
    const st = useDocuments.getState();
    const d = st.activeId ? st.docs[st.activeId] : null;
    if (!d) return;
    const next = replaceHeadingAtLine(d.content, line, text);
    if (next !== d.content) void st.updateContent(d.id, next);
  }, []);

  const editorViewRef = useRef<EditorView | null>(null);
  /** 视图的「状态化」副本：ref.current 赋值不触发重渲染，状态栏/导出等需要感知就绪 */
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const syncRef = useRef<ScrollSync | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  /** 整个三栏容器 (.app-body)，用于左右栏拖拽分隔条按 X 比例计算宽度 */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** 标签条：标签过多时用于把激活标签滚动到可视区 */
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [splitDragging, setSplitDragging] = useState(false);
  const setSplitRatio = useSettings((st) => st.setSplitRatio);

  /** 侧栏宽度（持久化） */
  const sideWidth = useUi((st) => st.sideWidth);
  const setSideWidth = useUi((st) => st.setSideWidth);
  const railWidth = useUi((st) => st.railWidth);
  const setRailWidth = useUi((st) => st.setRailWidth);

  /** 左右栏宽度写到 CSS 变量；侧栏折叠时不写（避免影响 display:none 的折叠态） */
  useEffect(() => {
    if (sideCollapsed) return;
    document.documentElement.style.setProperty('--md-side-width', `${sideWidth}px`);
  }, [sideWidth, sideCollapsed]);
  useEffect(() => {
    if (!agentOpen) return;
    document.documentElement.style.setProperty('--md-rail-width', `${railWidth}px`);
  }, [railWidth, agentOpen]);

  /**
   * 通用竖向拖拽分隔条：在 bodyRef 容器中按 pointerX 计算新宽度。
   * 距离容器左/右边缘分别对应「左栏右边线」「右栏左边线」。
   * 拖拽时把"当前宽度"写到 body[data-resizing-width]，CSS 用 ::after 显示气泡。
   * 双击分隔条：复位默认宽度。
   */
  const onSideDividerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = bodyRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const w = Math.round(ev.clientX - rect.left);
        setSideWidth(w);
        document.body.setAttribute('data-resizing-width', `${w}px`);
      };
      const up = () => {
        document.body.classList.remove('panel-resizing');
        document.body.removeAttribute('data-resizing-width');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      e.preventDefault();
      document.body.classList.add('panel-resizing');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [setSideWidth]
  );
  const onRailDividerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = bodyRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const w = Math.round(rect.right - ev.clientX);
        setRailWidth(w);
        document.body.setAttribute('data-resizing-width', `${w}px`);
      };
      const up = () => {
        document.body.classList.remove('panel-resizing');
        document.body.removeAttribute('data-resizing-width');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      e.preventDefault();
      document.body.classList.add('panel-resizing');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [setRailWidth]
  );
  // 双击分隔条复位：传 NaN 让 store 的 clamp 函数回落到默认值。
  const onSideDividerDouble = () => useUi.getState().setSideWidth(Number.NaN);
  const onRailDividerDouble = () => useUi.getState().setRailWidth(Number.NaN);

  // 拖拽分栏分隔条：宽屏按 X（左右分栏）、窄屏按 Y（上下堆叠）计算占比
  const onDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = mainRef.current;
      if (!el) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const byHeight = window.innerWidth <= 768;
      const move = (ev: PointerEvent) => {
        const ratio = byHeight
          ? (ev.clientY - rect.top) / rect.height
          : (ev.clientX - rect.left) / rect.width;
        setSplitRatio(ratio);
      };
      const up = () => {
        setSplitDragging(false);
        document.body.classList.remove('split-resizing');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      setSplitDragging(true);
      document.body.classList.add('split-resizing');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [setSplitRatio]
  );

  const activeId = docs.activeId;
  const active = activeId ? docs.docs[activeId] : null;

  // 标签过多时标签条横向滚动：新建或切换后把激活标签带入可视区
  useEffect(() => {
    const container = tabsRef.current;
    const el = container?.querySelector<HTMLElement>('.tab.active');
    if (!container || !el) return;
    const c = container.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    if (t.left < c.left) container.scrollLeft += t.left - c.left - 8;
    else if (t.right > c.right) container.scrollLeft += t.right - c.right + 8;
  }, [activeId, activePanel, docs.order.length]);

  // 首次启动：尝试恢复上次文件夹；恢复失败或没有任何文档时兜底新建。
  // 注意：restoreFolder 内部涉及 Tauri/IndexedDB IO，可能抛错；必须捕获，
  // 否则启动 Promise 未处理拒绝，界面停在「无文档」空白态。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await vault.restoreFolder();
      } catch (e) {
        console.error('[vault] restore failed', e);
      }
      if (cancelled) return;
      // 用 getState 读取恢复后的真实文档列表（闭包里的 docs 是首帧快照）。
      // 恢复成功但目录为空时同样需要一篇文档，避免启动后无法编辑。
      if (useDocuments.getState().order.length === 0) {
        useDocuments.getState().newDoc();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 嵌入器设置变更时重绑（D2）
  useEffect(() => {
    vault.applyEmbedder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    s.agent.useRemoteEmbed,
    s.agent.embedModel,
    s.agent.embedBaseUrl,
    s.agent.provider,
    s.agent.apiKey,
    s.agent.model,
  ]);

  // 窗口失焦时降级选区配色（避免非活动窗口仍用强调色）
  useEffect(() => {
    const root = document.documentElement;
    const onBlur = () => root.classList.add('window-inactive');
    const onFocus = () => root.classList.remove('window-inactive');
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // 面板标签下 Esc 关闭当前面板（不出专注/阅读态）
  useEffect(() => {
    if (!activePanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (useUi.getState().paletteOpen) return;
      closePanelTab(activePanel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePanel, closePanelTab]);

  // F2：hash 分享路由
  useEffect(() => {
    const onHash = () => setShareMode(!!parseShareHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // D3：cron recipes
  useEffect(() => startCronRecipes(), []);

  // 空闲期预热 Shiki：主题与常用语法的按需加载是一次性冷启动成本（实测首开文档
  // 约有 500ms 落在这一步），放到启动后的空闲帧做掉，就不占用「打开即见」的关键路径。
  // 渲染已移到 Worker（ADR-01），所以预热也必须投递到 Worker，否则预热的是主线程里
  // 那份用不到的实例，Worker 里仍要再冷启动一次。
  // 失败静默：正式渲染时仍会按需加载并走原有降级日志。
  useEffect(() => {
    const idle = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const run = () => {
      warmupRender(resolveTheme(s.theme) === 'dark' ? 'dark' : 'light');
    };
    if (typeof idle === 'function') idle(run, { timeout: 3000 });
    else window.setTimeout(run, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题应用
  useEffect(() => {
    applyTheme(resolveTheme(s.theme), s.customVars);
  }, [s.theme, s.customVars]);

  // 书写区宽度
  useEffect(() => {
    document.documentElement.style.setProperty('--md-max-width', WIDTH_PX[s.width] ?? '780px');
  }, [s.width]);

  // 分栏比例（0.2–0.8）
  useEffect(() => {
    document.documentElement.style.setProperty('--md-split-ratio', String(s.splitRatio));
  }, [s.splitRatio]);

  // 渲染相关设置变更后重渲染已打开文档：
  // 标题编号 / 正文内目录 / 中文排版 / 高亮主题 都影响 hast 的内容，
  // 不重渲染的话预览区会一直显示旧结果（改完设置看不到任何变化）。
  //
  // 依赖用**原始值**而非对象：s.typography / s.tocPlaceholder 是对象，
  // 每次 set() 都会换新引用，直接放进依赖会形成「重渲染 → set → 换引用 → 再重渲染」
  // 的死循环。这里把它们压成字符串再比较。
  const typographyKey = JSON.stringify(s.typography);
  const tocKey = JSON.stringify(s.tocPlaceholder);
  useEffect(() => {
    docs.rerenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.autoNumber, tocKey, typographyKey, s.theme, s.locale]);

  // 同步文档到知识库（防抖，供搜索/反链/图谱使用）
  useEffect(() => {
    const timer = window.setTimeout(() => vault.syncFromDocs(), 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.docs, docs.activeId]);

  // 自动保存：只写回属于当前知识库的笔记（id 即相对路径）。
  // 打开/拖入的外部文档携带绝对路径，不能交给 VaultStore（会被拼成 root\绝对路径），
  // 它们通过 Ctrl+S / 状态栏保存走 FsBackend 写回原文件。
  useEffect(() => {
    if (!vault.persisted) return;
    const store = currentVaultStore();
    if (!store) return;
    const noteIds = new Set(vault.notes.map((n) => n.id));
    const dirty = Object.values(docs.docs).filter((d) => d.dirty && noteIds.has(d.id));
    if (dirty.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const d of dirty) {
        const path = d.path ?? d.id;
        void saveNote(store, path, d.content).then(() => {
          docs.markSaved(d.id, path);
          maybeSnapshot(path, d.name, d.content);
          maybeRecipes(path, d.name, d.content);
        });
      }
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.docs, docs.activeId, vault.persisted]);

  // 滚动同步：编辑器/预览就绪后挂载，文档切换时重建索引
  useEffect(() => {
    const view = editorViewRef.current;
    const el = previewRef.current;
    if (!view || !el || !activeId) return;
    const sync = new ScrollSync(view, el);
    sync.attach();
    const timer = window.setTimeout(() => sync.buildIndex(), 60);
    syncRef.current = sync;
    return () => {
      window.clearTimeout(timer);
      sync.detach();
      syncRef.current = null;
    };
  }, [activeId]);

  // 说明：这里不再在 hast 变化时主动 buildIndex()。预览 DOM 一旦变化，
  // ScrollSync 内部的 MutationObserver 会把索引标记为脏，并在真正需要同步时重建；
  // 逐次 hast 更新都重建（数百次 getBoundingClientRect）会持续抢占主线程。

  // Focus / Reading：Esc 退出并恢复 chrome（抽屉打开时不抢 Esc）
  useEffect(() => {
    if (!s.focusMode && !s.readingMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (useUi.getState().activePanel) return;
      if (useUi.getState().paletteOpen) return;
      if (s.focusMode) s.toggleFocus();
      if (s.readingMode) s.toggleReadingMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.focusMode, s.readingMode, s]);

  // 保存当前文档：快捷键与状态栏共用同一条路径（含快照与 on-save recipes）。
  // 用 getState 读取，避免把整份 store 挂进依赖导致回调频繁重建。
  const saveActive = useCallback(() => {
    const st = useDocuments.getState();
    const doc = st.activeId ? st.docs[st.activeId] : null;
    if (!doc) return;
    const snapPath = doc.path ?? doc.name;
    const afterSave = (path: string) => {
      if (useSettings.getState().autoSnapshot) {
        void createSnapshot(idbSnapshotFs, path, doc.content)
          .then(() => {
            runMatchedRecipes('on-commit', { path, name: doc.name, content: doc.content });
          })
          .catch(() => {
            /* IndexedDB 不可用时静默跳过 */
          });
      }
      runMatchedRecipes('on-save', { path, name: doc.name, content: doc.content });
    };
    const toWeb = () => {
      void getFsBackend()
        .saveFile(doc.path ?? null, doc.name, doc.content)
        .then((n) => {
          st.markSaved(doc.id, n);
          afterSave(n);
        });
    };
    // 只有「知识库内的笔记」才交给 VaultStore（相对路径）；
    // 打开/拖入的外部文档携带绝对路径，必须走 FsBackend 写回原文件。
    const vaultState = useVault.getState();
    const isVaultNote = vaultState.persisted && vaultState.notes.some((n) => n.id === doc.id);
    if (!isVaultNote) {
      toWeb();
      return;
    }
    void vaultState.saveActiveToStore(doc.id, doc.content).then((ok) => {
      if (!ok) {
        toWeb();
        return;
      }
      afterSave(snapPath);
    });
  }, []);

  // 快捷键
  const shortcutHandlers = useMemo(
    () => ({
      save: saveActive,
      focusMode: () => s.toggleFocus(),
      typewriterMode: () => s.toggleTypewriter(),
      commandPalette: () => togglePalette(),
      newTab: () => {
        if (vault.persisted) void vault.createNote();
        else docs.newDoc();
      },
      closeTab: () => activeId && docs.closeDoc(activeId),
      // Ctrl+Shift+W：在四档书写宽度间循环（与设置面板的宽度选项同源）
      width: () => {
        const st = useSettings.getState();
        const next = WIDTH_ORDER[(WIDTH_ORDER.indexOf(st.width) + 1) % WIDTH_ORDER.length]!;
        st.setWidth(next);
        toast(`${t(st.locale, 'width')} · ${t(st.locale, WIDTH_LABEL_KEY[next])}`);
      },
      // Ctrl+Shift+C：选区（无选区则取开头一小段）生成分享卡片 PNG
      shareCard: () => {
        const st = useDocuments.getState();
        const doc = st.activeId ? st.docs[st.activeId] : null;
        if (!doc) return;
        const view = editorViewRef.current;
        const sel = view
          ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
          : '';
        // 与工具栏「分享卡片」同一条路径与同一兜底策略
        void exportShareCard(sel || doc.content.slice(0, 200), doc.name);
      },
    }),
    [active, activeId, docs, s, vault, togglePalette, saveActive]
  );
  useShortcuts(shortcutHandlers);

  if (shareMode) {
    return (
      <ShareView
        onExit={() => {
          location.hash = '';
          setShareMode(false);
        }}
      />
    );
  }

  const chromeSlim = s.focusMode || s.readingMode;

  return (
    <div
      className={`app-shell ${sideOpen ? 'side-open' : ''} ${
        sideCollapsed ? 'side-collapsed' : ''
      } view-${s.mobileView}${
        s.readingMode ? ' reading-mode' : ''
      }${chromeSlim ? ' chrome-slim' : ''}${s.focusMode ? ' focus-mode' : ''}`}
    >
      <Toolbar
        editorView={editorViewRef.current}
        onSlides={() => setSlidesOpen(true)}
        onOpenFolder={() => {
          void vault.openFolder();
        }}
        folderActive={vault.persisted}
      />

      <div className="app-body" ref={bodyRef}>
        <div className="side-overlay" onClick={() => setSideOpen(false)} />
        <SideRail
          toc={active?.toc ?? []}
          editorView={editorViewRef.current}
          previewEl={previewRef.current}
        />

        {/* 桌面端左栏未折叠时，左栏右缘显示拖拽分隔条 + 边缘 chevron 收起按钮 */}
        {typeof window !== 'undefined' &&
          !window.matchMedia('(max-width: 1024px)').matches &&
          !sideCollapsed && (
            <>
              <div
                className="panel-divider panel-divider-side"
                role="separator"
                aria-orientation="vertical"
                aria-label={t(s.locale, 'sideResizeHint')}
                title={t(s.locale, 'sideResizeHint')}
                onPointerDown={onSideDividerDown}
                onDoubleClick={onSideDividerDouble}
              >
                <Icon name="dragHandle" size={12} />
              </div>
              <button
                type="button"
                className="panel-edge-btn panel-edge-btn-left"
                title={t(s.locale, 'collapseLeft')}
                aria-label={t(s.locale, 'collapseLeft')}
                onClick={() => useUi.getState().toggleSideCollapsed()}
              >
                <Icon name="chevronLeft" size={14} />
              </button>
            </>
          )}

        {/* 左栏折叠时，主区左缘显示「展左栏」按钮（位置仍贴近主区） */}
        {sideCollapsed && (
          <button
            type="button"
            className="panel-edge-btn panel-edge-btn-left panel-edge-btn-restored"
            title={t(s.locale, 'expandLeft')}
            aria-label={t(s.locale, 'expandLeft')}
            onClick={() => useUi.getState().toggleSideCollapsed()}
          >
            <Icon name="chevronRight" size={14} />
          </button>
        )}

        <div className="app-main" ref={mainRef}>
          <div className="tabs" ref={tabsRef}>
            {docs.order.map((id) => {
              const d = docs.docs[id];
              if (!d) return null;
              return (
                <div
                  key={id}
                  className={`tab ${!activePanel && id === activeId ? 'active' : ''}`}
                  onClick={() => {
                    showDocument();
                    docs.setActive(id);
                  }}
                  title={d.name}
                >
                  {d.dirty && <span className="tab-dot">●</span>}
                  {renamingId === id ? (
                    <input
                      className="tab-rename"
                      value={renameValue}
                      autoFocus
                      aria-label={t(s.locale, 'renameNote')}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') void commitRename(id);
                        else if (e.key === 'Escape') {
                          setRenamingId(null);
                          setRenameValue('');
                        }
                      }}
                      onBlur={() => void commitRename(id)}
                    />
                  ) : (
                    <span
                      className="tab-name"
                      title={`${d.name} · ${t(s.locale, 'renameNote')}`}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(id);
                        setRenameValue(d.name);
                      }}
                    >
                      {d.name}
                    </span>
                  )}
                  <span
                    className="tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      docs.closeDoc(id);
                    }}
                    aria-label={t(s.locale, 'close')}
                  >
                    <Icon name="close" size={13} />
                  </span>
                </div>
              );
            })}

            {panelTabs.map((pid) => {
              const meta = PANEL_META[pid];
              const label = t(s.locale, meta.labelKey);
              return (
                <div
                  key={pid}
                  className={`tab panel-tab ${activePanel === pid ? 'active' : ''}`}
                  onClick={() => setActivePanel(pid)}
                  title={label}
                >
                  <Icon name={meta.icon} size={13} />
                  <span className="tab-name">{label}</span>
                  <span
                    className="tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closePanelTab(pid);
                    }}
                    aria-label={t(s.locale, 'close')}
                  >
                    <Icon name="close" size={13} />
                  </span>
                </div>
              );
            })}
          </div>

          <div className="app-work">
          {activePanel ? (
            <PanelView id={activePanel} onClose={() => closePanelTab(activePanel)} />
          ) : (
            <>
          <div className="app-editor">
            {active ? (
              <CodeMirrorEditor
                docId={active.id}
                content={active.content}
                onChange={(c) => docs.updateContent(active.id, c)}
                editorRef={editorViewRef}
                onReady={setEditorView}
              />
            ) : (
              <div className="zone-empty hero">
                <span className="zone-empty-title">{t(s.locale, 'emptyTitle')}</span>
                <span className="zone-empty-hint">{t(s.locale, 'emptyHint')}</span>
                <div className="empty-actions">
                  <button type="button" className="tb-btn active" onClick={() => docs.newDoc()}>
                    <Icon name="new" size={16} />
                    <span className="tb-label">{t(s.locale, 'new')}</span>
                  </button>
                  <button
                    type="button"
                    className="tb-btn"
                    onClick={() => {
                      void vault.openFolder();
                    }}
                  >
                    <Icon name="open" size={16} />
                    <span className="tb-label">{t(s.locale, 'folder')}</span>
                  </button>
                  <button
                    type="button"
                    className="tb-btn"
                    onClick={() => useUi.getState().openPalette()}
                  >
                    <Icon name="search" size={16} />
                    <span className="tb-label">{t(s.locale, 'commandPalette')}</span>
                  </button>
                </div>
                <span className="zone-empty-hint">
                  {t(s.locale, 'emptyKbdHint').replace(
                    '{key}',
                    shortcutLabel('commandPalette')
                  )}
                </span>
              </div>
            )}
            <SelectionBubble view={editorViewRef.current} />
          </div>
          {s.mobileView === 'split' && (
            <div
              className={`pane-divider ${splitDragging ? 'dragging' : ''}`}
              role="separator"
              aria-orientation={window.innerWidth <= 768 ? 'horizontal' : 'vertical'}
              title={t(s.locale, 'viewSplit')}
              onPointerDown={onDividerPointerDown}
            />
          )}
          <div className="app-preview" ref={previewRef}>
            <PreviewBoundary>
              {active ? (
                <MarkdownPreview
                  hast={active.hast}
                  onOpenWiki={onOpenWiki}
                  onPersistBoard={onPersistBoard}
                  onEditHeading={onEditHeading}
                />
              ) : (
                /* 无文档时不再沿用「渲染中…」占位，避免看起来像卡死 */
                <div className="zone-empty">
                  <span className="zone-empty-hint">{t(s.locale, 'emptyHint')}</span>
                </div>
              )}
            </PreviewBoundary>
          </div>

            </>
          )}
          </div>
        </div>

        {agentOpen && (
          /* 桌面端右栏展开时：先放分隔条，再放右栏（顺序决定视觉上分隔条在右栏左缘） */
          <>
            {typeof window !== 'undefined' &&
              !window.matchMedia('(max-width: 1024px)').matches && (
                <div
                  className="panel-divider panel-divider-rail"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t(s.locale, 'railResizeHint')}
                  title={t(s.locale, 'railResizeHint')}
                  onPointerDown={onRailDividerDown}
                  onDoubleClick={onRailDividerDouble}
                >
                  <Icon name="dragHandle" size={12} />
                </div>
              )}
            <aside className="app-rail" aria-label={t(s.locale, 'agent')}>
              <AgentChat onClose={() => setAgentOpen(false)} />
            </aside>
            {typeof window !== 'undefined' &&
              !window.matchMedia('(max-width: 1024px)').matches && (
                <button
                  type="button"
                  className="panel-edge-btn panel-edge-btn-right"
                  title={t(s.locale, 'collapseRight')}
                  aria-label={t(s.locale, 'collapseRight')}
                  onClick={() => useUi.getState().setAgentOpen(false)}
                >
                  <Icon name="chevronRight" size={14} />
                </button>
              )}
          </>
        )}

        {/* 右栏关闭时：主区右缘显示「展右栏」按钮 */}
        {!agentOpen && (
          <button
            type="button"
            className="panel-edge-btn panel-edge-btn-right panel-edge-btn-restored"
            title={t(s.locale, 'expandRight')}
            aria-label={t(s.locale, 'expandRight')}
            onClick={() => useUi.getState().setAgentOpen(true)}
          >
            <Icon name="chevronLeft" size={14} />
          </button>
        )}
      </div>

      <StatusBar editorView={editorView} persisted={vault.persisted} onSave={saveActive} />

      <CommandPalette onSlides={() => setSlidesOpen(true)} />
      {slidesOpen && active && (
        <SlideShow
          content={active.content}
          title={active.name}
          onClose={() => setSlidesOpen(false)}
          onOpenWiki={(name) => vault.openByName(name)}
        />
      )}
      {dropActive && (
        <div className="drop-overlay" role="status" aria-live="polite">
          <div className="drop-overlay-card">{t(s.locale, 'dropToOpen')}</div>
        </div>
      )}
      <ToastHost />
    </div>
  );
}
