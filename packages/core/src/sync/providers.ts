/**
 * A3 增强：Git 代码托管同步适配器（GitHub / GitLab / Gitee）。
 *
 * 复用 sync/remote 的加密包格式（EncryptedPack）与合并逻辑；
 * 远端访问经注入的 fetch 完成（依赖注入），便于测试与 Web/桌面/CLI 三端复用。
 * 协议：GET 现有文件 → 取 sha/原文 → 加密整个库 → PUT/POST 覆盖。
 */

import { isEncryptedPack, type EncryptedPack, type PackAlgo } from '../crypto/vaultPack';
import {
  decryptSyncBundle,
  encryptSyncBundle,
  packSyncBundle,
  type SyncBundle,
  type SyncNote,
} from './remote';

export type GitProviderId = 'github' | 'gitlab' | 'gitee';

export interface GitHostConfig {
  provider: GitProviderId;
  /** 访问令牌（GitHub: PAT；GitLab/Gitee: 私有令牌） */
  token: string;
  /** owner/repo（GitLab 自托管可为 group/subgroup/project） */
  repo: string;
  /** 分支，默认 main */
  branch?: string;
  /** 库内路径，默认 .md-studio/vault.mdstudio.json */
  path?: string;
  /** 自托管 GitLab/Gitee 根地址，如 https://gitlab.example.com */
  baseUrl?: string;
}

export interface GitSyncConfig extends GitHostConfig {
  /** 加密口令（必填） */
  passphrase: string;
  /** 加密算法，默认 XChaCha20-Poly1305 */
  algo?: PackAlgo;
}

export interface HostRequest {
  url: string;
  init: { method: string; headers: Record<string, string>; body?: string };
}

export interface HostResponseLike {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

export type HostFetch = (req: HostRequest) => Promise<HostResponseLike>;

export const DEFAULT_GIT_PATH = '.md-studio/vault.mdstudio.json';

const API_BASES: Record<GitProviderId, string> = {
  github: 'https://api.github.com',
  gitlab: 'https://gitlab.com',
  gitee: 'https://gitee.com',
};

function apiBase(cfg: GitHostConfig): string {
  return (cfg.baseUrl?.replace(/\/+$/, '') || API_BASES[cfg.provider]);
}

/** 逐段编码路径（保留 /） */
function encPath(path: string): string {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

/** 最小 base64（UTF-8 安全） */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function b64EncodeText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

export function b64DecodeText(b64: string): string {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]!);
    const b = B64.indexOf(clean[i + 1]!);
    const c = B64.indexOf(clean[i + 2]!);
    const d = B64.indexOf(clean[i + 3]!);
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[o++] = ((c & 3) << 6) | d;
  }
  return new TextDecoder().decode(new Uint8Array(out));
}

