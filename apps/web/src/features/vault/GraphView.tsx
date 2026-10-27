import { useCallback, useMemo, useRef, useState } from 'react';
import { radialLayout, type NoteGraph } from '@md-studio/core';
import { useSettings } from '../../stores/settings';
import { t } from '../../i18n';

interface Props {
  graph: NoteGraph;
  activeId: string | null;
  onSelect: (id: string) => void;
  width?: number;
  height?: number;
}

type FilterMode = 'all' | 'connected' | 'orphans';

/** 知识图谱：缩放/平移/拖节点 + 过滤 */
export function GraphView({ graph, activeId, onSelect, width = 220, height = 180 }: Props) {
  const locale = useSettings((st) => st.locale);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [filter, setFilter] = useState<FilterMode>('all');
  const [query, setQuery] = useState('');
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const dragRef = useRef<{
    mode: 'pan' | 'node';
    id?: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);

  const laid = useMemo(
    () => radialLayout(graph.nodes, graph.edges, { width, height }),
    [graph, width, height]
  );

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const n of graph.nodes) d.set(n.id, 0);
    for (const e of graph.edges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [graph]);

  const visibleIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ids = new Set<string>();
    for (const n of graph.nodes) {
      const deg = degree.get(n.id) ?? 0;
      if (filter === 'connected' && deg === 0) continue;
      if (filter === 'orphans' && deg > 0) continue;
      if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) continue;
      ids.add(n.id);
    }
    return ids;
  }, [graph, filter, query, degree]);

  const nodePos = useCallback(
    (id: string, fallback: { x: number; y: number }) => positions[id] ?? fallback,
    [positions]
  );

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const next = Math.min(2.5, Math.max(0.4, scale * (e.deltaY > 0 ? 0.9 : 1.1)));
    setScale(next);
  };

  const onPointerDownBg = (e: React.PointerEvent) => {
    if ((e.target as Element).closest?.('.graph-node')) return;
    dragRef.current = {
      mode: 'pan',
      sx: e.clientX,
      sy: e.clientY,
      ox: pan.x,
      oy: pan.y,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    if (d.mode === 'pan') {
      setPan({ x: d.ox + dx, y: d.oy + dy });
    } else if (d.id) {
      setPositions((prev) => ({
        ...prev,
        [d.id!]: { x: d.ox + dx / scale, y: d.oy + dy / scale },
      }));
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  if (graph.nodes.length === 0) {
    return <div className="vault-empty">{t(locale, 'graphEmpty')}</div>;
  }

  return (
    <div className="graph-wrap">
      <div className="graph-toolbar">
        <select
          className="ui-select graph-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterMode)}
          title={t(locale, 'graphFilter')}
        >
          <option value="all">{t(locale, 'graphAll')}</option>
          <option value="connected">{t(locale, 'graphConnected')}</option>
          <option value="orphans">{t(locale, 'graphOrphans')}</option>
        </select>
        <input
          className="ui-input graph-filter-q"
          placeholder={t(locale, 'graphFilterPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="file-tree-btn" title={t(locale, 'graphReset')} onClick={() => {
          setScale(1);
          setPan({ x: 0, y: 0 });
          setPositions({});
        }}>
          ↺
        </button>
      </div>
      <svg
        className="graph"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onWheel={onWheel}
        onPointerDown={onPointerDownBg}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
          {graph.edges.map((e, i) => {
            if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return null;
            const a0 = laid.find((n) => n.id === e.source);
            const b0 = laid.find((n) => n.id === e.target);
            if (!a0 || !b0) return null;
            const a = nodePos(e.source, a0);
            const b = nodePos(e.target, b0);
            return (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="graph-edge" />
            );
          })}
          {laid.map((n) => {
            if (!visibleIds.has(n.id)) return null;
            const p = nodePos(n.id, n);
            return (
              <g
                key={n.id}
                className={`graph-node ${n.id === activeId ? 'active' : ''}`}
                transform={`translate(${p.x} ${p.y})`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = {
                    mode: 'node',
                    id: n.id,
                    sx: e.clientX,
                    sy: e.clientY,
                    ox: p.x,
                    oy: p.y,
                    moved: false,
                  };
                  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  const d = dragRef.current;
                  const moved = d?.moved;
                  dragRef.current = null;
                  if (!moved) onSelect(n.id);
                }}
              >
                <circle cx={0} cy={0} r={9} />
                <text x={0} y={21} textAnchor="middle" className="graph-label">
                  {n.label.replace(/\.md$/i, '')}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
