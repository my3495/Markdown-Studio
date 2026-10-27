# 桌面版 Agent 细粒度测试报告

> 测试日期：2026-10-18
> 被测对象：Markdown Studio 桌面版（Tauri 2.0 + WebView2），Agent 右栏
> 运行环境：Windows，Ollama 本地 `qwen2.5:1.5b`，dev 模式（`apps/desktop` vite :1420 + debug 外壳）

---

## 一、启动与观测方式

| 项 | 结果 |
| --- | --- |
| 桌面壳启动 | ✅ `markdown-studio.exe` 窗口创建，标题 `Markdown Studio`，加载 `http://localhost:1420`（`ESTABLISHED` 连接确认） |
| WebView2 初始化 | ⚠️ 本会话曾出现「窗口空白 + 无 webview 进程」，清理残留 webview 进程后恢复（环境风险，见 F4） |
| CDP 远程调试 | ❌ 无法开启：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 被忽略；`tauri.conf.json` 的 `additionalBrowserArgs`（Tauri 2）亦未生效（0 监听） |
| 实际驱动方式 | Edge（同 Chromium/WebView2 内核）加载 **桌面端 vite 渲染的同一份 UI**（`localhost:1420`），经 CDP 驱动；桌面壳独有的 Tauri Vault 后端由 D 系列单测覆盖 |
| 驱动脚本 | `desktop-test/agent-suite.mjs`（主套件）、`agent-retest.mjs`（复验）、`visible-suite.mjs`（可见态验证）、`verify-write.mjs`（写入回查） |

> 说明：因 CDP 不可用，Agent 交互在「同一渲染器 + 真实 Ollama」环境中执行，结论对桌面壳有效；桌面窗口本身已确认可加载渲染层。

---

## 二、用例与结果

| # | 用例 | 结果 | 证据 |
| --- | --- | --- | --- |
| T1 | Agent 面板可挂载 | ✅ | `.agent-input` 存在，状态点 `sb-dot ok` |
| T2 | Ollama 连通性检测（点击重新检测） | ✅ | 状态点 `ok` |
| T3 | 基础流式对话 | ✅ | 6.0s 完成，回答「我是一个能够列出所有笔记…的知识库助手」 |
| T4 | 工具调用（知识库检索） | ✅ | trace 出现 `search` 步骤（3 项），回答列出命中笔记 |
| T5 | 沙箱写入 + pending 接受 | ✅（复验） | 需 `allowWrite:true`；pending `待确认写入(1)` 出现，`write_note` 步骤 ok，接受成功 |
| T6 | 附件上传与问答 | ✅（复验） | 芯片 `agent-attach.md` 出现；模型正确答出 `2026-10-18` |
| T7 | 多轮上下文 | ✅ | 正确回忆「第二个问题是关于桌面Agent测试」 |
| T8 | 错误降级（不存在的模型） | ✅ | 气泡 `[模型调用失败]chat failed status=404 …model not found`，trace 带 `err` 步骤，流未中断 |
| T9 | 空输入禁用发送 | ✅ | 空输入时 `.agent-send` disabled |
| T10 | Token 计量展示 | ✅（复验） | `本会话累计: 535（本轮: 146 · 估计）`；reload 后归零属「本会话」语义 |
| V1 | 可见态基础问答（1440 宽） | ✅ | `desktop-agent-v1-chat.png` |
| V2 | 可见态工具检索 | ✅ | `desktop-agent-v2-tool.png`（含工具调用折叠区、插入按钮、Token 区） |

**首轮 7/10**，3 项失败经复验确认均为**用例前置条件问题**（`allowWrite` 关闭 / reload 重置会话计量 / 芯片检测时序），非产品缺陷。

---

## 三、发现的问题

### F1【P1】接受沙箱写入后，侧栏「全部笔记」不刷新

- **现象**：`allowWrite:true` 下让 Agent 新建笔记 → pending 出现 → 点「接受」→ `write_note` 步骤 ok → **侧栏仍显示「全部笔记 (5)」**，新建的「桌面Agent测试」不可见（需重开文件夹/重启才出现）。
- **代码依据**：`AgentChat.tsx:474` 仅执行 `sandboxRef.current?.accept(p.key)` + `syncPending()`；`useVault` 的 `notes` 是 `derive(vault, query)` 在 `bindStore`/`syncFromDocs` 时生成的**快照**，accept 后没有任何刷新调用。
- **影响**：用户接受写入后看不到结果，误以为失败，可能重复写入。
- **最小修复建议**：accept / acceptAll 成功后调用
  ```ts
  useVault.getState().syncFromDocs(); // 或新增 refreshNotes(): set(derive(vault, get().query))
  ```
  并在 `syncPending()` 之后执行。

