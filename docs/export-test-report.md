# 导出功能全格式测试报告（含缺陷修复验证）

| 项 | 值 |
| --- | --- |
| 被测版本 | Markdown Studio 1.0.1 + 本轮导出修复 |
| 测试日期 | 2026-10-29 |
| 运行环境 | Windows / Node 20 / Vitest 1.6（core 为 node 环境，web 为 jsdom）+ Chromium（Playwright 真实浏览器） |
| 外部工具 | 未安装原生 pandoc / TeX / LibreOffice；改用 **pandoc-wasm 3.x** 在 Node 侧真实转换并反读（见「五」） |
| 验收用例 | 42 个（core 20 + web 22），**全部通过**，无 `it.fails` 残留；真实浏览器 E2E **18/18** |
| 全量回归 | core **782/782**（67 文件）、web **276/276**（31 文件）、`tsc --noEmit` 5 包 0 错误 |

新增测试文件：

- `packages/core/tests/export-formats.acceptance.test.ts`（HTML / LaTeX / Pandoc 结构、边界、批量、并发）
- `apps/web/src/features/export/__tests__/export-download.acceptance.test.ts`（浏览器动作、文件名、并发、PNG、打印）

原有导出测试（`export-html.test.ts` 22 例、`export-markdown.test.ts` 12 例、`export-pandoc.test.ts` 19 例、`exporter.test.ts` 17 例）一并纳入回归。

---

## 一、结论总览

| # | 导出格式 | 入口 | 生成 | 内容无损 | 结构规范 | 目标环境可读 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | HTML 单文件 `.html` | 导出 → 导出 HTML | ✅ | ✅ | ✅ | ✅ DOMParser 解析通过 | **通过** |
| 2 | 只读分享 `.html` | 导出 → 分享链接 | ✅ | ✅ | ✅ | ✅ 横幅/正文结构正确 | **通过** |
| 3 | Markdown `.md`（Pandoc 输入） | 导出 → DOCX/EPUB/PDF | ✅ | ✅ 逐字节一致 | ✅ UTF-8 | ✅ pandoc/GitHub 兼容 | **通过** |
| 4 | LaTeX `.tex` | 导出 → LATEX | ✅ | ✅ | ✅ 环境配对 + ctex | ⚠️ 未编译（无 TeX） | **通过（结构层面）** |
| 5 | DOCX `.docx` | 导出 → DOCX | ✅ | ✅ | ✅ `-t docx` | ✅ pandoc-wasm 生成 11 066 B 合法 OOXML，反读还原全文 | **通过** |
| 6 | EPUB `.epub` | 导出 → EPUB | ✅ | ✅ | ✅ `-t epub` | ✅ pandoc-wasm 生成 6 213 B，`mimetype` 首条目，反读还原全文 | **通过** |
| 7 | PDF（Pandoc）`.pdf` | 导出 → PDF | ✅ | ✅ | ✅ 不再带 `-t pdf` | ⚠️ 仅命令层面（wasm 版无 PDF 引擎，见「五」） | **通过（命令层面，原 DEF-03 已修）** |
| 8 | PDF（浏览器打印） | 导出 → 导出 PDF | ✅ | ✅ | ✅ | ✅ 打印文档结构/print 调用 | **通过（未做版面视觉验证）** |
| 9 | PNG 分享卡片 `.png` | 导出 → 分享卡片 | ✅ | ✅ 文本转义 | ✅ pixelRatio=2 | ⚠️ 未做像素验证（jsdom 无 canvas） | **通过（链路层面）** |

> DOCX / EPUB 的浏览器侧产物是「一份 `.md` + 一条本机 pandoc 命令」，真正的二进制由本机 pandoc 生成。
> 本轮已用 **pandoc-wasm** 以同一份浏览器导出的 `.md` 真实转换并反读回文本，补齐了「目标环境可读」这一列；
> PDF 仍只能验证到「输入无损 + 命令合法」+ 浏览器打印链路。

---

## 二、边界场景专项结果

| 场景 | 格式 | 用例 | 结果 |
| --- | --- | --- | --- |
| 空数据（`''` / 纯空白 / 仅 frontmatter） | HTML | A-H02、B-H02 | 通过：完整可解析、`article` 为空、页脚保留、`<title>` 已去扩展名 |
| 空数据 | LaTeX | A-L03、B-T02 | 通过：最小可编译骨架，无空 `\item`、无未闭合环境 |
| 空数据 | Markdown | B-M03 | 通过：文件名回退 `export.md`，空内容不带 `null` |
| 特殊字符（`< > & " '`、`${}`、`{{}}`、反斜杠、`</style>`） | HTML | A-H03、B-H01 | 通过：代码块反转义后逐字符相等，无标签注入、样式未截断 |
| 特殊字符 | LaTeX | A-L02、E-P18/19 | 通过：单遍转义，无 `\textbackslash\{\}` 双重转义 |
| 多语言（中日韩 / RTL / ZWJ emoji / 组合字符） | HTML | A-H04、B-H01 | 通过：原样保留、表格/代码块结构完整 |
| 多语言 | LaTeX | A-L06 | 通过：`\usepackage[UTF8]{ctex}` 已加入（原 OBS-01） |
| 文件名异常（非法字符 / 点号 / 超长） | all | B-F01~B-F07 | 通过：清洗、白名单剥离、200B 截断、结尾点去除 |
| 大数据量 | HTML | A-H05（5000 段）、B-H03（2000 段下载） | 通过：段落数精确等于输入、首尾完整 |
| 大数据量 | LaTeX | A-L05（3000 行） | 通过：行数线性、文档壳完整 |
| 并发 | HTML | A-H06（16 并发）、B-H04（10 并发下载） | 通过：零串扰、同输入结果稳定 |
| 并发 | 多格式混合 | B-M02（docx/epub/pdf 同时） | 通过：命令与文件名一一对应 |
| 并发 | PNG | B-P02 | 通过：两次卡片内容不互相污染 |

