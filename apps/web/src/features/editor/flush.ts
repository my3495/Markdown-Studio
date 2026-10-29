/**
 * 编辑器「立即同步到 store」句柄的模块级注册点。
 *
 * 背景：编辑器向 store 的同步是 150ms 防抖的，且防抖未落定时编辑器会**丢弃**
 * 外部写入（CodeMirrorEditor 的 content effect），随后防抖 emit 又把旧文本推回
 * store —— 结果就是外部写入被静默覆盖丢失。
 *
 * 因此任何「不经编辑器、直接改正文」的入口（白板写回、内联改标题、插入白板、
 * 属性面板、Agent 插入、历史恢复、同步拉取）都必须先 flushEditor()。
 */

let flush: (() => void) | null = null;

/** 由编辑器挂载时注册；卸载时传 null */
export function registerEditorFlush(fn: (() => void) | null): void {
  flush = fn;
}

/** 把编辑器里未落定的输入立刻推进 store；编辑器未挂载时安全空转 */
export function flushEditor(): void {
  try {
    flush?.();
  } catch {
    /* 编辑器尚未挂载或已卸载：忽略 */
  }
}
