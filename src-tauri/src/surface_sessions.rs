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
    #[default]
    Hidden,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WindowMode {
    Normal,
    #[default]
    AlwaysOnTop,
    DesktopAttached,
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
    pub window_mode: WindowMode,
    #[serde(default)]
    pub locked: bool,
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
pub fn remove(key: &str) -> Result<(), AppError> {
    validate_key(key)?;
    let _guard = lock().lock().map_err(|_| error("会话锁不可用"))?;
    let mut map = read_map()?;
    map.remove(key);
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
