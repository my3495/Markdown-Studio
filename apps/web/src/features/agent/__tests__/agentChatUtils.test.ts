/**
 * agentChatUtils 纯逻辑单测：附件预算、历史窗口、事件→trace 映射、文件类型判定。
 * 不依赖 DOM / store / 网络。
 */

import { describe, it, expect } from 'vitest';
import type { ToolAgentEvent } from '@md-studio/core';
import {
  ATTACH_TEXT_BUDGET,
  attachShare,
  buildHistory,
  buildInsertBlock,
  composeModelPrompt,
  eventTraceStep,
  fileExt,
  fmtSize,
  isTextFile,
  localizeToolName,
  lookupLocalized,
  sandboxOpToTool,
  type AgentAttachment,
} from '../agentChatUtils';

const att = (name: string, text: string): AgentAttachment => ({
  id: name,
  name,
  size: text.length,
  text,
});

describe('U-attachShare 附件配额均摊', () => {
  it('U-01 单附件获得全部预算', () => {
    expect(attachShare(1)).toBe(ATTACH_TEXT_BUDGET);
  });

  it('U-02 5 个附件均摊为 4800', () => {
    expect(attachShare(5)).toBe(4800);
  });

  it('U-03 附件过多时触发 1000 字符保底', () => {
    expect(attachShare(100)).toBe(1_000);
    expect(attachShare(0)).toBe(ATTACH_TEXT_BUDGET);
  });
});

describe('U-composeModelPrompt 提问组装', () => {
  it('U-04 无附件时原样返回提问', () => {
    const r = composeModelPrompt('你好', [], '请描述附件');
    expect(r.modelPrompt).toBe('你好');
    expect(r.trimmed).toEqual([]);
  });

  it('U-05 空提问带附件时回落占位文案', () => {
    const r = composeModelPrompt('', [att('a.md', '内容')], '请描述附件');
    expect(r.modelPrompt.startsWith('请描述附件\n\n')).toBe(true);
    expect(r.modelPrompt).toContain('【附件：a.md】\n内容');
  });

  it('U-06 预算内的附件不截断', () => {
    const r = composeModelPrompt('q', [att('a.md', 'x'.repeat(100))], 'fb');
    expect(r.trimmed).toEqual([]);
    expect(r.modelPrompt).toContain('x'.repeat(100));
    expect(r.modelPrompt).not.toContain('…');
  });

  it('U-07 超预算附件被截断并回报文件名', () => {
    const r = composeModelPrompt('q', [att('big.md', 'y'.repeat(30_000))], 'fb');
    expect(r.trimmed).toEqual(['big.md']);
    const body = r.modelPrompt.split('\n\n')[1];
    expect(body.endsWith('…')).toBe(true);
    // 正文被砍到配额（4800 字符 + 换行 + 省略号）
    expect(body.length).toBeLessThanOrEqual(30_000);
    expect(body).not.toContain('y'.repeat(30_000));
  });

  it('U-08 多附件均超预算时逐个截断且互不越额', () => {
    const atts = [att('a.md', 'a'.repeat(30_000)), att('b.md', 'b'.repeat(30_000))];
    const r = composeModelPrompt('q', atts, 'fb');
    expect(r.trimmed).toEqual(['a.md', 'b.md']);
    const segA = r.modelPrompt.split('【附件：b.md】')[0];
    const segB = r.modelPrompt.split('【附件：b.md】')[1];
    expect(segA.length).toBeLessThanOrEqual(ATTACH_TEXT_BUDGET / 2 + 32);
    expect(segB.length).toBeLessThanOrEqual(ATTACH_TEXT_BUDGET / 2 + 32);
  });

  it('U-09 组装结果不超出 core 的 MAX_PROMPT_CHARS(32000)', () => {
    const atts = Array.from({ length: 5 }, (_, i) => att(`f${i}.md`, 'z'.repeat(30_000)));
    const r = composeModelPrompt('q', atts, 'fb');
    expect(r.modelPrompt.length).toBeLessThanOrEqual(32_000);
  });
});

