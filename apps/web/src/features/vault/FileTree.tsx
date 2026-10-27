import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { basename, type VaultNote } from '@md-studio/core';
import { useSettings } from '../../stores/settings';
import { t } from '../../i18n';
import { Icon } from '../../components/Icon';

export interface TreeNode {
  name: string;
  /** 文件节点才有相对路径 */
  path?: string;
  children?: TreeNode[];
}

/** 由笔记相对路径构建目录树 */
export function buildFileTree(notes: VaultNote[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  const ensureDir = (parts: string[]): TreeNode[] => {
    let list = root;
    let key = '';
    for (const part of parts) {
      key = key ? `${key}/${part}` : part;
      let node = dirMap.get(key);
      if (!node) {
        node = { name: part, children: [] };
        dirMap.set(key, node);
        list.push(node);
      }
      list = node.children!;
    }
    return list;
  };

  for (const n of notes) {
    const rel = (n.id.includes('/') || n.id.includes('\\') ? n.id : n.name).replace(/\\/g, '/');
    const parts = rel.split('/').filter(Boolean);
    const file = parts.pop();
    if (!file) continue;
    const siblings = parts.length ? ensureDir(parts) : root;
    if (!siblings.some((x) => x.path === rel)) {
      siblings.push({ name: file, path: rel });
    }
  }

  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      const ad = a.children ? 0 : 1;
      const bd = b.children ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.children) sortRec(n.children);
  };
  sortRec(root);
  return root;
}

/** 重命名会话：同一时刻只允许一行处于编辑态 */
interface RenameCtx {
  editingPath: string | null;
  draft: string;
  setDraft: (v: string) => void;
  commit: (path: string) => void;
  cancel: () => void;
}

function TreeRow({
  node,
  depth,
  activeId,
  onOpen,
  onContextMenu,
  rename,
}: {
  node: TreeNode;
  depth: number;
  activeId: string | null;
  onOpen: (path: string) => void;
  onContextMenu: (path: string, x: number, y: number) => void;
  rename: RenameCtx;
}) {
  const locale = useSettings((st) => st.locale);
  const [open, setOpen] = useState(true);
  const isDir = !!node.children;
  const active = !isDir && node.path === activeId;
  const editing = !isDir && rename.editingPath === node.path;

  if (isDir) {
    return (
      <div className="file-tree-branch">
        <div
          className="file-tree-row dir"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="file-tree-twist" aria-hidden="true">
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
          </span>
          <Icon
            name={open ? 'folderOpen' : 'folder'}
            size={14}
            className={`file-tree-icon${open ? ' is-open' : ''}`}
          />
          <span className="file-tree-name">{node.name}</span>
        </div>
        {open &&
          node.children!.map((c) => (
            <TreeRow
              key={c.path ?? `${node.name}/${c.name}`}
              node={c}
              depth={depth + 1}
              activeId={activeId}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              rename={rename}
            />
          ))}
      </div>
    );
  }

  const path = node.path!;
  return (
    <div
      className={`file-tree-row file ${active ? 'active' : ''}`}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => {
        if (!editing) onOpen(path);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(path, e.clientX, e.clientY);
      }}
      title={path}
    >
      <span className="file-tree-twist" aria-hidden="true" />
      <Icon name="fileText" size={14} className="file-tree-icon" />
      {editing ? (
        <input
          className="file-tree-rename"
          value={rename.draft}
          autoFocus
          aria-label={t(locale, 'renameNote')}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => rename.setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') rename.commit(path);
            else if (e.key === 'Escape') rename.cancel();
          }}
          onBlur={() => rename.commit(path)}
        />
      ) : (
        <span className="file-tree-name">{node.name}</span>
      )}
    </div>
  );
}

export function FileTree({
  notes,
  activeId,
  onOpen,
  onNew,
  onDelete,
  onRename,
  onCopyPath,
}: {
  notes: VaultNote[];
  activeId: string | null;
  onOpen: (path: string) => void;
  onNew?: () => void;
  onDelete?: (path: string) => void;
  onRename?: (path: string, name: string) => void;
  /** 复制相对路径到剪贴板（用于右键菜单） */
  onCopyPath?: (path: string) => void;
}) {
  const tree = useMemo(() => buildFileTree(notes), [notes]);
  const locale = useSettings((st) => st.locale);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('.file-tree-menu')) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const rename: RenameCtx = {
    editingPath,
    draft,
    setDraft,
    commit: (path) => {
      const value = draft;
      setEditingPath(null);
      setDraft('');
      onRename?.(path, value);
    },
    cancel: () => {
      setEditingPath(null);
      setDraft('');
    },
  };

  return (
    <div className="file-tree">
      <div className="file-tree-toolbar">
        <span className="file-tree-title">{t(locale, 'sideFiles')}</span>
        {onNew && (
          <button type="button" className="file-tree-btn" onClick={onNew} title={t(locale, 'fileTreeNewNote')}>
            +
          </button>
        )}
        {onDelete && activeId && /\.mdx?$/i.test(activeId) && (
          <button
            type="button"
            className="file-tree-btn"
            onClick={() => onDelete(activeId)}
            title={t(locale, 'fileTreeDeleteNote')}
          >
            −
          </button>
        )}
      </div>
      {tree.length === 0 ? (
        <div className="vault-empty">{t(locale, 'fileTreeEmpty')}</div>
      ) : (
        tree.map((n) => (
          <TreeRow
            key={n.path ?? n.name}
            node={n}
            depth={0}
            activeId={activeId}
            onOpen={onOpen}
            onContextMenu={(path, x, y) => setMenu({ path, x, y })}
            rename={rename}
          />
        ))
      )}
      {menu &&
        createPortal(
          <div
            className="file-tree-menu"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="file-tree-menu-item"
              role="menuitem"
              onClick={() => {
                setEditingPath(menu.path);
                setDraft(basename(menu.path));
                setMenu(null);
              }}
            >
              {t(locale, 'renameNote')}
            </button>
            <button
              type="button"
              className="file-tree-menu-item"
              role="menuitem"
              disabled={menu.path === activeId}
              onClick={() => {
                onOpen(menu.path);
                setMenu(null);
              }}
            >
              {t(locale, 'openInTab')}
            </button>
            <button
              type="button"
              className="file-tree-menu-item"
              role="menuitem"
              onClick={() => {
                const p = menu.path;
                setMenu(null);
                onCopyPath?.(p);
              }}
            >
              {t(locale, 'copyRelativePath')}
            </button>
            {onDelete && (
              <>
                <div className="file-tree-menu-sep" role="separator" />
                <button
                  type="button"
                  className="file-tree-menu-item danger"
                  role="menuitem"
                  onClick={() => {
                    const p = menu.path;
                    setMenu(null);
                    onDelete(p);
                  }}
                >
                  {t(locale, 'deleteNote')}
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
