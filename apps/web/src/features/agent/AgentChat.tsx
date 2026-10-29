import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSandboxSession,
  createVaultTools,
  isAbortError,
  runAgent,
  runToolAgent,
  type LlmTraceStep,
  type PendingChange,
  type SandboxSession,
} from '@md-studio/core';
import { useVault } from '../../stores/vault';
import { useSettings } from '../../stores/settings';
import { useDocuments } from '../../stores/document';
import { useTokenUsage } from '../../stores/tokenUsage';
import { useUi } from '../../stores/ui';
import { useOllama } from '../../stores/ollama';
import { useRecipes } from '../../stores/recipes';
import { useAgentSessions, type SessionMessage } from '../../stores/agentSessions';
import { RECIPE_PROMPT_KEY } from '../../platform/recipes/runner';
import { Icon } from '../../components/Icon';
import { flushEditor } from '../editor/flush';
import { t } from '../../i18n';
import { toast } from '../../stores/toast';
import {
  MAX_ATTACH_BYTES,
  MAX_ATTACH_FILES,
  agentConnStatus,
  buildHistory,
  buildInsertBlock,
  composeModelPrompt,
  eventTraceStep,
  excerptFor,
  fmtSize,
  isTextFile,
  localizeToolName,
  lookupLocalized,
  modelSuggestions,
  sandboxOpToTool,
} from './agentChatUtils';

/**
 * 「未配置 LLM 时的本地兜底」专用 tool 名翻译（与 core 工具名无对应）
 *
 * 用 lookupLocalized 同套 fallback 链（zh-CN → en → 原 key）保证：
 * - 中文表命中：用之
 * - 英文表命中：用之（兜底）
 * - 都没命中：原 key 透传（让 UI 安全显示未知 id 而不抛错）
 */
const HINT_LOCAL_HITS = 'local-hits';
const HINT_NOT_FOUND = 'not-found';
const HINTS_EN: Record<string, string> = {
  [HINT_LOCAL_HITS]: 'relevant notes',
  [HINT_NOT_FOUND]: 'not found',
};
const HINTS_ZH: Record<string, string> = {
  [HINT_LOCAL_HITS]: '条相关笔记',
  [HINT_NOT_FOUND]: '未找到',
};
const HINTS_JA: Record<string, string> = {
  [HINT_LOCAL_HITS]: '件の関連ノート',
  [HINT_NOT_FOUND]: '見つかりません',
};
function hintText(key: string, locale: string, count?: number): string {
  const str = lookupLocalized(
    { en: HINTS_EN, 'zh-CN': HINTS_ZH, ja: HINTS_JA },
    key,
    locale as 'zh-CN' | 'en' | 'ja'
  );
  if (key === HINT_LOCAL_HITS && typeof count === 'number') return `${count} ${str}`;
  return str;
}

/** ChatMessage 复用 SessionMessage 的形状（stores/agentSessions 拥有真源） */
type ChatMessage = SessionMessage;

interface AgentAttachmentLocal {
  id: string;
  name: string;
  size: number;
  text: string;
}

let seq = 0;
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `m-${Date.now()}-${seq++}`;

/**
 * 右侧栏 Agent 对话：先检索知识库（VaultTools）注入上下文，再流式生成（Ollama/OpenAI 兼容）。
 * 未配置 LLM 时回退为本地检索作答。多轮消息持续留在右栏，主区不被遮挡。
 *
 * 可用性细节：
 * - 流式生成中按 Esc 中断（立即 abort 当前请求，按钮自动转为 Send）
 * - aria-busy 反映生成中状态，供读屏器识别
 * - 工具名 / 本地检索文案本地化
 * - 「插入笔记」只取最终回答（不含 preamble）
 */
