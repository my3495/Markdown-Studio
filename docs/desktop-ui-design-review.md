# 桌面版 UI 设计评估报告

> 评估对象：Markdown Studio 桌面版（Tauri 2.0 + WebView2，debug 构建，dev server :1420）
> 评估日期：2026-10-18
> 桌面程序状态：已启动（`markdown-studio.exe`，窗口 1200×800，已加载渲染层）
> 方法：真实运行截图（1440/1200/900 三档 × 亮/暗）+ DOM 几何与样式度量（getBoundingClientRect / getComputedStyle / 对比度计算）

---

## 一、总体结论

三栏结构（导航 260 / 编辑预览 / Agent 341）清晰、排版内核（16px/28px 行高、正文对比度 15.8:1）扎实，但**在默认窗口尺寸下布局就已经溢出和挤压**：工具栏内容宽 1405px 而窗口只有 1200px；打开 Agent 后预览正文宽度只剩约 197px（≈12 个汉字/行）。这是「设计在 1440 以上成立、在交付尺寸失效」的典型问题。

| 维度 | 评分 | 一句话结论 |
| --- | --- | --- |
| 视觉层级 | ★★☆☆☆ 2.5 | 工具栏 11 个按钮同权重、无主操作；品牌两行、Banner 抢焦点 |
| 信息结构 | ★★★☆☆ 3 | 三栏 IA 合理，但「打开文件夹」在首屏出现 3 次，侧栏过滤控件堆叠 5 层 |
| 元素间距 | ★★★☆☆ 3 | 有 8/12 体系，但预览固定 48px 内边距在窄栏失效，Banner 占 110px |
| 对齐方式 | ★★★☆☆ 3.5 | 主栅格对齐良好；工具栏换行破坏基线，属性面板输入溢出 |
| 一致性 | ★★☆☆☆ 2.5 | 8 档字号（含 13.3333px）、按钮用 Arial 而正文用 PingFang、设置内 5 个英文 key、色板预览全同色 |
| 可读性 | ★★★☆☆ 3.5 | 正文排版优秀；Agent 开启后行宽崩溃 |
| 操作路径 | ★★☆☆☆ 2.5 | 900px 下 7 个控件被裁切不可达；面板间争抢空间无自动降级 |

**综合 2.9 / 5**（视觉可用，但在默认尺寸与窄屏下存在阻断级问题）。

---

## 二、问题清单

### U1【P0】工具栏在默认窗口即溢出，窄屏裁掉核心功能

- **证据**：1200px 窗口下 `.toolbar` `scrollWidth=1405 / clientWidth=1200`（溢出 205px）；900px 下 `1430/900`（溢出 530px），实测被裁控件：**预览、分栏、命令、导出、更多、设置、Agent**。
- **影响**：① 默认 1200×800 窗口右侧控件被截断，用户看不到「设置/Agent」；② 900px（分屏、13" 屏缩放 125%）下**视图切换与 Agent 入口完全不可达**；③ 无溢出提示（无渐隐、无滚动条），用户以为功能不存在。
- **建议**：
  1. 分级收纳：`≥1440` 全展开；`1200–1440` 隐藏次要按钮文字（图标+tooltip）；`1024–1200` 把 对焦/阅读态/导出/更多 收进「⋯」；`<1024` 品牌只留 logo，主操作 + 「⋯」。
  2. 兜底：`.toolbar { overflow-x: auto; scrollbar-width: thin }` + 右缘 `mask-image` 渐隐，避免「静默截断」。
  3. 验收：1200/1024/900 三档下所有一级功能可点到（或经「⋯」），无裁切、无横向抖动。

### U2【P0】品牌两行导致工具栏 73px，垂直空间被吃掉

- **证据**：`.tb-brand` 宽 121px，`Markdown Studio` 折成两行；`.toolbar` CSS 高 48px，实际 `73px`（内容撑高）。Banner 再占 110px → **首屏仅剩 617px 工作区**。
- **影响**：13" 笔记本上编辑区高度不足；工具栏视觉重心偏重，与 13px 控件密度不匹配。
- **建议**：品牌强制单行（`white-space: nowrap`，必要时 14px 字号或缩短为「MS」+ 全称 tooltip）；或窄屏仅保留 24px logo 图标。目标工具栏回到 48px，首屏工作区 +25px。

