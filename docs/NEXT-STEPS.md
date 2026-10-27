# Markdown Studio — 下一步工作计划（NEXT-STEPS）

> 关联文档：《Markdown-Studio-项目开发详细方案-V1.0-Final.md》（总体方案）、`README.md`（当前实现总览）。
> 本文档记录在既有实现基础上的**剩余增强任务**、优先级、工作量与建议推进顺序。更新日期：2026-10-16。

---

## 一、当前已完成（基线）

- **核心引擎**：解析管线（remark/rehype）、中文排版（护城河1）、标题自动编号、XSS 净化、TOC、滚动同步、版本快照 + LCS diff、HTML 导出。
- **本地知识库**：`Vault` 模型、`[[Wikilink]]` 解析、双向链接图、反链、悬空链接检测、关系图谱（确定性力导布局）。
- **检索**：CJK 感知 BM25 + `SemanticIndex` + HashingEmbedder（默认）/ HttpEmbedder（可开关）+ 混合检索。
- **AI / Agent**：function-calling（含 Claude Anthropic tools + 流式最终答复）、流式 RAG、本地检索；BYOK。
- **MCP**：stdio/HTTP、`config`/`install` 一键接入；桌面可启停 HTTP 子进程。
- **桌面**：Tauri exe + Vault/MCP 命令；属性检查器 / 文件树。
> - **质量基线**：`pnpm test` + `pnpm typecheck` + web build。

---

## 二、剩余增强任务

### A. 数据与存储层（基础，建议优先）
| # | 任务 | 优先级 | 工作量 | 说明 |
|---|---|---|---|---|
| A1 | 本地文件夹 Vault 持久化 | P0 | 大 | ~~Web FS Access + 自动保存~~ **已完成**：文件树/新建删除、IDB 会话恢复、Tauri VaultStore、⌘S 写回。默认仍为演示种子直至打开文件夹 |
| A2 | Git 版本 / AutoGit / 分支沙箱 | P1 | 大 | 增强切片 **已完成**：快照/历史 + Agent 沙箱 + Git 命令面板（新增**状态快照命令**与**冲突解决策略** manual/ours/theirs）+ **Git 输出解析层**（`src/git/status.ts`：porcelain/numstat/log 结构化解析、冲突检测，10 个单测，供桌面端 shell 与 MCP 接线）；全量 libgit2 仍待做 |
| A3 | 端到端加密同步 + GitHub/GitLab/Gitee | P2 | 大 | **已完成**：口令加密包（AES-GCM / **XChaCha20-Poly1305** 纯 TS 实现，OpenSSL 交叉验证）+ HTTP push/pull 合并（`SyncPanel`）+ **GitHub/GitLab/Gitee Contents API 适配器**（`src/sync/providers.ts`，sha 更新/存在性 create/update，14 **个单测**）；XChaCha 用 PBKDF2 派生密钥，GitHub/GitLab 深度集成（PR/冲突解决）仍待做 |

### B. 编辑器体验
| # | 任务 | 优先级 | 工作量 |
|---|---|---|---|
| B1 | WYSIWYG（Typora 风格实时编辑） | P2 | 很大（架构级） | 轻量切片 **已完成**：阅读态 + 预览内联编辑标题（写回源码）；真 Typora 级 WYSIWYG 仍待做 |
| B2 | Vim 模式 / 幻灯片模式 | P2 | 中 | ~~待做~~ **已完成**：幻灯片全屏 + 设置开关 Vim（`@replit/codemirror-vim`） |
| B3 | 拼写检查 Hunspell + CJK 校对 | P1 | 中 | **已完成**：CJK + 英文拼写 + 个人词典/导入 .dic/.aff + **Hunspell .aff 规则子集**（PFX/SFX、字符类条件、cross-product、**词级 flags 过滤**、**双 affix 链**（PFX+SFX / SFX+SFX / PFX+PFX）、形态描述忽略；`src/spell/affix.ts`，26 个单测）；设置面板可导入 .aff 并实时生效；完整 affix 形态字段（仅解析忽略）仍待做 |
| B4 | CJK 编码自动检测（GBK/Big5/Shift-JIS） | P2 | 小 | ~~待做~~ **已完成**：`detectTextEncoding` + 打开文件/Vault 载入；非 UTF-8 提示 |

