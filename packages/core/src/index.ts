/**
 * @md-studio/core —— 平台无关解析/渲染/排版内核（npm 包）。
 * 供 Web 应用、桌面应用、CLI 共同依赖。
 */
export * from './types';
export * from './parser/pipeline';
export * from './typography';
export * from './renderer/styles';
export * from './renderer/themeTokens';
export * from './renderer/footer';
export * from './version';
export * from './export';
export * from './links/wikilinks';
export * from './search/fts';
export * from './search/embedder';
export * from './graph/graph';
export * from './vault/vault';
export * from './vault/store';
export * from './vault/filter';
export * from './vault/typeschema';
export * from './slides/split';
export * from './frontmatter';
export * from './agent/recipes';
export * from './share/snapshot';
export * from './spell/check';
export * from './spell/dict';
export * from './spell/affix';
export * from './git/helpers';
export * from './git/status';
export * from './whiteboard/tldraw-fence';
export * from './whiteboard/tldraw-bridge';
export * from './crypto/vaultPack';
export * from './crypto/xchacha';
export * from './sync/remote';
export * from './sync/providers';
export * from './editor/headings';
export * from './encoding/detect';
export * from './agent/tokens';
export * from './agent/tools';
export * from './agent/sandbox';
export * from './agent/idempotency';
export * from './agent/context';
export * from './agent/llm';
export * from './agent/toolschema';
export * from './agent/fc';
export * from './mcp/protocol';
export * from './mcp/server';
export * from './mcp/stdio';
export * from './mcp/http';
export * from './rest/api';

// 插件单独导出，便于 CLI / 测试按需复用
export * as plugins from './parser/plugins';
// 高亮预热：应用可在启动空闲期调用，把 shiki 冷启动成本挪出「打开即见」关键路径
export { warmupHighlight, clearHighlightCache } from './parser/plugins/rehype-shiki';
