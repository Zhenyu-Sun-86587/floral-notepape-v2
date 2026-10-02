//! AppKit 原位解锁：仅 24px 图标区域接受鼠标，正文仍整窗穿透。
//! 所有原生对象留在主线程；坐标通过 NSView/NSWindow 转换，不翻转整屏 Y。
use crate::{desktop, surface_sessions};
use objc2::{define_class, msg_send, rc::Retained, AnyThread, DefinedClass, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSBezierPath, NSColor, NSEvent, NSPanel, NSTrackingArea,
    NSTrackingAreaOptions, NSView, NSWindow, NSWindowOrderingMode, NSWindowStyleMask,
};
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
};
use tauri::{AppHandle, Manager, WebviewWindow};

struct IconIvars {
    app: AppHandle,
    key: String,
    hovered: Cell<bool>,
}
define_class!(
    #[unsafe(super = NSView)]
    #[thread_kind = MainThreadOnly]
    #[ivars = IconIvars]
    struct UnlockIcon;
    impl UnlockIcon {
        #[unsafe(method(isFlipped))]
        fn is_flipped(&self) -> bool { true }
        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: Option<&NSEvent>) -> bool { true }
        #[unsafe(method(drawRect:))]
        fn draw(&self, _rect: NSRect) {
            // 与网页闭锁 SVG 相同的 24 单位路径，14px 图形居中在 24px 热区。
            let s = self.bounds().size.width / 24.0;
            let u = 14.0 / 24.0 * s;
            let o = 5.0 * s;
            let point = |x: f64, y: f64| NSPoint::new(o + x * u, o + y * u);
            if self.ivars().hovered.get() {
                NSColor::colorWithSRGBRed_green_blue_alpha(0.7, 0.72, 0.69, 0.25).setFill();
                let bg = NSBezierPath::bezierPathWithOvalInRect(self.bounds());
                bg.fill();
            }
            NSColor::colorWithSRGBRed_green_blue_alpha(0.53, 0.55, 0.51, 0.75).setStroke();
            let body = NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
                NSRect::new(point(5.0, 10.0), NSSize::new(14.0*u, 11.0*u)), 2.0*u, 2.0*u);
            body.setLineWidth(1.8*u); body.stroke();
            let arch = NSBezierPath::bezierPath();
            arch.setLineWidth(1.8*u);
            arch.moveToPoint(point(8.0, 10.0)); arch.lineToPoint(point(8.0, 7.0));
            arch.curveToPoint_controlPoint1_controlPoint2(point(16.0, 7.0), point(8.0, 1.67), point(16.0, 1.67));
            arch.lineToPoint(point(16.0, 10.0)); arch.stroke();
        }
        #[unsafe(method(mouseEntered:))]
        fn mouse_entered(&self, _event: &NSEvent) { self.ivars().hovered.set(true); self.setNeedsDisplay(true); }
        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, _event: &NSEvent) { self.ivars().hovered.set(false); self.setNeedsDisplay(true); }
        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, _event: &NSEvent) {}
        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, event: &NSEvent) {
            let p = event.locationInWindow();
            let size = self.bounds().size;
            if p.x < 0.0 || p.y < 0.0 || p.x > size.width || p.y > size.height { return; }
            let app = self.ivars().app.clone(); let key = self.ivars().key.clone();
            // 保存/会话更新不阻塞 AppKit 事件回调。
            std::thread::spawn(move || {
                if let Ok(mut session) = surface_sessions::get(&key) {
                    session.locked = false;
                    if let Err(error) = desktop::save_surface_session(&app, session) {
                        eprintln!("Mac 解锁失败: {error}");
                    }
                }
            });
        }
    }
);
#[derive(Clone, Copy)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
}
struct Entry {
    panel: Retained<NSPanel>,
}
thread_local! {
    static OVERLAYS: RefCell<HashMap<String, Entry>> = RefCell::new(HashMap::new());
    static BOUNDS: RefCell<HashMap<String, Bounds>> = RefCell::new(HashMap::new());
}
fn parent(window: &WebviewWindow) -> Option<Retained<NSWindow>> {
    // 仅在 run_on_main_thread 回调内读取 Tauri 持有的有效 NSWindow。
    let ptr = window.ns_window().ok()?;
    unsafe { Retained::retain(ptr.cast::<NSWindow>()) }
}
fn frame(window: &WebviewWindow, parent: &NSWindow) -> Option<NSRect> {
    let view = parent.contentView()?;
    let size = view.bounds().size;
    let b = BOUNDS.with(|map| map.borrow().get(window.label()).copied())?;
    let rect = button_rect(size, view.isFlipped(), b);
    Some(parent.convertRectToScreen(view.convertRect_toView(rect, None)))
}
fn button_rect(size: NSSize, flipped: bool, b: Bounds) -> NSRect {
    let sx = size.width / b.viewport_width;
    let sy = size.height / b.viewport_height;
    let y = if flipped {
        b.y * sy
    } else {
        size.height - (b.y + b.height) * sy
    };
    NSRect::new(
        NSPoint::new(b.x * sx, y),
        NSSize::new(b.width * sx, b.height * sy),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_css_bounds_to_view_points_without_screen_height_or_retina_multiplier() {
        let b = Bounds {
            x: 180.0,
            y: 8.0,
            width: 24.0,
            height: 24.0,
            viewport_width: 260.0,
            viewport_height: 260.0,
        };
        let rect = button_rect(NSSize::new(260.0, 260.0), false, b);
        assert_eq!(rect.origin, NSPoint::new(180.0, 228.0));
        assert_eq!(rect.size, NSSize::new(24.0, 24.0));
        let scaled = button_rect(NSSize::new(520.0, 520.0), true, b);
        assert_eq!(scaled.origin, NSPoint::new(360.0, 16.0));
        assert_eq!(scaled.size, NSSize::new(48.0, 48.0));
    }
}

fn hide_now(label: &str) {
    OVERLAYS.with(|map| {
        if let Some(entry) = map.borrow_mut().remove(label) {
            if let Some(parent) = entry.panel.parentWindow() {
                parent.removeChildWindow(&entry.panel);
            }
            entry.panel.orderOut(None);
            entry.panel.close();
        }
    });
}
fn show_now(window: &WebviewWindow, key: String, mtm: MainThreadMarker) {
    let Some(parent) = parent(window) else {
        return;
    };
    if !parent.isVisible() {
        return;
    }
    let Some(rect) = frame(window, &parent) else {
        // 初次恢复时 DOM 尚未上报；先保持可点击，set_bounds 到达后再开启穿透。
        let _ = window.set_ignore_cursor_events(false);
        return;
    };
    hide_now(window.label());
    let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
        NSPanel::alloc(mtm),
        rect,
        NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
        NSBackingStoreType::Buffered,
        false,
    );
    unsafe {
        panel.setReleasedWhenClosed(false);
    }
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setHasShadow(false);
    panel.setHidesOnDeactivate(false);
    panel.setFloatingPanel(true);
    panel.setLevel(parent.level());
    panel.setCollectionBehavior(crate::macos_surface::unlock_collection(
        parent.collectionBehavior(),
    ));
    let icon = UnlockIcon::alloc(mtm).set_ivars(IconIvars {
        app: window.app_handle().clone(),
        key,
        hovered: Cell::new(false),
    });
    let icon: Retained<UnlockIcon> = unsafe {
        msg_send![super(icon), initWithFrame: NSRect::new(NSPoint::new(0.0,0.0),rect.size)]
    };
    let tracking = unsafe {
        NSTrackingArea::initWithRect_options_owner_userInfo(
            NSTrackingArea::alloc(),
            icon.bounds(),
            NSTrackingAreaOptions::MouseEnteredAndExited
                | NSTrackingAreaOptions::ActiveAlways
                | NSTrackingAreaOptions::InVisibleRect,
            Some(&icon),
            None,
        )
    };
    icon.addTrackingArea(&tracking);
    panel.setContentView(Some(&icon));
    unsafe {
        parent.addChildWindow_ordered(&panel, NSWindowOrderingMode::Above);
    }
    // 不激活应用或抢走键盘焦点；解锁热区完成后才令主体穿透。
    panel.orderFrontRegardless();
    OVERLAYS.with(|map| {
        map.borrow_mut()
            .insert(window.label().into(), Entry { panel });
    });
    if let Err(error) = window.set_ignore_cursor_events(true) {
        eprintln!("Mac 穿透失败: {error}");
        hide_now(window.label());
    }
}
pub fn show(window: &WebviewWindow, key: String) {
    let w = window.clone();
    let _ = window.app_handle().run_on_main_thread(move || {
        if let Some(mtm) = MainThreadMarker::new() {
            show_now(&w, key, mtm);
        }
    });
}
pub fn hide(window: &WebviewWindow) {
    hide_label(window.app_handle(), window.label());
}
pub fn hide_label(app: &AppHandle, label: &str) {
    let label = label.to_owned();
    let _ = app.run_on_main_thread(move || {
        hide_now(&label);
        BOUNDS.with(|map| {
            map.borrow_mut().remove(&label);
        });
    });
}
pub fn reposition(window: &WebviewWindow) {
    let w = window.clone();
    let _ = window.app_handle().run_on_main_thread(move || {
        if let Some(parent) = parent(&w) {
            if let Some(rect) = frame(&w, &parent) {
                OVERLAYS.with(|map| {
                    if let Some(entry) = map.borrow().get(w.label()) {
                        entry.panel.setFrame_display(rect, true);
                    }
                });
            }
        }
    });
}
pub fn set_bounds(
    window: &WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
) {
    if ![x, y, width, height, viewport_width, viewport_height]
        .iter()
        .all(|n| n.is_finite())
        || width <= 0.0
        || height <= 0.0
        || viewport_width <= 0.0
        || viewport_height <= 0.0
    {
        return;
    }
    let w = window.clone();
    let _ = window.app_handle().run_on_main_thread(move || {
        BOUNDS.with(|map| {
            map.borrow_mut().insert(
                w.label().into(),
                Bounds {
                    x,
                    y,
                    width,
                    height,
                    viewport_width,
                    viewport_height,
                },
            );
        });
        if let Ok(key) = desktop::surface_key_for_window(&w) {
            if surface_sessions::get(&key).is_ok_and(|s| s.locked) {
                if let Some(mtm) = MainThreadMarker::new() {
                    show_now(&w, key, mtm);
                }
            }
        }
    });
}
