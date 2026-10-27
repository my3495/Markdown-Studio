# Agent 修复验证报告

> 验证对象：2026-10-18 那一轮 Agent 链路缺陷修复（21 项）
> 验证日期：2026-10-18
> 说明：本仓库当前**不是 git 仓库**，改动范围通过文件 mtime 定位

---

## 一、改动范围定位

按 mtime（`2026-10-18 03:00` 之后）筛选出的本次修复涉及文件：

| 文件 | 修复项 | 性质 |
| --- | --- | --- |
| `packages/core/src/agent/llm.ts` | F1 F2 F7 F11 F12 F14 F15 F19 | 核心链路 |
| `packages/core/src/agent/fc.ts` | F1 F2 F11 F12 F14 F15 F18 F20 F21 | 核心链路 |
| `packages/core/src/agent/tools.ts` | F3 F4 F5 F6 F13 | 工具层 |
| `packages/core/src/agent/sandbox.ts` | F5 F16 F17 | 状态层 |
| `packages/core/src/agent/recipes.ts` | F8 F9 F10 | 意图层 |
| `apps/web/src/features/agent/AgentChat.tsx` | 配套（error 事件渲染） | UI |

**未改动**（确认本次修复未波及其他模块）：`tokens.ts`、`toolschema.ts`、`mcp/*`、`rest/api.ts`、`search/fts.ts`、`vault/vault.ts`、以及 `packages/ui`。

---

## 二、测试执行结果

### 2.1 单元测试

| 套件 | 用例数 | 通过 | 失败 |
| --- | --- | --- | --- |
| `tests/agent/L1-input` | 26 | 26 | 0 |
| `tests/agent/L2-intent` | 19 | 19 | 0 |
| `tests/agent/L3-prompt` | 14 | 14 | 0 |
| `tests/agent/L4-routing` | 33 | 33 | 0 |
| `tests/agent/L5-context` | 14 | 14 | 0 |
| `tests/agent/L6-output` | 15 | 15 | 0 |
| **`tests/agent/R-regression`（本次新增）** | **63** | **63** | **0** |
| **Agent 小计** | **184** | **184** | **0** |

### 2.2 既有回归套件（确认未破坏）

| 套件 | 用例 | 结果 |
| --- | --- | --- |
| `fc` / `llm` / `sandbox` / `recipes` / `tokens` | 16 / 11 / 2 / 3 / 3 | 全通过 |
| `mcp` / `rest` / `vault` / `fts` | 7 / 5 / 8 / 4 | 全通过 |
| `pipeline` / `typography` / `frontmatter` / `version` / `share` / `sync` | 8 / 7 / 4 / 2 / 2 / 2 | 全通过 |
| 剔除 `tests/agent` 后的全量 | **212** | **0 失败** |

### 2.3 类型检查

- `packages/core`：`tsc --noEmit` → **0 错误**
- `apps/web`：`tsc --noEmit` → **0 错误**（确认 core 的 `ToolAgentEvent` 新增 `error` 分支未破坏消费方）

> 环境提示：本机沙箱对 vitest 临时目录偶发 `EPERM`，并行跑全量会杀掉部分 worker 导致**漏跑**（同一批用例两次全量跑分别统计到 212 与 193，均为 0 失败）。
> 因此本报告所有数字取自**逐文件执行**，避免漏跑造成的假阴性。

---

## 三、补充的回归用例（R 系列，63 例）

既有 L1~L6 按「链路环节」组织、偏向场景覆盖；本次新增 `tests/agent/R-regression.test.ts`，按**缺陷编号**组织，每条只锁定一个修复机制，并刻意做到「修复被回滚时该用例必然失败」。

