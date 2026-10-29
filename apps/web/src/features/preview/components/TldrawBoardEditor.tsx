import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ensureIds,
  hexToTlColor,
  serializeTldrawFence,
  tlSizeToWidth,
  toWbTextSize,
  wbTextSizeToPx,
  widthToTlSize,
  WB_PALETTE,
  type WbDocument,
  type WbPoint,
  type WbShape,
  type WbStroke,
  type WbTextSize,
} from '@md-studio/core';
import { Icon, type IconName } from '../../../components/Icon';
import { t } from '../../../i18n';
import { useSettings } from '../../../stores/settings';
import { WB_ARROW_MARKER_ID, WbArrowMarker, WbShapeView, WbStrokeView } from './whiteboard/WbShapeView';

interface Props {
  doc: WbDocument;
  onChange: (doc: WbDocument) => void;
  /** 请求切换到真实 tldraw 完整白板（状态由父组件 TldrawBoard 持有） */
  onRequestFull: () => void;
}

type Tool = 'select' | 'pen' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'eraser';

type StrokeEl = WbStroke & { id: string };
type ShapeEl = WbShape & { id: string };
interface Model {
  strokes: StrokeEl[];
  shapes: ShapeEl[];
}

/** 拖拽中的草稿（矩形/椭圆/直线/箭头）；笔迹草稿即 strokes 尾部 */
interface Draft {
  type: 'rect' | 'ellipse' | 'line' | 'arrow';
  start: WbPoint;
  cur: WbPoint;
}

const HISTORY_LIMIT = 60;
const HIT_TOLERANCE = 6;

const TOOLS: { tool: Tool; icon: IconName; labelKey: string; hotkey: string }[] = [
  { tool: 'select', icon: 'select', labelKey: 'wbSelect', hotkey: 'V' },
  { tool: 'pen', icon: 'pen', labelKey: 'wbPen', hotkey: 'P' },
  { tool: 'line', icon: 'lineTool', labelKey: 'wbLine', hotkey: 'L' },
  { tool: 'rect', icon: 'rect', labelKey: 'wbRect', hotkey: 'R' },
  { tool: 'ellipse', icon: 'ellipse', labelKey: 'wbEllipse', hotkey: 'O' },
  { tool: 'arrow', icon: 'arrow', labelKey: 'wbArrow', hotkey: 'A' },
  { tool: 'text', icon: 'textTool', labelKey: 'wbText', hotkey: 'T' },
  { tool: 'eraser', icon: 'eraser', labelKey: 'wbEraser', hotkey: 'E' },
];

const HOTKEYS: Record<string, Tool> = {
  v: 'select',
  p: 'pen',
  l: 'line',
  r: 'rect',
  o: 'ellipse',
  a: 'arrow',
  t: 'text',
  e: 'eraser',
};

/** 字号档位（与 fence 的 size / tldraw 的 size 对齐） */
const TEXT_SIZES: { size: WbTextSize; label: string }[] = [
  { size: 's', label: 'S' },
  { size: 'm', label: 'M' },
  { size: 'l', label: 'L' },
  { size: 'xl', label: 'XL' },
];

