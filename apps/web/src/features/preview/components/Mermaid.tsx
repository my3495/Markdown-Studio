import { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { useSettings } from '../../../stores/settings';
import { resolveTheme, type ResolvedTheme } from '../../../platform/theme';

/**
 * Mermaid 渲染（ADR-07：独立渲染 + DOMPurify(SVG) 二次净化）。
 *
 * ── 为什么必须显式关闭 htmlLabels（根治「形状在、文字全无」）──
 * mermaid 默认 `htmlLabels: true`，节点标签与边标签不是渲染成 SVG `<text>`，
 * 而是塞进 `<foreignObject><div>…</div></foreignObject>`（HTML 命名空间）。
 * `<foreignObject>` 是已知的 mXSS 载体，DOMPurify 的默认标签白名单**有意排除**它，
 * 于是二次净化把整个 foreignObject 子树连同文字一起移除，只剩 rect/polygon/path
 * 等形状与 marker 箭头 —— 正是「拓扑正确、文本全空」的表现。
 *
 * 修复选择「不让 mermaid 生成 foreignObject」，而不是「给 DOMPurify 放行 foreignObject」：
 * 后者等于为渲染富文本而削弱 ADR-07 的安全边界，且 DOMPurify 对 foreignObject 内
 * HTML 命名空间的净化语义复杂、极易回归。关掉 htmlLabels 后标签改用 SVG 原生
 * `<text>/<tspan>`，本就在默认白名单内，**安全策略一行都不用放宽**。
 *
 * ── 为什么写在根级 htmlLabels ──
 * mermaid 的 getEffectiveHtmlLabels() 取 `config.htmlLabels ?? config.flowchart?.htmlLabels ?? true`，
 * 且官方类型注释明确指出图型级开关（flowchart.htmlLabels 等）已弃用、根级优先
 * （见 mermaid config.type.d.ts）。用根级一处配置即可覆盖 flowchart / class /
 * state / mindmap / kanban 等全部走该判定的图型，避免逐个图型打补丁再次遗漏。
 */
export const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
} as const;

type MermaidApi = typeof import('mermaid').default;

let mermaidApi: MermaidApi | null = null;
/** 已完成 initialize 的主题；mermaid 的配置是全局单例，同主题只需初始化一次 */
let initializedTheme: ResolvedTheme | null = null;

/**
 * 取（必要时初始化）mermaid 单例。
 * 原先每次 useEffect 都调用 initialize：同一文档多个图块会互相覆盖全局配置，
 * 且暗色主题下图仍是浅色底。改为「按主题惰性初始化一次」，并让配图跟随明暗。
 */
async function getMermaid(theme: ResolvedTheme): Promise<MermaidApi> {
  if (!mermaidApi) mermaidApi = (await import('mermaid')).default;
  if (initializedTheme !== theme) {
    mermaidApi.initialize({
      ...MERMAID_CONFIG,
      theme: theme === 'dark' ? 'dark' : 'default',
    });
    initializedTheme = theme;
  }
  return mermaidApi;
}

export function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const themeMode = useSettings((st) => st.theme);
  const resolved = resolveTheme(themeMode);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = await getMermaid(resolved);
        const id = 'm' + Math.random().toString(36).slice(2);
        const { svg } = await mermaid.render(id, code);
        if (cancelled || !ref.current) return;
        // 可观测性兜底：若某图型仍产出 foreignObject（例如 kanban 的逐节点开关
        // 不读全局配置），其文字会被净化剥离。这里显式告警，避免再次静默丢内容。
        if (svg.includes('foreignObject')) {
          console.warn(
            '[mermaid] 输出仍包含 foreignObject：该图型的标签可能被 DOMPurify 移除'
          );
        }
        ref.current.innerHTML = DOMPurify.sanitize(svg);
      } catch (e) {
        if (ref.current) {
          ref.current.textContent = 'Mermaid 渲染失败：' + String(e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, resolved]);

  return <div className="mermaid-block" ref={ref} />;
}
