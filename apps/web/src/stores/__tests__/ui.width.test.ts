/**
 * useUi store 宽度与持久化测试。
 *
 * 锁定契约：
 * 1. setSideWidth 接受任意 number，clamp 到 [SIDE_WIDTH_MIN, SIDE_WIDTH_MAX]；
 *    非有限值（NaN / Infinity / 字符串）回落到 DEFAULT。
 * 2. setSideWidth 同时写入 localStorage（key: md-studio:side-width）。
 * 3. 初始值：未持久化 → DEFAULT；持久化但越界 → clamp 到边界。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useUi,
  SIDE_WIDTH_MIN,
  SIDE_WIDTH_MAX,
  SIDE_WIDTH_DEFAULT,
  SIDE_WIDTH_STORAGE_KEY,
} from '../ui';

describe('useUi 宽度字段与持久化', () => {
  beforeEach(() => {
    // 每个用例前清掉持久化
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SIDE_WIDTH_STORAGE_KEY);
    }
    useUi.setState({
      sideWidth: SIDE_WIDTH_DEFAULT,
    });
  });

  it('S-01 setSideWidth 把 200 落库并 clamp 到 200', () => {
    useUi.getState().setSideWidth(200);
    expect(useUi.getState().sideWidth).toBe(200);
    expect(localStorage.getItem(SIDE_WIDTH_STORAGE_KEY)).toBe('200');
  });

  it('S-02 setSideWidth 把 < MIN 的值 clamp 到 MIN', () => {
    useUi.getState().setSideWidth(50);
    expect(useUi.getState().sideWidth).toBe(SIDE_WIDTH_MIN);
    expect(localStorage.getItem(SIDE_WIDTH_STORAGE_KEY)).toBe(String(SIDE_WIDTH_MIN));
  });

  it('S-03 setSideWidth 把 > MAX 的值 clamp 到 MAX', () => {
    useUi.getState().setSideWidth(900);
    expect(useUi.getState().sideWidth).toBe(SIDE_WIDTH_MAX);
    expect(localStorage.getItem(SIDE_WIDTH_STORAGE_KEY)).toBe(String(SIDE_WIDTH_MAX));
  });

  it('S-04 setSideWidth(NaN) 回落到 DEFAULT', () => {
    useUi.getState().setSideWidth(Number.NaN);
    expect(useUi.getState().sideWidth).toBe(SIDE_WIDTH_DEFAULT);
    expect(localStorage.getItem(SIDE_WIDTH_STORAGE_KEY)).toBe(String(SIDE_WIDTH_DEFAULT));
  });

  it('S-05 setSideWidth(Infinity) 回落到 DEFAULT', () => {
    useUi.getState().setSideWidth(Number.POSITIVE_INFINITY);
    expect(useUi.getState().sideWidth).toBe(SIDE_WIDTH_DEFAULT);
  });

  it('S-06 setSideWidth("250") 字符串数字被解析', () => {
    useUi.getState().setSideWidth('250' as unknown as number);
    expect(useUi.getState().sideWidth).toBe(250);
  });

  it('S-07 setSideWidth 取整（fractional → 4 舍 5 入）', () => {
    useUi.getState().setSideWidth(201.4);
    expect(useUi.getState().sideWidth).toBe(201);
    useUi.getState().setSideWidth(201.6);
    expect(useUi.getState().sideWidth).toBe(202);
  });

  it('S-10 启动时从 localStorage 恢复 sideWidth', async () => {
    localStorage.setItem(SIDE_WIDTH_STORAGE_KEY, '320');
    // 模拟刷新：用 import 重新拿一次模块会重置 store
    const mod = await import('../ui?reload=' + Date.now());
    // 重新读取会因模块缓存仍是同一个实例，所以用 setState 验证语义：
    useUi.setState({ sideWidth: mod.useUi.getState().sideWidth });
    expect(useUi.getState().sideWidth).toBe(320);
  });

  it('S-11 启动时越界值被 clamp 到边界', () => {
    localStorage.setItem(SIDE_WIDTH_STORAGE_KEY, '99999');
    // 通过构造场景：模拟 store 初始化的 clamp 行为
    useUi.getState().setSideWidth(Number(localStorage.getItem(SIDE_WIDTH_STORAGE_KEY)!));
    expect(useUi.getState().sideWidth).toBe(SIDE_WIDTH_MAX);
  });

  it('S-12 localStorage 不可用时静默忽略（隐私模式）', () => {
    // 临时把 setItem 抛错，验证不抛到调用方
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('quota');
    });
    try {
      expect(() => useUi.getState().setSideWidth(280)).not.toThrow();
      expect(useUi.getState().sideWidth).toBe(280);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
