import { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';

/**
 * Mermaid 渲染（ADR-07：独立渲染 + DOMPurify(SVG)）。
 * 主 sanitize 不兼容 SVG，故在此对生成的 SVG 二次净化。
 */
export function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
        const id = 'm' + Math.random().toString(36).slice(2);
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = DOMPurify.sanitize(svg);
        }
      } catch (e) {
        if (ref.current) {
          ref.current.textContent = 'Mermaid 渲染失败：' + String(e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);
  return <div className="mermaid-block" ref={ref} />;
}
