import { useEffect, useMemo, useRef, useState } from 'react';
import { typedOutgoing } from '@md-studio/core';
import { useVault } from '../../stores/vault';
import { useDocuments } from '../../stores/document';
import { useSettings } from '../../stores/settings';
import { GraphView } from './GraphView';
import { t } from '../../i18n';

interface Props {
  /**
   * side：侧栏内嵌（默认，画布 220×180）
   * main：主显示区面板（画布自适应填满，关系列表移到右列）
   */
  variant?: 'side' | 'main';
}

/** 图谱：反链 / 出链 / 类型化关系 / 关系图（侧栏内嵌或主区面板） */
export function VaultGraph({ variant = 'side' }: Props) {
  const { notes, graph, openByName, openByPath, vault, persisted } = useVault();
  const docs = useDocuments();
  const { locale } = useSettings();
  const activeId = docs.activeId;

  const backlinks = useMemo(
    () => (activeId ? vault.backlinks(activeId) : []),
    [activeId, vault, graph]
  );
  const outgoing = useMemo(
    () => (activeId ? vault.outgoingLinks(activeId) : []),
    [activeId, vault, graph]
  );
  const typedLinks = useMemo(() => {
    const n = activeId ? vault.get(activeId) : null;
    return n ? typedOutgoing(n) : [];
  }, [activeId, vault, notes]);

  const openById = (id: string) => {
    if (persisted) openByPath(id);
    else {
      const n = vault.get(id);
      if (n) openByName(n.name);
    }
  };

  // 主区模式下画布跟随容器尺寸（侧栏模式沿用 GraphView 的固定 220×180）
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 760, h: 520 });
  useEffect(() => {
    if (variant !== 'main') return;
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // 减去图内工具条（26px）+ 间距/边框，避免画布把容器撑出滚动条
      setSize({ w: Math.max(260, Math.round(r.width) - 2), h: Math.max(220, Math.round(r.height) - 38) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [variant]);

  const links = (
    <>
      {backlinks.length > 0 && (
        <>
          <h5>
            {t(locale, 'backlinks')} ({backlinks.length})
          </h5>
          {backlinks.map((n) => (
            <div
              key={n.id}
              className="outline-item"
              onClick={() => (persisted ? openByPath(n.id) : openByName(n.name))}
            >
              {n.name}
            </div>
          ))}
        </>
      )}

      {outgoing.length > 0 && (
        <>
          <h5>
            {t(locale, 'outgoing')} ({outgoing.length})
          </h5>
          {outgoing.map((n) => (
            <div
              key={n.id}
              className="outline-item"
              onClick={() => (persisted ? openByPath(n.id) : openByName(n.name))}
            >
              {n.name}
            </div>
          ))}
        </>
      )}

      {typedLinks.length > 0 && (
        <>
          <h5>
            {t(locale, 'typedLinks')} ({typedLinks.length})
          </h5>
          {typedLinks.map((l, i) => (
            <div
              key={`${l.field}-${l.target}-${i}`}
              className="outline-item"
              onClick={() => openByName(l.target)}
              title={l.field}
            >
              <span className="vault-via fts">{l.field}</span> {l.target}
            </div>
          ))}
        </>
      )}

      {variant === 'main' && backlinks.length === 0 && outgoing.length === 0 && typedLinks.length === 0 && (
        <p className="vault-empty">{t(locale, 'graphHint')}</p>
      )}
    </>
  );

  if (variant === 'main') {
    return (
      <div className="graph-main">
        <div className="graph-canvas-wrap" ref={canvasRef}>
          <GraphView
            graph={graph}
            activeId={activeId}
            onSelect={openById}
            width={size.w}
            height={size.h}
          />
        </div>
        <aside className="graph-side">{links}</aside>
      </div>
    );
  }

  return (
    <div className="side-section vault-panel">
      {links}
      <h5>{t(locale, 'graph')}</h5>
      <GraphView graph={graph} activeId={activeId} onSelect={openById} />
      {!activeId && backlinks.length === 0 && outgoing.length === 0 && (
        <p className="vault-empty">{t(locale, 'graphHint')}</p>
      )}
    </div>
  );
}
