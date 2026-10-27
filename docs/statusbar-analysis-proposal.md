# 底部状态栏缺失分析与补充方案

> 分析对象：Markdown Studio 桌面版（1200×800 debug 外壳 + dev server 渲染）  
> 采集时间：2026-10-18 10:26  
> 采集方式：CDP 实测 DOM 度量 + 截图 + 源码核对

---

## 一、结论

**底部状态栏确实缺失。**

当前界面**没有**任何横跨窗口底部的状态栏元素，只有一个 90×26px 的悬浮「统计胶囊」漂在编辑/预览区右下角。它承担了原状态栏约 20% 的职责（字数、行列），其余信息（文档身份、完整路径、保存状态文字、排版告警、视图模式、模型连接）在主界面完全不可见。

源码里也留了口供：

```
styles/index.css:1427
/* ------------------ 统计胶囊（编辑器右下角，取代整条状态栏） ------------------ */
```

即：**状态栏是被主动「取代」掉的，而不是遗漏**。这个决策在窄屏下省空间，但在桌面宽屏下损失了信息密度与可发现性。

---

## 二、实测证据

### 2.1 结构：`.app-shell` 只有两个可见行

| 子元素           | 位置 (x, y) | 尺寸         | 说明                |
| ------------- | --------- | ---------- | ----------------- |
| `.toolbar`    | 0, 0      | 1266 × 52  | 顶部工具栏             |
| `.app-body`   | 0, 52     | 1266 × 731 | 侧栏 + 主区 + Agent 栏 |
| `.toast-host` | 1250, 755 | 0 × 0      | toast 容器，非布局元素    |

- `document.querySelectorAll('footer, .statusbar, .status-bar, [role=contentinfo]').length` → **0**
- `.app-body` 的 `bottom = 783`，正好等于视口高度 783 —— **内容直接触到窗口底边，没有底栏**

### 2.2 唯一底部元素：悬浮胶囊

| 项    | 实测值                                                          |
| ---- | ------------------------------------------------------------ |
| 尺寸   | 90 × 26 px                                                   |
| 位置   | (822, 745)，右下角                                               |
| 定位   | `position: absolute; right: 14px; bottom: 12px; z-index: 25` |
| 归属容器 | `.app-work`（即**主区**右缘，不是窗口右缘）                                |
| 显示内容 | `7`、`4:1`（裸数字，无标签）                                           |
| 不透明度 | 0.85（focus 模式降到 0.55）                                        |

### 2.3 由此产生的 8 个具体缺陷

| #  | 缺陷                                            | 证据 / 影响                                                                                          |
| -- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| S1 | **语义错位**：胶囊锚在 `.app-work` 右缘，分栏模式下落在**预览区**上方 | 实测 `pill.right=912` ≤ `preview.right`，即「光标行列」显示在预览区而非编辑区                                         |
| S2 | **裸数字无标签**：`7 4:1`                            | 新用户无法判断 `4:1` 是行:列还是比例；无单位、无图标语义                                                                 |
| S3 | **保存状态只有一个 7px 色点**                           | 无文字、无 tooltip、无「上次保存时间」；绿=已保存/橙=未保存需靠记忆。且标签栏 `●` 另有一个圆点，两处含义不一致                                  |
| S4 | **文档身份不完整**                                   | 只有标签栏文件名，**看不到完整路径**；多个同名 `未命名.md`、多根目录场景无法区分；`path=null`（未落盘）也无明确标识                             |
| S5 | **排版告警不可见**                                   | core 的 `pipeline` 已产出 `TypographyWarning[]`（`Doc.warnings`），但除正文下划线外，**没有任何计数入口**                |
| S6 | **全局连接状态缺失**                                  | Ollama 状态只出现在 Agent 面板和设置面板；主界面无全局指示，AI 报错时用户无法快速判断是「模型没开」还是「请求失败」                               |
| S7 | **模式状态不可见**                                   | 专注 / 打字机 / 自动编号 / 视图模式只在展开弹层里作为 badge 出现                                                         |
| S8 | **遮挡正文**                                      | 仅编辑模式下胶囊占 `bottom 12–38px`，而 CodeMirror 内容区底部只有 `padding: 12px 0`，长文滚动到底时**最后一行会被压住**（半透明仍影响可读性） |

---

## 三、缺失的具体位置

### 3.1 应该在哪

`.app-shell` 是 `display:flex; flex-direction:column`，已有两行。状态栏应作为**第 3 个 flex 子项**，插在 `.app-body` 之后、`.toast-host` 之前：