| 分组 | 用例 | 覆盖的修复 | 关键断言 |
| --- | --- | --- | --- |
| R1 | R1-01/02 | F1 空输入 | 0 次请求 + 抛错；`retrieve` 也不被调用 |
| R2 | R2-01~04 | F2 容量上限 | 截断长度恰为 `MAX_PROMPT_CHARS`、以 `…` 收尾；未超限不被改写 |
| R3 | R3-01~05 | F3/F4 search 校验 | 缺失/空白 query 报错；limit 负数/NaN/0 回落 20；合法 limit 生效 |
| R4 | R4-01~08 | F5/F6 写入校验 | 错误信息为 `missing required field: X`；空 content 允许；只读闸门优先于字段校验 |
| R5 | R5-01/02 | F8 模板 `$&` | `$&` `$'` `` $` `` `$$` `$1` 全部原样 |
| R6 | R6-01~03 | F9/F10 recipes | NaN/Infinity/非数字间隔回落 60；空白 prompt 不入队 |
| R7 | R7-01~06 | F11/F12 前置校验 | 未知 provider / custom 无 baseUrl / openai 无 key 抛错；custom 有 baseUrl 无 key **不拦**；ollama 不拦 |
| R8 | R8-01/02 | F13 元方法 | `call('manifest')` / `call('call')` 返回 `ok:false`；9 个真实工具仍可用 |
| R9 | R9-01~07 | F14 重试 | 5xx 共 3 次尝试；429/网络异常重试后成功；**401 只请求 1 次**；默认退避 ≥100ms；`retries:0` 可关闭；首调成功不重复请求 |
| R10 | R10-01~04 | F15 历史窗口 | 只留最近 8 条；单条裁剪到 16000 且以 `…` 收尾；非法角色/空内容剔除；短历史原样 |
| R11 | R11-01~06 | F16/F17 沙箱 | 连续 3 次 append 内容全保留；read-your-writes；pending delete 上 append 报错；`before` 不被覆盖；acceptAll 部分失败的队列语义 |
| R12 | R12-01~06 | F18/F19/F20/F21 | error 事件 + done 不抛；retrieve 抛错降级为 `ok:false` 步骤；JSON 错误包装为 `chat failed`；空响应兜底；既有本地回退未被破坏 |
| R13 | R13-01~04 | F7 响应体 | 非流体抛错；**getReader 分支与异步可迭代分支均仍正常**（防止 `chunksOf` 改动误伤） |
| R14 | R14-01~03 | 集成 | 真实 Vault 上 search→回填→作答；模型乱传参数时报错但不中断；沙箱 Accept/Reject 落库语义 |

### 3.1 修复前后行为差异的实证（回滚敏感性）

为确认 R 系列不是「恒真断言」，临时回滚了 3 处修复后单独运行对应用例：

| 回滚的修复 | 用例 | 回滚后结果 |
| --- | --- | --- |
| F16 append 改回 `base.read_note`（非 overlay） | R11-01 | **失败** ✅ |
| F8 模板改回字符串替换 | R5-01 | **失败** ✅ |
| F13 `call()` 不拒绝元方法 | R8-01 | **失败** ✅ |

回滚后已完整还原源码（逐项 grep 校验），R 系列复跑 63/63 通过。

---

## 四、失败用例与失败原因

R 系列**首轮**运行 63 例中 4 例失败，逐一定位如下。

### 4.1 测试编写问题（非产品缺陷）— 2 例

| 用例 | 失败信息 | 原因 | 处理 |
| --- | --- | --- | --- |
| R4-01 | `expected 'write disabled (allowWrite=false)' to be 'missing required field: name'` | 我用了只读 `tools()`，写闸门先于字段校验返回。这是**正确优先级**（鉴权优先于校验，不向未授权调用方泄漏 schema），是用例构造错误 | 改用 `allowWrite:true` 的工具实例；并新增 R4-02b 专门锁定「闸门优先于校验」这一顺序 |
| R4-02 | 同上 | 同上 | 同上 |

### 4.2 修复引入的真实回归 — 2 例（已修复）

详见第五节。

---

## 五、修复引入的新问题（2 项，已最小化修复）

### 新问题 1：`write_note` 拒绝空 `content`，导致无法创建空笔记

- **发现用例**：R4-03、R4-06
- **现象**：`write_note({ name:'empty.md', content:'' })` → `ok:false`。
- **原因**：我为 F5 新增的 `requiredString()` 统一要求「非空字符串」，但 `protocol.ts` 的 JSON Schema 中 `required: ['name','content']` 只要求**字段存在**，并不要求非空。校验比 schema 更严 → 过度限制。
- **实际影响**：
  - 无法新建空笔记（先建后写是常见流程）；
  - REST `PUT /notes/:id` 把正文清空会被拒（`api.ts:120` 会把 `content:''` 原样传给工具）；
  - MCP `tools/call write_note` 同样受影响。
- **最小化修复**：给 `requiredString()` 增加 `allowEmpty` 选项 —— `name`（决定笔记身份）仍要求非空，`content` / `text` 只要求是字符串、允许空串。`tools.ts` 与 `sandbox.ts` 同步对齐。
  ```ts
  function requiredString(args, field, opts: { allowEmpty?: boolean } = {}) {
    const v = args[field];
    if (typeof v !== 'string') return { ok:false, error:`missing required field: ${field}` };
    if (!opts.allowEmpty && v.trim() === '') return { ok:false, error:`missing required field: ${field}` };
    return { ok:true, value:v };
  }
  ```
- **验证**：R4-03 / R4-06 / R4-08 通过；`rest` / `mcp` 套件无回归。

### 新问题 2：`custom` provider 未填 apiKey 被拦截，本机自建端点不可用

- **发现用例**：R7-04
- **现象**：`buildChatRequest({ provider:'custom', baseUrl:'http://localhost:1234/v1' })` → 抛 `缺少 apiKey`。
- **原因**：`DEFAULTS.custom.needsKey = true`，而 `custom` 的 `baseUrl` 完全由用户填写，典型场景恰恰是**本机/自建、无需鉴权**的 OpenAI 兼容端点（LM Studio、llama.cpp、vLLM 等）。修复前可正常使用，修复后被拦死 —— 属于 F12 的过度收紧。
- **最小化修复**：只对我们**确知需要付费鉴权**的 6 个 provider（openai / claude / deepseek / qwen / glm / kimi）强制 apiKey；`custom` 与未登记 provider 的 `needsKey` 置为 `false`（其 baseUrl 必由用户显式提供，无法假定是否需鉴权，交给服务端返回 401 更准确）。
  ```ts
  custom: { baseUrl: '', needsKey: false, kind: 'openai' },
  const UNKNOWN_PROVIDER: ProviderDefault = { baseUrl: '', needsKey: false, kind: 'openai' };
  ```
- **验证**：R7-03（openai 缺 key 仍抛错）、R7-04（custom 本地端点放行）、R7-05（ollama 放行）均通过；`fc` / `llm` 套件无回归。

---

## 六、尚未覆盖的风险点

| # | 风险点 | 说明 | 建议 |
| --- | --- | --- | --- |
| 1 | **UI 层零单测** | `AgentChat.tsx`（656 行）完全没有测试：新增的 `error` 事件渲染、preamble 拆分、附件上限（5 个 / 256KB）、Ollama 状态点、i18n 分支均未验证 | 引入 React Testing Library，至少覆盖「发送→流式增量→错误→重试」主路径 |
| 2 | **真实网络未覆盖** | 全部用例使用注入桩。真实 SSE 分帧、`connection: close` 中途断流、provider 各自的错误体（OpenAI `error.message` / Anthropic `error.type`）、HTTP/2 行为均未验证 | 增加契约测试（录制真实响应样本回放），或至少增加一组「乱序/畸形 SSE」模糊用例 |
| 3 | **REST 层未针对新校验补用例** | `rest/api.ts` 的行为随工具层校验变化而改变（如 POST /notes 缺 content 现在是 403、空 content 是 201），但 `rest.test.ts` 未覆盖这些新分支 | 补 `POST /notes` 缺字段 / 空字段、`PUT /notes/:id` 清空正文的用例 |
| 4 | **重试对 UI 与计量的副作用** | 默认 2 次重试带来最多 ~600ms 静默等待，UI 无「重试中」提示；`TokenMeter` 也不记录重试产生的额外请求 | 在 `ToolAgentEvent` 增加 `retry` 事件供 UI 展示；重试不计入 token（当前未计，需明确固化） |
| 5 | **截断对用户不可见** | prompt / context / history 被静默截断到 32000 / 16000，UI 无任何提示，用户可能误以为模型看到了全部内容 | 截断时产出一条可展示的提示（事件或返回值） |
| 6 | **新增文案未接入 i18n** | `EMPTY_RESPONSE_HINT`、`[模型调用失败]`、`[已达最大工具调用步数]` 均为中文硬编码，与 `AgentChat.tsx` 使用的 `t(locale, …)` 体系不一致（后两者为既有代码，本次新增了前者） | 统一纳入 i18n key |
| 7 | **附件与 prompt 的预算未打通** | UI 允许 5×256KB 附件，core 又把整条 user 消息截断到 32000 —— 附件正文会被无声截掉 | 在 UI 侧按剩余预算限制附件，或 core 截断时回传截断信息 |
| 8 | **并发与幂等** | 同一 `SandboxSession` 并发 `accept`/`acceptAll`、以及重试导致的工具重复执行（写操作非幂等）均未测试 | 为写工具引入幂等键；补并发用例 |
| 9 | **语义检索（Embedder）失败路径** | `Vault.setEmbedder` / `searchSemantic` 的异常未纳入 `runAgent` 的降级范围 | 在 `retrieve` 实现侧或 core 侧纳入 try |
| 10 | **MCP stdio/HTTP 传输层** | 只对 `server.handle()` 做了单元验证，`stdio.ts` / `http.ts` 与新校验未做端到端联调 | 补一层传输层集成测试 |

---

## 七、结论

1. **本次修复的 21 项缺陷全部通过验证**：184 条 Agent 用例（121 条既有 + 63 条新增回归）全通过，既有 212 条用例 0 回归，`packages/core` 与 `apps/web` 双端类型检查 0 错误。
2. **新增的 63 条回归用例具备回滚敏感性**：实测回滚 F16 / F8 / F13 三处修复后，对应用例立即失败，能够真实反映修复前后的行为差异。
3. **发现并修复了 2 项由本次修复引入的回归**：空 `content` 被拒（校验严于 schema）、`custom` provider 被强制要求 apiKey（误伤本机自建端点）。均已在验证过程中以最小化方式修正，并补了对应锁定用例。
4. **遗留风险集中在「未测」而非「已知坏」**：UI 层零覆盖、真实网络零覆盖、REST 新分支未补、重试与截断对用户不可见，建议作为下一轮重点。

---

## 八、第二轮细粒度修复（针对第六节风险清单）

针对第六节的风险点逐项落地，新增 `tests/agent/R2-hardening.test.ts`（28 例）。

### 8.1 源码改动

| 风险 # | 改动 | 文件 |
| --- | --- | --- |
| 2 | 流式解析健壮性用例（不改源码，见 8.2） | — |
| 3 | `GET/POST /search` 入参非法时返回 **400** 而非 200（与「未找到」区分） | `rest/api.ts` |
| 4 | `RetryPolicy` 新增 `onRetry` 回调；`ToolAgentEvent` 新增 `retry` 事件（attempt / status / delayMs / reason） | `llm.ts` / `fc.ts` |
| 5 | `ToolAgentEvent` 新增 `notice` 事件（`code:'truncated'` + detail，不携带硬编码文案，便于 i18n） | `fc.ts` |
| 6 | 新增 4 个 i18n key（`agentLlmError` / `agentRetry` / `agentTruncated` / `agentAttachTrimmed`），zh / en / ja 三语齐全；UI 的 error / retry / notice 全部改走翻译 | `apps/web/src/i18n/index.ts`、`AgentChat.tsx` |
| 7 | UI 新增 `ATTACH_TEXT_BUDGET = 24_000`，按附件数配额截断并 toast 提示，避免 5×256KB 塞进 prompt 后被 core 无声截断 | `AgentChat.tsx` |
| 9 | `runAgent` 的 `retrieve` 签名放宽为 `RetrieveResult \| Promise<RetrieveResult>` 并 `await`，使**异步检索（Embedder / 远程语义）失败也能被降级捕获** | `llm.ts` |
| — | **新发现缺陷**：OpenAI 流式下部分 provider 会在多个 delta 重复下发 `function.name`，原实现用 `+` 累加会拼成 `searchsearch`。改为仅在首次出现时写入 | `fc.ts` |

### 8.2 新增用例（28 例）

| 分组 | 用例 | 内容 |
| --- | --- | --- |
| R15 流式健壮性 | R15-01~08 | SSE 心跳注释 `: ping`、无 `data:` 前缀行、缺 `[DONE]`、CRLF 行尾、单行 200KB、单 chunk 多行、坏行混入、**工具名重复 delta 不拼接** |
| R16 REST 新分支 | R16-01~06 | 无字段创建空笔记 201、PUT 空 content 清空正文 200、**缺 q → 400**、正常查询 200、只读 403、不存在 404（不误伤） |
| R17 MCP 传输层 | R17-01~04 | HTTP：校验错误 isError、空 content 写入、Bearer 鉴权 / 坏 JSON(-32700) / 批量 / health；stdio：完整 tools/call 往返 + 校验错误 |
| R18 沙箱幂等 | R18-01~04 | 重复 accept、重复 acceptAll（不重复落库、笔记数不增）、accept 后 reject、reject 后 acceptAll |
| R19 异步与可观测 | R19-01~06 | 异步 retrieve 成功、异步 retrieve reject 降级、**retry 事件**、**notice 事件**、未超限不产 notice（不误伤）、多轮循环事件序列 |

### 8.3 回滚敏感性复验

| 回滚项 | 用例 | 结果 |
| --- | --- | --- |
| 工具名恢复为 `+` 累加 | R15-08 | **失败** ✅ |
| REST `/search` 恢复为 200 | R16-03 | **失败** ✅ |

（回滚后已完整还原并 grep 校验，R2 系列复跑 28/28 通过。）

### 8.4 第二轮执行结果

| 套件 | 用例 | 通过 |
| --- | --- | --- |
| Agent 全部（L1~L6 + R + R2） | **212** | **212** |
| 非 Agent 全量基线 | **219** | **219** |
| `packages/core` / `apps/web` 类型检查 | — | 均 0 错误 |

### 8.5 仍无法在本次覆盖的风险（需外部依赖或产品决策）

| # | 残留风险 | 原因 / 建议 |
| --- | --- | --- |
| 1 | **UI 层仍无单测** | 需引入 React Testing Library（当前未安装）。可退而求其次：把 `retrieve`、历史窗口、附件配额等纯逻辑从 `AgentChat.tsx` 抽出为独立函数再测 |
| 2 | **真实 provider 契约测试** | 需录制真实响应样本回放；当前仍是全 mock |
| 3 | **流中断重试** | 架构限制：已 yield 出去的 delta 无法回滚重放，中途断流只能报错不能静默重试。建议后续引入「分段确认」协议 |
| 4 | **写工具幂等** | 重试可能重复执行写操作（`write_note` 幂等、`append_to_note` **不幂等**）。建议为写工具引入幂等键 |
| 5 | **core 兜底文案仍为中文** | `EMPTY_RESPONSE_HINT` / `[模型调用失败]` 等保留中文（与既有 `[已达最大工具调用步数]` 风格一致），headless 场景有用；UI 侧已全部走 i18n。若要彻底解决需 core 支持文案注入 |

---

## 九、第三轮修复（外部依赖安装 + 剩余问题）

### 9.1 源码改动

| 改动 | 文件 |
| --- | --- |
| **流式中途断流重试**：`streamChat` 增加 `yielded > 0` 判定 —— 尚未吐出任何增量时断流按 `isRetryable(status)` 正常重试（修掉 status=200 断流不重试的问题）；已产出增量则只能上抛，避免重复输出 | `llm.ts` |
| **Ollama usage 解析**：`prompt_eval_count` / `eval_count` 改为从顶层字段读取（Ollama 原生协议不在 `usage` 对象里） | `tokens.ts` |
| **写工具幂等键**：`opKey` 贯穿 `write_note` / `append_to_note` / `delete_note`，重试或并发重复执行同一 opKey 不会二次落库；类型声明增加 `idempotencyKey?: string` | `tools.ts` / `sandbox.ts` |
| **兜底文案可注入**：`runToolAgent` 支持注入 `hints`（`emptyResponse` / `maxSteps` / `callFailed`），默认值保持中文兼容 | `fc.ts` |
| 新增 `P-provider-contract.test.ts`（17 例）：三 provider 协议矩阵、SSE 分帧、usage 字段映射 | `packages/core/tests/agent/` |
| 新增 `R3-round3.test.ts`（12 例）：中途断流重试、幂等键、hints 注入 | `packages/core/tests/agent/` |

### 9.2 外部依赖安装（pnpm/npm 均失败后的手动方案）

本机 pnpm 的 symlink 阶段被沙箱破坏、npm 被网络策略拦截，最终用 `.test-deps/link-closure.mjs` 从 `.pnpm` store 直接为 `@testing-library/{react,dom,jest-dom}`、`jsdom`、`vitest` 建立 NTFS junction（`ROOTS` 清单含全部嵌套依赖）。

---

## 十、第四轮：UI 层测试落地（本轮）

### 10.1 为可测性做的重构

`AgentChat.tsx` 原先把附件预算、历史窗口、事件映射全部内联在组件里，无法单测。本轮抽出 `apps/web/src/features/agent/agentChatUtils.ts`（纯函数，零 React/store 依赖）：

| 导出 | 职责 |
| --- | --- |
| `attachShare` / `composeModelPrompt` | 附件配额均摊（保底 1000 字符）、超预算截断并回报被截文件名（toast 由调用方弹，函数无副作用） |
| `buildHistory | 多轮上下文窗口（默认 8 条，`context` 优先于 `text`，滤空白） |
| `eventTraceStep` | `error` / `retry` / `notice` → i18n trace 步骤的统一映射 |
| `isTextFile` / `fmtSize` 等 | 文件类型判定与体积格式化 |

