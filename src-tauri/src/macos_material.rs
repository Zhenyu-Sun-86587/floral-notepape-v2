//! One reusable, clipped AppKit material host per window. Mode changes rebuild
//! only the effect views; the original Tao/Wry root and responder chain survive.
use crate::{
    platform::macos::{CapsuleDynamics, MacosConfig, MaterialEffect},
    services::notes::AppError,
};
use objc2::{
    msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyClass, AnyObject},
    MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{NSAutoresizingMaskOptions as Sizing, NSColor, NSView, NSWindow};
use serde::Serialize;
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        RwLock,
    },
};
use tauri::{Emitter, Manager, WebviewWindow};
static ENABLED: AtomicBool = AtomicBool::new(true);
static GLASS: AtomicBool = AtomicBool::new(true);
static CONFIG: RwLock<Option<MacosConfig>> = RwLock::new(None);
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialState {
    pub kind: String,
    pub opacity: f64,
}
pub fn glass_motion_enabled() -> bool {
    CONFIG
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_none_or(|c| {
            c.material_enabled
                && c.material_effect == MaterialEffect::LiquidGlass
                && c.capsule_liquid_motion
        })
}
pub fn elastic_capsules() -> bool {
    CONFIG
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|c| c.capsule_dynamics != CapsuleDynamics::Lightweight)
}
pub fn fluid_capsules() -> bool {
    CONFIG
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|c| {
            c.material_enabled
                && c.material_effect == MaterialEffect::LiquidGlass
                && c.capsule_dynamics == CapsuleDynamics::Fluid
        })
}
pub fn capsule_tint(opacity: f64) -> f64 {
    opacity * if elastic_capsules() { 0.025 } else { 0.12 }
}
pub fn note_dynamics(label: &str) -> CapsuleDynamics {
    if !label.starts_with("tile-") && !label.starts_with("notepad-") {
        return CapsuleDynamics::Lightweight;
    }
    CONFIG
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|c| c.note_dynamics)
        .unwrap_or_default()
}
pub fn opacity(label: &str, glass: bool) -> f64 {
    let config = CONFIG.read().unwrap_or_else(|e| e.into_inner());
    let defaults = MacosConfig::default();
    let c = config.as_ref().unwrap_or(&defaults);
    if label.starts_with("capsule-") {
        c.capsule_opacity
    } else if label == "main" {
        c.main_opacity
    } else {
        c.note_opacity
    }
    .value(glass)
}
struct Host {
    root: Retained<NSView>,
    clip: Retained<NSView>,
    effects: Vec<Retained<NSView>>,
    glass: Option<Retained<NSView>>,
    kind: String,
    opacity: f64,
    radius: f64,
    dynamics: CapsuleDynamics,
    background: Option<Retained<NSView>>,
}
thread_local! { static HOSTS: RefCell<HashMap<String, Host>> = RefCell::new(HashMap::new()); }
pub fn configure(config: &MacosConfig) {
    *CONFIG.write().unwrap_or_else(|e| e.into_inner()) = Some(config.clone());
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
pub fn state(label: &str) -> MaterialState {
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
    let opacity = opacity(label, kind == "glass");
    MaterialState {
        kind: kind.into(),
        opacity,
    }
}
fn install(window: &WebviewWindow, radius: f64) -> Result<MaterialState, AppError> {
    let mtm = MainThreadMarker::new().ok_or_else(|| error("AppKit 材质必须在主线程更新"))?;
    let pointer = window.ns_window()?;
    let native = unsafe { &*pointer.cast::<NSWindow>() };
    let state = state(window.label());
    let kind_owned = state.kind.clone();
    let kind = kind_owned.as_str();
    let opacity = state.opacity;
    let dynamics = note_dynamics(window.label());
    let glass_class = AnyClass::get(c"NSGlassEffectView");
    HOSTS.with(|hosts| {
        let mut hosts = hosts.borrow_mut();
        if hosts.get(window.label()).is_some_and(|host| host.kind == kind && host.radius == radius && host.opacity == opacity && host.dynamics == dynamics) {
            return Ok(state.clone());
        }
        crate::macos_fluid::remove(window.label());
        let (root, clip) = if let Some(host) = hosts.get(window.label()) {
            // The Wry root never moves during a mode change. NSGlassEffectView
            // owns its contentView: reparenting that content across effects can
            // make its old owner detach the WebView after the new host installs.
            // Clear ownership before detaching: an old NSGlassEffectView must
            // never remove the WebView after it has joined the next host.
            if let Some(glass) = &host.glass { unsafe { let _: () = msg_send![&**glass, setContentView: std::ptr::null::<AnyObject>()]; } }
            host.root.removeFromSuperview();
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

        let frame = clip.bounds();
        let background = NSView::initWithFrame(NSView::alloc(mtm),frame);
        background.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
        let fluid = kind == "glass" && dynamics == CapsuleDynamics::Fluid;
        let separate = kind == "glass" && dynamics != CapsuleDynamics::Lightweight;
        background.setWantsLayer(true);
        if separate { clip.addSubview(&background); }
        let mut effects = Vec::new();
        let mut glass_host = None;
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
            backdrop.setAlphaValue(opacity);
            if separate { background.addSubview(&backdrop); } else { clip.addSubview(&backdrop); }
            effects.push(backdrop);
            if kind == "glass" {
                let glass = effect_view(glass_class.expect("available glass"), frame);
                glass.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
                unsafe {
                    let _: () = msg_send![&*glass, setStyle: 1_isize];
                    let _: () = msg_send![&*glass, setCornerRadius: radius];
                    let tint = NSColor::colorWithWhite_alpha(1.0, opacity * if dynamics == CapsuleDynamics::Lightweight { 0.12 } else { 0.025 });
                    let _: () = msg_send![&*glass, setTintColor: &*tint];
                    if window.label() == "capsule-preview" || separate {
                        // Selection/focus belongs to the WebView, not to the
                        // glass subtree's dynamic interaction/emphasis state.
                        let content=NSView::initWithFrame(NSView::alloc(mtm),frame);
                        let _: () = msg_send![&*glass, setContentView: &*content];
                    } else { let _: () = msg_send![&*glass, setContentView: &*root]; }

                }
                if separate { background.addSubview(&glass); } else { clip.addSubview(&glass); }
                glass_host = Some(glass.clone());
                effects.push(glass);
            }
        }
        if kind != "glass" || window.label() == "capsule-preview" || separate { clip.addSubview(&root); }
        if fluid {
            crate::macos_fluid::install_note(native,&background,window.label(),radius,opacity);
        }
        if separate { effects.push(background.clone()); }
        native.setOpaque(false);
        native.setBackgroundColor(Some(&NSColor::clearColor()));
        native.setAcceptsMouseMovedEvents(true);
        native.setHasShadow(!window.label().starts_with("capsule-group"));
        hosts.insert(window.label().into(), Host { root, clip, effects, glass: glass_host, kind: kind.into(), opacity, radius, dynamics, background:separate.then_some(background) });
        crate::macos_note_shell::attach(window, &hosts.get(window.label()).unwrap().root);
        let _ = window.emit("mac-material-changed", &state);
        Ok(state)
    })
}
pub fn drag_feedback(window: &NSWindow, pressed: bool) {
    let reduce: bool = unsafe {
        let workspace: *mut AnyObject =
            msg_send![AnyClass::get(c"NSWorkspace").unwrap(), sharedWorkspace];
        msg_send![workspace, accessibilityDisplayShouldReduceMotion]
    };
    if reduce {
        return;
    }
    HOSTS.with(|hosts| {
        for (label, host) in hosts.borrow().iter() {
            if host
                .clip
                .window()
                .as_deref()
                .is_some_and(|w| std::ptr::eq(w, window))
            {
                if let Some(background) = &host.background {
                    crate::macos_rail::animate_material(background, pressed, 0.985);
                    crate::macos_fluid::press(label, pressed);
                }
                break;
            }
        }
    });
}
/// Command workers can wait for AppKit. Main-thread callers use refresh directly.
pub fn apply(window: &WebviewWindow, radius: f64) -> Result<MaterialState, AppError> {
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
    crate::macos_fluid::remove(label);
    HOSTS.with(|hosts| {
        hosts.borrow_mut().remove(label);
    });
}

/// Synchronize every native effect with its host after pool reuse or resize.
/// A retained glass view must not preserve its previous group's short bounds.
pub fn layout(window: &WebviewWindow) -> Result<(), AppError> {
    let mtm = MainThreadMarker::new().ok_or_else(|| error("材质布局需要主线程"))?;
    let _ = mtm;
    let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
    HOSTS.with(|hosts| {
        if let Some(host) = hosts.borrow().get(window.label()) {
            let size = native.contentLayoutRect().size;
            let frame =
                objc2_foundation::NSRect::new(objc2_foundation::NSPoint::new(0.0, 0.0), size);
            host.clip.setFrame(frame);
            for effect in &host.effects {
                effect.setFrame(frame);
            }
            host.root.setFrame(frame);
            host.clip.setNeedsLayout(true);
            host.clip.layoutSubtreeIfNeeded();
            crate::macos_note_shell::layout(window, &host.root);
            native.invalidateShadow();
        }
    });
    Ok(())
}

pub fn attach_note_shell(window: &WebviewWindow) -> Result<(), AppError> {
    let found = HOSTS.with(|hosts| {
        if let Some(host) = hosts.borrow().get(window.label()) {
            crate::macos_note_shell::attach(window, &host.root);
            true
        } else {
            false
        }
    });
    if !found {
        let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
        if let Some(root) = native.contentView() {
            crate::macos_note_shell::attach(window, &root);
        }
    }
    Ok(())
}
