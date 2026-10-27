/**
 * A3-lite 远程同步脚手架：将多笔记打包为加密包后 PUT/GET。
 * 远端只需支持 HTTP 读写（任意对象存储 / 自建 API）；协议 fail-closed。
 */

import {
  decryptNotePack,
  encryptNotePack,
  isEncryptedPack,
  type EncryptedPack,
  type PackAlgo,
} from '../crypto/vaultPack';

export interface SyncNote {
  id: string;
  name: string;
  content: string;
  updatedAt?: number;
}

export interface SyncBundle {
  v: 1;
  notes: SyncNote[];
  exportedAt: number;
}

export interface SyncRemoteConfig {
  /** 如 https://example.com/vault/main.mdstudio.json */
  url: string;
  /** 可选 Bearer token */
  token?: string;
  /** 加密口令（必填） */
  passphrase: string;
}

export type SyncFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export function packSyncBundle(notes: SyncNote[]): SyncBundle {
  return { v: 1, notes, exportedAt: Date.now() };
}

export function unpackSyncBundle(raw: unknown): SyncBundle {
  const b = raw as SyncBundle;
  if (!b || b.v !== 1 || !Array.isArray(b.notes)) throw new Error('invalid sync bundle');
  return b;
}

/** 加密整个库快照（默认 AES-GCM；可传 XChaCha20-Poly1305） */
export async function encryptSyncBundle(
  bundle: SyncBundle,
  passphrase: string,
  algo: PackAlgo = 'AES-GCM'
): Promise<EncryptedPack> {
  return encryptNotePack('vault-sync.json', JSON.stringify(bundle), passphrase, algo);
}

export async function decryptSyncBundle(
  pack: EncryptedPack,
  passphrase: string
): Promise<SyncBundle> {
  const { content } = await decryptNotePack(pack, passphrase);
  return unpackSyncBundle(JSON.parse(content));
}

/** 简单合并：按 id，updatedAt 较大者胜出；无时间戳则远端覆盖本地 */
export function mergeSyncNotes(local: SyncNote[], remote: SyncNote[]): SyncNote[] {
  const map = new Map<string, SyncNote>();
  for (const n of local) map.set(n.id, n);
  for (const r of remote) {
    const cur = map.get(r.id);
    if (!cur) {
      map.set(r.id, r);
      continue;
    }
    const lt = cur.updatedAt ?? 0;
    const rt = r.updatedAt ?? 0;
    if (rt >= lt) map.set(r.id, r);
  }
  return [...map.values()];
}

export async function pushEncryptedVault(
  cfg: SyncRemoteConfig,
  notes: SyncNote[],
  fetchImpl: SyncFetchLike
): Promise<void> {
  if (!cfg.url || !cfg.passphrase) throw new Error('url and passphrase required');
  const pack = await encryptSyncBundle(packSyncBundle(notes), cfg.passphrase);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  const res = await fetchImpl(cfg.url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(pack),
  });
  if (!res.ok) throw new Error(`push failed: HTTP ${res.status}`);
}

export async function pullEncryptedVault(
  cfg: SyncRemoteConfig,
  fetchImpl: SyncFetchLike
): Promise<SyncBundle> {
  if (!cfg.url || !cfg.passphrase) throw new Error('url and passphrase required');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  const res = await fetchImpl(cfg.url, { method: 'GET', headers });
  if (!res.ok) throw new Error(`pull failed: HTTP ${res.status}`);
  const pack = JSON.parse(await res.text()) as EncryptedPack;
  if (!isEncryptedPack(pack)) throw new Error('remote payload is not encrypted pack');
  return decryptSyncBundle(pack, cfg.passphrase);
}