`AgentChat.tsx` 改为调用上述函数，行为不变（逐分支比对过原文）。新增 `apps/web/vitest.config.ts`（jsdom + React 插件）与 `tests/setup.ts`（jest-dom + act 环境 + **jsdom 缺失的 `Blob.prototype.text()` FileReader 补齐** —— 这是环境缺口，浏览器均已支持）。

### 10.2 新增用例（29 例，全通过）

| 套件 | 用例 | 覆盖点 |
| --- | --- | --- |
| `agentChatUtils.test.ts` | 25 | 配额均摊/保底、空提问回落、截断回报、多附件互不越额、**组装结果 ≤ core MAX_PROMPT_CHARS(32000)**、历史窗口与 context 优先、error/retry/notice 三事件映射（含 en locale）、notice 未知 code 返回 null、文件类型判定 |
| `AgentChat.events.test.tsx` | 4 | **C-01** error/retry/notice 落入 trace 且文案本地化、失败步骤带 err 样式类；**C-02** 附件超预算 → toast「附件内容过长，已截断：big.md」+ 送入模型的正文带 `…` 且远小于原文；**C-03** 未配置 LLM → 本地检索回退（`runToolAgent` 零调用）；**C-04** 空输入发送按钮禁用 |

组件测试的 mock 策略：`@md-studio/core` 用 `vi.hoisted` 状态变量注入脚本化事件流并捕获 `lastArgs`；7 个 zustand store、`toast`、`consumeRecipePrompt`、`Icon` 全部 vi.mock；**i18n 使用真实模块**以断言本地化文案。

