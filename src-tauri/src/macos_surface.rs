//! Mac 窗口层级与无激活显示。只调度 AppKit 主线程，不持锁等待 UI。
use crate::surface_sessions::WindowMode;
use objc2::rc::Retained;
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior as Behavior};
use objc2_core_graphics::{CGWindowLevelForKey, CGWindowLevelKey};
use std::{cell::RefCell, collections::HashMap};
use tauri::{Emitter, Manager, WebviewWindow};
thread_local! { static BASE_BEHAVIOR: RefCell<HashMap<String, Behavior>> = RefCell::new(HashMap::new()); }

fn collection(base: Behavior, desktop: bool) -> Behavior {
    if !desktop {
        return base;
    }
    // Managed/Transient/Stationary 以及 Cycle 两组选项各自互斥。
    let conflicting = Behavior::Managed | Behavior::Transient | Behavior::ParticipatesInCycle;
    (base & !conflicting) | Behavior::Stationary | Behavior::IgnoresCycle
}
fn level(mode: WindowMode, locked: bool) -> isize {
    let key = if locked || mode == WindowMode::AlwaysOnTop {
        CGWindowLevelKey::FloatingWindowLevelKey
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
fn dispatch(
    window: &WebviewWindow,
    action: impl FnOnce(&NSWindow) + Send + 'static,
) -> tauri::Result<()> {
    let w = window.clone();
    window.app_handle().run_on_main_thread(move || {
        let result = w.ns_window();
        let native = result.ok().and_then(|ptr| {
            // Tauri 持有的 NSWindow；只在主线程转换并保留到本次操作结束。
            unsafe { Retained::retain(ptr.cast::<NSWindow>()) }
        });
        if let Some(native) = native {
            action(&native);
        } else {
            let message = "Mac 原生窗口已不可用";
            eprintln!("{}: {message}", w.label());
            let _ = w.emit("surface-native-error", message);
        }
    })
}
pub fn apply(window: &WebviewWindow, mode: WindowMode, locked: bool) -> tauri::Result<()> {
    let label = window.label().to_owned();
    dispatch(window, move |native| {
        let base = BASE_BEHAVIOR.with(|map| {
            *map.borrow_mut()
                .entry(label)
                .or_insert_with(|| native.collectionBehavior())
        });
        native.setCollectionBehavior(collection(
            base,
            !locked && mode == WindowMode::DesktopAttached,
        ));
        native.setLevel(level(mode, locked));
        native.setHidesOnDeactivate(false);
    })
}
pub fn show_without_activation(window: &WebviewWindow) -> tauri::Result<()> {
    dispatch(window, |native| {
        native.orderFrontRegardless();
    })
}
pub fn forget(window: &tauri::Window) {
    let label = window.label().to_owned();
    let _ = window.app_handle().run_on_main_thread(move || {
        BASE_BEHAVIOR.with(|map| {
            map.borrow_mut().remove(&label);
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
    fn desktop_behavior_is_stationary_without_forcing_all_spaces() {
        let base = Behavior::Managed | Behavior::ParticipatesInCycle;
        let desktop = collection(base, true);
        assert!(desktop.contains(Behavior::Stationary | Behavior::IgnoresCycle));
        assert!(!desktop.intersects(
            Behavior::Managed
                | Behavior::Transient
                | Behavior::ParticipatesInCycle
                | Behavior::CanJoinAllSpaces
        ));
        assert_eq!(collection(base, false), base);
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
pub fn move_to(window: &WebviewWindow, x: f64, y: f64) -> tauri::Result<()> {
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
    changes: Vec<(WebviewWindow, crate::desktop::WindowBounds, f64, bool)>,
) -> Result<(), crate::services::notes::AppError> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
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
            let top = primary_top();
            for (native, bounds, scale, show) in &windows {
                if *show {
                    native.setFrame_display(capsule_frame(*bounds, *scale, top), true);
                    native.orderFrontRegardless();
                }
            }
            for (native, _, _, show) in &windows {
                if !show {
                    native.orderOut(None);
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
    dispatch(window, move |native| {
        native.setFrame_display(capsule_frame(bounds, scale, primary_top()), true);
    })
}
