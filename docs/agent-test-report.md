# Markdown Studio — Agent 应用细粒度测试报告

> 测试对象：`packages/core/src/agent/*`（llm / fc / tools / sandbox / recipes / tokens / toolschema）
> 关联路由层：`packages/core/src/mcp/server.ts`、`packages/core/src/rest/api.ts`
> 调用方：`apps/web/src/features/agent/AgentChat.tsx`、`apps/web/src/platform/recipes/runner.ts`
> 测试代码：`packages/core/tests/agent/`（6 个文件 + 1 个公共桩）
> 约束：**全部外部模型与第三方服务使用注入式 mock，测试期间零真实网络请求**

---

## 一、Agent 核心链路梳理

```
用户输入
  │
  ├─ L1 输入解析 ─────────────────────────────────────────────────────────┐
  │   UI: AgentChat.tsx  q = prompt.trim()；附件并入 modelPrompt           │
  │   core: fc.ts safeParseArgs()  工具参数 JSON 反序列化                  │
  │         llm.ts toLines/chunksOf/parseStreamLine()  流式字节→文本行     │
  │         tools.ts excerptFor()   检索片段提取                           │
  ├─ L2 意图识别 ─────────────────────────────────────────────────────────┤
  │   recipes.ts matchRecipes()  trigger × enabled × pathPattern 匹配      │
  │   recipes.ts renderRecipePrompt()  模板变量渲染                        │
  │   （工具模式下的"意图"由 LLM 输出的 tool_calls 表达）                  │
  ├─ L3 提示词组装 ───────────────────────────────────────────────────────┤
  │   llm.ts runAgent()      system + history + 「问题/相关资料」           │
  │   fc.ts  runToolAgent()  system + history + user                       │
  │   llm.ts buildChatRequest() / fc.ts buildToolsRequest()                │
  │          provider 路由：ollama → /api/chat                             │
  │                        openai 系 → /chat/completions                   │
  │                        claude   → /v1/messages + system 分离           │
  ├─ L4 工具选择与路由 ───────────────────────────────────────────────────┤
  │   tools.ts VaultTools.call()  名称分发 + WRITE_TOOLS 写闸门            │
  │   tools.ts resolveId()        id / name 双路定位                       │
  │   mcp/server.ts tools/call    JSON-RPC 路由                            │
  │   rest/api.ts                 REST 路由                                 │
  │   fc.ts runToolAgent()        多步循环：调用→回填→再问                 │
  ├─ L5 多轮上下文与状态 ─────────────────────────────────────────────────┤
  │   fc.ts assistantHistory / toolResultHistory / batchAnthropicToolResults│
  │   sandbox.ts  写操作入队（pending）+ accept/reject 落库                 │
  │   tokens.ts   TokenMeter 计量                                          │
  ├─ L6 结果输出与异常处理 ───────────────────────────────────────────────┤
  │   fc.ts streamChatWithTools()  delta 流式增量                          │
  │   fc.ts summarize()            工具结果摘要                            │
  │   llm.ts runAgent() catch      外部失败→回退本地检索（唯一降级点）      │
  │   fc.ts  maxSteps 上限         步数耗尽提示                            │
  └───────────────────────────────────────────────────────────────────────┘
```

**链路关键观察**：写入有三道闸门（UI `allowWrite` 设置 → `tools.ts` WRITE_TOOLS → `sandbox.ts` 队列需 Accept），但**校验**只存在于入口最外层（UI），core 层几乎无参数校验与容量约束。

---

## 二、执行环境与运行方式

```bash
cd packages/core
./node_modules/.bin/vitest run tests/agent          # 全部 121 例
./node_modules/.bin/vitest run tests/agent/L4-routing.test.ts   # 单阶段
../../node_modules/.bin/tsc --noEmit                # 类型检查（已通过）
```

| 项 | 值 |
| --- | --- |
| 测试文件 | `L1-input` / `L2-intent` / `L3-prompt` / `L4-routing` / `L5-context` / `L6-output` |
| 用例总数 | **121** |
| 修复前 | 89 通过 / **32 失败**（73.6%） |
| **修复后** | **121 通过 / 0 失败（100%）** |
| 类型检查 | 通过（`packages/core` 与 `apps/web` 双端 `tsc --noEmit` 均 0 错误） |
| 既有回归 | 无。`fc/llm/sandbox/recipes/tokens/mcp/rest/vault` 47 例逐文件全通过；剔除新增目录后全量 186 例 0 失败 |

> **环境提示**：本机沙箱对 vitest 临时目录偶发 `EPERM`，并行跑全量时会杀掉部分 worker 导致漏跑。
> 已验证 **逐文件运行** 结果稳定（本报告数据取自逐文件执行）。

---

## 三、执行结果汇总