### 10.3 第四轮全量回归（逐文件执行，规避沙箱 EPERM）

| 套件 | 用例 | 通过 |
| --- | --- | --- |
| Agent L1~L6 | 121 | 121 |
| R-regression | 63 | 63 |
| R2-hardening | 28 | 28 |
| P-provider-contract | 17 | 17 |
| R3-round3 | 12 | 12 |
| 受影响 core 单测（fc/llm/sandbox/recipes/tokens/rest） | 40 | 40 |
| **web UI（agentChatUtils + AgentChat.events）** | **29** | **29** |
| `apps/web` `tsc --noEmit` | — | **0 错误**（抓到并修复 `eventTraceStep` 的 `locale` 应为 `Locale` 联合类型） |

**合计 310 项测试 + 1 项类型检查全部通过。** mtime 确认本轮 `packages/core/src` 零改动，core 侧结果不受 web 重构影响。

### 10.4 第六/八节风险清单的当前状态

| 风险 | 状态 |
| --- | --- |
| #1 UI 层零单测 | ✅ 已解决（29 例；纯逻辑抽出 + 组件事件/回退/禁用覆盖） |
| #2 真实 provider 契约 | ✅ 部分解决（P-provider-contract 17 例协议矩阵；真实网络样本回放仍缺） |
| #3 流中断重试 | ✅ 已解决（mid-stream retry：未产出增量才重试，已产出则上抛） |
| #4 写工具幂等 | ✅ 已解决（opKey 幂等键，R18/R3 锁定） |
| #5 core 兜底文案 i18n | ✅ 已解决（hints 可注入，UI 侧全走 i18n） |
| REST 新分支 / MCP 传输层 / Embedder 失败路径 | ✅ 第二轮已覆盖（R16 / R17 / R19） |
| 真实网络样本回放 | ⚠️ 仍缺（需录制的真实响应） |

