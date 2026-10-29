/**
 * C4 增强：WbDocument（```tldraw fence JSON）↔ tldraw 形状记录的纯转换层。
 *
 * 设计要点：
 * - 纯函数、零运行时依赖（不 import tldraw），可单测、可被 Web/桌面复用；
 * - 由懒加载的 TldrawFullEditor 在挂载时（wbToTlShapes）与写回时（tlShapesToWb）调用；
 * - 覆盖 tldraw 常用形状：draw（笔迹）/ line（直线）/ geo=rectangle（矩形）/
 *   geo=ellipse（椭圆）/ text（文字）/ arrow（箭头）；
 *   其余 tldraw 形状（图片/框架/视频/便签等）在写回时忽略（fence 协议当前不承载）。
 */

import {
  toWbTextSize,
  wbTextSizeToPx,
  type WbDocument,
  type WbPoint,
  type WbShape,
  type WbStroke,
} from './tldraw-fence';

export interface TlShapePartialLike {
  id: string;
  type: 'draw' | 'geo' | 'text' | 'arrow';
  x: number;
  y: number;
  props: Record<string, unknown>;
}

/** tldraw 命名色 → 近似 HEX（取 tldraw 默认浅色主题色值） */
const TL_COLOR_HEX: Record<string, string> = {
  black: '#1d1d1d',
  grey: '#9ea6b3',
  'light-violet': '#ae8ff5',
  violet: '#7b5cd6',
  cyan: '#3ec6cf',
  green: '#3fa34d',
  yellow: '#f2c94c',
  orange: '#f08c1d',
  red: '#e5484d',
  blue: '#3b82f6',
  'light-blue': '#7cc4ff',
};

const TL_COLOR_PALETTE: [string, string][] = Object.entries(TL_COLOR_HEX);

