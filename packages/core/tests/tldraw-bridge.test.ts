import { describe, it, expect } from 'vitest';
import {
  hexToTlColor,
  tlColorToHex,
  tlShapesToWb,
  wbToTlShapes,
  widthToTlSize,
  tlSizeToWidth,
} from '../src/whiteboard/tldraw-bridge';
import {
  parseTldrawFence,
  serializeTldrawFence,
  toWbTextSize,
  wbTextSizeToPx,
} from '../src/whiteboard/tldraw-fence';

describe('颜色与尺寸映射', () => {
  it('HEX → 最近命名色', () => {
    expect(hexToTlColor('#000000')).toBe('black');
    expect(hexToTlColor('#ff0000')).toBe('red');
    expect(hexToTlColor('#00ff00')).toBe('green');
    expect(hexToTlColor('#3b82f6')).toBe('blue');
    expect(hexToTlColor('not-a-color')).toBe('black');
  });

  it('命名色 → HEX（未知回落黑）', () => {
    expect(tlColorToHex('blue')).toBe('#3b82f6');
    expect(tlColorToHex('whatever')).toBe('#1d1d1d');
  });

  it('线宽 ↔ 尺寸', () => {
    expect(widthToTlSize(1)).toBe('s');
    expect(widthToTlSize(2.5)).toBe('m');
    expect(widthToTlSize(4)).toBe('l');
    expect(widthToTlSize(8)).toBe('xl');
    expect(tlSizeToWidth('s')).toBe(1.5);
    expect(tlSizeToWidth('m')).toBe(2.5);
    expect(tlSizeToWidth('l')).toBe(4);
    expect(tlSizeToWidth('xl')).toBe(6);
    expect(tlSizeToWidth('zzz')).toBe(2.5);
  });
});

describe('WbDocument → tldraw partials', () => {
  const doc = {
    v: 1 as const,
    strokes: [
      { color: '#2563eb', width: 2.5, points: [{ x: 10, y: 10 }, { x: 50, y: 40 }, { x: 30, y: 5 }] },
      { color: '#000', width: 2, points: [] }, // 空笔迹被忽略
    ],
    shapes: [
      { type: 'rect' as const, x: 100, y: 60, w: 120, h: 80, color: '#e5484d' },
      { type: 'text' as const, x: 20, y: 200, text: '标注', color: '#111' },
    ],
  };

  it('生成 draw/geo/text 三类 partial', () => {
    const shapes = wbToTlShapes(doc);
    expect(shapes.map((s) => s.type)).toEqual(['draw', 'geo', 'text']);
    const draw = shapes[0]!;
    expect(draw.id).toBe('wb-stroke-0');
    expect(draw.x).toBe(10); // minX
    expect(draw.y).toBe(5); // minY
    const seg = (draw.props.segments as { type: string; points: { x: number; y: number }[] }[])[0]!;
    expect(seg.type).toBe('free');
    expect(seg.points).toEqual([
      { x: 0, y: 5 },
      { x: 40, y: 35 },
      { x: 20, y: 0 },
    ]);
    expect(draw.props.color).toBe('blue');
    expect(draw.props.size).toBe('m');
  });

  it('geo/text props 完整且 w/h 下限保护', () => {
    const shapes = wbToTlShapes(doc);
    const geo = shapes[1]!;
    expect(geo.props.geo).toBe('rectangle');
    expect(geo.props.w).toBe(120);
    expect(geo.props.color).toBe('red');
    const text = shapes[2]!;
    expect(text.props.text).toBe('标注');
    expect(text.props.w).toBeGreaterThanOrEqual(16);
    expect(wbToTlShapes({ v: 1, strokes: [], shapes: [{ type: 'rect', x: 0, y: 0, w: 0, h: -3, color: '#000' }] })[0]!.props.w).toBe(1);
  });
});

