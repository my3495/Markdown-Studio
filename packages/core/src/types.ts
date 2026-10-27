import type { Root as HastRoot } from 'hast';
import type { Node } from 'unist';

/** 标题自动编号风格（ADR-21：渲染层实现，不改源文件） */
export type NumberStyle = 'arabic' | 'chinese' | 'chapter';

/** 中文排版（护城河 1）子能力开关 */
export interface TypographyOptions {
  /** 中英自动间距：使用React框架 → 使用 React 框架 */
  spacing: boolean;
  /** 中数与符号间距：共10个 → 共 10 个 */
  numberSpacing: boolean;
  /** 中文标点校验（仅 lint，不改动） */
  punctuation: boolean;
  /** 省略号规范 ... → …… */
  ellipsis: boolean;
  /** 引号规范 "中文" → “中文” */
  quotes: boolean;
  /** 是否严格不进入代码块/行内代码/链接/公式/HTML 属性 */
  safeZones: boolean;
}

export interface CjkTypographyResult {
  /** 处理后的 mdast 文本（仅 text 节点改造） */
  tree: Node;
  /** lint 问题清单（不改内容，仅提示） */
  warnings: TypographyWarning[];
}

export interface TypographyWarning {
  type: 'punctuation' | 'ellipsis' | 'quotes';
  line: number;
  column: number;
  message: string;
  suggestion: string;
}

/** TOC 项 */
export interface TocItem {
  depth: number;
  text: string;
  id: string;
  /** 源文件对应行号（用于滚动同步 / 点击跳转） */
  line: number;
}

/** 行号索引：源行 → 预览 DOM 顶部偏移（由主线程构建，此处仅提供数据线标记） */
export interface LineIndexEntry {
  line: number;
  top: number;
}

/** 渲染选项 */
export interface RenderOptions {
  /** GFM（表格/任务列表/删除线/自动链接） */
  gfm?: boolean;
  /** Frontmatter 折叠卡片 */
  frontmatter?: boolean;
  /** 数学公式 KaTeX */
  math?: boolean;
  /** 代码高亮 Shiki（transformerStyleToClass 保 CSP） */
  highlight?: boolean;
  /** Shiki 主题：light / dark，跟随 UI 主题 */
  highlightTheme?: 'light' | 'dark';
  /** 中文排版（护城河 1） */
  typography?: Partial<TypographyOptions>;
  /** 标题自动编号（v1.1） */
  autoNumber?: false | NumberStyle;
  /** 注入 data-line 属性（用于滚动同步） */
  dataLine?: boolean;
  /** 链接在新标签打开 */
  externalLinksNewTab?: boolean;
  /** 将 [[wikilink]] 渲染为可点击双链（知识库） */
  wikilinks?: boolean;
  /** 脚注区标题（无障碍朗读用，随界面语言本地化） */
  footnoteLabel?: string;
  /** 脚注「返回引用」按钮的无障碍文案 */
  footnoteBackLabel?: string;
}

/** 渲染结果 */
export interface RenderResult {
  /** hast（跨 Worker 边界用纯 JSON） */
  hast: HastRoot;
  /** 目录（旁路输出） */
  toc: TocItem[];
  /** 字数统计 */
  words: number;
  /** 中文排版 lint 警告（不改源文） */
  warnings?: TypographyWarning[];
  /** 是否包含严格模式问题（v1.1，此处预留） */
  strictIssues?: number;
}

/** 解析管线共享上下文（旁路收集 TOC / lint 警告） */
export interface PipelineContext {
  toc: TocItem[];
  warnings: TypographyWarning[];
}

export const DEFAULT_TYPOGRAPHY: TypographyOptions = {
  spacing: true,
  numberSpacing: true,
  punctuation: true,
  ellipsis: true,
  quotes: true,
  safeZones: true,
};
