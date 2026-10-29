import { describe, expect, it, vi } from 'vitest';
import { flushEditor, registerEditorFlush } from '../flush';

describe('editor flush 注册点', () => {
  it('注册后 flushEditor 会调用句柄', () => {
    const fn = vi.fn();
    registerEditorFlush(fn);
    flushEditor();
    expect(fn).toHaveBeenCalledTimes(1);
    registerEditorFlush(null);
  });

  it('未注册 / 已注销时安全空转', () => {
    registerEditorFlush(null);
    expect(() => flushEditor()).not.toThrow();
  });

  it('句柄抛错被吞掉，不影响调用方', () => {
    registerEditorFlush(() => {
      throw new Error('editor gone');
    });
    expect(() => flushEditor()).not.toThrow();
    registerEditorFlush(null);
  });
});
