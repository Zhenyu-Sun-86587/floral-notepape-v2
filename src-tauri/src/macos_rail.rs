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
    cell::{Cell, RefCell},
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
    pressed: Cell<bool>,
    dragged: Cell<bool>,
    start: Cell<Option<tauri::PhysicalPosition<f64>>>,
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
        fn mouse_down(&self, event: &NSEvent) {
            let s = self.ivars(); s.epoch.fetch_add(1, Ordering::SeqCst);
            s.pressed.set(true); s.dragged.set(false);
            s.start.set(crate::macos_surface::event_cursor(event));
        }
        #[unsafe(method(needsPanelToBecomeKey))]
        fn needs_key(&self) -> bool { false }
        #[unsafe(method(mouseDragged:))]
        fn mouse_dragged(&self, event: &NSEvent) {
            let s = self.ivars();
            if !s.pressed.get() || s.dragged.get() { return; }
            let Some(start) = s.start.get() else { return; };
            let Some(point) = crate::macos_surface::event_cursor(event) else { return; };
            if (point.x-start.x).hypot(point.y-start.y) < 4.0 { return; }
            s.dragged.set(true);
            let Some(window) = s.app.get_window(&s.label) else { return; };
            let key = s.key.clone(); let group = s.group;
            tauri::async_runtime::spawn(async move {
                if let Err(e) = desktop::drag_capsule_from(window, key, group, Some(start)).await { eprintln!("Mac capsule drag: {e}"); }
            });
        }
        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, event: &NSEvent) {
            let s = self.ivars();
            if !s.pressed.replace(false) || s.dragged.get() || s.group { return; }
            let point = self.convertPoint_fromView(event.locationInWindow(), None);
            let size = self.bounds().size;
            if point.x < 0.0 || point.y < 0.0 || point.x > size.width || point.y > size.height { return; }
            self.activate(sel!(activate:), None);
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
    material: Option<Retained<NSView>>,
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
        pressed: Cell::new(false),
        dragged: Cell::new(false),
        start: Cell::new(None),
    });
    let b: Retained<CapsuleButton> = unsafe { msg_send![super(b), initWithFrame: frame] };
    b.setBordered(false);
    b.setTitle(&NSString::from_str(""));
    b.setFocusRingType(NSFocusRingType::None);
    b.setImageScaling(NSImageScaling::ScaleProportionallyDown);
    let symbol = if expanded {
        "doc.text.fill"
    } else {
        "doc.text"
    };
    if !grip {
        if let Some(image) = NSImage::imageWithSystemSymbolName_accessibilityDescription(
            &NSString::from_str(symbol),
            Some(&NSString::from_str(title)),
        ) {
            image.setSize(NSSize::new(18.0, 22.0));
            b.setImage(Some(&image));
        }
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
    let geometry = crate::macos_droplet::geometry(group.members.len());
    let size = NSSize::new(geometry.edge, geometry.height);
    let radius = 22.0_f64.min(size.height / 2.0);
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), size);
    let root = NSView::initWithFrame(NSView::alloc(mtm), frame);
    root.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
    root.setWantsLayer(true);
    if let Some(layer) = root.layer() {
        layer.setCornerRadius(radius);
        layer.setMasksToBounds(true);
    }
    let state = macos_material::state(window.label());
    let glass = state.kind == "glass" && AnyClass::get(c"NSGlassEffectView").is_some();
    let mut material = None;
    if glass && macos_material::elastic_capsules() {
        // Let the native glass outline describe the merged shape.
        if let Some(layer) = root.layer() {
            layer.setMasksToBounds(false);
        }
    }
    // One material for the whole group. Controls live above this decorative
    // surface; no glass cell competes with a button for hit testing or emphasis.
    if glass {
        let container = view(
            AnyClass::get(c"NSGlassEffectContainerView").unwrap(),
            root.bounds(),
        );
        container.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
        let bubbles = NSView::initWithFrame(NSView::alloc(mtm), root.bounds());
        unsafe {
            let _: () = msg_send![&*container,setSpacing:24.0_f64];
            let _: () = msg_send![&*container,setContentView:&*bubbles];
        }
        for [x, y, w, h] in &geometry.cells {
            if *y > geometry.height {
                continue;
            }
            let frame = if group.members.len() == 1 {
                root.bounds()
            } else {
                NSRect::new(
                    NSPoint::new(x - 10.0, size.height - y - h - 10.0),
                    NSSize::new(w + 20.0, h + 20.0),
                )
            };
            let effect = view(AnyClass::get(c"NSGlassEffectView").unwrap(), frame);
            let content = NSView::initWithFrame(
                NSView::alloc(mtm),
                NSRect::new(NSPoint::new(0.0, 0.0), frame.size),
            );
            unsafe {
                let _: () = msg_send![&*effect,setStyle:1_isize];
                let _: () = msg_send![&*effect,setCornerRadius:frame.size.height/2.0];
                let tint =
                    NSColor::colorWithWhite_alpha(1.0, macos_material::capsule_tint(state.opacity));
                let _: () = msg_send![&*effect,setTintColor:&*tint];
                let _: () = msg_send![&*effect,setContentView:&*content];
            }
            bubbles.addSubview(&effect);
        }
        root.addSubview(&container);
        material = Some(container);
    } else if state.kind == "frosted" {
        let effect = view(AnyClass::get(c"NSVisualEffectView").unwrap(), root.bounds());
        effect.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
        unsafe {
            let _: () = msg_send![&*effect, setMaterial: 13_isize];
            let _: () = msg_send![&*effect, setBlendingMode: 0_isize];
            let _: () = msg_send![&*effect, setState: 1_isize];
        }
        effect.setAlphaValue(state.opacity);
        root.addSubview(&effect);
    } else if let Some(layer) = root.layer() {
        layer.setBackgroundColor(Some(&NSColor::windowBackgroundColor().CGColor()));
    }
    let document_size = NSSize::new(geometry.edge, geometry.document_height);
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), document_size);
    let document = NSView::initWithFrame(NSView::alloc(mtm), frame);
    let scroll = NSScrollView::initWithFrame(NSScrollView::alloc(mtm), root.bounds());
    scroll.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
    scroll.setDrawsBackground(false);
    scroll.contentView().setDrawsBackground(false);
    scroll.setBorderType(NSBorderType::NoBorder);
    scroll.setHasVerticalScroller(geometry.document_height > geometry.height);
    scroll.setHasHorizontalScroller(false);
    scroll.setAutohidesScrollers(true);
    scroll.setDocumentView(Some(&document));
    root.addSubview(&scroll);
    let stage = NSView::initWithFrame(NSView::alloc(mtm), frame);
    stage.setAutoresizingMask(Sizing::ViewWidthSizable | Sizing::ViewHeightSizable);
    document.addSubview(&stage);
    let epoch = Arc::new(AtomicU64::new(0));
    if let Some(member) = group.members.first() {
        let background = button(
            window,
            &member.key,
            if group.members.len() == 1 {
                &member.title
            } else {
                "拖动整个水滴"
            },
            member.expanded,
            group.members.len() > 1,
            (size.width / 2.0, size.height / 2.0),
            frame,
            epoch.clone(),
            mtm,
        );
        stage.addSubview(&background);
    }
    for (member, rect) in group.members.iter().zip(&geometry.cells) {
        if group.members.len() == 1 {
            break;
        }
        let [x, y, w, h] = *rect;
        let cell = NSRect::new(
            NSPoint::new(x, document_size.height - y - h),
            NSSize::new(w, h),
        );
        let anchor = (x + w / 2.0, y + h / 2.0);
        let bframe = NSRect::new(NSPoint::new(0.0, 0.0), cell.size);
        let b = button(
            window,
            &member.key,
            &member.title,
            member.expanded,
            false,
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
        content.setFrame(cell);
        stage.addSubview(&content);
    }
    crate::macos_surface::configure_capsule_native(native);
    native.setOpaque(false);
    native.setBackgroundColor(Some(&NSColor::clearColor()));
    native.setHasShadow(false);
    native.setAcceptsMouseMovedEvents(true);
    native.setIgnoresMouseEvents(false);
    native.setMovableByWindowBackground(false);
    native.setContentView(Some(&root));
    document.scrollPoint(NSPoint::new(0.0, document_size.height - size.height));
    RAILS.with(|rails| {
        let mut rails = rails.borrow_mut();
        if let Some(old) = rails.remove(window.label()) {
            old.epoch.fetch_add(1, Ordering::SeqCst);
        }
        rails.insert(
            window.label().into(),
            Rail {
                group,
                epoch,
                material,
            },
        );
    });
    Ok(())
}
/// Suspend only decorative glass; the live window and all input controls remain.
pub fn material_visible(labels: &[String], visible: bool) {
    RAILS.with(|rails| {
        let rails = rails.borrow();
        for label in labels {
            if let Some(view) = rails.get(label).and_then(|r| r.material.as_ref()) {
                view.setAlphaValue(if visible { 1.0 } else { 0.0 });
            }
        }
    });
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
