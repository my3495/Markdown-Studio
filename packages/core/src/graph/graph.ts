/**
 * 笔记知识图谱：节点/边构建 + 确定性力导布局（Fruchterman-Reingold 简化版）。
 * 纯函数、无依赖；布局对同一输入稳定可复现（初始按索引均分圆周）。
 */

import type { LinkGraph } from '../links/wikilinks';

export interface GraphNode {
  id: string;
  label: string;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface NoteGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function buildNoteGraph(
  notes: { id: string; name: string }[],
  graph: LinkGraph
): NoteGraph {
  const nodes: GraphNode[] = notes.map((n) => ({ id: n.id, label: n.name }));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const [from, set] of graph.outgoing) {
    for (const to of set) {
      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: from, target: to });
    }
  }
  return { nodes, edges };
}

export interface LayoutNode extends GraphNode {
  x: number;
  y: number;
}

export interface LayoutOptions {
  iterations?: number;
  width?: number;
  height?: number;
}

/** 确定性力导布局：返回带 x/y 的节点（限定在画布内） */
export function radialLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: LayoutOptions = {}
): LayoutNode[] {
  const width = opts.width ?? 320;
  const height = opts.height ?? 240;
  const n = nodes.length;
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((nd, i) => {
    const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    const r = Math.min(width, height) * 0.36;
    pos.set(nd.id, {
      x: width / 2 + Math.cos(a) * r,
      y: height / 2 + Math.sin(a) * r,
    });
  });
  if (n <= 1) {
    return nodes.map((nd) => ({ ...nd, x: width / 2, y: height / 2 }));
  }
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const iterations = opts.iterations ?? 150;
  const k = Math.sqrt((width * height) / n);
  const disp = nodes.map(() => ({ x: 0, y: 0 }));

  for (let it = 0; it < iterations; it++) {
    for (const d of disp) {
      d.x = 0;
      d.y = 0;
    }
    // 斥力
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(nodes[i].id)!;
        const b = pos.get(nodes[j].id)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = (i - j) * 0.5 + 0.1;
          dy = 0.1;
          d2 = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(d2);
        const force = (k * k) / d2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp[i].x += fx;
        disp[i].y += fy;
        disp[j].x -= fx;
        disp[j].y -= fy;
      }
    }
    // 引力（沿边）
    for (const e of edges) {
      const si = idx.get(e.source);
      const ti = idx.get(e.target);
      if (si == null || ti == null) continue;
      const a = pos.get(e.source)!;
      const b = pos.get(e.target)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      disp[si].x -= fx;
      disp[si].y -= fy;
      disp[ti].x += fx;
      disp[ti].y += fy;
    }
    // 施加位移（冷却 + 边界钳制）
    const t = 1 - it / iterations;
    nodes.forEach((nd, i) => {
      const p = pos.get(nd.id)!;
      p.x += Math.max(-6, Math.min(6, disp[i].x)) * t;
      p.y += Math.max(-6, Math.min(6, disp[i].y)) * t;
      p.x = Math.max(14, Math.min(width - 14, p.x));
      p.y = Math.max(14, Math.min(height - 14, p.y));
    });
  }
  return nodes.map((nd) => {
    const p = pos.get(nd.id)!;
    return { ...nd, x: Math.round(p.x), y: Math.round(p.y) };
  });
}
