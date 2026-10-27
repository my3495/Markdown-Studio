/**
 * IndexedDB 版 SnapshotFs：⌘S / 自动保存时写入本地历史（A2-lite AutoGit）。
 */

import type { SnapshotFs } from '@md-studio/core';

const DB_NAME = 'md-studio-history';
const STORE = 'files';
const DIR_STORE = 'dirs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(DIR_STORE)) db.createObjectStore(DIR_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  store: string,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const idbSnapshotFs: SnapshotFs = {
  async mkdirp(dir: string) {
    await withStore('readwrite', DIR_STORE, (s) => s.put(true, dir));
  },
  async writeTextFile(path: string, content: string) {
    await withStore('readwrite', STORE, (s) => s.put(content, path));
  },
  async readTextFile(path: string) {
    const v = await withStore<string | undefined>('readonly', STORE, (s) => s.get(path));
    if (v === undefined) throw new Error(`missing ${path}`);
    return v;
  },
  async readDir(dir: string) {
    const db = await openDb();
    try {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      const keys = await new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAllKeys();
        req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
        req.onerror = () => reject(req.error);
      });
      const names = new Set<string>();
      for (const k of keys) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name) names.add(name);
      }
      return [...names];
    } finally {
      db.close();
    }
  },
  async remove(path: string) {
    await withStore('readwrite', STORE, (s) => s.delete(path));
  },
};
