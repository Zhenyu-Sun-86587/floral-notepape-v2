//! WidgetKit snapshot boundary. Only explicitly selected notes cross into the
//! widget snapshot container; widgets never read or modify the live note store.
use crate::{
    json_io::write_json_atomic,
    services::notes::{default_store, AppError},
};
use serde::{Deserialize, Serialize};
use std::{
    ffi::{CStr, CString},
    sync::{mpsc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{Emitter, Listener};
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static SNAPSHOT_WRITE_LOCK: Mutex<()> = Mutex::new(());
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
    displays: Vec<Display>,
}
const DISPLAY_COUNT: usize = 4;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    note_key: Option<String>,
    text_size: String,
}
impl Default for Display {
    fn default() -> Self {
        Self {
            note_key: None,
            text_size: "standard".into(),
        }
    }
}
#[derive(Serialize)]
pub struct Choice {
    key: String,
    title: String,
}
#[derive(Serialize)]
struct Snapshot {
    notes: Vec<WidgetNote>,
    displays: Vec<Display>,
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
fn displays() -> Result<Vec<Display>, AppError> {
    let path = default_store()?.config_dir().join("widget-displays.json");
    if !path.exists() {
        // Preserve sharing permissions; do not infer an old widget's choice
        // from snapshot order or from its size when system decoding failed.
        return Ok(vec![Display::default(); DISPLAY_COUNT]);
    }
    let displays: Vec<Display> = serde_json::from_slice(&std::fs::read(path)?)?;
    if displays.len() != DISPLAY_COUNT
        || displays
            .iter()
            .any(|d| !matches!(d.text_size.as_str(), "compact" | "standard" | "large"))
    {
        return Err(error("小组件显示配置无效，请检查配置备份"));
    }
    Ok(displays)
}
fn validate_display(
    display: &Display,
    selection: &[String],
    choices: &[Choice],
) -> Result<(), AppError> {
    if !matches!(display.text_size.as_str(), "compact" | "standard" | "large")
        || display
            .note_key
            .as_ref()
            .is_some_and(|key| !selection.contains(key) || !choices.iter().any(|c| &c.key == key))
    {
        return Err(error("请选择已允许共享的现有便签和有效字号"));
    }
    Ok(())
}
pub fn configure(slot: usize, display: Display) -> Result<Status, AppError> {
    let guard = SNAPSHOT_WRITE_LOCK
        .lock()
        .map_err(|_| error("小组件快照锁不可用"))?;
    let s = status()?;
    if !s.available {
        return Err(error("当前安装包未启用小组件"));
    }
    if !(1..=DISPLAY_COUNT).contains(&slot) {
        return Err(error("无效小组件编号"));
    }
    validate_display(&display, &s.selected, &s.choices)?;
    // One slot changes under the same lock as sharing/task operations.
    let mut displays = s.displays;
    displays[slot - 1] = display;
    write_json_atomic(
        &default_store()?.config_dir().join("widget-displays.json"),
        &displays,
    )?;
    drop(guard);
    refresh()?;
    status()
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
        displays: displays()?,
    })
}
pub fn select(keys: Vec<String>) -> Result<Status, AppError> {
    let guard = SNAPSHOT_WRITE_LOCK
        .lock()
        .map_err(|_| error("小组件快照锁不可用"))?;
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
    drop(guard);
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
    let _guard = SNAPSHOT_WRITE_LOCK
        .lock()
        .map_err(|_| error("小组件快照锁不可用"))?;
    if !unsafe { folio_widgets_available() } {
        return Ok(());
    }
    let store = default_store()?;
    let mut notes = Vec::new();
    let selection: Vec<_> = selected()?.into_iter().take(32).collect();
    let ids: Vec<_> = selection
        .iter()
        .filter_map(|key| key.strip_prefix("note:"))
        .collect();
    let mut internal = store.widget_note_contents(&ids)?;
    for key in selection {
        let Some((kind, id)) = key.split_once(':') else {
            continue;
        };
        // UUIDs only; never interpret a widget URL as a filesystem path.
        if uuid::Uuid::parse_str(id).is_err() {
            continue;
        }
        let note = match kind {
            "note" => internal.remove(id),
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
    let json = CString::new(serde_json::to_string(&Snapshot {
        notes,
        displays: displays()?,
    })?)
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
    #[serde(default)]
    slot: Option<usize>,
}

fn apply_task(content: &str, change: &TaskChange) -> Result<String, AppError> {
    if content.chars().take(4000).collect::<String>() != change.expected_content {
        return Err(error("便签已变化，请刷新小组件后重试"));
    }
    if change.line >= change.expected_content.split_inclusive('\n').count() {
        return Err(error("待办不在已发布快照内"));
    }
    let mut offset = 0;
    let mut fence: Option<(u8, usize)> = None;
    for (index, raw) in content.split_inclusive('\n').enumerate() {
        let trimmed = raw.trim_start();
        let bytes = trimmed.as_bytes();
        if let Some(&marker @ (b'`' | b'~')) = bytes.first() {
            let length = bytes.iter().take_while(|&&b| b == marker).count();
            if let Some((open, count)) = fence {
                if marker == open && length >= count && trimmed[length..].trim().is_empty() {
                    fence = None;
                }
            } else if length >= 3 {
                fence = Some((marker, length));
            }
        }
        if index == change.line {
            let marker = trimmed.as_bytes();
            if fence.is_some()
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
        // Selection revocation and task application are one ordered boundary.
        let _guard = SNAPSHOT_WRITE_LOCK
            .lock()
            .map_err(|_| error("小组件快照锁不可用"))?;
        if bytes.len() > 32768 {
            return Err(error("小组件操作过大"));
        }
        let change: TaskChange = serde_json::from_slice(bytes)?;
        if !selected()?.contains(&change.note_key) {
            return Err(error("便签未授权给小组件"));
        }
        let current_displays = displays()?;
        if !change
            .slot
            .filter(|slot| (1..=DISPLAY_COUNT).contains(slot))
            .is_some_and(|slot| {
                current_displays[slot - 1].note_key.as_ref() == Some(&change.note_key)
            })
        {
            return Err(error("小组件已切换便签，请刷新后重试"));
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
            let _ = app.emit("widget-note-updated", &change.note_key);
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
        let mut failed = refresh().is_err();
        let mut retries = 0u32;
        loop {
            // Container creation or authorization may lag launch. Retry only
            // after failure, with a bounded backoff; healthy idle apps sleep.
            let event = if failed && retries < 5 {
                match rx.recv_timeout(Duration::from_secs((2u64 << retries).min(30))) {
                    Ok(()) => true,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        retries += 1;
                        false
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            } else {
                if rx.recv().is_err() {
                    break;
                }
                true
            };
            if event {
                retries = 0;
            }
            // Coalesce bursts but still publish during continuous typing.
            let deadline = Instant::now()
                + if event {
                    Duration::from_secs(2)
                } else {
                    Duration::ZERO
                };
            while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
                if rx
                    .recv_timeout(remaining.min(Duration::from_millis(500)))
                    .is_err()
                {
                    break;
                }
            }
            failed = match refresh() {
                Ok(()) => false,
                Err(e) => {
                    eprintln!("widget snapshot: {e}");
                    true
                }
            };
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn display_assignments_require_existing_shared_notes_and_valid_text_size() {
        let choices = vec![
            super::Choice {
                key: "note:internal".into(),
                title: "same".into(),
            },
            super::Choice {
                key: "linked:external".into(),
                title: "same".into(),
            },
        ];
        let selection: Vec<String> = vec!["note:internal".into(), "linked:external".into()];
        for key in &selection {
            let display = super::Display {
                note_key: Some(key.clone()),
                text_size: "standard".into(),
            };
            assert!(super::validate_display(&display, &selection, &choices).is_ok());
            assert!(super::validate_display(&display, &[], &choices).is_err());
            assert!(super::validate_display(&display, &selection, &[]).is_err());
        }
        assert!(super::validate_display(&super::Display::default(), &[], &[]).is_ok());
        assert!(super::validate_display(
            &super::Display {
                note_key: None,
                text_size: "invalid".into()
            },
            &selection,
            &choices
        )
        .is_err());
    }
    #[test]
    fn tasks_reject_mixed_fences_and_lines_outside_published_prefix() {
        let content = "````\n```\n- [ ] code\n````\n- [ ] real";
        let mut change = super::TaskChange {
            note_key: String::new(),
            expected_content: content.into(),
            line: 2,
            checked: true,
            slot: None,
        };
        assert!(super::apply_task(content, &change).is_err());
        change.line = 4;
        assert!(super::apply_task(content, &change)
            .unwrap()
            .ends_with("- [x] real"));
        let long = format!("{}\n- [ ] unpublished", "a".repeat(4000));
        change.expected_content = "a".repeat(4000);
        change.line = 1;
        assert!(super::apply_task(&long, &change).is_err());
    }
    #[test]
    fn task_update_preserves_other_content_and_rejects_stale_or_code_lines() {
        let content = "# 中文\r\n- [ ] 重复\r\n- [ ] 重复\r\n尾部";
        let mut change = super::TaskChange {
            note_key: String::new(),
            expected_content: content.into(),
            line: 2,
            checked: true,
            slot: None,
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
