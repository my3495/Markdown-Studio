/**
 * 主题系统（v1.1）：CSS 变量层。
 * ADR-23：主题用 CSS 变量，v1.1 不开放任意 CSS（防破坏布局）。
 */
export const THEME_VARIABLES: Record<string, string> = {
  '--md-font-family':
    "'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, -apple-system, sans-serif",
  '--md-font-size': '16px',
  '--md-line-height': '1.75',
  '--md-max-width': '780px',
  '--md-color-fg': '#26221d',
  '--md-color-bg': '#ffffff',
  '--md-color-surface': '#f7f5f1',
  '--md-color-surface-2': '#efece6',
  '--md-color-accent': '#a9501d',
  '--md-color-accent-soft': 'rgba(169,80,29,0.10)',
  '--md-color-accent-contrast': '#ffffff',
  '--md-color-muted': '#7d756b',
  '--md-color-danger': '#c4314b',
  '--md-color-border': '#e7e1d8',
  '--md-color-border-strong': '#d6cec2',
  '--md-border': '#e7e1d8',
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
  '--md-color-danger': '#ff7b72',
  '--md-color-border': '#3a342c',
  '--md-color-border-strong': '#4b4338',
  '--md-border': '#3a342c',
  '--md-code-bg': '#221f1b',
  '--md-code-fg': '#ece5da',
  '--md-shadow-sm': '0 1px 2px rgba(0,0,0,0.5)',
  '--md-shadow': '0 8px 22px rgba(0,0,0,0.5)',
  '--md-shadow-lg': '0 22px 52px rgba(0,0,0,0.6)',
};

export function getThemeVariables(mode: 'light' | 'dark'): Record<string, string> {
  return mode === 'dark' ? DARK_VARIABLES : THEME_VARIABLES;
}

/** 生成基础排版 CSS（变量 + 文档容器 + 代码块 + 表格等） */
export function buildBaseCss(vars: Record<string, string> = THEME_VARIABLES): string {
  const varLines = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');

  return `:root{
${varLines}
}
.md-preview{
  font-family: var(--md-font-family);
  font-size: var(--md-font-size);
  line-height: var(--md-line-height);
  color: var(--md-color-fg);
  background: var(--md-color-bg);
  max-width: var(--md-max-width);
  margin: 0 auto;
  padding: 2rem;
}
.md-preview h1,.md-preview h2,.md-preview h3,.md-preview h4,.md-preview h5,.md-preview h6{
  line-height: 1.3; margin: 1.6em 0 .6em; font-weight: 600;
}
.md-preview h1{ font-size: 1.9em; border-bottom: 1px solid var(--md-border); padding-bottom:.3em; }
.md-preview h2{ font-size: 1.5em; border-bottom: 1px solid var(--md-border); padding-bottom:.3em; }
.md-preview p{ margin: .8em 0; }
.md-preview a{ color: var(--md-color-accent); text-decoration: none; }
.md-preview a:hover{ text-decoration: underline; }
.md-preview code{
  font-family: 'SFMono-Regular', Consolas, monospace;
  background: var(--md-code-bg); color: var(--md-code-fg);
  padding: .2em .4em; border-radius: 4px; font-size: .9em;
}
.md-preview pre{ background: var(--md-code-bg); padding: 1em; border-radius: 8px; overflow:auto; }
.md-preview pre code{ background: transparent; padding: 0; }
.md-preview blockquote{ border-left: 4px solid var(--md-color-accent); margin: 1em 0; padding: .2em 1em; color: var(--md-color-muted); }
.md-preview table{ border-collapse: collapse; width: 100%; margin: 1em 0; }
.md-preview th,.md-preview td{ border: 1px solid var(--md-border); padding: .5em .8em; }
.md-preview img{ max-width: 100%; }
.md-preview hr.pagebreak{ border: none; border-top: 1px dashed var(--md-border); }
.md-preview .md-toc{ margin: 1.4em 0; padding: 14px 18px; border: 1px solid var(--md-border); border-radius: 10px; background: var(--md-color-surface); }
.md-preview .md-toc-title{ margin: 0 0 .5em; font-weight: 700; font-size: .95em; }
.md-preview .md-toc ul{ margin: 0; padding-left: 1.2em; list-style: none; }
.md-preview .md-toc > ul{ padding-left: 0; }
.md-preview .md-toc li{ margin: .15em 0; position: relative; }
.md-preview .md-toc li::before{ content: ''; position: absolute; left: -.85em; top: .85em; width: 4px; height: 4px; border-radius: 50%; background: var(--md-color-border-strong); }
.md-preview .md-toc > ul > li::before{ background: var(--md-color-accent); }
.md-preview .md-toc a{ color: var(--md-color-fg); text-decoration: none; }
.md-preview .md-toc a:hover{ color: var(--md-color-accent); text-decoration: underline; }
.md-footer{ margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--md-border); color: var(--md-color-muted); font-size: .85em; text-align: center; }
@media print { .md-preview .pagebreak, hr.pagebreak{ page-break-after: always; } }
`;
}