### F2【P2】弱模型把工具调用当正文输出时，UI 原样展示 JSON

- **现象**：`qwen2.5:1.5b` 偶发不按 `tool_calls` 协议返回，而把 `{"name": "search", "arguments": {...}}` 当正文输出，气泡里直接显示原始 JSON（无 trace 步骤）。
- **影响**：用户看到「乱码式」回答，且不知道模型其实想做检索。
- **最小修复建议**：在 `runToolAgent` 的最终回答处检测「正文疑似工具调用 JSON」（`/^\s*\{\s*"name"\s*:/` 且含 `arguments`），命中则追加一条 `notice`（新 code，如 `badToolFormat`）并提示「模型未按工具协议输出，可重试」。

### F3【P2】窄窗口下 Agent 面板被压成 0 宽

- **现象**：视口 868px 时 `.agent-chat-list` / `.zone-head` 的 `width=0`（DOM 存在但不可见）；1440px 时正常（340px 宽，x=1100）。
- **影响**：小窗口/分屏下 Agent 面板「点不出来」，无任何提示。
- **建议**：给右栏设最小宽度（如 280px），空间不足时自动折叠为抽屉/浮层，或在 <1000px 时禁用 toggle 并提示。

### F4【环境】桌面壳 WebView2 / CDP 可观测性

- 本会话曾出现：窗口创建成功但**无 webview 子进程**、无到 dev server 的连接（空白窗口）；清理全部 `msedgewebview2.exe` 后恢复。
- `--remote-debugging-port` 两种传参方式均无效（env 被 Tauri 默认参数覆盖；`additionalBrowserArgs` 配置未生效）。
- **建议**：桌面 E2E 走官方 `tauri-driver` + `msedgedriver`；或为 release 版保留可选的调试开关（构建期 feature）。

---

## 四、结论

1. 桌面版 Agent 主链路（对话、工具检索、沙箱写入/接受、附件、多轮、错误降级、计量、边界禁用）**功能可用**，真实 Ollama 下无控制台错误、无页面异常。
2. 最需要修的是 **F1（接受写入后列表不刷新）**，属用户可感知的一等交互缺陷，修复成本低。
3. **F2/F3** 为体验问题（弱模型容错、窄屏布局），建议排入下一迭代。
4. **F4** 为测试基建问题：当前无法直接在 WebView2 上开 CDP，桌面 E2E 需引入 tauri-driver。

---

## 五、产物

| 文件 | 说明 |
| --- | --- |
| `desktop-test/agent-suite.mjs` | 主套件（T1–T10，单连接、稳定性判定、截图） |
| `desktop-test/agent-retest.mjs` | T5/T6/T10 复验（allowWrite、附件芯片、计量） |
| `desktop-test/visible-suite.mjs` | 1440 宽可见态验证（V1/V2） |
| `desktop-test/verify-write.mjs` | 写入回查 |
| `desktop-test/agent-drive.mjs` / `probe.mjs` | 通用 CDP 驱动与 UI 探针（自动发现目标页） |
| `%TEMP%/desktop-agent-*.png` | 测试截图 |

---

## 六、修复记录（2026-10-18）

### 6.1 F1【P1】接受写入后侧栏不刷新 —— 已修复

