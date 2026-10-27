import {
  buildPandocCommand,
  exportHtml,
  markdownToLatexLite,
  suggestPandocOutput,
  type FooterOptions,
  type PandocFormat,
  type RenderOptions,
} from '@md-studio/core';
import katexCss from 'katex/dist/katex.min.css?raw';
import { toPng } from 'html-to-image';

export interface ExportMeta {
  title?: string;
  mode?: 'light' | 'dark';
  footer?: FooterOptions;
  renderOpts?: RenderOptions;
}

/** 生成可独立打开的单文件 HTML（US-08） */
export async function buildHtmlDoc(md: string, meta: ExportMeta = {}): Promise<string> {
  return exportHtml(md, meta.renderOpts ?? {}, {
    title: meta.title,
    mode: meta.mode ?? 'light',
    footer: meta.footer ?? { enabled: true },
    katexCss,
  });
}

export function downloadHtml(md: string, meta: ExportMeta = {}) {
  buildHtmlDoc(md, meta)
    .then((html) => {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${meta.title ?? 'export'}.html`;
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch((e) => console.error('[Exporter] HTML 下载失败', e));
}

/** F2：可离线分发的只读分享 HTML（单文件，不依赖 IndexedDB） */
export function downloadShareHtml(md: string, meta: ExportMeta = {}) {
  buildHtmlDoc(md, {
    ...meta,
    footer: {
      enabled: true,
      text: meta.footer?.text ?? 'Markdown Studio · 只读分享',
      link: meta.footer?.link,
    },
  })
    .then((html) => {
      const banner =
        '<div style="position:sticky;top:0;z-index:9;padding:8px 16px;background:#0f172a;color:#e2e8f0;font:13px/1.4 system-ui,sans-serif;">只读分享 · Read-only share</div>';
      const out = html.replace(/<body([^>]*)>/i, `<body$1>${banner}`);
      const blob = new Blob([out], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(meta.title ?? 'share').replace(/\.mdx?$/i, '')}-share.html`;
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch((e) => console.error('[Exporter] Share HTML 下载失败', e));
}

export function printPdf(md: string, meta: ExportMeta = {}) {
  buildHtmlDoc(md, meta)
    .then((html) => {
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write(html);
      w.document.close();
      w.addEventListener('load', () => w.print());
    })
    .catch((e) => console.error('[Exporter] PDF 打印准备失败', e));
}

/** 分享卡片：选区文本 → PNG（带标题/水印，US 分享卡片） */
export async function exportShareCard(text: string, title: string) {
  const card = document.createElement('div');
  card.style.cssText =
    'position:fixed;left:-9999px;top:0;width:600px;padding:40px;background:#fff;color:#24292e;font-family:sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.15);border-radius:12px;';
  card.innerHTML = `<div style="font-size:13px;color:#0366d6;margin-bottom:12px;">${escapeHtml(
    title
  )}</div><div style="font-size:20px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(
    text
  )}</div><div style="margin-top:24px;font-size:12px;color:#6a737d;">由 Markdown Studio 生成</div>`;
  document.body.appendChild(card);
  try {
    const dataUrl = await toPng(card, { pixelRatio: 2 });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'share-card.png';
    a.click();
  } finally {
    document.body.removeChild(card);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  );
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Pandoc 导出（F1）：
 * - latex：浏览器内 lite 转换直接下载 .tex
 * - docx/epub/pdf：下载源 .md，并复制本机 pandoc 命令到剪贴板
 */
export async function exportViaPandoc(
  md: string,
  format: PandocFormat,
  title = 'export'
): Promise<{ mode: 'download' | 'command'; command?: string }> {
  const base = title.replace(/\.[^.]+$/, '') || 'export';
  if (format === 'latex') {
    downloadBlob(markdownToLatexLite(md), `${base}.tex`, 'application/x-tex;charset=utf-8');
    return { mode: 'download' };
  }
  const mdName = `${base}.md`;
  downloadBlob(md, mdName, 'text/markdown;charset=utf-8');
  const out = suggestPandocOutput(mdName, format);
  const command = buildPandocCommand(mdName, out, format);
  try {
    await navigator.clipboard.writeText(command);
  } catch {
    /* 剪贴板不可用时仍返回命令供提示 */
  }
  return { mode: 'command', command };
}
