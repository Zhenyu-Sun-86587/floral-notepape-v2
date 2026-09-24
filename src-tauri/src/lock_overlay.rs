//! 锁定便签的唯一可交互区域。独立原生小窗口避免整窗穿透时解锁按钮也失效。
use crate::{desktop, surface_sessions};
use std::{
    collections::HashMap,
    ptr::null_mut,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM},
    Graphics::Gdi::{
        ClientToScreen, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject,
        AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, IsWindow, RegisterClassExW,
        SetWindowPos, ShowWindow, UpdateLayeredWindow, HWND_TOPMOST, SWP_NOACTIVATE,
        SW_SHOWNOACTIVATE, ULW_ALPHA, WM_LBUTTONUP, WNDCLASSEXW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
    },
};

const BUTTON_SIZE: i32 = 24;
static APP: OnceLock<AppHandle> = OnceLock::new();
struct OverlayEntry {
    handle: isize,
    key: String,
    size: i32,
}
static OVERLAYS: OnceLock<Mutex<HashMap<String, OverlayEntry>>> = OnceLock::new();
#[derive(Clone, Copy)]
struct ButtonBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
}
static BUTTON_BOUNDS: OnceLock<Mutex<HashMap<String, ButtonBounds>>> = OnceLock::new();
static CLASS: OnceLock<Vec<u16>> = OnceLock::new();

fn overlays() -> &'static Mutex<HashMap<String, OverlayEntry>> {
    OVERLAYS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn button_bounds() -> &'static Mutex<HashMap<String, ButtonBounds>> {
    BUTTON_BOUNDS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn class_name() -> &'static [u16] {
    CLASS.get_or_init(|| "HermesSurfaceUnlock\0".encode_utf16().collect())
}

