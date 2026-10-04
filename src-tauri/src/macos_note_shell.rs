//! AppKit note title/toolbar. Markdown and editing remain in a smaller WebView.
use objc2::{define_class, msg_send, rc::Retained, sel, DefinedClass, MainThreadOnly};
use objc2_app_kit::{
    NSAccessibility, NSButton, NSColor, NSEvent, NSFocusRingType, NSFont, NSImage, NSImageScaling,
    NSLayoutConstraint, NSTextField, NSView,
};
use objc2_foundation::{MainThreadMarker, NSArray, NSPoint, NSRect, NSSize, NSString};
use serde::Deserialize;
use std::{cell::RefCell, collections::HashMap};
use tauri::{Emitter, Manager, WebviewWindow};
const HEIGHT: f64 = 48.0;
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteState {
    title: String,
    tile: bool,
    editing: bool,
    locked: bool,
}
struct Action {
    app: tauri::AppHandle,
    label: String,
    name: String,
}
define_class!(
    #[unsafe(super = NSButton)] #[thread_kind = MainThreadOnly] #[ivars = Action]
    struct NoteButton;
    impl NoteButton {
        #[unsafe(method(acceptsFirstMouse:))]
        fn first_mouse(&self, _: Option<&NSEvent>) -> bool { true }
        #[unsafe(method(activate:))]
        fn activate(&self, _: Option<&objc2::runtime::AnyObject>) { let s=self.ivars(); let _=s.app.emit_to(&s.label,"native-note-action",&s.name); }
    }
);
define_class!(
    #[unsafe(super = NSView)] #[thread_kind = MainThreadOnly]
    struct Header;
    impl Header {
        #[unsafe(method(mouseDown:))]
        fn drag(&self, event:&NSEvent) { if let Some(window)=self.window() { crate::macos_material::drag_feedback(&window,true); window.performWindowDragWithEvent(event); crate::macos_material::drag_feedback(&window,false); } }
        #[unsafe(method(acceptsFirstMouse:))]
        fn first_mouse(&self, _: Option<&NSEvent>) -> bool { true }
    }
);
define_class!(
    #[unsafe(super = NSTextField)] #[thread_kind = MainThreadOnly]
    struct Caption;
    impl Caption {
        #[unsafe(method(mouseDown:))]
        fn drag(&self,event:&NSEvent) { if let Some(window)=self.window() { crate::macos_material::drag_feedback(&window,true); window.performWindowDragWithEvent(event); crate::macos_material::drag_feedback(&window,false); } }
    }
);
struct Chrome {
    state: NoteState,
    header: Retained<Header>,
    body_constraints: Vec<Retained<NSLayoutConstraint>>,
}
thread_local! { static CHROME: RefCell<HashMap<String,Chrome>> = RefCell::new(HashMap::new()); }
fn has_webview(view: &NSView) -> bool {
    let class = objc2::runtime::AnyClass::get(c"WKWebView");
    if let Some(class) = class {
        let yes: bool = unsafe { msg_send![view,isKindOfClass: class] };
        if yes {
            return true;
        }
    }
    view.subviews().iter().any(|child| has_webview(&child))
}
pub fn layout(window: &WebviewWindow, root: &NSView) {
    CHROME.with(|chrome| {
        let mut chrome = chrome.borrow_mut();
        let Some(entry) = chrome.get_mut(window.label()) else {
            return;
        };
        let size = root.bounds().size;
        let h = HEIGHT.min(size.height);
        // This title area is outside the WebView: its opaque DOM background
        // cannot cover it when native material is off. Enabled material keeps
        // the original 2.0.3 transparent header and decorative effect below it.
        let enabled = crate::macos_material::enabled();
        if !enabled {
            entry.header.setWantsLayer(true);
        }
        if let Some(layer) = entry.header.layer() {
            if enabled {
                layer.setBackgroundColor(None);
            } else {
                layer.setBackgroundColor(Some(&NSColor::windowBackgroundColor().CGColor()));
            }
        }
        // Wry also changes the WebView frame during live resize. Native
        // constraints keep the reserved title area authoritative after that
        // callback, rather than racing it with a second frame assignment.
        for child in root.subviews().iter() {
            if has_webview(&child) {
                if entry.body_constraints.is_empty() {
                    child.setTranslatesAutoresizingMaskIntoConstraints(false);
                    entry.body_constraints = vec![
                        child
                            .leadingAnchor()
                            .constraintEqualToAnchor(&root.leadingAnchor()),
                        child
                            .trailingAnchor()
                            .constraintEqualToAnchor(&root.trailingAnchor()),
                        child
                            .topAnchor()
                            .constraintEqualToAnchor_constant(&root.topAnchor(), HEIGHT),
                        child
                            .bottomAnchor()
                            .constraintEqualToAnchor(&root.bottomAnchor()),
                    ];
                    NSLayoutConstraint::activateConstraints(&NSArray::from_retained_slice(
                        &entry.body_constraints,
                    ));
                }
                child.setFrame(NSRect::new(
                    NSPoint::new(0.0, if root.isFlipped() { h } else { 0.0 }),
                    NSSize::new(size.width, (size.height - h).max(0.0)),
                ));
            }
        }
        entry.header.setFrame(NSRect::new(
            NSPoint::new(
                0.0,
                if root.isFlipped() {
                    0.0
                } else {
                    size.height - h
                },
            ),
            NSSize::new(size.width, h),
        ));
        root.setNeedsLayout(true);
        root.layoutSubtreeIfNeeded();
        // Native lock hit target uses full-window coordinates, not DOM bounds.
        if entry.state.tile {
            crate::macos_lock_overlay::set_bounds(
                window,
                (size.width - 96.0).max(0.0),
                12.0,
                24.0,
                24.0,
                size.width,
                size.height,
            );
        }
    });
}
pub fn attach(window: &WebviewWindow, root: &NSView) {
    CHROME.with(|chrome| {
        if let Some(entry) = chrome.borrow().get(window.label()) {
            if unsafe { entry.header.superview() }.is_none() {
                root.addSubview(&entry.header);
            }
        }
    });
    layout(window, root);
}
pub fn update(
    window: &WebviewWindow,
    state: NoteState,
) -> Result<bool, crate::services::notes::AppError> {
    if !window.label().starts_with("tile-") && !window.label().starts_with("notepad-") {
        return Ok(false);
    }
    let w = window.clone();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    window.app_handle().run_on_main_thread(move || {
        let mtm=MainThreadMarker::new().unwrap();
        let header:Retained<Header>=unsafe {msg_send![Header::alloc(mtm),initWithFrame:NSRect::new(NSPoint::new(0.0,0.0),NSSize::new(320.0,HEIGHT))]};
        let caption:Retained<Caption>=unsafe {msg_send![Caption::alloc(mtm),initWithFrame:NSRect::new(NSPoint::new(16.0,13.0),NSSize::new(175.0,24.0))]};
        caption.setStringValue(&NSString::from_str(&state.title));caption.setEditable(false);caption.setSelectable(false);caption.setBezeled(false);caption.setDrawsBackground(false);caption.setTextColor(Some(&NSColor::labelColor()));caption.setFont(Some(&NSFont::systemFontOfSize(14.0)));
        caption.setAutoresizingMask(objc2_app_kit::NSAutoresizingMaskOptions::ViewWidthSizable);
        header.addSubview(&caption);
        let controls=if state.tile {vec![("edit",if state.editing {"checkmark"}else{"pencil"},if state.editing {"保存并切换阅读模式"}else{"切换写作模式"}),("lock","lock","锁定便签并允许鼠标穿透"),("store","rectangle.compress.vertical","收纳到屏幕边缘"),("close","xmark","取消钉屏")]}
            else {vec![("edit","checkmark","保存便签"),("pin","pin","钉到屏幕"),("close","xmark","关闭便签")]};
        for (i,(name,symbol,label)) in controls.iter().enumerate() {
            let b=NoteButton::alloc(mtm).set_ivars(Action {app:w.app_handle().clone(),label:w.label().into(),name:(*name).into()});
            let b:Retained<NoteButton>=unsafe {msg_send![super(b),initWithFrame:NSRect::new(NSPoint::new(320.0-32.0*(controls.len()-i) as f64,12.0),NSSize::new(24.0,24.0))]};
            b.setBordered(false);b.setFocusRingType(NSFocusRingType::None);b.setImageScaling(NSImageScaling::ScaleProportionallyDown);b.setContentTintColor(Some(&NSColor::secondaryLabelColor()));
            if let Some(image)=NSImage::imageWithSystemSymbolName_accessibilityDescription(&NSString::from_str(symbol),Some(&NSString::from_str(label))){b.setImage(Some(&image));}
            b.setAccessibilityLabel(Some(&NSString::from_str(label)));b.setToolTip(Some(&NSString::from_str(label)));
            b.setEnabled(!state.locked);b.setAutoresizingMask(objc2_app_kit::NSAutoresizingMaskOptions::ViewMinXMargin);
            unsafe {b.setTarget(Some(&b));b.setAction(Some(sel!(activate:)));}header.addSubview(&b);
        }
        CHROME.with(|chrome| { let mut chrome=chrome.borrow_mut();let body_constraints=if let Some(old)=chrome.remove(w.label()){old.header.removeFromSuperview();old.body_constraints}else{Vec::new()};chrome.insert(w.label().into(),Chrome {state,header,body_constraints}); });
        let result=crate::macos_material::attach_note_shell(&w).map(|_|true);let _=tx.send(result);
    })?;
    rx.recv().map_err(|e| crate::services::notes::AppError {
        code: "macNoteShell".into(),
        message: e.to_string(),
        details: Default::default(),
    })?
}
pub fn forget(label: &str) {
    CHROME.with(|chrome| {
        chrome.borrow_mut().remove(label);
    });
}
