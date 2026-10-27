import type { ReactElement } from 'react';

export type IconName =
  | 'new'
  | 'open'
  | 'save'
  | 'focus'
  | 'typewriter'
  | 'typography'
  | 'autoNumber'
  | 'theme'
  | 'width'
  | 'exportHtml'
  | 'exportPdf'
  | 'share'
  | 'shareCard'
  | 'settings'
  | 'close'
  | 'outline'
  | 'menu'
  | 'more'
  | 'logo'
  | 'words'
  | 'line'
  | 'status'
  | 'agent'
  | 'slides'
  | 'send'
  | 'plus'
  | 'edit'
  | 'preview'
  | 'split'
  | 'bold'
  | 'italic'
  | 'code'
  | 'link'
  | 'heading'
  | 'listUl'
  | 'quote'
  | 'history'
  | 'crypto'
  | 'git'
  | 'sync'
  | 'board'
  | 'props'
  | 'graph'
  | 'search'
  | 'pen'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'textTool'
  | 'lineTool'
  | 'select'
  | 'eraser'
  | 'undo'
  | 'redo'
  | 'trash'
  | 'panelLeftOpen'
  | 'panelLeftClose'
  | 'panelRightOpen'
  | 'panelRightClose'
  | 'chevronLeft'
  | 'chevronRight'
  | 'dragHandle'
  | 'paperclip'
  | 'copy'
  | 'fork'
  | 'download'
  | 'infinity'
  | 'at'
  | 'chevronDown'
  | 'globe'
  | 'wrench'
  | 'stopCircle'
  | 'folder'
  | 'folderOpen'
  | 'fileText'
  | 'refresh'
  | 'info';

