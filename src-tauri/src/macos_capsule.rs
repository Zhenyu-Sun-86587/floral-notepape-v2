//! Pointer monitoring for Mac capsules; window material lives in macos_material.
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSEvent, NSEventMask};
use std::{cell::RefCell, ptr::NonNull};
use tauri::Manager;
thread_local! {
    static MONITORS: RefCell<Vec<Retained<AnyObject>>> = const { RefCell::new(Vec::new()) };
}
fn install_pointer_monitor(app: &tauri::AppHandle) {
    MONITORS.with(|monitors| {
        let mut monitors = monitors.borrow_mut();
        if !monitors.is_empty() {
            return;
        }
        let mask = NSEventMask::MouseMoved
            | NSEventMask::LeftMouseDragged
            | NSEventMask::LeftMouseUp
            | NSEventMask::ScrollWheel;
        let global_app = app.clone();
        let global = block2::RcBlock::new(move |_: NonNull<NSEvent>| {
            crate::desktop::capsule_pointer_moved(&global_app);
        });
        if let Some(token) = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global) {
            monitors.push(token);
        }
        let local_app = app.clone();
        let local = block2::RcBlock::new(move |event: NonNull<NSEvent>| {
            crate::desktop::capsule_pointer_moved(&local_app);
            event.as_ptr()
        });
        // Pass local events through unchanged. Neither monitor consumes input.
        if let Some(token) =
            unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local) }
        {
            monitors.push(token);
        }
    });
}

pub fn initialize(
    window: &tauri::WebviewWindow,
) -> Result<String, crate::services::notes::AppError> {
    let app = window.app_handle().clone();
    window
        .app_handle()
        .run_on_main_thread(move || install_pointer_monitor(&app))?;
    let radius = if window.label() == "capsule-preview" {
        22.0
    } else {
        18.0
    };
    crate::macos_material::apply(window, radius)
}
