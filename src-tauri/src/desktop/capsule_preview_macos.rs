use super::*;

const CAPSULE_PREVIEW_LABEL: &str = "capsule-preview";
static PREVIEW_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static PREVIEW_CONTENT: Mutex<Option<CapsulePreview>> = Mutex::new(None);
static PREVIEW_ACTIVE: AtomicBool = AtomicBool::new(false);
static CHECK_PENDING: AtomicBool = AtomicBool::new(false);
static POINTER_CHECK_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static PREVIEW_OCCUPANCY: Mutex<PreviewOccupancy> = Mutex::new(PreviewOccupancy {
    rail_key: None,
    preview_inside: false,
    interacting: false,
    menu_open: false,
    outside_since: None,
});

pub(super) struct PreviewOccupancy {
    pub(super) rail_key: Option<String>,
    pub(super) preview_inside: bool,
    pub(super) interacting: bool,
    pub(super) menu_open: bool,
    pub(super) outside_since: Option<std::time::Instant>,
}

impl PreviewOccupancy {
    pub(super) fn should_close(&mut self, now: std::time::Instant) -> bool {
        if self.rail_key.is_some() || self.preview_inside || self.interacting || self.menu_open {
            self.outside_since = None;
            return false;
        }
        now.duration_since(*self.outside_since.get_or_insert(now))
            >= std::time::Duration::from_millis(550)
    }
}

fn cursor_in_window(window: &tauri::WebviewWindow, point: PhysicalPosition<f64>) -> bool {
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    let point = {
        let Ok(scale) = window.scale_factor() else {
            return false;
        };
        PhysicalPosition::new(point.x * scale, point.y * scale)
    };
    let (Ok(origin), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return false;
    };
    point.x >= origin.x as f64
        && point.y >= origin.y as f64
        && point.x < origin.x as f64 + size.width as f64
        && point.y < origin.y as f64 + size.height as f64
}

// No interval or idle polling. Pointer events and occupancy changes schedule a
// debounced native check; only an outside transition arms the grace deadline.
pub fn capsule_pointer_moved(app: &AppHandle) {
    schedule_check(app, 60);
}
fn schedule_check(app: &AppHandle, delay_ms: u64) {
    if !PREVIEW_ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    let epoch = POINTER_CHECK_EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
    // At most one timer for a burst of pointer events (including high-rate mice).
    if CHECK_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        CHECK_PENDING.store(false, Ordering::SeqCst);
        if POINTER_CHECK_EPOCH.load(Ordering::SeqCst) != epoch {
            schedule_check(&app, 60);
            return;
        }
        let handle = app.clone();
        let _ = run_capsule_task(move || {
            if POINTER_CHECK_EPOCH.load(Ordering::SeqCst) != epoch {
                return Ok(());
            }
            if check_capsule_preview(&handle)? {
                let outside = PREVIEW_OCCUPANCY
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .outside_since
                    .is_some();
                if outside {
                    schedule_check(&handle, 560);
                }
            }
            Ok(())
        })
        .await;
    });
}