```
.app-shell (flex column, 100vh)
├── .toolbar          52px   ← 顶部全宽
├── .app-body         flex:1 ← 侧栏 260 + 主区 + Agent 341
└── .statusbar        26px   ← 【缺失】底部全宽，跨侧栏/主区/Agent
```

### 3.2 为什么是「跨全宽」而不是「只在主区」

| 方案                         | 优点                                                               | 缺点                              | 结论     |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------- | ------ |
| A. 跨全宽（`.app-shell` 第 3 行） | 三段结构（工具栏/内容/状态栏）完整，与 VS Code、Typora、Obsidian 一致；侧栏折叠/Agent 开关不影响 | 需占据 26px 全局高度                   | **推荐** |
| B. 只在主区底部                  | 不挤压侧栏与 Agent 面板                                                  | 视觉上切断三段结构；Agent 开启时状态栏突然变窄，信息跳动 | 不推荐    |
| C. 维持悬浮胶囊                  | 不占高度                                                             | 即为现状，8 个缺陷无法解决                  | 淘汰     |

### 3.3 高度预算

加入 26px 后：

- 编辑器可用高度：683 → **657px**（-3.8%）
- 窗口 800px 高时：工具栏 52 + 标签栏 48 + 状态栏 26 = 126px 固定开销

建议 **26px**：低于 24px 时 12px 文字会顶到边框；高于 28px 会与 30px 的工具按钮产生视觉竞争。

---

## 四、应包含的信息（三区结构）

### 4.1 左区：文档身份与保存

| 项    | 内容                                  | 数据来源                                       | 现状       |
| ---- | ----------------------------------- | ------------------------------------------ | -------- |
| 文件名  | `使用指南.md`                           | `documents.active.name`                    | 仅标签栏有    |
| 完整路径 | `~/笔记/写作/使用指南.md`（超长省略，hover 显示全路径） | `documents.active.path`                    | **完全缺失** |
| 保存状态 | `● 已保存` / `● 未保存，⌘S 保存`（文字 + 色点）    | `documents.active.dirty`、`vault.persisted` | 仅色点      |
| 保存时间 | `10:22 已保存`（可选）                     | 需新增 `savedAt` 字段                           | 无        |

### 4.2 中区：写作模式与质量

| 项    | 内容                      | 数据来源                               | 现状        |
| ---- | ----------------------- | ---------------------------------- | --------- |
| 排版告警 | `⚠ 3 处排版问题`（点击跳设置·中文排版） | `documents.active.warnings.length` | **完全缺失**  |
| 专注模式 | `专注` 小胶囊                | `settings.focusMode`               | 仅弹层 badge |
| 打字机  | `打字机` 小胶囊               | `settings.typewriterMode`          | 仅弹层 badge |
| 自动编号 | `自动编号: 1.`              | `settings.autoNumber`              | 仅弹层 badge |

### 4.3 右区：计量与运行状态

| 项        | 内容                              | 数据来源                                        | 现状             |
| -------- | ------------------------------- | ------------------------------------------- | -------------- |
| 字数       | `1,284 字`（CJK 字符 + 英文词）         | `documents.active.words`（core `countWords`） | 有，裸数字          |
| 字符数      | `3,010 字符`（可选）                  | `active.content.length` 派生                  | 无              |
| 光标       | `行 12, 列 8`（可简写 `12:8`）         | CodeMirror `selection.main`                 | 有，裸数字          |
| 选区       | `选中 32`（仅当选区非空时出现）              | `sel.to - sel.from`                         | 仅弹层            |
| 视图模式     | `编辑` / `预览` / `分栏`              | `settings.mobileView`                       | 工具栏有按钮，但状态栏无回显 |
| 模型连接     | `● Ollama 在线` / `● 未连接`（点击打开设置） | `ollama.status`、`settings.agent.model`      | **主界面完全缺失**    |
| 会话 token | `本会话 1.2k tok`（可选）              | `tokenUsage.totals`                         | 仅 Agent 面板     |

### 4.4 空间不足时的裁剪优先级

宽屏 1266px 可容纳全部；窄屏按下列顺序**从右往左**丢弃（保留左侧核心）：

1. 会话 token
2. 字符数
3. 模式胶囊（专注/打字机/自动编号）
4. 选区
5. 告警数（降级为纯图标）
6. 路径（只留文件名）

**任何宽度下都保留**：保存状态、文件名、字数、光标、模型连接。

---

## 五、与现有布局的衔接方式

### 5.1 DOM 改动（1 处）

```tsx
// App.tsx —— 现状：StatusBar 挂在 .app-work 内部（line 484）
<div className="app-preview">…</div>
<StatusBar editorView={editorViewRef.current} persisted={vault.persisted} />
</div></div>   // .app-work / .app-main

// 改为：挪到 .app-body 之后，成为 .app-shell 的直接子项
</div>          // .app-body
<StatusBar /* variant="bar" */ />
<CommandPalette … />
```