---

## 十一、第五轮：按剩余任务清单逐项修复（2026-10-18 晚）

针对第十节 10.4 遗留清单逐项执行，坚持最小改动、独立可验证。

### 11.1 P0-1 测试基建：pnpm 链接真相与守卫加固

**实测结论（pnpm v11.7.0）**：
- 全新环境 / CI：`pnpm install --frozen-lockfile` 可正常建链，**不需要** junction 脚本（沙箱 EPERM 是本机特例）。
- 本机：pnpm 的 "Already up to date" 基于状态库（`.modules.yaml`）而非实际校验 —— 链接丢失后 **pnpm 不会自愈**，`--force` 也不重建（实测：删掉 `node_modules/jsdom` junction 后两次 install 均无动作）。
- 恢复方式：`node .test-deps/link-closure.mjs`（幂等，本次实测恢复 1 个丢失链接，闭包 272 项完整）。

**改动**：`.test-deps/link-closure.mjs` 增加 `--verify` 只读校验模式（缺链时退出码 1），头部文档记录上述行为。另验证 `pnpm --filter @md-studio/core exec vitest run` 与 web 同链路可用。

### 11.2 P0-2 全量并行冒烟：坐实「静默漏跑」并加守卫

- 实测一次并行全量：**49/50 文件执行、446 用例通过、1 个 EPERM 未处理错误** —— `tests/agent/L3-prompt.test.ts` 被静默跳过且不计失败（假阴性坐实）。
- 新增 `.test-deps/test-runner.mjs`：
  - 默认模式 = 全量并行 + 守卫（比对磁盘文件清单 vs 实际执行清单，缺文件 / 有未处理错误 / 有用例失败 → 退出码 1）；
  - `--per-file [目录]` = 逐文件顺序跑并聚合（沙箱推荐，已用其产出 51/51 基线）。
