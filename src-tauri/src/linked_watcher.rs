use crate::{linked, services::notes::AppError};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{mpsc, Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Emitter};

struct WatcherState {
    watcher: RecommendedWatcher,
    watched: HashMap<PathBuf, RecursiveMode>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentChanged {
    binding_id: String,
    revision: String,
}

static WATCHER: OnceLock<Mutex<WatcherState>> = OnceLock::new();

fn watch(path: &Path, mode: RecursiveMode) -> Result<(), AppError> {
    let Some(state) = WATCHER.get() else {
        return Ok(());
    };
    let mut state = state.lock().map_err(|_| AppError {
        code: "io".into(),
        message: "文件监听锁不可用".into(),
        details: Default::default(),
    })?;
    if let Some(previous) = state.watched.get(path) {
        if *previous == mode {
            return Ok(());
        }
        state.watcher.unwatch(path).map_err(watcher_error)?;
    }
    state.watcher.watch(path, mode).map_err(watcher_error)?;
    state.watched.insert(path.to_path_buf(), mode);
    Ok(())
}

fn watcher_error(error: notify::Error) -> AppError {
    AppError {
        code: "watcher".into(),
        message: error.to_string(),
        details: Default::default(),
    }
}

pub fn watch_binding(path: &str) -> Result<(), AppError> {
    if let Some(parent) = Path::new(path).parent() {
        if parent.is_dir() {
            watch(parent, RecursiveMode::NonRecursive)?;
        }
    }
    Ok(())
}

pub fn watch_root(path: &str, recursive: bool) -> Result<(), AppError> {
    if Path::new(path).is_dir() {
        watch(
            Path::new(path),
            if recursive {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            },
        )?;
    }
    Ok(())
}

pub fn sync_watches() -> Result<(), AppError> {
    let mut desired = HashMap::new();
    for binding in linked::list()? {
        if let Some(parent) = Path::new(&binding.path)
            .parent()
            .filter(|path| path.is_dir())
        {
            desired.insert(parent.to_path_buf(), RecursiveMode::NonRecursive);
        }
    }
    for root in linked::list_roots()? {
        let path = PathBuf::from(&root.path);
        if path.is_dir() {
            desired.insert(
                path,
                if root.recursive {
                    RecursiveMode::Recursive
                } else {
                    RecursiveMode::NonRecursive
                },
            );
        }
    }
    let Some(state) = WATCHER.get() else {
        return Ok(());
    };
    let stale = {
        let state = state.lock().map_err(|_| AppError {
            code: "io".into(),
            message: "文件监听锁不可用".into(),
            details: Default::default(),
        })?;
        state
            .watched
            .keys()
            .filter(|path| !desired.contains_key(*path))
            .cloned()
            .collect::<Vec<_>>()
    };
    for path in stale {
        let mut state = state.lock().map_err(|_| AppError {
            code: "io".into(),
            message: "文件监听锁不可用".into(),
            details: Default::default(),
        })?;
        state.watcher.unwatch(&path).map_err(watcher_error)?;
        state.watched.remove(&path);
    }
    for (path, mode) in desired {
        watch(&path, mode)?;
    }
    Ok(())
}

pub fn start(app: AppHandle) -> Result<(), AppError> {
    let (sender, receiver) = mpsc::channel::<notify::Result<Event>>();
    let watcher = notify::recommended_watcher(sender).map_err(watcher_error)?;
    WATCHER
        .set(Mutex::new(WatcherState {
            watcher,
            watched: HashMap::new(),
        }))
        .map_err(|_| AppError {
            code: "watcher".into(),
            message: "文件监听已启动".into(),
            details: Default::default(),
        })?;
    let _ = linked::scan_roots()?;
    sync_watches()?;
    std::thread::spawn(move || {
        let mut paths = Vec::new();
        let mut rescan = false;
        loop {
            match receiver.recv_timeout(Duration::from_millis(180)) {
                Ok(Ok(event)) => {
                    if matches!(
                        event.kind,
                        EventKind::Create(_)
                            | EventKind::Remove(_)
                            | EventKind::Modify(notify::event::ModifyKind::Name(_))
                            | EventKind::Any
                    ) {
                        rescan = true;
                    }
                    paths.extend(event.paths);
                }
                Ok(Err(error)) => {
                    eprintln!("linked watcher error: {error}");
                    rescan = true;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if paths.is_empty() && !rescan {
                        continue;
                    }
                    // 合并编辑器连续写入事件，再按受影响的绑定 ID 通知窗口。
                    if rescan {
                        if let Ok(added) = linked::scan_roots() {
                            if !added.is_empty() {
                                let _ = app.emit("bindings-changed", ());
                            }
                        }
                    }
                    if let Ok(bindings) = linked::list() {
                        for binding in bindings {
                            let affected = paths.iter().any(|path: &PathBuf| {
                                path.to_string_lossy().eq_ignore_ascii_case(&binding.path)
                            });
                            if !affected {
                                continue;
                            }
                            if let Ok(content) = linked::read(&binding.id) {
                                let _ = app.emit(
                                    "linked-content-changed",
                                    ContentChanged {
                                        binding_id: binding.id,
                                        revision: content.revision,
                                    },
                                );
                            } else {
                                let _ = app.emit("linked-file-unavailable", binding.id);
                            }
                        }
                    }
                    paths.clear();
                    rescan = false;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
    Ok(())
}
