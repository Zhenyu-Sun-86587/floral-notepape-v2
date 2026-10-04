//! Explicit Mac quit waits for document windows to commit, including linked files.
use crate::updater::{InstallPrepareState, InstallPrepareWindowStatus, UpdaterState};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};

static PREPARING: AtomicBool = AtomicBool::new(false);
static QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);
#[derive(Default)]
struct MainClose {
    closing: bool,
    cancelled: bool,
    destroying: bool,
    reopen: bool,
}
static MAIN_CLOSE: Mutex<MainClose> = Mutex::new(MainClose {
    closing: false,
    cancelled: false,
    destroying: false,
    reopen: false,
});

pub fn request_quit(app: &tauri::AppHandle) {
    QUIT_REQUESTED.store(true, Ordering::SeqCst);
    request_save(app, false);
}

pub fn request_close_main(app: &tauri::AppHandle) {
    request_save(app, true);
}

pub fn cancel_or_defer_main_close() -> bool {
    let mut state = MAIN_CLOSE.lock().unwrap_or_else(|error| error.into_inner());
    if state.destroying {
        state.reopen = true;
        return true;
    }
    state.cancelled = state.closing;
    false
}

pub fn main_destroyed(app: &tauri::AppHandle) {
    let reopen = {
        let mut state = MAIN_CLOSE.lock().unwrap_or_else(|error| error.into_inner());
        let reopen = state.reopen;
        *state = MainClose::default();
        reopen
    };
    if !crate::desktop::app_is_exiting(app) {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        if reopen {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = crate::desktop::show_main_window(&app) {
                    eprintln!("failed to reopen main window: {error}");
                }
            });
        }
    }
}

fn request_save(app: &tauri::AppHandle, close_main: bool) {
    if PREPARING.swap(true, Ordering::SeqCst) {
        return;
    }
    if close_main {
        *MAIN_CLOSE.lock().unwrap_or_else(|error| error.into_inner()) = MainClose {
            closing: true,
            ..Default::default()
        };
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<UpdaterState>();
        let documents = || {
            app.webview_windows()
                .into_iter()
                .filter(|(label, _)| {
                    label == "main"
                        || (!close_main
                            && (label.starts_with("notepad-") || label.starts_with("tile-")))
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
            if close_main
                && MAIN_CLOSE
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .cancelled
            {
                break Some("已重新打开主界面，取消关闭".into());
            }
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
                InstallPrepareState::Unknown => break Some("保存会话已失效，请重试".into()),
                _ if std::time::Instant::now() >= deadline => {
                    break Some("等待笔记保存超时，已取消操作；请检查各窗口的保存状态".into())
                }
                _ => tokio::time::sleep(std::time::Duration::from_millis(100)).await,
            }
        };
        state.clear_install_prepare(&request);
        if let Some(message) = failure {
            for window in documents().values() {
                let _ = window.emit("app://exit-freeze", false);
            }
            use tauri_plugin_dialog::DialogExt;
            if !close_main
                || !MAIN_CLOSE
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .cancelled
            {
                app.dialog()
                    .message(message)
                    .title(if close_main {
                        "笺影：未关闭"
                    } else {
                        "笺影：未退出"
                    })
                    .show(|_| {});
            }
        } else if close_main {
            let destroy = {
                let mut state = MAIN_CLOSE.lock().unwrap_or_else(|error| error.into_inner());
                state.destroying = !state.cancelled;
                state.destroying
            };
            if let Some(window) = app.get_webview_window("main").filter(|_| destroy) {
                if let Err(error) = window.destroy() {
                    *MAIN_CLOSE.lock().unwrap_or_else(|error| error.into_inner()) =
                        MainClose::default();
                    let _ = window.emit("app://exit-freeze", false);
                    use tauri_plugin_dialog::DialogExt;
                    app.dialog()
                        .message(format!("无法释放主界面：{error}"))
                        .title("笺影：未关闭")
                        .show(|_| {});
                }
            } else if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("app://exit-freeze", false);
            } else {
                main_destroyed(&app);
            }
        } else {
            crate::desktop::mark_app_exiting(&app);
            app.exit(0);
        }
        if close_main {
            let mut state = MAIN_CLOSE.lock().unwrap_or_else(|error| error.into_inner());
            if !state.destroying {
                *state = MainClose::default();
            }
        }
        PREPARING.store(false, Ordering::SeqCst);
        if close_main && QUIT_REQUESTED.load(Ordering::SeqCst) {
            request_quit(&app);
        } else if !close_main {
            QUIT_REQUESTED.store(false, Ordering::SeqCst);
        }
    });
}
