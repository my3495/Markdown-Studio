# 打开大型方案文档「卡滞」诊断报告

> 对象：`Markdown-Studio-项目开发详细方案-V1.0-Final.md`（50.3 KB / 34,607 字符 / 1,437 行）
> 时间：2026-10-18
> 结论：**不是性能卡顿，是整页渲染崩溃（白屏）**，并且与文档大小无关 —— 只要文档里有任意一个代码块就会触发。

---

## 一、现象复现

在桌面壳（debug + dev server）中打开该文档后：

| 观察项 | 结果 |
|---|---|
| 预览区 | 消失（`.md-preview` 不存在） |
| 侧栏 / 工具栏 / 状态栏 | **全部消失** |
| `#root.innerHTML.length` | **0** |
| 控制台 | 3 条 `Uncaught` + 1 条 React 组件栈错误 |
| 进程 | 仍在运行，CPU 不高 —— 所以用户感知为「卡死」而不是「崩溃退出」 |

进一步用最小样例验证：

```md
# hi

```js
const a = 1;
```
```

→ 同样 `#root` 长度 0。**与文件规模、表格数量、标题数量均无关。**

---

## 二、根因链

### 1. 代码块会产生 `style` 属性

`rehype-shiki` 用 shiki 的 `codeToHast()` 输出高亮结果，产物形如：

```json
{ "tagName": "pre", "properties": { "class": "shiki github-light",
  "style": "background-color:#fff;color:#24292e", "tabindex": "0" } }
```

该文档 19 个代码块 → 19 个 `<pre>` + 1,409 个 `<span style="color:#…">`，共 **1,428 个 style 属性**。

### 2. `style-to-js@1.0.0` 的 CJS 产物缺少 `__esModule`

`hast-util-to-jsx-runtime@2.3.6` 内部这样用：

```js
import styleToJs from 'style-to-js'
…
try { return styleToJs(value, { reactCompat: true }) }
catch { throw new VFileMessage('Cannot parse `style` attribute', …) }
```

而 `style-to-js` 的 `cjs/index.js` 只有：

```js
exports["default"] = StyleToJS;   // 没有 Object.defineProperty(exports, "__esModule", …)
```

于是 Node / Vite 的默认导入拿到的是**命名空间对象**而非函数（实测 `typeof st === 'object'`、`typeof st.default === 'function'`）。调用即 `TypeError`，被上面那个 `catch` **包装成“Cannot parse style attribute”** —— 错误信息把人引向“样式写错了”，实际是依赖互操作问题。

验证：

```bash
$ node --input-type=module -e "import st from '…/style-to-js/cjs/index.js'; console.log(typeof st, typeof st.default)"
object function
```

### 3. 渲染期抛错 + 没有错误边界 = 整棵树被卸载

`MarkdownView` 在 React render 阶段调用 `toJsxRuntime`，抛错后 React 18 会卸载整个根树。应用里没有任何 Error Boundary，于是工具栏、侧栏、编辑器、状态栏一起消失。

---

## 三、修复（3 处，均为最小改动）

### 3.1 根因：`MarkdownView` 自己把 style 字符串转成对象

`packages/ui/src/index.tsx`

- 新增 `parseStyle()`：按 `;` / `:` 拆分声明，短横线转 camelCase，`--*` 自定义属性原样保留
- 新增 `normalizeStyles()`：只复制**含 style 的节点及其祖先**，其余保持原引用（结构共享）
- `useMemo` 依赖 `hast`：每次文档更新只走一遍 O(n) 浅层遍历，实测对 4,374 节点开销可忽略
- **降级策略**：单条声明解析不出来就删掉该属性，绝不抛错 —— 最坏情况是代码块没有配色，而不是白屏

这样也绕开了 `style-to-js` 的互操作缺陷，不依赖打包器配置。

### 3.2 兜底：预览区错误边界

`apps/web/src/features/preview/PreviewBoundary.tsx` + `App.tsx` 包裹 `<MarkdownPreview>`

- 渲染异常只在预览面板内降级：显示「预览渲染失败 + 错误信息 + 重新渲染」
- 编辑器、侧栏、状态栏不受影响，正文不会丢
- 三语文案：`previewErrorTitle` / `previewErrorHint` / `previewRetry`

### 3.3 顺带的性能治理：合并渲染 + 丢弃过期结果

`apps/web/src/stores/document.ts`

原实现每次内容变化都 `await render()`，而单次 render 对这份文档约 300–400ms。持续输入时多个 render 会**交叠执行**，把主线程彻底压满。

改为：

- 正文先落库（`dirty` 标记立即生效）
- 解析/渲染按文档做 **140ms 尾随合并**；期间再有新版本则直接放弃本次（序号比对）
- **首次打开（还没有 hast）不延迟**，保证「打开即见」

---

## 四、修复前后实测

环境：无头 Edge + CDP，1280×820，dev server。

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 打开该文档 | **整页白屏**（`#root` 长度 0） | 正常渲染 **4,374** 个节点 |
| 预览内容 | 无 | 28,945 字符 / 37 表格 / 319 行 / 19 代码块 / 90 标题 |
| 控制台异常 | 3 条 Uncaught | **0** |
| 首帧耗时 | — | **1,095 ms** |
| 连续输入 10 字（间隔 120ms）长任务 | 每次按键一个 ~366ms 长任务，渲染排队 | **仅 1 个 287ms 长任务** |
| 末次按键 → 预览追平 | 不断累积、明显滞后 | **485 ms** |

> 首次打开 1.1s 主要来自 shiki 冷启动（主题 + 语言按需加载，单测基准 `default 1057ms` vs `no-highlight 337ms`），属一次性成本。

---

## 五、剩余性能画像（未在本轮处理）

这份文档的结构决定了后续优化方向：

| 事实 | 数值 |
|---|---|
| 单次 `render()`（暖机） | ~250–400 ms（其中 shiki ~150–700ms） |
| 预览 DOM 节点 | 4,374 |
| `[data-line]` 元素（滚动同步索引用） | **2,264** |
| 预览滚动高度 | 58,070 px |

可选优化（按性价比排序）：

1. **shiki 预热**：应用启动空闲时预加载主题 + 常用语言，首开可省 ~500ms
2. **高亮结果缓存**：按 `(theme, lang, code)` 缓存 hast 子树，插入时深拷贝（`remarkDataLine` 会在其后注入 `data-line`，不能直接复用同一对象）；纯文段编辑时省 ~150ms
3. **预览虚拟化**：4,374 节点全量 reconcile 是剩余的主要成本；按块分片 + 视口渲染可再降一个数量级（改动较大）
4. **滚动索引降频**：`buildIndex()` 对 2,264 个元素逐个 `getBoundingClientRect()`，可改为按块级元素（约 485 个）建索引
5. **Worker 解析**：`render()` 移入 Worker（core 注释里已提到 ADR-01 的 Worker 目标，但目前仍跑在主线程）

---

## 六、验证清单

| 项 | 结果 |
|---|---|
| `MarkdownView.style.test.tsx`（代码块/多语言/表格标题） | 3/3 通过 |
| `PreviewBoundary.test.tsx`（降级/透传/重试） | 3/3 通过 |
| `StatusBar.test.tsx`、`agentChatUtils`、`AgentChat.events` | 全部通过 |
| `packages/ui` / `apps/web` `tsc --noEmit` | 0 错误 |
| `packages/core` `pipeline` / `typography` | 通过 |
| `vite build` | 通过 |
| 真实文档打开 | 无异常，预览完整 |

复跑脚本：`desktop-test/diag-large-doc.mjs`、`desktop-test/diag-typing.mjs`
