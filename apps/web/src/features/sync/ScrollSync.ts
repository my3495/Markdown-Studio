import type { EditorView } from '@codemirror/view';

interface Anchor {
  line: number;
  /** 相对预览滚动内容原点的像素位置 */
  top: number;
}

/**
 * 滚动同步（方案 9.6 增强版）：
 * - 以预览块 `data-line` 锚点建索引（按行号去重、二分定位）
 * - 锚点间做**像素比例插值**，解决长段落 / 图片导致的上下错位（不再就近吸附）
 * - **驱动锁**：由 wheel/pointer/touch/key 判定当前主动滚动的一侧，250ms 内反向滚动不触发同步，防回声
 * - rAF 单帧节流；MutationObserver + ResizeObserver 在 DOM / 尺寸变化时把索引标记为脏
 * - 索引**按需重建**：连续输入时预览每 140ms 重渲染一次，若每次都重建索引（数百次
 *   getBoundingClientRect）会持续抢占主线程。改成「脏标记 + 真正要同步时才重建」，
 *   打字而不滚动的场景下开销为 0，且滚动时拿到的必定是最新索引。
 */
export class ScrollSync {
  private anchors: Anchor[] = [];
  /** 当前主动滚动的一侧，及其锁定截止时间（performance.now） */
  private driver: 'editor' | 'preview' | null = null;
  private driverUntil = 0;
  private raf = 0;
  /** 预览 DOM/尺寸已变化，锚点可能过期 */
  private dirty = false;
  private observer: MutationObserver | null = null;
  private resizeObs: ResizeObserver | null = null;

  constructor(
    private view: EditorView,
    private previewEl: HTMLElement
  ) {}

  attach() {
    const ed = this.view.scrollDOM;
    const pv = this.previewEl;

    ed.addEventListener('scroll', this.onEditorScroll, { passive: true });
    pv.addEventListener('scroll', this.onPreviewScroll, { passive: true });
    for (const el of [ed, pv]) {
      el.addEventListener('wheel', this.onDriveEditorOrPreview, { passive: true });
      el.addEventListener('pointerdown', this.onDriveEditorOrPreview, { passive: true });
      el.addEventListener('touchstart', this.onDriveEditorOrPreview, { passive: true });
    }
    this.view.dom.addEventListener('keydown', this.onDriveEditor);

    this.observer = new MutationObserver(this.markDirty);
    this.observer.observe(pv, { childList: true, subtree: true });
    // ResizeObserver 在个别环境（旧 Safari / jsdom）缺失：缺了只是少了尺寸变化这一路
    // 脏标记来源，不能让整个同步挂掉
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(this.markDirty);
      this.resizeObs.observe(pv);
    }

