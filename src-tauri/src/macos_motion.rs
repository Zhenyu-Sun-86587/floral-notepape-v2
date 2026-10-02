//! A short-lived, non-interactive AppKit glass bridge between capsule windows.
//! Only nearby merge/split changes animate; normal updates never create a panel.
use crate::{desktop::capsule_groups::GroupSurface, macos_material};
use objc2::{
    msg_send,
    rc::{Allocated, Retained},
    runtime::AnyClass,
    MainThreadOnly,
};
use objc2_app_kit::{
    NSAnimationContext, NSAutoresizingMaskOptions as Sizing, NSBackingStoreType, NSButton, NSColor,
    NSImage, NSPanel, NSView, NSWindow, NSWindowStyleMask,
};
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize, NSString};
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    ptr::NonNull,
};
use tauri::Manager;
struct Bridge {
    id: u64,
    panel: Retained<NSPanel>,
    hidden: Vec<Retained<NSWindow>>,
}
thread_local! { static BRIDGE:RefCell<Option<Bridge>>=const {RefCell::new(None)}; static SERIAL:RefCell<u64>=const {RefCell::new(0)}; }
fn changed_keys(previous: &[Vec<String>], next: &[Vec<String>]) -> BTreeSet<String> {
    let owner = |groups: &[Vec<String>]| {
        groups
            .iter()
            .flat_map(|group| {
                let set = group.iter().cloned().collect::<BTreeSet<_>>();
                group.iter().map(move |key| (key.clone(), set.clone()))
            })
            .collect::<BTreeMap<_, _>>()
    };
    let before = owner(previous);
    let after = owner(next);
    before
        .iter()
        .filter(|(key, group)| after.get(*key).is_some_and(|new| new != *group))
        .map(|(key, _)| key.clone())
        .collect()
}
fn view(class: &AnyClass, frame: NSRect) -> Retained<NSView> {
    unsafe {
        let a: Allocated<NSView> = msg_send![class, alloc];
        msg_send![a,initWithFrame:frame]
    }
}
fn cells(
    app: &tauri::AppHandle,
    groups: &[GroupSurface],
    keys: &BTreeSet<String>,
) -> Vec<(String, NSRect, Retained<NSWindow>)> {
    let mut cells = Vec::new();
    for g in groups {
        let Some(w) = app.get_window(g.native_label()) else {
            continue;
        };
        let Ok(ptr) = w.ns_window() else {
            continue;
        };
        let Some(native) = (unsafe { Retained::retain(ptr.cast::<NSWindow>()) }) else {
            continue;
        };
        let frame = native.frame();
        for (i, m) in g.members.iter().enumerate() {
            if !keys.contains(&m.key) {
                continue;
            }
            let [x, y, w, h] = crate::macos_droplet::geometry(g.members.len()).cells[i];
            let rect = NSRect::new(
                NSPoint::new(
                    frame.origin.x + x,
                    frame.origin.y + frame.size.height - y - h,
                ),
                NSSize::new(w, h),
            );
            cells.push((m.key.clone(), rect, native.clone()));
        }
    }
    cells
}
fn stop() {
    BRIDGE.with(|bridge| {
        if let Some(old) = bridge.borrow_mut().take() {
            old.panel.orderOut(None);
            for w in old.hidden {
                w.setAlphaValue(1.0);
            }
        }
    });
}
pub fn cancel() {
    stop();
}
pub fn capture(app: &tauri::AppHandle, groups: &[GroupSurface]) -> BTreeMap<String, NSRect> {
    let keys = groups.iter().flat_map(|g| g.member_keys()).collect();
    cells(app, groups, &keys)
        .into_iter()
        .map(|(key, rect, _)| (key, rect))
        .collect()
}
pub fn transition(
    app: &tauri::AppHandle,
    previous: &[GroupSurface],
    next: &[GroupSurface],
    start_frames: BTreeMap<String, NSRect>,
) {
    stop();
    if !macos_material::glass_motion_enabled() {
        return;
    }
    let reduce: bool = unsafe {
        let c = AnyClass::get(c"NSWorkspace").unwrap();
        let w: *mut objc2::runtime::AnyObject = msg_send![c, sharedWorkspace];
        msg_send![w, accessibilityDisplayShouldReduceMotion]
    };
    if reduce || macos_material::state("capsule-group-motion").kind != "glass" {
        return;
    }
    let Some(class) = AnyClass::get(c"NSGlassEffectContainerView") else {
        return;
    };
    let keys = changed_keys(
        &previous.iter().map(|g| g.member_keys()).collect::<Vec<_>>(),
        &next.iter().map(|g| g.member_keys()).collect::<Vec<_>>(),
    );
    if keys.len() < 2 || keys.len() > 12 {
        return;
    }
    let mut before = cells(app, previous, &keys);
    for (key, rect, _) in &mut before {
        if let Some(start) = start_frames.get(key) {
            *rect = *start;
        }
    }
    let after = cells(app, next, &keys);
    if before.len() != after.len() || before.len() != keys.len() {
        return;
    }
    let mut x = f64::INFINITY;
    let mut y = f64::INFINITY;
    let mut right = f64::NEG_INFINITY;
    let mut top = f64::NEG_INFINITY;
    for (_, r, _) in before.iter().chain(after.iter()) {
        x = x.min(r.origin.x);
        y = y.min(r.origin.y);
        right = right.max(r.origin.x + r.size.width);
        top = top.max(r.origin.y + r.size.height);
    }
    if right - x > 640.0 || top - y > 640.0 || !x.is_finite() || !y.is_finite() {
        return;
    }
    let frame = NSRect::new(
        NSPoint::new(x - 12.0, y - 12.0),
        NSSize::new(right - x + 24.0, top - y + 24.0),
    );
    let mtm = MainThreadMarker::new().unwrap();
    let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
        NSPanel::alloc(mtm),
        frame,
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
    panel.setIgnoresMouseEvents(true);
    panel.setHidesOnDeactivate(false);
    crate::macos_surface::configure_capsule_native(&panel);
    let bounds = NSRect::new(NSPoint::new(0.0, 0.0), frame.size);
    let stage = NSView::initWithFrame(NSView::alloc(mtm), bounds);
    let container = view(class, bounds);
    unsafe {
        let _: () = msg_send![&*container,setSpacing:18.0_f64];
        let _: () = msg_send![&*container,setContentView:&*stage];
    }
    panel.setContentView(Some(&container));
    let mut motions = Vec::new();
    for (key, start, _) in &before {
        let Some((_, end, _)) = after.iter().find(|(k, _, _)| k == key) else {
            continue;
        };
        let local = |r: &NSRect| {
            NSRect::new(
                NSPoint::new(r.origin.x - frame.origin.x, r.origin.y - frame.origin.y),
                r.size,
            )
        };
        let glass = view(AnyClass::get(c"NSGlassEffectView").unwrap(), local(start));
        let content = NSView::initWithFrame(
            NSView::alloc(mtm),
            NSRect::new(NSPoint::new(0.0, 0.0), start.size),
        );
        let icon = NSButton::initWithFrame(
            NSButton::alloc(mtm),
            NSRect::new(
                NSPoint::new(
                    (start.size.width - 24.0) / 2.0,
                    (start.size.height - 24.0) / 2.0,
                ),
                NSSize::new(24.0, 24.0),
            ),
        );
        icon.setBordered(false);
        icon.setContentTintColor(Some(&NSColor::labelColor()));
        icon.setAutoresizingMask(
            Sizing::ViewMinXMargin
                | Sizing::ViewMaxXMargin
                | Sizing::ViewMinYMargin
                | Sizing::ViewMaxYMargin,
        );
        if let Some(image) = NSImage::imageWithSystemSymbolName_accessibilityDescription(
            &NSString::from_str("doc.text"),
            None,
        ) {
            icon.setImage(Some(&image));
        }
        content.addSubview(&icon);
        unsafe {
            let _: () = msg_send![&*glass,setStyle:1_isize];
            let _: () = msg_send![&*glass,setCornerRadius:18.0_f64];
            let _: () = msg_send![&*glass,setContentView:&*content];
        }
        stage.addSubview(&glass);
        motions.push((glass, local(end)));
    }
    let mut hidden = Vec::new();
    for (_, _, w) in &after {
        if !hidden.iter().any(|old: &Retained<NSWindow>| old == w) {
            // Keep the real hit surface visible while the decorative bridge
            // animates. Zero alpha made WindowServer send clicks to Finder.
            hidden.push(w.clone());
        }
    }
    panel.orderFrontRegardless();
    let id = SERIAL.with(|s| {
        let mut s = s.borrow_mut();
        *s += 1;
        *s
    });
    BRIDGE.with(|b| *b.borrow_mut() = Some(Bridge { id, panel, hidden }));
    let changes = block2::RcBlock::new(move |context: NonNull<NSAnimationContext>| {
        let context = unsafe { context.as_ref() };
        context.setDuration(0.22);
        context.setAllowsImplicitAnimation(true);
        for (view, frame) in &motions {
            unsafe {
                let animator: *mut objc2::runtime::AnyObject = msg_send![&**view, animator];
                let _: () = msg_send![animator,setFrame:*frame];
            }
        }
    });
    let complete = block2::RcBlock::new(move || {
        let matches = BRIDGE.with(|b| b.borrow().as_ref().is_some_and(|b| b.id == id));
        if matches {
            stop();
        }
    });
    NSAnimationContext::runAnimationGroup_completionHandler(&changes, Some(&complete));
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn membership_changes_animate_both_merge_and_split() {
        let separate = vec![vec!["a".into()], vec!["b".into()]];
        let together = vec![vec!["a".into(), "b".into()]];
        assert_eq!(
            changed_keys(&separate, &together),
            BTreeSet::from(["a".into(), "b".into()])
        );
        assert_eq!(
            changed_keys(&together, &separate),
            changed_keys(&separate, &together)
        );
    }
    #[test]
    fn reorder_or_new_note_is_not_a_merge() {
        let a = vec![vec!["a".into(), "b".into()]];
        let b = vec![vec!["b".into(), "a".into()], vec!["c".into()]];
        assert!(changed_keys(&a, &b).is_empty());
    }
}
