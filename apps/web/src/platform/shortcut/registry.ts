import { useEffect } from 'react';

/** 逻辑键 → 物理键（方案 10.3） */
export type CommandId =
  | 'save'
  | 'newTab'
  | 'closeTab'
  | 'focusMode'
  | 'typewriterMode'
  | 'width'
  | 'shareCard'
  | 'pastePlain'
  | 'pasteMarkdown'
  | 'commandPalette';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function shortcutLabel(cmd: CommandId): string {
  const M: Record<CommandId, [string, string]> = {
    save: ['Ctrl+S', '⌘S'],
    newTab: ['Ctrl+N', '⌘N'],
    closeTab: ['Ctrl+W', '⌘W'],
    focusMode: ['Ctrl+Shift+F', '⌘⇧F'],
    typewriterMode: ['Ctrl+Shift+T', '⌘⇧T'],
    width: ['Ctrl+Shift+W', '⌘⇧W'],
    shareCard: ['Ctrl+Shift+C', '⌘⇧C'],
    pastePlain: ['Ctrl+Shift+V', '⌘⇧V'],
    pasteMarkdown: ['Ctrl+Alt+V', '⌘⌥V'],
    commandPalette: ['Ctrl+K', '⌘K'],
  };
  return M[cmd][isMac ? 1 : 0];
}

interface Handlers {
  [key: string]: () => void;
}

function eventToId(e: KeyboardEvent): CommandId | null {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod) return null;
  const shift = e.shiftKey;
  const alt = e.altKey;
  const key = e.key.toLowerCase();
  if (key === 'k' && !shift && !alt) return 'commandPalette';
  if (key === 's' && !shift && !alt) return 'save';
  if (key === 'n' && !shift && !alt) return 'newTab';
  if (key === 'w' && !shift && !alt) return 'closeTab';
  if (key === 'f' && shift && !alt) return 'focusMode';
  if (key === 't' && shift && !alt) return 'typewriterMode';
  if (key === 'w' && shift && !alt) return 'width'; // 与 closeTab 冲突时以平台区分，这里聚焦 width
  if (key === 'c' && shift && !alt) return 'shareCard';
  if (key === 'v' && shift && !alt) return 'pastePlain';
  if (key === 'v' && !shift && alt) return 'pasteMarkdown';
  return null;
}

/** 注册全局快捷键（逻辑键映射，一份声明三平台） */
export function useShortcuts(handlers: Handlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = eventToId(e);
      if (id && handlers[id]) {
        e.preventDefault();
        handlers[id]!();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}
