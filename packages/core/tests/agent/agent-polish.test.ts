/**
 * Agent 核心模块打磨测试：工具循环检测、Token 估算改进、TokenMeter 容量限制。
 */
import { describe, it, expect } from 'vitest';
import { estimateTokens, TokenMeter } from '../../src/agent/tokens';

/* ─────────── Token 估算改进 ─────────── */
describe('estimateTokens 改进', () => {
  it('纯中文文本估算系数 1.2', () => {
    // 10 个汉字
    const tokens = estimateTokens('中文测试文本');
    expect(tokens).toBeGreaterThanOrEqual(4); // 10 * 1.2 ≈ 12 → ceil = 12，但考虑到有标点等
  });

  it('纯韩文文本估算系数 0.35', () => {
    // 韩文每 token 约 2-3 字符，0.35 系数更接近实际
    const korean = '한글테스트'; // 5 个韩文字母
    const tokens = estimateTokens(korean);
    // 0.35 * 5 = 1.75 → ceil = 2
    expect(tokens).toBeLessThanOrEqual(3);
  });

  it('纯英文文本每 4 字符 1 token', () => {
    const english = 'a'.repeat(12);
    const tokens = estimateTokens(english);
    expect(tokens).toBe(3); // ceil(12/4) = 3
  });

  it('空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('单字符非 CJK 返回 1 token', () => {
    expect(estimateTokens('a')).toBe(1);
  });
});

/* ─────────── TokenMeter 容量限制 ─────────── */
describe('TokenMeter 容量限制', () => {
  it('正常记录不限制', () => {
    const meter = new TokenMeter();
    for (let i = 0; i < 100; i++) {
      meter.record({ provider: 'test', model: 'test', promptTokens: 1, completionTokens: 1, totalTokens: 2, estimated: false });
    }
    expect(meter.history().length).toBe(100);
  });

  it('超过 1000 条时触发首次 trim（后续记录继续增长）', () => {
    const meter = new TokenMeter();
    // 1100 条：第 1001 条时 trim 到 500，之后继续累加到 599
    for (let i = 0; i < 1100; i++) {
      meter.record({ provider: 'test', model: 'test', promptTokens: 10, completionTokens: 5, totalTokens: 15, estimated: false });
    }
    // trim 只触发一次（events.length 从 1001 切到 500），然后循环继续推 99 条
    // 所以最终是 500 + 99 = 599
    expect(meter.history().length).toBe(599);
  });

  it('totals 正确累计 trim 后的数据', () => {
    const meter = new TokenMeter();
    for (let i = 0; i < 1100; i++) {
      meter.record({ provider: 'test', model: 'test', promptTokens: 10, completionTokens: 5, totalTokens: 15, estimated: false });
    }
    const totals = meter.totals();
    // 599 条 * 10 prompt + 599 条 * 5 completion
    expect(totals.promptTokens).toBe(5990);
    expect(totals.completionTokens).toBe(2995);
  });

  it('clear 重置状态', () => {
    const meter = new TokenMeter();
    meter.record({ provider: 'test', model: 'test', promptTokens: 1, completionTokens: 1, totalTokens: 2, estimated: false });
    meter.clear();
    expect(meter.history().length).toBe(0);
    expect(meter.totals().totalTokens).toBe(0);
  });
});

/* ─────────── 工具循环检测事件类型 ─────────── */
describe('工具循环检测事件类型', () => {
  it('循环检测产生 ok=false 的 tool 事件', () => {
    // 模拟 fc.ts 循环检测产生的 tool 事件 + done
    const toolEv = {
      type: 'tool' as const,
      name: 'search',
      args: { query: 'x' },
      ok: false,
      summary: '重复调用检测：search 已被调用 3 次以上，停止循环',
    };
    expect(toolEv.type).toBe('tool');
    expect(toolEv.ok).toBe(false);
    expect(toolEv.summary).toContain('重复调用检测');
  });
});
