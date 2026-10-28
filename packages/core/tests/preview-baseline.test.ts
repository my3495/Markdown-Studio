import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_VARIABLES, buildBaseCss, getThemeVariables } from '../src/renderer/styles';

/**
 * 预览 / 导出基线一致性守卫（对应审计 P0-4）。
 *
 * `buildBaseCss()` 是导出/分享 HTML 的唯一样式来源，Web 预览的另一半在
 * `apps/web/src/styles/index.css` 的 `.md-preview` 段。两边是两份手写 CSS，
 * 只能靠断言守住「同一份文档在预览与导出下长相一致」。
 *
 * 这里刻意只比对**关键属性**（字号、间距、底色、边框、圆角），不用整串快照：
 * 允许两侧各自动增加无关样式（动画、transition、编辑态交互），
 * 但任何影响文档外观的漂移都会失败。
 */

const WEB_CSS_PATH = new URL('../../../apps/web/src/styles/index.css', import.meta.url);

const WEB_CSS = readFileSync(WEB_CSS_PATH, 'utf8');
const EXPORT_CSS = buildBaseCss();

// ---------------------------------------------------------------- 极简 CSS 解析
// 只为比对服务：不处理层叠、特异性和继承，只按选择器文本收集声明块。

interface Rule {
  selector: string;
  decls: Map<string, string>;
}

/** 把 `var(--x, fallback)` 折叠成 `var(--x)`：兜底值差异不影响外观一致性 */
function stripVarFallbacks(input: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const start = input.indexOf('var(', i);
    if (start === -1) return out + input.slice(i);
    out += input.slice(i, start);
    let depth = 0;
    let j = start + 3;
    for (; j < input.length; j++) {
      if (input[j] === '(') depth++;
      else if (input[j] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    const inner = input.slice(start + 4, j);
    out += `var(${inner.split(',')[0].trim()})`;
    i = j + 1;
  }
}

function normalizeValue(raw: string): string {
  let v = stripVarFallbacks(raw);
  v = v.replace(/\s+/g, ' ');
  v = v.replace(/\s*,\s*/g, ',');
  // `.3em` 与 `0.3em` 是同一个值
  v = v.replace(/(^|[\s,(])\.(\d)/g, '$10.$2');
  return v.trim().toLowerCase();
}

function normalizeSelector(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/"/g, "'").trim().toLowerCase();
}

function parseDecls(body: string): Map<string, string> {
  const decls = new Map<string, string>();
  for (const chunk of body.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon === -1) continue;
    const prop = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk.slice(colon + 1).trim();
    if (!prop || !value) continue;
    decls.set(prop, normalizeValue(value));
  }
  return decls;
}

function parseRules(css: string, scope = ''): Rule[] {
  // 注释里也有 `{`，先整段剔除
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let prelude = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      const body = src.slice(i + 1, j);
      const sel = prelude.trim();
      if (sel.startsWith('@media') || sel.startsWith('@supports')) {
        rules.push(...parseRules(body, `${scope}${sel} `));
      } else if (sel && !sel.startsWith('@')) {
        const decls = parseDecls(body);
        for (const part of sel.split(',')) {
          rules.push({ selector: scope + normalizeSelector(part), decls });
        }
      }
      prelude = '';
      i = j + 1;
      continue;
    }
    if (ch === ';' || ch === '}') {
      // `@tailwind base;` 之类无块级规则的语句
      prelude = '';
      i++;
      continue;
    }
    prelude += ch;
    i++;
  }
  return rules;
}

function indexRules(rules: Rule[]): Map<string, Map<string, string>> {
  const index = new Map<string, Map<string, string>>();
  for (const rule of rules) {
    const existing = index.get(rule.selector);
    if (existing) {
      for (const [k, v] of rule.decls) existing.set(k, v);
    } else {
      index.set(rule.selector, new Map(rule.decls));
    }
  }
  return index;
}

const WEB = indexRules(parseRules(WEB_CSS));
const EXPORT = indexRules(parseRules(EXPORT_CSS));

