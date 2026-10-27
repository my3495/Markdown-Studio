import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useUi } from '../../stores/ui';
import { useSettings } from '../../stores/settings';
import { useVault } from '../../stores/vault';
import { useDocuments } from '../../stores/document';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n';
import {
  buildCommands,
  filterCommands,
  groupOrder,
  type CommandGroup,
  type CommandItem,
} from './commands';

interface Props {
  onSlides?: () => void;
}

const GROUP_LABEL: Record<CommandGroup, string> = {
  action: 'cmdGroupAction',
  nav: 'cmdGroupNav',
  note: 'cmdGroupNote',
};

export function CommandPalette({ onSlides }: Props) {
  const open = useUi((s) => s.paletteOpen);
  const closePalette = useUi((s) => s.closePalette);
  const locale = useSettings((s) => s.locale);
  const notes = useVault((s) => s.notes);
  const docOrder = useDocuments((s) => s.order);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(
    () => buildCommands({ locale, onSlides }),
    [locale, onSlides, notes, docOrder]
  );
  const filtered = useMemo(() => {
    const list = filterCommands(all, query);
    return [...list].sort((a, b) => groupOrder(a.group) - groupOrder(b.group));
  }, [all, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const tmr = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(tmr);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const run = (item: CommandItem) => item.run();

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 10, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 10, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(filtered.length - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[active];
      if (item) run(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  };

  let lastGroup: CommandGroup | null = null;

  return (
    <div className="cmd-backdrop" onClick={closePalette}>
      <div
        className="cmd-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, 'commandPalette')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmd-input-row">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            className="cmd-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(locale, 'commandPlaceholder')}
            aria-autocomplete="list"
            aria-controls="cmd-listbox"
            aria-activedescendant={filtered[active] ? `cmd-item-${filtered[active].id}` : undefined}
          />
          <kbd className="cmd-kbd">Esc</kbd>
        </div>
        <div className="cmd-list" ref={listRef} role="listbox" id="cmd-listbox">
          {filtered.length === 0 && (
            <div className="cmd-empty">{t(locale, 'commandEmpty')}</div>
          )}
          {filtered.map((item, idx) => {
            const showHead = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {showHead && (
                  <div className="cmd-group">{t(locale, GROUP_LABEL[item.group])}</div>
                )}
                <button
                  type="button"
                  data-idx={idx}
                  id={`cmd-item-${item.id}`}
                  role="option"
                  aria-selected={idx === active}
                  className={`cmd-item ${idx === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => run(item)}
                >
                  <Icon name={item.icon} size={16} />
                  <span className="cmd-item-label">{item.label}</span>
                  {item.hint && <span className="cmd-item-hint">{item.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmd-footer">
          <span>↑↓ {t(locale, 'commandNav')}</span>
          <span>↵ {t(locale, 'commandRun')}</span>
        </div>
      </div>
    </div>
  );
}