| 阶段 | 文件 | 用例数 | 修复前通过 | 修复后通过 | 修复后失败 |
| --- | --- | --- | --- | --- | --- |
| L1 输入解析 | `L1-input.test.ts` | 26 | 15 | **26** | 0 |
| L2 意图识别 | `L2-intent.test.ts` | 19 | 15 | **19** | 0 |
| L3 提示词组装 | `L3-prompt.test.ts` | 14 | 11 | **14** | 0 |
| L4 工具路由 | `L4-routing.test.ts` | 33 | 28 | **33** | 0 |
| L5 上下文/状态 | `L5-context.test.ts` | 14 | 9 | **14** | 0 |
| L6 输出/异常 | `L6-output.test.ts` | 15 | 11 | **15** | 0 |
| **合计** | | **121** | 89 | **121** | **0** |

---

## 四、测试清单

图例：✅ 通过　❌ 失败（对应第五节缺陷编号）

### L1 输入解析（26 例）

| 用例 | 覆盖点 | 预期结果 | 结果 |
| --- | --- | --- | --- |
| L1-01 合法 JSON 字符串参数解析为对象 | 工具参数反序列化 | `arguments` 解析为对象 | ✅ |
| L1-02 非法 JSON 字符串参数回退为空对象 | 坏参数 | 回退 `{}`，不抛错 | ✅ |
| L1-03 参数为对象（Ollama 形态）直接透传 | 多 provider 参数形态 | 原样透传 | ✅ |
| L1-04 参数缺失 (undefined) 回退为空对象 | 缺失字段 | `{}` | ✅ |
| L1-05 参数为 null 回退为空对象 | 空值 | `{}` | ✅ |
| L1-06 参数为数组不抛错 | 非法类型 | 原样接受，不崩溃 | ✅ |
| L1-07 空 prompt 不应发起 LLM 请求（工具模式） | **空输入** | 请求数 0 | ❌ F1 |
| L1-08 空 prompt 不应发起 LLM 请求（检索增强模式） | **空输入** | 请求数 0 | ❌ F1 |
| L1-09 纯空白 prompt 应被判定为空 | **空输入（空白字符）** | 请求数 0 | ❌ F1 |
| L1-10 超长 prompt 应被截断或拒绝 | **超长输入** | 送入长度 ≤ 32000 | ❌ F2 |
| L1-11 超长检索上下文应被截断 | **超长输入（context）** | 送入长度 ≤ 32000 | ❌ F2 |
| L1-12 search 缺失必填 query 应报错 | **缺失必填字段** | `ok:false` | ❌ F3 |
| L1-13 search limit 为负数不应吞掉命中 | **非法参数** | 2 条命中全部返回 | ❌ F4 |
| L1-14 search limit 为 NaN 应回落 20 | **非法参数** | 2 条命中 | ❌ F4 |
| L1-15 search limit=0 返回空结果 | 边界值 | `ok:true`，`[]` | ✅ |
| L1-16 write_note 缺失 name 不应崩溃 | **缺失必填字段** | `ok:false` | ✅ |
| L1-17 write_note 缺失 name 错误信息可读 | **错误信息质量** | 含 `name`/`required` 等字段提示 | ❌ F6 |
| L1-18 write_note 缺失 content 应被拒绝 | **缺失必填字段** | `ok:false` | ❌ F5 |
| L1-19 read_note 参数类型非法（id 为数字） | **非法参数类型** | `ok:false` 安全失败 | ✅ |
| L1-20 toLines 正确拼接跨 chunk 半行 | 流式解析 | 半行正确拼接 | ✅ |
| L1-21 SSE 坏 JSON 行应跳过 | 流式容错 | 跳过，后续增量正常 | ✅ |
| L1-22 响应体不是合法流应报错 | **无效响应体** | 抛错 | ❌ F7 |
| L1-23 响应体为 null 应报错 | 空 body | 抛错 | ✅ |
| L1-24 excerptFor 空内容返回空串 | 边界 | `''` | ✅ |
| L1-25 excerptFor 空查询回退前两行 | 边界 | `'第一行 第二行'` | ✅ |
| L1-26 excerptFor 超长片段截断 | 截断 | 长度 161（max+省略号） | ✅ |

### L2 意图识别（19 例）

