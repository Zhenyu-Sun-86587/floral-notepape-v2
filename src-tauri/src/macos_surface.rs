//! Mac 窗口层级与无激活显示。只调度 AppKit 主线程，不持锁等待 UI。
use crate::surface_sessions::WindowMode;
use objc2::rc::Retained;
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior as Behavior};
use objc2_core_graphics::{CGWindowLevelForKey, CGWindowLevelKey};
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
};
static NOTES_ALL_SPACES: AtomicBool = AtomicBool::new(true);
static CAPSULES_ALL_SPACES: AtomicBool = AtomicBool::new(true);
pub fn hide_main_to_menu_bar(window: &tauri::Window) -> tauri::Result<()> {
    window.hide()?;
    window
        .app_handle()
        .set_activation_policy(tauri::ActivationPolicy::Accessory)
}
thread_local! { static NOTE_MODES: RefCell<HashMap<String, (WindowMode, bool)>> = RefCell::new(HashMap::new()); }
pub fn configure(config: &crate::platform::macos::MacosConfig) {
    crate::macos_material::configure(config);
    NOTES_ALL_SPACES.store(config.notes_on_all_spaces, Ordering::Relaxed);
    CAPSULES_ALL_SPACES.store(config.capsules_on_all_spaces, Ordering::Relaxed);
}
use tauri::{Manager, WebviewWindow};
thread_local! { static BASE_BEHAVIOR: RefCell<HashMap<String, Behavior>> = RefCell::new(HashMap::new()); }

fn collection(base: Behavior, floating: bool, modern: bool, all_spaces: bool) -> Behavior {
    // Spaces、Mission Control、窗口循环、全屏/Stage Manager 分组分别有互斥位。
    let conflicting = Behavior::CanJoinAllSpaces
        | Behavior::MoveToActiveSpace
        | Behavior::Managed
        | Behavior::Transient
        | Behavior::Stationary
        | Behavior::ParticipatesInCycle
        | Behavior::IgnoresCycle
        | Behavior::FullScreenPrimary
        | Behavior::FullScreenAuxiliary
        | Behavior::FullScreenNone
        | Behavior::Primary
        | Behavior::Auxiliary
        | Behavior::CanJoinAllApplications;
    let mut flags = base & !conflicting;
    if all_spaces {
        flags |= Behavior::CanJoinAllSpaces;
    }
    if floating && all_spaces {
        flags |= Behavior::FullScreenAuxiliary;
        if modern {
            flags |= Behavior::CanJoinAllApplications;
        }
    }
    flags
}
fn note_collection(base: Behavior, floating: bool, modern: bool, all_spaces: bool) -> Behavior {
    collection(base, floating, modern, all_spaces)
        | Behavior::Managed
        | Behavior::ParticipatesInCycle
}
fn capsule_collection(base: Behavior, modern: bool, all_spaces: bool) -> Behavior {
    collection(base, true, modern, all_spaces) | Behavior::Stationary | Behavior::IgnoresCycle
}
pub fn unlock_collection(base: Behavior) -> Behavior {
    (base & !(Behavior::Managed | Behavior::Transient | Behavior::ParticipatesInCycle))
        | Behavior::Stationary
        | Behavior::IgnoresCycle
}
pub fn configure_capsule_native(native: &NSWindow) {
    native.setCollectionBehavior(capsule_collection(
        native.collectionBehavior(),
        modern_collections(),
        CAPSULES_ALL_SPACES.load(Ordering::Relaxed),
    ));
    native.setLevel(CGWindowLevelForKey(CGWindowLevelKey::StatusWindowLevelKey) as isize);
    native.setHidesOnDeactivate(false);
}
pub fn show_native_capsule(window: &tauri::Window) -> tauri::Result<()> {
    dispatch(window, move |native| {
        configure_capsule_native(native);
        native.orderFrontRegardless();
    })
}
fn modern_collections() -> bool {
    objc2_foundation::NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        >= 13
}

