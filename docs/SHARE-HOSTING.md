# 公开只读分享托管（F2）

Markdown Studio 可生成：

1. **本机链接** `#share/<id>` 或 `#share/p/<payload>`（IndexedDB / URL 内嵌）
2. **离线 HTML**（工具栏「分享链接」会同时下载 `*-share.html`）

若要做成公网可打开的只读页，推荐用静态托管：

## GitHub Pages

1. 新建仓库（或使用现有 `docs/` / `gh-pages` 分支）。
2. 将导出的 `*-share.html` 重命名为 `index.html`（或放入子路径）。
3. 仓库 Settings → Pages → Source 选择该分支/目录。
4. 访问 `https://<user>.github.io/<repo>/`。

## Netlify / Cloudflare Pages / Vercel

拖拽上传包含 `index.html` 的文件夹即可；无需构建命令。

## 安全提示

- 分享页为**明文** HTML，勿放入密钥、隐私笔记。
- 需要保密时请用应用内「加密」导出 `.mdstudio.json`，再私下分发口令。
- 公网托管不提供访问控制；如需鉴权请自建网关。

## 与应用内 hash 分享的区别

| 方式 | 依赖 | 适用 |
|------|------|------|
| `#share/` | 同源浏览器 / IndexedDB | 本机演示、短文 URL |
| `*-share.html` | 任意静态主机 | 邮件、网盘、Pages |
