# Markdown Studio

面向中文技术文档写作的本地优先 Markdown 编辑器（依据《项目开发详细方案 V1.0 Final》落地）。

## 架构（已落地）

```
Markdown-Studio/
├── packages/
│   ├── core/                # 平台无关解析/渲染/排版内核（npm 包 @md-studio/core）
│   └── ui/                  # 预览渲染组件（@md-studio/ui，rehype-react 封装）
├── apps/
│   ├── web/                 # Web 版（React + CodeMirror6 + Vite）—— 可运行
│   └── desktop/             # Tauri 2.0 桌面外壳（需 Rust 工具链，已搭脚手架）
└── .github/workflows/ci.yml
```

核心遵循方案的关键 ADR：
- **ADR-01** 渲染管线输出 `hast`（JSON，可跨 Worker 边界）；Shiki/KaTeX 输出 XSS 免疫。
- **ADR-03** 全局唯一 `EditorView`，多标签通过 `setState` 切换。
- **ADR-04** 净化先行（`rehype-sanitize`），行号 `data-line` 在净化之后注入。
- **ADR-07** Mermaid 在主线程渲染并经 `DOMPurify(SVG)` 二次净化。
- **ADR-12** 输入法组合期间不重建装饰（对焦/打字机模式）。
- **ADR-19/21** 中文排版（护城河 1）+ 标题自动编号均在渲染层，不改源文件。
- **ADR-23** 主题以 CSS 变量实现，默认不开放任意 CSS。

## 运行

```bash
pnpm install
pnpm test            # core 单测（587 个，全过）
pnpm --filter @md-studio/web build   # 构建 Web 应用
pnpm dev             # 启动 Web 开发服务器
```

## 已实现能力

- **核心内核**（`@md-studio/core`）：unified 管线（remark-parse/gfm/math/frontmatter → rehype），中文排版（间距自动修正 + 标点/省略号/引号 lint）、标题自动编号、图像大小（`=WxH`）、分页符、字数统计、TOC 旁路输出。
- **渲染性能**：`render()` 按选项缓存 unified processor（旁路 TOC/lint 上下文改为挂在语法树上，保证复用下的并发隔离）、缓存净化 schema、按 `(theme, lang, code)` 缓存 Shiki 高亮子树并提供 `warmupHighlight()` 预热；`data-line` 锚点只注入块级元素（实测同类文档 2,264 → 约 485 个），预览元素树按 `(hast, components)` 记忆化，滚动同步索引改为「脏标记 + 按需重建」。
- **安全**：默认严格净化，`<script>`/`onerror`/`javascript:` 均被剥离（见 `tests/pipeline.test.ts` 的 XSS 用例）。
- **护城河 1 中文排版**：在渲染期表现为中英/中数间距修正，原文件不变；lint 仅提示。
- **Web 应用**：CodeMirror6 编辑器、单 View 多标签、对焦模式、打字机模式、双向滚动同步（二分 + 双锁 + rAF 节流）、主题/宽度切换、标题编号切换、大纲跳转、导出 HTML/PDF、分享卡片、快捷键（逻辑键跨平台）、设置面板、i18n 骨架。
- **版本快照**（`@md-studio/core/version`）：`.md-studio/history` 存最近 20 版，附 LCS diff（纯逻辑，依赖注入 FS 适配器）。

## 偏离与说明

- **Tauri 桌面端**：本环境无 Rust 工具链，已搭建完整 Tauri 2.0 脚手架（配置/Cargo/Rust 入口/平台适配 `tauriFs`），但无法在此 `tauri build`。Web 与桌面复用同一套 `@md-studio/web` 应用代码。
- **Shiki 主题**：采用内联样式（XSS 免疫），ADR-05 的 class 化 CSP 加固作为后续增强。
- **Worker**：管线可在 Worker 中运行（核心已解耦为纯函数 `render()`）；当前 Web 版在主线程 debounce 调用以简化联调，生产可改为 Worker 投递 hast。
- **Vault 持久化**：Web 用 File System Access（句柄存 IndexedDB 可恢复），桌面用 Tauri fs；侧栏文件树 + 防抖自动保存 + ⌘S 写回。
- **语义检索**：默认离线 HashingEmbedder；设置中可开启远程 HttpEmbedder（Ollama/OpenAI 兼容）。
- **Agent**：OpenAI/Ollama/Claude（Anthropic tools）+ 流式 function-calling。
- **MCP**：`md-studio-mcp config|install` 一键接入；桌面设置可启停本机 HTTP MCP。
- **属性检查器**：侧栏编辑 YAML frontmatter（保留注释/引号）。
- **主题令牌**：设置中可改强调色/字体/宽度等白名单变量。
- **图谱**：缩放、平移、拖节点、过滤。
- **CJK lint**：排版警告以波浪线显示在编辑器。
- **编码探测**：打开文件/Vault 自动识别 UTF-8/GBK/Big5/Shift-JIS。
- **MCP/REST**：`md-studio-mcp --rest` 本机 REST；多 `--workspace` 联邦。
- **幻灯片**：工具栏进入全屏演示（`---` / pagebreak 分页）。
- **本地快照**：保存时写入 IndexedDB 历史（设置可关；非完整 Git）。
- **过滤视图**：侧栏 Inbox + 自定义 frontmatter 视图。
- **移动端**：窄屏编辑/预览/分栏切换。
- **Vim**：设置中开启 CodeMirror Vim 键位。
- **Pandoc**：工具栏导出 LaTeX（内置）或 DOCX/EPUB/PDF（复制本机 pandoc 命令）。
- **类型笔记**：frontmatter `type` 驱动字段建议与类型化关系。
- **Recipes**：保存/手动/定时触发 → Agent 面板预填提示词。
- **白板**：` ```tldraw ` fence；预览内可在轻量 SVG 编辑器与**真实 tldraw 3.4**（懒加载 chunk）间切换，笔迹/直线/矩形/椭圆/箭头/文字六类形状双向转换并防抖写回。
- **分享链接**：生成本机只读 `#share/` URL（短文可内嵌）。
- **拼写**：设置中开启英文轻量拼写检查（可忽略单词）；支持导入 Hunspell `.dic` + `.aff`（词级 flags 过滤、双 affix 链、字符类条件）。
- **历史**：本地快照列表 / diff / 一键恢复。
- **加密包**：口令 PBKDF2+AES-GCM（或 XChaCha20-Poly1305，纯 TS 实现）导出/导入（错误口令失败）。
- **加密同步**：工具栏「同步」向自建 HTTP 端点或 **GitHub / GitLab / Gitee** 仓库文件 push/pull 加密库，按 updatedAt 合并。
- **阅读态**：隐藏源码、预览主导；预览内可直接改标题写回源码。
- **Agent 沙箱**：写工具变更需 Accept/Reject 后才落库。
- **分享 HTML**：复制本地链接同时下载可离线打开的只读 HTML。
- **CI**：`v*` tag 发布 `@md-studio/mcp`、Release 附 sha256sums；桌面签名见 `docs/DESKTOP-SIGNING.md`。
- **Git 面板**：复制本机 commit / `.gitignore` / Agent 分支命令。
- **拼写词典**：设置中导入词表；提示可「加入词典」。
- **分享托管**：见 `docs/SHARE-HOSTING.md`（Pages / Netlify 等）。
- 其余增强见 `docs/NEXT-STEPS.md`。
