// 桌面端入口（Tauri 2.0）。Web 内核完全复用 @md-studio/web。
// 提供 MCP HTTP 子进程启停（E1）。

// Release 构建使用 Windows GUI 子系统：启动时不再弹出 / 常驻黑色控制台窗口。
// 必须放在所有 item 之前；debug 构建保留控制台便于查看日志。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

struct McpState {
    child: Mutex<Option<Child>>,
    info: Mutex<Option<McpInfo>>,
}

#[derive(Clone, serde::Serialize)]
struct McpInfo {
    port: u16,
    token: String,
    workspace: String,
    url: String,
}

#[derive(serde::Deserialize)]
struct McpStartArgs {
    workspace: String,
    #[serde(default = "default_port")]
    port: u16,
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    allow_write: bool,
    /// 打包进资源目录的 index.mjs 绝对路径；缺省则依赖 PATH 中的 md-studio-mcp / npx
    #[serde(default)]
    script: Option<String>,
}

fn default_port() -> u16 {
    3721
}

fn random_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("mds-{:x}", t)
}

#[tauri::command]
fn mcp_start(args: McpStartArgs, state: State<'_, McpState>) -> Result<McpInfo, String> {
    let mut slot = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    let token = args
        .token
        .filter(|t| !t.is_empty())
        .unwrap_or_else(random_token);
    let port = if args.port == 0 { 3721 } else { args.port };

    let mut cmd = if let Some(script) = args.script.as_ref().filter(|s| !s.is_empty()) {
        let mut c = Command::new("node");
        c.arg(script);
        c
    } else {
        // 优先全局 bin，失败时由前端提示安装 @md-studio/mcp
        Command::new("md-studio-mcp")
    };

    cmd.arg("--http")
        .arg("--workspace")
        .arg(&args.workspace)
        .arg("--port")
        .arg(port.to_string())
        .arg("--token")
        .arg(&token);
    if args.allow_write {
        cmd.arg("--allow-write");
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| format!("启动 MCP 失败: {e}（请先安装 md-studio-mcp 或提供 script 路径）"))?;

    let info = McpInfo {
        port,
        token: token.clone(),
        workspace: args.workspace.clone(),
        url: format!("http://127.0.0.1:{port}/mcp"),
    };
    *slot = Some(child);
    if let Ok(mut i) = state.info.lock() {
        *i = Some(info.clone());
    }
    Ok(info)
}

#[tauri::command]
fn mcp_stop(state: State<'_, McpState>) -> Result<(), String> {
    let mut slot = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Ok(mut i) = state.info.lock() {
        *i = None;
    }
    Ok(())
}

#[tauri::command]
fn mcp_status(state: State<'_, McpState>) -> Option<McpInfo> {
    // 若子进程已退出则清空
    if let Ok(mut slot) = state.child.lock() {
        if let Some(child) = slot.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    *slot = None;
                    if let Ok(mut i) = state.info.lock() {
                        *i = None;
                    }
                    return None;
                }
                Ok(None) => {}
                Err(_) => {}
            }
        } else {
            return None;
        }
    }
    state.info.lock().ok().and_then(|g| g.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(McpState {
            child: Mutex::new(None),
            info: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![mcp_start, mcp_stop, mcp_status])
        .run(tauri::generate_context!())
        .expect("error while running Markdown Studio");
}
