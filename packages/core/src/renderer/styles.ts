/**
 * 主题系统（v1.1）：CSS 变量层。
 * ADR-23：主题用 CSS 变量，v1.1 不开放任意 CSS（防破坏布局）。
 */
export const THEME_VARIABLES: Record<string, string> = {
  '--md-font-family':
    "'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, -apple-system, sans-serif",
  /** 等宽字体：导出 HTML 没有 Web 的 :root 兜底，必须在此声明，否则回落到 ui-monospace。 */
  '--md-font-mono':
    "'SFMono-Regular', 'JetBrains Mono', Consolas, 'Liberation Mono', monospace",
  '--md-font-size': '16px',
  '--md-line-height': '1.75',
  '--md-max-width': '780px',
  /**
   * 阅读态（reading-mode）：只放正文排版，放大一档字号并略放宽行高。
   * 与 Web 的 `.app-shell.reading-mode .md-preview` 共用，避免两处硬编码漂移。
   */
  '--md-reading-font-size': '1.08rem',
  '--md-reading-line-height': '1.8',
  '--md-color-fg': '#26221d',
  '--md-color-bg': '#ffffff',
  '--md-color-surface': '#f7f5f1',
  '--md-color-surface-2': '#efece6',
  '--md-color-accent': '#a9501d',
  '--md-color-accent-soft': 'rgba(169,80,29,0.10)',
  '--md-color-accent-contrast': '#ffffff',
  '--md-color-muted': '#7d756b',
  /**
   * 引用块/脚注等「着底降级文字」专用色。
   * 直接用 --md-color-muted 时在 --md-color-surface 上只有 4.17:1，未达 WCAG AA 4.5:1；
   * 该令牌在 surface 上为 5.42:1。不要用它替换全局 muted（会影响侧栏等大面积 UI）。
   */
  '--md-color-muted-quote': '#6b6359',
  '--md-color-danger': '#c4314b',
  '--md-color-border': '#e7e1d8',
  '--md-color-border-strong': '#d6cec2',
  '--md-code-bg': '#f6f2ec',
  '--md-code-fg': '#26221d',
  '--md-radius-sm': '7px',
  '--md-radius': '10px',
  '--md-radius-lg': '16px',
  '--md-radius-full': '999px',
  '--md-shadow-sm': '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.08)',
  '--md-shadow': '0 6px 18px rgba(16,24,40,0.08)',
  '--md-shadow-lg': '0 18px 44px rgba(16,24,40,0.14)',
  '--md-control-h': '36px',
  '--md-transition': '160ms cubic-bezier(0.4,0,0.2,1)',
};

const DARK_VARIABLES: Record<string, string> = {
  ...THEME_VARIABLES,
  '--md-color-fg': '#ece5da',
  '--md-color-bg': '#1a1815',
  '--md-color-surface': '#221f1b',
  '--md-color-surface-2': '#2b2721',
  '--md-color-accent': '#df8a4e',
  '--md-color-accent-soft': 'rgba(223,138,78,0.16)',
  '--md-color-accent-contrast': '#1a1208',
  '--md-color-muted': '#a79d90',
  '--md-color-muted-quote': '#b3a99c',
  '--md-color-danger': '#ff7b72',
  '--md-color-border': '#3a342c',
  '--md-color-border-strong': '#4b4338',
  '--md-code-bg': '#221f1b',
  '--md-code-fg': '#ece5da',
  '--md-shadow-sm': '0 1px 2px rgba(0,0,0,0.5)',
  '--md-shadow': '0 8px 22px rgba(0,0,0,0.5)',
  '--md-shadow-lg': '0 22px 52px rgba(0,0,0,0.6)',
};

export function getThemeVariables(mode: 'light' | 'dark'): Record<string, string> {
  return mode === 'dark' ? DARK_VARIABLES : THEME_VARIABLES;
}

/**
 * 生成基础排版 CSS（变量 + 文档容器 + 元素基线）。
 *
 * 该字符串是**导出/分享 HTML 的唯一样式来源**。它必须与 Web 预览的
 * `apps/web/src/styles/index.css` 中 `.md-preview` 段保持同一套基线，
 * 否则同一份文档在「预览」与「导出」下长相不同（审计发现 P0-4）。
 * 一致性由 `packages/core/tests/preview-baseline.test.ts` 的关键属性断言守卫。
 */
