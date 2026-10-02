//! Native capsule host. All AppKit work runs on the main thread. One glass view
//! per rail/card, not one effect per button; pointer monitors never poll at idle.
use crate::services::notes::AppError;
use objc2::{
    msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyClass, AnyObject},
    MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSColor, NSEvent, NSEventMask, NSView, NSWindow};
use std::{cell::RefCell, collections::HashMap, ptr::NonNull};
use tauri::{Manager, WebviewWindow};

thread_local! {
    static MATERIALS: RefCell<HashMap<String, String>> = RefCell::new(HashMap::new());
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

/// Called only from a blocking command worker, never an AppKit callback.
pub fn material(window: &WebviewWindow) -> Result<String, AppError> {
    if !window.label().starts_with("capsule-") {
        return Err(AppError {
            code: "capsuleMaterial".into(),
            message: "只允许胶囊窗口设置材质".into(),
            details: Default::default(),
        });
    }
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let w = window.clone();
    window.app_handle().run_on_main_thread(move || {
        install_pointer_monitor(w.app_handle());
        let result = MATERIALS.with(|cache| {
            if let Some(value) = cache.borrow().get(w.label()) {
                return Ok(value.clone());
            }
            let native = w.ns_window().map_err(AppError::from)?;
            let native = unsafe { &*native.cast::<NSWindow>() };
            let root = native.contentView().ok_or_else(|| AppError {
                code: "capsuleMaterial".into(),
                message: "原生内容视图不可用".into(),
                details: Default::default(),
            })?;
            let mtm = MainThreadMarker::new().expect("AppKit main thread");
            let workspace = AnyClass::get(c"NSWorkspace").expect("NSWorkspace");
            let reduce: bool = unsafe {
                let workspace: *mut AnyObject = msg_send![workspace, sharedWorkspace];
                msg_send![workspace, accessibilityDisplayShouldReduceTransparency]
            };
            let glass = AnyClass::get(c"NSGlassEffectView").filter(|_| !reduce);
            let kind = if reduce {
                "solid"
            } else if glass.is_some() {
                "glass"
            } else {
                "vibrancy"
            };
            let radius = if w.label() == "capsule-preview" {
                22.0_f64
            } else {
                18.0_f64
            };
            let frame = root.frame();
            let class = glass.unwrap_or_else(|| {
                AnyClass::get(c"NSVisualEffectView").expect("NSVisualEffectView")
            });
            let host: Allocated<NSView> = unsafe { msg_send![class, alloc] };
            let host: Retained<NSView> = unsafe { msg_send![host, initWithFrame: frame] };
            host.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            root.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            root.setWantsLayer(true);
            if let Some(layer) = root.layer() {
                unsafe {
                    let _: () = msg_send![&*layer, setCornerRadius: radius];
                    let _: () = msg_send![&*layer, setMasksToBounds: true];
                }
            }
            native.setAcceptsMouseMovedEvents(true);
            native.setOpaque(false);
            native.setBackgroundColor(Some(&NSColor::clearColor()));
            native.setHasShadow(w.label() == "capsule-preview");
            // NSGlassEffectView guarantees the z-order only for contentView.
            // Embed the existing Tao/Wry root without replacing its responders.
            // A glass view can reset its own backing-layer mask on resize.
            // A separate transparent NSView owns the final window silhouette.
            let clip = NSView::initWithFrame(NSView::alloc(mtm), frame);
            clip.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            clip.setWantsLayer(true);
            if let Some(layer) = clip.layer() {
                unsafe {
                    let _: () = msg_send![&*layer, setCornerRadius: radius];
                    let _: () = msg_send![&*layer, setMasksToBounds: true];
                    let _: () =
                        msg_send![&*layer, setBackgroundColor: std::ptr::null::<AnyObject>()];
                }
            }
            clip.addSubview(&host);
            native.setContentView(Some(&clip));
            if glass.is_some() {
                unsafe {
                    let _: () = msg_send![&*host, setStyle: 1_isize];
                    let _: () = msg_send![&*host, setCornerRadius: radius];
                    let _: () = msg_send![&*host, setContentView: &*root];
                }
            } else {
                unsafe {
                    let _: () = msg_send![&*host, setMaterial: 13_isize];
                    let _: () = msg_send![&*host, setBlendingMode: 0_isize];
                    let _: () = msg_send![&*host, setState: 1_isize];
                }
                host.setWantsLayer(true);
                if let Some(layer) = host.layer() {
                    unsafe {
                        let _: () = msg_send![&*layer, setCornerRadius: radius];
                        let _: () = msg_send![&*layer, setMasksToBounds: true];
                    }
                }
                host.addSubview(&root);
            }
            let _ = mtm;
            cache.borrow_mut().insert(w.label().into(), kind.into());
            Ok(kind.to_owned())
        });
        let _ = tx.send(result);
    })?;
    rx.recv().map_err(|error| AppError {
        code: "capsuleMaterial".into(),
        message: error.to_string(),
        details: Default::default(),
    })?
}

pub fn forget(label: &str) {
    MATERIALS.with(|cache| {
        cache.borrow_mut().remove(label);
    });
}
