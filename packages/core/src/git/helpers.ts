/**
 * A2-lite Git 辅助：生成常用命令与 .gitignore（不内嵌 libgit2）。
 * 结构化解析见 ./status.ts。
 */

import { GIT_LOG_FORMAT } from './status';

export interface GitCommitHint {
  /** 建议在 vault 根目录执行的命令列表 */
  commands: string[];
  /** 可复制的一键脚本（POSIX） */
  script: string;
  gitignore: string;
}

export const MD_STUDIO_GITIGNORE = `# Markdown Studio
.md-studio/
*.mdstudio.json
.DS_Store
Thumbs.db
node_modules/
dist/
`;

/** 为一次本地「提交」生成 shell 命令（需本机 git） */
export function buildGitCommitHint(
  message = 'chore: snapshot from Markdown Studio',
  paths: string[] = ['.']
): GitCommitHint {
  const addArgs = paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ');
  const msg = message.replace(/"/g, '\\"');
  const commands = [
    'git rev-parse --is-inside-work-tree || git init',
    `git add ${addArgs}`,
    `git commit -m "${msg}"`,
  ];
  return {
    commands,
    script: commands.join(' && \\\n  '),
    gitignore: MD_STUDIO_GITIGNORE,
  };
}

/** Agent 沙箱分支建议命令 */
export function buildAgentBranchHint(branch = 'agent/sandbox'): string[] {
  const b = branch.replace(/[^A-Za-z0-9/_-]/g, '-');
  return [
    `git checkout -B ${b}`,
    'git add -A',
    `git commit -m "agent: pending changes on ${b}"`,
    'git checkout -',
    `# review then: git merge ${b}   or   git branch -D ${b}`,
  ];
}

/** 冲突解决策略 */
export type ConflictStrategy = 'ours' | 'theirs' | 'manual';

/** 冲突解决命令（按策略） */
export function buildConflictHint(strategy: ConflictStrategy = 'manual'): string[] {
  const common = ['git status --porcelain', 'git diff --name-only --diff-filter=U'];
  if (strategy === 'ours') {
    return [...common, 'git checkout --ours .', 'git add -A', 'git commit --no-edit'];
  }
  if (strategy === 'theirs') {
    return [...common, 'git checkout --theirs .', 'git add -A', 'git commit --no-edit'];
  }
  return [
    ...common,
    '# 手动解决后：git add <file> && git rebase --continue（或 git merge --continue）',
    '# 放弃：git rebase --abort / git merge --abort',
  ];
}

/** 只读快照命令（状态 + 统计 + 最近提交），供 Git 面板一键复制 */
export function buildSnapshotCommands(logCount = 10): string[] {
  const n = Math.max(1, Math.min(200, Math.floor(logCount)));
  return [
    'git rev-parse --abbrev-ref HEAD',
    'git status --porcelain',
    'git diff --numstat',
    `git log -n ${n} --date=short --pretty=format:'${GIT_LOG_FORMAT}'`,
  ];
}