### 5.2 CSS 骨架

```css
.statusbar {
  flex: 0 0 26px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border-top: 1px solid var(--md-hairline);
  background: var(--md-color-surface);
  color: var(--md-color-muted);
  font-size: 12px;
  user-select: none;
}
.sb-left  { flex: 1 1 auto; min-width: 0; display: flex; gap: 10px; align-items: center; }
.sb-mid   { flex: 0 1 auto; display: flex; gap: 8px; align-items: center; }
.sb-right { flex: 0 0 auto; margin-left: auto; display: flex; gap: 12px; align-items: center; }
.sb-item  { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
            overflow: hidden; text-overflow: ellipsis; }
.sb-item.clickable { cursor: pointer; border-radius: 4px; padding: 0 4px; height: 20px; }
.sb-item.clickable:hover { background: var(--md-fill-1); color: var(--md-color-fg); }
.sb-sep   { width: 1px; height: 12px; background: var(--md-hairline); flex: 0 0 auto; }
```

- 复用现有 `--md-color-*` 令牌 → **暗色主题自动跟随**，无需新增色值
- 字号统一 **12px**（落在既有 5 档字号的第 2 级；不建议 11.5px 这类非整数值）
- 图标沿用 `<Icon size={12} />`，颜色继承

### 5.3 与三栏的关系

| 场景             | 行为                                                                  |
| -------------- | ------------------------------------------------------------------- |
| 侧栏折叠           | 状态栏不变（在外层），左区保持贴窗口左缘                                                |
| Agent 面板开/关    | 状态栏不变宽；右区信息不被裁切（因为它是全宽，不是主区局部）                                      |
| 分栏 / 仅编辑 / 仅预览 | 状态栏不变；光标项在「仅预览」时置灰（编辑器不可见，行列无意义）                                    |
| 专注模式           | 整条滑出隐藏（`translateY(100%)`），鼠标移到底部 8px 热区再浮出；替代现在「透明度降到 0.55 仍遮挡」的做法 |
| ≤1024px        | 隐藏中区 + 按 4.4 顺序裁剪；`gap` 收窄到 6px                                     |
| ≤768px（移动端）    | 只保留 `字数 · 行列`，等价于现有胶囊；此时可保留「胶囊形态」作为窄屏变体                             |

### 5.4 交互回填（解决 S5/S6）

- 点击 `⚠ 3 处排版问题` → 打开设置面板并定位到「中文排版」分组
- 点击 `● Ollama 在线` → 打开设置面板的模型连接区
- 点击 `● 未保存` → 立即保存当前文档（等价 ⌘S）
- 点击字数区 → 展开现有 `stats-pop` 详情（**保留**现有弹层，作为「状态栏的详情浮层」，不删除已有能力）
- 路径项：hover 显示全路径 tooltip，双击复制

---

## 六、实施建议（分阶段）

### P0 —— 立起骨架（约 1 小时，风险低）

1. `features/statusbar/StatusBar.tsx` 增加 `variant?: 'pill' | 'bar'`，或直接改造为 bar 版并保留 pill 变体给 ≤768px
2. `App.tsx` 移动挂载点（见 5.1）
3. CSS 新增 `.statusbar` 系列 8 条规则
4. 左区：文件名 + 路径（省略号 + tooltip）+ 保存状态文字
5. 右区：字数 + 行列 + 视图模式
6. i18n 新增 4 个词条 × 3 语：`sbPath`、`sbSavedAt`、`sbNoPath`、`sbViewMode`

**验收**：`footerCount=1`、高度 26px、编辑器高度 683→657、无横向滚动、暗色下文字对比度 ≥ 4.5:1。

### P1 —— 信息补全（约 2 小时）

1. 中区：排版告警计数（可点击）+ 模式胶囊
2. 右区：Ollama 连接状态（复用 `.sb-d进行细粒度进行进行`逻辑（4.4 的优先级表）

**验收**：Agent 断网时状态栏出现红点；告警文档显示 `⚠ 3`；≤1024 无溢出且核心 5 项仍在。

### P2 —— 打磨（约 2 小时）

1. 保存时间戳（`Doc` 增 `savedAt`）
2. 字符数、会话 token
3. 专注模式下自动隐藏 + 底部热区唤出
4. 键盘可达：状态栏项支持 Tab 聚焦、Enter 触发
5. 组件测试：`StatusBar.test.tsx`（无文档 / 未落盘 / 告警 / 窄屏裁剪 / 点击路径）