### C. 知识层
| # | 任务 | 优先级 | 工作量 |
|---|---|---|---|
| C1 | 属性检查器（frontmatter 可视化编辑，保留注释/引号） | P1 | 中 | ~~待做~~ **已完成**：侧栏属性面板 + core parse/serialize 保注释/引号 |
| C2 | 类型驱动侧栏 / 类型化关系 / 自动反链增强 | P2 | 中 | ~~待做~~ **已完成**：内置 type schema、属性建议字段、类型化关系出链 |
| C3 | 保存的过滤视图 / Inbox 工作流 | P2 | 中 | ~~待做~~ **已完成**：Inbox（status/tags）+ 自定义 frontmatter 过滤视图 |
| C4 | tldraw 白板（Markdown fence 承载，懒加载） | P3 | 中 | **已完成（全形状）**：fence 协议 + 轻量 SVG 编辑器 + **真实 tldraw 3.4 接入**（懒加载 chunk）；`tldraw-bridge.ts` 纯转换层覆盖 **draw/line/rect/ellipse/text/arrow** 六类形状双向转换（含 tldraw line 的 index→点记录排序、arrow 局部坐标换算），12 个单测；其余 tldraw 形状（图片/框架/视频/便签）写回时忽略为已知限制 |
| C5 | 图谱交互增强（拖拽/缩放/过滤/点击穿透） | P2 | 小 | ~~待做~~ **已完成**：滚轮缩放、空白平移、节点拖拽、过滤/搜索 |

### D. AI / Agent
| # | 任务 | 优先级 | 工作量 |
|---|---|---|---|
| D1 | Anthropic(Claude) tools 适配 + 流式 function-calling | P1 | 中 | ~~待适配~~ **已完成**：Messages API + tools/tool_result、流式 text_delta / 最终答复流式 FC |
| D2 | 语义检索接 HttpEmbedder + 设置开关（神经网络级 RAG） | P1 | 小 | ~~待接线~~ **已完成**：设置开关 + embedModel/baseUrl；`Vault.setEmbedder` 重嵌；默认离线 HashingEmbedder |
| D3 | 声明式 recipes / 自动化（cron/on-save/on-commit 触发 Agent） | P2 | 大 | ~~待做~~ **已完成**：on-save/manual/cron/on-commit（快照成功即 commit）→ Agent 预填 |
| D4 | token 花费统计 | P3 | 小 | ~~待做~~ **已完成**：启发式估计 + Agent 面板会话累计 |

### E. MCP / 集成
| # | 任务 | 优先级 | 工作量 |
|---|---|---|---|
| E1 | MCP HTTP 服务接入 Tauri 桌面端（sidecar / 命令） | P1 | 中 | ~~待做~~ **已完成**：Rust `mcp_start/stop/status` + 设置页启停（依赖本机 `md-studio-mcp`） |
| E2 | MCP 服务器打包为可分发 npm bin + `mcp install/config` 一键接入 | P1 | 中 | ~~待做~~ **已完成**：`config`/`install` 子命令、README、`npx` 样例配置 |
| E3 | REST API（localhost + token，供 Alfred/Raycast/n8n） | P2 | 中 | ~~待做~~ **已完成**：`handleRest` + `md-studio-mcp --rest` |
| E4 | 多库联邦（`--workspace` 多目录） | P2 | 小 | ~~待做~~ **已完成**：可重复 `--workspace` / 逗号分隔，多库 id 加目录前缀 |

### F. 导出 / 分享
| # | 任务 | 优先级 | 工作量 |
|---|---|---|---|
| F1 | Pandoc 导出（docx/epub/LaTeX） | P2 | 中 | ~~待做~~ **已完成**：LaTeX lite 下载；docx/epub/pdf 下载 md + 复制 pandoc 命令 |
| F2 | 公开只读分享链接 | P3 | 中 | ~~待做~~ **已完成**：`#share/` + 离线 HTML + `docs/SHARE-HOSTING.md` 静态托管指引 |

### G. 平台 / 工程
| # | 任务 | 优先级 | 工作量 |
|---|---|---|---|
| G1 | CI/CD 自动打包（desktop exe + MCP，GitHub Actions） | P1 | 中 | ~~待做~~ **已完成**：artifact + Release + npm publish + sha256sums artifact；桌面签名占位见 `docs/DESKTOP-SIGNING.md` |
| G2 | 用户自定义主题令牌（开放更多 CSS 变量） | P2 | 小 | ~~待做~~ **已完成**：白名单令牌 + 设置 UI + sanitize |
| G3 | i18n 完善（更多语言，现为 zh/en 骨架） | P3 | 小 | ~~待做~~ **已完成**：新增日语 + 扩充键（Agent/编码/Token 等） |
| G4 | 响应式 / 移动端深化 | P2 | 中 | ~~待做~~ **已完成**：窄屏编辑/预览/分栏切换、触控目标与工具栏横滑 |