### U3【P0】打开 Agent 后编辑/预览列宽崩塌，正文不可读

- **证据**：1200 宽 + Agent 开启：editor **299px** / preview **293px**；`.md-preview` 内边距固定 `40px 48px 64px`，正文有效宽度 ≈ **197px**（16px 汉字 ≈ 12 字/行）。关闭 Agent 后 main 939px、preview 464px（有效 368px ≈ 23 字/行，仍偏窄）。
- **影响**：写作主场景不可用——用户打开 AI 助手反而失去可读的正文；分栏预览形同虚设。
- **建议**：
  1. 内边距自适应：`.md-preview { padding-inline: clamp(16px, 6%, 48px) }`；
  2. 空间守卫：当「剩余主区宽度 < 720px」时自动退出分栏（仅编辑器或仅预览），或给出「空间不足，已切为单栏」提示；
  3. Agent 打开时把侧栏（导航）设为可折叠，给正文让位；
  4. 验收：1200×800 下开 Agent，正文 ≥ 26 字/行（≥ 320px 内容宽）。

### U4【P1】设置面板存在 5 个未翻译的英文 i18n key

- **证据**：设置 → 中文排版 区，标签直接显示 `spacing / numberSpacing / punctuation / ellipsis / quotes`。
- **代码定位**：`apps/web/src/features/settings/SettingsPanel.tsx:20-26` 定义 `TYPO_KEYS` 后**直接把字段名当作 label 渲染**；`i18n/index.ts` 中不存在这 5 个词条（grep 无匹配）。
- **影响**：中文界面出现开发者变量名，专业性受损；用户无法理解「numberSpacing」是什么。
- **建议**：新增 5 个 i18n key（zh：字间隙 / 数字间隙 / 标点挤压 / 省略号样式 / 引号转换；en/ja 同补），标签改用 `t(locale, \`typo_${key}\`)`；CI 增加「渲染文本等于已知 dict key」的泄漏检查。

### U5【P1】首屏同一动作重复三次，Banner 长期占位

- **证据**：Banner「快速开始」（110px 高、通栏、浅蓝底）内含「文件夹 / 命令 (Ctrl+K)」；工具栏已有「文件夹」「命令」；侧栏空态又提示「打开本地文件夹后显示文件树…」。刷新后 Banner 复现。
- **影响**：首屏 13.75% 高度被教学文案占用；三处重复削弱「下一步做什么」的判断。
- **建议**：Banner 只在首次启动（或未绑定知识库时）显示一次，且压缩为 44px 单行：`[icon] 打开文件夹开始 · 或按 Ctrl+K` + 关闭；侧栏空态改为一行文字链接，不再重复按钮。

### U6【P1】字号阶梯 8 档且含非整数

- **证据**：chrome 内实测字号集合 `10 / 11 / 12 / 13 / 13.3333 / 14 / 15 / 16px`。
- **影响**：层级靠 1px 差异堆叠，用户感知不到「谁是标题谁是注脚」；13.3333px（=10pt）在缩放时半像素渲染发虚。
- **建议**：收敛为 5 档：`11（角标）/ 12（辅助）/ 13（控件）/ 15（正文 UI）/ 16（阅读正文）`，标题用 20/28；层级改由 **字重 + 颜色** 承担。

### U7【P1】工具栏按钮视觉权重完全相同，缺少主操作

- **证据**：11 个 `tb-btn` 同为「描边 pill + 图标 + 13px 文字」，`新建`（最高频）与`更多`（最低频）外观一致；分段控件 编辑/预览/分栏 与普通按钮同容器样式。
- **影响**：视线没有落点；用户需逐字读才能找到「新建」。
- **建议**：建立三级按钮：**主操作**（新建，实心 accent）、**次操作**（打开/保存，ghost + hover 底）、**工具/切换**（无边框，仅 hover 出底）；分段控件单独容器（内凹槽 + 选中白底），与普通按钮区分。

