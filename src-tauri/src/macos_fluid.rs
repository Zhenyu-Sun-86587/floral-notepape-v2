//! All calls execute on AppKit's main thread; Swift owns views/capture lifetimes.
use objc2_app_kit::{NSView, NSWindow};
use std::ffi::{c_char, c_void, CString};
unsafe extern "C" {
    fn hermes_fluid_install(
        window: *mut c_void,
        backing: *mut c_void,
        label: *const c_char,
        cells: *const f64,
        count: i32,
        opacity: f64,
    );
    fn hermes_fluid_remove(label: *const c_char);
    fn hermes_fluid_press(label: *const c_char, pressed: i32);
    fn hermes_fluid_visible(label: *const c_char, visible: i32);
    fn hermes_fluid_morph(label: *const c_char, start: *const f64, end: *const f64, count: i32);
    fn hermes_fluid_status(output: *mut c_char, capacity: i32);
    fn hermes_fluid_request();
}
#[cfg(test)]
mod tests {
    unsafe extern "C" {
        fn hermes_fluid_selftest() -> i32;
    }
    #[test]
    fn metal_shader_draws_transparent_outside_and_connected_glass_inside() {
        assert_eq!(unsafe { hermes_fluid_selftest() }, 1);
    }
}
pub fn install(window: &NSWindow, backing: &NSView, label: &str, cells: &[[f64; 4]], opacity: f64) {
    let Ok(label) = CString::new(label) else {
        return;
    };
    unsafe {
        hermes_fluid_install(
            (window as *const NSWindow).cast_mut().cast(),
            (backing as *const NSView).cast_mut().cast(),
            label.as_ptr(),
            cells.as_ptr().cast(),
            cells.len() as i32,
            opacity,
        );
    }
}
pub fn remove(label: &str) {
    if let Ok(label) = CString::new(label) {
        unsafe {
            hermes_fluid_remove(label.as_ptr());
        }
    }
}
pub fn press(label: &str, pressed: bool) {
    if let Ok(label) = CString::new(label) {
        unsafe {
            hermes_fluid_press(label.as_ptr(), i32::from(pressed));
        }
    }
}
pub fn visible(label: &str, visible: bool) {
    if let Ok(label) = CString::new(label) {
        unsafe {
            hermes_fluid_visible(label.as_ptr(), i32::from(visible));
        }
    }
}
pub fn morph(label: &str, start: &[[f64; 4]], end: &[[f64; 4]]) {
    if start.len() != end.len() {
        return;
    }
    if let Ok(label) = CString::new(label) {
        unsafe {
            hermes_fluid_morph(
                label.as_ptr(),
                start.as_ptr().cast(),
                end.as_ptr().cast(),
                start.len() as i32,
            );
        }
    }
}
pub fn status(request: bool) -> String {
    let mut bytes = [0u8; 256];
    unsafe {
        if request {
            hermes_fluid_request();
        }
        hermes_fluid_status(bytes.as_mut_ptr().cast(), bytes.len() as i32);
    }
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}