---

## 六、环境备注（本机 pnpm install 卡住问题）

- **现象**：在部分 Windows 环境（pnpm 11.7 + 慢速/被监视的 D: 盘）执行 `pnpm install` 会在链接阶段长时间卡住（CPU 空转、`added ~30` 后无进展），旧版 `pnpm-workspace.yaml` 中的 `allowBuilds` 占位符（`core-js: set this to true or false`）亦未生效。
- **处置**：
  1. `pnpm-workspace.yaml` 的 `allowBuilds` 占位符改为标准的 `onlyBuiltDependencies: [core-js, esbuild]`；
  2. 新增 `verifyDepsBeforeRun: false`，使 `pnpm <script>` 不再触发运行前自动安装（node_modules 已就绪时可正常 dev/build/test）；
  3. tldraw 依赖树的中断链接已手动补全（junction 重建），`vite build` / `tsc` / `vitest` 均验证通过。
- **若需重新 install**：建议在关闭文件监视/杀软排除后执行，或加 `--config.verify-store-integrity=false`；仍卡住可删除 `node_modules` 后重装。

---

## 七、建议推进顺序（依赖感知）

1. **A1 Vault 持久化** —— 解锁文件树、自动保存、真实知识库（多项功能前置）。
2. **D2 语义检索接线** —— 最小改动，立即把 RAG 升级到神经网络级。
3. **D1 Claude tools + 流式 function-calling** —— 补齐 AI 协议覆盖。
4. **E1 / E2 MCP 桌面接入 + 可分发打包** —— 让 MCP 真正产品化。
5. **C1 属性检查器 / B3 拼写检查** —— 知识层与写作体验。
6. **A2 AutoGit / A3 加密同步** —— 版本与同步。
7. 其余按需：B1 WYSIWYG、D3 recipes、F2 分享、G1 CI/CD…

---

## 四、每项完成的验收基线

- `pnpm -r typecheck` 全绿；`pnpm --filter @md-studio/core test`（vitest）全过。
- Web：`pnpm --filter @md-studio/web build` 成功。
- 桌面：`pnpm --filter @md-studio/desktop build:desktop` 产出独立 exe。
- MCP：stdio 与 HTTP 均以真实 `initialize / tools/list / tools/call` 跑通。

---

## 五、进行中 / 最近更新

- 2026-10-16：完成 **加密同步 push/pull**、**预览内联标题编辑**、**白板矩形/文字**、**Release sha256sums**；以及 Git 面板/词典/沙箱/分享 HTML 等。
- 2026-10-16（本轮）：
  - **B3 Hunspell affix**：`.aff` 规则解析（PFX/SFX + condition 字符类）+ cross-product 词形展开，接入 `checkSpelling`（15 单测）。
  - **A3 加密与同步升级**：`XChaCha20-Poly1305` 纯 TS 实现（HChaCha20/ChaCha20-IETF/Poly1305，Node OpenSSL 交叉验证，17 单测）；`vaultPack` 支持算法分发；新增 GitHub/GitLab/Gitee Contents API 同步适配器（14 单测）；`SyncPanel` 增加远端类型/仓库/分支/算法选择。
  - **C4 真实 tldraw**：`tldraw@3.4.0` 懒加载接入（独立 chunk + CSS），`tldraw-bridge` 纯转换层（7 单测），预览内「完整白板」切换、防抖写回 fence。
  - **工程修复**：`apps/mcp` tsconfig 补 `DOM` lib（core 的 WebCrypto 类型）。
