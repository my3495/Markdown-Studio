// 桌面端入口（Tauri 2.0）。Web 内核完全复用 @md-studio/web。
// 提供 MCP HTTP 子进程启停（E1）。

// Release 构建使用 Windows GUI 子系统：启动时不再弹出 / 常驻黑色控制台窗口。
// 必须放在所有 item 之前；debug 构建保留控制台便于查看日志。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

/// 「用本工具打开 md 文件」时，向前端推送路径的事件名
const OPEN_PATH_EVENT: &str = "mdstudio://open-path";

struct McpState {
    child: Mutex<Option<Child>>,
    info: Mutex<Option<McpInfo>>,
}

/** 启动参数里携带的文件路径（Windows 双击关联文件 / 命令行传参） */
struct StartupPath(Mutex<Option<String>>);

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

/// 从命令行参数里挑出第一个「像 Markdown 文件」的参数（跳过程序名与开关）
fn pick_md_path<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().skip(1).find(|a| {
        let lower = a.to_ascii_lowercase();
        !lower.starts_with('-')
            && (lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".txt"))
    })
}

/** 前端启动后取走一次启动参数路径（取完即清空，避免重复打开） */
#[tauri::command]
fn take_startup_path(state: State<'_, StartupPath>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    let startup = pick_md_path(std::env::args());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // 已在运行：把「再双击一个 md」的路径转发给现有实例
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = pick_md_path(argv) {
                let _ = app.emit(OPEN_PATH_EVENT, path);
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_focus();
                }
            }
        }))
        .manage(McpState {
            child: Mutex::new(None),
            info: Mutex::new(None),
        })
        .manage(StartupPath(Mutex::new(startup)))
        .invoke_handler(tauri::generate_handler![
            mcp_start,
            mcp_stop,
            mcp_status,
            take_startup_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building Markdown Studio");

    // macOS/iOS/Android：系统通过 RunEvent::Opened 把文件交给应用。
    // Windows/Linux 没有该事件，靠上面的启动参数 + single-instance 转发覆盖。
    #[allow(unused_variables)]
    app.run(|handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            for u in urls {
                if let Ok(p) = u.to_file_path() {
                    let _ = handle.emit(OPEN_PATH_EVENT, p.to_string_lossy().to_string());
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::pick_md_path;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn picks_first_doc_arg_and_skips_binary_and_flags() {
        assert_eq!(
            pick_md_path(args(&["Markdown Studio.exe", "--flag", "D:/notes/a.md"])),
            Some("D:/notes/a.md".to_string())
        );
        assert_eq!(
            pick_md_path(args(&["bin", "-x", "d:/n/b.MARKDOWN"])),
            Some("d:/n/b.MARKDOWN".to_string())
        );
    }

    #[test]
    fn returns_none_without_doc_arg() {
        assert_eq!(pick_md_path(args(&["Markdown Studio.exe", "--flag"])), None);
        assert_eq!(pick_md_path(args(&["Markdown Studio.exe"])), None);
    }
}
