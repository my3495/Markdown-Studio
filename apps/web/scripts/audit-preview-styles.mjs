/**
 * 预览元素样式基线审计（可复现）
 *
 * 用法：
 *   1) 先启动 dev server： pnpm --filter @md-studio/web dev
 *   2) node scripts/audit-preview-styles.mjs [--theme=light|dark|both]
 *
 * 输出：每个元素的真实 computedStyle 关键属性 + 按 WCAG 2.1 计算的前景/背景对比度。
 * 判定阈值：正文 4.5:1（AA）、大字号（>=18.66px 且 bold，或 >=24px）3:1。
 *
 * 注意：选择器刻意用 `>` 直接子级限定，避免 [TOC] 内的 .md-toc-title(p) / .md-toc a
 * 污染 p 与 a 的采样结果（这是初版审计踩过的坑）。
 */
import { chromium } from '@playwright/test';

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:5173/';
const THEME_ARG = (process.argv.find((a) => a.startsWith('--theme=')) ?? '--theme=both').split('=')[1];
const THEMES = THEME_ARG === 'both' ? ['light', 'dark'] : [THEME_ARG];

const SAMPLE = `[TOC]

# 一级标题 H1

## 二级标题 H2

### 三级标题 H3

#### 四级标题 H4

##### 五级标题 H5

###### 六级标题 H6

正文段落，含 **加粗**、*斜体*、~~删除线~~、\`行内代码\`、[普通链接](https://example.com)、<mark>高亮</mark>、<kbd>Ctrl</kbd>、<sup>上标</sup>、<sub>下标</sub>。

> 引用块第一段
>
> 引用块第二段

- 无序一级
  - 无序二级
    - 无序三级
- 无序回一级

1. 有序一级
2. 有序二级项
   1. 有序嵌套
      1. 有序三层

- [ ] 未完成任务
- [x] 已完成任务

| 表头 A | 表头 B |
| ------ | ------ |
| 单元格 1 | \`代码\` |
| 单元格 2 | 值 |

\`\`\`js
const answer = 42;
\`\`\`

---

行内公式 $E=mc^2$。

$$
a^2 + b^2 = c^2
$$

<!-- pagebreak -->

脚注引用[^1]。

[^1]: 脚注内容。

<details><summary>折叠标题</summary>

折叠内容。

</details>
`;

/** label → 选择器（顺序即报告顺序） */
const TARGETS = [
  ['容器', '.md-preview'],
  ['h1', '.md-preview > h1'],
  ['h2', '.md-preview > h2'],
  ['h3', '.md-preview > h3'],
  ['h4', '.md-preview > h4'],
  ['h5', '.md-preview > h5'],
  ['h6', '.md-preview > h6'],
  ['p', '.md-preview > p'],
  ['a', '.md-preview > p a'],
  ['strong', '.md-preview > p strong'],
  ['em', '.md-preview > p em'],
  ['del', '.md-preview > p del'],
  ['mark', '.md-preview > p mark'],
  ['kbd', '.md-preview > p kbd'],
  ['code(行内)', '.md-preview > p code'],
  ['pre', '.md-preview pre'],
  ['pre > code', '.md-preview pre code'],
  ['blockquote', '.md-preview blockquote'],
  ['ul(lv0)', '.md-preview > ul'],
  ['ol(lv0)', '.md-preview > ol'],
  ['li', '.md-preview > ul > li'],
  ['table', '.md-preview table'],
  ['th', '.md-preview th'],
  ['td', '.md-preview td'],
  ['hr', '.md-preview > hr'],
  ['div.pagebreak', '.md-preview .pagebreak'],
  ['.md-toc', '.md-preview .md-toc'],
  ['.md-toc a', '.md-preview .md-toc a'],
  ['.footnotes', '.md-preview .footnotes, .md-preview section[data-footnotes]'],
  ['details', '.md-preview details'],
  ['summary', '.md-preview summary'],
  ['sup', '.md-preview > p sup'],
  ['.katex', '.md-preview .katex'],
  ['input[checkbox]', '.md-preview input[type="checkbox"]'],
];

function srgb(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]) {
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function contrast(fg, bg) {
  const L1 = luminance(fg);
  const L2 = luminance(bg);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
function blend(fg, bg, a) {
  return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a)));
}

/**
 * 解析颜色字符串 → {rgb:[r,g,b], a}
 * 需要同时支持 rgb()/rgba() 与 color(srgb r g b / a)：
 * Chrome 会把 color-mix() 的计算结果序列化为后者，初版审计只认 rgb() 导致 NaN。
 */
function parseColor(s) {
  const str = s || '';
  const m = /rgba?\(([^)]+)\)/.exec(str);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    if (p.length >= 3) {
      return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
    }
  }
  const c = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(str);
  if (c) {
    return {
      rgb: [c[1], c[2], c[3]].map((v) => Math.round(parseFloat(v) * 255)),
      a: c[4] !== undefined ? parseFloat(c[4]) : 1,
    };
  }
  return null;
}

async function inject(page) {
  await page.waitForSelector('.cm-editor', { timeout: 60_000 });
  await page.evaluate((md) => {
    const el = document.querySelector('.cm-editor');
    const view = el.__md_view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: md } });
  }, SAMPLE);
  await page.waitForSelector('.md-preview h1', { timeout: 60_000 });
  await page.waitForTimeout(1600);
}

