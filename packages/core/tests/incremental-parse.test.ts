import { beforeEach, describe, expect, it } from 'vitest';
import { render, __clearParseCache, __parseStats } from '../src/parser/pipeline';

/**
 * 增量解析的等价性回归。
 *
 * 这个方案唯一的正确性保证是：「增量拼出来的树 + 全量跑完后续插件」
 * 必须与「全量 parse + 全量跑插件」逐字节一致。
 * 所以每个用例都做两遍：一遍走增量、一遍清缓存走全量，整份结果（含 toc/words/warnings）对比。
 *
 * 同时必须断言「确实走了增量」——否则增量路径失效时测试会全绿，毫无意义。
 */

const DOC = `# 标题

第一段正文，含 **加粗** 与 \`code\`。

## 小节

- 项目一
- 项目二

| A | B |
| - | - |
| 1 | 2 |

\`\`\`ts
const a = 1;
\`\`\`

最后一段。
`;

async function expectSameAsFull(before: string, after: string, expectIncremental = true) {
  await render(before, {}); // 建立缓存
  const inc = await render(after, {}); // 命中缓存 → 走增量
  expect(__parseStats.lastIncremental).toBe(expectIncremental);

  __clearParseCache();
  const full = await render(after, {}); // 强制全量
  expect(__parseStats.lastIncremental).toBe(false);

  expect(JSON.stringify(inc.hast)).toBe(JSON.stringify(full.hast));
  expect(inc.toc).toEqual(full.toc);
  expect(inc.words).toBe(full.words);
  expect(inc.warnings).toEqual(full.warnings);
}

beforeEach(() => {
  __clearParseCache();
});

