import { create } from 'zustand';
import {
  Vault,
  createEmbedder,
  loadVault,
  saveNote,
  removeNote,
  renameNote as renameNoteInStore,
  normalizeNoteName,
  dirname,
  basename,
  type NoteGraph,
  type VaultNote,
  type VaultSearchResult,
  type VaultStore,
  type EmbedConfig,
} from '@md-studio/core';
import { useDocuments } from './document';
import { useSettings } from './settings';
import { t } from '../i18n';
import {
  pickVaultDirectory,
  restoreVaultDirectory,
  currentVaultStore,
  vaultPickerAvailable,
  setDefaultVaultBackend,
} from '../platform/vault/registry';
import { fsAccessBackend } from '../platform/vault/fsAccess';

setDefaultVaultBackend(fsAccessBackend);

/** 演示种子：构成一个小的互联知识库，便于立即体验双链/反链/图谱/搜索 */
const SEED: VaultNote[] = [
  {
    id: 'demo-guide',
    name: '使用指南.md',
    content:
      '# 使用指南\n\n欢迎使用 Markdown Studio 知识库。参见 [[双链与反链]]、[[知识图谱]] 与 [[全文搜索]]。\n',
  },
  {
    id: 'demo-links',
    name: '双链与反链.md',
    content:
      '# 双链与反链\n\n用 `[[笔记名]]` 建立双链，反链会自动出现在侧栏。回到 [[使用指南]]。\n',
  },
  {
    id: 'demo-graph',
    name: '知识图谱.md',
    content: '# 知识图谱\n\n基于 [[双链与反链]] 自动生成关系图，参考 [[使用指南]]。\n',
  },
  {
    id: 'demo-search',
    name: '全文搜索.md',
    content: '# 全文搜索\n\n支持中英文分词与相关性排序，见 [[使用指南]]。\n',
  },
];

function browserEmbedFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) {
  return fetch(url, init).then(async (res) => ({
    ok: res.ok,
    status: res.status,
    json: () => res.json(),
    text: () => res.text(),
  }));
}

function resolveEmbedder() {
  const s = useSettings.getState();
  const { useRemoteEmbed, embedModel, embedBaseUrl, provider, apiKey, model } = s.agent;
  if (!useRemoteEmbed) return createEmbedder();
  const cfg: EmbedConfig = {
    provider,
    apiKey,
    model: embedModel || model,
    baseUrl: embedBaseUrl || undefined,
  };
  return createEmbedder(cfg, browserEmbedFetch);
}

interface VaultState {
  vault: Vault;
  notes: VaultNote[];
  graph: NoteGraph;
  query: string;
  results: VaultSearchResult[];
  /** 是否已连接本地文件夹（持久化） */
  persisted: boolean;
  syncFromDocs: () => void;
  /** 仅从内存 Vault 刷新 notes/graph（不覆盖内容） */
  refreshNotes: () => void;
  setQuery: (q: string) => void;
  openByName: (name: string) => void;
  openByPath: (path: string) => void;
  /** 选择本地文件夹并载入为知识库 */
  openFolder: () => Promise<'ok' | 'unavailable' | 'cancelled'>;
  /** 尝试恢复上次会话的文件夹 */
  restoreFolder: () => Promise<boolean>;
  /** 按设置刷新嵌入器（D2） */
  applyEmbedder: () => void;
  createNote: (name?: string) => Promise<string | null>;
  deleteNote: (path: string) => Promise<boolean>;
  /** 重命名笔记（同步重命名磁盘文件并迁移笔记 id）；返回是否成功 */
  renameNote: (path: string, name: string) => Promise<boolean>;
  saveActiveToStore: (id: string, content: string) => Promise<boolean>;
}

function derive(vault: Vault, query: string) {
  return {
    notes: vault.list(),
    graph: vault.noteGraph(),
    results: query.trim() ? vault.search(query) : ([] as VaultSearchResult[]),
  };
}

async function bindStore(vault: Vault, store: VaultStore, set: (p: Partial<VaultState>) => void, get: () => VaultState) {
  vault.clear();
  const { files } = await loadVault(vault, store);
  // 清空编辑器演示标签，打开第一篇真实笔记
  const docs = useDocuments.getState();
  for (const id of [...docs.order]) docs.closeDoc(id);
  if (files.length > 0) {
    const first = files[0];
    docs.openDoc({
      id: first.path,
      name: basename(first.path),
      path: first.path,
      content: first.content,
    });
  }
  set({ persisted: true, ...derive(vault, get().query) });
}