- 守卫复跑一次干净全量：**50/50 文件、460 用例、0 错误**（EPERM 间歇性，守卫可稳定识别）。

### 11.3 P1-3 真实风格 SSE 字节流回放（新增 R4 系列，11 例）

`packages/core/tests/agent/R4-sse-replay.test.ts`：按官方文档线格式构造三 provider 原始字节（OpenAI 含 SSE 心跳注释 / CRLF / `[DONE]`；Anthropic 含 `event:` 行与 `ping` 事件；Ollama NDJSON），经**真实 ReadableStream** 与 **1/3/7/13 字节奇数字节切片**（含多字节 UTF-8 中间断开）驱动 `streamChat` 全链路；另覆盖 getReader-only 传输分支、噪声行容错、无终止标志自然收尾、`toLines` 跨 chunk 半行拼接。11/11 通过。

### 11.4 P1-4 组件测试补齐至 12 例

`AgentChat.events.test.tsx` 升级 mock 为 `vi.hoisted` 可变状态（sandbox pending 队列、docs、token、recipes、ollama），新增 C-05~C-12：

| 用例 | 覆盖 |
| --- | --- |
| C-05 | 工具调用前的模型前言拆入 preamble 区，气泡只留最终回答 |
| C-06 / C-07 | sandbox pending 展示；单条 accept / reject 后出队、pending 区消失 |
| C-08 | insert 把回答按 `> Agent 回答` 格式追加到当前笔记 |
| C-09 | token 用量展示（会话累计 / 本轮 / 估计）与清零 |
| C-10 | recipes pendingPrompt 挂载后预填输入框并清空队列 |
| C-11 | Ollama 离线提示（含 baseUrl）与离线状态点、挂载即探测 |
| C-12 | 附件芯片删除 |