unsafe extern "system" fn overlay_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_LBUTTONUP => {
            let key = overlays().lock().ok().and_then(|map| {
                map.values()
                    .find(|entry| entry.handle == hwnd as isize)
                    .map(|entry| entry.key.clone())
            });
            if let (Some(key), Some(app)) = (key, APP.get().cloned()) {
                // 不在 WndProc 内同步修改 Tauri 窗口，避免跨线程窗口调用重入。
                std::thread::spawn(move || {
                    if let Ok(mut session) = surface_sessions::get(&key) {
                        session.locked = false;
                        if let Err(error) = desktop::save_surface_session(&app, session) {
                            eprintln!("failed to unlock {key}: {error}");
                        }
                    }
                });
            }
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

unsafe fn register_class() -> bool {
    static REGISTERED: OnceLock<bool> = OnceLock::new();
    *REGISTERED.get_or_init(|| {
        let instance = unsafe { GetModuleHandleW(null_mut()) };
        let mut class: WNDCLASSEXW = unsafe { std::mem::zeroed() };
        class.cbSize = std::mem::size_of::<WNDCLASSEXW>() as u32;
        class.lpfnWndProc = Some(overlay_proc);
        class.hInstance = instance;
        class.lpszClassName = class_name().as_ptr();
        (unsafe { RegisterClassExW(&class) }) != 0
    })
}

fn segment_distance(x: f32, y: f32, a: (f32, f32), b: (f32, f32)) -> f32 {
    let dx = b.0 - a.0;
    let dy = b.1 - a.1;
    let t = (((x - a.0) * dx + (y - a.1) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
    ((x - a.0 - t * dx).powi(2) + (y - a.1 - t * dy).powi(2)).sqrt()
}

fn icon_coverage(x: f32, y: f32, size: i32) -> u8 {
    // 沿用便签 SVG 锁图标的 24x24 坐标，并缩放到按钮中的 14x14 图形区域。
    let x = (x - 5.0) * 24.0 / 14.0;
    let y = (y - 5.0) * 24.0 / 14.0;
    let shackle_distance = segment_distance(x, y, (8.0, 10.0), (8.0, 7.0))
        .min(segment_distance(x, y, (16.0, 7.0), (16.0, 10.0)))
        .min(if y <= 7.0 && (8.0..=16.0).contains(&x) {
            ((x - 12.0).hypot(y - 7.0) - 4.0).abs()
        } else {
            f32::INFINITY
        });
    let dx = (x - 12.0).abs() - 5.0;
    let dy = (y - 15.5).abs() - 3.5;
    let body_distance =
        (dx.max(0.0).powi(2) + dy.max(0.0).powi(2)).sqrt() + dx.max(dy).min(0.0) - 2.0;
    // 便签仍整窗穿透；透明按钮保留 1/255 alpha，确保整块 24px 区域可点击。
    let edge_distance = shackle_distance.min(body_distance.abs());
    let pixels_per_svg_unit = size as f32 * 14.0 / (24.0 * 24.0);
    (((0.9 - edge_distance) * pixels_per_svg_unit + 0.5).clamp(0.0, 1.0) * 210.0) as u8
}

unsafe fn paint_icon(overlay: HWND, destination: POINT, size: i32) -> bool {
    let mut info: BITMAPINFO = unsafe { std::mem::zeroed() };
    info.bmiHeader.biSize = std::mem::size_of_val(&info.bmiHeader) as u32;
    info.bmiHeader.biWidth = size;
    info.bmiHeader.biHeight = -size;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    let mut bits = null_mut();
    let bitmap =
        unsafe { CreateDIBSection(null_mut(), &info, DIB_RGB_COLORS, &mut bits, null_mut(), 0) };
    if bitmap.is_null() || bits.is_null() {
        return false;
    }
    let dc = unsafe { CreateCompatibleDC(null_mut()) };
    if dc.is_null() {
        unsafe { DeleteObject(bitmap) };
        return false;
    }
    let previous = unsafe { SelectObject(dc, bitmap) };
    let pixels =
        unsafe { std::slice::from_raw_parts_mut(bits as *mut u8, (size * size * 4) as usize) };
    for y in 0..size {
        for x in 0..size {
            let logical_x = (x as f32 + 0.5) * BUTTON_SIZE as f32 / size as f32;
            let logical_y = (y as f32 + 0.5) * BUTTON_SIZE as f32 / size as f32;
            let alpha = icon_coverage(logical_x, logical_y, size).max(1);
            let offset = ((y * size + x) * 4) as usize;
            let gray = (150u16 * alpha as u16 / 255) as u8;
            pixels[offset..offset + 4].copy_from_slice(&[gray, gray, gray, alpha]);
        }
    }
    let dimensions = SIZE { cx: size, cy: size };
    let source = POINT { x: 0, y: 0 };
    let blend = BLENDFUNCTION {
        BlendOp: AC_SRC_OVER as u8,
        BlendFlags: 0,
        SourceConstantAlpha: 255,
        AlphaFormat: AC_SRC_ALPHA as u8,
    };
    let painted = unsafe {
        UpdateLayeredWindow(
            overlay,
            null_mut(),
            &destination,
            &dimensions,
            dc,
            &source,
            0,
            &blend,
            ULW_ALPHA,
        )
    } != 0;
    unsafe {
        SelectObject(dc, previous);
        DeleteDC(dc);
        DeleteObject(bitmap);
    }
    painted
}

unsafe fn position(overlay: HWND, owner: HWND, label: &str, previous_size: i32) -> i32 {
    if unsafe { IsWindow(owner) } == 0 {
        return previous_size;
    }
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    let mut origin = POINT { x: 0, y: 0 };
    if unsafe { GetClientRect(owner, &mut rect) } == 0
        || unsafe { ClientToScreen(owner, &mut origin) } == 0
    {
        return previous_size;
    }
    let measured = button_bounds()
        .lock()
        .ok()
        .and_then(|map| map.get(label).copied());
    let (destination, size) = if let Some(bounds) = measured {
        // DOM 实测按钮矩形，按 WebView 视口与原生客户区的比例转换为屏幕物理坐标。
        let scale_x = rect.right as f64 / bounds.viewport_width;
        let scale_y = rect.bottom as f64 / bounds.viewport_height;
        (
            POINT {
                x: origin.x + (bounds.x * scale_x).round() as i32,
                y: origin.y + (bounds.y * scale_y).round() as i32,
            },
            ((bounds.width * scale_x)
                .min(bounds.height * scale_y)
                .round() as i32)
                .max(1),
        )
    } else {
        // 首次加载锁定便签时 DOM 尚未上报；上报后立即使用实测坐标覆盖。
        (
            POINT {
                x: origin.x + rect.right - 60,
                y: origin.y + 8,
            },
            BUTTON_SIZE,
        )
    };
    if previous_size != size && !unsafe { paint_icon(overlay, destination, size) } {
        return previous_size;
    }
    unsafe {
        SetWindowPos(
            overlay,
            HWND_TOPMOST,
            destination.x,
            destination.y,
            size,
            size,
            SWP_NOACTIVATE,
        )
    };
    size
}

pub fn show(window: &WebviewWindow, key: String) {
    APP.get_or_init(|| window.app_handle().clone());
    let label = window.label().to_string();
    let Ok(owner) = window.hwnd() else { return };
    let owner = owner.0 as isize;
    let _ = window.run_on_main_thread(move || unsafe {
        if let Ok(mut map) = overlays().lock() {
            if let Some(entry) = map.get_mut(&label) {
                entry.size = position(entry.handle as HWND, owner as HWND, &label, entry.size);
                return;
            }
        }
        if !register_class() {
            return;
        }
        let instance = GetModuleHandleW(null_mut());
        let handle = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED,
            class_name().as_ptr(),
            null_mut(),
            WS_POPUP,
            0,
            0,
            BUTTON_SIZE,
            BUTTON_SIZE,
            owner as HWND,
            null_mut(),
            instance,
            null_mut(),
        );
        if handle.is_null() {
            return;
        }
        let size = position(handle, owner as HWND, &label, 0);
        if size == 0 {
            DestroyWindow(handle);
            return;
        }
        if let Ok(mut map) = overlays().lock() {
            map.insert(
                label,
                OverlayEntry {
                    handle: handle as isize,
                    key,
                    size,
                },
            );
        }
        ShowWindow(handle, SW_SHOWNOACTIVATE);
    });
}

pub fn hide(window: &WebviewWindow) {
    hide_label(window.app_handle(), window.label());
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
    let values = [x, y, width, height, viewport_width, viewport_height];
    if values.iter().any(|value| !value.is_finite())
        || width <= 0.0
        || height <= 0.0
        || viewport_width <= 0.0
        || viewport_height <= 0.0
    {
        return;
    }
    if let Ok(mut map) = button_bounds().lock() {
        map.insert(
            window.label().to_string(),
            ButtonBounds {
                x,
                y,
                width,
                height,
                viewport_width,
                viewport_height,
            },
        );
    }
    reposition(window);
}

pub fn hide_label(app: &AppHandle, label: &str) {
    let label = label.to_string();
    if let Ok(mut map) = button_bounds().lock() {
        map.remove(&label);
    }
    let _ = app.run_on_main_thread(move || {
        if let Some(entry) = overlays()
            .lock()
            .ok()
            .and_then(|mut map| map.remove(&label))
        {
            unsafe { DestroyWindow(entry.handle as HWND) };
        }
    });
}

pub fn reposition(window: &WebviewWindow) {
    let label = window.label().to_string();
    let Ok(owner) = window.hwnd() else { return };
    let owner = owner.0 as isize;
    let _ = window.run_on_main_thread(move || {
        if let Ok(mut map) = overlays().lock() {
            if let Some(entry) = map.get_mut(&label) {
                entry.size =
                    unsafe { position(entry.handle as HWND, owner as HWND, &label, entry.size) };
            }
        }
    });
}
