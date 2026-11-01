/**
 * 选中文字 → Agent 改写的纯逻辑测试：定位映射、diff、应用、提示词语言一致性。
 */
import { describe, it, expect } from 'vitest';
import {
  locateSelection,
  normalizeWithMap,
  contextAround,
  tokenizeForDiff,
  diffTokens,
  diffStat,
  applyRewrite,
  detectInputLang,
  buildRewriteMessages,
  parseRewriteReply,
} from '../../src/agent/rewrite';

describe('normalizeWithMap', () => {
  it('剥离强调标记并保留下标映射', () => {
    const raw = '这是**重要**的一段';
    const n = normalizeWithMap(raw);
    expect(n.text).toBe('这是重要的一段');
    // 归一化第 2 个字符「是」→ 原文下标 1；第 3 个字符「重」→ 原文下标 4
    expect(n.map[1]).toBe(1);
    expect(n.map[2]).toBe(4);
  });

  it('链接只保留可见文字，地址不参与匹配', () => {
    const n = normalizeWithMap('参见[官网](https://example.com/a)说明');
    expect(n.text).toBe('参见官网说明');
  });

  it('图片整体跳过', () => {
    const n = normalizeWithMap('前![alt](a.png)后');
    expect(n.text).toBe('前后');
  });

  it('行首块级标记（#/>/列表）不计入文字', () => {
    expect(normalizeWithMap('# 标题').text).toBe('标题');
    expect(normalizeWithMap('> 引用').text).toBe('引用');
    expect(normalizeWithMap('- 列表项').text).toBe('列表项');
    expect(normalizeWithMap('1. 有序项').text).toBe('有序项');
  });

  it('连续空白归一为单个空格', () => {
    expect(normalizeWithMap('a\n\n   b').text).toBe('a b');
  });
});

describe('locateSelection', () => {
  const doc = '# 标题\n\n这是**重要**的一段说明。\n\n另一段文字。\n';

  it('原文精确命中时给出 exact 与正确区间', () => {
    const r = locateSelection(doc, '另一段文字');
    expect(r).not.toBeNull();
    expect(r!.confidence).toBe('exact');
    expect(r!.text).toBe('另一段文字');
    expect(doc.slice(r!.range.start, r!.range.end)).toBe('另一段文字');
  });

  it('标记内的文字在原文中本就精确存在：exact 命中，标记留在区间外', () => {
    const r = locateSelection(doc, '重要');
    expect(r!.confidence).toBe('exact');
    expect(r!.text).toBe('重要');
    // 前一个是 `*`，后一个是 `*`：替换后仍是 **新词**
    expect(doc[r!.range.start - 1]).toBe('*');
    expect(doc[r!.range.end]).toBe('*');
  });

  it('跨标记的长选区整体命中（含被隐藏的标记）', () => {
    const r = locateSelection(doc, '这是重要的一段说明');
    expect(r!.confidence).toBe('normalized');
    expect(r!.text).toBe('这是**重要**的一段说明');
  });

  it('行号提示用于多处命中择优', () => {
    const d = '第一段坑。\n\n第二段坑。\n\n第三段坑。\n';
    const near = locateSelection(d, '坑', { lineHint: 5 });
    const far = locateSelection(d, '坑', { lineHint: 1 });
    expect(near!.line).toBe(5);
    expect(far!.line).toBe(1);
    expect(near!.ambiguous).toBe(true);
    expect(near!.candidates).toBe(3);
  });

  it('归一化仍不中时退化为前后缀锚定', () => {
    const d = '正文：这是一段需要改写的长句子，结尾在这里。';
    // 中间被插入了正文里没有的字符：整段匹配不上，靠前后缀锚定两端
    const r = locateSelection(d, '这是一段需要改写的长句X子，结尾在这里');
    expect(r!.confidence).toBe('partial');
    expect(d.slice(r!.range.start, r!.range.end)).toContain('这是一段需要改写');
  });

  it('前后缀锚点互相矛盾时返回 null（片段不来自这篇正文）', () => {
    const d = '正文：这是一段需要改写的长句子，结尾在这里。';
    expect(locateSelection(d, '完全无关的前缀，结尾在这里')).toBeNull();
  });

  it('完全不属于正文时返回 null', () => {
    expect(locateSelection(doc, '风马牛不相及的另外一句话。')).toBeNull();
  });

  it('空选区返回 null', () => {
    expect(locateSelection(doc, '   ')).toBeNull();
    expect(locateSelection('', 'abc')).toBeNull();
  });

  it('零宽字符与多余空白不影响命中', () => {
    const r = locateSelection(doc, '另一段 文字');
    expect(r!.confidence).toBe('normalized');
    expect(r!.text).toBe('另一段文字');
  });
});

describe('contextAround', () => {
  it('取区间前后文本', () => {
    const c = '上一句。目标句。下一句。';
    const r = locateSelection(c, '目标句');
    const ctx = contextAround(c, r!.range, 4);
    expect(ctx.before).toBe('上一句。');
    expect(ctx.after).toBe('。下一句');
  });
});