export function buildBaseCss(vars: Record<string, string> = THEME_VARIABLES): string {
  const varLines = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');

  return `:root{
${varLines}
}
/* 导出页被 <article class="md-preview"> 包裹在 <body> 里，浏览器默认 body 有 8px 外边距：
 * 暗色主题下会在文档四周露出一圈白边，且与 Web 预览（body{margin:0}）不一致。 */
html,body{ margin: 0; padding: 0; background: var(--md-color-bg); }
.md-preview{
  font-family: var(--md-font-family);
  font-size: var(--md-font-size);
  line-height: var(--md-line-height);
  color: var(--md-color-fg);
  background: var(--md-color-bg);
  max-width: var(--md-max-width);
  margin: 0 auto;
  /* 与 Web 预览一致：窄容器时收窄内边距，避免正文只剩十来个字宽 */
  padding: 40px clamp(16px, 5.5%, 48px) 64px;
}
.md-preview h1,.md-preview h2,.md-preview h3,.md-preview h4,.md-preview h5,.md-preview h6{
  line-height: 1.3; margin: 1.6em 0 .6em; font-weight: 700; letter-spacing: .2px;
}
.md-preview h1{ font-size: 1.9em; border-bottom: 1px solid var(--md-color-border); padding-bottom:.3em; }
.md-preview h2{ font-size: 1.5em; border-bottom: 1px solid var(--md-color-border); padding-bottom:.3em; }
.md-preview h3{ font-size: 1.25em; }
.md-preview h4{ font-size: 1.1em; }
.md-preview h5{ font-size: 1em; }
.md-preview h6{ font-size: .95em; color: var(--md-color-muted); }
.md-preview p{ margin: .85em 0; }
.md-preview a{
  color: var(--md-color-accent); text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--md-color-accent) 40%, transparent);
}
/* color-mix 需分两条声明：不支持时保留纯前景色兜底 */
.md-preview a:hover{ border-bottom-color: var(--md-color-accent); }
.md-preview strong{
  font-weight: 700;
  color: var(--md-color-fg);
  color: color-mix(in srgb, var(--md-color-fg) 88%, var(--md-color-accent));
}
.md-preview em{ font-style: italic; }
.md-preview mark{
  background: color-mix(in srgb, var(--md-color-accent) 22%, transparent);
  color: inherit; padding: 0 .15em; border-radius: 3px;
}
.md-preview kbd{
  font-family: var(--md-font-mono); font-size: .85em;
  padding: .15em .4em; border-radius: 5px;
  border: 1px solid var(--md-color-border); border-bottom-width: 2px;
  background: var(--md-color-surface-2);
}
.md-preview code{
  font-family: var(--md-font-mono);
  background: var(--md-code-bg); color: var(--md-code-fg);
  padding: .2em .45em; border-radius: 6px; font-size: .88em;
  border: 1px solid var(--md-color-border);
}
.md-preview pre{
  background: var(--md-code-bg); color: var(--md-code-fg);
  padding: 16px 18px; border-radius: var(--md-radius);
  border: 1px solid var(--md-color-border); box-shadow: var(--md-shadow-sm);
  overflow: auto; margin: 1.1em 0; tab-size: 4;
}
.md-preview pre code{ background: transparent; padding: 0; border: none; font-size: .9em; }
/* Shiki 会把主题色写成 <pre style="background-color:…">，内联优先级高于类选择器，
 * 导致代码块底色脱离 --md-code-bg（与行内 code 出现两种底色）。此处定向压回令牌色。 */
.md-preview pre.shiki{ background: var(--md-code-bg) !important; }
.md-preview blockquote{
  margin: 1.1em 0; padding: 10px 16px;
  color: var(--md-color-muted-quote);
  background: var(--md-color-surface);
  border-left: 4px solid var(--md-color-accent);
  border-radius: 0 var(--md-radius-sm) var(--md-radius-sm) 0;
}
.md-preview blockquote p{ margin: .3em 0; }
.md-preview ul, .md-preview ol{ padding-left: 1.5em; }
.md-preview ul{ list-style: disc outside; }
.md-preview ul ul{ list-style: circle outside; }
.md-preview ul ul ul{ list-style: square outside; }
.md-preview ol{ list-style: decimal outside; }
.md-preview ol ol{ list-style: lower-alpha outside; }
.md-preview ol ol ol{ list-style: lower-roman outside; }
.md-preview ul.contains-task-list,
.md-preview ul ul.contains-task-list,
.md-preview ul ul ul.contains-task-list,
.md-preview .md-toc ul,
.md-preview .md-toc ul ul,
.md-preview .md-toc ul ul ul{ list-style: none; }
.md-preview li{ margin: .3em 0; }
.md-preview table{
  border-collapse: separate; border-spacing: 0; width: 100%;
  margin: 1.2em 0; font-size: .95em;
  border: 1px solid var(--md-color-border); border-radius: var(--md-radius-sm);
  overflow: hidden;
}
.md-preview th, .md-preview td{
  padding: 8px 14px; border-bottom: 1px solid var(--md-color-border); text-align: left;
}
.md-preview thead th{ background: var(--md-color-surface-2); font-weight: 600; }
.md-preview tbody tr:last-child td{ border-bottom: none; }
.md-preview tbody tr:hover{ background: var(--md-color-surface); }
.md-preview img{
  max-width: 100%; border-radius: var(--md-radius-sm); box-shadow: var(--md-shadow-sm);
}
.md-preview hr{ border: none; border-top: 1px solid var(--md-color-border); margin: 2em 0; }
/* 分页符：DOM 实际是 <div class="pagebreak">（见 remark-pagebreak），
 * 旧规则只写了 hr.pagebreak，导致分页符在预览里高度为 0、完全不可见。 */
.md-preview .pagebreak{
  border: none; border-top: 2px dashed var(--md-color-border-strong); margin: 2em 0;
}
.md-preview input[type="checkbox"]{ accent-color: var(--md-color-accent); }
.md-preview .md-toc{
  margin: 1.4em 0; padding: 14px 18px;
  border: 1px solid var(--md-color-border); border-radius: var(--md-radius);
  background: var(--md-color-surface);
}
.md-preview .md-toc-title{ margin: 0 0 .5em; font-weight: 700; font-size: .95em; }
.md-preview .md-toc ul{ margin: 0; padding-left: 1.2em; list-style: none; }
.md-preview .md-toc > ul{ padding-left: 0; }
.md-preview .md-toc li{ margin: .15em 0; position: relative; }
.md-preview .md-toc li::before{
  content: ''; position: absolute; left: -.85em; top: .85em;
  width: 4px; height: 4px; border-radius: 50%;
  background: var(--md-color-border-strong);
}
.md-preview .md-toc > ul > li::before{ background: var(--md-color-accent); }
.md-preview .md-toc a{ color: var(--md-color-fg); text-decoration: none; border-bottom: none; }
.md-preview .md-toc a:hover{
  color: var(--md-color-accent); border-bottom: 1px solid var(--md-color-accent);
}
.md-preview .footnotes{
  margin-top: 2.4em; padding-top: 1em;
  border-top: 1px solid var(--md-color-border);
  font-size: .88em; color: var(--md-color-muted);
}
.md-preview details{
  margin: 1em 0; padding: 8px 12px;
  border: 1px solid var(--md-color-border);
  border-radius: var(--md-radius-sm);
  background: var(--md-color-surface);
}
.md-preview summary{ cursor: pointer; font-weight: 600; }
.mermaid-block{
  text-align: center; margin: 1.2em 0; padding: 16px;
  border: 1px solid var(--md-color-border);
  border-radius: var(--md-radius); background: var(--md-color-surface);
}
.md-footer{
  margin-top: 3rem; padding-top: 1rem;
  border-top: 1px solid var(--md-color-border);
  color: var(--md-color-muted); font-size: .85em; text-align: center;
}
@media print{
  /* 打印/导出 PDF：只去掉阴影与悬停底色，页边距交给浏览器 @page 处理 */
  .md-preview pre{ box-shadow: none; }
  .md-preview img{ box-shadow: none; }
  .md-preview tbody tr:hover{ background: transparent; }
  /* 分页符只在打印时真正分页；末尾的分页符不分页，否则会多出一张空白页 */
  .md-preview .pagebreak{
    page-break-after: always; break-after: page; border: 0; margin: 0; height: 0;
  }
  .md-preview .pagebreak:last-child{ page-break-after: auto; break-after: auto; }
}
`;
}
