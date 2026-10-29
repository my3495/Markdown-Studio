import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import '@md-studio/web/styles/index.css';
import { App, setFileDropSource, setFsBackend, setUpdateBackend, setVaultBackend } from '@md-studio/web';
import { tauriVaultBackend } from './platform/vault/tauriVault';
import { tauriFs } from './platform/fs/tauri';
import { tauriFileDrop } from './platform/fs/drop';
import { initOpenWith } from './platform/fs/openWith';
import { tauriUpdateBackend } from './platform/update/tauri';

// 桌面端复用 Web 内核；注入 Tauri 文件夹 Vault 后端（覆盖默认 File System Access）。
if (tauriVaultBackend.available()) {
  setVaultBackend(tauriVaultBackend);
}

// 注入 Tauri 文件后端：打开走原生对话框，保存写回原文件路径（覆盖默认 file input + 下载）。
if ('__TAURI_INTERNALS__' in window) {
  setFsBackend(tauriFs);
  // 拖入文档：使用原生拖放事件（带绝对路径），而非 HTML5 drop
  setFileDropSource(tauriFileDrop);
  // 文件关联：双击 .md/.markdown 直接在本工具打开（含已在运行时的转发）
  void initOpenWith();
}

// 注入更新后端：基于 tauri-plugin-updater 的检查/下载/安装
setUpdateBackend(tauriUpdateBackend);

createRoot(document.getElementById('root')!).render(<App />);
