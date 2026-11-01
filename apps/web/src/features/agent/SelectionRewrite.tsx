import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyRewrite,
  buildRewriteMessages,
  contextAround,
  detectInputLang,
  locateSelection,
  parseRewriteReply,
  streamChat,
  type FetchLike,
  type LocateResult,
  type RewriteLang,
} from '@md-studio/core';
import { useSettings } from '../../stores/settings';
import { toast } from '../../stores/toast';
import { t, type Locale } from '../../i18n';
import { flushEditor } from '../editor/flush';
import { Icon } from '../../components/Icon';
import { RewriteConfirmDialog } from './RewriteConfirmDialog';

interface Props {
  /** 预览滚动容器（.app-preview）；只响应该容器内的文本选区 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 读取当前活动文档正文（用 store.getState，避免闭包过期） */
  getContent: () => string;
  /** 应用改写后的整篇正文（由调用方写回 store） */
  onApply: (next: string) => void;
}

/** 选区快照：发起请求后正文可能被改动，因此先把坐标与文本定下来 */
interface CapturedSelection {
  text: string;
  x: number;
  y: number;
  below: boolean;
  lineHint?: number;
}

interface Proposal {
  located: LocateResult;
  /** 发起请求时的正文快照；用于应用前判断「期间是否被改动过」 */
  base: string;
  next: string;
  /** 与用户指令语言一致的展示语言 */
  locale: Locale;
  instruction: string;
}

type Phase = 'hidden' | 'bubble' | 'input' | 'running' | 'confirm';

/** 指令语言 → 界面语言：保证「提示语言与用户输入语言一致」 */
function localeOf(lang: RewriteLang): Locale {
  if (lang === 'zh') return 'zh-CN';
  if (lang === 'ja') return 'ja';
  return 'en';
}

/**
 * 选中文字 → Agent 改写（预览区）。
 *
 * 流程：选中文字 → 气泡「让 Agent 修改」→ 输入指令 → 定位映射到正文区间
 * → 调模型生成 → 词级 diff 弹窗 → 接受则写回正文，拒绝则原样不动。
 * 任何一步失败都不改正文，并给出与输入语言一致的提示。
 */