---

## 七、顺带发现的一个潜在 Bug

`App.tsx:484` 传入的是 `editorViewRef.current`：

```tsx
<StatusBar editorView={editorViewRef.current} persisted={vault.persisted} />
```

`ref.current` 的赋值**不会触发重渲染**。若首次渲染时编辑器尚未创建（`null`），`StatusBar` 的 `useEffect` 会直接 `return`，此后再也不会订阅 `selectionchange` —— 光标行列将永久停在初始值 `1:1`。

实测当前显示 `4:1`（文档 4 行、光标在第 1 列）无法区分是「正常订阅」还是「恰好命中默认值」，但这是**明确的风险点**。建议改为：

```tsx
const [view, setView] = useState<EditorView | null>(null);
// onCreateEditor: setView(v)
<StatusBar editorView={view} … />
```

或让 `StatusBar` 内部订阅 zustand 的 `editorView` 状态。改造状态栏时应一并修掉。

---

## 八、附：当前底部区域截图

`%TEMP%/sb-bottom-strip.png`（窗口底部 160px 切片）

可直接看到：左侧侧栏、中间预览、右侧 Agent 面板**全部无底栏**，只有预览右下角一枚 `7 4:1` 胶囊。

---

# 九、落地记录（2026-10-18 已实施）

## 9.1 改动文件

| 文件 | 改动 |
|---|---|
| `apps/web/src/features/statusbar/StatusBar.tsx` | 重写为三区通栏（footer/role=contentinfo）；保留字数详情弹层；保存项可点击；告警与连接项跳设置 |
| `apps/web/src/App.tsx` | 挂载点从 `.app-work` 内移到 `.app-body` 之后；新增 `editorView` state；抽出 `saveActive` 供快捷键与状态栏共用 |
| `apps/web/src/features/editor/CodeMirrorEditor.tsx` | 新增 `onReady(view \| null)`，在挂载/销毁时通知外层（修 `ref.current` 不触发重渲染的订阅缺口） |
| `apps/web/src/styles/index.css` | 新增 `.statusbar` 三区布局与响应式；删除 `.stats-pill*`；专注模式改为「收敛而非半透明遮挡」 |
| `apps/web/src/i18n/index.ts` | zh/en/ja 各 11 个词条（sbLabel…sbChars） |
| `apps/web/src/features/statusbar/__tests__/StatusBar.test.tsx` | 新增 13 个组件用例 |
| `desktop-test/verify-statusbar.mjs` / `verify-statusbar2.mjs` | 可复跑的 DOM 度量与截图脚本 |

## 9.2 实测（1280×820，无头 Edge + CDP）

| 项 | 结果 |
|---|---|
| `footer/[role=contentinfo]` 计数 | **1**（此前 0） |
| 状态栏尺寸 | **1280 × 26**，y=794，贴窗口底边 |
| 内容区高度 | 741（原 767）——只让出 26px |
| 横向溢出 | 无（1280 / 1024 / 900 / 768 全档 `scrollWidth = clientWidth`） |
| 悬浮胶囊 | 已移除（`.stats-pill-wrap` 不存在） |
| 保存态流转 | 已保存（按钮禁用）→ 改内容「未保存」（可点）→ 点击保存回到「已保存」 |
| 路径去重 | `path === name`（Web 本地存储）时不再重复渲染 |
| 详情弹层 | 230×148，位于状态栏上方 5px，外部 mousedown 关闭 |
| 窄屏 900 | 隐藏视图模式，其余保留 |
| 窄屏 768 | 再隐藏路径与连接文案，保留「文件名/保存/字数/光标/状态点」 |
| 暗色 | `--md-color-surface` → `rgb(34,31,27)`，文字 `rgb(167,157,144)`，自动跟随 |
| 控制台异常 | 0 |

## 9.3 与方案的差异（及原因）

1. **专注模式不再整条滑出**，改为隐藏中区/路径/视图模式并把不透明度降到 0.86。原因：专注写作时字数与光标恰恰是最需要的信息；方案里的「滑出 + 热区唤出」需要额外的 hover 判定与 z-index 处理，收益低。
2. **字符数只放在详情弹层**，未上bar。原因：bar 上已有字数，两个相近数字并排易误读（P2 项保留）。
3. **保存时间戳未做**：`Doc` 需新增 `savedAt` 字段并贯通 markSaved/持久化，属独立小迭代。

## 9.4 未做的 P2（仍可继续）

- `Doc.savedAt` + 状态栏显示「10:22 已保存」
- 会话 token 上bar
- 状态栏项键盘 Tab 序列与 `aria-live` 保存状态播报