/** 轻量编辑器色板：tldraw 命名色 → HEX（顺序即展示顺序，双向映射零损耗） */
export const WB_PALETTE: { name: string; hex: string }[] = TL_COLOR_PALETTE.map(
  ([name, hex]) => ({ name, hex })
);

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [29, 29, 29];
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** HEX → 最近的 tldraw 命名色 */
export function hexToTlColor(hex: string): string {
  const [r1, g1, b1] = parseHex(hex);
  let best = 'black';
  let bestD = Infinity;
  for (const [name, h] of TL_COLOR_PALETTE) {
    const [r2, g2, b2] = parseHex(h);
    const d = (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/** tldraw 命名色 → HEX（未知回落黑） */
export function tlColorToHex(color: unknown): string {
  return TL_COLOR_HEX[String(color)] ?? '#1d1d1d';
}

export function widthToTlSize(width: number): 's' | 'm' | 'l' | 'xl' {
  if (width <= 1.5) return 's';
  if (width <= 3) return 'm';
  if (width <= 5.5) return 'l';
  return 'xl';
}

export function tlSizeToWidth(size: unknown): number {
  switch (size) {
    case 's':
      return 1.5;
    case 'l':
      return 4;
    case 'xl':
      return 6;
    default:
      return 2.5;
  }
}

/** Wb 元素 id → tldraw shapeId（无 id 时回落原下标方案，保持旧行为） */
function tlShapeIdFor(prefix: 'stroke' | WbShape['type'], id: string | undefined, i: number): string {
  return `wb-${id ?? `${prefix}-${i}`}`;
}

/** tldraw shapeId → Wb 元素 id（剥 `shape:` 记录前缀与 `wb-` 前缀） */
function wbIdFromTlShapeId(rawId: unknown): string | undefined {
  if (typeof rawId !== 'string' || !rawId) return undefined;
  const record = rawId.startsWith('shape:') ? rawId.slice('shape:'.length) : rawId;
  if (!record.startsWith('wb-')) return undefined;
  return record.slice('wb-'.length) || undefined;
}

/** WbDocument → tldraw createShapes 可用的 partial 数组（id 稳定，便于往返） */
export function wbToTlShapes(doc: WbDocument): TlShapePartialLike[] {
  const out: TlShapePartialLike[] = [];
  doc.strokes.forEach((s: WbStroke, i: number) => {
    const pts = (s.points ?? []).filter(
      (p): p is WbPoint => Number.isFinite(p?.x) && Number.isFinite(p?.y)
    );
    if (pts.length === 0) return;
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    out.push({
      id: tlShapeIdFor('stroke', s.id, i),
      type: 'draw',
      x: minX,
      y: minY,
      props: {
        color: hexToTlColor(s.color || '#1d1d1d'),
        fill: 'none',
        dash: 'draw',
        size: widthToTlSize(Number.isFinite(s.width) ? s.width : 2.5),
        segments: [
          { type: 'free', points: pts.map((p) => ({ x: p.x - minX, y: p.y - minY })) },
        ],
        isComplete: true,
        isClosed: false,
        isPen: true,
        scale: 1,
      },
    });
  });
  (doc.shapes ?? []).forEach((sh: WbShape, i: number) => {
    if (sh.type === 'rect' || sh.type === 'ellipse') {
      out.push({
        id: tlShapeIdFor(sh.type, sh.id, i),
        type: 'geo',
        x: sh.x,
        y: sh.y,
        props: {
          geo: sh.type === 'ellipse' ? 'ellipse' : 'rectangle',
          w: Math.max(1, sh.w),
          h: Math.max(1, sh.h),
          color: hexToTlColor(sh.color || '#3b82f6'),
          fill: 'none',
          dash: 'draw',
          size: 'm',
          scale: 1,
        },
      });
    } else if (sh.type === 'arrow') {
      out.push({
        id: tlShapeIdFor('arrow', sh.id, i),
        type: 'arrow',
        x: sh.x1,
        y: sh.y1,
        props: {
          start: { x: 0, y: 0 },
          end: { x: sh.x2 - sh.x1, y: sh.y2 - sh.y1 },
          color: hexToTlColor(sh.color || '#3b82f6'),
          size: 'm',
          arrowheadStart: 'none',
          arrowheadEnd: 'arrow',
          scale: 1,
        },
      });
    } else if (sh.type === 'text') {
      const text = String(sh.text ?? '').slice(0, 2000);
      const size = toWbTextSize(sh.size);
      out.push({
        id: tlShapeIdFor('text', sh.id, i),
        type: 'text',
        x: sh.x,
        y: sh.y,
        props: {
          text,
          color: hexToTlColor(sh.color || '#1d1d1d'),
          size,
          font: 'draw',
          textAlign: 'start',
          w: Math.max(16, text.length * wbTextSizeToPx(size) * 0.6),
          scale: 1,
          autoSize: false,
        },
      });
    }
  });
  return out;
}

interface TlShapeLike {
  id?: string;
  type: string;
  x: number;
  y: number;
  props: Record<string, unknown>;
}

/** tldraw 直线形状的 points 记录（index → {x,y}）按 index 排序为点数组 */
function linePointsToArray(points: unknown): WbPoint[] {
  if (Array.isArray(points)) {
    return points
      .filter((p): p is WbPoint => Number.isFinite(p?.x) && Number.isFinite(p?.y))
      .map((p) => ({ x: p.x, y: p.y }));
  }
  if (points && typeof points === 'object') {
    return Object.values(points as Record<string, { x?: unknown; y?: unknown; index?: unknown }>)
      .filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
      .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0))
      .map((p) => ({ x: p.x as number, y: p.y as number }));
  }
  return [];
}

/** tldraw 形状数组 → WbDocument（draw / line / geo=rectangle|ellipse / text / arrow） */
export function tlShapesToWb(shapes: readonly unknown[]): WbDocument {
  const strokes: WbStroke[] = [];
  const shapesOut: WbShape[] = [];
  for (const raw of shapes) {
    const sh = raw as TlShapeLike | null;
    if (!sh || typeof sh.type !== 'string') continue;
    const props = (sh.props ?? {}) as Record<string, unknown>;
    const x = Number(sh.x);
    const y = Number(sh.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const wbId = wbIdFromTlShapeId(sh.id);
    if (sh.type === 'draw') {
      const segments = Array.isArray(props.segments) ? props.segments : [];
      const points: WbPoint[] = [];
      for (const segRaw of segments) {
        const seg = segRaw as { points?: unknown } | null;
        const segPts = Array.isArray(seg?.points) ? seg!.points : [];
        for (const pRaw of segPts) {
          const p = pRaw as { x?: unknown; y?: unknown } | null;
          if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) {
            points.push({ x: x + (p!.x as number), y: y + (p!.y as number) });
          }
        }
      }
      if (points.length > 0) {
        strokes.push({
          ...(wbId ? { id: wbId } : {}),
          color: tlColorToHex(props.color),
          width: tlSizeToWidth(props.size),
          points,
        });
      }
    } else if (sh.type === 'line') {
      const points = linePointsToArray(props.points);
      if (points.length >= 2) {
        strokes.push({
          ...(wbId ? { id: wbId } : {}),
          color: tlColorToHex(props.color),
          width: tlSizeToWidth(props.size),
          points,
        });
      }
    } else if (
      sh.type === 'geo' &&
      (props.geo === 'rectangle' || props.geo === 'ellipse')
    ) {
      shapesOut.push({
        ...(wbId ? { id: wbId } : {}),
        type: props.geo === 'ellipse' ? 'ellipse' : 'rect',
        x,
        y,
        w: Number(props.w) || 40,
        h: Number(props.h) || 24,
        color: tlColorToHex(props.color),
      });
    } else if (sh.type === 'arrow') {
      const start = (props.start ?? { x: 0, y: 0 }) as { x?: unknown; y?: unknown };
      const end = (props.end ?? { x: 0, y: 0 }) as { x?: unknown; y?: unknown };
      const sx = Number(start.x) || 0;
      const sy = Number(start.y) || 0;
      const ex = Number(end.x) || 0;
      const ey = Number(end.y) || 0;
      shapesOut.push({
        ...(wbId ? { id: wbId } : {}),
        type: 'arrow',
        x1: x + sx,
        y1: y + sy,
        x2: x + ex,
        y2: y + ey,
        color: tlColorToHex(props.color),
      });
    } else if (sh.type === 'text') {
      const text = typeof props.text === 'string' ? props.text : '';
      if (text.trim()) {
        shapesOut.push({
          ...(wbId ? { id: wbId } : {}),
          type: 'text',
          x,
          y,
          text,
          color: tlColorToHex(props.color),
          // tldraw 的字号档位与 fence 一致；缺省落 'm'，与旧文档观感相同
          size: toWbTextSize(props.size),
        });
      }
    }
  }
  return { v: 1, strokes, shapes: shapesOut };
}