### U8【P1】字体栈不一致

- **证据**：`.tb-btn` computed `font-family: Arial`，`.side-tab` 同为 Arial；正文/标题为 `"PingFang SC"`。
- **影响**：中文在按钮与正文间字形/字重不一致；Windows 下 Arial 缺中文字形，回退不可控（可能出现宋体）。
- **建议**：定义全局 `--md-font-ui: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`，按钮与控件 `font: inherit`；正文单独 `--md-font-reading`。

### U9【P1】侧栏过滤区 5 层控件堆叠，作用域不清

- **证据**：从上到下依次为「过滤视图 Inbox」「视图名 / status / inbox / + chips」「搜索笔记…」「全部笔记 (5)」列表标题。
- **影响**：用户不知道 chips 过滤的是列表还是全文；搜索框与 chips 的关系不明；视觉上 4 个方块行连续出现，噪声大。
- **建议**：合并为一行工具条：`[搜索框（占满）] [筛选 icon（带计数）] [+]`；把视图名/status/inbox 收进筛选 popover；「全部笔记 (5)」作为列表分组标题（12px、字重 600、右侧「+」）。

### U10【P2】图谱视图画布过小、标签重叠

- **证据**：图谱面板置于 261px 侧栏内，节点集中在约 200×180 区域，`知识图谱 / 使用指南 / 全文搜索 / 双链与反链` 四个标签相互重叠；左下角有孤立蓝点无图例。
- **影响**：图谱不可读，等于装饰；用户无法通过图谱发现关系。
- **建议**：图谱升级为**独立视图**（主区 tab 或可放大弹层），默认 fit-to-view + 缩放/拖拽；标签做避让、hover 才显示全名；孤立节点加「未连接」图例。

### U11【P2】属性面板键/值输入造成横向溢出

- **证据**：属性 tab 下 `键`、`值` 两个输入并排于 261px 侧栏，出现侧栏横向滚动条（截图可见底部滚动条）。
- **影响**：输入被裁、易误滚；破坏侧栏对齐基线。
- **建议**：键/值改为上下两行（或 `flex-wrap`），输入 `min-width: 0`；长键名用省略 + tooltip。

### U12【P2】状态胶囊「T 7 4 1」语义不明

- **证据**：编辑器右下浮动胶囊显示 `T 7 4 1`（10px 字号）。
- **影响**：用户无法理解缩写含义（推测为 字数/词数/行数）。
- **建议**：改为 `7 字 · 4 段 · 1 行`，或保留图标 + hover tooltip 展开明细；去掉无意义的 `T` 前缀。

### U13【P2】深色模式按钮描边过重，形成「格子墙」

- **证据**：暗色截图（`ui2-clean-1200.png`）中每个 `tb-btn` 均有可见描边，工具栏呈 11 个等大边框块。
- **影响**：暗色下对比更强，视觉噪声显著，层级更难分辨。
- **建议**：暗色下按钮默认无描边（`border-color: transparent`），靠 surface 层差与 hover 底色区分；仅主操作保留实心。

### U14【P2】主题令牌色板全部渲染为同一蓝色

- **证据**：设置 → 主题/令牌：`强调色 / 正文色 / 背景色 / 次要文字` 四行右侧色块均为相同的 `#2563eb` 蓝。
- **影响**：色板无法反映真实 token，用户误判当前配色，也不敢改。
- **建议**：色块绑定各自 CSS 变量实际值（读取 `getComputedStyle(root).getPropertyValue(token)`），并显示 HEX。

### U15【P2】Agent 面板暴露技术概念的开关

- **证据**：输入框上方常驻「☑ 工具调用模式（关闭则为检索增强）」。
- **影响**：普通作者不理解「工具调用/检索增强」，不知道关掉会怎样。
- **建议**：改为目标导向文案「允许 Agent 检索我的笔记」，或移到设置页「高级」；保留时加一句 12px 说明。

