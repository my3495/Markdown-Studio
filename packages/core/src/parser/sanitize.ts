import { defaultSchema } from 'rehype-sanitize';

/**
 * 在默认安全 schema 基础上：
 * - 允许 `style`：保留用户内联样式（rehype-sanitize 会净化 style 内部危险值）
 * - 允许 `data-line`：滚动同步系统元数据（在 data-line 插件中注入，位于 sanitize 之后，本白名单为防御性冗余）
 * - 允许 `className`：预览区样式（`md-toc` 等）依赖它
 * - 允许 `role`：正文内目录容器用 `role="navigation"` 表达语义
 * - 放行 `mark`：`<mark>高亮</mark>` 是 Markdown 文档里的常用内联语义标签，
 *   但 rehype-sanitize 的 defaultSchema 未收录（审计发现预览/导出都会把它连同内容剥掉），
 *   该标签无脚本执行能力，放行不扩大 XSS 面（`<script>`/事件属性/`javascript:` 仍被剥离）。
 * 说明：rehype-katex / shiki 输出在 sanitize 之后注入，其样式不受此约束，保证公式与高亮可显示。
 */
let cachedSchema: any = null;

export function buildSanitizeSchema(): any {
  // schema 与渲染输入无关，每次 render() 都展开一遍 defaultSchema（上百个键）纯属浪费
  if (cachedSchema) return cachedSchema;
  cachedSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), 'mark'],
    attributes: {
      ...defaultSchema.attributes,
      '*': [
        ...(defaultSchema.attributes?.['*'] ?? []),
        'style',
        'data-line',
        'className',
        'role',
      ],
    },
  };
  return cachedSchema;
}