| 项 | 内容 |
| --- | --- |
| 出错位置 | `apps/web/src/features/agent/AgentChat.tsx` 沙箱接受按钮的 onClick（单条 accept 与 acceptAll 两处） |
| 根本原因 | `useVault` 的 `notes/graph/results` 是 `derive(vault, query)` 生成的**快照**，只在 `bindStore`/`syncFromDocs` 时更新；accept 写库后只调了 `sandbox.accept()` + `syncPending()`，没有任何刷新调用 → 侧栏停留在旧快照 |
| 修复 | 组件改为 `const { vault, refreshNotes } = useVault()`；accept / acceptAll 的 onClick 改用 `try { … } finally { syncPending(); refreshNotes(); }`。`refreshNotes()`（store 已有实现）仅 `set(derive(vault, query))`，**不重写笔记内容**，不触碰文档/编辑器状态 |
| 边界 | 只影响「接受」路径；拒绝（reject）不改库，故不刷新（有专门用例锁定）。accept 抛错（acceptAll 部分失败）时 `finally` 仍会同步 pending 与视图，属于顺带修正 |
| 验证 | ① 组件用例 C-13/C-14（accept / acceptAll 触发 refreshNotes 一次）、C-15（reject 不触发）；② **端到端**（真实 Ollama）：接受写入后侧栏 `全部笔记 (5) → (6)` 且出现「F1验证笔记」 |

### 6.2 F2【P2】伪工具调用原样显示 JSON —— 已修复

| 项 | 内容 |
| --- | --- |
| 出错位置 | `packages/core/src/agent/fc.ts` `runToolAgent` 的两处终止分支（流式 L521 / 非流式 L549）；`apps/web/.../agentChatUtils.ts` 的事件映射；`i18n/index.ts` |
| 根本原因 | 小参数模型偶发不返回 `tool_calls`，而是把 `{"name":"search","arguments":{…}}` 当正文；`runToolAgent` 无法区分「正常回答」与「放错位置的工具调用」，UI 也没有对应提示通道 |
| 修复 | ① 新增 `looksLikeToolCallJson()`：**完整 JSON.parse**（非前缀正则）+ 长度 ≤2000 + 要求 `name/tool/function` 与 `arguments/args/parameters/input` 同时存在，降低误判；② 两处终止分支在 `content` 命中时 yield `notice { code: 'badToolFormat' }`（`ToolAgentEvent` 的 notice code 扩为 `'truncated' \| 'badToolFormat'`）；③ UI `eventTraceStep` 映射为 `ok:false` 的 err 步骤，文案 `agentBadToolFormat`（zh/en/ja） |
| 边界 | **不改写模型正文**（用户仍能看到原样输出），只追加提示；只在「无 tool_calls 的最终答复」判定，正常 JSON 回答（如 `{"答案":…}`）与自然语言中出现的 JSON 片段均不误报；流式跨 delta 拼接后判定 |
| 验证 | `tests/agent/R5-toolformat.test.ts` 11 例（识别规则 6 例 + 流式/非流式正反例 5 例）；`agentChatUtils` U-17b；组件 C-16（提示渲染为 err 步骤） |

### 6.3 F3【P2】窄窗口下 Agent 无入口 —— 已修复

| 项 | 内容 |
| --- | --- |
| 出错位置 | `apps/web/src/styles/index.css` `@media (max-width: 1024px)` 块 |
| 根本原因 | 该断点把 `.app-rail` 与 `.tb-agent-toggle` 一起 `display: none` —— 面板连入口都被隐藏，窄窗口/分屏下 Agent 功能完全不可达（不是单纯「宽度为 0」） |
| 修复 | 改为覆盖式抽屉：`.app-rail` 在该断点下 `position: absolute; top/right/bottom: 0; width: min(340px, 92vw); z-index: 30; box-shadow`；`.tb-agent-toggle` 保持 `inline-flex` 可见 |
| 边界 | 只作用于 ≤1024px；>1024px 仍为常规右侧栏（`position: static`）。抽屉由既有 `agentOpen` 条件渲染控制，关闭仍走面板自带的 × 按钮，不改布局结构与状态管理 |
| 验证 | 视口实测：900px 时 toggle `display:flex`、面板 `position:absolute`、宽 341px 右对齐；1440px 时 `position:static`、宽 341px（截图 `f3-narrow.png` / `f3-wide.png`） |

### 6.4 回归结果

| 项 | 结果 |
| --- | --- |
| `tests/agent/*`（L1–L6、R、R2、R3、R4、R5、P） | 逐文件全绿（见下表） |
| `tests/fc.test.ts` / `tests/llm.test.ts` | 16 / 11 通过 |
| web `agentChatUtils` + `AgentChat.events` | 26 + 16 = 42 通过 |
| `packages/core` / `apps/web` `tsc --noEmit` | 0 错误 |
| 端到端（真实 Ollama） | 写入→accept→侧栏 5→6；窄屏抽屉可见 |
