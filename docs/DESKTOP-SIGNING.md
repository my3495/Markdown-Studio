# 桌面端代码签名（G1）

CI 已产出各平台 Tauri artifact。正式分发前建议签名，避免 OS 拦截。

## Windows（Authenticode）

1. 准备 `.pfx` 证书与密码。
2. 在仓库 Secrets 配置：
   - `TAURI_SIGNING_PRIVATE_KEY`（或证书路径相关变量，按 Tauri 文档）
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   - 或使用 `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD`（base64 PFX）
3. 取消注释 `.github/workflows/ci.yml` 中 `build-desktop` 的签名步骤。

参考：[Tauri code signing](https://v2.tauri.app/distribute/sign-windows/)

## macOS（Developer ID）

1. Apple Developer 账号 + Developer ID Application 证书。
2. Secrets：`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`。
3. 启用 notarization（`APPLE_ID` + app-specific password）。

参考：[Tauri macOS signing](https://v2.tauri.app/distribute/sign-macos/)

## Linux

通常无需代码签名；可用 AppImage / deb 校验和（Release 附带 `sha256sums`）。

## 当前仓库策略

- **未配置 Secrets 时**：仅上传未签名构建（开发/内测）。
- **配置后**：在 CI 中启用对应 `env` 与 `tauri-action` 签名参数即可，无需改业务代码。
