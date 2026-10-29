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

/** 已知的文档扩展名：只剥这些 */
const KNOWN_DOC_EXT = /\.(md|markdown|mdx|txt)$/i;

/**
 * 文档名 → 输出基名。
 *
 * 只剥离白名单扩展名：早期用 `/\.[^.]+$/` 会把 `v1.2 说明` 的 `.2 说明` 当成
 * 扩展名剥掉，导出成 `v1.md`，连续导出还会互相覆盖。
 */
export function docBase(title: string | undefined, fallback = 'export'): string {
  const cleaned = (title ?? '').trim().replace(KNOWN_DOC_EXT, '').trim();
  return cleaned || fallback;
}

/**
 * 清洗文件名，保证在 Windows / macOS 都能落盘。
 *
 * - `\ / : * ? " < > |` 与不可见控制字符 → `_`
 * - 去掉结尾的点和空格（Windows 会静默丢弃，导致「文件名变了」）
 * - 按 UTF-8 字节截断到 200B（Windows 单个路径段上限 255B，给扩展名与重名后缀留余量）
 */
export function sanitizeFileName(name: string, maxBytes = 200): string {
  const safe = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  const base = safe || 'export';

  let out = '';
  let bytes = 0;
  for (const ch of base) {
    const size = new TextEncoder().encode(ch).length;
    if (bytes + size > maxBytes) break;
    out += ch;
    bytes += size;
  }
  return out.replace(/[. ]+$/, '') || 'export';
}

/** 生成可独立打开的单文件 HTML（US-08） */
export async function buildHtmlDoc(md: string, meta: ExportMeta = {}): Promise<string> {
  return exportHtml(md, meta.renderOpts ?? {}, {
    // <title> 用去扩展名的基名：`稿件 A.md` → `稿件 A`
    title: docBase(meta.title, 'Markdown Studio'),
    mode: meta.mode ?? 'light',
    footer: meta.footer ?? { enabled: true },
    katexCss,
  });
}

/**
 * 延迟释放 blob URL。
 * 浏览器在 click 之后才真正开始读 blob，同步 revoke 在 Firefox/Safari 会取消下载。
 *
 * 必须判存在：jsdom 没有 `URL.revokeObjectURL`，定时器回调在测试收尾后触发会抛
 * 未捕获异常，连累整轮 vitest 以非 0 退出（表现为「用例全绿但命令失败」）。
 */
function scheduleRevoke(url: string) {
  setTimeout(() => {
    if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  }, 1000);
}

export function downloadHtml(md: string, meta: ExportMeta = {}) {
  buildHtmlDoc(md, meta)
    .then((html) => {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // 文档名通常带 .md，直接拼会得到 `note.md.html`；先剥掉已知扩展名再清洗
      a.download = `${sanitizeFileName(docBase(meta.title))}.html`;
      a.click();
      scheduleRevoke(url);
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
      // 必须锚定在 </head> 之后再找 <body>：导出 CSS 的注释里就写着 `<body>`
      // （用于说明 body 外边距），只按 `<body` 匹配会把横幅插进样式注释里，
      // 结果横幅不可见、CSS 还被提前截断。
      const out = html.replace(/(<\/head>[\s\S]*?<body[^>]*>)/i, `$1${banner}`);
      const blob = new Blob([out], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFileName(docBase(meta.title, 'share'))}-share.html`;
      a.click();
      scheduleRevoke(url);
    })
    .catch((e) => console.error('[Exporter] Share HTML 下载失败', e));
}

export type PrintPdfResult =
  | { ok: true }
  | { ok: false; reason: 'popup-blocked' | 'render-failed' };

/**
 * 浏览器打印转 PDF。
 *
 * 返回结果而不是静默吞掉：弹窗被拦截时用户点了导出却什么都看不到，
 * 必须有明确反馈（调用方负责 toast）。
 */
export async function printPdf(md: string, meta: ExportMeta = {}): Promise<PrintPdfResult> {
  try {
    const html = await buildHtmlDoc(md, meta);
    const w = window.open('', '_blank');
    if (!w) return { ok: false, reason: 'popup-blocked' };
    w.document.write(html);
    w.document.close();
    w.addEventListener('load', () => w.print());
    return { ok: true };
  } catch (e) {
    console.error('[Exporter] PDF 打印准备失败', e);
    return { ok: false, reason: 'render-failed' };
  }
}

/**
 * 分享卡片：选区文本 → PNG（带标题/水印，US 分享卡片）。
 * 返回是否成功：外链图片跨域等情况会让 toPng 抛错，调用方需要提示。
 */
export async function exportShareCard(text: string, title: string): Promise<boolean> {
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
    return true;
  } catch (e) {
    console.error('[Exporter] 分享卡片生成失败', e);
    return false;
  } finally {
    card.remove();
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
  scheduleRevoke(url);
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
  // 只剥已知扩展名并清洗非法字符：`v1.2 说明` 不能被截成 `v1`
  const base = sanitizeFileName(docBase(title));
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