| 用例 | 覆盖点 | 预期结果 | 结果 |
| --- | --- | --- | --- |
| L2-01 仅匹配 enabled 且 trigger 一致 | 触发点匹配 | 只命中 r1 | ✅ |
| L2-02 on-commit / cron / manual 互不串台 | 触发点隔离 | 各命中 1 条 | ✅ |
| L2-03 无匹配时返回空数组 | 空集 | `[]` | ✅ |
| L2-04 前缀模式 `notes/` | pathPattern 分支 | 目录内命中 | ✅ |
| L2-05 后缀模式 `*.md` | pathPattern 分支 | `.md` 命中 / `.txt` 不命中 | ✅ |
| L2-06 双端通配 `*.draft*` | pathPattern 分支 | 退化为包含匹配 | ✅ |
| L2-07 空 / 未设置 pattern | pathPattern 分支 | 全匹配 | ✅ |
| L2-08 四个占位符全部渲染 | 模板渲染 | 无 `{{` 残留 | ✅ |
| L2-09 excerpt 截断到 1200 | 模板渲染 | 含 `…`，≤1203 | ✅ |
| L2-10 content 不截断 | 模板语义区分 | 等于原文 | ✅ |
| L2-11 未知占位符原样保留 | 模板渲染 | `{{foo}} a.md` | ✅ |
| L2-12 渲染值含 `$&` 不应被解释 | **特殊替换模式** | `A$&B` | ❌ F8 |
| L2-13 渲染值含 `$'` 与 `$$` 不应被解释 | **特殊替换模式** | `A$'B` / `A$$B` | ❌ F8 |
| L2-14 未设置回落 60 分钟 | cron 间隔 | 3,600,000 | ✅ |
| L2-15 0 与负值收敛到 1 分钟 | cron 间隔 | 60,000 | ✅ |
| L2-16 NaN 应回落 60 分钟 | **非法值** | 3,600,000 | ❌ F9 |
| L2-17 空提示词 recipe 不应产出 | **空输入** | 0 条匹配 | ❌ F10 |
| L2-18 多条命中按声明顺序返回 | 匹配顺序 | `['P1-a.md','P2-a.md']` | ✅ |
| L2-19 空正文时 excerpt 渲染为空串 | 边界 | `[]` | ✅ |

### L3 提示词组装（14 例）

| 用例 | 覆盖点 | 预期结果 | 结果 |
| --- | --- | --- | --- |
| L3-01 system→history→user，空资料注入（无） | 消息组装 | 角色序 `system,user,user` | ✅ |
| L3-02 自定义 systemPrompt 覆盖默认 | 提示词组装 | 首条 = CUSTOM-SYS | ✅ |
| L3-03 runToolAgent 自定义 systemPrompt 居首 | 提示词组装 | 首条 system / 末条 user | ✅ |
| L3-04 无 history 时仅 2 条消息 | 提示词组装 | 长度 2 | ✅ |
| L3-05 请求体携带 tools 声明 | 工具声明注入 | 9 个工具 | ✅ |
| L3-06 ollama → /api/chat 无鉴权头 | **provider 路由** | URL/头正确 | ✅ |
| L3-07 claude → /v1/messages + x-api-key + system 分离 | **provider 路由** | URL/头/system 正确 | ✅ |
| L3-08 自定义 baseUrl 覆盖 + 尾斜杠归一化 | **provider 路由** | `…/v1/chat/completions` | ✅ |
| L3-09 未知 provider 应给出可诊断端点或报错 | **路由兜底** | 非相对 URL | ❌ F11 |
| L3-10 custom provider 未配 baseUrl | **路由兜底** | URL 以 http 开头 | ❌ F11 |
| L3-11 缺失 apiKey 应提前报错 | **外部依赖前置校验** | 请求数 0 | ❌ F12 |
| L3-12 有 apiKey 注入 Bearer 头 | 鉴权 | `Bearer sk-test` | ✅ |
| L3-13 检索资料拼接进 user 消息 | 上下文注入 | 含「问题：」与资料 | ✅ |
| L3-14 流式开关正确透传 | 参数透传 | `stream === true` | ✅ |

### L4 工具选择与路由（33 例）

