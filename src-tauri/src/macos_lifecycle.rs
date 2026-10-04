//! Explicit Mac quit waits for document windows to commit, including linked files.
use crate::updater::{InstallPrepareState, InstallPrepareWindowStatus, UpdaterState};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

static PREPARING: AtomicBool = AtomicBool::new(false);

pub fn request_quit(app: &tauri::AppHandle) {
    if PREPARING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<UpdaterState>();
        let documents = || {
            app.webview_windows()
                .into_iter()
                .filter(|(label, _)| {
                    label == "main" || label.starts_with("notepad-") || label.starts_with("tile-")
                })
                .collect::<std::collections::HashMap<_, _>>()
        };
        let windows = documents();
        let request = state.begin_install_prepare(windows.keys().cloned());
        let payload = serde_json::json!({ "requestId": request });
        let notify = |window: &tauri::WebviewWindow| {
            if let Err(error) = window
                .emit("app://exit-freeze", true)
                .and_then(|_| window.emit("update://prepare-install", &payload))
            {
                state.report_install_prepare(
                    &request,
                    window.label(),
                    InstallPrepareWindowStatus::Failed(format!("无法通知窗口保存：{error}")),
                );
            }
        };
        for window in windows.values() {
            notify(window);
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        let failure = loop {
            let windows = documents();
            let added = state.sync_install_prepare_labels(&request, windows.keys().cloned());
            for label in added {
                if let Some(window) = windows.get(&label) {
                    notify(window);
                }
            }
            match state.poll_install_prepare(&request) {
                InstallPrepareState::Ready => break None,
                InstallPrepareState::Failed { message, .. } => break Some(message),
                InstallPrepareState::Unknown => {
                    break Some("退出保存会话已失效，请重试退出".into())
                }
                _ if std::time::Instant::now() >= deadline => {
                    break Some("等待笔记保存超时，已取消退出；请检查各窗口的保存状态".into())
                }
                _ => tokio::time::sleep(std::time::Duration::from_millis(100)).await,
            }
        };
        state.clear_install_prepare(&request);
        if let Some(message) = failure {
            let _ = app.emit("app://exit-freeze", false);
            PREPARING.store(false, Ordering::SeqCst);
            use tauri_plugin_dialog::DialogExt;
            app.dialog()
                .message(message)
                .title("笺影：未退出")
                .show(|_| {});
        } else {
            crate::desktop::mark_app_exiting(&app);
            app.exit(0);
        }
    });
}
