//! WidgetKit snapshot boundary. Only explicitly selected notes cross into the
//! widget snapshot container; widgets never read or modify the live note store.
use crate::{
    json_io::write_json_atomic,
    services::notes::{default_store, AppError},
};
use serde::{Deserialize, Serialize};
use std::{
    ffi::{CStr, CString},
    sync::{mpsc, OnceLock},
    time::{Duration, Instant},
};
use tauri::{Emitter, Listener};
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
unsafe extern "C" {
    fn folio_widgets_available() -> bool;
    fn folio_widgets_publish(json: *const std::ffi::c_char) -> bool;
    fn folio_widgets_initialize(
        callback: extern "C" fn(*const std::ffi::c_char),
        task_callback: extern "C" fn(*const std::ffi::c_char),
    );
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    available: bool,
    selected: Vec<String>,
    choices: Vec<Choice>,
}
#[derive(Serialize)]
pub struct Choice {
    key: String,
    title: String,
}
#[derive(Serialize)]
struct Snapshot {
    notes: Vec<WidgetNote>,
}
#[derive(Serialize)]
struct WidgetNote {
    key: String,
    title: String,
    content: String,
}
fn selected() -> Result<Vec<String>, AppError> {
    let path = default_store()?.config_dir().join("widget-selection.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}
pub fn status() -> Result<Status, AppError> {
    let store = default_store()?;
    let mut choices: Vec<_> = store
        .list_notes()?
        .into_iter()
        .map(|n| Choice {
            key: format!("note:{}", n.id),
            title: n.title,
        })
        .collect();
    for binding in crate::linked::list()? {
        let title = std::path::Path::new(&binding.path)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        choices.push(Choice {
            key: format!("linked:{}", binding.id),
            title,
        });
    }
    Ok(Status {
        available: unsafe { folio_widgets_available() },
        selected: selected()?,
        choices,
    })
}
pub fn select(keys: Vec<String>) -> Result<Status, AppError> {
    let s = status()?;
    if !s.available {
        return Err(error("当前安装包尚未配置 WidgetKit 扩展与数据容器"));
    }
    if keys.len() > 32 || keys.iter().any(|k| !s.choices.iter().any(|c| &c.key == k)) {
        return Err(error("请选择至多32张现有便签"));
    }
    let mut keys = keys;
    keys.sort();
    keys.dedup();
    write_json_atomic(
        &default_store()?.config_dir().join("widget-selection.json"),
        &keys,
    )?;
    refresh()?;
    status()
}
fn error(message: &str) -> AppError {
    AppError {
        code: "macWidgets".into(),
        message: message.into(),
        details: Default::default(),
    }
}
fn refresh() -> Result<(), AppError> {
    if !unsafe { folio_widgets_available() } {
        return Ok(());
    }
    let store = default_store()?;
    let mut notes = Vec::new();
    for key in selected()?.into_iter().take(32) {
        let Some((kind, id)) = key.split_once(':') else {
            continue;
        };
        // UUIDs only; never interpret a widget URL as a filesystem path.
        if uuid::Uuid::parse_str(id).is_err() {
            continue;
        }
        let note = match kind {
            "note" => store.read_note(id).ok().map(|n| (n.title, n.content)),
            "linked" => crate::linked::read(id).ok().map(|n| {
                (
                    std::path::Path::new(&n.binding.path)
                        .file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    n.content,
                )
            }),
            _ => None,
        };
        if let Some((title, content)) = note {
            notes.push(WidgetNote {
                key,
                title: title.chars().take(160).collect(),
                content: content.chars().take(4000).collect(),
            });
        }
    }
    let json = CString::new(serde_json::to_string(&Snapshot { notes })?)
        .map_err(|_| error("小组件快照编码失败"))?;
    if !unsafe { folio_widgets_publish(json.as_ptr()) } {
        return Err(error("写入小组件共享容器失败"));
    }
    Ok(())
}
fn parse_explicit_open(url: &str) -> Option<(&str, &str)> {
    let scheme = if cfg!(folio_private_container_experiment) {
        "folio-private"
    } else {
        "folio"
    };
    let (kind, id) = url
        .strip_prefix(&format!("{scheme}://widget-open/"))?
        .split_once('/')?;
    if !matches!(kind, "note" | "linked") || uuid::Uuid::parse_str(id).is_err() {
        return None;
    }
    Some((kind, id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskChange {
    note_key: String,
    expected_content: String,
    line: usize,
    checked: bool,
}

fn apply_task(content: &str, change: &TaskChange) -> Result<String, AppError> {
    if content.chars().take(4000).collect::<String>() != change.expected_content {
        return Err(error("便签已变化，请刷新小组件后重试"));
    }
    let mut offset = 0;
    let mut fenced = false;
    for (index, raw) in content.split_inclusive('\n').enumerate() {
        let trimmed = raw.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
        }
        if index == change.line {
            let marker = trimmed.as_bytes();
            if fenced
                || marker.len() < 6
                || !matches!(marker[0], b'-' | b'*' | b'+')
                || marker[1..3] != *b" ["
                || !matches!(marker[3], b' ' | b'x' | b'X')
                || marker[4..6] != *b"] "
            {
                return Err(error("目标行不是可交互待办"));
            }
            let position = offset + raw.len() - trimmed.len() + 3;
            let mut updated = content.to_owned();
            updated.replace_range(
                position..position + 1,
                if change.checked { "x" } else { " " },
            );
            return Ok(updated);
        }
        offset += raw.len();
    }
    Err(error("待办行已不存在"))
}

extern "C" fn task_change(pointer: *const std::ffi::c_char) {
    if pointer.is_null() {
        return;
    }
    let bytes = unsafe { CStr::from_ptr(pointer) }.to_bytes();
    let result = (|| -> Result<(), AppError> {
        if bytes.len() > 32768 {
            return Err(error("小组件操作过大"));
        }
        let change: TaskChange = serde_json::from_slice(bytes)?;
        if !selected()?.contains(&change.note_key) {
            return Err(error("便签未授权给小组件"));
        }
        let (kind, id) = change
            .note_key
            .split_once(':')
            .ok_or_else(|| error("无效便签"))?;
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(error("无效便签"));
        }
        match kind {
            "note" => {
                default_store()?.update_widget_task(id, |content| apply_task(content, &change))?;
            }
            "linked" => {
                let note = crate::linked::read(id)?;
                let content = apply_task(&note.content, &change)?;
                crate::linked::save(id, &content, &note.revision, false)?;
            }
            _ => return Err(error("无效便签类型")),
        }
        if let Some(app) = APP.get() {
            let _ = app.emit("notes-changed", ());
        }
        Ok(())
    })();
    if let Err(e) = result {
        eprintln!("widget task: {e}");
    }
    // Also refresh rejected stale actions so the widget recovers current state.
    let _ = refresh();
}
extern "C" fn explicit_open(pointer: *const std::ffi::c_char) {
    if pointer.is_null() {
        return;
    }
    let url = unsafe { CStr::from_ptr(pointer) }.to_string_lossy();
    let Some((kind, id)) = parse_explicit_open(&url) else {
        return;
    };
    let key = format!("{kind}:{id}");
    if !selected().is_ok_and(|keys| keys.contains(&key)) {
        return;
    }
    let Some(app) = APP.get().cloned() else {
        return;
    };
    let (kind, id) = (kind.to_owned(), id.to_owned());
    tauri::async_runtime::spawn(async move {
        if kind == "note" {
            if default_store().and_then(|s| s.read_note(&id)).is_ok() {
                let _ = crate::desktop::open_tile_window(app, id, None).await;
            }
        } else if crate::linked::read(&id).is_ok() {
            let _ = crate::desktop::open_linked_tile_window_now(&app, &id, None);
        }
    });
}
pub fn setup(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    unsafe {
        folio_widgets_initialize(explicit_open, task_change);
    }
    let (tx, rx) = mpsc::sync_channel(1);
    for event in [
        "notes-changed",
        "bindings-changed",
        "linked-content-changed",
        "linked-file-unavailable",
    ] {
        let tx = tx.clone();
        app.listen(event, move |_| {
            let _ = tx.try_send(());
        });
    }
    std::thread::spawn(move || {
        let _ = refresh();
        while rx.recv().is_ok() {
            // Coalesce bursts but still publish during continuous typing.
            let deadline = Instant::now() + Duration::from_secs(2);
            while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
                if rx
                    .recv_timeout(remaining.min(Duration::from_millis(500)))
                    .is_err()
                {
                    break;
                }
            }
            if let Err(e) = refresh() {
                eprintln!("widget snapshot: {e}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn task_update_preserves_other_content_and_rejects_stale_or_code_lines() {
        let content = "# 中文\r\n- [ ] 重复\r\n- [ ] 重复\r\n尾部";
        let mut change = super::TaskChange {
            note_key: String::new(),
            expected_content: content.into(),
            line: 2,
            checked: true,
        };
        assert_eq!(
            super::apply_task(content, &change).unwrap(),
            "# 中文\r\n- [ ] 重复\r\n- [x] 重复\r\n尾部"
        );
        assert!(super::apply_task(&format!("{content}变化"), &change).is_err());
        change.expected_content = "```\n- [ ] 示例\n```".into();
        change.line = 1;
        assert!(super::apply_task(&change.expected_content, &change).is_err());
        change.expected_content = "标题\n普通正文".into();
        assert!(super::apply_task(&change.expected_content, &change).is_err());
    }
    #[test]
    fn only_explicit_widget_open_links_are_accepted() {
        let id = "40a88de0-7176-4be4-b4ea-c9155cae5ce4";
        let scheme = if cfg!(folio_private_container_experiment) {
            "folio-private"
        } else {
            "folio"
        };
        for kind in ["note", "linked"] {
            assert!(
                super::parse_explicit_open(&format!("{scheme}://widget-open/{kind}/{id}"))
                    .is_some()
            );
            assert!(super::parse_explicit_open(&format!("folio://{kind}/{id}")).is_none());
        }
        for url in [
            "folio://widget-open/note/../../config.json",
            "folio://widget-open/other/40a88de0-7176-4be4-b4ea-c9155cae5ce4",
            "https://widget-open/note/40a88de0-7176-4be4-b4ea-c9155cae5ce4",
        ] {
            assert!(super::parse_explicit_open(url).is_none());
        }
    }
}