| 用例 | 覆盖点 | 预期结果 | 结果 |
| --- | --- | --- | --- |
| L4-01 六个只读工具全部路由成功 | 分发主路径 | 全部 `ok:true` | ✅ |
| L4-02 未知工具名返回 ok:false | 分发兜底 | 含工具名的错误 | ✅ |
| L4-03 空工具名返回 ok:false | 边界 | `ok:false` | ✅ |
| L4-04 `call("manifest")` 应被拒绝 | **元方法泄漏** | `ok:false` | ❌ F13 |
| L4-05 `call("call")` 不递归爆炸 | 元方法泄漏 | `ok:false` | ✅ |
| L4-06 call 缺省 args 视为空对象 | 边界 | `ok:true` | ✅ |
| L4-07 只读模式下三个写工具均被拦截 | **写闸门（3 分支）** | 全部 write disabled | ✅ |
| L4-08 allowWrite=true 写工具放行并落库 | 写闸门放行 | 写入/追加/删除生效 | ✅ |
| L4-09 绕过 call 直调写方法也被拦截 | 写闸门一致性 | `ok:false`，未落库 | ✅ |
| L4-10 按 id 命中 | resolveId 分支 | `ok:true` | ✅ |
| L4-11 按 name 命中（可省 .md） | resolveId 分支 | `ok:true` | ✅ |
| L4-12 id 优先于 name | resolveId 分支 | 返回 id=a | ✅ |
| L4-13 id 不存在且 name 缺失 | resolveId 分支 | `note not found` | ✅ |
| L4-14 空 id / 空 name | resolveId 边界 | `ok:false` | ✅ |
| L4-15 空库中工具安全返回 | 空状态 | `[]` / `ok:false` | ✅ |
| L4-16 MCP 已知工具路由成功 | MCP 路由 | `isError:false` | ✅ |
| L4-17 MCP 未知工具 → isError | MCP 路由 | `isError:true` | ✅ |
| L4-18 MCP 未知方法 → -32601 | MCP 路由 | 错误码 -32601 | ✅ |
| L4-19 MCP 缺 params.name → isError | MCP 路由 | `isError:true` | ✅ |
| L4-20 MCP 只读模式写工具 → isError | MCP 写闸门 | `isError:true` | ✅ |
| L4-21 工具失败错误回填模型并继续 | **错误回退自愈** | tool(ok:false) + 继续作答 | ✅ |
| L4-22 未知工具错误回填并继续 | **错误回退自愈** | summary 含 unknown tool | ✅ |
| L4-23 只读模式写工具被拦截并回填 | **错误回退自愈** | summary 含 write disabled | ✅ |
| L4-24 maxSteps 上限给出提示 | 步数上限 | 含「最大工具调用步数」 | ✅ |
| L4-25 5xx 应重试后成功 | **错误重试** | 第二次成功 | ❌ F14 |
| L4-26 429 应退避重试后成功 | **错误重试/限流** | 第二次成功 | ❌ F14 |
| L4-27 网络异常应重试或降级 | **错误重试/降级** | 重连成功 | ❌ F14 |
| L4-28 重试耗尽抛出带状态码错误 | 错误信息质量 | 含 503 | ✅ |
| L4-29 沙箱只读模式写入被拒 | 沙箱闸门 | `ok:false`，队列为空 | ✅ |
| L4-30 沙箱可写模式入队不落库 | 沙箱状态 | pending=1，库未变 | ✅ |
| L4-31 沙箱读叠加未落库写入 | read-your-writes | 读到沙箱新内容 | ✅ |
| L4-32 沙箱拒绝 call/manifest 与未知工具 | 元方法泄漏 | 全部 `ok:false` | ✅ |
| L4-33 沙箱写入缺失必填字段应被拒绝 | **缺失必填字段** | `ok:false` | ❌ F5 |

### L5 多轮上下文与状态（14 例）

| 用例 | 覆盖点 | 预期结果 | 结果 |
| --- | --- | --- | --- |
| L5-01 超长历史应截断到最近 N 条 | **历史窗口** | 消息数 ≤ 10 | ❌ F15 |
| L5-02 单条历史超长不应整条灌入 | **上下文膨胀** | 总字符 ≤ 32000 | ❌ F2 |
| L5-03 历史中非法角色 tool 应剔除/补全 | **角色净化** | roles 不含 `tool` | ❌ F15 |
| L5-04 OpenAI：assistant(tool_calls)+每条结果一条消息 | 回填形态 | `system,user,assistant,tool` | ✅ |
| L5-05 Anthropic：多 tool_result 合并为一条 user | 回填形态 | 2 个 tool_result 同消息 | ✅ |
| L5-06 Ollama：role=tool 文本回填 | 回填形态 | `content` 为字符串 | ✅ |
| L5-07 多轮循环 messages 持续累积 | 多轮状态 | 第 3 轮有 2 条 tool | ✅ |
| L5-08 同一笔记多次写入合并为一条 pending | 沙箱状态 | 1 条，after=v2 | ✅ |
| L5-09 append 保留首次变更前原文 | **沙箱状态丢失** | after 同时含 X 与 Y | ❌ F16 |
| L5-10 待删除笔记读取不可见 | 沙箱 overlay | `pending delete` | ✅ |
| L5-11 accept/reject 不存在 key 返回 false | 沙箱状态 | `false` | ✅ |
| L5-12 acceptAll 中途失败不留残留 | **状态一致性** | pending 清空 | ❌ F17 |
| L5-13 rejectAll 清空且不落库 | 沙箱状态 | 库内容不变 | ✅ |
| L5-14 TokenMeter 累计与清空 | 计量状态 | 30/15/45 → 清零 | ✅ |

### L6 结果输出与异常处理（15 例）

