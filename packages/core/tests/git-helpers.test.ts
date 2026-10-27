import { describe, it, expect } from 'vitest';
import { buildAgentBranchHint, buildGitCommitHint, MD_STUDIO_GITIGNORE } from '../src/git/helpers';

describe('git helpers', () => {
  it('commit hint', () => {
    const h = buildGitCommitHint('test msg', ['notes/a.md']);
    expect(h.commands.some((c) => c.includes('git add'))).toBe(true);
    expect(h.script).toContain('git commit');
    expect(h.gitignore).toContain('.md-studio/');
  });

  it('agent branch', () => {
    const cmds = buildAgentBranchHint('agent/x');
    expect(cmds[0]).toContain('agent/x');
    expect(MD_STUDIO_GITIGNORE).toContain('node_modules');
  });
});
