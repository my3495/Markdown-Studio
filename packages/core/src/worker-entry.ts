/**
 * 渲染 Worker 专用入口。
 *
 * 为什么不直接用包根入口：`src/index.ts` 会把 MCP / REST / Git / 同步 / 加密 等
 * 全部模块一并 re-export。浏览器端的生产构建能靠 tree-shaking 丢掉没用到的部分，
 * 但 **dev 模式（vite serve）不做 tree-shaking**，Worker 里加载根入口会连带执行那些
 * 只在 Node 下成立的模块，实测直接抛 `ReferenceError: document is not defined`，
 * Worker 随即失败、静默回退主线程 —— 表现为「优化上线了但一点没变快」。
 *
 * 因此单开一个最小入口：只暴露渲染管线与高亮预热。
 */
export { render } from './parser/pipeline';
export { warmupHighlight, clearHighlightCache } from './parser/plugins/rehype-shiki';
export type { RenderOptions, RenderResult, TocItem, TypographyWarning } from './types';