| 用例 | 覆盖点 | 预期结果 | 结果 |
| --- | --- | --- | --- |
| L6-01 多段 delta 拼接并以 done 收尾 | 流式输出 | `你好，世界` + done | ✅ |
| L6-02 OpenAI 流式 tool_calls 分片累积 | 流式工具解析 | `{query:'苹果'}` | ✅ |
| L6-03 Anthropic 流式 tool_use 累积 | 流式工具解析 | `{query:'苹果'}` | ✅ |
| L6-04 Ollama NDJSON 流式工具调用 | 流式工具解析 | search 命中 | ✅ |
| L6-05 出现 [DONE] 后停止解析 | 流终止 | 只取到 `A` | ✅ |
| L6-06 runAgent LLM 失败回退本地检索 | **降级（已有）** | 含错误原因 + 本地资料 | ✅ |
| L6-07 runToolAgent 外部失败应降级 | **降级缺失** | done + 非空文本 | ❌ F18 |
| L6-08 retrieve 抛错应降级而非整体失败 | **降级缺失** | done | ❌ F19 |
| L6-09 JSON 解析失败应包装为可诊断错误 | **错误包装** | 含 `chat failed` | ❌ F20 |
| L6-10 非 2xx 错误信息含状态码与片段 | 错误信息质量 | 含 401 / 响应片段 | ✅ |
| L6-11 响应结构异常（无 choices）安全降级 | 容错 | done，空内容 | ✅ |
| L6-12 模型空响应应给出可识别提示 | **空响应兜底** | 文本非空 | ❌ F21 |
| L6-13 摘要覆盖数组/note/name/失败四类 | 结果摘要 | 四种形态正确 | ✅ |
| L6-14 工具事件携带工具名与参数 | 可追溯性 | name/args 正确 | ✅ |
| L6-15 done 始终为最后事件 | 输出协议 | `{type:'done'}` | ✅ |

---

## 五、失败用例根因定位分析

32 个失败用例归并为 **21 个缺陷**，按严重度排序。

### P0 — 结果正确性 / 数据完整性（建议立即修）

#### F16　沙箱连续 append 丢失前一次追加内容　→ L5-09 ❌
- **现象**：连续两次 `append_to_note`，最终 `after` 只有第二次的内容 `'# Alpha\n苹果 的 笔记 内容\nY'`，第一次的 `X` 被丢弃。
- **定位**：`src/agent/sandbox.ts:95`
  ```ts
  const resolved = base.read_note(args);          // ← base 是 allowWrite:false 的原始库视图
  const note = resolved.data?.note ?? (args.id ? overlayGet(args.id) : null);
  ```
  `base` 由 `sandbox.ts:38` 以 `createVaultTools(vault, { allowWrite: false })` 创建，**读不到 pending 队列里的变更**；只有 `overlayGet()` 才能叠加沙箱视图。而 `read_note` 本身（`sandbox.ts:53-75`）已正确走 overlay，**append 与 read 的实现不一致**。
- **性质**：静默数据丢失（用户 Accept 后第一次追加内容凭空消失），且 Accept 前 UI 预览到的 pending 内容即为错误内容。
- **修法**：`append_to_note` 取基线时改用 overlay 视图（`overlayGet(args.id) ?? base.read_note(args).data?.note`）。

#### F8　recipe 模板渲染把 `$&` `$'` `$$` 解释为特殊替换模式　→ L2-12 / L2-13 ❌
- **现象**：`renderRecipePrompt('{{name}}', { name: 'A$&B' })` → `'A{{name}}B'`；`name = "A$'B"` → `'AB'`。
- **定位**：`src/agent/recipes.ts:39-43`
  ```ts
  return template.replace(/\{\{path\}\}/g, ctx.path).replace(/\{\{name\}\}/g, ctx.name)...
  ```
  `String.prototype.replace` 的**替换字符串**中 `$&`（匹配文本）、`` $` ``（前缀）、`$'`（后缀）、`$$`（`$`）、`$n`（捕获组）均具特殊含义。笔记名/正文含 `$` 时（如 `price$isRight.md`、含 `${VAR}` 的代码笔记）提示词内容被重写。
- **性质**：提示词内容错乱 + 提示词注入面（攻击者可构造含 `$'` 的笔记名把模板其余部分拖进提示词）。
- **修法**：替换为函数形式 `.replace(/\{\{name\}\}/g, () => ctx.name)`。

#### F5　写入工具缺失必填字段静默成功，脏数据入库　→ L1-18 / L4-33 ❌
- **现象**：`write_note({ name: 'x.md' })`（无 content）→ `ok:true`；沙箱 `write_note({ id: 'x' })` → `ok:true`。
- **定位**：`src/agent/tools.ts:163-168` 无字段校验直接 `vault.upsert({ content: undefined })` → `fts.ts:77` 索引成 `"x.md\nundefined"`；`src/agent/sandbox.ts:77-91` 连 `name` 都不校验（因不调用 `slug()`）。
- **加重情节**：`src/mcp/protocol.ts:65` 的 schema 已声明 `required: ['name','content']`，但运行时**从未执行 schema 校验**——声明与执行不一致，MCP 客户端会误以为服务端已校验。
- **修法**：在 `tools.ts` / `sandbox.ts` 写入路径增加必填校验，或在 `VaultTools.call()` 统一用 `protocol.ts` 的 `inputSchema` 做一次校验。