fn level(mode: WindowMode, locked: bool) -> isize {
    let key = if locked || mode == WindowMode::AlwaysOnTop {
        CGWindowLevelKey::StatusWindowLevelKey
    } else if mode == WindowMode::DesktopAttached {
        CGWindowLevelKey::DesktopIconWindowLevelKey
    } else {
        CGWindowLevelKey::NormalWindowLevelKey
    };
    let level = CGWindowLevelForKey(key) as isize;
    // 在 Finder 图标层上方、普通应用下方，便签自身仍能接受点击。
    if !locked && mode == WindowMode::DesktopAttached {
        level + 1
    } else {
        level
    }
}
pub trait NativeSurface: Clone + Send + Sync + 'static {
    fn native_app(&self) -> &tauri::AppHandle;
    fn ns_window(&self) -> tauri::Result<*mut std::ffi::c_void>;
}
impl NativeSurface for WebviewWindow {
    fn native_app(&self) -> &tauri::AppHandle {
        Manager::app_handle(self)
    }
    fn ns_window(&self) -> tauri::Result<*mut std::ffi::c_void> {
        WebviewWindow::ns_window(self)
    }
}
impl NativeSurface for tauri::Window {
    fn native_app(&self) -> &tauri::AppHandle {
        Manager::app_handle(self)
    }
    fn ns_window(&self) -> tauri::Result<*mut std::ffi::c_void> {
        tauri::Window::ns_window(self)
    }
}
fn dispatch(
    window: &impl NativeSurface,
    action: impl FnOnce(&NSWindow) + Send + 'static,
) -> tauri::Result<()> {
    let w = window.clone();
    window.native_app().run_on_main_thread(move || {
        let result = w.ns_window();
        let native = result.ok().and_then(|ptr| {
            // Tauri 持有的 NSWindow；只在主线程转换并保留到本次操作结束。
            unsafe { Retained::retain(ptr.cast::<NSWindow>()) }
        });
        if let Some(native) = native {
            action(&native);
        } else {
            let message = "Mac 原生窗口已不可用";
            eprintln!("{message}");
        }
    })
}
pub fn apply_mode(
    window: &WebviewWindow,
    mode: WindowMode,
    locked: bool,
) -> Result<(), crate::services::notes::AppError> {
    if !locked {
        crate::macos_lock_overlay::hide(window);
    }
    window.set_ignore_cursor_events(false)?;
    apply(window, mode, locked)?;
    if locked {
        if let Ok(key) = crate::desktop::surface_key_for_window(window) {
            crate::macos_lock_overlay::show(window, key);
        }
    }
    Ok(())
}
pub fn apply(window: &WebviewWindow, mode: WindowMode, locked: bool) -> tauri::Result<()> {
    let label = window.label().to_owned();
    dispatch(window, move |native| {
        NOTE_MODES.with(|map| {
            map.borrow_mut().insert(label.clone(), (mode, locked));
        });
        let base = BASE_BEHAVIOR.with(|map| {
            *map.borrow_mut()
                .entry(label)
                .or_insert_with(|| native.collectionBehavior())
        });
        native.setCollectionBehavior(note_collection(
            base,
            locked || mode == WindowMode::AlwaysOnTop,
            modern_collections(),
            NOTES_ALL_SPACES.load(Ordering::Relaxed),
        ));
        native.setLevel(level(mode, locked));
        native.setHidesOnDeactivate(false);
    })
}
pub fn show_without_activation(window: &WebviewWindow) -> tauri::Result<()> {
    let capsule = window.label().starts_with("capsule-");
    dispatch(window, move |native| {
        if capsule {
            native.setCollectionBehavior(capsule_collection(
                native.collectionBehavior(),
                modern_collections(),
                CAPSULES_ALL_SPACES.load(Ordering::Relaxed),
            ));
            native.setLevel(CGWindowLevelForKey(CGWindowLevelKey::StatusWindowLevelKey) as isize);
            native.setHidesOnDeactivate(false);
        }
        native.orderFrontRegardless();
    })
}
pub fn refresh_config(
    app: &tauri::AppHandle,
    config: &crate::platform::macos::MacosConfig,
) -> tauri::Result<()> {
    let previous = crate::macos_material::current_config();
    let refresh_capsules = previous.as_ref().is_none_or(|old| {
        old.material_enabled != config.material_enabled
            || old.material_effect != config.material_effect
            || old.capsule_opacity != config.capsule_opacity
            || old.capsule_dynamics != config.capsule_dynamics
            || old.capsule_liquid_motion != config.capsule_liquid_motion
    });
    configure(config);
    let config = config.clone();
    let app = app.clone();
    let handle = app.clone();
    handle.run_on_main_thread(move || {
        crate::macos_fluid::configure(&config);
        if refresh_capsules {
            crate::macos_motion::cancel();
            crate::macos_rail::refresh(&app);
        }
        for (label, window) in app.webview_windows() {
            let _ = crate::macos_material::refresh(&window);
            if label.starts_with("capsule-") {
                let all = CAPSULES_ALL_SPACES.load(Ordering::Relaxed);
                let _ = dispatch(&window, move |native| {
                    native.setCollectionBehavior(capsule_collection(
                        native.collectionBehavior(),
                        modern_collections(),
                        all,
                    ));
                });
            } else {
                let mode = NOTE_MODES.with(|map| map.borrow().get(&label).copied());
                if let Some((mode, locked)) = mode {
                    let _ = apply(&window, mode, locked);
                    if locked {
                        if let Ok(key) = crate::desktop::surface_key_for_window(&window) {
                            crate::macos_lock_overlay::show(&window, key);
                        }
                    }
                }
            }
        }
    })
}
pub fn forget(window: &tauri::Window) {
    let label = window.label().to_owned();
    let _ = window.app_handle().run_on_main_thread(move || {
        crate::macos_material::forget(&label);
        crate::macos_rail::forget(&label);
        crate::macos_note_shell::forget(&label);
        BASE_BEHAVIOR.with(|map| {
            map.borrow_mut().remove(&label);
            NOTE_MODES.with(|map| {
                map.borrow_mut().remove(&label);
            });
        });
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn modes_have_distinct_native_levels_and_lock_temporarily_floats() {
        let normal = level(WindowMode::Normal, false);
        let desktop = level(WindowMode::DesktopAttached, false);
        let floating = level(WindowMode::AlwaysOnTop, false);
        assert!(desktop < normal && normal < floating);
        assert_eq!(level(WindowMode::DesktopAttached, true), floating);
    }
    #[test]
    fn notes_join_spaces_and_mission_control_without_conflicting_bits() {
        let base = Behavior::Transient
            | Behavior::Stationary
            | Behavior::MoveToActiveSpace
            | Behavior::IgnoresCycle
            | Behavior::FullScreenPrimary
            | Behavior::Primary;
        let note = note_collection(base, true, true, true);
        assert!(note.contains(
            Behavior::CanJoinAllSpaces
                | Behavior::Managed
                | Behavior::ParticipatesInCycle
                | Behavior::FullScreenAuxiliary
                | Behavior::CanJoinAllApplications
        ));
        assert!(!note.intersects(
            Behavior::Transient
                | Behavior::Stationary
                | Behavior::MoveToActiveSpace
                | Behavior::IgnoresCycle
                | Behavior::FullScreenPrimary
                | Behavior::Primary
                | Behavior::Auxiliary
        ));
        let desktop = note_collection(base, false, true, true);
        assert!(desktop.contains(Behavior::CanJoinAllSpaces | Behavior::Managed));
        assert!(
            !desktop.intersects(Behavior::FullScreenAuxiliary | Behavior::CanJoinAllApplications)
        );
    }
    #[test]
    fn capsule_follows_spaces_without_becoming_a_mission_control_card() {
        let capsule = capsule_collection(
            Behavior::Managed | Behavior::ParticipatesInCycle,
            true,
            true,
        );
        assert!(capsule.contains(
            Behavior::CanJoinAllSpaces
                | Behavior::Stationary
                | Behavior::IgnoresCycle
                | Behavior::FullScreenAuxiliary
                | Behavior::CanJoinAllApplications
        ));
        assert!(!capsule
            .intersects(Behavior::Managed | Behavior::Transient | Behavior::ParticipatesInCycle));
        assert!(!capsule_collection(Behavior::Primary, false, true)
            .contains(Behavior::CanJoinAllApplications));
        let unlock = unlock_collection(note_collection(Behavior::empty(), true, true, true));
        assert!(unlock.contains(
            Behavior::CanJoinAllSpaces | Behavior::FullScreenAuxiliary | Behavior::Stationary
        ));
        assert!(!unlock.contains(Behavior::Managed | Behavior::ParticipatesInCycle));
    }
    #[test]
    fn disabling_spaces_removes_fullscreen_and_old_cross_space_flags() {
        let base = Behavior::CanJoinAllSpaces
            | Behavior::FullScreenAuxiliary
            | Behavior::CanJoinAllApplications;
        for flags in [
            note_collection(base, true, true, false),
            capsule_collection(base, true, false),
        ] {
            assert!(!flags.intersects(base));
        }
        assert!(
            level(WindowMode::AlwaysOnTop, false)
                > CGWindowLevelForKey(CGWindowLevelKey::FloatingWindowLevelKey) as isize
        );
    }
    #[test]
    fn capsule_frame_projects_target_scale_and_negative_screen_origin() {
        let frame = capsule_frame(
            crate::desktop::WindowBounds {
                x: -2400,
                y: -200,
                width: 36,
                height: 176,
            },
            2.0,
            900.0,
        );
        assert_eq!(frame.origin.x, -1200.0);
        assert_eq!(frame.origin.y, 912.0);
        assert_eq!(frame.size.width, 18.0);
        assert_eq!(frame.size.height, 88.0);
    }
}

// Quartz 光标为全局左上原点逻辑坐标，避免跨屏混用窗口/主屏缩放。
pub fn cursor() -> Result<tauri::PhysicalPosition<f64>, crate::services::notes::AppError> {
    use objc2_core_graphics::CGEvent;
    let event = CGEvent::new(None).ok_or_else(|| native_error("无法读取鼠标位置"))?;
    let point = CGEvent::location(Some(&event));
    Ok(tauri::PhysicalPosition::new(point.x, point.y))
}
pub fn event_cursor(event: &objc2_app_kit::NSEvent) -> Option<tauri::PhysicalPosition<f64>> {
    let window = event.window(objc2_foundation::MainThreadMarker::new()?)?;
    let point = window.convertPointToScreen(event.locationInWindow());
    Some(tauri::PhysicalPosition::new(
        point.x,
        primary_top() - point.y,
    ))
}
pub fn left_button_pressed() -> bool {
    use objc2_core_graphics::{CGEventSource, CGEventSourceStateID, CGMouseButton};
    CGEventSource::button_state(
        CGEventSourceStateID::CombinedSessionState,
        CGMouseButton::Left,
    )
}
pub fn escape_pressed() -> bool {
    use objc2_core_graphics::{CGEventSource, CGEventSourceStateID};
    CGEventSource::key_state(CGEventSourceStateID::CombinedSessionState, 53)
}
fn native_error(message: &str) -> crate::services::notes::AppError {
    crate::services::notes::AppError {
        code: "macosCapsule".into(),
        message: message.into(),
        details: Default::default(),
    }
}
fn primary_top() -> f64 {
    use objc2_app_kit::NSScreen;
    use objc2_foundation::MainThreadMarker;
    let screens = NSScreen::screens(MainThreadMarker::new().expect("AppKit main thread"));
    screens
        .firstObject()
        .map(|s| {
            let r = s.frame();
            r.origin.y + r.size.height
        })
        .unwrap_or(0.0)
}
pub fn move_to(window: &tauri::Window, x: f64, y: f64) -> tauri::Result<()> {
    dispatch(window, move |native| {
        native.setFrameTopLeftPoint(objc2_foundation::NSPoint::new(x, primary_top() - y));
    })
}
fn capsule_frame(
    bounds: crate::desktop::WindowBounds,
    scale: f64,
    top: f64,
) -> objc2_foundation::NSRect {
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    NSRect::new(
        NSPoint::new(
            bounds.x as f64 / scale,
            top - (bounds.y as f64 + bounds.height as f64) / scale,
        ),
        NSSize::new(bounds.width as f64 / scale, bounds.height as f64 / scale),
    )
}
/// 隐藏新窗口完成 ready 后，工作线程请求同一次 AppKit 主线程交接。
pub fn present_capsules(
    app: &tauri::AppHandle,
    changes: Vec<(tauri::Window, crate::desktop::WindowBounds, f64, bool)>,
    previous: Vec<crate::desktop::capsule_groups::GroupSurface>,
    next: Vec<crate::desktop::capsule_groups::GroupSurface>,
) -> Result<(), crate::services::notes::AppError> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let handle = app.clone();
    let app = app.clone();
    handle.run_on_main_thread(move || {
        let result = (|| {
            // 先校验整批对象，失败不先隐藏原入口。
            let windows = changes
                .into_iter()
                .map(|(window, bounds, scale, show)| {
                    let ptr = window
                        .ns_window()
                        .map_err(|_| native_error("胶囊窗口已关闭"))?;
                    let native = unsafe { Retained::retain(ptr.cast::<NSWindow>()) }
                        .ok_or_else(|| native_error("胶囊原生窗口不可用"))?;
                    Ok((native, bounds, scale, show))
                })
                .collect::<Result<Vec<_>, crate::services::notes::AppError>>()?;
            let start_frames = crate::macos_motion::capture(&app, &previous);
            let top = primary_top();
            for (native, bounds, scale, show) in &windows {
                if *show {
                    native.setCollectionBehavior(capsule_collection(
                        native.collectionBehavior(),
                        modern_collections(),
                        CAPSULES_ALL_SPACES.load(Ordering::Relaxed),
                    ));
                    native.setLevel(
                        CGWindowLevelForKey(CGWindowLevelKey::StatusWindowLevelKey) as isize
                    );
                    native.setHidesOnDeactivate(false);
                    native.setFrame_display(capsule_frame(*bounds, *scale, top), true);
                    native.orderFrontRegardless();
                }
            }
            crate::macos_motion::transition(&app, &previous, &next, start_frames);
            for (native, _, _, show) in &windows {
                if !show {
                    native.orderOut(None);
                }
            }
            for group in &previous {
                if !next
                    .iter()
                    .any(|g| g.native_label() == group.native_label())
                {
                    crate::macos_rail::forget(group.native_label());
                }
            }
            Ok(())
        })();
        let _ = sender.send(result);
    })?;
    receiver
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| native_error("胶囊窗口交接超时"))?
}

pub fn position_surface(
    window: &WebviewWindow,
    bounds: crate::desktop::WindowBounds,
    scale: f64,
) -> tauri::Result<()> {
    let w = window.clone();
    dispatch(window, move |native| {
        native.setFrame_display(capsule_frame(bounds, scale, primary_top()), true);
        if let Some(window) = w.app_handle().get_webview_window(w.label()) {
            let _ = crate::macos_material::layout(&window);
        }
    })
}