describe('增量解析等价性', () => {
  it('末尾追加新段落', async () => {
    await expectSameAsFull(DOC, `${DOC}\n追加的一段，含 **加粗**。\n`);
  });

  it('在最后一块内改一个字', async () => {
    await expectSameAsFull(DOC, DOC.replace('最后一段。', '最后一段改了。'));
  });

  it('在文档中部修改某段', async () => {
    await expectSameAsFull(DOC, DOC.replace('第一段正文', '第一段正文（已修改）'));
  });

  it('中间插入一个新块', async () => {
    await expectSameAsFull(DOC, DOC.replace('## 小节', '插进来的段落。\n\n## 小节'));
  });

  it('表格追加一行（上一块被扩展）', async () => {
    const before = DOC;
    const after = before.replace('| 1 | 2 |', '| 1 | 2 |\n| 3 | 4 |');
    await expectSameAsFull(before, after);
  });

  it('列表追加一项', async () => {
    const before = DOC;
    const after = before.replace('- 项目二', '- 项目二\n- 项目三');
    await expectSameAsFull(before, after);
  });

  it('代码块内追加一行', async () => {
    const before = DOC;
    const after = before.replace('const a = 1;', 'const a = 1;\nconst b = 2;');
    await expectSameAsFull(before, after);
  });

  it('末尾追加 setext 标题分隔（段落变标题）', async () => {
    // 段落下一行写 `---` 会把段落变成 h2：整篇只有一块，回退后无可复用块 → 走全量
    await expectSameAsFull('普通段落\n', '普通段落\n---\n', false);
  });

  it('末尾追加到未闭合代码块里', async () => {
    const before = '# 标题\n\n```ts\nconst a = 1;\n';
    const after = `${before}const b = 2;\n`;
    await expectSameAsFull(before, after);
  });

  it('连续的多次编辑（逐字输入）逐步等价', async () => {
    let doc = DOC;
    for (const ch of ['追', '加', '文', '字']) {
      await render(doc, {});
      doc += ch;
      const inc = await render(doc, {});
      __clearParseCache();
      const full = await render(doc, {});
      expect(JSON.stringify(inc.hast)).toBe(JSON.stringify(full.hast));
    }
  });

  it('含链接引用定义时禁用增量（定义是全局作用域）', async () => {
    const before = '引用 [a] 与 [b]。\n\n[a]: https://example.com/a\n';
    await render(before, {});
    const after = `${before}\n[b]: https://example.com/b\n`;
    const r = await render(after, {});
    expect(__parseStats.lastIncremental).toBe(false);

    __clearParseCache();
    const full = await render(after, {});
    expect(JSON.stringify(r.hast)).toBe(JSON.stringify(full.hast));
  });

  it('含脚注定义时禁用增量', async () => {
    const before = '正文[^1]。\n\n[^1]: 脚注内容。\n';
    await render(before, {});
    const after = `${before}\n新增段落。\n`;
    await render(after, {});
    expect(__parseStats.lastIncremental).toBe(false);
  });

  it('processor 选项变化后不复用旧缓存', async () => {
    await render(DOC, { autoNumber: 'arabic' });
    const r = await render(`${DOC}\n追加。\n`, { autoNumber: false });
    // 键不同 → 必须回退全量（否则编号设置会被旧解析结果带偏）
    expect(__parseStats.lastIncremental).toBe(false);
    expect(JSON.stringify(r.hast)).not.toContain('data-number');
  });

  it('切换到完全不同的文档时回退全量', async () => {
    await render(DOC, {});
    const other = '# 另一篇\n\n完全不同的内容。\n';
    const inc = await render(other, {});
    expect(__parseStats.lastIncremental).toBe(false);

    __clearParseCache();
    const full = await render(other, {});
    expect(JSON.stringify(inc.hast)).toBe(JSON.stringify(full.hast));
  });

  it('开启自动编号时中间插入标题，编号仍按全文重排', async () => {
    const before = '# 顶层\n\n## 一\n\n正文甲。\n\n## 二\n\n正文乙。\n';
    const after = before.replace('## 二', '## 一·五\n\n正文丙。\n\n## 二');
    const opts = { autoNumber: 'arabic' as const };

    await render(before, opts);
    const inc = await render(after, opts);
    expect(__parseStats.lastIncremental).toBe(true);

    __clearParseCache();
    const full = await render(after, opts);
    // 编号是全局的：复用了未变块也必须重排，结果应与全量逐字节一致
    expect(JSON.stringify(inc.hast)).toBe(JSON.stringify(full.hast));
  });

  it('增量结果的行号与全量一致（data-line 不漂移）', async () => {
    const before = DOC;
    const after = `${DOC}\n追加段落。\n`;
    await render(before, {});
    const inc = await render(after, {});
    __clearParseCache();
    const full = await render(after, {});

    const lines = (hast: any): string[] => {
      const out: string[] = [];
      const walk = (n: any) => {
        if (n?.properties?.['data-line']) out.push(String(n.properties['data-line']));
        if (Array.isArray(n?.children)) n.children.forEach(walk);
      };
      walk(hast);
      return out;
    };
    expect(lines(inc.hast)).toEqual(lines(full.hast));
  });

  it('尾部块以缩进开头时列号不漂移（position.column 与全量一致）', async () => {
    // 切片从块起点（`-` 所在列）切开，原实现只平移 offset/line，
    // 缩进块的列号会从 3 掉到 1，而排版 lint 正是用 column 定位下划线。
    const before = '前言段落。\n\n```\n空块\n```\n';
    const after = `${before}\n  - 缩进列表\n`;
    await render(before, {});
    const inc = await render(after, {});
    expect(__parseStats.lastIncremental).toBe(true);
    __clearParseCache();
    const full = await render(after, {});

    const columns = (hast: any): number[] => {
      const out: number[] = [];
      const walk = (n: any) => {
        if (typeof n?.position?.start?.column === 'number') out.push(n.position.start.column);
        if (Array.isArray(n?.children)) n.children.forEach(walk);
      };
      walk(hast);
      return out;
    };
    expect(columns(inc.hast)).toEqual(columns(full.hast));
    expect(JSON.stringify(inc.hast)).toBe(JSON.stringify(full.hast));
  });

  it('文档以 `---` 开头时禁用增量（frontmatter 状态无法用切片复现）', async () => {
    // 复现：`---`（未闭合栅栏）开头时，其后 `  - 项` 在全文里是段落、单独解析却是列表
    const before = '---\n\n## 标题\n\n正文。\n';
    await render(before, {});
    const after = `${before}\n  - 项\n`;
    const r = await render(after, {});
    expect(__parseStats.lastIncremental).toBe(false);

    __clearParseCache();
    const full = await render(after, {});
    expect(JSON.stringify(r.hast)).toBe(JSON.stringify(full.hast));
  });

  it('切点落在 `---` 行时不得把它当作文档首行解析', async () => {
    // 切片以 `---` 开头会重新激活 frontmatter 状态，使后续缩进内容解析成段落
    const before = '```js\nconst a = 1;\n```\n\n**粗**\n\n- 项一\n   缩进\n';
    const after = `${before}---\n- 项二\n  - 子项\n`;
    await render(before, {});
    const inc = await render(after, {});
    __clearParseCache();
    const full = await render(after, {});
    expect(JSON.stringify(inc.hast)).toBe(JSON.stringify(full.hast));
  });

  it('逐块输入 8 篇文档（确定性伪随机）：逐步等价于全量解析', async () => {
    const CHUNKS = [
      '# 标题一\n',
      '- 列表项\n',
      '- 第二项\n  - 嵌套项\n',
      '1. 有序一\n',
      '> 引用\n',
      '```js\nconst a = 1;\n```\n',
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
      '**粗** ==高亮==\n',
      '[[双链]]\n',
      '---\n',
      '  - 缩进列表\n',
      '   缩进代码\n',
    ];
    const rand = (seed: number) => {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    let incrementalHits = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const next = rand(seed);
      __clearParseCache();
      let doc = '';
      for (let step = 0; step < 8; step++) {
        doc += CHUNKS[Math.floor(next() * CHUNKS.length)];
        const inc = await render(doc, {});
        if (__parseStats.lastIncremental) incrementalHits++;
        __clearParseCache();
        const full = await render(doc, {});
        expect(JSON.stringify(inc.hast)).toBe(JSON.stringify(full.hast));
      }
    }
    // 防止「全量兜底」让上面的一致性断言变成空转
    expect(incrementalHits).toBeGreaterThan(20);
  });
});
