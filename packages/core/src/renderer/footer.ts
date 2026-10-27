export interface FooterOptions {
  enabled: boolean;
  /** 页脚文本，默认「由 Markdown Studio 生成」 */
  text?: string;
  /** 可选链接 */
  link?: string;
}

/**
 * 导出页脚（可关，ADR：传播即产品演示）。
 * 文本为受控常量/用户配置，非用户 Markdown 内容，故直接拼接安全。
 */
export function buildFooter(opts: FooterOptions): string {
  if (!opts.enabled) return '';
  const text = opts.text ?? '由 Markdown Studio 生成';
  const link = opts.link
    ? ` · <a href="${encodeURI(opts.link)}">${escapeHtml(opts.link)}</a>`
    : '';
  return `<footer class="md-footer">${escapeHtml(text)}${link}</footer>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  );
}
