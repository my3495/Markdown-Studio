/**
 * A2 增强：Git 输出解析层（纯函数、零依赖）。
 *
 * 解析 `git status --porcelain` / `git diff --numstat` / `git log` 的结构化输出，
 * 供 Git 面板、桌面端（Tauri shell 接线）与 MCP 工具复用。
 * 不内嵌 libgit2；实际 git 调用由上层平台注入（依赖注入，便于测试）。
 */

export type GitFileState =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'conflicted'
  | 'unknown';

export interface GitFileEntry {
  path: string;
  /** 重命名/复制的源路径 */
  from?: string;
  state: GitFileState;
  /** 工作区状态码（X）与暂存区状态码（Y） */
  index: string;
  worktree: string;
  staged: boolean;
}

export interface GitNumStatEntry {
  path: string;
  insertions: number;
  deletions: number;
  binary: boolean;
}

export interface GitCommitEntry {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitStatusSummary {
  entries: GitFileEntry[];
  counts: Record<GitFileState, number>;
  conflicted: string[];
  branch?: string;
  ahead?: number;
  behind?: number;
}

/** XY 状态码 → 文件状态（取优先级高的冲突/重命名等） */
function codeToState(x: string, y: string): GitFileState {
  const pair = x + y;
  if (pair === '??') return 'untracked';
  if (pair === '!!') return 'ignored';
  if (/^(DD|AU|UD|UA|DU|AA|UU)/.test(pair)) return 'conflicted';
  if (x === 'R' || y === 'R') return 'renamed';
  if (x === 'C' || y === 'C') return 'copied';
  if (x === 'A' || y === 'A') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'M' || y === 'M') return 'modified';
  if (x === 'T' || y === 'T') return 'modified'; // 类型变更
  return 'unknown';
}

/**
 * 解析 `git status --porcelain`（v1）输出。
 * 支持 `XY path`、`XY orig -> path`（重命名/复制，含引号路径）。
 */
export function parsePorcelainStatus(text: string): GitFileEntry[] {
  const out: GitFileEntry[] = [];
  for (const raw of (text ?? '').split(/\r?\n/)) {
    if (!raw || raw.length < 3) continue;
    const x = raw[0]!;
    const y = raw[1]!;
    let rest = raw.slice(3);
    let from: string | undefined;
    const arrow = rest.indexOf(' -> ');
    if (arrow >= 0) {
      from = unquotePath(rest.slice(0, arrow));
      rest = rest.slice(arrow + 4);
    }
    out.push({
      path: unquotePath(rest),
      from,
      state: codeToState(x, y),
      index: x,
      worktree: y,
      staged: x !== ' ' && x !== '?',
    });
  }
  return out;
}

/** 去除 git 的引号路径包裹（含 C 风格转义的最简处理） */
function unquotePath(p: string): string {
  const t = p.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    return t
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return t;
}

/** 汇总状态（计数 + 冲突清单） */
export function summarizeStatus(text: string): GitStatusSummary {
  const entries = parsePorcelainStatus(text);
  const counts: Record<GitFileState, number> = {
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    untracked: 0,
    ignored: 0,
    conflicted: 0,
    unknown: 0,
  };
  const conflicted: string[] = [];
  for (const e of entries) {
    counts[e.state]++;
    if (e.state === 'conflicted') conflicted.push(e.path);
  }
  return { entries, counts, conflicted };
}

/**
 * 解析 `git diff --numstat` 输出：
 * `insertions\tdeletions\tpath`；二进制文件为 `-\t-\tpath`。
 */
export function parseNumStat(text: string): GitNumStatEntry[] {
  const out: GitNumStatEntry[] = [];
  for (const raw of (text ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const parts = raw.split('\t');
    if (parts.length < 3) continue;
    const [ins, del, ...pathParts] = parts;
    const path = unquotePath(pathParts.join('\t'));
    const binary = ins === '-' || del === '-';
    out.push({
      path,
      insertions: binary ? 0 : Number(ins) || 0,
      deletions: binary ? 0 : Number(del) || 0,
      binary,
    });
  }
  return out;
}

/**
 * 解析 `git log` 输出（需以 `--pretty=format:%H%x1f%an%x1f%ad%x1f%s` 传入，
 * 记录间用 \x1e 分隔）。字段缺失时安全回落。
 */
export function parseGitLog(text: string, recordSep = '\x1e', fieldSep = '\x1f'): GitCommitEntry[] {
  const out: GitCommitEntry[] = [];
  for (const rec of (text ?? '').split(recordSep)) {
    if (!rec.trim()) continue;
    const [hash, author, date, ...subjectParts] = rec.trim().split(fieldSep);
    if (!hash) continue;
    out.push({
      hash: hash.trim(),
      author: (author ?? '').trim(),
      date: (date ?? '').trim(),
      subject: subjectParts.join(fieldSep).trim(),
    });
  }
  return out;
}

/** 便捷：git log 的推荐 format 字符串 */
export const GIT_LOG_FORMAT = '%H%x1f%an%x1f%ad%x1f%s';

/** 便捷：取结构化状态所需的命令序列（含分支跟踪信息） */
export function gitStatusCommands(): string[] {
  return [
    'git rev-parse --abbrev-ref HEAD',
    'git status --porcelain',
    'git diff --numstat',
    'git log -n 20 --date=short',
  ];
}

/** 是否存在冲突（供 UI 警示） */
export function hasConflicts(text: string): boolean {
  return parsePorcelainStatus(text).some((e) => e.state === 'conflicted');
}