const WIDTH_STEPS = [
  { size: 's', width: tlSizeToWidth('s') },
  { size: 'm', width: tlSizeToWidth('m') },
  { size: 'l', width: tlSizeToWidth('l') },
  { size: 'xl', width: tlSizeToWidth('xl') },
];

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}-${idCounter}`;
}

/** fence 文档 → 编辑器内部模型（补齐缺失 id，保证选择/移动/删除稳定） */
function toModel(d: WbDocument): Model {
  const ensured = ensureIds(d);
  return {
    strokes: ensured.strokes.map((s) => ({ ...s, id: s.id ?? '' })),
    shapes: (ensured.shapes ?? []).map((s) => ({ ...s, id: s.id ?? '' })),
  };
}

function dist(a: WbPoint, b: WbPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distToSegment(p: WbPoint, a: WbPoint, b: WbPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function bboxOf(el: StrokeEl | ShapeEl): { x: number; y: number; w: number; h: number } {
  if ('points' in el) {
    if (el.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    const xs = el.points.map((p) => p.x);
    const ys = el.points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  switch (el.type) {
    case 'rect':
    case 'ellipse':
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case 'arrow':
      return {
        x: Math.min(el.x1, el.x2),
        y: Math.min(el.y1, el.y2),
        w: Math.abs(el.x2 - el.x1),
        h: Math.abs(el.y2 - el.y1),
      };
    case 'text': {
      // 命中框按实际字号估算：CJK 约等于 1em/字，其余字符约 0.62em
      const px = wbTextSizeToPx(el.size);
      return {
        x: el.x,
        y: el.y - px * 0.85,
        w: Math.max(px, el.text.length * px * 0.62),
        h: px * 1.15,
      };
    }
  }
}

function translateStroke(s: StrokeEl, dx: number, dy: number): StrokeEl {
  return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

function translateShape(s: ShapeEl, dx: number, dy: number): ShapeEl {
  switch (s.type) {
    case 'rect':
    case 'ellipse':
      return { ...s, x: s.x + dx, y: s.y + dy };
    case 'arrow':
      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    case 'text':
      return { ...s, x: s.x + dx, y: s.y + dy };
  }
}

/** 拖拽中的形状预览（不落盘，松手才提交） */
function DraftView({ draft, color }: { draft: Draft; color: string }): React.ReactElement {
  const x = Math.min(draft.start.x, draft.cur.x);
  const y = Math.min(draft.start.y, draft.cur.y);
  const w = Math.abs(draft.cur.x - draft.start.x);
  const h = Math.abs(draft.cur.y - draft.start.y);
  if (draft.type === 'rect') {
    return <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth={2} opacity={0.7} />;
  }
  if (draft.type === 'ellipse') {
    return (
      <ellipse
        cx={x + w / 2}
        cy={y + h / 2}
        rx={w / 2}
        ry={h / 2}
        fill="none"
        stroke={color}
        strokeWidth={2}
        opacity={0.7}
      />
    );
  }
  return (
    <line
      x1={draft.start.x}
      y1={draft.start.y}
      x2={draft.cur.x}
      y2={draft.cur.y}
      stroke={color}
      strokeWidth={2}
      opacity={0.7}
      markerEnd={draft.type === 'arrow' ? `url(#${WB_ARROW_MARKER_ID})` : undefined}
    />
  );
}