export function AgentChat({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const docs = useDocuments();
  const { vault, refreshNotes } = useVault();
  const tokens = useTokenUsage();
  const openPanel = useUi((st) => st.openPanel);
  const ollamaStatus = useOllama((st) => st.status);
  const ollamaBaseUrl = useOllama((st) => st.baseUrl);
  const checkOllama = useOllama((st) => st.check);

  // —— 多会话数据源：从 useAgentSessions 派生 ——
  const activeId = useAgentSessions((st) => st.activeId);
  const messages = useAgentSessions((st) => (st.activeId ? st.sessions[st.activeId]?.messages ?? [] : []));
  const appendSessionMessage = useAgentSessions((st) => st.appendMessage);
  const patchSessionMessage = useAgentSessions((st) => st.patchMessage);
  const truncateAfterSession = useAgentSessions((st) => st.truncateAfter);
  const ensureSession = useAgentSessions((st) => st.createSession);

  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  /** 输入区整体高度自增（用 ref 直接撑 textarea）；用 inline style 即可，不进 store。 */
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [useTools, setUseTools] = useState(true);
  const [pending, setPending] = useState<PendingChange[]>([]);
  /** 主模式（plan/build/agent）→ useTools + allowWrite 的单向同步。
   * 手动设 useTools 时也会"反向"覆盖：比如用户关掉 useTools，自动降回 plan 模式。 */
  useEffect(() => {
    if (busy) return; // 运行中不切换，避免半路改 prompt
    const mode = s.agentMode;
    const wantTools = mode !== 'plan';
    const wantWrite = mode === 'build';
    if (useTools !== wantTools) setUseTools(wantTools);
    if (s.agent.allowWrite !== wantWrite) s.setAgent({ allowWrite: wantWrite });
    // 故意只依赖 mode：useTools/allowWrite 是受控项，再依赖会循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.agentMode]);
  /** 正在编辑的 user 消息 id（用于「编辑后重发」内联编辑器） */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  /** 二次确认 Token 清零：单击先标记为「待确认」，2s 内再点才真清空（防误操作） */
  const [tokenClearArmed, setTokenClearArmed] = useState(false);
  const tokenClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTokenClear = () => {
    if (tokenClearArmed) {
      tokens.clear();
      if (tokenClearTimerRef.current) clearTimeout(tokenClearTimerRef.current);
      tokenClearTimerRef.current = null;
      setTokenClearArmed(false);
      return;
    }
    setTokenClearArmed(true);
    tokenClearTimerRef.current = setTimeout(() => {
      setTokenClearArmed(false);
      tokenClearTimerRef.current = null;
    }, 2000);
  };
  // 卸载时清掉 pending timer
  useEffect(() => {
    return () => {
      if (tokenClearTimerRef.current) clearTimeout(tokenClearTimerRef.current);
    };
  }, []);

  // 用 ref 持有当前请求的 AbortController，以便在异步回调中按 Esc 时取消
  const abortRef = useRef<AbortController | null>(null);
  const sandboxRef = useRef<SandboxSession | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<AgentAttachmentLocal[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // sessionStorage 是「面板关闭期间 recipes 触发」的恢复兜底；
    // 加 5 分钟时间戳防止旧残留（页面长期不关时 prompt 仍有效）。
    try {
      const raw = sessionStorage.getItem(RECIPE_PROMPT_KEY);
      if (!raw) return;
      const { prompt, ts } = JSON.parse(raw) as { prompt: string; ts: number };
      if (Date.now() - ts < 5 * 60 * 1000) {
        setPrompt(prompt);
        sessionStorage.removeItem(RECIPE_PROMPT_KEY);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // 常驻右栏：recipes 触发后实时预填提示词（不再依赖面板重新挂载）
  const pendingPrompt = useRecipes((st) => st.pendingPrompt);
  const setPendingPrompt = useRecipes((st) => st.setPendingPrompt);
  useEffect(() => {
    if (!pendingPrompt) return;
    setPrompt(pendingPrompt);
    setPendingPrompt(null);
  }, [pendingPrompt, setPendingPrompt]);

  // 新消息 / 流式增量时贴底
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  // Esc 在面板内触发中断；改由下方统一 useEffect 接管（含 Enter→stop 与卸载 dispose）

  const canLlm = !!s.agent.model && (s.agent.provider === 'ollama' || !!s.agent.apiKey);
  const isOllama = s.agent.provider === 'ollama';

  // Ollama：选中即自动探测连通性；窗口重新聚焦时复检
  useEffect(() => {
    if (!isOllama) return;
    void checkOllama();
    const onFocus = () => {
      if (useSettings.getState().agent.provider === 'ollama') void checkOllama();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isOllama, checkOllama]);

  const conn = agentConnStatus({
    provider: s.agent.provider,
    model: s.agent.model,
    apiKey: s.agent.apiKey,
    ollamaStatus: ollamaStatus,
    locale: s.locale,
  });
  const connDot = conn.dot;
  const connTitle = conn.title;

  const llmCfg = () => ({
    provider: s.agent.provider,
    apiKey: s.agent.apiKey,
    model: s.agent.model,
  });

  const syncPending = () => setPending(sandboxRef.current?.pending() ?? []);

  /** 就地更新一条消息（由 store 处理） */
  const patch = (id: string, fn: (m: ChatMessage) => ChatMessage) =>
    patchSessionMessage(id, (m) => fn(m));

  const retrieve = (q: string) => {
    const tools = createVaultTools(vault, { allowWrite: false });
    const steps: LlmTraceStep[] = [];
    const search = tools.search({ query: q, limit: 5 });
    const hits = (search.data ?? []) as { id: string; name: string; score: number }[];
    steps.push({
      tool: 'search',
      ok: search.ok,
      summary: hintText(HINT_LOCAL_HITS, s.locale, hits.length),
    });

    const terms = q.split(/\s+/).filter(Boolean);
    const parts: string[] = [];
    for (const meta of hits.slice(0, 3)) {
      const r = tools.read_note({ id: meta.id });
      const note = r.data?.note;
      steps.push({
        tool: 'read_note',
        ok: r.ok,
        summary: note ? note.name : hintText(HINT_NOT_FOUND, s.locale),
      });
      if (note) {
        // 复用 core/tools.ts 的 excerptFor（与 VaultTools 对齐，避免重复实现）
        const excerpt = excerptFor(note.content, terms.join(' '), 160);
        parts.push(`### ${note.name}\n${excerpt}`);
      }
    }
    return { context: parts.join('\n\n'), trace: steps };
  };

  /** 读取所选附件（仅文本类；受个数与单文件体积限制） */
  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_ATTACH_FILES - attachments.length;
    if (room <= 0) {
      toast(t(s.locale, 'agentAttachLimit').replace('{max}', String(MAX_ATTACH_FILES)), {
        tone: 'danger',
      });
      return;
    }
    // 用「name + size」做软去重：同名同体积大概率是同一文件；同 name 但不同 size 视为新文件
    const seen = new Set(attachments.map((a) => `${a.name}:${a.size}`));
    // 第一遍：只做校验，收集合法文件元信息
    const candidates: { f: File; sig: string }[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      if (f.size > MAX_ATTACH_BYTES) {
        toast(
          t(s.locale, 'agentAttachTooLarge')
            .replace('{name}', f.name)
            .replace('{max}', fmtSize(MAX_ATTACH_BYTES)),
          { tone: 'danger' }
        );
        continue;
      }
      if (!isTextFile(f)) {
        toast(t(s.locale, 'agentAttachUnsupported').replace('{name}', f.name), { tone: 'danger' });
        continue;
      }
      const sig = `${f.name}:${f.size}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      candidates.push({ f, sig });
    }
    // 第二遍：并行读取（Promise.all），避免顺序 await 阻塞主线程
    const results = await Promise.allSettled(
      candidates.map(({ f }) =>
        f.text().then(
          (text) => ({ id: uid(), name: f.name, size: f.size, text } as AgentAttachmentLocal),
          () => null
        )
      )
    );
    const picked = results
      .filter((r): r is PromiseFulfilledResult<AgentAttachmentLocal> => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value);
    const failed = candidates.length - picked.length;
    if (failed > 0) {
      toast(
        t(s.locale, 'agentAttachUnsupported').replace(
          '{name}',
          t(s.locale, 'agentFilesCount').replace('{n}', String(failed))
        ),
        { tone: 'danger' }
      );
    }
    if (picked.length) setAttachments((list) => [...list, ...picked]);
    if (fileRef.current) fileRef.current.value = '';
  };

  /**
   * 拖拽上传：阻止默认 drop（否则浏览器会导航打开文件），
   * 把 dataTransfer.files 复用 pickFiles。dropzone 用整个 .agent-chat-foot。
   */
  const onFootDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onFootDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault();
    void pickFiles(e.dataTransfer.files);
  };

  const run = async (overridePrompt?: string) => {
    const q = (overridePrompt ?? prompt).trim();
    if ((!q && attachments.length === 0) || busy) return;
    const atts = attachments;
    const { modelPrompt, trimmed } = composeModelPrompt(q, atts, t(s.locale, 'agentAttachPrompt'));
    for (const name of trimmed) {
      toast(t(s.locale, 'agentAttachTrimmed').replace('{name}', name), { tone: 'danger' });
    }
    const history = buildHistory(messages);
    // 确保有激活会话，否则自动建一个
    if (!useAgentSessions.getState().activeId) {
      ensureSession();
    }
    // 1) 用户消息
    appendSessionMessage({
      role: 'user',
      text: q,
      context: modelPrompt,
      attachments: atts.map((a) => ({ name: a.name, size: a.size })),
    });
    // 2) Assistant 占位消息（先拿到 id，便于后续 patch）
    appendSessionMessage({ role: 'assistant', text: '', streaming: true });
    // 读取刚加的助手消息 id（最后一条）
    const lastMsgs = useAgentSessions.getState().getActive()?.messages ?? [];
    const asstId = lastMsgs[lastMsgs.length - 1]?.id;
    if (!asstId) {
      setBusy(false);
      return;
    }
    setPrompt('');
    setAttachments([]);
    setBusy(true);
    setPending([]);
    // 关键：捕获本次请求的 controller 到局部变量，
    // 避免后续请求修改 abortRef.current 后，本次 fetch 还引用着被覆盖前的旧 controller。
    const currentCtrl = new AbortController();
    abortRef.current = currentCtrl;
    console.debug('[Agent] abort controller created, id:', currentCtrl.signal);

    // 用本次的 controller 构造一个 fetch，确保本次所有 fetch 都用同一个信号
    const fetchWithSignal = (
      url: string,
      init: { method: string; headers: Record<string, string>; body: string }
    ) => {
      console.debug('[Agent] fetch called', { url, aborted: currentCtrl.signal.aborted });
      return fetch(url, { ...init, signal: currentCtrl.signal }).then(async (res) => ({
        ok: res.ok,
        status: res.status,
        body: res.body,
        text: () => res.text(),
      }));
    };

    const addTrace = (step: LlmTraceStep) =>
      patch(asstId, (m) => ({ ...m, trace: [...(m.trace ?? []), step] }));
    const addDelta = (text: string) => patch(asstId, (m) => ({ ...m, text: m.text + text }));
    /** 已属于最终回答的累计长度；工具轮结束时把超出部分（模型前言）移到 preamble */
    const answerLen = 0;
    const splitPreamble = () =>
      patch(asstId, (m) => {
        const seg = m.text.slice(answerLen);
        if (!seg) return m;
        return { ...m, text: m.text.slice(0, answerLen), preamble: (m.preamble ?? '') + seg };
      });

    try {
      let completion = '';
      if (canLlm && useTools) {
        const sb = createSandboxSession(vault, { allowWrite: s.agent.allowWrite });
        sandboxRef.current = sb;
        for await (const ev of runToolAgent({
          cfg: llmCfg(),
          tools: sb.tools,
          prompt: modelPrompt,
          history,
          // 用本次请求专用的 fetch（捕获 currentCtrl 的 signal），
          // 避免与 abortRef 全局共享导致并发/竞态
          fetchImpl: fetchWithSignal,
          streamFetch: fetchWithSignal,
          streamFinal: true,
        })) {
          if (ev.type === 'tool') {
            // 一轮工具调用结束：本轮流出的正文是模型前言，剔出回答
            splitPreamble();
            addTrace({ tool: ev.name, ok: ev.ok, summary: ev.summary });
            syncPending();
          } else if (ev.type === 'error' || ev.type === 'retry' || ev.type === 'notice') {
            const step = eventTraceStep(ev, s.locale);
            if (step) addTrace(step);
          } else if (ev.type === 'delta') {
            completion += ev.text;
            addDelta(ev.text);
          }
        }
        syncPending();
        tokens.recordEstimated({
          prompt: modelPrompt,
          completion,
          provider: s.agent.provider,
          model: s.agent.model,
        });
      } else if (canLlm) {
        for await (const ev of runAgent({
          cfg: llmCfg(),
          prompt: modelPrompt,
          retrieve: () => retrieve(q),
          history,
          fetchImpl: fetchWithSignal,
        })) {
          if (ev.type === 'retrieve') addTrace(ev.step);
          else if (ev.type === 'delta') {
            completion += ev.text;
            addDelta(ev.text);
          }
        }
        tokens.recordEstimated({
          prompt: modelPrompt,
          completion,
          provider: s.agent.provider,
          model: s.agent.model,
        });
      } else {
        // 未配置 LLM：本地检索兜底
        const { context, trace: steps } = retrieve(q);
        for (const step of steps) addTrace(step);
        addTrace({ tool: 'compose', ok: true, summary: t(s.locale, 'agentLocalCompose') });
        addDelta(
          context
            ? `${t(s.locale, 'agentLocalContextHeader')}\n\n${context}`
            : t(s.locale, 'agentLocalEmpty')
        );
      }
    } catch (e) {
      // 主动取消一律走"已取消"分支，不要混进"请求失败"trace。
      // 用 core 的 isAbortError：同时识别 DOMException 与 abort(reason) 传入字符串的情形。
      const isAbort = isAbortError(e);
      const detail = e instanceof Error ? e.message : String(e);
      if (isAbort) {
        patch(asstId, (m) => ({
          ...m,
          aborted: true,
          text: m.text
            ? `${m.text}\n\n*${t(s.locale, 'agentStopped')}*`
            : `*${t(s.locale, 'agentStopped')}*`,
        }));
      } else {
        patch(asstId, (m) => ({
          ...m,
          text: m.text ? `${m.text}\n\n${t(s.locale, 'agentError')}${detail}` : `${t(s.locale, 'agentError')}${detail}`,
        }));
        if (isOllama) void checkOllama();
      }
    } finally {
      patch(asstId, (m) => ({ ...m, streaming: false }));
      setBusy(false);
      abortRef.current = null;
    }
  };

  /** 重新发送某条历史 user 消息（类似 Cursor 左侧历史项点击重发） */
  const resend = (m: ChatMessage) => {
    if (busy) {
      toast(t(s.locale, 'agentBusy'), { tone: 'danger' });
      return;
    }
    // 截断该消息之后的内容（保留 user 消息本身，新生成助手回答）
    truncateAfterSession(m.id);
    // 把原 user 消息的文本重新放进输入框（让附件 / 上下文从原始 message 复制）
    setPrompt(m.context ?? m.text);
    setAttachments(
      (m.attachments ?? []).map((a) => ({
        id: uid(),
        name: a.name,
        size: a.size,
        text: '',
      }))
    );
    // 滚到该消息位置
    setTimeout(() => {
      const el = document.querySelector(`[data-msg-id="${m.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
    void run(m.text);
  };

  /** 编辑 user 消息文本后从该处重发（双击消息进入编辑态） */
  const startEdit = (m: ChatMessage) => {
    setEditingId(m.id);
    setEditingDraft(m.text);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingDraft('');
  };
  const commitEdit = (m: ChatMessage) => {
    const next = editingDraft.trim();
    if (!next) return;
    // 1) 更新消息文本
    patchSessionMessage(m.id, { text: next });
    // 2) 截断该消息之后的内容
    truncateAfterSession(m.id);
    // 3) 退出编辑态并以新文本重发
    setEditingId(null);
    setEditingDraft('');
    void run(next);
  };

  /** 复制消息文本到剪贴板（不带 Markdown 标签） */
  const copyText = async (m: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(m.text);
      toast(t(s.locale, 'agentCopied'), { tone: 'success' });
    } catch {
      // 兜底：降级到 textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = m.text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast(t(s.locale, 'agentCopied'), { tone: 'success' });
      } catch {
        toast(t(s.locale, 'agentCopyFailed'), { tone: 'danger' });
      }
      ta.remove();
    }
  };

  /** 从该消息分叉：复制到当前会话副本然后从该处切走 */
  const forkHere = (m: ChatMessage) => {
    if (!activeId) return;
    const newId = useAgentSessions.getState().forkFrom(activeId, m.id);
    if (newId) useAgentSessions.getState().setActive(newId);
  };

  const latestAnswer = [...messages].reverse().find((m) => m.role === 'assistant' && m.text);

  const insert = (m?: ChatMessage) => {
    const target = m ?? latestAnswer;
    const active = docs.activeId ? docs.docs[docs.activeId] : null;
    if (!active) {
      toast(t(s.locale, 'agentNoActiveDoc'), { tone: 'danger' });
      return;
    }
    if (!target) return;
    // 先落定编辑器未同步的输入，再读最新正文：否则插入会把刚打的字整段回退
    flushEditor();
    const st = useDocuments.getState();
    const cur = st.docs[active.id]?.content ?? active.content;
    // finalAnswerText(m) === m.text（preamble 已分离，不入正文）
    const block = buildInsertBlock(target.text, t(s.locale, 'agentInsertBlockTitle'));
    // updateContent 在单测里可能返回 vi.fn()（=undefined），统一防御
    const p = st.updateContent(active.id, `${cur}${block}`);
    if (p && typeof (p as Promise<unknown>).then === 'function') {
      (p as Promise<unknown>).then(() => {
        toast(t(s.locale, 'agentCopiedToNote'), { tone: 'success' });
      });
    }
  };

  /**
   * 主动中断：用户可能从 Esc 监听、Stop 按钮、Send→Stop 切换触发同一动作，
   * 抽成一个函数避免三处分别写 `abortRef.current?.abort()` 漏掉清空 sandbox 引用。
   */
  const stop = useCallback((reason?: string) => {
    console.debug('[Agent] stop() called', { reason, aborted: abortRef.current?.signal.aborted ?? null });
    if (abortRef.current && !abortRef.current.signal.aborted) {
      // 注意：绝不能把字符串传给 abort()。一旦传入自定义 reason，fetch 的拒绝值就变成
      // 该字符串本身（而非 DOMException{name:'AbortError'}），下游所有 AbortError 判定
      // 全部失效，取消会被误报成"模型调用失败：user_cancelled"。
      // 因此这里保持无参 abort()，取消意图通过 DOMException 传达。
      abortRef.current.abort();
    }
    // 卸载/关闭时若还有未确认 pending：core 没提供序列化接口，dispose 后数据会丢。
    // 显式弹 toast 提醒用户（即便组件即将卸载，toast store 是全局的，仍会渲染）。
    const sb = sandboxRef.current;
    const remaining = sb?.pending().length ?? 0;
    if (sb && typeof (sb as unknown as { dispose?: () => void }).dispose === 'function') {
      try {
        (sb as unknown as { dispose: () => void }).dispose();
      } catch {
        /* ignore */
      }
    }
    sandboxRef.current = null;
    if (remaining > 0) {
      toast(
        t(s.locale, 'sandboxAbandonedHint').replace('{n}', String(remaining)),
        { tone: 'danger' }
      );
    }
  }, [s.locale]);

  // 卸载/关闭面板时 dispose 残留 sandbox
  // 用 ref 保存 stop，避免依赖变化导致清理函数误触（useEffect 的 cleanup
  // 在依赖变更时也会执行，可能在请求中途意外 stop）
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    return () => {
      stopRef.current();
    };
  }, []);

  // Esc 在面板内触发中断；同时把键盘焦点在 textarea 时 Enter 也走 stop，
  // 避免用户按了 Enter 想中断却只换行
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopRef.current();
      } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        // Enter 不一定都来自 textarea；只在 textarea 内时让它走 stop
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (tag === 'textarea') {
          e.preventDefault();
          stopRef.current();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  return (
    <>
      <div className="zone-head agent-zone-head">
        <div
          className="agent-mode-tabs"
          role="tablist"
          aria-label={t(s.locale, 'agentMode')}
        >
          {(
            [
              { id: 'build' as const, label: t(s.locale, 'agentBuild'), icon: 'wrench' as const },
              { id: 'plan' as const, label: t(s.locale, 'agentPlan'), icon: 'globe' as const },
            ]
          ).map((tab) => {
            const active = s.agentMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`agent-mode-tab${active ? ' is-active' : ''}`}
                onClick={() => s.setAgentMode(tab.id)}
              >
                <Icon name={tab.icon} size={13} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <span className="zone-head-actions">
          <span
            className={`sb-dot ${connDot}`}
            title={connTitle}
            aria-label={connTitle}
          />
          {isOllama && (
            <button
              type="button"
              className="icon-btn"
              title={t(s.locale, 'agentRecheck')}
              aria-label={t(s.locale, 'agentRecheck')}
              disabled={ollamaStatus === 'checking'}
              onClick={() => void checkOllama()}
            >
              <Icon name="sync" size={16} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            title={t(s.locale, 'settings')}
            aria-label={t(s.locale, 'settings')}
            onClick={() => openPanel('settings')}
          >
            <Icon name="settings" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t(s.locale, 'close')}
            aria-label={t(s.locale, 'close')}
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </span>
      </div>

      <div
        className="agent-chat-list"
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-busy={busy}
        aria-label={t(s.locale, 'agentChatLogLabel')}
      >
        {messages.length === 0 && (
          <div className="zone-empty">
            <Icon name="agent" size={22} />
            <span className="zone-empty-title">{t(s.locale, 'agentEmpty')}</span>
            <span className="zone-empty-hint">
              {isOllama && ollamaStatus === 'offline'
                ? t(s.locale, 'agentOfflineHint').replace('{url}', ollamaBaseUrl)
                : canLlm
                  ? t(s.locale, 'agentEmptyHint')
                  : t(s.locale, 'agentNoLlm')}
            </span>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            data-msg-id={m.id}
            className={`agent-msg agent-msg-${m.role}`}
            role="article"
            aria-label={m.role === 'user' ? t(s.locale, 'agentMsgUser') : t(s.locale, 'agentMsgAssistant')}
          >
            {m.preamble && (
              <div className="agent-preamble" title={t(s.locale, 'agentPreamble')}>
                <span className="agent-preamble-tag">{t(s.locale, 'agentPreamble')}</span>
                {m.preamble.trim()}
              </div>
            )}
            {!!m.attachments?.length && (
              <div className="agent-attach">
                {m.attachments.map((a) => (
                  <span key={a.name} className="agent-chip" title={`${a.name} · ${fmtSize(a.size)}`}>
                    <Icon name="paperclip" size={12} />
                    <span className="agent-chip-name">{a.name}</span>
                    <span className="agent-chip-size">{fmtSize(a.size)}</span>
                  </span>
                ))}
              </div>
            )}
            {m.streaming && !m.text && (
              <div className="agent-bubble agent-bubble-streaming" aria-live="polite">
                <span className="agent-streaming-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            )}
            {(m.text || (m.streaming && m.text)) && m.id !== editingId && (
              <div className={`agent-bubble${m.streaming ? ' is-streaming' : ''}`}>
                {m.text}
                {m.streaming && <span className="agent-caret" aria-hidden="true">▍</span>}
              </div>
            )}
            {/* user 消息：双击文本进入编辑态 */}
            {m.id === editingId && (
              <div className="agent-bubble agent-bubble-edit">
                <textarea
                  className="agent-edit-input"
                  value={editingDraft}
                  onChange={(e) => setEditingDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      commitEdit(m);
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  rows={Math.min(8, Math.max(2, editingDraft.split('\n').length))}
                />
                <div className="agent-edit-actions">
                  <button type="button" className="ui-btn" onClick={cancelEdit}>
                    {s.locale.startsWith('zh') ? '取消' : s.locale.startsWith('ja') ? 'キャンセル' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary"
                    onClick={() => commitEdit(m)}
                    disabled={!editingDraft.trim()}
                  >
                    {t(s.locale, 'agentResend')}
                  </button>
                </div>
              </div>
            )}
            {m.aborted && (
              <div className="agent-aborted-tag" aria-label={t(s.locale, 'agentStopped')}>
                {t(s.locale, 'agentStopped')}
              </div>
            )}

            {!!m.trace?.length && (
              <details className="agent-trace">
                <summary>
                  {t(s.locale, 'agentToolsTotal').replace('{n}', String(m.trace.length))}
                </summary>
                {m.trace.map((step, i) => (
                  <div key={i} className={`agent-step ${step.ok ? 'ok' : 'err'}`}>
                    <span className="agent-step-tool">
                      {localizeToolName(step.tool, s.locale)}
                    </span>
                    <span className="agent-step-summary">{step.summary}</span>
                  </div>
                ))}
              </details>
            )}

            {!m.streaming && m.text && (
              <div className="agent-msg-toolbar" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="agent-msg-tool"
                  title={t(s.locale, 'agentCopy')}
                  aria-label={t(s.locale, 'agentCopy')}
                  onClick={() => copyText(m)}
                >
                  <Icon name="copy" size={13} />
                </button>
                {m.role === 'user' && (
                  <button
                    type="button"
                    className="agent-msg-tool"
                    title={t(s.locale, 'agentEdit')}
                    aria-label={t(s.locale, 'agentEdit')}
                    onClick={() => startEdit(m)}
                  >
                    <Icon name="edit" size={13} />
                  </button>
                )}
                {m.role === 'user' && (
                  <button
                    type="button"
                    className="agent-msg-tool"
                    title={t(s.locale, 'agentResend')}
                    aria-label={t(s.locale, 'agentResend')}
                    onClick={() => resend(m)}
                    disabled={busy}
                  >
                    {/* IconName 里没有 refresh：复用 sync（循环箭头）表达「重新发送」 */}
                    <Icon name="sync" size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className="agent-msg-tool"
                  title={t(s.locale, 'agentForkHere')}
                  aria-label={t(s.locale, 'agentForkHere')}
                  onClick={() => forkHere(m)}
                >
                  <Icon name="fork" size={13} />
                </button>
                {m.role === 'assistant' && (
                  <button
                    type="button"
                    className="agent-msg-tool agent-msg-tool-insert"
                    title={t(s.locale, 'agentInsert')}
                    aria-label={t(s.locale, 'agentInsert')}
                    onClick={() => insert(m)}
                  >
                    <Icon name="save" size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {pending.length > 0 && (
          <div className="agent-trace open">
            <h5>
              {t(s.locale, 'sandboxPending')} ({pending.length})
            </h5>
            {pending.map((p) => (
              <div key={p.key} className="agent-step ok">
                <span className="agent-step-tool">
                  {localizeToolName(sandboxOpToTool(p.op), s.locale)}
                </span>
                <span className="agent-step-summary">{p.name}</span>
                <button
                  type="button"
                  className="file-tree-btn"
                  title={t(s.locale, 'sandboxAccept')}
                  aria-label={t(s.locale, 'sandboxAccept')}
                  onClick={() => {
                    try {
                      sandboxRef.current?.accept(p.key);
                    } catch (e) {
                      // 接受失败：core 会把该项保留在队列里，但用户当前 UI 看不到原因
                      toast(
                        `${t(s.locale, 'sandboxAcceptFailed')}: ${
                          e instanceof Error ? e.message : String(e)
                        }`,
                        { tone: 'danger' }
                      );
                    } finally {
                      syncPending();
                      refreshNotes();
                    }
                  }}
                >
                  ✓
                </button>
                <button
                  type="button"
                  className="file-tree-btn"
                  title={t(s.locale, 'sandboxReject')}
                  aria-label={t(s.locale, 'sandboxReject')}
                  onClick={() => {
                    sandboxRef.current?.reject(p.key);
                    syncPending();
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="agent-actions">
              <button
                type="button"
                className="ui-btn"
                onClick={() => {
                  try {
                    sandboxRef.current?.acceptAll();
                  } catch (e) {
                    // acceptAll 内部逐条 applyAny 失败时 throw 汇总错误，
                    // 但成功的项已落库，这里只告知用户"有部分失败"
                    toast(
                      `${t(s.locale, 'sandboxAcceptPartialFail')}: ${
                        e instanceof Error ? e.message : String(e)
                      }`,
                      { tone: 'danger' }
                    );
                  } finally {
                    syncPending();
                    refreshNotes();
                  }
                }}
              >
                {t(s.locale, 'sandboxAcceptAll')}
              </button>
              <button
                type="button"
                className="ui-btn"
                onClick={() => {
                  sandboxRef.current?.rejectAll();
                  syncPending();
                }}
              >
                {t(s.locale, 'sandboxRejectAll')}
              </button>
            </div>
          </div>
        )}

        {(tokens.totals.totalTokens > 0 || tokens.last) && (
          <div className="agent-trace open">
            <h5>{t(s.locale, 'tokenUsage')}</h5>
            <div className="agent-step ok">
              <span className="agent-step-summary">
                {t(s.locale, 'tokenSession')}: {tokens.totals.totalTokens}
                {tokens.last
                  ? `（${t(s.locale, 'tokenLast')}: ${tokens.last.totalTokens}${
                      tokens.last.estimated ? ` · ${t(s.locale, 'tokenEstimated')}` : ''
                    }）`
                  : ''}
              </span>
              <button
                type="button"
                className={`file-tree-btn${tokenClearArmed ? ' is-armed' : ''}`}
                title={tokenClearArmed ? t(s.locale, 'tokenClearConfirm') : t(s.locale, 'tokenClear')}
                aria-label={t(s.locale, 'tokenClear')}
                onClick={onTokenClear}
              >
                {tokenClearArmed ? '?' : '×'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div
        className="agent-chat-foot"
        onDragOver={onFootDragOver}
        onDrop={onFootDrop}
      >
        {attachments.length > 0 && (
          <div className="agent-attach">
            {attachments.map((a) => (
              <span key={a.id} className="agent-chip" title={`${a.name} · ${fmtSize(a.size)}`}>
                <Icon name="paperclip" size={12} />
                <span className="agent-chip-name">{a.name}</span>
                <span className="agent-chip-size">{fmtSize(a.size)}</span>
                <button
                  type="button"
                  className="agent-chip-x"
                  title={t(s.locale, 'close')}
                  aria-label={t(s.locale, 'close')}
                  onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          className="agent-file-input"
          type="file"
          multiple
          accept=".md,.markdown,.txt,.json,.csv,.tsv,.yaml,.yml,.log,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.sh,.toml,.ini,.xml,.sql,text/*"
          onChange={(e) => void pickFiles(e.target.files)}
        />
        <textarea
          ref={inputRef}
          className="agent-input"
          placeholder={
            busy
              ? t(s.locale, 'agentThinking')
              : s.agentMode === 'plan'
                ? t(s.locale, 'agentPlan')
                : t(s.locale, 'agentAsk')
          }
          value={prompt}
          rows={1}
          onChange={(e) => {
            setPrompt(e.target.value);
            // 自适应高度：不超过 8 行
            const el = e.currentTarget;
            el.style.height = 'auto';
            const lineH = 22;
            const maxH = lineH * 8 + 20; // 8 行 + padding
            el.style.height = `${Math.min(maxH, el.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void run();
            }
          }}
        />
        <div className="agent-input-bottom">
          <div className="agent-input-left">
            {/* 模型选择下拉：光标风格「Auto ▾」 */}
            <div className="agent-model-pick">
              <button
                type="button"
                className="agent-model-btn"
                onClick={() => setModelMenuOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={modelMenuOpen}
                title={t(s.locale, 'agentModel')}
              >
                <Icon name="globe" size={13} />
                <span className="agent-model-btn-label">
                  {s.agent.model || t(s.locale, 'agentModelAuto')}
                </span>
                <Icon name="chevronDown" size={12} />
              </button>
              {modelMenuOpen && (
                <div className="agent-model-menu" role="listbox">
                  {modelSuggestions(s.agent.provider, s.agent.model).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      aria-selected={m === s.agent.model}
                      className={`agent-model-item${m === s.agent.model ? ' is-active' : ''}`}
                      onClick={() => {
                        s.setAgent({ model: m });
                        setModelMenuOpen(false);
                      }}
                    >
                      {m || t(s.locale, 'agentModelAuto')}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="agent-model-item agent-model-item-custom"
                    onClick={() => {
                      const next = window.prompt(
                        t(s.locale, 'agentModel'),
                        s.agent.model
                      );
                      if (next !== null) {
                        s.setAgent({ model: next.trim() });
                        setModelMenuOpen(false);
                      }
                    }}
                  >
                    ✎ {t(s.locale, 'agentModel')}…
                  </button>
                </div>
              )}
            </div>
            {/* @ 上下文（占位：v1 不接本地文档树，hover 显示提示） */}
            <button
              type="button"
              className="agent-ctx-btn"
              title={t(s.locale, 'agentAddContext')}
              aria-label={t(s.locale, 'agentAddContext')}
              onClick={() =>
                toast(t(s.locale, 'agentAddContext'), { tone: 'info' })
              }
            >
              <Icon name="at" size={14} />
            </button>
            {/* 附件（光标风格 +，落区用隐藏 input 触发） */}
            <button
              type="button"
              className="agent-ctx-btn"
              title={t(s.locale, 'agentAttach')}
              aria-label={t(s.locale, 'agentAttach')}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="plus" size={14} />
            </button>
            {/* 模式徽章（扳手 Build / 地球 Plan） */}
            <span
              className={`agent-mode-badge agent-mode-badge-${s.agentMode}`}
              title={t(s.locale, 'agentMode')}
            >
              {s.agentMode === 'plan' ? <Icon name="globe" size={12} /> : <Icon name="wrench" size={12} />}
              <span>
                {s.agentMode === 'plan' ? t(s.locale, 'agentPlan') : t(s.locale, 'agentBuild')}
              </span>
            </span>
          </div>
          <div className="agent-input-right">
            <button
              type="button"
              className="agent-ctx-btn"
              title={t(s.locale, 'agentInsert')}
              aria-label={t(s.locale, 'agentInsert')}
              disabled={!latestAnswer}
              onClick={() => insert()}
            >
              <Icon name="save" size={14} />
            </button>
            {busy ? (
              <button
                type="button"
                className="agent-send is-stop"
                title={t(s.locale, 'agentStop')}
                aria-label={t(s.locale, 'agentStop')}
                onClick={() => stop()}
              >
                <Icon name="stopCircle" size={14} />
              </button>
            ) : (
              <button
                type="button"
                className="agent-send"
                title={t(s.locale, 'agentRun')}
                aria-label={t(s.locale, 'agentRun')}
                disabled={!prompt.trim() && attachments.length === 0}
                onClick={() => void run()}
              >
                <Icon name="send" size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