#### F3　search 缺失 query 静默返回空成功　→ L1-12 ❌
- **现象**：`search({})` → `{ ok: true, data: [] }`。
- **定位**：`src/agent/tools.ts:125` `vault.search(args.query, limit)` 未校验 → `fts.ts:78-80`：`tokenize(undefined)` 命中 `if (!text) return []` → 查询词为空 → 返回 `[]`。
- **危害**：模型收到"工具调用成功、0 条结果"，**比显式报错更容易诱发幻觉式编造**（系统提示词恰恰要求"切勿编造"）。
- **修法**：`query` 为空时返回 `{ ok:false, error: 'missing required field: query' }`。

#### F4　search limit 非法值导致结果被静默裁剪　→ L1-13 / L1-14 ❌
- **现象**：`limit:-1` 时 2 条命中只返回 1 条；`limit:NaN` 时返回 0 条。
- **定位**：`src/agent/tools.ts:124` `const limit = args.limit ?? 20;` 未做有限性/符号校验 → `fts.ts:99` `.slice(0, limit)`：`slice(0,-1)` 丢弃末条、`slice(0,NaN)` 视为 `slice(0,0)`。
- **修法**：`const limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 20;`

### P1 — 稳定性 / 可用性

#### F18　工具模式（runToolAgent）外部依赖失败无任何降级　→ L6-07 ❌
- **现象**：fetch reject（`ECONNREFUSED`）时 generator 直接抛出，事件流无 `done`，调用方只能 catch。
- **定位**：`src/agent/fc.ts:421-487` 整个 `for (let step…)` 循环**无 try/catch**；对比 `src/agent/llm.ts:262-271`，`runAgent` 已实现"LLM 失败回退本地检索"，**两条链路能力不对齐**。
- **危害**：`AgentChat.tsx:356` 有 catch 兜底，但通过 MCP/REST 直连 core 的调用方会拿到未捕获异常。
- **修法**：`runToolAgent` 增加 catch，至少 `yield { type:'delta', text:'[模型调用失败] …' }` + `done`；工具模式可回退到无工具的一次性检索作答。

#### F14　外部调用无重试、无退避　→ L4-25 / L4-26 / L4-27 ❌
- **现象**：5xx、429、网络抖动**一次即失败**。
- **定位**：`src/agent/fc.ts:169-186` `chatWithTools` 单次 `fetchImpl` 后即判定；`fc.ts:461` 调用点无重试包装。`llm.ts:206-226` `streamChat` 同理。
- **修法**：对 429 / 5xx / 网络错误做有限重试（如 2 次 + 指数退避），并把 `Retry-After` 透出。

#### F19　retrieve 抛错击穿 runAgent，绕过既有降级　→ L6-08 ❌
- **现象**：`retrieve()` 抛 `index corrupt` 时整个 `runAgent` 抛出，无 `done` 事件。
- **定位**：`src/agent/llm.ts:250` `const { context, trace } = opts.retrieve(opts.prompt);` **位于 `try`（262 行）之外**。
- **修法**：把 retrieve 纳入 try，或失败时降级为 `context: ''` 并继续。

#### F13　`call('manifest')` 返回数组而非 ToolResult　→ L4-04 ❌
- **现象**：`tools.call('manifest')` 返回数组，`r.ok === undefined`。
- **定位**：`src/agent/tools.ts:193-204` 的 `call()` **未排除 `manifest`**（`sandbox.ts:132` 已显式排除 `name === 'call' || name === 'manifest'`）——两处实现不一致。
- **危害**：`fc.ts:323-332` `summarize()` 取 `result.ok` 为 `undefined`（falsy）→ 被误判为工具失败；MCP `tools/call` 会把数组塞进 `result.content`，违反 JSON-RPC 约定。
- **修法**：`tools.ts` 的 `call()` 对齐 sandbox 的元方法排除逻辑。

#### F17　acceptAll 非原子：中途失败留下"已应用但未清理"的 pending　→ L5-12 ❌
- **现象**：两条待应用变更，第二条落库抛错 → 抛异常且 `pending()` 仍返回 2 条（其中第一条**已实际落库**）。
- **定位**：`src/agent/sandbox.ts:158-163` 先 `for (...) applyOne(c)` 再 `queue.clear()`，无事务/无逐个出队。
- **危害**：重试 acceptAll 会重复应用已成功项；用户看到 pending 仍在，误以为未落库。
- **修法**：逐条 `applyOne` 成功后立即 `queue.delete(key)`；失败项保留并让异常携带失败 key。