describe('U-buildHistory 多轮上下文窗口', () => {
  const mk = (role: 'user' | 'assistant', text: string, context?: string) => ({ role, text, context });

  it('U-10 过滤空白消息', () => {
    const h = buildHistory([mk('user', ''), mk('assistant', '  '), mk('user', '有效')]);
    expect(h).toEqual([{ role: 'user', content: '有效' }]);
  });

  it('U-11 只取最近 limit 条', () => {
    const msgs = Array.from({ length: 12 }, (_, i) => mk('user', `m${i}`));
    const h = buildHistory(msgs, 3);
    expect(h.map((x) => x.content)).toEqual(['m9', 'm10', 'm11']);
  });

  it('U-12 context 优先于 text', () => {
    const h = buildHistory([mk('user', '短', '含附件的完整文本')]);
    expect(h[0].content).toBe('含附件的完整文本');
  });

  it('U-13 默认上限为 8 条', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => mk('user', `m${i}`));
    expect(buildHistory(msgs)).toHaveLength(8);
  });
});

describe('U-eventTraceStep 事件→trace 映射', () => {
  it('U-14 error 映射为失败步骤（本地化文案）', () => {
    const step = eventTraceStep({ type: 'error', message: 'boom' }, 'zh-CN');
    expect(step).toEqual({ tool: 'llm', ok: false, summary: '模型调用失败：boom' });
  });

  it('U-15 retry 带 status 时展示第几次与 HTTP 状态', () => {
    const step = eventTraceStep(
      { type: 'retry', attempt: 2, status: 429, delayMs: 100, reason: 'HTTP 429' },
      'zh-CN'
    );
    expect(step?.summary).toBe('重试中（第 2 次，HTTP 429）');
    expect(step?.ok).toBe(true);
  });

  it('U-16 retry 无 status 时不带 HTTP 后缀', () => {
    const step = eventTraceStep(
      { type: 'retry', attempt: 1, delayMs: 50, reason: '网络异常' },
      'zh-CN'
    );
    expect(step?.summary).toBe('重试中（第 1 次）');
  });

  it('U-17 notice(truncated) 映射为截断提示', () => {
    const step = eventTraceStep({ type: 'notice', code: 'truncated', detail: 'x' }, 'zh-CN');
    expect(step?.summary).toBe('上下文过长，已自动截断后再发送');
  });

  it('U-17b notice(badToolFormat) 映射为 err 步骤（伪工具调用）', () => {
    const step = eventTraceStep({ type: 'notice', code: 'badToolFormat', detail: 'x' }, 'zh-CN');
    expect(step).toMatchObject({ tool: 'llm', ok: false });
    expect(step?.summary).toContain('未按工具协议');
  });

  it('U-18 notice 未知 code 返回 null', () => {
    const step = eventTraceStep(
      { type: 'notice', code: 'unknown' as 'truncated', detail: 'x' },
      'zh-CN'
    );
    expect(step).toBeNull();
  });

  it('U-19 非 error/retry/notice 事件返回 null', () => {
    const evs: ToolAgentEvent[] = [
      { type: 'delta', text: 'hi' },
      { type: 'done' },
      { type: 'tool', name: 'search', args: {}, ok: true, summary: 's' },
    ];
    for (const ev of evs) expect(eventTraceStep(ev, 'zh-CN')).toBeNull();
  });

  it('U-20 en locale 输出英文文案', () => {
    expect(eventTraceStep({ type: 'error', message: 'boom' }, 'en')?.summary).toBe(
      'Model call failed：boom'
    );
    expect(
      eventTraceStep({ type: 'retry', attempt: 3, status: 500, delayMs: 10, reason: 'x' }, 'en')
        ?.summary
    ).toBe('Retrying (attempt 3，HTTP 500)');
  });
});