async function probe(page) {
  return page.evaluate((targets) => {
    // 与 Node 侧同构的解析（浏览器内先转成统一结构）
    const parse = (s) => {
      const str = s || '';
      const m = /rgba?\(([^)]+)\)/.exec(str);
      if (m) {
        const p = m[1].split(',').map(Number);
        if (p.length >= 3) return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
      }
      const c = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(str);
      if (c) {
        return {
          rgb: [c[1], c[2], c[3]].map((v) => Math.round(parseFloat(v) * 255)),
          a: c[4] !== undefined ? parseFloat(c[4]) : 1,
        };
      }
      return null;
    };
    const out = [];
    for (const [label, sel] of targets) {
      const el = document.querySelector(sel);
      if (!el) {
        out.push({ label, sel, missing: true });
        continue;
      }
      const cs = getComputedStyle(el);
      const layers = [];
      let n = el;
      while (n) {
        const bg = parse(getComputedStyle(n).backgroundColor);
        if (bg && bg.a > 0) {
          layers.push(bg);
          if (bg.a >= 1) break;
        }
        n = n.parentElement;
      }
      if (layers.length === 0 || layers[layers.length - 1].a < 1) {
        layers.push({ rgb: [255, 255, 255], a: 1 });
      }
      out.push({
        label,
        sel,
        color: cs.color,
        ownBg: cs.backgroundColor,
        bgLayers: layers,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        marginTop: cs.marginTop,
        marginBottom: cs.marginBottom,
        paddingTop: cs.paddingTop,
        paddingLeft: cs.paddingLeft,
        borderBottomWidth: cs.borderBottomWidth,
        borderLeftWidth: cs.borderLeftWidth,
        borderRadius: cs.borderTopLeftRadius,
        listStyleType: cs.listStyleType,
        textDecorationLine: cs.textDecorationLine,
        fontStyle: cs.fontStyle,
        height: cs.height,
      });
    }
    return out;
  }, TARGETS);
}

function report(rows, theme) {
  console.log(`\n================ THEME: ${theme} ================`);
  console.log(
    '元素 | font | weight | color | bg(合成) | 对比度 | AA | margin(t/b) | padding(t/l) | 其他'
  );
  console.log('-'.repeat(140));
  const issues = [];
  for (const r of rows) {
    if (r.missing) {
      console.log(`${r.label} | ✗ 元素未渲染（${r.sel}）`);
      issues.push(`${r.label}: 元素未渲染（可能被 sanitize 剥离）`);
      continue;
    }
    const fg = parseColor(r.color);
    let bg = r.bgLayers[r.bgLayers.length - 1].rgb;
    for (let i = r.bgLayers.length - 2; i >= 0; i--) {
      bg = blend(r.bgLayers[i].rgb, bg, r.bgLayers[i].a);
    }
    let cr = NaN;
    if (fg) {
      const effectiveFg = fg.a >= 1 ? fg.rgb : blend(fg.rgb, bg, fg.a);
      cr = contrast(effectiveFg, bg);
    }
    const fs = parseFloat(r.fontSize);
    const bold = parseInt(r.fontWeight, 10) >= 700;
    const large = fs >= 24 || (fs >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const pass = cr >= need;
    if (!Number.isNaN(cr) && !pass) issues.push(`${r.label}: 对比度 ${cr.toFixed(2)}:1 < ${need}:1`);

    const isList = /^(ul|ol|li)/.test(r.label);
    const extra = [
      isList ? `list:${r.listStyleType}` : '',
      r.borderBottomWidth !== '0px' ? `bb:${r.borderBottomWidth}` : '',
      r.borderLeftWidth !== '0px' ? `bl:${r.borderLeftWidth}` : '',
      r.borderRadius !== '0px' ? `r:${r.borderRadius}` : '',
      r.textDecorationLine !== 'none' ? `td:${r.textDecorationLine}` : '',
      r.fontStyle !== 'normal' ? `style:${r.fontStyle}` : '',
      /rgba\(0, 0, 0, 0\)/.test(r.ownBg) ? 'bg:transparent' : `bg:${r.ownBg}`,
      r.label.includes('pagebreak') ? `h:${r.height}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    console.log(
      [
        r.label,
        r.fontSize,
        r.fontWeight,
        Number.isNaN(cr) ? `color=${r.color}` : r.color.replace(/\s+/g, ''),
        `rgb(${bg.join(',')})`,
        Number.isNaN(cr) ? 'NaN' : `${cr.toFixed(2)}:1`,
        Number.isNaN(cr) ? '?' : pass ? '✓' : '✗',
        `${r.marginTop}/${r.marginBottom}`,
        `${r.paddingTop}/${r.paddingLeft}`,
        extra || '-',
      ].join(' | ')
    );
  }
  if (issues.length) {
    console.log('-- 问题 --');
    issues.forEach((i) => console.log('  • ' + i));
  }
  return issues;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const summary = {};

for (const theme of THEMES) {
  await page.goto(BASE);
  await page.evaluate((t) => {
    const key = 'md-studio:settings';
    const raw = localStorage.getItem(key);
    const s = raw ? JSON.parse(raw) : {};
    s.theme = t;
    localStorage.setItem(key, JSON.stringify(s));
  }, theme);
  await page.reload();
  await inject(page);
  const rows = await probe(page);
  summary[theme] = report(rows, theme);
}

await browser.close();
console.log('\n[done]');
