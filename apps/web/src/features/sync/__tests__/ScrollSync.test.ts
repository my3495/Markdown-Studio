/**
 * ScrollSync 回归：锚点索引与「脏标记 + 按需重建」。
 *
 * jsdom 没有真实排版，这里给预览子元素的 getBoundingClientRect 打桩，
 * 使锚点位置可控（第 n 行 → top = n * LINE_H）。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScrollSync } from '../ScrollSync';
import type { EditorView } from '@codemirror/view';

const LINE_H = 20;
const LINES = 5;

function makePreview(parent: HTMLElement): HTMLElement {
  const pv = document.createElement('div');
  Object.defineProperty(pv, 'getBoundingClientRect', {
    value: () => ({ top: 0, left: 0, width: 400, height: 200, bottom: 200, right: 400 }),
  });
  for (let n = 1; n <= LINES; n++) {
    const el = document.createElement('div');
    el.setAttribute('data-line', String(n));
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ top: n * LINE_H, left: 0, width: 400, height: LINE_H, bottom: (n + 1) * LINE_H, right: 400 }),
    });
    pv.appendChild(el);
  }
  parent.appendChild(pv);
  return pv;
}

function makeView(parent: HTMLElement): { view: EditorView; scrollDOM: HTMLElement } {
  const scrollDOM = document.createElement('div');
  const dom = document.createElement('div');
  parent.appendChild(scrollDOM);
  parent.appendChild(dom);

  const lineBlock = (n: number) => ({ from: n - 1, to: n, top: (n - 1) * LINE_H, height: LINE_H });
  const view = {
    scrollDOM,
    dom,
    contentHeight: LINES * LINE_H,
    state: {
      doc: {
        lines: LINES,
        lineAt: (pos: number) => ({ number: pos + 1, from: pos, to: pos + 1 }),
        line: (n: number) => ({ number: n, from: n - 1, to: n }),
      },
    },
    lineBlockAtHeight: (h: number) => {
      const n = Math.min(LINES, Math.max(1, Math.floor(h / LINE_H) + 1));
      return lineBlock(n);
    },
    lineBlockAt: (pos: number) => lineBlock(pos + 1),
  } as unknown as EditorView;

  return { view, scrollDOM };
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

let host: HTMLElement | null = null;

function setup() {
  host = document.createElement('div');
  document.body.appendChild(host);
  const { view, scrollDOM } = makeView(host);
  const previewEl = makePreview(host);
  const sync = new ScrollSync(view, previewEl);
  sync.attach();
  return { sync, scrollDOM, previewEl };
}

afterEach(() => {
  host?.remove();
  host = null;
});

describe('ScrollSync 索引与同步', () => {
  it('编辑器滚动 → 预览按锚点插值定位（同一行内按比例）', async () => {
    const { sync, scrollDOM, previewEl } = setup();
    sync.buildIndex();

    // 编辑器滚到 50px：落在第 3 行（top=40, height=20），行内比例 0.5
    scrollDOM.scrollTop = 50;
    scrollDOM.dispatchEvent(new Event('scroll'));
    await nextFrame();

    // 锚点：line3→60、line2→40；插值 40 + 20*1 + 0.5*20 = 70
    expect(previewEl.scrollTop).toBe(70);
  });

  it('索引无脏标记时滚动不会重建（打字过程中零测量开销）', async () => {
    const { sync, scrollDOM, previewEl } = setup();
    sync.buildIndex();
    const spy = vi.spyOn(sync, 'buildIndex');

    scrollDOM.scrollTop = 20;
    scrollDOM.dispatchEvent(new Event('scroll'));
    await nextFrame();
    expect(spy).toHaveBeenCalledTimes(0);
    expect(previewEl.scrollTop).toBeGreaterThan(0);

    // 预览 DOM 变化 → 打脏 → 下一次同步前重建一次
    previewEl.appendChild(document.createElement('p'));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    scrollDOM.scrollTop = 40;
    scrollDOM.dispatchEvent(new Event('scroll'));
    await nextFrame();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('未挂载的预览不会因测量而抛错', () => {
    const { sync, previewEl } = setup();
    sync.detach();
    previewEl.remove();
    expect(() => sync.buildIndex()).not.toThrow();
  });
});