describe('U-文件类型判定与体积格式化', () => {
  it('U-21 text/* MIME 直接通过', () => {
    expect(isTextFile({ type: 'text/plain', name: 'a.bin' })).toBe(true);
  });

  it('U-22 扩展名命中白名单（大小写不敏感）', () => {
    expect(isTextFile({ type: '', name: 'note.MD' })).toBe(true);
    expect(isTextFile({ type: '', name: 's.PY' })).toBe(true);
  });

  it('U-23 二进制文件拒识', () => {
    expect(isTextFile({ type: 'image/png', name: 'a.png' })).toBe(false);
    expect(isTextFile({ type: '', name: 'a.exe' })).toBe(false);
  });

  it('U-24 fileExt 取最后一段', () => {
    expect(fileExt('a.tar.gz')).toBe('gz');
    expect(fileExt('noext')).toBe('noext');
  });

  it('U-25 fmtSize B/KB 分档', () => {
    expect(fmtSize(512)).toBe('512 B');
    expect(fmtSize(2048)).toBe('2 KB');
  });
});

/* ─────────── P-打磨 阶段新增：sandboxOpToTool / lookupLocalized / buildInsertBlock ─────────── */

describe('P-sandboxOpToTool sandbox op → 工具名映射', () => {
  it('P-01 delete/append/write 三个 op 都映射到对应核心工具', () => {
    expect(sandboxOpToTool('delete')).toBe('delete_note');
    expect(sandboxOpToTool('append')).toBe('append_to_note');
    expect(sandboxOpToTool('write')).toBe('write_note');
  });

  it('P-02 未知 op 原样透传（不抛错）', () => {
    expect(sandboxOpToTool('unknown_op')).toBe('unknown_op');
  });
});

describe('P-lookupLocalized 三语 fallback 链', () => {
  const t = {
    en: { foo: 'EnglishFoo' },
    'zh-CN': { foo: '中文Foo' },
    ja: { foo: '日本語Foo' },
  };

  it('P-03 zh-CN 优先用中文表', () => {
    expect(lookupLocalized(t, 'foo', 'zh-CN')).toBe('中文Foo');
  });

  it('P-04 en locale 用英文表', () => {
    expect(lookupLocalized(t, 'foo', 'en')).toBe('EnglishFoo');
  });

  it('P-05 ja locale 用日文表', () => {
    expect(lookupLocalized(t, 'foo', 'ja')).toBe('日本語Foo');
  });

  it('P-06 zh-CN 表未命中时回落英文表', () => {
    const onlyEn = { en: { bar: 'EnglishBar' }, 'zh-CN': {}, ja: {} };
    expect(lookupLocalized(onlyEn, 'bar', 'zh-CN')).toBe('EnglishBar');
  });

  it('P-07 都没命中时原 key 透传', () => {
    expect(lookupLocalized(t, 'unknown', 'zh-CN')).toBe('unknown');
  });

  it('P-08 空字符串原样返回（防 call site 误传）', () => {
    expect(lookupLocalized(t, '', 'zh-CN')).toBe('');
  });
});

describe('P-buildInsertBlock 插入笔记 block', () => {
  it('P-09 用引用样式包住最终回答，标题走调用方传入的本地化串', () => {
    const out = buildInsertBlock('回答内容', 'Agent 回答');
    expect(out).toContain('> Agent 回答');
    expect(out).toContain('回答内容');
  });

  it('P-10 末尾补一个空行（避免紧贴下一段）', () => {
    const out = buildInsertBlock('x', 'T');
    expect(out.endsWith('\n')).toBe(true);
  });
});

describe('P-localizeToolName 内部 trace tool 名本地化', () => {
  it('P-11 compose 在 zh/en/ja 三语下分别有本地化名', () => {
    expect(localizeToolName('compose', 'zh-CN')).toBe('组装回答');
    expect(localizeToolName('compose', 'en')).toBe('compose');
    expect(localizeToolName('compose', 'ja')).toBe('回答を構成');
  });

  it('P-12 llm 在 zh/en/ja 三语下分别有本地化名', () => {
    expect(localizeToolName('llm', 'zh-CN')).toBe('模型调用');
    expect(localizeToolName('llm', 'en')).toBe('llm');
    expect(localizeToolName('llm', 'ja')).toBe('モデル呼び出し');
  });

  it('P-13 未知 tool 原样透传', () => {
    expect(localizeToolName('mystery_tool', 'zh-CN')).toBe('mystery_tool');
  });
});
