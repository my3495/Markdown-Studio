import { describe, it, expect } from 'vitest';
import { collectWorkspaces } from '../src/workspace';

describe('collectWorkspaces', () => {
  it('支持重复 --workspace', () => {
    const dirs = collectWorkspaces(['--workspace', '/a', '--workspace', '/b']);
    expect(dirs).toHaveLength(2);
  });

  it('支持逗号分隔', () => {
    const dirs = collectWorkspaces(['--workspace', '/a,/b']);
    expect(dirs.length).toBeGreaterThanOrEqual(2);
  });

  it('无参数返回空', () => {
    expect(collectWorkspaces([])).toEqual([]);
  });
});
