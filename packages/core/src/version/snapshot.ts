/**
 * 版本快照（v1.1）：ADR-22 快照存 `.md-studio/history/{filename}/`，不进版本控制。
 * 纯逻辑，依赖注入的 FS 适配器（Web: IndexedDB；桌面: Tauri）。
 */

export interface SnapshotFs {
  mkdirp(dir: string): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
  readDir(dir: string): Promise<string[]>;
  readTextFile(path: string): Promise<string>;
  remove(path: string): Promise<void>;
}

export interface SnapshotMeta {
  ts: number;
  path: string;
}

const HISTORY_DIR = '.md-studio/history';

function historyDirFor(docPath: string): string {
  const base = docPath.replace(/[\\/]+/g, '/').split('/').pop() || 'untitled.md';
  return `${HISTORY_DIR}/${base}`;
}

let snapSeq = 0;

export async function createSnapshot(
  fs: SnapshotFs,
  docPath: string,
  content: string,
  keep = 20
): Promise<SnapshotMeta> {
  const dir = historyDirFor(docPath);
  await fs.mkdirp(dir);
  const ts = Date.now();
  // 同一毫秒内多次保存需保证文件名唯一（单调递增序号）
  const name = `snap-${ts}-${(snapSeq++).toString(36)}.md`;
  const path = `${dir}/${name}`;
  await fs.writeTextFile(path, content);

  const files = (await fs.readDir(dir)).filter(
    (f) => f.startsWith('snap-') && f.endsWith('.md')
  );
  files.sort().reverse();
  for (const f of files.slice(keep)) {
    await fs.remove(`${dir}/${f}`);
  }
  return { ts, path };
}

export async function listSnapshots(
  fs: SnapshotFs,
  docPath: string
): Promise<SnapshotMeta[]> {
  const dir = historyDirFor(docPath);
  let files: string[];
  try {
    files = await fs.readDir(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.startsWith('snap-') && f.endsWith('.md'))
    .map((f) => {
      const m = /snap-(\d+)-(\w+)\.md/.exec(f);
      return {
        ts: m ? Number(m[1]) : 0,
        seq: m ? parseInt(m[2], 36) : 0,
        path: `${dir}/${f}`,
      };
    })
    .sort((a, b) => (b.ts === a.ts ? b.seq - a.seq : b.ts - a.ts));
}

export async function readSnapshot(
  fs: SnapshotFs,
  meta: SnapshotMeta
): Promise<string> {
  return fs.readTextFile(meta.path);
}