/** 统一 24×24 线性图标（描边 1.8，圆角端帽/拐角，风格与 Lucide 一致） */
const PATHS: Record<IconName, string> = {
  new: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18v-6 M9 15h6',
  open:
    'M6 3h8l2 2h6a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M3 7h6l2 2h10',
  save:
    'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8',
  focus: 'M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2',
  typewriter: 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2 M7 6h1 M12 6h1 M17 6h1 M8 11h8 M10 4v3 M10 11v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2v-7',
  typography: 'M4 7V4h16v3 M9 20h6 M12 4v16',
  autoNumber:
    'M10 6h11 M10 12h11 M10 18h11 M4 5.5h1V9 M4 5.5 3 8 M3.2 18c0-1.2 1.6-1.6 1.6-2.6S4 13.8 3.2 13.8c-.9 0-1.4.4-1.4 1',
  theme: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18 M12 3v18',
  width:
    'M8 3H5a2 2 0 0 0-2 2v3 M16 3h3a2 2 0 0 1 2 2v3 M8 21H5a2 2 0 0 1-2-2v-3 M16 21h3a2 2 0 0 0 2-2v-3',
  exportHtml:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13l-2 2 2 2 M15 13l2 2-2 2',
  exportPdf:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h6',
  share:
    'M8.6 10.5l6.8-4 M8.6 13.5l6.8 4 M18 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M6 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  shareCard:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  close: 'M18 6 6 18 M6 6l12 12',
  outline: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  more: 'M4 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M10.5 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M17 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0',
  logo:
    'M4 4h9a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4z M13 4v13a3 3 0 0 0 3 3V7a3 3 0 0 0-3-3z M7 8h3 M7 12h3',
  words: 'M4 7V5h16v2 M9 19h6 M12 5v14',
  line: 'M4 5h16 M4 12h16 M4 19h16',
  status: 'M4 4h16v16H4z M8 12h2 M14 12h2',
  agent:
    'M7 9h10a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3z M12 5v3 M9.5 13h.01 M14.5 13h.01 M9.5 16.5h5',
  slides: 'M2 4h20v12H2z M8 20h8 M12 16v4',
  send: 'M12 19V5 M5 12l7-7 7 7',
  plus: 'M12 5v14 M5 12h14',
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  split: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M12 3v18',
  bold: 'M7 5h6.5a3.5 3.5 0 0 1 0 7H7z M7 12h7.5a3.5 3.5 0 0 1 0 7H7z M7 5v14',
  italic: 'M15 4H9 M15 20H9 M15.5 4 8.5 20',
  code: 'M16 6l4 6-4 6 M8 6l-4 6 4 6',
  link: 'M10.6 13.4a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.6-5.6l-2 2 M13.4 10.6a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.6 5.6l2-2',
  heading: 'M6 5v14 M18 5v14 M6 12h12',
  listUl: 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01',
  quote:
    'M7 6h4v5a4 4 0 0 1-4 4 M15 6h4v5a4 4 0 0 1-4 4',
  preview: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  history: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5 M12 7v5l4 2',
  crypto: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 10 0v4',
  git: 'M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9',
  sync: 'M21 2v6h-6 M3 12a9 9 0 0 1 15-6.7L21 8 M3 22v-6h6 M21 12a9 9 0 0 1-15 6.7L3 16',
  board: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  props: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M2 14h4 M10 8h4 M18 16h4',
  graph:
    'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.59 13.51l6.83 3.98 M15.41 6.51l-6.82 3.98',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  pen: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  rect: 'M4 5h16v14H4z',
  ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  arrow: 'M5 19 19 5 M11 5h8v8',
  textTool: 'M5 5h14 M12 5v14 M9.5 19h5',
  lineTool: 'M4 20 20 4',
  select: 'M4 4l7 17 2.4-7.1 7.1-2.4z',
  eraser:
    'M7 18l-2.4-2.4a1.6 1.6 0 0 1 0-2.3l8.3-8.3a1.6 1.6 0 0 1 2.3 0l4.1 4.1a1.6 1.6 0 0 1 0 2.3L13.5 18z M4 20h16',
  undo: 'M9 14 4 9l5-5 M4 9h10.5A5.5 5.5 0 0 1 20 14.5 5.5 5.5 0 0 1 14.5 20H11',
  redo: 'M15 14l5-5-5-5 M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13',
  trash:
    'M4 7h16 M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2 M6.5 7l1 12.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1l1-12.5',
  // 参照 Cursor 侧栏收/展按钮：侧栏线条 + 内侧 chevron。
  // panel-left-open: 侧栏展开（chevron 指向左内）
  panelLeftOpen:
    'M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4 M9 4v16 M14 9l-3 3 3 3',
  // panel-left-close: 侧栏收起（chevron 指向右外）
  panelLeftClose:
    'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4 M15 4v16 M10 9l3 3-3 3',
  // panel-right-open: 侧栏展开（chevron 指向右内）
  panelRightOpen:
    'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4 M15 4v16 M10 9l-3 3 3 3',
  // panel-right-close: 侧栏收起（chevron 指向左外）
  panelRightClose:
    'M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4 M9 4v16 M14 9l3 3-3 3',
  // 极简 chevron（边缘条收起按钮用，参考 Cursor 侧栏中部的小箭头）
  chevronLeft: 'M14 6l-6 6 6 6',
  chevronRight: 'M10 6l6 6-6 6',
  // 拖拽手柄（三栏分割条 hover/dragging 时显式表达可拖）
  dragHandle: 'M9 5h.01 M9 12h.01 M9 19h.01 M15 5h.01 M15 12h.01 M15 19h.01',
  // 回形针（附件 chip 专用；与 new 文件图标语义区分）
  paperclip: 'M21 12.5l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7',
  // 无限（Agent 模式：自动化/可持续）
  infinity: 'M18.4 12a3.2 3.2 0 0 0-2.7 1.4l-1.4 2a3 3 0 0 1-2.6 1.4 3.2 3.2 0 0 1 0-6.4 3 3 0 0 1 2.6 1.4l1.4 2A3.2 3.2 0 0 0 18.4 12z M5.6 12a3.2 3.2 0 0 1 2.7-1.4 3 3 0 0 1 2.6 1.4l1.4 2A3.2 3.2 0 0 0 18.4 12 M5.6 12a3.2 3.2 0 0 0 2.7 1.4 3 3 0 0 0 2.6-1.4l-1.4-2A3.2 3.2 0 0 0 5.6 12z',
  // @ 符号
  at: 'M16 12a4 4 0 1 0-8 0v3a4 4 0 0 0 4 4h2 M20 12a8 8 0 1 0-4 6.9',
  // 向下箭头
  chevronDown: 'M6 9l6 6 6-6',
  // 地球（模型选择）
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18',
  // 扳手（build mode）
  wrench: 'M14.7 6.3a4 4 0 0 1-5 5L3 18a2 2 0 0 0 3 3l6.7-6.7a4 4 0 0 1 5-5L14 12l-2-2 2.7-3.7z',
  // 停止圆圈（input bar 用）
  stopCircle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9 9h6v6H9z',
  // 复制（两张纸叠）
  copy: 'M9 9h10v10H9z M5 15V5a1 1 0 0 1 1-1h10',
  // 分叉（节点分两路）
  fork:
    'M6 3v6 M6 21v-6 M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.6 12.5a4 4 0 0 0 2.4 2.4l3.5 1.4',
  // 下载（箭头 + 托盘）
  download: 'M12 3v12 M7 10l5 5 5-5 M4 19h16',
  // 目录（闭合）— 文件树目录节点
  folder:
    'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z',
  // 目录（展开）
  folderOpen:
    'M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2',
  // Markdown 文件（文件树叶节点）
  fileText:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
  // 刷新（检查更新）
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36 M21 3v6h-6',
  // 关于（信息）
  info: 'M12 16v-5 M12 8h.01 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
};

/** 兼容：部分路径含多条子指令，直接以单 path + d 呈现即可（空白分隔） */
export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  className,
}: IconProps): ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
