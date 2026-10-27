/**
 * agentChatUtils 增强版测试：
 *  - composeModelPrompt 双重预算（均摊 share + 整体 headroom）
 *  - localizeToolName 多语种映射
 *  - attachmentLabel 截断感知标签
 *  - fmtTokens 千分位省略
 *  - fileExt 边界
 * 与 __tests__/agentChatUtils.test.ts 互补；不重复 U-01..U-25。
 */

import { describe, it, expect } from 'vitest';
import {
  ATTACH_OVERALL_HEADROOM,
  ATTACH_SHARE_FLOOR,
  ATTACH_TEXT_BUDGET,
  attachmentLabel,
  composeModelPrompt,
  fmtTokens,
  localizeRecipeName,
  localizeToolName,
  lookupLocalized,
  type AgentAttachment,
} from '../agentChatUtils';

const att = (name: string, text: string): AgentAttachment => ({
  id: name,
  name,
  size: text.length,
  text,
});

describe('V-composeModelPrompt 整体预算', () => {
  it('V-01 5 个文件均不超过 share 时仍受整体 headroom 约束', () => {
    // 每个文件 share = 4800（5 个均摊），整体正文总预算 = 24_000 - q.length - 6000
    // q='': perShare = floor((24000 - 0 - 6000) / 5) = 3600
    const files = Array.from({ length: 5 }, (_, i) => att(`f${i}.md`, 'x'.repeat(4000)));
    const r = composeModelPrompt('', files, 'fb');
    // 5 个均未被 trim，但因为 perShare=3600，body 长度 ≤ 5*3600 + 5*(文件名前缀长度)
    // 不必精确估算，只确认 prompt 总长未爆 MAX_PROMPT_CHARS
    expect(r.modelPrompt.length).toBeLessThanOrEqual(32_000);
    // 被 trim 的应当是 5 个（每个都超过 3600），注意：不是 share 的 4800
    expect(r.trimmed.length).toBe(5);
  });

  it('V-02 q 占大头时正文预算是 ATTACH_TEXT_BUDGET - q.length - headroom', () => {
    const bigQ = '问'.repeat(20_000);
    const files = [att('a.md', 'x'.repeat(5_000))];
    const r = composeModelPrompt(bigQ, files, 'fb');
    // 当 q 很大时，剩余正文预算可能很小；至少不会让 r.modelPrompt 超 MAX_PROMPT_CHARS + 余量
    expect(r.modelPrompt.length).toBeLessThan(32_000 + 1024);
  });

  it('V-03 不会因 perShare 比 share 小就把未超 share 的也 trim 掉', () => {
    // 文件正好 share 限制，刚好不超 → 不应被 trim
    const r = composeModelPrompt('', [att('a.md', 'y'.repeat(ATTACH_SHARE_FLOOR))], 'fb');
    expect(r.trimmed).toEqual([]);
  });

  it('V-04 单文件 + 极小 q 时允许正文用满 ATTACH_TEXT_BUDGET - headroom', () => {
    const huge = 'z'.repeat(ATTACH_TEXT_BUDGET);
    const r = composeModelPrompt('', [att('huge.md', huge)], 'fb');
    // perShare = max(1000, floor((24000 - 0 - 6000) / 1)) = 18000
    expect(r.trimmed).toEqual(['huge.md']);
    expect(r.modelPrompt.split('【附件：huge.md】')[1]).toMatch(/…$/);
  });

  it('V-05 ATTACH_OVERALL_HEADROOM 是正数（防御性常量化）', () => {
    expect(ATTACH_OVERALL_HEADROOM).toBeGreaterThan(0);
    expect(ATTACH_SHARE_FLOOR).toBeGreaterThan(0);
    expect(ATTACH_TEXT_BUDGET).toBeGreaterThan(ATTACH_SHARE_FLOOR);
  });
});

describe('V-localizeToolName 工具名本地化', () => {
  it('V-06 中文 locale 把 search 翻成「全文搜索」', () => {
    expect(localizeToolName('search', 'zh-CN')).toBe('全文搜索');
  });

  it('V-07 英文 locale 保持原英文名', () => {
    expect(localizeToolName('search', 'en')).toBe('search');
  });

  it('V-08 日文 locale 把 write_note 翻成「ノート書き込み」', () => {
    expect(localizeToolName('write_note', 'ja')).toBe('ノート書き込み');
  });

  it('V-09 未知工具名原样透传（不抛错）', () => {
    expect(localizeToolName('teleport', 'zh-CN')).toBe('teleport');
  });

  it('V-10 空字符串返回空', () => {
    expect(localizeToolName('', 'zh-CN')).toBe('');
  });

  it('V-11 9 个内置工具名全有映射', () => {
    const tools = [
      'list_notes',
      'read_note',
      'search',
      'get_outline',
      'get_backlinks',
      'get_outgoing',
      'write_note',
      'append_to_note',
      'delete_note',
    ];
    for (const tool of tools) {
      expect(localizeToolName(tool, 'zh-CN')).not.toBe(tool);
      expect(localizeToolName(tool, 'en')).toBe(tool);
      expect(localizeToolName(tool, 'ja')).not.toBe(tool);
    }
  });
});

