import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastItem {
  id: string;
  message: string;
  detail?: string;
  tone: ToastTone;
  /** ms；默认 4200 */
  duration: number;
}

interface ToastState {
  items: ToastItem[];
  push: (input: {
    message: string;
    detail?: string;
    tone?: ToastTone;
    duration?: number;
  }) => string;
  dismiss: (id: string) => void;
}

let seq = 0;

export const useToast = create<ToastState>((set) => ({
  items: [],
  push: ({ message, detail, tone = 'info', duration = 4200 }) => {
    const id = `toast-${++seq}-${Date.now()}`;
    set((s) => ({
      items: [...s.items, { id, message, detail, tone, duration }].slice(-5),
    }));
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

/** 非 React 上下文里的便捷调用 */
export function toast(
  message: string,
  opts?: { detail?: string; tone?: ToastTone; duration?: number }
): string {
  return useToast.getState().push({ message, ...opts });
}