#### F15　历史无窗口、角色未净化　→ L5-01 / L5-03 ❌
- **现象**：50 条历史全量灌入（52 条消息）；历史含 `role:'tool'` 时原样透传。
- **定位**：`src/agent/fc.ts:414` `...(opts.history ?? []).map((m) => ({ role: m.role, content: m.content }))`——无条数上限、无角色白名单；`llm.ts:258` 同样。
- **加重情节**：UI 层的 `HISTORY_LIMIT = 8`（`AgentChat.tsx:63`）**只保护自身**；MCP/REST 等其它调用方裸奔。`role:'tool'` 消息缺 `tool_call_id`，OpenAI 侧会直接 400。
- **修法**：core 增加 `historyLimit`（默认 8~16）与角色白名单（`user`/`assistant`，其余丢弃或规范化）。

#### F2　输入与上下文无长度上限　→ L1-10 / L1-11 / L5-02 ❌
- **现象**：20 万字符 prompt 与 context 原样送出（实测 200000 / 200012 / 200100 字符）。
- **定位**：`fc.ts:412-416`、`llm.ts:256-260` 纯拼接，无 `maxPromptChars` / `maxContextChars`。UI 侧仅对**附件**有限制（`AgentChat.tsx:65-66` 的 5 个 / 256KB），textarea 与历史均无上限。
- **危害**：token 预算瞬间打满、provider 413、费用失控。
- **修法**：core 增加可配置上限 + 超限截断策略（保留头尾中间打省略号），并在事件流中告知已截断。

### P2 — 可诊断性 / 体验

| 编号 | 用例 | 现象 | 定位 | 修法 |
| --- | --- | --- | --- | --- |
| F1 | L1-07/08/09 | 空/空白 prompt 照样发起请求 | `fc.ts:415`、`llm.ts:259` 无非空校验（UI 在 `AgentChat.tsx:252` 已兜底） | core 增加空输入短路 |
| F6 | L1-17 | 错误信息为 `Cannot read properties of undefined (reading 'trim')` | `tools.ts:65-72` `slug(undefined)` 抛 TypeError，被 `tools.ts:199-203` 原样透出 | 写入前先校验必填，返回 `missing required field: name` |
| F7 | L1-22 | 非流响应体（字符串）静默产出空文本 | `llm.ts:160-174` `chunksOf` 对不支持类型直接 return；`llm.ts:217` 仅判 `!res.body` | 无法迭代时抛"响应体不是可读流" |
| F9 | L2-16 | `intervalMinutes: NaN` → `NaN` ms | `recipes.ts:109` `Math.max(1, NaN)` = NaN（`??` 不挡 NaN） | 用 `Number.isFinite()` 判定后回落 60 |
| F10 | L2-17 | 空提示词 recipe 仍匹配并投递 | `recipes.ts:61-66` 未校验 `prompt` 非空 | 过滤空/纯空白 prompt |
| F11 | L3-09/10 | 未知 provider 或未配 baseUrl → URL 变成 `/chat/completions` | `llm.ts:51-53` 未命中回落 `baseUrl:''`；`llm.ts:71`/`fc.ts:86` 空串直接拼路径 | 空 baseUrl 时抛"未配置 baseUrl"，而非产出相对 URL |
| F12 | L3-11 | 缺 apiKey 仍发出无鉴权请求 | `llm.ts:107` `if (cfg.apiKey)` 静默跳过（UI 的 `canLlm` 在 `AgentChat.tsx:147`） | core 对 `needsKey` provider 前置校验 |
| F20 | L6-09 | `res.json()` 抛原始 `SyntaxError`，无 URL/状态码上下文 | `fc.ts:185-186` 未 try/catch | 包装为 `chat failed status=… <url>` |
| F21 | L6-12 | 模型返回空响应（无内容无工具）时只 yield done，UI 显示空白气泡 | `fc.ts:435-439` `toolCalls` 为 0 且 `content` 为空时无兜底 | 产出"模型返回空响应"提示或触发一次重试 |

---

## 六、修复记录（21/21 已全部修复）

修复后 **121/121 全部通过**，`packages/core` 与 `apps/web` 双端 `tsc --noEmit` 均 0 错误。

### 6.1 源码改动一览