export default function TldrawBoardEditor({ doc, onChange, onRequestFull }: Props) {
  const settings = useSettings();
  const locale = settings.locale;

  const [initialModel] = useState(() => toModel(doc));
  const [strokes, setStrokes] = useState<StrokeEl[]>(initialModel.strokes);
  const [shapes, setShapes] = useState<ShapeEl[]>(initialModel.shapes);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>(
    () => WB_PALETTE.find((c) => c.name === 'blue')?.hex ?? '#3b82f6'
  );
  const [width, setWidth] = useState<number>(() => tlSizeToWidth('m'));
  /** 新建文字的字号档位（旧文档缺省 'm' = 16px） */
  const [textSize, setTextSize] = useState<WbTextSize>('m');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<WbPoint | null>(null);
  const [textPos, setTextPos] = useState<{ left: number; top: number } | null>(null);
  const [textValue, setTextValue] = useState('');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const strokesRef = useRef(strokes);
  const shapesRef = useRef(shapes);
  const pastRef = useRef<Model[]>([]);
  const futureRef = useRef<Model[]>([]);
  const lastEmittedRef = useRef<string | null>(null);
  const lastAppliedSigRef = useRef<string | null>(null);
  const drawing = useRef(false);
  const movedRef = useRef(false);
  const dragOrigin = useRef<{ kind: 'stroke'; el: StrokeEl } | { kind: 'shape'; el: ShapeEl } | null>(
    null
  );
  const dragStartPt = useRef<WbPoint | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  /** 文字输入层的当前位置（以 ref 为准，保证提交幂等：同一会话只落一次盘） */
  const editingRef = useRef<WbPoint | null>(null);
  /**
   * 「连续操作」开始前的模型快照。
   * 画笔绘制与选择拖动都会边拖边改模型（中途不记录历史），拖完才落一次盘；
   * 若此时才用 currentModel() 当历史快照，快照里已经包含本次改动，撤销就成了空操作。
   */
  const historyBeforeRef = useRef<Model | null>(null);

  /** 关闭文字输入层；必须先清 ref，卸载引发的 blur 才不会二次提交 */
  const closeText = useCallback(() => {
    editingRef.current = null;
    setEditing(null);
    setTextValue('');
  }, []);

  const sig = useMemo(() => serializeTldrawFence(ensureIds(doc)), [doc]);

  const currentModel = useCallback(
    (): Model => ({ strokes: strokesRef.current, shapes: shapesRef.current }),
    []
  );

  const applyModel = useCallback(
    (m: Model, opts: { emit: boolean; record: boolean; before?: Model }) => {
      if (opts.record) {
        // 默认快照「改动前」的模型；连续操作（画笔/拖动）由 before 显式提供
        pastRef.current = [...pastRef.current, opts.before ?? currentModel()];
        if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
        futureRef.current = [];
      }
      strokesRef.current = m.strokes;
      shapesRef.current = m.shapes;
      setStrokes(m.strokes);
      setShapes(m.shapes);
      setCanUndo(pastRef.current.length > 0);
      setCanRedo(futureRef.current.length > 0);
      if (opts.emit) {
        const next: WbDocument = { v: 1, strokes: m.strokes, shapes: m.shapes };
        lastEmittedRef.current = serializeTldrawFence(next);
        onChange(next);
      }
    },
    [currentModel, onChange]
  );

  // 外部内容变化（源码编辑 / 完整白板写回）时才重置本地模型与历史；
  // 自身写回引发的重渲染（sig === lastEmitted）直接跳过，避免清空撤销栈。
  useEffect(() => {
    if (sig === lastEmittedRef.current || sig === lastAppliedSigRef.current) return;
    lastAppliedSigRef.current = sig;
    const m = toModel(doc);
    strokesRef.current = m.strokes;
    shapesRef.current = m.shapes;
    setStrokes(m.strokes);
    setShapes(m.shapes);
    pastRef.current = [];
    futureRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setSelectedId(null);
    setDraft(null);
    closeText();
  }, [sig, doc, closeText]);

  // 文字叠层定位：editing 变化后测量实际屏幕位置并聚焦（避免在渲染期读 ref）
  useEffect(() => {
    if (!editing) {
      setTextPos(null);
      return;
    }
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    const ctm = svg?.getScreenCTM();
    if (svg && wrap && ctm) {
      const pt = svg.createSVGPoint();
      pt.x = editing.x;
      pt.y = editing.y;
      const sp = pt.matrixTransform(ctm);
      const box = wrap.getBoundingClientRect();
      setTextPos({ left: sp.x - box.left, top: sp.y - box.top });
    }
    textRef.current?.focus();
  }, [editing]);

  // 选中元素已被删除（橡皮擦/清空/撤销）时清空选中，避免残留选中框与失效的线宽控件
  useEffect(() => {
    if (!selectedId) return;
    const exists =
      strokes.some((x) => x.id === selectedId) || shapes.some((x) => x.id === selectedId);
    if (!exists) setSelectedId(null);
  }, [selectedId, strokes, shapes]);

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const prev = pastRef.current[pastRef.current.length - 1]!;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [currentModel(), ...futureRef.current];
    applyModel(prev, { emit: true, record: false });
  }, [applyModel, currentModel]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current[0]!;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, currentModel()];
    applyModel(next, { emit: true, record: false });
  }, [applyModel, currentModel]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const m = currentModel();
    setSelectedId(null);
    applyModel(
      {
        strokes: m.strokes.filter((x) => x.id !== selectedId),
        shapes: m.shapes.filter((x) => x.id !== selectedId),
      },
      { emit: true, record: true }
    );
  }, [selectedId, applyModel, currentModel]);

  const clearAll = useCallback(() => {
    setSelectedId(null);
    applyModel({ strokes: [], shapes: [] }, { emit: true, record: true });
  }, [applyModel]);

  const applyColor = useCallback(
    (hex: string) => {
      setColor(hex);
      if (!selectedId) return;
      const m = currentModel();
      applyModel(
        {
          strokes: m.strokes.map((x) => (x.id === selectedId ? { ...x, color: hex } : x)),
          shapes: m.shapes.map((x) => (x.id === selectedId ? { ...x, color: hex } : x)),
        },
        { emit: true, record: true }
      );
    },
    [selectedId, applyModel, currentModel]
  );

  const applyWidth = useCallback(
    (w: number) => {
      setWidth(w);
      if (!selectedId) return;
      const m = currentModel();
      if (!m.strokes.some((x) => x.id === selectedId)) return;
      applyModel(
        {
          strokes: m.strokes.map((x) => (x.id === selectedId ? { ...x, width: w } : x)),
          shapes: m.shapes,
        },
        { emit: true, record: true }
      );
    },
    [selectedId, applyModel, currentModel]
  );

  /**
   * 字号：既作用于「待提交的文字」（输入框即时变化），也作用于选中的文字形状。
   * 之前文字字号被硬编码 16px、且线宽控件对非笔迹一律禁用，导致完全无法调大小。
   */
  const applyTextSize = useCallback(
    (size: WbTextSize) => {
      setTextSize(size);
      if (!selectedId) return;
      const m = currentModel();
      if (!m.shapes.some((x) => x.id === selectedId && x.type === 'text')) return;
      applyModel(
        {
          strokes: m.strokes,
          shapes: m.shapes.map((x) =>
            x.id === selectedId && x.type === 'text'
              ? { ...x, ...(size === 'm' ? { size: undefined } : { size }) }
              : x
          ),
        },
        { emit: true, record: true }
      );
    },
    [selectedId, applyModel, currentModel]
  );

  /** 未确认前的文字可直接拖动手柄移动（避免只能先提交再重新建） */
  const textDragRef = useRef<{ startClient: WbPoint; start: WbPoint; scale: number } | null>(null);

  const onTextHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    const pos = editingRef.current;
    if (!svg || !ctm || !pos) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* 忽略：无捕获时拖动可能中断，但不影响后续提交 */
    }
    textDragRef.current = {
      startClient: { x: e.clientX, y: e.clientY },
      start: { ...pos },
      scale: ctm.a || 1,
    };
  };

  const onTextHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = textDragRef.current;
    if (!d) return;
    e.preventDefault();
    const next: WbPoint = {
      x: d.start.x + (e.clientX - d.startClient.x) / d.scale,
      y: d.start.y + (e.clientY - d.startClient.y) / d.scale,
    };
    editingRef.current = next;
    // 让定位 effect 重算屏幕坐标，输入框跟随移动
    setEditing(next);
  };

  const onTextHandleUp = () => {
    textDragRef.current = null;
  };

  const toPoint = (e: React.PointerEvent): WbPoint | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const hitTest = useCallback(
    (p: WbPoint): { kind: 'stroke'; el: StrokeEl } | { kind: 'shape'; el: ShapeEl } | null => {
    const ss = strokesRef.current;
    for (let i = ss.length - 1; i >= 0; i--) {
      const st = ss[i]!;
      if (st.points.length === 1) {
        if (dist(p, st.points[0]!) <= HIT_TOLERANCE) return { el: st, kind: 'stroke' };
        continue;
      }
      for (let j = 1; j < st.points.length; j++) {
        if (distToSegment(p, st.points[j - 1]!, st.points[j]!) <= HIT_TOLERANCE) {
          return { el: st, kind: 'stroke' };
        }
      }
    }
    const shs = shapesRef.current;
    for (let i = shs.length - 1; i >= 0; i--) {
      const sh = shs[i]!;
      if (sh.type === 'arrow') {
        if (distToSegment(p, { x: sh.x1, y: sh.y1 }, { x: sh.x2, y: sh.y2 }) <= HIT_TOLERANCE) {
          return { el: sh, kind: 'shape' };
        }
        continue;
      }
      const b = bboxOf(sh);
      if (
        p.x >= b.x - HIT_TOLERANCE &&
        p.x <= b.x + b.w + HIT_TOLERANCE &&
        p.y >= b.y - HIT_TOLERANCE &&
        p.y <= b.y + b.h + HIT_TOLERANCE
      ) {
        return { el: sh, kind: 'shape' };
      }
    }
    return null;
  }, []);

  const eraseAt = useCallback(
    (p: WbPoint, record: boolean) => {
      const hit = hitTest(p);
      if (!hit) return;
      const m = currentModel();
      applyModel(
        {
          strokes: m.strokes.filter((x) => x.id !== hit.el.id),
          shapes: m.shapes.filter((x) => x.id !== hit.el.id),
        },
        { emit: true, record }
      );
    },
    [hitTest, applyModel, currentModel]
  );

  const cancelDrag = () => {
    drawing.current = false;
    movedRef.current = false;
    dragOrigin.current = null;
    dragStartPt.current = null;
    setDraft(null);
  };

  const commitText = useCallback(() => {
    // 以 ref 作为「是否还有未提交的输入」的唯一依据：
    // 关闭输入层会让 textarea 卸载，可能再触发一次 blur（onBlur→commitText），
    // 若不先清 ref 就会把同一段文字提交成两个形状。
    const pos = editingRef.current;
    if (!pos) return;
    editingRef.current = null;
    const text = textValue.trim();
    setEditing(null);
    setTextValue('');
    if (!text) return;
    const m = currentModel();
    const el: ShapeEl = {
      id: newId('text'),
      type: 'text',
      x: pos.x,
      y: pos.y,
      text,
      color,
      // 缺省档位不落盘，保持旧 fence 形态
      ...(textSize === 'm' ? {} : { size: textSize }),
    };
    applyModel({ strokes: m.strokes, shapes: [...m.shapes, el] }, { emit: true, record: true });
  }, [textValue, textSize, color, applyModel, currentModel]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // 输入层打开时，画布上的按下视为「确认并关闭」：画布的 mousedown 默认聚焦被
    // 阻止后不会再产生 blur，必须在这里显式提交，否则文字会一直悬在输入框里。
    if (editing) {
      commitText();
      wrapRef.current?.focus();
      return;
    }
    const p = toPoint(e);
    if (!p) return;
    wrapRef.current?.focus();
    // 指针捕获失败（无效/非活动 pointerId，如合成事件）不应中断后续工具逻辑
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* 忽略：无捕获时仍可正常绘制 */
    }

    if (tool === 'eraser') {
      drawing.current = true;
      eraseAt(p, true);
      return;
    }
    if (tool === 'select') {
      const hit = hitTest(p);
      setSelectedId(hit ? hit.el.id : null);
      // 选中文字时把字号控件同步到该文字，便于直接调大小
      if (hit?.kind === 'shape' && hit.el.type === 'text') {
        setTextSize(toWbTextSize(hit.el.size));
      }
      if (hit) {
        drawing.current = true;
        movedRef.current = false;
        dragStartPt.current = p;
        dragOrigin.current = hit;
        // 拖动过程中模型会即时改动，先存快照供松手时记历史
        historyBeforeRef.current = currentModel();
      }
      return;
    }
    if (tool === 'text') {
      editingRef.current = p;
      setEditing(p);
      setTextValue('');
      return;
    }
    if (tool === 'pen') {
      drawing.current = true;
      // 笔迹是边拖边写模型的，落笔前先存快照
      historyBeforeRef.current = currentModel();
      const stroke: StrokeEl = { id: newId('s'), color, width, points: [p] };
      applyModel({ strokes: [...strokesRef.current, stroke], shapes: shapesRef.current }, { emit: false, record: false });
      return;
    }
    drawing.current = true;
    setDraft({ type: tool, start: p, cur: p });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return;
    const p = toPoint(e);
    if (!p) return;

    if (tool === 'eraser') {
      eraseAt(p, false);
      return;
    }
    const origin = dragOrigin.current;
    const startPt = dragStartPt.current;
    if (tool === 'select' && origin && startPt) {
      const dx = p.x - startPt.x;
      const dy = p.y - startPt.y;
      const m = currentModel();
      if (origin.kind === 'stroke') {
        const moved = translateStroke(origin.el, dx, dy);
        applyModel(
          { strokes: m.strokes.map((x) => (x.id === moved.id ? moved : x)), shapes: m.shapes },
          { emit: false, record: false }
        );
      } else {
        const moved = translateShape(origin.el, dx, dy);
        applyModel(
          { strokes: m.strokes, shapes: m.shapes.map((x) => (x.id === moved.id ? moved : x)) },
          { emit: false, record: false }
        );
      }
      movedRef.current = true;
      return;
    }
    if (draft) {
      setDraft({ ...draft, cur: p });
      return;
    }
    if (tool === 'pen') {
      const list = strokesRef.current;
      if (list.length === 0) return;
      const last = list[list.length - 1]!;
      const updated: StrokeEl = { ...last, points: [...last.points, p] };
      applyModel(
        { strokes: [...list.slice(0, -1), updated], shapes: shapesRef.current },
        { emit: false, record: false }
      );
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return;
    const p = toPoint(e);
    drawing.current = false;

    if (tool === 'eraser') {
      dragStartPt.current = null;
      dragOrigin.current = null;
      return;
    }
    if (tool === 'select') {
      dragStartPt.current = null;
      dragOrigin.current = null;
      if (movedRef.current) {
        applyModel(currentModel(), {
          emit: true,
          record: true,
          before: historyBeforeRef.current ?? undefined,
        });
      }
      historyBeforeRef.current = null;
      movedRef.current = false;
      return;
    }
    if (tool === 'pen') {
      applyModel(currentModel(), {
        emit: true,
        record: true,
        before: historyBeforeRef.current ?? undefined,
      });
      historyBeforeRef.current = null;
      return;
    }

    const d = draft;
    setDraft(null);
    if (!d || !p) return;
    const m = currentModel();
    if (d.type === 'rect' || d.type === 'ellipse') {
      const x = Math.min(d.start.x, p.x);
      const y = Math.min(d.start.y, p.y);
      const w = Math.abs(p.x - d.start.x) || 40;
      const h = Math.abs(p.y - d.start.y) || 24;
      if (d.type === 'rect') {
        const el: ShapeEl = { id: newId('rect'), type: 'rect', x, y, w, h, color };
        applyModel({ strokes: m.strokes, shapes: [...m.shapes, el] }, { emit: true, record: true });
      } else {
        const el: ShapeEl = { id: newId('ellipse'), type: 'ellipse', x, y, w, h, color };
        applyModel({ strokes: m.strokes, shapes: [...m.shapes, el] }, { emit: true, record: true });
      }
      return;
    }
    if (d.type === 'arrow') {
      const el: ShapeEl = {
        id: newId('arrow'),
        type: 'arrow',
        x1: d.start.x,
        y1: d.start.y,
        x2: p.x,
        y2: p.y,
        color,
      };
      applyModel({ strokes: m.strokes, shapes: [...m.shapes, el] }, { emit: true, record: true });
      return;
    }
    // line：两点笔迹（不新增协议形状）
    const el: StrokeEl = { id: newId('s'), color, width, points: [d.start, p] };
    applyModel({ strokes: [...m.strokes, el], shapes: m.shapes }, { emit: true, record: true });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
      return;
    }
    if (e.key === 'Escape') {
      cancelDrag();
      closeText();
      setSelectedId(null);
      return;
    }
    if (!mod) {
      const next = HOTKEYS[k];
      if (next) {
        setTool(next);
        closeText();
      }
    }
  };

  const selectedStroke = strokes.find((x) => x.id === selectedId) ?? null;
  const selectedShape = shapes.find((x) => x.id === selectedId) ?? null;
  const activeColor = selectedStroke?.color ?? selectedShape?.color ?? color;
  const activeColorName = hexToTlColor(activeColor);
  const activeWidthSize = widthToTlSize(selectedStroke ? selectedStroke.width : width);
  const widthDisabled = !!selectedId && !selectedStroke;
  const selectedText = selectedShape?.type === 'text' ? selectedShape : null;
  const activeTextSize = selectedText ? toWbTextSize(selectedText.size) : textSize;
  /** 只有「正在输入文字」或「选中了文字」时字号才有意义 */
  const textSizeDisabled = !editing && !selectedText;

  const selBox = useMemo(() => {
    const el: StrokeEl | ShapeEl | null = selectedStroke ?? selectedShape;
    if (!el) return null;
    const b = bboxOf(el);
    return { x: b.x - 3, y: b.y - 3, w: Math.max(b.w + 6, 8), h: Math.max(b.h + 6, 8) };
  }, [selectedStroke, selectedShape]);

  const empty = strokes.length === 0 && shapes.length === 0 && !draft;

  /**
   * 文字工具落笔时，浏览器 mousedown 的默认行为会把焦点移到可聚焦的画布容器
   * （tabIndex=0），于是刚挂载的 textarea 立刻被 blur → onBlur 提交空文本并
   * setEditing(null)，表现为「选了文字工具，点画布却无法输入」。
   * 阻止默认聚焦即可保住 textarea 的焦点；点击 textarea 自身时不能拦，
   * 否则无法移动光标。
   */
  const onCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.tldraw-text-input')) return;
    e.preventDefault();
  };

  /**
   * 工具栏同样不能抢焦点：否则「正在输入文字时点字号/颜色」会先触发 textarea blur
   * 把文字提交掉、输入层消失，等于没确认就不能调整样式。
   */
  const onToolbarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  return (
    <div className="tldraw-block tldraw-edit">
      <div
        className="tldraw-toolbar"
        role="toolbar"
        aria-label={t(locale, 'wbCanvas')}
        onMouseDown={onToolbarMouseDown}
      >
        <div className="tldraw-tools">
          {TOOLS.map((x) => (
            <button
              key={x.tool}
              type="button"
              className="tldraw-icon-btn"
              aria-label={t(locale, x.labelKey)}
              aria-pressed={tool === x.tool}
              title={`${t(locale, x.labelKey)} (${x.hotkey})`}
              onClick={() => {
                // 切换工具前先落盘，避免已输入的文字被静默丢弃
                commitText();
                setTool(x.tool);
              }}
            >
              <Icon name={x.icon} size={16} />
            </button>
          ))}
        </div>
        <span className="tldraw-sep" />
        <div className="tldraw-tools">
          <button
            type="button"
            className="tldraw-icon-btn"
            aria-label={t(locale, 'wbUndo')}
            title={t(locale, 'wbUndo')}
            disabled={!canUndo}
            onClick={undo}
          >
            <Icon name="undo" size={16} />
          </button>
          <button
            type="button"
            className="tldraw-icon-btn"
            aria-label={t(locale, 'wbRedo')}
            title={t(locale, 'wbRedo')}
            disabled={!canRedo}
            onClick={redo}
          >
            <Icon name="redo" size={16} />
          </button>
        </div>
        <span className="tldraw-sep" />
        <div className="tldraw-tools">
          <button
            type="button"
            className="tldraw-icon-btn"
            aria-label={t(locale, 'wbDelete')}
            title={t(locale, 'wbDelete')}
            disabled={!selectedId}
            onClick={deleteSelected}
          >
            <Icon name="trash" size={16} />
          </button>
          <button
            type="button"
            className="tldraw-icon-btn"
            aria-label={t(locale, 'wbClear')}
            title={t(locale, 'wbClear')}
            onClick={clearAll}
          >
            <Icon name="eraser" size={16} />
          </button>
        </div>
        <span className="tldraw-sep" />
        <div className="tldraw-tools" role="group" aria-label={t(locale, 'wbColor')}>
          {WB_PALETTE.map((c) => (
            <button
              key={c.name}
              type="button"
              className={`tldraw-swatch ${c.name === activeColorName ? 'active' : ''}`}
              style={{ background: c.hex }}
              aria-label={c.name}
              aria-pressed={c.name === activeColorName}
              title={c.name}
              onClick={() => applyColor(c.hex)}
            />
          ))}
        </div>
        <span className="tldraw-sep" />
        <div className="tldraw-tools" role="group" aria-label={t(locale, 'wbWidth')}>
          {WIDTH_STEPS.map((w) => (
            <button
              key={w.size}
              type="button"
              className={`tldraw-width-btn ${activeWidthSize === w.size ? 'active' : ''}`}
              aria-label={`${t(locale, 'wbWidth')} ${w.size.toUpperCase()}`}
              aria-pressed={activeWidthSize === w.size}
              title={`${t(locale, 'wbWidth')} ${w.size.toUpperCase()}`}
              disabled={widthDisabled}
              onClick={() => applyWidth(w.width)}
            >
              <span style={{ height: `${Math.max(2, Math.round(w.width * 1.5))}px` }} />
            </button>
          ))}
        </div>
        <span className="tldraw-sep" />
        <div className="tldraw-tools" role="group" aria-label={t(locale, 'wbTextSize')}>
          {TEXT_SIZES.map((s) => (
            <button
              key={s.size}
              type="button"
              className={`tldraw-size-btn ${activeTextSize === s.size ? 'active' : ''}`}
              aria-label={`${t(locale, 'wbTextSize')} ${s.label}`}
              aria-pressed={activeTextSize === s.size}
              title={`${t(locale, 'wbTextSize')} ${s.label}`}
              disabled={textSizeDisabled}
              onClick={() => applyTextSize(s.size)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="tldraw-hint">{t(locale, 'wbHint')}</span>
        <button
          type="button"
          className="tldraw-icon-btn"
          aria-label={t(locale, 'wbFull')}
          title={t(locale, 'wbFull')}
          onClick={() => {
            // 切换前先落盘，未确认的文字不会丢
            commitText();
            onRequestFull();
          }}
        >
          <Icon name="board" size={16} />
        </button>
      </div>
      <div
        className="tldraw-canvas"
        ref={wrapRef}
        tabIndex={0}
        role="application"
        aria-label={t(locale, 'wbCanvas')}
        onKeyDown={onKeyDown}
        onMouseDown={onCanvasMouseDown}
      >
        <svg
          ref={svgRef}
          viewBox="0 0 640 360"
          className="tldraw-svg"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
        >
          <defs>
            <WbArrowMarker />
          </defs>
          <rect width="640" height="360" fill="var(--md-color-surface, #f8fafc)" />
          {shapes.map((el) => (
            <WbShapeView key={el.id} el={el} />
          ))}
          {strokes.map((el) => (
            <WbStrokeView key={el.id} el={el} />
          ))}
          {draft && <DraftView draft={draft} color={color} />}
          {selBox && (
            <rect
              className="tldraw-sel"
              x={selBox.x}
              y={selBox.y}
              width={selBox.w}
              height={selBox.h}
            />
          )}
        </svg>
        {editing && (
          <>
            <div
              className="tldraw-text-handle"
              role="button"
              tabIndex={-1}
              aria-label={t(locale, 'wbTextMove')}
              title={t(locale, 'wbTextMove')}
              style={{ left: (textPos?.left ?? 8) - 16, top: textPos?.top ?? 8 }}
              onPointerDown={onTextHandleDown}
              onPointerMove={onTextHandleMove}
              onPointerUp={onTextHandleUp}
              onPointerCancel={onTextHandleUp}
            >
              <Icon name="select" size={12} />
            </div>
            <textarea
              ref={textRef}
              className="tldraw-text-input"
              style={{
                left: textPos?.left ?? 8,
                top: textPos?.top ?? 8,
                fontSize: wbTextSizeToPx(textSize),
                height: Math.max(28, Math.round(wbTextSizeToPx(textSize) * 1.7)),
              }}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onBlur={commitText}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitText();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  closeText();
                }
              }}
            />
          </>
        )}
        {empty && (
          <div className="tldraw-empty">
            {t(locale, 'wbCanvas')} — ```tldraw
          </div>
        )}
      </div>
    </div>
  );
}