    this.buildIndex();
  }

  detach() {
    const ed = this.view.scrollDOM;
    const pv = this.previewEl;
    ed.removeEventListener('scroll', this.onEditorScroll);
    pv.removeEventListener('scroll', this.onPreviewScroll);
    for (const el of [ed, pv]) {
      el.removeEventListener('wheel', this.onDriveEditorOrPreview);
      el.removeEventListener('pointerdown', this.onDriveEditorOrPreview);
      el.removeEventListener('touchstart', this.onDriveEditorOrPreview);
    }
    this.view.dom.removeEventListener('keydown', this.onDriveEditor);
    this.observer?.disconnect();
    this.observer = null;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  buildIndex() {
    // 未挂载时无法测量，保持 dirty，等重新挂载后再建
    if (!this.previewEl.isConnected) return;
    const els = this.previewEl.querySelectorAll<HTMLElement>('[data-line]');
    if (!els.length) {
      this.anchors = [];
      this.dirty = false;
      return;
    }
    // 内容原点（视口坐标）：rect.top - scrollTop
    const origin = this.previewEl.getBoundingClientRect().top - this.previewEl.scrollTop;
    const byLine = new Map<number, number>();
    els.forEach((el) => {
      const line = Number(el.dataset.line);
      if (Number.isNaN(line)) return;
      const top = el.getBoundingClientRect().top - origin;
      const prev = byLine.get(line);
      if (prev === undefined || top < prev) byLine.set(line, top);
    });
    this.anchors = Array.from(byLine, ([line, top]) => ({ line, top })).sort(
      (a, b) => a.line - b.line
    );
    this.dirty = false;
  }

  /** 真正需要同步时才重建索引（避免输入过程中的无谓测量） */
  private ensureIndex() {
    if (this.dirty) this.buildIndex();
  }

  /** 第一个 line >= 目标行的锚点下标 */
  private upperBound(line: number): number {
    let lo = 0;
    let hi = this.anchors.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.anchors[mid].line < line) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** 行号 + 行内比例 → 预览像素位置 */
  private interpPreviewTop(line: number, frac: number): number {
    const a = this.anchors;
    if (line <= a[0].line) return a[0].top;
    const last = a[a.length - 1];
    if (line >= last.line) return last.top;
    const i = this.upperBound(line);
    const hi = a[i];
    const lo = a[i - 1];
    const span = hi.line - lo.line;
    if (span <= 0) return lo.top;
    const t = (line - lo.line) / span;
    const perLine = (hi.top - lo.top) / span;
    return lo.top + (hi.top - lo.top) * t + frac * perLine;
  }

  /** 预览像素位置 → 行号 + 行内比例 */
  private interpLineAt(top: number): { line: number; frac: number } {
    const a = this.anchors;
    if (top <= a[0].top) return { line: a[0].line, frac: 0 };
    const last = a[a.length - 1];
    if (top >= last.top) return { line: last.line, frac: 0 };
    let i = 0;
    while (i + 1 < a.length && a[i + 1].top <= top) i++;
    const lo = a[i];
    const hi = a[Math.min(i + 1, a.length - 1)];
    const dTop = hi.top - lo.top;
    const t = dTop > 0 ? (top - lo.top) / dTop : 0;
    // 夹紧到合法行范围，避免浮点插值在极值处越界
    const maxLine = this.view.state.doc.lines;
    const line = Math.max(1, Math.min(lo.line + (hi.line - lo.line) * t, maxLine));
    return { line, frac: line - Math.floor(line) };
  }

  // ---- 驱动锁 ----
  private markDriver(pane: 'editor' | 'preview') {
    this.driver = pane;
    this.driverUntil = performance.now() + 250;
  }

  private onDriveEditor = () => this.markDriver('editor');

  private onDriveEditorOrPreview = (e: Event) => {
    const target = e.currentTarget as HTMLElement;
    this.markDriver(target === this.previewEl ? 'preview' : 'editor');
  };

  /** 目标侧是否应忽略本次滚动（另一侧正在主动滚动） */
  private blocked(source: 'editor' | 'preview'): boolean {
    return (
      this.driver !== null && this.driver !== source && performance.now() < this.driverUntil
    );
  }

  private markDirty = () => {
    this.dirty = true;
  };

  private onEditorScroll = () => {
    if (this.blocked('editor')) return;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.syncFromEditor();
    });
  };

  private onPreviewScroll = () => {
    if (this.blocked('preview')) return;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.syncFromPreview();
    });
  };

  private syncFromEditor() {
    this.ensureIndex();
    if (!this.anchors.length) return;
    const dom = this.view.scrollDOM;
    const h = Math.max(0, Math.min(dom.scrollTop, this.view.contentHeight - 1));
    const block = this.view.lineBlockAtHeight(h);
    const line = this.view.state.doc.lineAt(block.from).number;
    const frac = block.height > 0 ? Math.min(Math.max((h - block.top) / block.height, 0), 1) : 0;
    this.previewEl.scrollTop = Math.max(0, this.interpPreviewTop(line, frac));
  }

  private syncFromPreview() {
    this.ensureIndex();
    if (!this.anchors.length) return;
    const { line, frac } = this.interpLineAt(this.previewEl.scrollTop);
    const doc = this.view.state.doc;
    const ln = Math.min(Math.max(Math.round(line), 1), doc.lines);
    const block = this.view.lineBlockAt(doc.line(ln).from);
    this.view.scrollDOM.scrollTop = Math.max(0, block.top + frac * block.height);
  }
}