### U16【P3】部分命中区域小于 28px

- **证据**：`.view-chip` 高 19px、`.stats-pill` 高 26px。
- **建议**：桌面最小 28×28，触控/高分屏 32×32；周边留 4px 以上间距。

---

## 三、优先级路线图

### P0（阻断级，建议本周）

| 项 | 改动 | 验收标准 |
| --- | --- | --- |
| U1 工具栏溢出 | 分级收纳 + 溢出渐隐兜底 | 1200/1024/900 三档一级功能全部可达 |
| U2 品牌两行 | 单行品牌 / 窄屏只留 logo | 工具栏回到 48px，无折行 |
| U3 列宽崩塌 | preview 内边距 `clamp()` + 空间守卫自动单栏 | 1200 开 Agent 时正文 ≥ 26 字/行 |

### P1（本迭代）

U4 i18n 泄漏（5 个 key）→ U7 按钮三级权重 → U5 Banner 收敛 → U6 字号收敛 5 档 → U9 侧栏过滤合并 → U8 字体栈统一。

### P2（下一迭代）

U10 图谱独立视图 → U11 属性输入换行 → U13 暗色按钮去描边 → U14 色板绑定 token → U12 状态胶囊文案 → U15 Agent 开关文案。

### P3

U16 命中区域 ≥28px。

---

## 四、设计规范建议（可直接落地为 token）

```css
:root {
  /* 间距：4/8 栅格（现有 8/10/12 → 收敛 8/12/16） */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px;

  /* 字号：5 档 */
  --font-2xs: 11px; /* 角标 */
  --font-xs: 12px;  /* 辅助 */
  --font-sm: 13px;  /* 控件 */
  --font-md: 15px;  /* UI 正文 */
  --font-base: 16px;/* 阅读正文 */
  --font-h2: 20px; --font-h1: 28px;

  /* 字体栈：控件与正文分开但都含中文回退 */
  --md-font-ui: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  --md-font-reading: "PingFang SC", "Source Han Sans SC", system-ui, serif;

  /* 面板 */
  --md-side-width: 260px;
  --md-rail-width: 320px;   /* 341 → 320，释放 21px */
  --md-preview-min: 320px;  /* 正文最小内容宽 */
}

/* 工具栏断点策略 */
@media (max-width: 1440px) { .tb-btn .tb-label { display: none; } }  /* 只留图标 */
@media (max-width: 1200px) { .tb-low-priority { display: none; } }     /* 收进「更多」 */
.toolbar { overflow-x: auto; scrollbar-width: thin; }
.toolbar::after { /* 右缘渐隐，提示可滚动 */ }
```

**统一验收口径**：三档宽度 × 两种主题共 6 张基线截图 + 关键尺寸断言（工具栏高度、溢出量、正文有效宽度、字号集合），可作为视觉回归用例固化。

---

## 五、证据文件

| 文件 | 内容 |
| --- | --- |
| `%TEMP%/ui-01-default.png` | 1200×800 默认（Agent 开启） |
| `%TEMP%/ui-02-outline.png` / `ui-02-props.png` / `ui-02-graph.png` | 侧栏四视图 |
| `%TEMP%/ui-03-settings.png` | 设置（暴露英文 key） |
| `%TEMP%/ui2-clean-1200.png` | 暗色 + 设置 |
| `%TEMP%/ui3-light-main.png` / `ui3-dark-main.png` | 1440 亮/暗主界面 |
| `%TEMP%/ui-07-narrow-900.png` | 900 宽（工具栏裁切） |
| `desktop-test/ui-audit.mjs` / `ui-audit2.mjs` | 采集脚本（可复跑做视觉回归） |

---

## 六、参考 SoloMD 的 UI 改造（2026-10-18）