describe('tldraw → WbDocument 往返', () => {
  it('fence 往返后语义等价（笔迹/矩形/文字）', () => {
    const original = {
      v: 1 as const,
      strokes: [
        { color: '#2563eb', width: 2.5, points: [{ x: 0, y: 0 }, { x: 40, y: 30 }] },
      ],
      shapes: [
        { type: 'rect' as const, x: 100, y: 60, w: 120, h: 80, color: '#e5484d' },
        { type: 'text' as const, x: 20, y: 200, text: '标注', color: '#111827' },
      ],
    };
    const partials = wbToTlShapes(original);
    // 模拟 tldraw createShapes 后的完整形状（x/y/props 即 partial 内容）
    const round = tlShapesToWb(partials);
    expect(round.strokes).toHaveLength(1);
    expect(round.strokes[0]!.points).toEqual(original.strokes[0]!.points);
    expect(round.strokes[0]!.color).toBe('#3b82f6'); // 近似色（blue）
    const roundShapes = round.shapes ?? [];
    expect(roundShapes).toHaveLength(2);
    const rect = roundShapes.find((s) => s.type === 'rect')!;
    expect(rect).toMatchObject({ type: 'rect', x: 100, y: 60, w: 120, h: 80 });
    const text = roundShapes.find((s) => s.type === 'text')!;
    expect(text.type === 'text' && text.text).toBe('标注');
    // 可再次序列化回 fence 并被解析
    const doc2 = parseTldrawFence(serializeTldrawFence(round));
    expect(doc2.shapes).toHaveLength(2);
    expect(doc2.strokes[0]!.points).toHaveLength(2);
  });

  it('id 往返一致（wbToTlShapes → tlShapesToWb）', () => {
    const doc = {
      v: 1 as const,
      strokes: [
        { id: 's0', color: '#3b82f6', width: 2.5, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
      ],
      shapes: [{ id: 'rect1', type: 'rect' as const, x: 5, y: 6, w: 40, h: 20, color: '#e5484d' }],
    };
    // 模拟 tldraw 记录 id（带 shape: 前缀）
    const partials = wbToTlShapes(doc).map((p) => ({ ...p, id: `shape:${p.id}` }));
    expect(partials[0]!.id).toBe('shape:wb-s0');
    const round = tlShapesToWb(partials);
    expect(round.strokes[0]!.id).toBe('s0');
    expect((round.shapes ?? [])[0]!.id).toBe('rect1');
  });

  it('文字字号档位可往返（s/m/l/xl），缺省回落 m', () => {
    expect(wbTextSizeToPx('s')).toBe(12);
    expect(wbTextSizeToPx('m')).toBe(16);
    expect(wbTextSizeToPx('l')).toBe(24);
    expect(wbTextSizeToPx('xl')).toBe(32);
    expect(wbTextSizeToPx(undefined)).toBe(16);
    expect(toWbTextSize('bad')).toBe('m');

    const doc = {
      v: 1 as const,
      strokes: [],
      shapes: [
        { id: 'text1', type: 'text' as const, x: 10, y: 20, text: '大号', color: '#1d1d1d', size: 'xl' as const },
        { id: 'text2', type: 'text' as const, x: 30, y: 40, text: '默认', color: '#1d1d1d' },
      ],
    };
    const tl = wbToTlShapes(doc);
    expect(tl[0]!.props.size).toBe('xl');
    expect(tl[1]!.props.size).toBe('m');
    // 字号影响信封宽度估算
    expect(Number(tl[0]!.props.w)).toBeGreaterThan(Number(tl[1]!.props.w));

    const round = tlShapesToWb(tl);
    const sizes = (round.shapes ?? []).map((s) => (s.type === 'text' ? s.size : undefined));
    expect(sizes).toEqual(['xl', 'm']);
  });

  it('fence 归一化：非法字号被丢弃，缺省不落盘', () => {
    const parsed = parseTldrawFence(
      JSON.stringify({
        v: 1,
        strokes: [],
        shapes: [
          { type: 'text', x: 1, y: 2, text: 'a', color: '#000', size: 'huge' },
          { type: 'text', x: 3, y: 4, text: 'b', color: '#000' },
        ],
      })
    );
    const shapes = parsed.shapes ?? [];
    expect(shapes.map((s) => (s.type === 'text' ? s.size : null))).toEqual(['m', undefined]);
    expect(serializeTldrawFence(parsed)).not.toContain('huge');
  });

  it('椭圆 / 箭头 / 直线 往返保持几何', () => {
    const doc = {
      v: 1 as const,
      strokes: [],
      shapes: [
        { id: 'e1', type: 'ellipse' as const, x: 10, y: 20, w: 60, h: 30, color: '#3fa34d' },
        { id: 'a1', type: 'arrow' as const, x1: 5, y1: 6, x2: 95, y2: 66, color: '#3b82f6' },
      ],
    };
    const tl = wbToTlShapes(doc);
    const round = tlShapesToWb(tl);
    const shapes = round.shapes ?? [];
    const ellipse = shapes.find((s) => s.type === 'ellipse');
    const arrow = shapes.find((s) => s.type === 'arrow');
    expect(ellipse).toMatchObject({ x: 10, y: 20, w: 60, h: 30 });
    expect(arrow).toMatchObject({ x1: 5, y1: 6, x2: 95, y2: 66 });
    expect(ellipse && 'id' in ellipse && ellipse.id).toBe('e1');
    expect(arrow && 'id' in arrow && arrow.id).toBe('a1');
  });

  it('tldraw line 形状归并成笔迹（两点）', () => {
    const wb = tlShapesToWb([
      {
        type: 'line',
        x: 0,
        y: 0,
        props: { points: { a: { x: 0, y: 0, index: 'a0' }, b: { x: 20, y: 10, index: 'a1' } }, color: 'red', size: 's' },
      },
    ]);
    expect(wb.strokes).toHaveLength(1);
    expect(wb.strokes[0]!.points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 10 }]);
    expect(wb.strokes[0]!.width).toBe(1.5);
    expect(wb.strokes[0]!.color).toBe('#e5484d');
  });

  it('忽略非支持形状与脏数据（draw 脏点过滤 / 空文本）', () => {
    const wb = tlShapesToWb([
      { type: 'note', x: 0, y: 0, props: {} }, // 便签：暂不持久化
      { type: 'geo', x: 1, y: 2, props: { geo: 'triangle', w: 5, h: 5 } }, // 非矩形/椭圆 geo
      { type: 'text', x: 3, y: 4, props: { text: '   ', color: 'blue' } },
      null,
      { type: 'draw', x: Number.NaN, y: 1, props: {} },
      { type: 'draw', x: 0, y: 0, props: { segments: [{ type: 'free', points: [{ x: 1, y: 2 }, { x: 'bad' }] }], color: 'red', size: 'l' } },
    ]);
    expect(wb.strokes).toHaveLength(1);
    expect(wb.strokes[0]!.color).toBe('#e5484d');
    expect(wb.strokes[0]!.width).toBe(4);
    expect(wb.shapes).toHaveLength(0);
  });
});
