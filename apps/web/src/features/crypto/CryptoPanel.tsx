import { useState } from 'react';
import {
  decryptNotePack,
  encryptNotePack,
  isEncryptedPack,
  type EncryptedPack,
} from '@md-studio/core';
import { useDocuments } from '../../stores/document';
import { useSettings } from '../../stores/settings';
import { t } from '../../i18n';

/** A3-lite：口令加密导出 / 解密导入 */
export function CryptoPanel() {
  const docs = useDocuments();
  const { locale } = useSettings();
  const active = docs.activeId ? docs.docs[docs.activeId] : null;
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const exportEnc = async () => {
    if (!active || !pass) return;
    setBusy(true);
    setMsg(null);
    try {
      const pack = await encryptNotePack(active.name, active.content, pass);
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${active.name.replace(/\.mdx?$/i, '')}.mdstudio.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(t(locale, 'cryptoExported'));
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  const importEnc = async (file: File) => {
    if (!pass) {
      setMsg(t(locale, 'cryptoNeedPass'));
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      const obj = JSON.parse(text) as EncryptedPack;
      if (!isEncryptedPack(obj)) throw new Error('invalid pack');
      const { title, content } = await decryptNotePack(obj, pass);
      docs.openDoc({ id: `enc-${Date.now()}`, name: title, path: null, content });
      setMsg(t(locale, 'cryptoImported'));
    } catch {
      setMsg(t(locale, 'cryptoDecryptFail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-pane">
      <div className="panel-body">
          <p className="vault-empty" style={{ marginBottom: 12 }}>
            {t(locale, 'cryptoHint')}
          </p>
          <div className="ui-field">
            <span>{t(locale, 'cryptoPass')}</span>
            <input
              className="ui-input"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="agent-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="ui-btn"
              disabled={!active || !pass || busy}
              onClick={() => void exportEnc()}
            >
              {t(locale, 'cryptoExport')}
            </button>
            <label className="ui-btn" style={{ cursor: 'pointer' }}>
              {t(locale, 'cryptoImport')}
              <input
                type="file"
                accept="application/json,.json"
                hidden
                disabled={!pass || busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importEnc(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {msg && <div className="vault-empty" style={{ marginTop: 12 }}>{msg}</div>}
        </div>
      </div>
  );
}
