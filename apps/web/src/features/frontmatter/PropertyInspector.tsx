import { useEffect, useMemo, useState } from 'react';
import {
  BUILTIN_NOTE_TYPES,
  getNoteType,
  listPairs,
  missingTypeFields,
  parseFrontmatter,
  removeFrontmatterField,
  serializeFrontmatter,
  setFrontmatterField,
} from '@md-studio/core';
import { useDocuments } from '../../stores/document';
import { useSettings } from '../../stores/settings';
import { t } from '../../i18n';

/** 属性检查器：可视化编辑 YAML frontmatter，尽量保留注释与引号 */
export function PropertyInspector() {
  const docs = useDocuments();
  const locale = useSettings((st) => st.locale);
  const activeId = docs.activeId;
  const active = activeId ? docs.docs[activeId] : null;
  const [draftKey, setDraftKey] = useState('');
  const [draftVal, setDraftVal] = useState('');

  // 依赖写成 `active?.content` 而不是 `active`：文档对象每次 set 都会换新引用，
  // 用它当依赖会让解析在无关字段变化时重跑。函数体只读 content，语义上更精确。
  const parsed = useMemo(
    () => (active ? parseFrontmatter(active.content) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active?.content, activeId]
  );
  const pairs = parsed ? listPairs(parsed) : [];
  const noteType = active ? getNoteType(active.content) : null;
  const missing = active ? missingTypeFields(active.content) : [];

  useEffect(() => {
    setDraftKey('');
    setDraftVal('');
  }, [activeId]);

  if (!active || !parsed) {
    return (
      <div className="side-section prop-inspector">
        <h4>{t(locale, 'properties')}</h4>
        <div className="vault-empty">{t(locale, 'propNoDoc')}</div>
      </div>
    );
  }

  const apply = (next: ReturnType<typeof parseFrontmatter>) => {
    const text = serializeFrontmatter(next);
    void docs.updateContent(active.id, text);
  };

  return (
    <div className="side-section prop-inspector">
      <h4>{t(locale, 'properties')}</h4>
      {!parsed.present && pairs.length === 0 && (
        <div className="vault-empty">{t(locale, 'propEmpty')}</div>
      )}

      <div className="prop-type-row">
        <span className="prop-key">type</span>
        <select
          className="ui-select prop-val"
          value={noteType?.id ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) apply(removeFrontmatterField(parsed, 'type'));
            else apply(setFrontmatterField(parsed, 'type', v));
          }}
        >
          <option value="">{t(locale, 'propNoType')}</option>
          {BUILTIN_NOTE_TYPES.map((nt) => (
            <option key={nt.id} value={nt.id}>
              {t(locale, nt.labelKey ?? nt.id)}
            </option>
          ))}
        </select>
      </div>

      {noteType && (
        <div className="prop-type-hint">
          {t(locale, 'propTypePrefix')}
          {t(locale, noteType.labelKey ?? noteType.id)}
          {missing.length > 0 && (
            <div className="prop-suggest">
              {missing.map((f) => {
                const label = t(locale, f.labelKey ?? f.key);
                return (
                  <button
                    key={f.key}
                    type="button"
                    className="view-chip"
                    title={t(locale, 'propAddField').replace('{label}', label)}
                    onClick={() => apply(setFrontmatterField(parsed, f.key, ''))}
                  >
                    + {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="prop-list">
        {pairs
          .filter((f) => f.key !== 'type')
          .map((f) => (
            <div key={f.key} className="prop-row">
              <span className="prop-key" title={f.key}>
                {f.key}
              </span>
              <input
                className="ui-input prop-val"
                value={f.value}
                onChange={(e) => apply(setFrontmatterField(parsed, f.key, e.target.value))}
              />
              <button
                type="button"
                className="file-tree-btn"
                title={t(locale, 'deleteNote')}
                onClick={() => apply(removeFrontmatterField(parsed, f.key))}
              >
                −
              </button>
            </div>
          ))}
      </div>
      <div className="prop-add">
        <input
          className="ui-input"
          placeholder={t(locale, 'propKey')}
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
        />
        <input
          className="ui-input"
          placeholder={t(locale, 'propValue')}
          value={draftVal}
          onChange={(e) => setDraftVal(e.target.value)}
        />
        <button
          type="button"
          className="file-tree-btn"
          title={t(locale, 'propAdd')}
          disabled={!draftKey.trim()}
          onClick={() => {
            const k = draftKey.trim();
            if (!k) return;
            apply(setFrontmatterField(parsed, k, draftVal));
            setDraftKey('');
            setDraftVal('');
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