### 实测性能与体积（core 单进程，`highlight:false`）

| 规模 | 源 Markdown | 导出 HTML | HTML 耗时 | 导出 LaTeX | LaTeX 耗时 |
| --- | --- | --- | --- | --- | --- |
| 500 段 | 47.9 KB | 67.5 KB | 823 ms | 48.0 KB | 13 ms |
| 2 000 段 | 192.9 KB | 247.0 KB | 1 683 ms | 193.0 KB | 10 ms |
| 5 000 段 | 483.9 KB | 607.0 KB | 2 598 ms | 484.0 KB | 54 ms |
| 并发 16 份（小文档） | — | — | 83 ms（总） | — | — |

HTML 体积约为源文件 1.25–1.4 倍（内联 CSS + `data-line` 锚点），耗时随段落数近似线性。

### 2.1 真实二进制转换与反读（pandoc-wasm）

输入取**真实浏览器 E2E 下载的 `.md`**（`.tmp-e2e/out/docx__E2E 报告 v1.2.md`，87 字符），
用 pandoc-wasm 3.x 生成二进制后落盘，再用 pandoc 自身反读回纯文本：

| 格式 | 体积 | 结构判据 | 反读结果 |
| --- | --- | --- | --- |
| DOCX | 11 066 B | magic `504b`、含 `[Content_Types].xml` 与 `word/document.xml`、EOCD 距末尾 22 B（10 条目，无注释） | ✅ 还原全文（标题/中文/`&`/弯引号/emoji/有序无序列表/代码块） |
| EPUB | 6 213 B | magic `504b`、`mimetype` 为首条目且为 `application/epub+zip`、含 `META-INF/container.xml` | ✅ 与 DOCX 反读结果一致 |
| PDF | — | — | ❌ `missing out.pdf`：wasm 版无 LaTeX 引擎，符合预期 |

反读还原文本（docx / epub 完全相同）：

```
E2E 中文标题

带特殊字符：& “quote” 🚀

1.  第一步
2.  第二步

- 无序项

    const a = 1 < 2;
```

已知告警（INFO 级，非缺陷）：原文内联 HTML `<b>` 在 docx writer 下 `Not rendering RawInline (Format "html")`；
EPUB 因无 `--variable pagetitle` 回退标题为 `stdin`（应用侧走本机 pandoc 命令时同样可能出现，建议后续在命令里带 `--metadata title`）。

---

## 三、缺陷修复记录与验证

| 编号 | 问题 | 修复 | 验证用例 | 状态 |
| --- | --- | --- | --- | --- |
| DEF-03 | Pandoc PDF 分支生成 `-t pdf`，pandoc 无 pdf writer → 命令必然失败 | `buildPandocArgs` 对 `pdf` 不再追加 `-t`，其余 writer 保持不变 | A-P04（断言 pdf 参数为 `['a.md','-o','a.pdf']`、命令为 `pandoc a.md -o a.pdf`）、E-P04 | **已修复** |
| DEF-02 | 含点号标题被当成扩展名剥离（`v1.2 说明` → `v1`） | 新增 `docBase()`，只剥 `md/markdown/mdx/txt`；`downloadHtml`/`downloadShareHtml`/`exportViaPandoc` 统一使用 | B-F04（`v1.2 说明.md`）、B-F06、E-X05b/E-X06/E-X16 | **已修复** |
| DEF-01 | 文件名未清洗 Windows 非法字符，保存失败 | 新增 `sanitizeFileName()`：`\ / : * ? " < > \|` 与控制字符 → `_`，去结尾点/空格，UTF-8 字节截断 200B | B-F03（`a_b_c__.html`）、B-F05（360B → ≤200B）、B-F07 | **已修复** |
| DEF-04 | 有序列表不转 `enumerate`，序号语义丢失 | `markdownToLatexLite` 记录 `listEnv`，支持 `1.` / `1)` → `enumerate`，与 `itemize` 切换时先闭合 | A-L08（含有序→无序→有序环境配对）、A-L09（`2.2 版本` 不被误判）、E-P13 | **已修复** |