// ---------------------------------------------------------------- 受守卫的规则
// 选型原则：凡是决定「文档长什么样」的属性都列进来；
// transition / animation / cursor / user-select 等交互态不列（导出侧本来就没有）。
const GUARDED: Array<[selector: string, props: string[]]> = [
  ['.md-preview', ['font-family', 'font-size', 'line-height', 'color', 'background', 'max-width', 'padding']],
  ['.md-preview h1', ['font-size', 'font-weight', 'line-height', 'margin', 'letter-spacing', 'border-bottom', 'padding-bottom']],
  ['.md-preview h2', ['font-size', 'border-bottom', 'padding-bottom']],
  ['.md-preview h3', ['font-size']],
  ['.md-preview h4', ['font-size']],
  ['.md-preview h5', ['font-size']],
  ['.md-preview h6', ['font-size', 'color']],
  ['.md-preview p', ['margin']],
  ['.md-preview a', ['color', 'text-decoration', 'border-bottom']],
  ['.md-preview strong', ['font-weight', 'color']],
  ['.md-preview em', ['font-style']],
  ['.md-preview mark', ['background', 'border-radius']],
  ['.md-preview kbd', ['font-family', 'padding', 'border', 'border-bottom-width', 'border-radius', 'background']],
  ['.md-preview code', ['font-family', 'background', 'color', 'padding', 'border-radius', 'font-size', 'border']],
  ['.md-preview pre', ['background', 'color', 'padding', 'border-radius', 'border', 'box-shadow', 'margin', 'tab-size']],
  ['.md-preview pre code', ['background', 'padding', 'border', 'font-size']],
  ['.md-preview pre.shiki', ['background']],
  [
    '.md-preview blockquote',
    ['margin', 'padding', 'color', 'background', 'border-left', 'border-radius'],
  ],
  ['.md-preview blockquote p', ['margin']],
  ['.md-preview ul', ['padding-left', 'list-style']],
  ['.md-preview ul ul', ['list-style']],
  ['.md-preview ul ul ul', ['list-style']],
  ['.md-preview ol', ['padding-left', 'list-style']],
  ['.md-preview ol ol', ['list-style']],
  ['.md-preview ol ol ol', ['list-style']],
  ['.md-preview li', ['margin']],
  [
    '.md-preview table',
    ['border-collapse', 'border-spacing', 'width', 'margin', 'font-size', 'border', 'border-radius', 'overflow'],
  ],
  ['.md-preview th', ['padding', 'border-bottom', 'text-align']],
  ['.md-preview td', ['padding', 'border-bottom', 'text-align']],
  ['.md-preview thead th', ['background', 'font-weight']],
  ['.md-preview img', ['max-width', 'border-radius', 'box-shadow']],
  ['.md-preview hr', ['border', 'border-top', 'margin']],
  ['.md-preview .pagebreak', ['border', 'border-top', 'margin']],
  [".md-preview input[type='checkbox']", ['accent-color']],
  ['.md-preview .md-toc', ['margin', 'padding', 'border', 'border-radius', 'background']],
  ['.md-preview .md-toc-title', ['margin', 'font-weight', 'font-size']],
  ['.md-preview .md-toc ul', ['margin', 'padding-left', 'list-style']],
  ['.md-preview .md-toc > ul', ['padding-left']],
  ['.md-preview .md-toc li', ['margin']],
  ['.md-preview .md-toc a', ['color', 'text-decoration', 'border-bottom']],
  ['.md-preview .footnotes', ['margin-top', 'padding-top', 'border-top', 'font-size', 'color']],
  ['.md-preview details', ['margin', 'padding', 'border', 'border-radius', 'background']],
  ['.md-preview summary', ['cursor', 'font-weight']],
  ['.mermaid-block', ['text-align', 'margin', 'padding', 'border', 'border-radius', 'background']],
  ['.md-footer', ['margin-top', 'padding-top', 'border-top', 'color', 'font-size', 'text-align']],
];