参照对象：`C:\Program Files\SoloMD\SoloMD.exe`（Electron 版 Markdown 编辑器）。其界面特征：4 条横带（原生菜单 / 标签+工具合并行 / 侧栏 / 编辑器）、暖中性色 + 单一陶土橙强调色、工具按钮默认无描边（仅 hover 出底）、空态收敛为侧栏内「标题 + 说明 + 实心 CTA」、工具按钮纯图标（tooltip 补充文案）。

### 6.1 本轮落地

| # | 改动 | 文件 |
| --- | --- | --- |
| 1 | **配色换为暖中性 + 陶土橙**（亮：fg `#26221d`/surface `#f7f5f1`/accent `#a9501d`；暗：bg `#1a1815`/accent `#df8a4e`），圆角 12→10 | `packages/core/src/renderer/styles.ts` |
| 2 | **工具栏图标优先**：`.tb-btn` 去描边、30px 高、hover 才出底；`.tb-label` 默认隐藏，≥1440 恢复；`新建` 升级为唯一实心主操作；品牌强制单行 | `styles/index.css`、`Toolbar.tsx` |
| 3 | **移除首屏通栏引导**（Banner 110px），改为侧栏内 SoloMD 式空态：标题「打开一个文件夹」+ 说明 + 实心「打开文件夹…」CTA | `App.tsx`、`VaultFiles.tsx`、`i18n` |
| 4 | **未绑定文件夹时隐藏过滤 chips**（视图名/status/inbox），侧栏只留「搜索 + 全部笔记」 | `VaultFiles.tsx` |
| 5 | **预览内边距自适应**：`padding-inline: clamp(16px, 5.5%, 48px)`，窄栏不再只剩 ~12 字/行 | `styles/index.css` |
| 6 | **窄窗降级**：≤1100 只留 logo；≤1000 收起对焦/阅读态，保证设置与 Agent 入口可见 | `styles/index.css`、`Toolbar.tsx` |
| 7 | 设置「中文排版」5 项补 i18n（原来直接渲染 `spacing/numberSpacing/...` 字段名） | `SettingsPanel.tsx`、`i18n` |

### 6.2 改造前后对照（实测）

| 指标 | 改造前 | 改造后 |
| --- | --- | --- |
| 工具栏高度 | 73px（品牌折行撑高） | **52px** |
| 工具栏溢出（1200 宽） | scrollWidth 1405 / 1200（+205px） | **1186 / 1186（0）** |
| 工具栏溢出（900 宽） | +530px，裁掉 预览/分栏/命令/导出/更多/设置/Agent | **0**，13 个控件全部可见，设置/Agent 可达 |
| 首屏顶部占用 | 工具栏 73 + Banner 110 = 183px | **52px** |
| 预览正文宽度（开 Agent，1200 宽） | 197px（≈12 字/行） | **261px**（内边距 48→16px） |
| 预览正文宽度（1440 宽） | 368px | 368px（内边距 22.7px） |
| 设置排版项文案 | `spacing / numberSpacing / ...` | 中英文间隙 / 数字间隙 / 标点挤压 / 省略号样式 / 引号转换 |
| 字号/品牌 | 品牌两行 | 单行、30px 高 |

### 6.3 验证

- 三档视口（900 / 1024 / 1200 / 1440）实测无横向溢出，关键控件可见（见 `desktop-test/verify-new-ui.mjs`）。
- 亮/暗两主题截图：`%TEMP%/final-light-1200.png`、`final-dark-1200.png`。
- 回归：core `themeTokens`(2) + `typography`(7)、web `agentChatUtils`(26) + `AgentChat.events`(16) 全通过；`packages/core` / `apps/web` `tsc --noEmit` 0 错误。

### 6.4 尚未跟进（与 SoloMD 仍有差距）

1. **标签栏与工具栏未合并**：SoloMD 将 tab 与工具放在同一行（总高约 40px），我们仍是「工具栏 52 + 标签栏 48」两行；合并需调整 App 布局结构，建议单独迭代。
2. **原生菜单栏**：SoloMD 有 文件/编辑/段落/格式/导航/视图/帮助 菜单，我们以命令面板替代；如需桌面原生菜单需在 Tauri 侧配置。
3. **侧栏层级**：SoloMD 只有「搜索 + 最近」，我们的「全部笔记」列表与文件树仍偏重，可后续按需简化。

