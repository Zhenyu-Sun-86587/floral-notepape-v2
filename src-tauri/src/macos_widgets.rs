//! WidgetKit snapshot boundary. Only explicitly selected notes cross into the
//! widget snapshot container; widgets never read or modify the live note store.
use crate::{
    json_io::write_json_atomic,
    services::notes::{default_store, AppError},
};
use serde::Serialize;
use std::{
    ffi::{CStr, CString},
    sync::{mpsc, OnceLock},
    time::Duration,
};
use tauri::Listener;
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
unsafe extern "C" {
    fn folio_widgets_available() -> bool;
    fn folio_widgets_publish(json: *const std::ffi::c_char) -> bool;
    fn folio_widgets_initialize(callback: extern "C" fn(*const std::ffi::c_char));
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
    let (kind, id) = url.strip_prefix("folio://widget-open/")?.split_once('/')?;
    if !matches!(kind, "note" | "linked") || uuid::Uuid::parse_str(id).is_err() {
        return None;
    }
    Some((kind, id))
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
        folio_widgets_initialize(explicit_open);
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
            while rx.recv_timeout(Duration::from_millis(500)).is_ok() {}
            if let Err(e) = refresh() {
                eprintln!("widget snapshot: {e}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_explicit_widget_open_links_are_accepted() {
        let id = "40a88de0-7176-4be4-b4ea-c9155cae5ce4";
        for kind in ["note", "linked"] {
            assert!(
                super::parse_explicit_open(&format!("folio://widget-open/{kind}/{id}")).is_some()
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
