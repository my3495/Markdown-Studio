import { describe, it, expect } from 'vitest';
import {
  b64DecodeText,
  b64EncodeText,
  DEFAULT_GIT_PATH,
  githubGetRequest,
  githubPutRequest,
  giteeGetRequest,
  giteePutRequest,
  gitlabGetRequest,
  gitlabPutRequest,
  pullFromGitHost,
  pushToGitHost,
  type GitHostConfig,
  type GitSyncConfig,
  type HostFetch,
  type HostRequest,
} from '../src/sync/providers';
import { mergeSyncNotes, type SyncNote } from '../src/sync/remote';

const BASE: GitHostConfig = {
  provider: 'github',
  token: 'tok-123',
  repo: 'octo/notes',
};

function res(ok: boolean, status: number, body: string) {
  return { ok, status, text: async () => body };
}

/** 内存远端：记录请求，按路径返回内容 */
function memoryRemote(initial?: string) {
  const store = new Map<string, string>();
  if (initial) store.set('file', initial);
  const requests: HostRequest[] = [];
  const fetchImpl: HostFetch = async (req) => {
    requests.push(req);
    const url = new URL(req.url);
    if (req.init.method === 'GET') {
      const hit = store.get('file');
      if (hit === undefined) return res(false, 404, 'not found');
      if (
        req.init.headers.Accept === 'application/vnd.github+json' ||
        url.pathname.includes('/api/v5/')
      ) {
        return res(true, 200, JSON.stringify({ content: b64EncodeText(hit), sha: 'sha-1' }));
      }
      return res(true, 200, hit);
    }
    // PUT/POST
    const body = JSON.parse(req.init.body ?? '{}') as Record<string, string>;
    store.set('file', b64DecodeText(body.content ?? ''));
    return res(true, 200, '{}');
  };
  return { fetchImpl, requests, store };
}

describe('base64 文本编解码', () => {
  it('往返含中文与特殊字符', () => {
    const s = '中文 test {"a":1}\n\ttab';
    expect(b64DecodeText(b64EncodeText(s))).toBe(s);
  });
});

describe('请求构造', () => {
  it('GitHub GET/PUT URL 与鉴权头', () => {
    const g = githubGetRequest({ ...BASE, branch: 'master', path: 'a b/vault.json' });
    expect(g.url).toBe('https://api.github.com/repos/octo/notes/contents/a%20b/vault.json?ref=master');
    expect(g.init.headers.Authorization).toBe('Bearer tok-123');
    const p = githubPutRequest(BASE, 'hello');
    expect(p.init.method).toBe('PUT');
    const body = JSON.parse(p.init.body!);
    expect(body.branch).toBe('main');
    expect(body.content).toBe(b64EncodeText('hello'));
    expect(body.sha).toBeUndefined();
    const p2 = githubPutRequest(BASE, 'hello', 'sha-9');
    expect(JSON.parse(p2.init.body!).sha).toBe('sha-9');
  });

  it('GitLab 使用 PRIVATE-TOKEN 与 URL 编码项目路径', () => {
    const cfg: GitHostConfig = {
      provider: 'gitlab',
      token: 'gl-tok',
      repo: 'group/sub/proj',
      branch: 'dev',
    };
    const g = gitlabGetRequest(cfg);
    expect(g.init.headers['PRIVATE-TOKEN']).toBe('gl-tok');
    expect(g.url).toContain('/api/v4/projects/group%2Fsub%2Fproj/repository/files/');
    expect(g.url).toContain('/raw?ref=dev');
    const put = gitlabPutRequest(cfg, 'x', 'update');
    expect(put.init.method).toBe('PUT');
    expect(JSON.parse(put.init.body!).encoding).toBe('base64');
    expect(gitlabPutRequest(cfg, 'x', 'create').init.method).toBe('POST');
  });

  it('Gitee GET/PUT 与 access_token', () => {
    const cfg: GitHostConfig = { provider: 'gitee', token: 'gt', repo: 'o/r', path: 'x/y.json' };
    const g = giteeGetRequest(cfg);
    expect(g.url).toContain('https://gitee.com/api/v5/repos/o/r/contents/x/y.json');
    const put = giteePutRequest(cfg, 'x');
    expect(put.init.method).toBe('POST');
    expect(JSON.parse(put.init.body!).access_token).toBe('gt');
    expect(giteePutRequest(cfg, 'x', 'sha-2').init.method).toBe('PUT');
  });

  it('自托管 baseUrl 生效', () => {
    const cfg: GitHostConfig = {
      provider: 'gitlab',
      token: 't',
      repo: 'o/r',
      baseUrl: 'https://git.example.com/',
    };
    expect(gitlabGetRequest(cfg).url.startsWith('https://git.example.com/api/v4')).toBe(true);
  });

  it('默认路径', () => {
    expect(DEFAULT_GIT_PATH).toBe('.md-studio/vault.mdstudio.json');
    // 路径逐段编码，段间 / 保留（GitHub Contents API 规范行为）
    expect(githubGetRequest(BASE).url).toContain('.md-studio/vault.mdstudio.json');
  });
});