### 缺陷用例的固化方式

修复前 4 条用例以 `it.fails` 标记（期望正确行为、实际不满足）；修复后已全部改写为**正向断言**，任何回退都会立刻变红：

```
packages/core/tests/export-formats.acceptance.test.ts     A-L08 / A-P04
apps/web/src/features/export/__tests__/export-download.acceptance.test.ts  B-F03 / B-F04
```

---

## 四、观察项处理情况

| 编号 | 描述 | 处理 | 验证 |
| --- | --- | --- | --- |
| OBS-01 | LaTeX 模板缺 `ctex`，中文用 pdflatex 无法编译 | 模板改为 `\usepackage[UTF8]{ctex}`（替换 inputenc） | A-L06、E-P10 |
| OBS-02 | HTML `<title>` 保留 `.md` | `buildHtmlDoc` 使用 `docBase(title)` | B-H02（`空文档`）、B-P03（`稿件 A`） |
| OBS-03 | 打印弹窗被拦截时静默无反馈 | `printPdf` 返回 `{ok:false,reason:'popup-blocked'\|'render-failed'}`，Toolbar 弹 danger toast | B-P04、B-P03 |
| OBS-05 | `revokeObjectURL` 紧跟 `click()`，Firefox/Safari 可能取消下载 | 统一走 `scheduleRevoke()`（1000ms 延迟） | 全部下载类用例（E-X04~X16、B-*） |
| OBS-07 | 分享卡片生成失败无提示 | `exportShareCard` 返回 `boolean`，Toolbar 与快捷键（`App.tsx`）均提示 | B-P05 |
| OBS-04 | 精简 LaTeX 不支持引用块/表格/图片/公式/嵌套列表 | **不修**：需要完整 LaTeX 渲染器，正确做法是走 pandoc | — |
| OBS-06 | 分享卡片固定浅色底 | **不修**：卡片是独立分享物料，浅底更通用；如需跟随主题另起需求 | — |

新增 i18n 文案（中/英/日）：`pdfPopupBlocked`、`pdfPrintFailed`、`shareCardFailed`。

---

## 五、未覆盖与限制（需下一轮补齐）

1. **真实打开验证部分缺失**：环境没有原生 pandoc / TeX / Office。
   - `.tex` 未编译（仅做环境配对、ctex、转义校验）
   - ~~`.docx` / `.epub` 未生成真实二进制~~ → **已补**：用 pandoc-wasm 以浏览器导出的 `.md` 真实转换，
     校验 `[Content_Types].xml`、`word/document.xml`、EPUB `mimetype` 首条目与 `META-INF/container.xml`，
     再用 pandoc 自身反读回纯文本，与输入 Markdown 的正文逐段一致（详见 2.1）
   - 仍未做：Word / Calibre 图形界面的实际打开与版面渲染（无 Office / LibreOffice）
2. **PDF 未做版面验证**：只验证文档结构与 `print()` 调用；分页、页边距、代码块跨页需 Playwright `page.pdf()` 或人工验收。
3. **PNG 未做像素验证**：jsdom 无 canvas，`html-to-image` 被 mock；600×2 宽、长文本截断、emoji 渲染未验证。
4. **压力上限未探到**：本次最大 5 000 段 / 484 KB；10 万行级别的内存与 UI 冻结未测。
5. **未测**：Safari / Firefox 真实下载行为（文件名清洗、blob 时序差异）。

---

## 六、遗留与建议

1. `buildPandocArgs` 目前不传 `--pdf-engine`：中文 PDF 需本机 `xelatex`。可考虑在 UI 的 PDF 提示里带上 `--pdf-engine=xelatex`。
2. 文件名截断为「按字节 200B」，仍可能与已有文件重名被浏览器加 `(1)`；如需彻底确定性可加时间戳（当前未做，避免改变既有文件名预期）。
3. 建议给出 EPUB/DOCX 的 `--metadata title`：wasm 侧已观察到 `NoTitleElement` 回退到 `stdin`，本机命令同样会丢标题。

---

## 七、附：复跑命令

```bash
# 导出验收专项
pnpm --filter @md-studio/core exec vitest run tests/export-formats.acceptance.test.ts
pnpm --filter @md-studio/web exec vitest run src/features/export/__tests__/export-download.acceptance.test.ts

# 全量回归 + 类型检查
pnpm --filter @md-studio/core test
pnpm --filter @md-studio/web test
pnpm typecheck
```

真实浏览器 E2E（需先 `pnpm dev` 起 dev server，监听 1420）：

```bash
node .tmp-e2e/export-e2e.mjs      # 产物落 .tmp-e2e/out/，断言写 .tmp-e2e/summary.json
```

DOCX / EPUB 真实二进制与反读（pandoc-wasm，跑在 `.tmp-e2e/out/` 产物之上）：

```bash
cd "$TEMP/ms-pandoc-wasm" && node verify.mjs   # 生成 verify.docx / verify.epub 并反读
```