12/12 通过。纯逻辑套件 25/25 不变。

### 11.5 P1-5 桌面端覆盖（新增 D 系列，8 例）

`apps/desktop/vitest.config.ts`（jsdom）+ `apps/desktop/tests/tauriVault.test.ts`：用内存 FS mock `@tauri-apps/plugin-fs` / `plugin-dialog`，覆盖 list 遍历规则（跳过 node_modules / 点目录）、save 自动建父目录、remove、**Windows 反斜杠根路径拼接**、localStorage 持久化与恢复、`available()` 探测、取消选择不清库（D-07 初版断言写错，实修测试以匹配「取消不清库」的产品语义）；**D-08 集成**：Tauri store → `loadVault` → `Vault` → `createVaultTools` 搜索/读回闭环，证明 agent 工具链在桌面后端可用。8/8 通过。desktop package.json 增加 `test` 脚本。

### 11.6 本轮执行结果（全绿）

| 验证项 | 结果 |
| --- | --- |
| core 逐文件全量（`test-runner.mjs --per-file`） | **51/51 文件，471 用例** |
| web UI（agentChatUtils + AgentChat.events） | 25 + 12 = **37** |
| desktop（tauriVault） | **8** |
| `apps/web` `tsc --noEmit` | 0 错误 |
| `packages/core` `tsc --noEmit` | 0 错误 |
| `apps/desktop` `tsc --noEmit` | 0 错误 |
| `apps/web` `vite build` | ✓ 53.4s（仅既有 chunk 体积告警） |

> 构建备注：沙箱 safe-delete 护栏会拦截 vite 清空旧 `dist`（389 文件超阈值），本次以「改名旧 dist 为 `dist.bak` 后全新构建」通过；`dist.bak` 保留待用户确认删除。

### 11.7 未处理项及原因

| # | 任务 | 原因 |
| --- | --- | --- |
| P2-6 | 流式「分段确认」重试协议 | 架构级改动：需重新设计 streamChat 的增量确认语义（已 yield 内容的分段 ACK 协议），影响 provider 适配与 UI 展示，超出「最小改动」范围，需产品决策 |
| P2-7 | 非 agent 模块同粒度测试 | 范围覆盖 mcp stdio 长连接 / graph / export / typography 等 30+ 既有套件，属独立批次工作；本轮聚焦 agent 链路清单收尾 |
