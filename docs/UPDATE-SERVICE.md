# 更新服务（update-server）

为 Markdown Studio 桌面端提供 `tauri-plugin-updater` 所需的更新清单与产物下载。

## 它做什么

扫描仓库根目录的 `release/`，把其中的安装包与其 `.sig` 签名汇总成 `latest.json`，
然后通过 HTTP 提供给桌面端检查更新。

| 端点 | 说明 |
|---|---|
| `GET /latest.json` | 更新清单（版本、说明、各平台下载地址与签名） |
| `GET /downloads/<file>` | 产物下载（仅限 `release/` 内的文件） |
| `GET /health` | 健康检查，返回发布目录与 baseUrl |

## 清单格式

对齐 `tauri-plugin-updater` 的 `RemoteRelease` 反序列化（Static 格式）：

```json
{
  "version": "1.0.0",
  "notes": "",
  "pub_date": "2026-10-27T12:43:06.635Z",
  "platforms": {
    "windows-x86_64-nsis": {
      "url": "http://127.0.0.1:8788/downloads/Markdown%20Studio_1.0.0_x64-setup.exe",
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."
    },
    "windows-x86_64-msi": { "url": "...", "signature": "..." }
  }
}
```

target 标识规则为 `{os}-{arch}-{installer}`，Windows 目前生成 `windows-x86_64-nsis`
与 `windows-x86_64-msi` 两项。

## 用法

```bash
# 启动服务（默认 127.0.0.1:8788）
pnpm update:serve

# 只重新生成清单（复用构建产出的 .sig）
pnpm update:manifest

# 自定义端口 / 发布目录 / 对外地址
node apps/update-server/src/server.mjs --port 9000 --release-dir ./release --base-url https://updates.example.com
```

## 发布新版本的完整流程

1. 改 `apps/desktop/src-tauri/tauri.conf.json` 里的 `version`（如 `1.1.0`）。
2. 带签名密钥构建：

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\mdstudio.key" -Raw
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "mdstudio-dev"
   cd apps/desktop
   npx vite build
   npx tauri build --bundles nsis,msi
   ```

   构建会输出安装包 **以及** `<安装包>.sig`（由 `createUpdaterArtifacts: true` 触发）。

3. 把安装包与 `.sig` 复制到 `release/`。
4. 重新生成清单：`pnpm update:manifest`（会自动挑选文件名中版本号最高的产物）。
5. 重启服务，桌面端「设置 → 关于与更新 → 检查更新」即可看到新版本。

## 签名与安全

- 客户端校验由 `tauri.conf.json` 的 `plugins.updater.pubkey` 完成，**私钥永不进仓库**。
  - 私钥：`%USERPROFILE%\.tauri\mdstudio.key`（密码 `mdstudio-dev`，**生产环境请更换**）
  - 公钥：`%USERPROFILE%\.tauri\mdstudio.key.pub`
- 签名带 `trusted comment: version:x.y.z`，可配合 `requireSignedVersion` 防降级攻击。
- 缺少 `.sig` 的产物会被清单生成器跳过，避免下发必然安装失败的更新。

## 从本地服务切到线上

`server.mjs` 生成的下载地址基于 `--base-url`。部署到公网时：

```bash
node apps/update-server/src/server.mjs --host 0.0.0.0 --port 8788 --base-url https://updates.your-domain.com
```

并同步修改 `tauri.conf.json` 的 `plugins.updater.endpoints`，同时移除
`dangerousInsecureTransportProtocol`（该项仅为本地 http 调试保留）。