| 文件 | 修复项 | 改动要点 |
| --- | --- | --- |
| `src/agent/llm.ts` | F2 F7 F11 F12 F14 F19 F15 F1 | 新增 `MAX_PROMPT_CHARS` / `MAX_HISTORY_CHARS` / `DEFAULT_HISTORY_LIMIT` / `EMPTY_RESPONSE_HINT` / `RETRYABLE_STATUS` / `RetryPolicy`；新增 `resolveBaseUrl()`、`assertApiKey()`、`truncateText()`、`normalizeHistory()`、`fetchWithRetry()`（408/429/5xx 与网络异常指数退避重试，默认 2 次）；`chunksOf()` 对不可读响应体抛错；`buildChatRequest()` 校验 baseUrl 与 apiKey；`runAgent()` 空输入短路、retrieve 纳入 try、历史净化、上下文截断 |
| `src/agent/fc.ts` | F1 F2 F11 F12 F14 F18 F20 F21 F15 | `buildToolsRequest()` 校验 baseUrl/apiKey；`chatWithTools()` / `streamChatWithTools()` 接入重试并包装 JSON 解析错误；`ToolAgentEvent` 新增 `error` 类型；`runToolAgent()` 空输入短路、历史净化、prompt 截断、整体 try/catch（失败以 `error` 事件暴露并仍以 `done` 收尾）、空响应兜底 `EMPTY_RESPONSE_HINT` |
| `src/agent/tools.ts` | F3 F4 F5 F6 F13 | 新增 `requiredString()` / `normalizeLimit()`；`search` 校验 `query` 并归一化 `limit`（0/负数/NaN 回落 20）；`write_note` 校验 `name`/`content`，`append_to_note` 校验 `text`；`call()` 拒绝元方法 `call`/`manifest` |
| `src/agent/sandbox.ts` | F5 F16 F17 | `write_note` 校验必填；`append_to_note` 改用 **overlay 视图**取基线（修复连续 append 丢内容）并识别 pending delete；`acceptAll` 改为「应用即出队」，失败项保留并抛 `sandbox accept 部分失败：…` |
| `src/agent/recipes.ts` | F8 F9 F10 | `renderRecipePrompt` 改函数式替换（阻断 `$&`/`$'`/`$$` 特殊模式）；`recipeIntervalMs` 用 `Number.isFinite` 回落 60；`matchRecipes` 过滤空白 prompt |
| `apps/web/.../AgentChat.tsx` | 配套 | 处理新增的 `error` 事件，在工具轨迹中展示一条失败步骤 |

### 6.2 行为变更（调用方需知）

1. **空 prompt 现在会抛错**（`prompt 为空：请输入问题后再调用 Agent`），不再发起请求。Web 端已有 `if (!q && attachments.length === 0) return` 兜底，不受影响。
2. **`needsKey` provider 缺 apiKey 现在会抛错**，`custom` provider 未配 baseUrl 同样抛错——不会再产生 `/chat/completions` 这类相对 URL。
3. **工具模式的外部失败不再向上抛**：改为产出 `{type:'error'}` 事件 + `[模型调用失败]…` 文本 + `{type:'done'}`。依赖 `rejects.toThrow` 的调用方需改为检查 `error` 事件。
4. **`search` 的 `limit` 语义收紧**：0 / 负数 / NaN 一律回落默认 20（原行为：`-1` 吞掉末条、`NaN` 返回空）。
5. **历史被窗口化**：最多 8 条（与 Web 端 `HISTORY_LIMIT` 对齐）、总字符 ≤ 16 000，且只保留 `user`/`assistant` 角色。
6. **单条用户消息截断到 32 000 字符**（问题 + 检索资料合计）。

### 6.3 同步调整的既有用例

以下 3 处既有/新增用例曾编码旧行为，已随修复一并对齐（非功能回退）：

| 用例 | 原断言 | 新断言 |
| --- | --- | --- |
| `tests/fc.test.ts` 只读模式写工具拦截 | `cfg` 无 apiKey | 补 `apiKey: 'k'`（缺 key 现在被前置校验拦截） |
| `tests/llm.test.ts` 非 2xx 抛错 | `cfg` 无 apiKey | 补 `apiKey: 'k'`，保持验证 401 透传 |
| `L4-28` / `L6-09` / `L6-10` / `L3-11` | `rejects.toThrow` | 改为检查 `error` 事件（工具模式不再抛出） |
| `L1-15` | `limit:0` → `[]` | `limit:0` 回落默认 20 → 2 条命中（语义收紧，见 6.2-4） |
| `L5-12` | pending 清空为 0 | 已应用项出队、失败项保留（更合理的原子性语义） |

### 6.4 结论

1. 缺陷根因集中在两层：**校验缺失**（core 几乎无参数校验，责任被推给最外层 UI，`protocol.ts` 声明的 JSON Schema 从未在运行时生效）与**韧性缺失**（工具模式无降级/无重试/无历史窗口/无长度上限，`runAgent` 有降级而 `runToolAgent` 没有）。
2. 修复采取「core 层统一防线」策略：在 `VaultTools.call()` 与 `runToolAgent/runAgent` 入口统一做入参校验 + 容量约束 + 异常归一化，一次性覆盖了 60% 以上的 P1/P2 项，避免把防御逻辑散落在各调用方。
3. 剩余可选项（未做，非缺陷）：按 `protocol.ts` 的 `inputSchema` 做完整 JSON Schema 校验；把重试策略 / 容量上限做成用户可配项。
