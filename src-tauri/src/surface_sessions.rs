use crate::{
    linked,
    services::notes::{default_store, AppError},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StartupBehavior {
    #[default]
    Hidden,
    RestoreLast,
    Expanded,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Presentation {
    Expanded,
    Stored,
    #[default]
    Hidden,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CapsuleSide {
    Left,
    Top,
    #[default]
    Right,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WindowMode {
    Normal,
    #[default]
    AlwaysOnTop,
    DesktopAttached,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutToggleAction {
    #[default]
    Store,
    Hide,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandedBounds {
    // 偏移和尺寸均为选定显示器缩放下的逻辑像素，避免混用 Windows 全局物理坐标。
    pub monitor_name: Option<String>,
    pub offset_x: f64,
    pub offset_y: f64,
    pub width: f64,
    pub height: f64,
    pub saved_scale: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceSession {
    pub key: String,
    #[serde(default)]
    pub startup_behavior: StartupBehavior,
    #[serde(default)]
    pub presentation: Presentation,
    #[serde(default)]
    pub shortcut: String,
    #[serde(default)]
    pub shortcut_toggle_action: ShortcutToggleAction,
    #[serde(default)]
    pub capsule_color_key: Option<u8>,
    #[serde(default)]
    pub window_mode: WindowMode,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub capsule_side: CapsuleSide,
    // 收纳位置独立于展开坐标；拖动边缘条不得覆盖便签原窗口的位置。
    #[serde(default)]
    pub capsule_monitor: Option<String>,
    #[serde(default)]
    pub capsule_offset: Option<f64>,
    #[serde(default)]
    pub expanded_bounds: Option<ExpandedBounds>,
}

static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
fn lock() -> &'static Mutex<()> {
    LOCK.get_or_init(|| Mutex::new(()))
}
fn error(message: impl Into<String>) -> AppError {
    AppError {
        code: "surfaceSession".into(),
        message: message.into(),
        details: Default::default(),
    }
}
fn path() -> Result<PathBuf, AppError> {
    Ok(default_store()?.config_dir().join("surface-sessions.json"))
}
fn read_map() -> Result<BTreeMap<String, SurfaceSession>, AppError> {
    let path = path()?;
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}
fn write_map(map: &BTreeMap<String, SurfaceSession>) -> Result<(), AppError> {
    linked::write_linked_json(&path()?, map)
}
pub fn list() -> Result<Vec<SurfaceSession>, AppError> {
    let _guard = lock().lock().map_err(|_| error("会话锁不可用"))?;
    Ok(read_map()?.into_values().collect())
}
pub fn get(key: &str) -> Result<SurfaceSession, AppError> {
    validate_key(key)?;
    let _guard = lock().lock().map_err(|_| error("会话锁不可用"))?;
    Ok(read_map()?.remove(key).unwrap_or_else(|| SurfaceSession {
        key: key.into(),
        ..Default::default()
    }))
}
pub fn update(session: SurfaceSession) -> Result<(), AppError> {
    validate_key(&session.key)?;
    let _guard = lock().lock().map_err(|_| error("会话锁不可用"))?;
    let mut map = read_map()?;
    map.insert(session.key.clone(), session);
    write_map(&map)
}
pub fn mutate(key: &str, change: impl FnOnce(&mut SurfaceSession)) -> Result<(), AppError> {
    validate_key(key)?;
    let _guard = lock().lock().map_err(|_| error("会话锁不可用"))?;
    let mut map = read_map()?;
    let session = map
        .entry(key.to_string())
        .or_insert_with(|| SurfaceSession {
            key: key.into(),
            ..Default::default()
        });
    change(session);
    write_map(&map)
}

pub fn ensure_capsule_colors() -> Result<(), AppError> {
    let _guard = lock().lock().map_err(|_| error("会话锁不可用"))?;
    let mut map = read_map()?;
    let missing: Vec<String> = map
        .values()
        .filter(|session| {
            session.presentation == Presentation::Stored && session.capsule_color_key.is_none()
        })
        .map(|session| session.key.clone())
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    for key in missing {
        let Some(session) = map.get(&key).cloned() else {
            continue;
        };
        let mut counts = [0usize; 8];
        for other in map.values().filter(|other| {
            other.key != key
                && other.presentation == Presentation::Stored
                && other.capsule_side == session.capsule_side
                && other.capsule_monitor == session.capsule_monitor
        }) {
            if let Some(color) = other.capsule_color_key.filter(|color| *color < 8) {
                // 邻近成员的颜色优先避开；颜色身份只在首次分配时保存。
                let distance = (other.capsule_offset.unwrap_or(0.5)
                    - session.capsule_offset.unwrap_or(0.5))
                .abs();
                counts[color as usize] += if distance < 0.08 { 8 } else { 1 };
            }
        }
        let color = counts
            .iter()
            .enumerate()
            .min_by_key(|(index, count)| (**count, *index))
            .map(|(index, _)| index as u8)
            .unwrap_or(0);
        if let Some(value) = map.get_mut(&key) {
            value.capsule_color_key = Some(color);
        }
    }
    write_map(&map)
}
pub fn remove(key: &str) -> Result<(), AppError> {
    validate_key(key)?;
    let _guard = lock().lock().map_err(|_| error("会话锁不可用"))?;
    let mut map = read_map()?;
    map.remove(key);
    write_map(&map)
}

pub fn dock_capsules(
    keys: &[String],
    side: CapsuleSide,
    monitor: Option<String>,
    offset: f64,
) -> Result<(), AppError> {
    let _guard = lock().lock().map_err(|_| error("会话锁不可用"))?;
    let mut map = read_map()?;
    for key in keys {
        if let Some(session) = map.get_mut(key) {
            session.capsule_side = side;
            session.capsule_monitor = monitor.clone();
            session.capsule_offset = Some(offset.clamp(0.0, 1.0));
        }
    }
    write_map(&map)
}
pub fn validate_key(key: &str) -> Result<(), AppError> {
    let id = key
        .strip_prefix("note:")
        .or_else(|| key.strip_prefix("linked:"))
        .ok_or_else(|| error("无效的便签会话类型"))?;
    Uuid::parse_str(id).map_err(|_| error("无效的便签会话 ID"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ShortcutToggleAction, SurfaceSession};

    #[test]
    fn old_session_keeps_shortcut_store_default_and_needs_color_allocation() {
        let old = r#"{"key":"note:00000000-0000-0000-0000-000000000001","presentation":"stored","shortcut":"Ctrl+Alt+T"}"#;
        let session: SurfaceSession = serde_json::from_str(old).expect("旧会话可读取");
        assert_eq!(session.shortcut_toggle_action, ShortcutToggleAction::Store);
        assert_eq!(session.capsule_color_key, None);
        assert_eq!(session.shortcut, "Ctrl+Alt+T");
    }
}
