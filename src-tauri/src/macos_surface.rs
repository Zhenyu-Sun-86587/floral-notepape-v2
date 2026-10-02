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
}