### 6.5 图谱升格为主显示区（2026-10-18 追加）

原先图谱是左侧栏的第 4 个 tab（画布仅 220×180，标签互相重叠）。本轮按评审建议改为**主区面板**：

| 改动 | 文件 |
| --- | --- |
| `PanelId` 增加 `graph`；`PANEL_META` 注册标题「关系图谱」与 graph 图标 | `stores/ui.ts`、`shell/PanelView.tsx` |
| `VaultGraph` 增加 `variant: 'side' \| 'main'`：main 模式为「自适应画布 + 右侧 240px 关系列表（反链/出链/类型化关系）」 | `features/vault/VaultGraph.tsx` |
| 画布跟随容器尺寸（ResizeObserver），主区实测 745×606（原 220×180） | 同上 + `styles/index.css` |
| 侧栏移除图谱 tab（文件/大纲/属性），旧持久化状态回落 files | `shell/SideRail.tsx` |
| 主菜单（工具栏）新增「图谱」入口；命令面板增加「关系图谱」命令 | `toolbar/Toolbar.tsx`、`command/commands.ts` |

验证：侧栏 tabs 为「文件/大纲/属性」；工具栏图谱按钮 38×30 可见；点击后主区出现「关系图谱」面板，画布 745×606、右栏 240px、5 个节点正常排布；`tsc` 0 错误；web 测试 26+16 通过。

### 6.6 菜单与侧栏交互修复（2026-10-18 追加）

| # | 问题 | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | **「更多」点击无响应** | 下拉面板 `.tb-menu-panel` 是 `position:absolute`，挂在 `.toolbar` 内；而工具栏既有 `overflow-x: auto`（裁剪），又有 `backdrop-filter`（为 `position:fixed` 创建包含块）。改成 fixed 后仍被裁剪，用户看不到任何反馈 | 面板改为 **Portal 渲染到 `document.body`**（新增 `Dropdown` 组件），open 时按触发按钮 `getBoundingClientRect()` 计算 `top/right`；外部点击判定同时检查触发器与面板 ref（portal 后不在触发容器内，否则点菜单项会先被误关） |
| 2 | **左侧栏没有显示/隐藏入口** | 汉堡按钮 `.tb-menu` 只在 ≤1024 显示，且只切 `sideOpen`（移动端抽屉）；桌面端 CSS 完全忽略该状态 → 即使显示也无响应 | 新增 `.tb-sidetoggle`（全宽度显示）；按视口宽度分流：≤1024 切抽屉 `sideOpen`，>1024 切新增的 `sideCollapsed`；CSS `@media (min-width:1025px){ .app-shell.side-collapsed .app-side{display:none} }`；`aria-pressed` + 中/英/日 tooltip |
| 3 | **菜单交互反馈缺失** | 触发按钮只有 `aria-expanded`，无 `aria-haspopup`；菜单面板被裁剪导致「点了没反应」；无按压反馈 | 补 `aria-haspopup="menu"`；菜单项增加 `:active` 反馈；Esc / 外部点击 / 窗口 resize 统一收起；开合状态用 `.active` 底色反馈 |
| 4 | 导出菜单同样被裁剪 | 同上 | 复用 `Dropdown` 组件 |

**验证（`desktop-test/verify-fix2.mjs`，1280×820 实测）**：
- 更多菜单：`opened=true`、`position=fixed`、rect 697,47 274×399、`inViewport=true`、**`hitInside=true`**（点击命中）、8 个菜单项、portal 挂到 body；
- 点击「打字机模式」：菜单关闭且 `typewriterMode=true`（真实生效）；
- 侧栏：`display: flex → none → flex`，主区 x `261 → 0`，`aria-pressed=false`；
- 导出菜单：`opened=true`、214×313、在视口内、8 项；
- Esc：菜单关闭；
- 900px：抽屉 `translateX(-260.8) → 0`，`side-open` 生效且可点区域可见。
