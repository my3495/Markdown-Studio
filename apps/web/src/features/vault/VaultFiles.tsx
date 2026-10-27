import { useVault } from '../../stores/vault';
import { useDocuments } from '../../stores/document';
import { useSettings } from '../../stores/settings';
import { FileTree } from './FileTree';
import { SavedViews } from './SavedViews';
import { t } from '../../i18n';
import { toast } from '../../stores/toast';

/** 侧栏 · 文件：文件树 / 过滤视图 / 搜索 / 笔记列表 */
export function VaultFiles() {
  const {
    notes,
    query,
    results,
    setQuery,
    openByName,
    openByPath,
    persisted,
    createNote,
    deleteNote,
    renameNote,
    openFolder,
  } = useVault();
  const docs = useDocuments();
  const { locale } = useSettings();
  const activeId = docs.activeId;

  return (
    <div className="side-section vault-panel">
      {persisted ? (
        <FileTree
          notes={notes}
          activeId={activeId}
          onOpen={openByPath}
          onNew={() => {
            void createNote();
          }}
          onDelete={(path) => {
            if (window.confirm(t(locale, 'fileTreeDeleteConfirm').replace('{path}', path)))
              void deleteNote(path);
          }}
          onRename={(path, name) => {
            void renameNote(path, name).then((ok) => {
              if (!ok) toast(t(locale, 'renameFailed'), { tone: 'danger' });
            });
          }}
          onCopyPath={(path) => {
            void navigator.clipboard
              .writeText(path)
              .then(() => toast(t(locale, 'pathCopied'), { tone: 'info' }))
              .catch(() => toast(t(locale, 'pathCopyFailed'), { tone: 'danger' }));
          }}
        />
      ) : (
        /* 参考 SoloMD：空态收敛到侧栏内的一处 CTA，替代顶部通栏引导 */
        <div className="vault-empty-hero">
          <span className="vault-empty-title">{t(locale, 'openFolderTitle')}</span>
          <p className="vault-empty-desc">{t(locale, 'openFolderDesc')}</p>
          <button type="button" className="vault-empty-cta" onClick={() => void openFolder()}>
            {t(locale, 'openFolderCta')}
          </button>
        </div>
      )}

      {/* 参考 SoloMD：未绑定文件夹时不展示过滤视图，避免空库上堆叠无效控件 */}
      {persisted && (
        <SavedViews
          notes={notes}
          locale={locale}
          persisted={persisted}
          onOpen={(idOrName) => (persisted ? openByPath(idOrName) : openByName(idOrName))}
        />
      )}

      <input
        className="vault-search"
        type="search"
        placeholder={t(locale, 'searchNotes')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {query.trim() && (
        <div className="vault-results">
          {results.length === 0 && <div className="vault-empty">{t(locale, 'viewEmpty')}</div>}
          {results.map((r) => (
            <div
              key={r.note.id}
              className="vault-result"
              onClick={() => (persisted ? openByPath(r.note.id) : openByName(r.note.name))}
            >
              <span className="vault-result-name">{r.note.name}</span>
              <span className="vault-result-meta">
                <span className={`vault-via ${r.via}`}>
                  {r.via === 'semantic' ? t(locale, 'viaSemantic') : t(locale, 'viaKeyword')}
                </span>
                {r.score.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      {!persisted && (
        <>
          <h5>
            {t(locale, 'allNotes')} ({notes.length})
          </h5>
          {notes.map((n) => (
            <div
              key={n.id}
              className={`outline-item ${n.id === activeId ? 'active' : ''}`}
              onClick={() => openByName(n.name)}
            >
              {n.name}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
