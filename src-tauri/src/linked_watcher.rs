use crate::{linked, services::notes::AppError};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
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

fn event_affects_binding(event: &Path, binding: &str) -> bool {
    fn normalize(path: &str) -> String {
        #[cfg(target_os = "windows")]
        {
            let path = path.replace('/', "\\");
            let path = if let Some(tail) = path.strip_prefix("\\\\?\\UNC\\") {
                format!("\\\\{tail}")
            } else {
                path.strip_prefix("\\\\?\\").unwrap_or(&path).to_owned()
            };
            path.trim_end_matches('\\').to_lowercase()
        }
        #[cfg(not(target_os = "windows"))]
        {
            path.trim_end_matches('/').to_owned()
        }
    }
    // 删除/替换时不能 canonicalize；统一路径前缀后也接受父目录的变更事件。
    let event = normalize(&event.to_string_lossy());
    let binding = normalize(binding);
    event == binding
        || binding
            .strip_prefix(&event)
            .is_some_and(|tail| tail.starts_with(std::path::MAIN_SEPARATOR))
}

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
        if *previous == mode || *previous == RecursiveMode::Recursive {
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
            .ancestors()
            .skip(1)
            .find(|path| path.is_dir())
        {
            desired.insert(parent.to_path_buf(), RecursiveMode::NonRecursive);
        }
    }
    for root in linked::list_roots()? {
        let path = PathBuf::from(&root.path);
        // Watch the parent as well: atomic replacement/remount invalidates
        // the old directory watch. Missing trees recover on ancestor events.
        if let Some(parent) = path.ancestors().skip(1).find(|p| p.is_dir()) {
            desired
                .entry(parent.to_path_buf())
                .or_insert(RecursiveMode::NonRecursive);
        }
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
            .iter()
            .filter(|(path, mode)| desired.get(*path) != Some(*mode))
            .map(|(path, _)| path.clone())
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
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    let (sender, receiver) = mpsc::sync_channel::<notify::Result<Event>>(256);
    let overflow = Arc::new(AtomicBool::new(false));
    let dropped = overflow.clone();
    let watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        if matches!(&event, Ok(event) if matches!(event.kind, EventKind::Access(_))) {
            return;
        }
        if let Err(mpsc::TrySendError::Full(_)) = sender.try_send(event) {
            dropped.store(true, Ordering::Release);
        }
    })
    .map_err(watcher_error)?;
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
        let mut revisions = HashMap::<String, String>::new();
        let mut paths = HashSet::new();
        let mut batch_started = std::time::Instant::now();
        let mut rescan = false;
        loop {
            rescan |= overflow.swap(false, Ordering::AcqRel);
            // 空闲时阻塞等待；事件簇最多积累 400ms，持续写入也不会无限推迟通知。
            let event = if paths.is_empty() && !rescan {
                let event = receiver
                    .recv()
                    .map_err(|_| mpsc::RecvTimeoutError::Disconnected);
                batch_started = std::time::Instant::now();
                event
            } else if batch_started.elapsed() >= Duration::from_millis(400) {
                Err(mpsc::RecvTimeoutError::Timeout)
            } else {
                receiver.recv_timeout(
                    Duration::from_millis(180)
                        .min(Duration::from_millis(400).saturating_sub(batch_started.elapsed())),
                )
            };
            match event {
                Ok(Ok(event)) => {
                    if matches!(event.kind, EventKind::Access(_)) {
                        continue;
                    }
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
                    rescan |= overflow.swap(false, Ordering::AcqRel);
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
                        // Forget removed/replaced directory handles before
                        // reconciling; the same path may now name a new inode.
                        if let Some(state) = WATCHER.get() {
                            if let Ok(mut state) = state.lock() {
                                let invalid: Vec<_> = state
                                    .watched
                                    .keys()
                                    .filter(|watch| {
                                        paths.iter().any(|p| {
                                            event_affects_binding(p, &watch.to_string_lossy())
                                        })
                                    })
                                    .cloned()
                                    .collect();
                                for path in invalid {
                                    let _ = state.watcher.unwatch(&path);
                                    state.watched.remove(&path);
                                }
                            }
                        }
                        let _ = sync_watches();
                    }
                    if let Ok(bindings) = linked::list() {
                        revisions.retain(|id, _| bindings.iter().any(|binding| &binding.id == id));
                        for binding in bindings {
                            let affected = rescan
                                || paths.iter().any(|path: &PathBuf| {
                                    event_affects_binding(path, &binding.path)
                                });
                            if !affected {
                                continue;
                            }
                            if let Ok(content) = linked::read(&binding.id) {
                                if revisions.get(&binding.id) == Some(&content.revision) {
                                    continue;
                                }
                                revisions.insert(binding.id.clone(), content.revision.clone());
                                let _ = app.emit(
                                    "linked-content-changed",
                                    ContentChanged {
                                        binding_id: binding.id,
                                        revision: content.revision,
                                    },
                                );
                            } else {
                                revisions.remove(&binding.id);
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

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    #[test]
    fn watcher_matches_extended_paths_and_directory_replacement() {
        let binding = r"\\?\C:\Sync\HermesSurface\Today.md";
        assert!(event_affects_binding(
            Path::new(r"C:\Sync\HermesSurface\Today.md"),
            binding
        ));
        assert!(event_affects_binding(
            Path::new(r"c:\sync\HermesSurface"),
            binding
        ));
        assert!(!event_affects_binding(
            Path::new(r"C:\Sync\HermesSurface\Today.md.tmp"),
            binding
        ));
        assert!(!event_affects_binding(
            Path::new(r"C:\Sync\Hermes"),
            binding
        ));
        assert!(event_affects_binding(
            Path::new(r"\\server\share\Today.md"),
            r"\\?\UNC\server\share\Today.md"
        ));
    }
}