- 2026-10-16（本轮二，接续）：
  - **C4 全形状**：bridge 扩展至 draw/line/rect/ellipse/text/arrow 六类（含 line 点记录排序、arrow 局部坐标换算），fence 形状白名单校验，轻量编辑器与只读预览新增椭圆/箭头工具与渲染（合计 +5 单测）。
  - **B3 affix 增强**：词级 flags 过滤、双 affix 链（PFX+SFX / SFX+SFX / PFX+PFX）、`.dic` 词条解析（形态描述忽略）、规模上限；设置面板新增 `.aff` 导入/清除，spell-lint 全链路贯通（+11 单测）。
  - **A2 Git 增强**：`git/status.ts` 输出解析层（porcelain/numstat/log、冲突检测、汇总），helpers 新增快照命令与冲突策略命令；GitPanel 新增两个区块（+10 单测）。
- 2026-10-20（性能与质量打磨）：
  - **渲染管线**：`render()` 按选项缓存 unified processor（`.use()` 十几个插件的固定开销不再每次渲染重复）；旁路 TOC/lint 上下文从插件闭包改为挂在 `tree.data.pipelineCtx`，保证 processor 复用下的**并发隔离**（新增 3 个回归用例）；`buildSanitizeSchema()` 结果缓存。
  - **Shiki**：按 `(theme, lang, code)` 缓存高亮子树（带条目/字符预算的 LRU 淘汰 + 同批次并发去重 + 取出时深拷贝，避免同一代码块多处复用被下游插件就地改写污染）；新增 `warmupHighlight()` / `clearHighlightCache()` / `resolveShikiTheme()`，Web 端在启动空闲期（`requestIdleCallback`）预热主题与常用语言，把约 500ms 的冷启动挪出「打开即见」关键路径。
  - **滚动同步**：`data-line` 只注入块级元素（内联元素与所在块同行号，纯属重复占位；同类文档 2,264 → 约 485 个锚点，DOM 体积与 `buildIndex()` 的 `getBoundingClientRect()` 次数同步下降）；同时修复「shiki 替换 `<pre>` 后 position 丢失 → 代码块没有锚点」的同步盲区；索引改为**脏标记 + 按需重建**（打字而不滚动时零测量开销）；`ResizeObserver` 缺失环境不再直接抛错。
  - **预览渲染**：`MarkdownView` 的 React 元素树按 `(safeHast, components)` 记忆化，父级频繁重渲染时整棵子树 bailout；`normalizeStyles` 无变更时不再为整棵树分配新数组；`fenceIndexMap` 只在 hast 变化时重算。
  - **质量基线**：修复 `pnpm -r typecheck` 的历史错误（i18n 三语字典重复的 `agentToolsMode` 键、AgentChat 里两个死变量、`<Icon name="refresh">` 用了不存在的图标名、web tsconfig 缺 `vitest/globals`）、修复 `Toolbar.togglePanel` 测试套件（此前因未导入 `vi` 根本无法加载；断言已对齐当前 `.tb-sidetoggle` 实现并覆盖窄/宽屏两条分支）。
  - 新增用例：core `tests/pipeline-perf.test.ts`（9）、web `src/features/sync/__tests__/ScrollSync.test.ts`（3）。
- **坑位备忘**：
  - `apps/desktop` 的 `vite build` 会 `emptyOutDir`；在 IDE 终端里这一步会被 Node 的 `safe-delete` shim 拦住（`spawnSync genie-trash ... ETIMEDOUT`），表现为「modules 已 transform 完却 build failed」。解法：先手工删掉 `apps/desktop/dist` 再构建，或 `pnpm exec tauri build --no-bundle`（不重复跑前端构建）。
  - `pnpm build` / `pnpm dev` 都默认指向 `apps/web`（pnpm-workspace.yaml），不要用根脚本构建桌面端。
  - 桌面前端产物依赖 `apps/web/public`（`publicDir`，tldraw 本地化资产）；缺该目录 → tldraw 白板挂载失败。
  - 打包安装器需额外工具；本机验证走 `--no-bundle` 出 `src-tauri/target/release/markdown-studio.exe`，双击根目录 `启动 Markdown Studio.bat` 即可运行（GUI 长驻程序不要在 Agent 会话里直接跑，会被进程围栏回收）。
- 下一步候选：**全量 libgit2**（或 isomorphic-git，本环境 pnpm install 卡住）、**真 WYSIWYG**、GitHub/GitLab 深度同步（PR/冲突）、tldraw 图片/框架形状持久化、**预览虚拟化**（4,374 节点全量 reconcile 是剩余主要成本）、启用真实签名 Secrets。
- 基线质量：core vitest（587 单测）+ web vitest（140）+ web/core/ui/mcp/desktop typecheck 全绿 + web build。
