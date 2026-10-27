/**
 * tldraw fence 协议（C4）：```tldraw ... ``` 内存放 JSON 快照。
 * 完整 @tldraw/tldraw 可后续替换渲染器，数据层保持此结构。
 */

export interface WbPoint {
  x: number;
  y: number;
}

export interface WbStroke {
  /** 稳定身份（可选；旧 fence 无 id，加载时由 ensureIds 补齐） */
  id?: string;
  color: string;
  width: number;
  points: WbPoint[];
}

/** 形状公共字段：稳定身份（可选）+ 颜色 */
interface WbShapeBase {
  id?: string;
  color: string;
}

export type WbShape =
  | (WbShapeBase & {
      type: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
    })
  | (WbShapeBase & {
      type: 'ellipse';
      x: number;
      y: number;
      w: number;
      h: number;
    })
  | (WbShapeBase & {
      /** 箭头（直线 + 端点箭头） */
      type: 'arrow';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    })
  | (WbShapeBase & {
      type: 'text';
      x: number;
      y: number;
      text: string;
    });

export interface WbDocument {
  v: 1;
  strokes: WbStroke[];
  shapes?: WbShape[];
}

export const EMPTY_WB: WbDocument = { v: 1, strokes: [], shapes: [] };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 形状白名单校验（rect/ellipse/arrow/text） */
function isValidWbShape(s: unknown): s is WbShape {
  const sh = s as WbShape & { color?: unknown };
  if (!sh || typeof sh !== 'object') return false;
  switch (sh.type) {
    case 'rect':
    case 'ellipse':
      return num(sh.x) && num(sh.y) && num(sh.w) && num(sh.h) && typeof sh.color === 'string';
    case 'arrow':
      return num(sh.x1) && num(sh.y1) && num(sh.x2) && num(sh.y2) && typeof sh.color === 'string';
    case 'text':
      return num(sh.x) && num(sh.y) && typeof sh.text === 'string' && typeof sh.color === 'string';
    default:
      return false;
  }
}

/** 归一化单条笔迹：仅保留合法 id（非空字符串）与数值字段 */
function normalizeStroke(s: WbStroke): WbStroke {
  const out: WbStroke = {
    color: typeof s.color === 'string' ? s.color : '#334155',
    width: typeof s.width === 'number' ? s.width : 2,
    points: (Array.isArray(s.points) ? s.points : [])
      .filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number')
      .map((p) => ({ x: p.x, y: p.y })),
  };
  if (typeof s.id === 'string' && s.id) out.id = s.id;
  return out;
}

/** 归一化单个形状：丢弃非法 id，其余字段原样保留 */
function normalizeShape(sh: WbShape): WbShape {
  const out = { ...sh };
  if (typeof out.id !== 'string' || !out.id) delete out.id;
  return out;
}

export function parseTldrawFence(raw: string): WbDocument {
  const t = raw.trim();
  if (!t) return { v: 1, strokes: [], shapes: [] };
  try {
    const obj = JSON.parse(t) as WbDocument;
    if (obj?.v !== 1 || !Array.isArray(obj.strokes)) return { v: 1, strokes: [], shapes: [] };
    const shapes = Array.isArray(obj.shapes)
      ? obj.shapes.filter(isValidWbShape).map(normalizeShape)
      : [];
    return {
      v: 1,
      strokes: obj.strokes.filter((s) => s && Array.isArray(s.points)).map(normalizeStroke),
      shapes,
    };
  } catch {
    return { v: 1, strokes: [], shapes: [] };
  }
}

/** 序列化：逐字段展开，id 缺失时不落盘（保持旧文档无 id 形态） */
export function serializeTldrawFence(doc: WbDocument): string {
  const strokes = doc.strokes.map((s) => {
    const out: WbStroke = { color: s.color, width: s.width, points: s.points };
    if (s.id) out.id = s.id;
    return out;
  });
  const shapes = (doc.shapes ?? []).map(normalizeShape);
  return JSON.stringify({ v: 1, strokes, shapes });
}

/**
 * 为缺失 id 的笔迹/形状补齐确定性 id（`s${i}` / `${type}${i}`）。
 * 仅在缺失时补，已有 id 保持不变；供编辑器建立稳定内部模型（选择/移动/删除/撤销）。
 */
export function ensureIds(doc: WbDocument): WbDocument {
  return {
    v: 1,
    strokes: doc.strokes.map((s, i) => (s.id ? s : { ...s, id: `s${i}` })),
    shapes: (doc.shapes ?? []).map((sh, i) => (sh.id ? sh : { ...sh, id: `${sh.type}${i}` })),
  };
}

/**
 * 替换 Markdown 中第 n 个 tldraw 围栏正文（0-based）。
 * 匹配 ```tldraw / ```whiteboard。
 */
export function replaceTldrawFence(md: string, index: number, nextBody: string): string {
  const re = /```(?:tldraw|whiteboard)[^\n]*\n([\s\S]*?)```/gi;
  let i = 0;
  return md.replace(re, (full) => {
    if (i++ !== index) return full;
    return `\`\`\`tldraw\n${nextBody}\n\`\`\``;
  });
}

/** 统计文档中 tldraw 围栏数量 */
export function countTldrawFences(md: string): number {
  const re = /```(?:tldraw|whiteboard)/gi;
  return (md.match(re) ?? []).length;
}