describe('push/pull 流程', () => {
  const notes: SyncNote[] = [
    { id: 'a', name: 'a.md', content: '# A', updatedAt: 100 },
    { id: 'b', name: 'b.md', content: '# B\n中文', updatedAt: 200 },
  ];
  const cfg: GitSyncConfig = { ...BASE, passphrase: 'pw-12345', algo: 'XChaCha20-Poly1305' };

  it('远端为空：pull 返回 null，push 创建', async () => {
    const remote = memoryRemote();
    await expect(pullFromGitHost(cfg, remote.fetchImpl)).resolves.toBeNull();
    await pushToGitHost(cfg, notes, remote.fetchImpl);
    const put = remote.requests.filter((r) => r.init.method !== 'GET').at(-1)!;
    expect(put.init.method).toBe('PUT'); // GitHub 统一 PUT
    const stored = remote.store.get('file')!;
    const pack = JSON.parse(stored);
    expect(pack.algo).toBe('XChaCha20-Poly1305');
    expect(pack.tag).toBeTruthy();
  });

  it('push → pull 往返', async () => {
    const remote = memoryRemote();
    await pushToGitHost(cfg, notes, remote.fetchImpl);
    const bundle = await pullFromGitHost(cfg, remote.fetchImpl);
    expect(bundle).not.toBeNull();
    expect(bundle!.notes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(bundle!.notes[1]!.content).toBe('# B\n中文');
  });

  it('二次 push 带 sha（更新而非创建）', async () => {
    const remote = memoryRemote();
    await pushToGitHost(cfg, notes, remote.fetchImpl);
    await pushToGitHost(cfg, notes, remote.fetchImpl);
    const puts = remote.requests.filter((r) => r.init.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(JSON.parse(puts[0]!.init.body!).sha).toBeUndefined();
    expect(JSON.parse(puts[1]!.init.body!).sha).toBe('sha-1');
  });

  it('错误口令拉取失败（fail-closed）', async () => {
    const remote = memoryRemote();
    await pushToGitHost(cfg, notes, remote.fetchImpl);
    await expect(pullFromGitHost({ ...cfg, passphrase: 'wrong' }, remote.fetchImpl)).rejects.toThrow();
  });

  it('远端非加密包报错', async () => {
    const remote = memoryRemote(JSON.stringify({ v: 1, notes: [] }));
    await expect(pullFromGitHost(cfg, remote.fetchImpl)).rejects.toThrow();
  });

  it('GitLab create→update 方法切换', async () => {
    const glCfg: GitSyncConfig = {
      provider: 'gitlab',
      token: 't',
      repo: 'o/r',
      passphrase: 'pw-12345',
    };
    const remote = memoryRemote();
    await pushToGitHost(glCfg, notes, remote.fetchImpl);
    await pushToGitHost(glCfg, notes, remote.fetchImpl);
    const writes = remote.requests.filter((r) => r.init.method !== 'GET');
    expect(writes[0]!.init.method).toBe('POST');
    expect(writes[1]!.init.method).toBe('PUT');
    const bundle = await pullFromGitHost(glCfg, remote.fetchImpl);
    expect(bundle!.notes).toHaveLength(2);
  });

  it('参数缺失报错', async () => {
    const remote = memoryRemote();
    await expect(pushToGitHost({ ...cfg, repo: '' }, notes, remote.fetchImpl)).rejects.toThrow();
    await expect(pullFromGitHost({ ...cfg, passphrase: '' }, remote.fetchImpl)).rejects.toThrow();
  });
});

describe('合并逻辑（与 Git 远端配合）', () => {
  it('updatedAt 较大者胜出', () => {
    const local: SyncNote[] = [
      { id: 'a', name: 'a.md', content: 'local', updatedAt: 100 },
      { id: 'b', name: 'b.md', content: 'local-b', updatedAt: 50 },
    ];
    const remoteNotes: SyncNote[] = [
      { id: 'a', name: 'a.md', content: 'remote', updatedAt: 200 },
      { id: 'c', name: 'c.md', content: 'remote-c', updatedAt: 1 },
    ];
    const merged = mergeSyncNotes(local, remoteNotes);
    const byId = Object.fromEntries(merged.map((n) => [n.id, n.content]));
    expect(byId).toEqual({ a: 'remote', b: 'local-b', c: 'remote-c' });
  });
});