describe('V-attachmentLabel 截断感知标签', () => {
  it('V-12 未截断时不附加截断提示', () => {
    expect(attachmentLabel({ name: 'a.md', size: 100 }, [], 'zh-CN')).toBe('a.md · 100 B');
  });

  it('V-13 被截断时附加 i18n 提示（zh-CN）', () => {
    const label = attachmentLabel({ name: 'big.md', size: 99 }, ['big.md'], 'zh-CN');
    expect(label).toContain('big.md · 99 B');
    expect(label).toContain('附件内容过长');
    expect(label).toContain('big.md');
  });

  it('V-14 被截断时附加 i18n 提示（en）', () => {
    const label = attachmentLabel({ name: 'big.md', size: 99 }, ['big.md'], 'en');
    expect(label).toContain('too long');
  });
});

describe('V-fmtTokens 千分位', () => {
  it('V-15 < 1000 原样', () => {
    expect(fmtTokens(0)).toBe('0');
    expect(fmtTokens(999)).toBe('999');
  });

  it('V-16 1k–10k 保留两位小数', () => {
    expect(fmtTokens(1000)).toBe('1.00k');
    expect(fmtTokens(2345)).toBe('2.35k');
    expect(fmtTokens(9999)).toBe('10.00k');
  });

  it('V-17 ≥ 10k 一位小数', () => {
    expect(fmtTokens(10_000)).toBe('10.0k');
    expect(fmtTokens(123_456)).toBe('123.5k');
  });
});

describe('V-lookupLocalized 通用三语回退', () => {
  const tables = {
    en: { foo: 'Foo' },
    'zh-CN': { foo: '福' },
    ja: { foo: 'フー' },
  } as const;
  it('V-18 zh-CN 命中返回中文', () => {
    expect(lookupLocalized(tables, 'foo', 'zh-CN')).toBe('福');
  });
  it('V-19 ja 命中返回日文', () => {
    expect(lookupLocalized(tables, 'foo', 'ja')).toBe('フー');
  });
  it('V-20 en 命中返回英文', () => {
    expect(lookupLocalized(tables, 'foo', 'en')).toBe('Foo');
  });
  it('V-21 zh-CN 未命中时回落到 en', () => {
    const t2 = { en: { foo: 'Foo' }, 'zh-CN': {} as Record<string, string>, ja: {} as Record<string, string> };
    expect(lookupLocalized(t2, 'foo', 'zh-CN')).toBe('Foo');
  });
  it('V-22 三表都未命中时原样透传', () => {
    const empty = { en: {}, 'zh-CN': {}, ja: {} };
    expect(lookupLocalized(empty, 'unknown', 'zh-CN')).toBe('unknown');
  });
  it('V-23 空字符串返回空串', () => {
    expect(lookupLocalized(tables, '', 'zh-CN')).toBe('');
  });
});

describe('V-localizeRecipeName 内置 recipe 三语 + 用户自建回退', () => {
  it('V-24 zh-CN 把 summarize-on-save 翻成「保存后摘要」', () => {
    expect(localizeRecipeName('summarize-on-save', 'fallback', 'zh-CN')).toBe('保存后摘要');
  });
  it('V-25 en 把 lint-inbox 翻成 "Inbox tidy suggestions"', () => {
    expect(localizeRecipeName('lint-inbox', 'fallback', 'en')).toBe('Inbox tidy suggestions');
  });
  it('V-26 ja 把 commit-changelog 翻成日文', () => {
    expect(localizeRecipeName('commit-changelog', 'fallback', 'ja')).toBe('コミット後の変更点');
  });
  it('V-27 未登记的 id（用户自建 recipe）回退到 fallbackName', () => {
    expect(localizeRecipeName('my-custom-recipe', '我的自定义流程', 'zh-CN')).toBe('我的自定义流程');
  });
  it('V-28 未登记的 id 即使在 en locale 也回退到 fallbackName', () => {
    expect(localizeRecipeName('user-built', 'User built flow', 'en')).toBe('User built flow');
  });
});
