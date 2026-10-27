import { useMemo, useState } from 'react';
import {
  filterNotes,
  INBOX_VIEW,
  type SavedView,
  type VaultNote,
} from '@md-studio/core';
import { t, type Locale } from '../../i18n';

const STORAGE_KEY = 'md-studio-saved-views';

function loadCustomViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedView[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCustomViews(views: SavedView[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
}

interface Props {
  notes: VaultNote[];
  locale: Locale;
  persisted: boolean;
  onOpen: (idOrName: string) => void;
}

export function SavedViews({ notes, locale, persisted, onOpen }: Props) {
  const [custom, setCustom] = useState<SavedView[]>(() => loadCustomViews());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftField, setDraftField] = useState('status');
  const [draftValue, setDraftValue] = useState('inbox');

  const views = useMemo(() => [INBOX_VIEW, ...custom], [custom]);
  const active = views.find((v) => v.id === activeId) ?? null;
  const matched = useMemo(
    () => (active ? filterNotes(notes, active) : []),
    [notes, active]
  );

  const addView = () => {
    const name = draftName.trim() || `${draftField}=${draftValue}`;
    const view: SavedView = {
      id: `view-${Date.now()}`,
      name,
      rules: [{ field: draftField.trim() || 'status', op: 'eq', value: draftValue.trim() }],
    };
    const next = [...custom, view];
    setCustom(next);
    saveCustomViews(next);
    setActiveId(view.id);
    setDraftName('');
  };

  const removeView = (id: string) => {
    const next = custom.filter((v) => v.id !== id);
    setCustom(next);
    saveCustomViews(next);
    if (activeId === id) setActiveId(null);
  };

  return (
    <div className="saved-views">
      <h5>{t(locale, 'savedViews')}</h5>
      <div className="saved-views-chips">
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`view-chip ${activeId === v.id ? 'active' : ''}`}
            onClick={() => setActiveId(activeId === v.id ? null : v.id)}
          >
            {v.id === 'inbox' ? t(locale, 'inbox') : v.name}
            {v.id !== 'inbox' && (
              <span
                className="view-chip-x"
                onClick={(e) => {
                  e.stopPropagation();
                  removeView(v.id);
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="saved-views-add">
        <input
          className="ui-input"
          placeholder={t(locale, 'viewName')}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
        />
        <input
          className="ui-input"
          placeholder="field"
          value={draftField}
          onChange={(e) => setDraftField(e.target.value)}
          style={{ maxWidth: 72 }}
        />
        <input
          className="ui-input"
          placeholder="value"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          style={{ maxWidth: 80 }}
        />
        <button type="button" className="ui-btn" onClick={addView}>
          +
        </button>
      </div>

      {active && (
        <div className="vault-results">
          {matched.length === 0 && (
            <div className="vault-empty">{t(locale, 'viewEmpty')}</div>
          )}
          {matched.map((n) => (
            <div
              key={n.id}
              className="vault-result"
              onClick={() => onOpen(persisted ? n.id : n.name)}
            >
              <span className="vault-result-name">{n.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
