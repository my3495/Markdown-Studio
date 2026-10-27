import { describe, it, expect } from 'vitest';
import {
  ensureIds,
  parseTldrawFence,
  replaceTldrawFence,
  serializeTldrawFence,
} from '../src/whiteboard/tldraw-fence';

describe('tldraw fence', () => {
  it('parse / serialize', () => {
    const doc = parseTldrawFence(
      JSON.stringify({
        v: 1,
        strokes: [{ color: '#000', width: 2, points: [{ x: 1, y: 2 }] }],
        shapes: [
          { type: 'rect', x: 10, y: 20, w: 40, h: 30, color: '#f00' },
          { type: 'text', x: 5, y: 8, text: 'Hi', color: '#000' },
        ],
      })
    );
    expect(doc.strokes).toHaveLength(1);
    expect(doc.shapes).toHaveLength(2);
    expect(serializeTldrawFence(doc)).toContain('"shapes"');
  });

  it('replace 第 0 个围栏', () => {
    const md = '# A\n\n```tldraw\n{}\n```\n\ntext\n';
    const next = replaceTldrawFence(md, 0, '{"v":1,"strokes":[]}');
    expect(next).toContain('{"v":1,"strokes":[]}');
  });

  it('新形状类型：ellipse / arrow', () => {
    const doc = parseTldrawFence(
      JSON.stringify({
        v: 1,
        strokes: [],
        shapes: [
          { type: 'ellipse', x: 1, y: 2, w: 30, h: 20, color: '#0f0' },
          { type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10, color: '#00f' },
        ],
      })
    );
    const shapes = doc.shapes ?? [];
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toMatchObject({ type: 'ellipse', w: 30 });
    expect(shapes[1]).toMatchObject({ type: 'arrow', x2: 10, y2: 10 });
    const round = parseTldrawFence(serializeTldrawFence(doc));
    expect(round.shapes ?? []).toEqual(shapes);
  });

  it('非法形状被过滤（缺字段/未知类型/NaN）', () => {
    const doc = parseTldrawFence(
      JSON.stringify({
        v: 1,
        strokes: [],
        shapes: [
          { type: 'ellipse', x: 1, y: 2, w: 30, color: '#0f0' }, // 缺 h
          { type: 'arrow', x1: 0, y1: 0, x2: 'x', y2: 1, color: '#00f' }, // 非数字
          { type: 'star', x: 0, y: 0 }, // 未知类型
          { type: 'rect', x: 1, y: 2, w: 3, h: 4, color: '#111' }, // 合法
        ],
      })
    );
    expect(doc.shapes ?? []).toHaveLength(1);
    expect((doc.shapes ?? [])[0]).toMatchObject({ type: 'rect' });
  });

  it('空 / 坏 JSON 安全回落', () => {
    expect(parseTldrawFence('')).toEqual({ v: 1, strokes: [], shapes: [] });
    expect(parseTldrawFence('{bad json')).toEqual({ v: 1, strokes: [], shapes: [] });
    expect(parseTldrawFence('{"v":2}')).toEqual({ v: 1, strokes: [], shapes: [] });
  });

  it('id 保留 / 非法 id 丢弃 / ensureIds 确定性', () => {
    const withId = parseTldrawFence(
      JSON.stringify({
        v: 1,
        strokes: [{ id: 's0', color: '#000', width: 2, points: [{ x: 1, y: 2 }] }],
        shapes: [
          { id: 'rect0', type: 'rect', x: 1, y: 2, w: 3, h: 4, color: '#111' },
          { id: 123, type: 'text', x: 0, y: 0, text: 'x', color: '#111' },
        ],
      })
    );
    expect(withId.strokes[0]!.id).toBe('s0');
    const shapes = withId.shapes ?? [];
    expect(shapes[0]!.id).toBe('rect0');
    expect(shapes[1]!.id).toBeUndefined();

    const ensured = ensureIds({
      v: 1,
      strokes: [{ color: '#000', width: 2, points: [{ x: 0, y: 0 }] }],
      shapes: [{ type: 'rect', x: 0, y: 0, w: 1, h: 1, color: '#000' }],
    });
    expect(ensured.strokes[0]!.id).toBe('s0');
    expect((ensured.shapes ?? [])[0]!.id).toBe('rect0');
    // 幂等：已有 id 不再变更
    expect(ensureIds(ensured)).toEqual(ensured);
  });

  it('旧无 id fence 往返后值不变且不新增 id 字段', () => {
    const legacy = {
      v: 1 as const,
      strokes: [{ color: '#000', width: 2, points: [{ x: 1, y: 2 }] }],
      shapes: [{ type: 'rect' as const, x: 1, y: 2, w: 3, h: 4, color: '#111' }],
    };
    const round = parseTldrawFence(serializeTldrawFence(legacy));
    expect(round).toEqual(legacy);
    expect(serializeTldrawFence(round)).not.toContain('"id"');
  });
});
