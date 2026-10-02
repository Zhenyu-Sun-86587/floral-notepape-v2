//! Mac capsule UI: AppKit controls/materials, with no WKWebView per rail.
//! All retained views stay on the main thread. Disk/window work runs off it.
use crate::{
    desktop::{
        self,
        capsule_groups::{self, GroupSurface},
    },
    macos_material,
};
use objc2::{
    define_class, msg_send,
    rc::{Allocated, Retained},
    runtime::AnyClass,
    sel, AnyThread, DefinedClass, MainThreadOnly,
};
use objc2_app_kit::{
    NSAccessibility, NSAutoresizingMaskOptions as Sizing, NSBorderType, NSButton, NSColor, NSEvent,
    NSFocusRingType, NSImage, NSImageScaling, NSScrollView, NSTrackingArea, NSTrackingAreaOptions,
    NSView, NSWindow,
};
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize, NSString};
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tauri::{Manager, Window};
struct ButtonState {
    app: tauri::AppHandle,
    label: String,
    key: String,
    group: bool,
    expanded: bool,
    anchor: (f64, f64),
    epoch: Arc<AtomicU64>,
}
define_class!(
    #[unsafe(super = NSButton)]
    #[thread_kind = MainThreadOnly]
    #[ivars = ButtonState]
    struct CapsuleButton;
    impl CapsuleButton {
        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _: Option<&NSEvent>) -> bool { true }
        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, _: &NSEvent) {
            let s = self.ivars(); s.epoch.fetch_add(1, Ordering::SeqCst);
            let Some(window) = s.app.get_window(&s.label) else { return; };
            let key = s.key.clone(); let group = s.group; let app = s.app.clone();
            tauri::async_runtime::spawn(async move {
                match desktop::drag_capsule(window, key.clone(), group).await {
                    Ok(false) if !group => { if let Err(e) = crate::surface_toggle_capsule(app, key).await { eprintln!("Mac capsule: {e}"); } }
                    Err(e) => eprintln!("Mac capsule drag: {e}"), _ => {}
                }
            });
        }
        #[unsafe(method(activate:))]
        fn activate(&self, _: Option<&objc2::runtime::AnyObject>) {
            let s = self.ivars(); if s.group { return; }
            let app = s.app.clone(); let key = s.key.clone();
            tauri::async_runtime::spawn(async move { let _ = crate::surface_toggle_capsule(app, key).await; });
        }
        #[unsafe(method(rightMouseDown:))]
        fn context_menu(&self, _: &NSEvent) {
            let s = self.ivars(); s.epoch.fetch_add(1, Ordering::SeqCst);
            if let Some(window) = s.app.get_window(&s.label) { let _ = desktop::popup_capsule_menu(&window, &s.key); }
        }
        #[unsafe(method(mouseEntered:))]
        fn entered(&self, _: &NSEvent) {
            let s = self.ivars(); if s.group || s.expanded { return; }
            let epoch = s.epoch.fetch_add(1, Ordering::SeqCst) + 1;
            let token = s.epoch.clone(); let app = s.app.clone(); let key = s.key.clone(); let label = s.label.clone();
            let (x,y) = self.window().and_then(|w| w.contentView()).map(|root| {
                let rect=self.convertRect_toView(self.bounds(),Some(&root));
                (rect.origin.x+rect.size.width/2.0,root.bounds().size.height-rect.origin.y-rect.size.height/2.0)
            }).unwrap_or(s.anchor);
            let generation = desktop::capsule_hover(&app, true, "rail", Some(&key), None);
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(280)).await;
                if token.load(Ordering::SeqCst) != epoch { return; }
                    let _ = desktop::run_capsule_task(move || {
                        if token.load(Ordering::SeqCst) != epoch { return Ok(()); }
                        if let Some(window) = app.get_window(&label) { desktop::show_capsule_preview(&window, &key, y, x, generation)?; }
                        Ok(())
                    }).await;
            });
        }
        #[unsafe(method(mouseExited:))]
        fn exited(&self, _: &NSEvent) {
            let s = self.ivars(); s.epoch.fetch_add(1, Ordering::SeqCst);
            if !s.group { desktop::capsule_hover(&s.app, false, "rail", Some(&s.key), None); }
        }
    }
);
struct Rail {
    group: GroupSurface,
    epoch: Arc<AtomicU64>,
}
thread_local! { static RAILS: RefCell<HashMap<String, Rail>> = RefCell::new(HashMap::new()); }
fn view(class: &AnyClass, frame: NSRect) -> Retained<NSView> {
    unsafe {
        let a: Allocated<NSView> = msg_send![class, alloc];
        msg_send![a, initWithFrame: frame]
    }
}
fn button(
    window: &Window,
    key: &str,
    title: &str,
    expanded: bool,
    grip: bool,
    anchor: (f64, f64),
    frame: NSRect,
    epoch: Arc<AtomicU64>,
    mtm: MainThreadMarker,
) -> Retained<CapsuleButton> {
    let b = CapsuleButton::alloc(mtm).set_ivars(ButtonState {
        app: window.app_handle().clone(),
        label: window.label().into(),
        key: key.into(),
        group: grip,
        expanded,
        anchor,
        epoch,
    });
    let b: Retained<CapsuleButton> = unsafe { msg_send![super(b), initWithFrame: frame] };
    b.setBordered(false);
    b.setFocusRingType(NSFocusRingType::None);
    b.setImageScaling(NSImageScaling::ScaleProportionallyDown);
    let symbol = if grip {
        "line.3.horizontal"
    } else {
        "doc.text"
    };
    if let Some(image) = NSImage::imageWithSystemSymbolName_accessibilityDescription(
        &NSString::from_str(symbol),
        Some(&NSString::from_str(title)),
    ) {
        image.setSize(NSSize::new(18.0, 22.0));
        b.setImage(Some(&image));
    }
    b.setContentTintColor(Some(&NSColor::labelColor()));
    b.setAccessibilityLabel(Some(&NSString::from_str(title)));
    b.setToolTip(Some(&NSString::from_str(title)));
    unsafe {
        b.setTarget(Some(&b));
        b.setAction(Some(sel!(activate:)));
    }
    let tracking = unsafe {
        NSTrackingArea::initWithRect_options_owner_userInfo(
            NSTrackingArea::alloc(),
            frame,
            NSTrackingAreaOptions::MouseEnteredAndExited
                | NSTrackingAreaOptions::ActiveAlways
                | NSTrackingAreaOptions::InVisibleRect,
            Some(&b),
            None,
        )
    };
    b.addTrackingArea(&tracking);
    b
}
fn render(window: &Window, group: GroupSurface) -> Result<(), crate::services::notes::AppError> {
    let mtm = MainThreadMarker::new().expect("Mac rail on main thread");
    let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
    let size = if group.side == crate::surface_sessions::CapsuleSide::Top {
        NSSize::new(group.viewport_css, group.cross_css)
    } else {
        NSSize::new(group.cross_css, group.viewport_css)
    };
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), size);
    let root = NSView::initWithFrame(NSView::alloc(mtm), frame);
    root.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
    root.setWantsLayer(true);
    if let Some(layer) = root.layer() {
        layer.setCornerRadius(18.0);
        layer.setMasksToBounds(true);
    }
    let state = macos_material::state(window.label());
    let glass = state.kind == "glass" && AnyClass::get(c"NSGlassEffectContainerView").is_some();
    let top = group.side == crate::surface_sessions::CapsuleSide::Top;
    let document_size = if top {
        NSSize::new(group.content_css.max(size.width), size.height)
    } else {
        NSSize::new(size.width, group.content_css.max(size.height))
    };
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), document_size);
    let document = NSView::initWithFrame(NSView::alloc(mtm), frame);
    let scroll = NSScrollView::initWithFrame(NSScrollView::alloc(mtm), root.bounds());
    scroll.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
    scroll.setDrawsBackground(false);
    scroll.contentView().setDrawsBackground(false);
    scroll.setBorderType(NSBorderType::NoBorder);
    scroll.setHasVerticalScroller(!top);
    scroll.setHasHorizontalScroller(top);
    scroll.setAutohidesScrollers(true);
    scroll.setDocumentView(Some(&document));
    root.addSubview(&scroll);
    let stage = NSView::initWithFrame(NSView::alloc(mtm), frame);
    stage.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
    if glass {
        let container = view(AnyClass::get(c"NSGlassEffectContainerView").unwrap(), frame);
        container.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
        unsafe {
            let _: () = msg_send![&*container, setSpacing: 18.0_f64];
            let _: () = msg_send![&*container, setContentView: &*stage];
        }
        document.addSubview(&container);
    } else {
        if state.kind == "frosted" {
            let effect = view(AnyClass::get(c"NSVisualEffectView").unwrap(), frame);
            effect.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
            unsafe {
                let _: () = msg_send![&*effect, setMaterial: 13_isize];
                let _: () = msg_send![&*effect, setBlendingMode: 0_isize];
                let _: () = msg_send![&*effect, setState: 1_isize];
            }
            effect.setAlphaValue(state.opacity);
            document.addSubview(&effect);
        } else if state.kind == "solid" || state.kind == "off" {
            if let Some(layer) = root.layer() {
                layer.setBackgroundColor(Some(&NSColor::windowBackgroundColor().CGColor()));
            }
        }
        document.addSubview(&stage);
    }
    let epoch = Arc::new(AtomicU64::new(0));
    let slots = group
        .members
        .iter()
        .enumerate()
        .map(|(index, member)| {
            (
                group.grip_css + index as f64 * group.slot_css,
                group.slot_css,
                member.key.as_str(),
                member.title.as_str(),
                member.expanded,
                false,
            )
        })
        .collect::<Vec<_>>();
    let mut slots = slots;
    if group.grip_css > 0.0 {
        if let Some(member) = group.members.first() {
            slots.insert(
                0,
                (
                    0.0,
                    group.grip_css,
                    member.key.as_str(),
                    "拖动整组便签",
                    false,
                    true,
                ),
            );
        }
    }
    for (offset, length, key, title, expanded, grip) in slots {
        let cell = if top {
            NSRect::new(NSPoint::new(offset, 0.0), NSSize::new(length, size.height))
        } else {
            NSRect::new(
                NSPoint::new(0.0, document_size.height - offset - length),
                NSSize::new(size.width, length),
            )
        };
        let anchor = if top {
            (offset + length / 2.0, size.height / 2.0)
        } else {
            (size.width / 2.0, offset + length / 2.0)
        };
        let bframe = NSRect::new(NSPoint::new(0.0, 0.0), cell.size);
        let b = button(
            window,
            key,
            title,
            expanded,
            grip,
            anchor,
            bframe,
            epoch.clone(),
            mtm,
        );
        let content = NSView::initWithFrame(
            NSView::alloc(mtm),
            NSRect::new(NSPoint::new(0.0, 0.0), cell.size),
        );
        content.addSubview(&b);
        if glass {
            let effect = view(AnyClass::get(c"NSGlassEffectView").unwrap(), cell);
            unsafe {
                let _: () = msg_send![&*effect, setStyle: 1_isize];
                let _: () = msg_send![&*effect, setCornerRadius: 18.0_f64];
                let tint = NSColor::colorWithWhite_alpha(1.0, state.opacity * 0.12);
                let _: () = msg_send![&*effect, setTintColor: &*tint];
                let _: () = msg_send![&*effect, setContentView: &*content];
            }
            stage.addSubview(&effect);
        } else {
            content.setFrame(cell);
            stage.addSubview(&content);
        }
    }
    crate::macos_surface::configure_capsule_native(native);
    native.setOpaque(false);
    native.setBackgroundColor(Some(&NSColor::clearColor()));
    native.setHasShadow(false);
    native.setAcceptsMouseMovedEvents(true);
    native.setContentView(Some(&root));
    if !top {
        document.scrollPoint(NSPoint::new(0.0, document_size.height - size.height));
    }
    RAILS.with(|rails| {
        let mut rails = rails.borrow_mut();
        if let Some(old) = rails.remove(window.label()) {
            old.epoch.fetch_add(1, Ordering::SeqCst);
        }
        rails.insert(window.label().into(), Rail { group, epoch });
    });
    Ok(())
}
pub fn prepare(
    window: &Window,
    group: GroupSurface,
) -> Result<(), crate::services::notes::AppError> {
    let w = window.clone();
    window.app_handle().run_on_main_thread(move || {
        crate::macos_capsule::install_pointer_monitor(w.app_handle());
        let revision = group.revision;
        match render(&w, group) {
            Ok(()) => capsule_groups::ready(w.label(), revision),
            Err(e) => eprintln!("Mac rail: {e}"),
        }
    })?;
    Ok(())
}
pub fn refresh(app: &tauri::AppHandle) {
    let groups = RAILS.with(|rails| {
        rails
            .borrow()
            .values()
            .map(|r| r.group.clone())
            .collect::<Vec<_>>()
    });
    for group in groups {
        if let Some(window) = app.get_window(group.native_label()) {
            let _ = render(&window, group);
        }
    }
}
pub fn forget(label: &str) {
    RAILS.with(|rails| {
        if let Some(old) = rails.borrow_mut().remove(label) {
            old.epoch.fetch_add(1, Ordering::SeqCst);
        }
    });
}