fn check_capsule_preview(app: &AppHandle) -> Result<bool, AppError> {
    if PREVIEW_CONTENT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_none()
    {
        return Ok(false);
    }
    let Some(window) = app.get_webview_window(CAPSULE_PREVIEW_LABEL) else {
        return Ok(false);
    };
    // 原生坐标不依赖 WebView 的 pointerleave；跨窗、失焦或隐藏时漏事件也能收尾。
    let Ok(point) = capsule_cursor(&window) else {
        return Ok(true);
    };
    let rail_key = PREVIEW_OCCUPANCY
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .rail_key
        .clone();
    let over_rail = rail_key
        .as_deref()
        .and_then(capsule_groups::owner_label)
        .and_then(|label| app.get_webview_window(&label))
        .is_some_and(|rail| cursor_in_window(&rail, point));
    let over_preview = cursor_in_window(&window, point);
    let mut state = PREVIEW_OCCUPANCY.lock().unwrap_or_else(|e| e.into_inner());
    // 位置查询期间可能收到新 rail enter，不能用旧坐标结果清掉新 owner。
    if !over_rail && state.rail_key == rail_key {
        state.rail_key = None;
    }
    state.preview_inside = over_preview;
    if !crate::macos_surface::left_button_pressed() {
        state.interacting = false;
    }
    let close = state.should_close(std::time::Instant::now());
    drop(state);
    if close {
        dismiss_capsule_preview(app)?;
        return Ok(false);
    }
    Ok(true)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsulePreview {
    pub(super) entry: CapsuleEntry,
    side: crate::surface_sessions::CapsuleSide,
    generation: u64,
}

pub fn advance_capsule_preview() -> u64 {
    PREVIEW_GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

pub fn capsule_preview_state() -> Option<CapsulePreview> {
    PREVIEW_CONTENT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

pub fn present_capsule_preview(
    window: &tauri::WebviewWindow,
    generation: u64,
) -> Result<(), AppError> {
    if window.label() == CAPSULE_PREVIEW_LABEL
        && PREVIEW_GENERATION.load(Ordering::SeqCst) == generation
    {
        show_silent_surface(window)?;
    }
    Ok(())
}

pub fn capsule_hover(
    app: &AppHandle,
    inside: bool,
    source: &str,
    key: Option<&str>,
    session: Option<u64>,
) -> u64 {
    let mut occupancy = PREVIEW_OCCUPANCY.lock().unwrap_or_else(|e| e.into_inner());
    // hover 热路径只比对身份，不克隆完整 Markdown 正文。
    let current = PREVIEW_CONTENT.lock().unwrap_or_else(|e| e.into_inner());
    let previous_rail = occupancy.rail_key.clone();
    match source {
        "rail" if inside => occupancy.rail_key = key.map(str::to_owned),
        "rail" if occupancy.rail_key.as_deref() == key => occupancy.rail_key = None,
        "preview"
            if current.as_ref().is_some_and(|value| {
                Some(value.entry.key.as_str()) == key && Some(value.generation) == session
            }) =>
        {
            occupancy.preview_inside = inside
        }
        "interaction"
            if current.as_ref().is_some_and(|value| {
                Some(value.entry.key.as_str()) == key && Some(value.generation) == session
            }) =>
        {
            occupancy.interacting = inside
        }
        "menu" => occupancy.menu_open = inside,
        _ => return PREVIEW_GENERATION.load(Ordering::SeqCst),
    }
    drop(current);
    let occupied = occupancy.rail_key.is_some()
        || occupancy.preview_inside
        || occupancy.interacting
        || occupancy.menu_open;
    if occupied {
        occupancy.outside_since = None;
    }
    let generation = if source == "rail" && inside && previous_rail.as_deref() != key {
        advance_capsule_preview()
    } else {
        PREVIEW_GENERATION.load(Ordering::SeqCst)
    };
    drop(occupancy);
    schedule_check(app, 60);
    generation
}

fn capsule_layout_cross_inset(scale: f64) -> i32 {
    {
        (crate::capsule_layout::CROSS * scale).round() as i32
    }
}
fn preview_window(app: &AppHandle) -> Result<tauri::WebviewWindow, AppError> {
    if let Some(window) = app.get_webview_window(CAPSULE_PREVIEW_LABEL) {
        Ok(window)
    } else {
        let builder = WebviewWindowBuilder::new(
            app,
            CAPSULE_PREVIEW_LABEL,
            WebviewUrl::App("capsule.html?preview=1".into()),
        )
        .title("便签预览")
        .inner_size(300.0, 200.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false);
        let window = builder.accept_first_mouse(true).build()?;
        Ok(window)
    }
}

/// Warm the hidden renderer/material once; first hover must not pay startup cost.
pub fn prewarm_capsule_preview(app: &AppHandle) -> Result<(), AppError> {
    if crate::surface_sessions::list()?
        .iter()
        .any(|session| session.presentation == crate::surface_sessions::Presentation::Stored)
    {
        let _ = preview_window(app)?;
    }
    Ok(())
}

pub fn show_capsule_preview(
    rail: &tauri::WebviewWindow,
    key: &str,
    anchor_y: f64,
    anchor_x: f64,
    generation: u64,
) -> Result<(), AppError> {
    if PREVIEW_GENERATION.load(Ordering::SeqCst) != generation {
        return Ok(());
    }
    let Some(group) = capsule_groups::owner(rail.label(), key) else {
        return Ok(());
    };
    let index = group.monitor_index();
    let side = group.side;
    let app = rail.app_handle();
    if !anchor_y.is_finite() || !anchor_x.is_finite() || CAPSULE_DRAGGING.load(Ordering::SeqCst) {
        return Ok(());
    }
    // 悬停预览已经可见时，随后单击同一胶囊无需再次读盘或重新渲染。
    if app
        .get_webview_window(CAPSULE_PREVIEW_LABEL)
        .is_some_and(|window| window.is_visible().unwrap_or(false))
        && PREVIEW_CONTENT
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .is_some_and(|preview| preview.entry.key == key && preview.generation == generation)
    {
        return Ok(());
    }
    let Some(entry) = capsule_entry(key)? else {
        return Ok(());
    };
    if PREVIEW_OCCUPANCY
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .rail_key
        .as_deref()
        != Some(key)
    {
        return Ok(());
    }
    let monitors = app.available_monitors()?;
    let Some(monitor) = monitors.get(index) else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let width = (360.0 * scale).round().min(work.size.width as f64) as u32;
    let lines = entry.preview.lines().take(10).count().clamp(2, 10) as f64;
    let height = ((112.0 + lines * 27.0).clamp(190.0, 390.0) * scale)
        .round()
        .min(work.size.height as f64) as u32;
    let inset = (12.0 * scale).round() as i32;
    let edge = (work.position, work.size);
    let x = if side == crate::surface_sessions::CapsuleSide::Top {
        (rail.outer_position()?.x + (anchor_x * scale).round() as i32 - width as i32 / 2).clamp(
            work.position.x,
            work.position.x + work.size.width as i32 - width as i32,
        )
    } else if side == crate::surface_sessions::CapsuleSide::Left {
        edge.0.x + capsule_layout_cross_inset(scale) + inset
    } else {
        edge.0.x + edge.1.width as i32 - capsule_layout_cross_inset(scale) - width as i32 - inset
    };
    let x = x.clamp(
        work.position.x,
        work.position.x + work.size.width as i32 - width as i32,
    );
    let rail_y = rail.outer_position()?.y;
    let y = (if side == crate::surface_sessions::CapsuleSide::Top {
        edge.0.y + (capsule_layout_cross_inset(scale)) + inset
    } else {
        rail_y + (anchor_y * scale).round() as i32 - (22.0 * scale).round() as i32
    })
    .clamp(
        work.position.y,
        work.position.y + work.size.height as i32 - height as i32,
    );
    let window = preview_window(app)?;
    if PREVIEW_GENERATION.load(Ordering::SeqCst) != generation {
        return Ok(());
    }
    crate::macos_surface::position_surface(
        &window,
        WindowBounds {
            x,
            y,
            width,
            height,
        },
        scale,
    )?;
    let preview = CapsulePreview {
        entry,
        side,
        generation,
    };
    {
        let mut content = PREVIEW_CONTENT.lock().unwrap_or_else(|e| e.into_inner());
        *content = Some(preview.clone());
    }
    let mut occupancy = PREVIEW_OCCUPANCY.lock().unwrap_or_else(|e| e.into_inner());
    occupancy.preview_inside = false;
    occupancy.interacting = false;
    occupancy.outside_since = None;
    drop(occupancy);
    PREVIEW_ACTIVE.store(true, Ordering::Relaxed);
    app.emit_to(CAPSULE_PREVIEW_LABEL, "capsule-preview-changed", preview)?;
    schedule_check(app, 60);
    // 首次加载通过 state 命令读取同一份数据；渲染完成后再 present，避免空白闪烁。
    Ok(())
}

fn hide_capsule_preview_window(window: &tauri::WebviewWindow) -> Result<(), AppError> {
    window.hide()?;
    Ok(())
}

pub fn dismiss_capsule_preview(app: &AppHandle) -> Result<(), AppError> {
    PREVIEW_ACTIVE.store(false, Ordering::Relaxed);
    POINTER_CHECK_EPOCH.fetch_add(1, Ordering::SeqCst);
    let generation = advance_capsule_preview();
    *PREVIEW_CONTENT.lock().unwrap_or_else(|e| e.into_inner()) = None;
    let mut occupancy = PREVIEW_OCCUPANCY.lock().unwrap_or_else(|e| e.into_inner());
    occupancy.preview_inside = false;
    occupancy.interacting = false;
    occupancy.rail_key = None;
    occupancy.outside_since = None;
    drop(occupancy);
    if let Some(window) = app.get_webview_window(CAPSULE_PREVIEW_LABEL) {
        hide_capsule_preview_window(&window)?;
    }
    app.emit_to(CAPSULE_PREVIEW_LABEL, "capsule-preview-hidden", generation)?;
    Ok(())
}