function authHeaders(cfg: GitHostConfig): Record<string, string> {
  if (cfg.provider === 'gitlab') return { 'PRIVATE-TOKEN': cfg.token };
  if (cfg.provider === 'gitee') return { Authorization: `Bearer ${cfg.token}` };
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// ---------- 请求构造（导出供测试与自定义传输） ----------

/** GitHub：读取文件元信息（含 content(base64) 与 sha） */
export function githubGetRequest(cfg: GitHostConfig): HostRequest {
  const branch = cfg.branch || 'main';
  const path = encPath(cfg.path || DEFAULT_GIT_PATH);
  return {
    url: `${apiBase(cfg)}/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    init: { method: 'GET', headers: authHeaders(cfg) },
  };
}

/** GitHub：创建（无 sha）/ 更新（带 sha）文件 */
export function githubPutRequest(
  cfg: GitHostConfig,
  content: string,
  sha?: string,
  message = 'md-studio: sync vault'
): HostRequest {
  const body: Record<string, string> = {
    message,
    content: b64EncodeText(content),
    branch: cfg.branch || 'main',
  };
  if (sha) body.sha = sha;
  return {
    url: `${apiBase(cfg)}/repos/${cfg.repo}/contents/${encPath(cfg.path || DEFAULT_GIT_PATH)}`,
    init: {
      method: 'PUT',
      headers: { ...authHeaders(cfg), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  };
}

/** GitLab：读取文件原文（raw） */
export function gitlabGetRequest(cfg: GitHostConfig): HostRequest {
  const branch = cfg.branch || 'main';
  const path = encPath(cfg.path || DEFAULT_GIT_PATH);
  return {
    url: `${apiBase(cfg)}/api/v4/projects/${encodeURIComponent(cfg.repo)}/repository/files/${path}/raw?ref=${encodeURIComponent(branch)}`,
    init: { method: 'GET', headers: authHeaders(cfg) },
  };
}

/** GitLab：创建（POST）/ 更新（PUT）文件 */
export function gitlabPutRequest(
  cfg: GitHostConfig,
  content: string,
  mode: 'create' | 'update',
  message = 'md-studio: sync vault'
): HostRequest {
  const path = encPath(cfg.path || DEFAULT_GIT_PATH);
  const body = {
    branch: cfg.branch || 'main',
    content: b64EncodeText(content),
    encoding: 'base64',
    commit_message: message,
  };
  return {
    url: `${apiBase(cfg)}/api/v4/projects/${encodeURIComponent(cfg.repo)}/repository/files/${path}`,
    init: {
      method: mode === 'create' ? 'POST' : 'PUT',
      headers: { ...authHeaders(cfg), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  };
}

/** Gitee：读取文件元信息（含 content(base64) 与 sha） */
export function giteeGetRequest(cfg: GitHostConfig): HostRequest {
  const branch = cfg.branch || 'main';
  const path = encPath(cfg.path || DEFAULT_GIT_PATH);
  return {
    url: `${apiBase(cfg)}/api/v5/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    init: { method: 'GET', headers: authHeaders(cfg) },
  };
}

/** Gitee：创建（POST，无 sha）/ 更新（PUT，带 sha）文件 */
export function giteePutRequest(
  cfg: GitHostConfig,
  content: string,
  sha?: string,
  message = 'md-studio: sync vault'
): HostRequest {
  const body: Record<string, string> = {
    access_token: cfg.token,
    content: b64EncodeText(content),
    message,
    branch: cfg.branch || 'main',
  };
  if (sha) body.sha = sha;
  return {
    url: `${apiBase(cfg)}/api/v5/repos/${cfg.repo}/contents/${encPath(cfg.path || DEFAULT_GIT_PATH)}`,
    init: {
      method: sha ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  };
}

// ---------- 高层封装 ----------

/** 读取远端文件；不存在返回 null。GitHub/Gitee 返回 JSON 元信息，GitLab 返回 raw */
async function gitHostRead(
  cfg: GitHostConfig,
  fetchImpl: HostFetch
): Promise<{ sha?: string; raw: string } | null> {
  const req =
    cfg.provider === 'github'
      ? githubGetRequest(cfg)
      : cfg.provider === 'gitlab'
        ? gitlabGetRequest(cfg)
        : giteeGetRequest(cfg);
  const res = await fetchImpl(req);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${cfg.provider} read failed: HTTP ${res.status}`);
  const text = await res.text();
  if (cfg.provider === 'gitlab') return { raw: text };
  try {
    const meta = JSON.parse(text) as { content?: string; sha?: string };
    if (typeof meta.content !== 'string') throw new Error('bad payload');
    return { sha: meta.sha, raw: b64DecodeText(meta.content) };
  } catch {
    throw new Error(`${cfg.provider}: unexpected payload`);
  }
}

/** 写入远端文件（GitHub/Gitee 用 sha 更新；GitLab 按存在性切 create/update） */
async function gitHostWrite(
  cfg: GitHostConfig,
  content: string,
  existing: { sha?: string; raw: string } | null,
  fetchImpl: HostFetch
): Promise<void> {
  const exists = existing !== null;
  let req: HostRequest;
  if (cfg.provider === 'github') {
    req = githubPutRequest(cfg, content, existing?.sha);
  } else if (cfg.provider === 'gitlab') {
    req = gitlabPutRequest(cfg, content, exists ? 'update' : 'create');
  } else {
    req = giteePutRequest(cfg, content, existing?.sha);
  }
  const res = await fetchImpl(req);
  if (!res.ok) throw new Error(`${cfg.provider} write failed: HTTP ${res.status}`);
}

/** 从 Git 远端拉取并解密库；远端无文件返回 null */
export async function pullFromGitHost(
  cfg: GitSyncConfig,
  fetchImpl: HostFetch
): Promise<SyncBundle | null> {
  if (!cfg.repo || !cfg.passphrase) throw new Error('repo and passphrase required');
  const existing = await gitHostRead(cfg, fetchImpl);
  if (!existing) return null;
  const pack = JSON.parse(existing.raw) as EncryptedPack;
  if (!isEncryptedPack(pack)) throw new Error('remote payload is not encrypted pack');
  return decryptSyncBundle(pack, cfg.passphrase);
}

/** 加密本地库并推送到 Git 远端 */
export async function pushToGitHost(
  cfg: GitSyncConfig,
  notes: SyncNote[],
  fetchImpl: HostFetch
): Promise<void> {
  if (!cfg.repo || !cfg.passphrase) throw new Error('repo and passphrase required');
  const pack = await encryptSyncBundle(packSyncBundle(notes), cfg.passphrase, cfg.algo);
  const existing = await gitHostRead(cfg, fetchImpl);
  await gitHostWrite(cfg, JSON.stringify(pack), existing, fetchImpl);
}
