/**
 * 本机分享快照存储（IndexedDB）+ URL hash 路由。
 */

import type { ShareSnapshot } from '@md-studio/core';

const DB_NAME = 'md-studio-share';
const STORE = 'snaps';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveShare(snap: ShareSnapshot): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snap);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadShare(id: string): Promise<ShareSnapshot | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as ShareSnapshot) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** `#share/<id>` 或 `#share/p/<payload>` */
export function parseShareHash(hash = location.hash): { id?: string; payload?: string } | null {
  const h = hash.replace(/^#/, '');
  const m = /^share\/(?:p\/([^/]+)|([^/]+))$/.exec(h);
  if (!m) return null;
  if (m[1]) return { payload: m[1] };
  return { id: m[2] };
}

export function shareUrlForId(id: string): string {
  const base = `${location.origin}${location.pathname}${location.search}`;
  return `${base}#share/${id}`;
}

export function shareUrlForPayload(payload: string): string {
  const base = `${location.origin}${location.pathname}${location.search}`;
  return `${base}#share/p/${payload}`;
}