export const useVault = create<VaultState>((set, get) => {
  const vault = new Vault(resolveEmbedder());
  for (const n of SEED) vault.upsert(n);
  const boot = derive(vault, '');

  return {
    vault,
    query: '',
    ...boot,
    persisted: false,

    syncFromDocs: () => {
      // 持久化模式下以磁盘路径为准，避免把临时标签污染库
      if (get().persisted) {
        const docs = useDocuments.getState().docs;
        for (const d of Object.values(docs)) {
          const path = d.path ?? (/\.mdx?$/i.test(d.id) ? d.id : null);
          if (!path) continue;
          vault.upsert({ id: path, name: basename(path), content: d.content });
        }
        set(derive(vault, get().query));
        return;
      }
      const docs = useDocuments.getState().docs;
      for (const d of Object.values(docs)) {
        vault.upsert({ id: d.id, name: d.name, content: d.content });
      }
      set(derive(vault, get().query));
    },

    refreshNotes: () => {
      set(derive(get().vault, get().query));
    },

    setQuery: (q) => {
      const kw = q.trim() ? vault.search(q) : [];
      set({ query: q, results: kw });
      if (q.trim()) {
        void vault.searchHybrid(q).then((hyb) => {
          if (get().query === q) set({ results: hyb });
        });
      }
    },

    openByName: (name) => {
      const id = get().vault.resolveName(name);
      const docs = useDocuments.getState();
      if (id && docs.docs[id]) {
        docs.setActive(id);
        return;
      }
      if (id) {
        const n = get().vault.get(id)!;
        const path = get().persisted ? id : null;
        docs.openDoc({ id, name: n.name, path, content: n.content });
        return;
      }
      const nid = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const fileName = /\.md$/i.test(name) ? name : `${name}.md`;
      docs.openDoc({ id: nid, name: fileName, path: null, content: `# ${name}\n\n` });
    },

    openByPath: (path) => {
      const n = get().vault.get(path);
      const docs = useDocuments.getState();
      if (!n) return;
      if (docs.docs[path]) {
        docs.setActive(path);
        return;
      }
      docs.openDoc({
        id: path,
        name: n.name,
        path: get().persisted ? path : null,
        content: n.content,
      });
    },

    openFolder: async () => {
      if (!vaultPickerAvailable()) return 'unavailable' as const;
      const store = await pickVaultDirectory();
      if (!store) return 'cancelled' as const;
      await bindStore(get().vault, store, set, get);
      get().applyEmbedder();
      return 'ok' as const;
    },

    restoreFolder: async () => {
      if (!vaultPickerAvailable()) return false;
      const store = await restoreVaultDirectory();
      if (!store) return false;
      await bindStore(get().vault, store, set, get);
      get().applyEmbedder();
      return true;
    },

    applyEmbedder: () => {
      const next = resolveEmbedder();
      get().vault.setEmbedder(next);
      set(derive(get().vault, get().query));
    },

    createNote: async (name) => {
      const store = currentVaultStore();
      if (!get().persisted || !store) return null;
      const fileName = name && name.trim()
        ? (/\.mdx?$/i.test(name) ? name.trim() : `${name.trim()}.md`)
        : `${t(useSettings.getState().locale, 'untitled')}-${Date.now().toString(36)}.md`;
      const content = `# ${basename(fileName).replace(/\.mdx?$/i, '')}\n\n`;
      await saveNote(store, fileName, content);
      get().vault.upsert({ id: fileName, name: basename(fileName), content });
      useDocuments.getState().openDoc({
        id: fileName,
        name: basename(fileName),
        path: fileName,
        content,
      });
      set(derive(get().vault, get().query));
      return fileName;
    },

    deleteNote: async (path) => {
      const store = currentVaultStore();
      if (!get().persisted || !store) return false;
      await removeNote(store, path);
      get().vault.remove(path);
      const docs = useDocuments.getState();
      if (docs.docs[path]) docs.closeDoc(path);
      set(derive(get().vault, get().query));
      return true;
    },

    renameNote: async (path, name) => {
      const store = currentVaultStore();
      if (!get().persisted || !store) return false;
      const nextName = normalizeNoteName(name);
      if (!nextName) return false;
      const dir = dirname(path);
      const to = dir ? `${dir}/${nextName}` : nextName;
      if (to === path) return true;
      if (get().vault.get(to)) return false; // 目标名已存在
      const docs = useDocuments.getState();
      const content = docs.docs[path]?.content ?? get().vault.get(path)?.content ?? '';
      await renameNoteInStore(store, path, to);
      get().vault.remove(path);
      get().vault.upsert({ id: to, name: basename(to), content });
      docs.renameDoc(path, basename(to), to);
      set(derive(get().vault, get().query));
      return true;
    },

    saveActiveToStore: async (id, content) => {
      const store = currentVaultStore();
      if (!get().persisted || !store) return false;
      const path = /\.mdx?$/i.test(id) ? id : null;
      if (!path) return false;
      await saveNote(store, path, content);
      get().vault.upsert({ id: path, name: basename(path), content });
      useDocuments.getState().markSaved(id, path);
      set(derive(get().vault, get().query));
      return true;
    },
  };
});
