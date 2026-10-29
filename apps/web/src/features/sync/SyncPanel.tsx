import { useState } from 'react';
import {
  mergeSyncNotes,
  pullEncryptedVault,
  pullFromGitHost,
  pushEncryptedVault,
  pushToGitHost,
  type GitProviderId,
  type HostRequest,
  type PackAlgo,
  type SyncNote,
} from '@md-studio/core';
import { useVault } from '../../stores/vault';
import { useDocuments } from '../../stores/document';
import { useSettings } from '../../stores/settings';
import { t } from '../../i18n';
import { flushEditor } from '../editor/flush';

const CFG_KEY = 'md-studio-sync-cfg';

type Provider = 'http' | GitProviderId;

const GIT_PROVIDERS: GitProviderId[] = ['github', 'gitlab', 'gitee'];

function isGitProvider(p: Provider): p is GitProviderId {
  return (GIT_PROVIDERS as string[]).includes(p);
}

function loadCfg() {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY) ?? '{}') as {
      provider?: Provider;
      url?: string;
      token?: string;
      repo?: string;
      branch?: string;
      algo?: PackAlgo;
    };
  } catch {
    return {};
  }
}

/** A3：加密库推送到 HTTP 端点 / GitHub / GitLab / Gitee，拉取后按 updatedAt 合并 */
export function SyncPanel() {
  const { notes, vault, refreshNotes, syncFromDocs } = useVault();
  const docs = useDocuments();
  const { locale } = useSettings();
  const saved = loadCfg();
  const [provider, setProvider] = useState<Provider>(saved.provider ?? 'http');
  const [url, setUrl] = useState(saved.url ?? '');
  const [token, setToken] = useState(saved.token ?? '');
  const [repo, setRepo] = useState(saved.repo ?? '');
  const [branch, setBranch] = useState(saved.branch ?? 'main');
  const [algo, setAlgo] = useState<PackAlgo>(saved.algo ?? 'XChaCha20-Poly1305');
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const persistCfg = () => {
    localStorage.setItem(
      CFG_KEY,
      JSON.stringify({ provider, url, token, repo, branch, algo })
    );
  };

  const httpFetch = async (
    u: string,
    init: { method: string; headers: Record<string, string>; body?: string }
  ) => {
    const res = await fetch(u, init as RequestInit);
    return { ok: res.ok, status: res.status, text: () => res.text() };
  };

  const gitFetch = async (req: HostRequest) => {
    const res = await fetch(req.url, req.init as RequestInit);
    return { ok: res.ok, status: res.status, text: () => res.text() };
  };

  const toNotes = (): SyncNote[] => {
    // 推送前把打开中的文档写回 vault，避免漏掉未关标签的改动。
    // 必须先 flush 编辑器：否则最后 150ms 内输入的字还在防抖里，推上去的是旧正文。
    flushEditor();
    syncFromDocs();
    return useVault.getState().notes.map((n) => ({
      id: n.id,
      name: n.name,
      content: n.content,
      updatedAt: n.updatedAt ?? Date.now(),
    }));
  };

  const applyBundle = (remoteNotes: SyncNote[]) => {
    const local = notes.map((n) => ({
      id: n.id,
      name: n.name,
      content: n.content,
      updatedAt: n.updatedAt ?? 0,
    }));
    const merged = mergeSyncNotes(local, remoteNotes);
    for (const n of merged) {
      vault.upsert({
        id: n.id,
        name: n.name,
        content: n.content,
        updatedAt: n.updatedAt,
      });
      if (docs.docs[n.id] && docs.docs[n.id]!.content !== n.content) {
        void docs.updateContent(n.id, n.content);
      }
    }
    refreshNotes();
    return merged.length;
  };

  const push = async () => {
    setBusy(true);
    setMsg(null);
    persistCfg();
    try {
      if (isGitProvider(provider)) {
        await pushToGitHost(
          {
            provider,
            token,
            repo,
            branch: branch || 'main',
            passphrase: pass,
            algo,
          },
          toNotes(),
          gitFetch
        );
      } else {
        await pushEncryptedVault(
          { url, token: token || undefined, passphrase: pass },
          toNotes(),
          httpFetch
        );
      }
      setMsg(t(locale, 'syncPushed'));
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pull = async () => {
    setBusy(true);
    setMsg(null);
    persistCfg();
    // 先用 flush 落定本地输入：远程内容会直接写进 store，
    // 未 flush 的话编辑器随后会把旧文本推回来覆盖掉刚拉下来的内容。
    flushEditor();
    try {
      if (isGitProvider(provider)) {
        const bundle = await pullFromGitHost(
          {
            provider,
            token,
            repo,
            branch: branch || 'main',
            passphrase: pass,
            algo,
          },
          gitFetch
        );
        if (!bundle) {
          setMsg(t(locale, 'syncRemoteEmpty'));
          return;
        }
        setMsg(t(locale, 'syncPulled').replace('{n}', String(applyBundle(bundle.notes))));
        return;
      }
      const remote = await pullEncryptedVault(
        { url, token: token || undefined, passphrase: pass },
        httpFetch
      );
      setMsg(t(locale, 'syncPulled').replace('{n}', String(applyBundle(remote.notes))));
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  const ready =
    !!pass && (isGitProvider(provider) ? !!repo && !!token : !!url);

  return (
    <div className="panel-pane">
      <div className="panel-body">
          <p className="vault-empty" style={{ marginBottom: 12 }}>
            {t(locale, 'syncHint')}
          </p>
          <div className="ui-field">
            <span>{t(locale, 'syncProvider')}</span>
            <select
              className="ui-input"
              style={{ width: '100%' }}
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
            >
              <option value="http">{t(locale, 'syncProviderHttp')}</option>
              <option value="github">{t(locale, 'syncProviderGithub')}</option>
              <option value="gitlab">{t(locale, 'syncProviderGitlab')}</option>
              <option value="gitee">{t(locale, 'syncProviderGitee')}</option>
            </select>
          </div>
          {isGitProvider(provider) ? (
            <>
              <div className="ui-field">
                <span>{t(locale, 'syncRepo')}</span>
                <input
                  className="ui-input"
                  style={{ width: '100%' }}
                  placeholder="owner/repo"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                />
              </div>
              <div className="ui-field">
                <span>{t(locale, 'syncBranch')}</span>
                <input
                  className="ui-input"
                  style={{ width: '100%' }}
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>
              <div className="ui-field">
                <span>{t(locale, 'syncAlgo')}</span>
                <select
                  className="ui-input"
                  style={{ width: '100%' }}
                  value={algo}
                  onChange={(e) => setAlgo(e.target.value as PackAlgo)}
                >
                  <option value="XChaCha20-Poly1305">{t(locale, 'syncAlgoXchacha')}</option>
                  <option value="AES-GCM">{t(locale, 'syncAlgoAes')}</option>
                </select>
              </div>
              <p className="vault-empty" style={{ marginBottom: 12, fontSize: 12 }}>
                {t(locale, 'syncRemoteHint')}
              </p>
            </>
          ) : (
            <div className="ui-field">
              <span>URL</span>
              <input
                className="ui-input"
                style={{ width: '100%' }}
                placeholder="https://…/vault.mdstudio.json"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          )}
          <div className="ui-field">
            <span>Token</span>
            <input
              className="ui-input"
              style={{ width: '100%' }}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div className="ui-field">
            <span>{t(locale, 'cryptoPass')}</span>
            <input
              className="ui-input"
              style={{ width: '100%' }}
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </div>
          <div className="agent-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="ui-btn"
              disabled={busy || !ready}
              onClick={() => void push()}
            >
              {t(locale, 'syncPush')}
            </button>
            <button
              type="button"
              className="ui-btn"
              disabled={busy || !ready}
              onClick={() => void pull()}
            >
              {t(locale, 'syncPull')}
            </button>
          </div>
          {msg && <div className="vault-empty" style={{ marginTop: 12 }}>{msg}</div>}
        </div>
      </div>
  );
}
