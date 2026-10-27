import { describe, it, expect } from 'vitest';
import {
  GIT_LOG_FORMAT,
  gitStatusCommands,
  hasConflicts,
  parseGitLog,
  parseNumStat,
  parsePorcelainStatus,
  summarizeStatus,
} from '../src/git/status';
import {
  buildConflictHint,
  buildSnapshotCommands,
} from '../src/git/helpers';

const PORCELAIN = [
  'M  src/a.md',
  'MM src/b.md',
  'A  new.md',
  ' D deleted.md',
  'D  staged-del.md',
  'R  old.md -> new-name.md',
  'C  orig.md -> copy.md',
  '?? untracked.md',
  '!! ignored.log',
  'UU conflict.md',
  'AA both-added.md',
  '?? "quoted path.md"',
].join('\n');

describe('porcelain 解析', () => {
  it('XY 状态码映射', () => {
    const entries = parsePorcelainStatus(PORCELAIN);
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
    expect(byPath['src/a.md']).toMatchObject({ state: 'modified', staged: true });
    expect(byPath['src/b.md']).toMatchObject({ state: 'modified', staged: true });
    expect(byPath['new.md']).toMatchObject({ state: 'added', staged: true });
    expect(byPath['deleted.md']).toMatchObject({ state: 'deleted', staged: false });
    expect(byPath['staged-del.md']).toMatchObject({ state: 'deleted', staged: true });
    expect(byPath['new-name.md']).toMatchObject({ state: 'renamed', from: 'old.md' });
    expect(byPath['copy.md']).toMatchObject({ state: 'copied', from: 'orig.md' });
    expect(byPath['untracked.md']).toMatchObject({ state: 'untracked', staged: false });
    expect(byPath['ignored.log']).toMatchObject({ state: 'ignored' });
    expect(byPath['conflict.md']).toMatchObject({ state: 'conflicted' });
    expect(byPath['both-added.md']).toMatchObject({ state: 'conflicted' });
    expect(byPath['quoted path.md']).toMatchObject({ state: 'untracked' });
  });

  it('汇总计数与冲突清单', () => {
    const s = summarizeStatus(PORCELAIN);
    expect(s.counts.untracked).toBe(2);
    expect(s.counts.renamed).toBe(1);
    expect(s.counts.conflicted).toBe(2);
    expect(s.conflicted).toEqual(['conflict.md', 'both-added.md']);
    expect(hasConflicts(PORCELAIN)).toBe(true);
    expect(hasConflicts('M  a.md')).toBe(false);
  });

  it('空输入与脏行安全', () => {
    expect(parsePorcelainStatus('')).toEqual([]);
    expect(parsePorcelainStatus('\n\n')).toEqual([]);
  });
});

describe('numstat 解析', () => {
  it('文本与二进制', () => {
    const entries = parseNumStat(
      ['12\t3\tsrc/a.md', '0\t5\tsrc/b.md', '-\t-\timage.png', '7\t0\t"sp ace.md"'].join('\n')
    );
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({ path: 'src/a.md', insertions: 12, deletions: 3, binary: false });
    expect(entries[2]).toMatchObject({ binary: true, insertions: 0, deletions: 0 });
    expect(entries[3]!.path).toBe('sp ace.md');
  });
});

describe('log 解析', () => {
  it('记录/字段分隔', () => {
    const text = [
      'abc123\x1fAlice\x1f2026-10-16\x1ffeat: x',
      'def456\x1fBob\x1f2026-10-15\x1ffix: y\x1fwith detail',
    ].join('\x1e');
    const commits = parseGitLog(text);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: 'abc123',
      author: 'Alice',
      date: '2026-10-16',
      subject: 'feat: x',
    });
    expect(commits[1]!.subject).toBe('fix: y\x1fwith detail');
  });

  it('空输入', () => {
    expect(parseGitLog('')).toEqual([]);
  });

  it('format 常量含全字段', () => {
    expect(GIT_LOG_FORMAT).toContain('%H');
    expect(GIT_LOG_FORMAT).toContain('%s');
  });
});

describe('命令构造', () => {
  it('快照命令包含解析所需格式', () => {
    const cmds = buildSnapshotCommands(5);
    expect(cmds[3]).toContain('-n 5');
    expect(cmds[3]).toContain('--pretty=format:');
    expect(gitStatusCommands()).toHaveLength(4);
  });

  it('冲突策略命令', () => {
    expect(buildConflictHint('ours').join(' ')).toContain('checkout --ours');
    expect(buildConflictHint('theirs').join(' ')).toContain('checkout --theirs');
    expect(buildConflictHint('manual').join(' ')).toContain('diff-filter=U');
  });

  it('log 数量钳制', () => {
    expect(buildSnapshotCommands(0)[3]).toContain('-n 1');
    expect(buildSnapshotCommands(999)[3]).toContain('-n 200');
  });
});