describe('预览 / 导出基线一致性', () => {
  it.each(GUARDED)('%s 的关键属性两侧一致', (selector, props) => {
    const web = WEB.get(selector);
    const exp = EXPORT.get(selector);
    expect(web, `Web 预览缺少规则 ${selector}`).toBeDefined();
    expect(exp, `导出 CSS 缺少规则 ${selector}`).toBeDefined();

    for (const prop of props) {
      expect(web?.get(prop), `Web 预览 ${selector} 缺少 ${prop}`).toBeDefined();
      expect(exp?.get(prop), `导出 CSS ${selector} 缺少 ${prop}`).toBeDefined();
      expect(exp?.get(prop), `${selector} { ${prop} } 预览与导出不一致`).toBe(web?.get(prop));
    }
  });

  it('守卫本身能发现漂移', () => {
    // 防止解析器静默失效（例如选择器规范化写错导致永远取到 undefined 而「全部通过」）
    const drifted = indexRules(parseRules('.md-preview blockquote { padding: 99px; }'));
    expect(drifted.get('.md-preview blockquote')?.get('padding')).toBe('99px');
    expect(drifted.get('.md-preview blockquote')?.get('padding')).not.toBe(
      EXPORT.get('.md-preview blockquote')?.get('padding')
    );
  });

  it('打印态：两侧都在 .pagebreak 上分页', () => {
    const pick = (rules: Map<string, Map<string, string>>) =>
      [...rules.entries()].filter(
        ([sel]) => sel.startsWith('@media print') && sel.endsWith('.md-preview .pagebreak')
      );

    const web = pick(WEB);
    const exp = pick(EXPORT);
    expect(web, 'Web 预览缺少 @media print 分页规则').not.toHaveLength(0);
    expect(exp, '导出 CSS 缺少 @media print 分页规则').not.toHaveLength(0);

    for (const [, decls] of [...web, ...exp]) {
      expect(decls.get('page-break-after')).toBe('always');
      expect(decls.get('break-after')).toBe('page');
    }
  });

  it('两侧都不留 body 默认外边距（暗色下会露出白边）', () => {
    expect(EXPORT.get('body')?.get('margin')).toBe('0');
    expect(WEB.get('body')?.get('margin')).toBe('0');
  });

  it('末尾分页符不额外产生空白页', () => {
    const has = (rules: Map<string, Map<string, string>>) =>
      [...rules.entries()].some(
        ([sel, decls]) =>
          sel.startsWith('@media print') &&
          sel.endsWith('.md-preview .pagebreak:last-child') &&
          decls.get('page-break-after') === 'auto'
      );
    expect(has(EXPORT)).toBe(true);
    expect(has(WEB)).toBe(true);
  });
});

describe('主题令牌', () => {
  it('导出 CSS 内联了全部亮色令牌', () => {
    for (const [key, value] of Object.entries(THEME_VARIABLES)) {
      expect(EXPORT_CSS).toContain(`${key}: ${value};`);
    }
  });

  it('暗色主题覆盖色值但不新增令牌', () => {
    const light = getThemeVariables('light');
    const dark = getThemeVariables('dark');
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(dark['--md-color-bg']).not.toBe(light['--md-color-bg']);
  });

  it('引用块等着底文字使用 AA 达标的专用令牌', () => {
    expect(THEME_VARIABLES['--md-color-muted-quote']).toBeDefined();
    expect(THEME_VARIABLES['--md-color-muted-quote']).not.toBe(THEME_VARIABLES['--md-color-muted']);
    expect(EXPORT.get('.md-preview blockquote')?.get('color')).toBe('var(--md-color-muted-quote)');
  });

  it('阅读态排版走令牌而非硬编码', () => {
    expect(THEME_VARIABLES['--md-reading-font-size']).toBeDefined();
    expect(THEME_VARIABLES['--md-reading-line-height']).toBeDefined();
    expect(WEB_CSS).toMatch(/reading-mode[^{]*\.md-preview[^{]*\{[^}]*var\(--md-reading-font-size/);
    expect(WEB_CSS).toMatch(/reading-mode[^{]*\.md-preview[^{]*\{[^}]*var\(--md-reading-line-height/);
  });

  it('不再保留 --md-border 旧别名', () => {
    expect(EXPORT_CSS).not.toContain('--md-border:');
    expect(WEB_CSS).not.toContain('var(--md-border)');
  });
});
