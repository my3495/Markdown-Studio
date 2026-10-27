import '@testing-library/jest-dom/vitest';

// React 18 + RTL：显式开启 act 环境，避免 "not wrapped in act" 告警
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 未实现 Blob.prototype.text()（浏览器均已支持），用 FileReader 补齐，
// 以便测试 AgentChat 的附件读取路径（f.text()）
if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result ?? ''));
      fr.onerror = () => reject(fr.error);
      fr.readAsText(this);
    });
  };
}
