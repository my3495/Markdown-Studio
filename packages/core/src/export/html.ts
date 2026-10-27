import { toHtml } from 'hast-util-to-html';
import { render } from '../parser/pipeline';
import { buildBaseCss, getThemeVariables } from '../renderer/styles';
import { buildFooter, FooterOptions } from '../renderer/footer';
import type { RenderOptions } from '../types';

export interface ExportHtmlOptions {
  title?: string;
  mode?: 'light' | 'dark';
  /** 覆盖/补充主题变量 */
  customVars?: Record<string, string>;
  /** 覆盖默认基础 CSS */
  baseCss?: string;
  /** KaTeX CSS（由 web 通过 ?raw 注入，保证离线样式完整） */
  katexCss?: string;
  footer?: FooterOptions;
}

/**
 * 导出 HTML：单文件、内联样式、离线可用（US-08）。
 * 通过 re-render 得到 hast，序列化后包裹完整文档。
 */
export async function exportHtml(
  md: string,
  renderOpts: RenderOptions = {},
  exportOpts: ExportHtmlOptions = {}
): Promise<string> {
  const mode = exportOpts.mode ?? 'light';
  const { hast } = await render(md, {
    ...renderOpts,
    highlightTheme: mode === 'dark' ? 'dark' : 'light',
  });
  const body = toHtml(hast, { allowDangerousHtml: true });
  const vars = {
    ...getThemeVariables(mode),
    ...(exportOpts.customVars ?? {}),
  };
  const css = exportOpts.baseCss ?? buildBaseCss(vars);
  const katex = exportOpts.katexCss ?? '';
  const footer = buildFooter(exportOpts.footer ?? { enabled: true });
  const title = exportOpts.title ?? 'Markdown Studio';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
${katex ? `<style>${katex}</style>` : ''}
</head>
<body>
<article class="md-preview">${body}</article>
${footer}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  );
}
