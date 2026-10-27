/**
 * Web 平台文件系统适配（ADR-15：草稿双写 + Web 能力探测）。
 * - 打开：隐藏 file input + CJK 编码自动检测
 * - 保存：Blob 下载（Web 无法静默写盘）
 * - 草稿：localStorage 持久化
 */
import { decodeBytes, type DetectedEncoding } from '@md-studio/core';

export interface OpenedFile {
  id: string;
  name: string;
  path: string;
  content: string;
  encoding?: DetectedEncoding;
}

export const webFs = {
  async openFile(): Promise<OpenedFile | null> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/markdown';
    return new Promise((resolve) => {
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const buf = await file.arrayBuffer();
        const detected = decodeBytes(buf);
        resolve({
          id: `file-${file.name}-${Date.now()}`,
          name: file.name,
          path: file.name,
          content: detected.text,
          encoding: detected.encoding,
        });
      };
      input.click();
    });
  },

  /** Web 无法静默写盘：忽略 path，一律走 Blob 下载 */
  async saveFile(_path: string | null, name: string, content: string): Promise<string> {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return name;
  },

  /** 草稿双写：localStorage 作为 IndexedDB 不稳时的兜底 */
  saveDraft(id: string, content: string) {
    try {
      localStorage.setItem(`md-studio:draft:${id}`, content);
    } catch {
      /* 配额超限忽略 */
    }
  },

  loadDraft(id: string): string | null {
    try {
      return localStorage.getItem(`md-studio:draft:${id}`);
    } catch {
      return null;
    }
  },
};