export function SelectionRewrite({ containerRef, getContent, onApply }: Props) {
  const locale = useSettings((s) => s.locale);
  const agent = useSettings((s) => s.agent);
  const [sel, setSel] = useState<CapturedSelection | null>(null);
  const [phase, setPhase] = useState<Phase>('hidden');
  const [instruction, setInstruction] = useState('');
  const [lang, setLang] = useState<RewriteLang | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 阶段镜像：mouseup 后的延时捕获要读「当前阶段」，闭包里的 phase 会过期 */
  const phaseRef = useRef<Phase>('hidden');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // 用户已下过指令后，提示一律用指令语言；否则用界面语言
  const ui: Locale = lang ? localeOf(lang) : locale;

  const close = useCallback(() => {
    abortRef.current?.abort('rw_close');
    abortRef.current = null;
    setSel(null);
    setProposal(null);
    setInstruction('');
    setLang(null);
    setPhase('hidden');
  }, []);

  const capture = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // 已经展开到「输入指令 / 生成中 / 确认」时不重新判定选区：
    // 点输入框会把预览里的文档选区折叠掉，若照常判定就会被当成「没有选区」而自我收起。
    const busy =
      phaseRef.current === 'input' || phaseRef.current === 'running' || phaseRef.current === 'confirm';
    const drop = () => {
      if (busy) return;
      setSel(null);
      setPhase('hidden');
    };
    const s = window.getSelection();
    if (!s || s.isCollapsed || s.rangeCount === 0) {
      drop();
      return;
    }
    const range = s.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) {
      drop();
      return;
    }
    const text = s.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) {
      drop();
      return;
    }
    // 非布局环境（jsdom）没有实现 getBoundingClientRect：取不到时按 0 处理，仅影响气泡坐标
    const rect =
      typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
    // 预览块级元素带 data-line（源码行号），用它做多处命中时的择优线索
    const node = range.startContainer;
    const host = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const holder = host ? host.closest('[data-line]') : null;
    const lineHint = Number(holder?.getAttribute('data-line') ?? 0) || undefined;
    const below = !!rect && rect.top < 64;
    setSel({
      text,
      x: rect ? rect.left + rect.width / 2 : 0,
      y: rect ? (below ? rect.bottom + 8 : rect.top - 8) : 0,
      below,
      lineHint,
    });
    // 已在进行中的流程不被新的选区打断
    setPhase((p) => (p === 'hidden' || p === 'bubble' ? 'bubble' : p));
  }, [containerRef]);

  // 选区监听：拖选停顿 150ms 后浮出气泡；滚动/失焦/点击别处即收起
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const locked = phase === 'running' || phase === 'confirm';
    let timer = 0;
    const hide = () => {
      window.clearTimeout(timer);
      if (locked) return;
      setSel(null);
      setPhase('hidden');
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(capture, 150);
    };
    const onMouseDown = (e: MouseEvent) => {
      // 用 class 判断而不是 ref：气泡与指令面板互斥挂载，共用一个 ref 时
      // detach(null) / attach(node) 的先后顺序不可靠，会把「点输入框」误判成「点别处」。
      const target = e.target as Element | null;
      if (target?.closest?.('.rw-bubble, .rw-panel')) return;
      hide();
    };
    el.addEventListener('mouseup', schedule);
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('mouseup', schedule);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('scroll', hide);
      window.removeEventListener('blur', hide);
    };
  }, [containerRef, phase, capture]);

  const run = useCallback(
    async (raw: string) => {
      const captured = sel;
      const text = raw.trim();
      if (!captured || !text) return;
      const content = getContent();
      if (!content) return;

      // 1) 定位映射：把预览选中的文字映射回正文区间
      const located = locateSelection(content, captured.text, {
        lineHint: captured.lineHint,
      });
      if (!located) {
        toast(t(locale, 'rwLocateFailed'), { tone: 'danger' });
        close();
        return;
      }
      if (!agent.model) {
        toast(t(locale, 'rwNoModel'), { tone: 'danger' });
        return;
      }

      // 2) 语言一致性：指令是中文就用中文提示，英文就用英文
      const l = detectInputLang(text);
      setLang(l);
      const uiLocale = localeOf(l);
      setPhase('running');

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const fetchImpl: FetchLike = (url, init) =>
        fetch(url, { ...init, signal: ctrl.signal }).then((res) => ({
          ok: res.ok,
          status: res.status,
          body: res.body,
        }));
      const ctx = contextAround(content, located.range);

      try {
        let reply = '';
        for await (const piece of streamChat(
          { provider: agent.provider, apiKey: agent.apiKey, model: agent.model },
          {
            messages: buildRewriteMessages({
              lang: l,
              instruction: text,
              target: located.text,
              before: ctx.before,
              after: ctx.after,
            }),
            stream: true,
            temperature: 0.3,
          },
          fetchImpl
        )) {
          reply += piece;
        }
        if (ctrl.signal.aborted) return;
        const next = parseRewriteReply(reply);
        if (!next) {
          toast(t(uiLocale, 'rwEmptyReply'), { tone: 'danger' });
          setPhase('input');
          return;
        }
        if (next === located.text) {
          toast(t(uiLocale, 'rwUnchanged'), { tone: 'info' });
          setPhase('input');
          return;
        }
        // 3) 生成 diff 并请求确认
        setProposal({ located, base: content, next, locale: uiLocale, instruction: text });
        setPhase('confirm');
      } catch (e) {
        if (ctrl.signal.aborted) return;
        toast(t(uiLocale, 'rwFailed').replace('{msg}', e instanceof Error ? e.message : String(e)), {
          tone: 'danger',
        });
        setPhase('input');
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [agent.apiKey, agent.model, agent.provider, close, getContent, locale, sel]
  );

  const accept = useCallback(() => {
    const p = proposal;
    if (!p) return;
    // 编辑器输入是 150ms 防抖的，直接改正文会先被旧文本覆盖
    flushEditor();
    const cur = getContent();
    // 生成期间正文若被改动过，按原文重新定位一次，避免改到别处
    const located =
      cur === p.base
        ? p.located
        : locateSelection(cur, p.located.text, { lineHint: p.located.line });
    if (!located) {
      toast(t(p.locale, 'rwLocateFailed'), { tone: 'danger' });
      close();
      return;
    }
    onApply(applyRewrite(cur, located.range, p.next).content);
    toast(t(p.locale, 'rwApplied'));
    close();
  }, [close, getContent, onApply, proposal]);

  const reject = useCallback(() => {
    if (proposal) toast(t(proposal.locale, 'rwRejected'));
    close();
  }, [close, proposal]);

  const regenerate = useCallback(() => {
    const p = proposal;
    setProposal(null);
    setPhase('input');
    if (p) void run(p.instruction);
  }, [proposal, run]);

  if (!sel && phase !== 'confirm') return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;

  return (
    <>
      {sel && phase === 'bubble' && (
        <div
          className="rw-bubble"

          style={{
            left: Math.min(Math.max(sel.x, 120), Math.max(120, vw - 120)),
            top: sel.y,
            transform: sel.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
          onMouseDown={(e) => e.preventDefault()}
          role="toolbar"
          aria-label={t(locale, 'rwAsk')}
        >
          <button
            type="button"
            className="rw-bubble-main"
            title={t(locale, 'rwAskHint')}
            onClick={() => setPhase('input')}
          >
            <Icon name="pen" size={14} />
            <span>{t(locale, 'rwAsk')}</span>
          </button>
          <span className="rw-bubble-meta">
            {t(locale, 'rwSelectionChars').replace('{n}', String(sel.text.length))}
          </span>
        </div>
      )}

      {sel && (phase === 'input' || phase === 'running') && (
        <div
          className="rw-panel"

          style={{
            left: Math.min(Math.max(sel.x, 190), Math.max(190, vw - 190)),
            top: sel.y,
            transform: sel.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="rw-panel-head">
            <Icon name="pen" size={14} />
            <span>{t(ui, 'rwAsk')}</span>
          </div>
          <blockquote className="rw-quote">
            {sel.text.length > 60 ? `${sel.text.slice(0, 60)}…` : sel.text}
          </blockquote>
          <textarea
            className="rw-input"
            value={instruction}
            rows={2}
            autoFocus
            placeholder={t(ui, 'rwPlaceholder')}
            aria-label={t(ui, 'rwPlaceholder')}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (instruction.trim() && phase === 'input') void run(instruction);
              }
            }}
          />
          <div className="rw-panel-actions">
            <button type="button" className="ui-btn" onClick={close}>
              {t(ui, 'rwCancel')}
            </button>
            <button
              type="button"
              className="ui-btn primary"
              disabled={phase === 'running' || !instruction.trim()}
              onClick={() => void run(instruction)}
            >
              {phase === 'running' ? t(ui, 'rwGenerating') : t(ui, 'rwSubmit')}
            </button>
          </div>
        </div>
      )}

      {phase === 'confirm' && proposal && (
        <RewriteConfirmDialog
          locale={proposal.locale}
          before={proposal.located.text}
          after={proposal.next}
          line={proposal.located.line}
          confidence={proposal.located.confidence}
          ambiguous={proposal.located.ambiguous}
          candidates={proposal.located.candidates}
          onAccept={accept}
          onReject={reject}
          onRegenerate={regenerate}
        />
      )}
    </>
  );
}
