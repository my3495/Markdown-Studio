import type { ReactElement } from 'react';
import { wbTextSizeToPx, type WbShape, type WbStroke } from '@md-studio/core';

/** 全白板共用的箭头 marker id（同一页面内各白板定义相同，渲染结果一致） */
export const WB_ARROW_MARKER_ID = 'wb-arrowhead';

/** 箭头 marker 定义（放入各 SVG 的 <defs>） */
export function WbArrowMarker(): ReactElement {
  return (
    <marker
      id={WB_ARROW_MARKER_ID}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
    </marker>
  );
}

/** 形状 → SVG 元素（轻量编辑器与只读态共用，保证观感一致） */
export function WbShapeView({ el }: { el: WbShape }): ReactElement {
  switch (el.type) {
    case 'rect':
      return (
        <rect
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          fill="none"
          stroke={el.color}
          strokeWidth={2}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={el.x + el.w / 2}
          cy={el.y + el.h / 2}
          rx={el.w / 2}
          ry={el.h / 2}
          fill="none"
          stroke={el.color}
          strokeWidth={2}
        />
      );
    case 'arrow':
      return (
        <line
          x1={el.x1}
          y1={el.y1}
          x2={el.x2}
          y2={el.y2}
          stroke={el.color}
          strokeWidth={2}
          markerEnd={`url(#${WB_ARROW_MARKER_ID})`}
        />
      );
    case 'text':
      return (
        <text x={el.x} y={el.y} fill={el.color} fontSize={wbTextSizeToPx(el.size)}>
          {el.text}
        </text>
      );
  }
}

/** 笔迹 → SVG path（点为空时不渲染） */
export function WbStrokeView({ el }: { el: WbStroke }): ReactElement | null {
  if (el.points.length === 0) return null;
  const d = el.points
    .map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  return (
    <path d={d} fill="none" stroke={el.color} strokeWidth={el.width} strokeLinecap="round" />
  );
}