describe('tokenize / diffTokens', () => {
  it('CJK 逐字、拉丁按词', () => {
    expect(tokenizeForDiff('中文abc def')).toEqual(['中', '文', 'abc', ' ', 'def']);
  });

  it('词级 diff 只标记真正变化的部分', () => {
    const ops = diffTokens('这是一个方案', '这是一个更好的方案');
    const added = ops.filter((o) => o.type === 'add').map((o) => o.text).join('');
    expect(added).toBe('更好的');
    expect(ops.filter((o) => o.type === 'del')).toHaveLength(0);
    // 拼接后与新版一致
    expect(ops.filter((o) => o.type !== 'del').map((o) => o.text).join('')).toBe('这是一个更好的方案');
  });

  it('删除也能正确识别', () => {
    const ops = diffTokens('我们非常认真地讨论了这个问题', '我们讨论了这个问X题');
    expect(diffStat(ops).del).toBeGreaterThan(0);
  });

  it('diffStat 统计删除/新增字符数', () => {
    const stat = diffStat(diffTokens('这是一个方案', '这是一个更好的方案'));
    expect(stat.del).toBe(0);
    expect(stat.add).toBe(3);
    // 「非常」「好」「的」三个词共 4 个字被删
    const shrink = diffStat(diffTokens('这是一个非常好的方案', '这是一个方案'));
    expect(shrink.del).toBe(4);
    expect(shrink.add).toBe(0);
  });

  it('超大文本退化为前后缀比对而不爆内存', () => {
    const a = '前' + '中'.repeat(20000) + '后';
    const b = '前' + '中'.repeat(19000) + '后';
    const ops = diffTokens(a, b);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.filter((o) => o.type === 'del').length).toBeGreaterThan(0);
  });
});

describe('applyRewrite', () => {
  it('按区间替换并返回前后片段', () => {
    const c = '开头 目标 结尾';
    const r = locateSelection(c, '目标');
    const out = applyRewrite(c, r!.range, '新目标');
    expect(out.content).toBe('开头 新目标 结尾');
    expect(out.before).toBe('目标');
    expect(out.after).toBe('新目标');
  });

  it('区间越界被夹紧，不抛错', () => {
    const out = applyRewrite('abc', { start: -5, end: 999 }, 'X');
    expect(out.content).toBe('X');
  });
});

describe('detectInputLang（提示语言与输入语言一致）', () => {
  it('中文指令判 zh', () => {
    expect(detectInputLang('把这段改得更简洁')).toBe('zh');
  });

  it('含假名判 ja', () => {
    expect(detectInputLang('この段落を簡潔にして')).toBe('ja');
  });

  it('纯英文判 en', () => {
    expect(detectInputLang('make it more concise')).toBe('en');
  });

  it('空输入回退 en', () => {
    expect(detectInputLang('')).toBe('en');
  });
});

describe('buildRewriteMessages', () => {
  it('中文指令生成中文提示与中文标签', () => {
    const msgs = buildRewriteMessages({ lang: 'zh', instruction: '更简洁', target: '原文' });
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('改写助手');
    expect(msgs[1].content).toContain('### 修改指令');
    expect(msgs[1].content).toContain('<<<\n原文\n>>>');
  });

  it('英文指令生成英文提示', () => {
    const msgs = buildRewriteMessages({ lang: 'en', instruction: 'shorter', target: 'text' });
    expect(msgs[0].content).toContain('rewrite assistant');
    expect(msgs[1].content).toContain('### Instruction');
  });

  it('传入上下文时一并给出上文/下文', () => {
    const msgs = buildRewriteMessages({
      lang: 'zh',
      instruction: '更正式',
      target: '目标',
      before: '前文',
      after: '后文',
    });
    expect(msgs[1].content).toContain('### 上文');
    expect(msgs[1].content).toContain('### 下文');
  });
});

describe('parseRewriteReply', () => {
  it('剥掉代码块围栏', () => {
    expect(parseRewriteReply('```\n修改后的文字\n```')).toBe('修改后的文字');
  });

  it('剥掉带语言标注的围栏', () => {
    expect(parseRewriteReply('```markdown\n新文本\n```')).toBe('新文本');
  });

  it('剥掉结果标签与成对引号', () => {
    expect(parseRewriteReply('改写结果：新的句子')).toBe('新的句子');
    expect(parseRewriteReply('"新的句子"')).toBe('新的句子');
    expect(parseRewriteReply('「新的句子」')).toBe('新的句子');
  });

  it('剥掉模型回显的定界符', () => {
    expect(parseRewriteReply('<<<\n新的句子\n>>>')).toBe('新的句子');
  });

  it('纯文本原样返回', () => {
    expect(parseRewriteReply('  新的句子\n')).toBe('新的句子');
  });

  it('空回包返回空串', () => {
    expect(parseRewriteReply('')).toBe('');
    expect(parseRewriteReply('   ')).toBe('');
  });
});
