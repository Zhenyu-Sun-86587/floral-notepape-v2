//! One reusable, clipped AppKit material host per window. Mode changes rebuild
//! only the effect views; the original Tao/Wry root and responder chain survive.
use crate::{
    platform::macos::{MacosConfig, MaterialEffect},
    services::notes::AppError,
};
use objc2::{
    msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyClass, AnyObject},
    MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{NSAutoresizingMaskOptions as Sizing, NSColor, NSView, NSWindow};
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{Emitter, Manager, WebviewWindow};
static ENABLED: AtomicBool = AtomicBool::new(true);
static GLASS: AtomicBool = AtomicBool::new(true);
struct Host {
    root: Retained<NSView>,
    clip: Retained<NSView>,
    effects: Vec<Retained<NSView>>,
    kind: String,
    radius: f64,
}
thread_local! { static HOSTS: RefCell<HashMap<String, Host>> = RefCell::new(HashMap::new()); }
pub fn configure(config: &MacosConfig) {
    ENABLED.store(config.material_enabled, Ordering::Relaxed);
    GLASS.store(
        config.material_effect == MaterialEffect::LiquidGlass,
        Ordering::Relaxed,
    );
}
fn error(message: impl Into<String>) -> AppError {
    AppError {
        code: "macMaterial".into(),
        message: message.into(),
        details: Default::default(),
    }
}
fn effect_view(class: &AnyClass, frame: objc2_foundation::NSRect) -> Retained<NSView> {
    unsafe {
        let allocated: Allocated<NSView> = msg_send![class, alloc];
        msg_send![allocated, initWithFrame: frame]
    }
}
fn configure_view(view: &NSView, radius: f64) {
    view.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
    view.setWantsLayer(true);
    if let Some(layer) = view.layer() {
        layer.setBackgroundColor(None);
        layer.setCornerRadius(radius);
        layer.setMasksToBounds(true);
    }
}
fn install(window: &WebviewWindow, radius: f64) -> Result<String, AppError> {
    let mtm = MainThreadMarker::new().ok_or_else(|| error("AppKit 材质必须在主线程更新"))?;
    let pointer = window.ns_window()?;
    let native = unsafe { &*pointer.cast::<NSWindow>() };
    let reduce: bool = unsafe {
        let class = AnyClass::get(c"NSWorkspace").expect("AppKit NSWorkspace");
        let workspace: *mut AnyObject = msg_send![class, sharedWorkspace];
        msg_send![workspace, accessibilityDisplayShouldReduceTransparency]
    };
    let glass_class = AnyClass::get(c"NSGlassEffectView");
    let kind = if !ENABLED.load(Ordering::Relaxed) {
        "off"
    } else if reduce {
        "solid"
    } else if GLASS.load(Ordering::Relaxed) && glass_class.is_some() {
        "glass"
    } else {
        "frosted"
    };
    HOSTS.with(|hosts| {
        let mut hosts = hosts.borrow_mut();
        if hosts.get(window.label()).is_some_and(|host| host.kind == kind && host.radius == radius) {
            return Ok(kind.into());
        }
        let (root, clip) = if let Some(host) = hosts.get(window.label()) {
            // The Wry root never moves during a mode change. NSGlassEffectView
            // owns its contentView: reparenting that content across effects can
            // make its old owner detach the WebView after the new host installs.
            for effect in &host.effects { effect.removeFromSuperview(); }
            configure_view(&host.clip, radius);
            configure_view(&host.root, radius);
            (host.root.clone(), host.clip.clone())
        } else {
            let root = native.contentView().ok_or_else(|| error("原生窗口内容视图不可用"))?;
            let frame = objc2_foundation::NSRect::new(objc2_foundation::NSPoint::new(0.0, 0.0), root.bounds().size);
            root.removeFromSuperview();
            root.setFrame(frame);
            configure_view(&root, radius);
            let clip = NSView::initWithFrame(NSView::alloc(mtm), frame);
            configure_view(&clip, radius);
            native.setContentView(Some(&clip));
            (root, clip)
        };
        if unsafe { root.superview() }.is_none() { clip.addSubview(&root); }
        let frame = clip.bounds();
        let mut effects = Vec::new();
        if kind == "glass" || kind == "frosted" {
            // Explicit behind-window sampling supplies wallpaper/other apps,
            // rather than blurring an empty transparent window's own contents.
            let backdrop = effect_view(AnyClass::get(c"NSVisualEffectView").expect("AppKit vibrancy"), frame);
            backdrop.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
            unsafe {
                let _: () = msg_send![&*backdrop, setMaterial: if kind == "glass" { 21_isize } else { 13_isize }];
                let _: () = msg_send![&*backdrop, setBlendingMode: 0_isize];
                let _: () = msg_send![&*backdrop, setState: 1_isize];
            }
            // Clear glass keeps a lighter backdrop; frosted keeps full diffusion.
            backdrop.setAlphaValue(if kind == "glass" { 0.55 } else { 1.0 });
            clip.addSubview_positioned_relativeTo(&backdrop, objc2_app_kit::NSWindowOrderingMode::Below, Some(&root));
            effects.push(backdrop);
            if kind == "glass" {
                let glass = effect_view(glass_class.expect("available glass"), frame);
                glass.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
                unsafe {
                    let _: () = msg_send![&*glass, setStyle: 1_isize];
                    let _: () = msg_send![&*glass, setCornerRadius: radius];

                }
                clip.addSubview_positioned_relativeTo(&glass, objc2_app_kit::NSWindowOrderingMode::Below, Some(&root));
                effects.push(glass);
            }
        }
        native.setOpaque(false);
        native.setBackgroundColor(Some(&NSColor::clearColor()));
        native.setAcceptsMouseMovedEvents(true);
        native.setHasShadow(!window.label().starts_with("capsule-group"));
        hosts.insert(window.label().into(), Host { root, clip, effects, kind: kind.into(), radius });
        let _ = window.emit("mac-material-changed", kind);
        Ok(kind.to_owned())
    })
}
/// Command workers can wait for AppKit. Main-thread callers use refresh directly.
pub fn apply(window: &WebviewWindow, radius: f64) -> Result<String, AppError> {
    if !radius.is_finite() {
        return Err(error("圆角数值无效"));
    }
    let radius = radius.clamp(0.0, 40.0);
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let w = window.clone();
    window.app_handle().run_on_main_thread(move || {
        let _ = tx.send(install(&w, radius));
    })?;
    rx.recv().map_err(|cause| error(cause.to_string()))?
}
pub fn refresh(window: &WebviewWindow) -> Result<(), AppError> {
    let radius = HOSTS.with(|hosts| hosts.borrow().get(window.label()).map(|host| host.radius));
    if let Some(radius) = radius {
        install(window, radius)?;
    }
    Ok(())
}
pub fn forget(label: &str) {
    HOSTS.with(|hosts| {
        hosts.borrow_mut().remove(label);
    });
}
