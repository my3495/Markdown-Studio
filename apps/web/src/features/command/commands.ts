import type { IconName } from '../../components/Icon';
import type { Locale } from '../../i18n';
import { t } from '../../i18n';
import { useDocuments } from '../../stores/document';
import { useSettings } from '../../stores/settings';
import { useUi, type PanelId, type SideTab } from '../../stores/ui';
import { useVault } from '../../stores/vault';

export type CommandGroup = 'action' | 'nav' | 'note';

export interface CommandItem {
  id: string;
  label: string;
  keywords: string;
  group: CommandGroup;
  icon: IconName;
  hint?: string;
  run: () => void;
}

export interface BuildCommandsOpts {
  locale: Locale;
  onSlides?: () => void;
}

function openSide(tab: SideTab) {
  const ui = useUi.getState();
  ui.setSideTab(tab);
  ui.setSideOpen(true);
  ui.closePalette();
}

function openPanel(id: PanelId) {
  useUi.getState().openPanel(id);
}

/** 组装命令面板条目（动作 + 导航 + 笔记） */
export function buildCommands(opts: BuildCommandsOpts): CommandItem[] {
  const { locale, onSlides } = opts;
  const docs = useDocuments.getState();
  const vault = useVault.getState();
  const s = useSettings.getState();
  const items: CommandItem[] = [];

  const action = (
    id: string,
    labelKey: string,
    icon: IconName,
    run: () => void,
    extraKw = '',
    hint?: string
  ): CommandItem => ({
    id,
    label: t(locale, labelKey),
    keywords: `${t(locale, labelKey)} ${extraKw}`.toLowerCase(),
    group: 'action',
    icon,
    hint,
    run: () => {
      run();
      useUi.getState().closePalette();
    },
  });

  items.push(
    action('new', 'new', 'new', () => {
      if (vault.persisted) void vault.createNote();
      else docs.newDoc();
    }),
    action('folder', 'folder', 'open', () => {
      void vault.openFolder();
    }, 'vault knowledge'),
    action('focus', 'focus', 'focus', () => s.toggleFocus()),
    action('typewriter', 'typewriter', 'typewriter', () => s.toggleTypewriter()),
    action('reading', 'readingMode', 'preview', () => s.toggleReadingMode()),
    action('settings', 'settings', 'settings', () => openPanel('settings')),
    action('agent', 'agent', 'agent', () => useUi.getState().setAgentOpen(true)),
    action('graph', 'graph', 'graph', () => openPanel('graph'), 'graph 图谱 relations'),
    action('history', 'history', 'history', () => openPanel('history')),
    action('crypto', 'cryptoTitle', 'crypto', () => openPanel('crypto')),
    action('git', 'gitTitle', 'git', () => openPanel('git')),
    action('sync', 'syncTitle', 'sync', () => openPanel('sync')),
    action(
      'theme',
      'theme',
      'theme',
      () => s.setTheme(s.theme === 'dark' ? 'light' : 'dark'),
      'dark light'
    )
  );

  if (onSlides) {
    items.push(action('slides', 'slides', 'slides', onSlides));
  }

  const nav = (id: SideTab, labelKey: string, icon: IconName): CommandItem => ({
    id: `nav-${id}`,
    label: t(locale, labelKey),
    keywords: `${t(locale, labelKey)} ${id} side`.toLowerCase(),
    group: 'nav',
    icon,
    run: () => openSide(id),
  });

  items.push(
    nav('files', 'sideFiles', 'open'),
    nav('outline', 'sideOutline', 'outline'),
    nav('props', 'sideProps', 'props')
  );

  const noteItems: CommandItem[] = [];
  for (const n of vault.notes) {
    noteItems.push({
      id: `note-${n.id}`,
      label: n.name,
      keywords: n.name.toLowerCase(),
      group: 'note',
      icon: 'edit',
      run: () => {
        if (vault.persisted) vault.openByPath(n.id);
        else vault.openByName(n.name);
        useUi.getState().closePalette();
      },
    });
  }
  for (const id of docs.order) {
    const d = docs.docs[id];
    if (!d) continue;
    if (noteItems.some((x) => x.label === d.name)) continue;
    noteItems.push({
      id: `doc-${id}`,
      label: d.name,
      keywords: d.name.toLowerCase(),
      group: 'note',
      icon: 'edit',
      run: () => {
        docs.setActive(id);
        useUi.getState().closePalette();
      },
    });
  }
  items.push(...noteItems);

  return items;
}

/**
 * 子序列模糊匹配：依次命中 q 的每个字符即算匹配，连续命中给更高权重。
 * 返回 -1 表示不匹配。
 */
function fuzzyScore(text: string, q: string): number {
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const idx = text.indexOf(ch, ti);
    if (idx === -1) return -1;
    streak = idx === ti ? streak + 1 : 0;
    score += 1 + streak;
    ti = idx + 1;
  }
  return score;
}

/** 过滤 + 按匹配度排序（标签命中优先于关键词命中） */
export function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const scored: { item: CommandItem; score: number }[] = [];
  for (const it of items) {
    const labelHit = fuzzyScore(it.label.toLowerCase(), q);
    const kwHit = fuzzyScore(it.keywords, q);
    const score = Math.max(labelHit, kwHit < 0 ? -1 : kwHit - 4);
    if (score >= 0) scored.push({ item: it, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

export function groupOrder(g: CommandGroup): number {
  if (g === 'action') return 0;
  if (g === 'nav') return 1;
  return 2;
}
