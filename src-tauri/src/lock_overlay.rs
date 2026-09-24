//! 锁定便签的唯一可交互区域。独立原生小窗口避免整窗穿透时解锁按钮也失效。
use crate::{desktop, surface_sessions};
use std::{
    collections::HashMap,
    ptr::null_mut,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{
        BeginPaint, DrawTextW, EndPaint, FillRect, GetSysColorBrush, COLOR_WINDOW, DT_CENTER,
        DT_SINGLELINE, DT_VCENTER, PAINTSTRUCT,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, GetWindowRect, IsWindow, RegisterClassExW,
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, WM_LBUTTONUP, WM_PAINT, WNDCLASSEXW,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
    },
};

const BUTTON_WIDTH: i32 = 64;
const BUTTON_HEIGHT: i32 = 28;
static APP: OnceLock<AppHandle> = OnceLock::new();
struct OverlayEntry {
    handle: isize,
    key: String,
}
static OVERLAYS: OnceLock<Mutex<HashMap<String, OverlayEntry>>> = OnceLock::new();
static CLASS: OnceLock<Vec<u16>> = OnceLock::new();

fn overlays() -> &'static Mutex<HashMap<String, OverlayEntry>> {
    OVERLAYS.get_or_init(|| Mutex::new(HashMap::new()))
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
        WM_PAINT => {
            let mut paint: PAINTSTRUCT = unsafe { std::mem::zeroed() };
            let dc = unsafe { BeginPaint(hwnd, &mut paint) };
            let rect = RECT {
                left: 0,
                top: 0,
                right: BUTTON_WIDTH,
                bottom: BUTTON_HEIGHT,
            };
            unsafe { FillRect(dc, &rect, GetSysColorBrush(COLOR_WINDOW)) };
            let mut text_rect = rect;
            let text: Vec<u16> = "解锁".encode_utf16().collect();
            unsafe {
                DrawTextW(
                    dc,
                    text.as_ptr(),
                    text.len() as i32,
                    &mut text_rect,
                    DT_CENTER | DT_VCENTER | DT_SINGLELINE,
                )
            };
            unsafe { EndPaint(hwnd, &paint) };
            0
        }
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
        class.hbrBackground = unsafe { GetSysColorBrush(COLOR_WINDOW) };
        class.lpszClassName = class_name().as_ptr();
        (unsafe { RegisterClassExW(&class) }) != 0
    })
}

unsafe fn position(overlay: HWND, owner: HWND) {
    if unsafe { IsWindow(owner) } == 0 {
        return;
    }
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(owner, &mut rect) } == 0 {
        return;
    }
    unsafe {
        SetWindowPos(
            overlay,
            HWND_TOPMOST,
            rect.right - BUTTON_WIDTH - 8,
            rect.top + 8,
            BUTTON_WIDTH,
            BUTTON_HEIGHT,
            SWP_NOACTIVATE,
        )
    };
}

pub fn show(window: &WebviewWindow, key: String) {
    APP.get_or_init(|| window.app_handle().clone());
    let label = window.label().to_string();
    let Ok(owner) = window.hwnd() else { return };
    let owner = owner.0 as isize;
    let _ = window.run_on_main_thread(move || unsafe {
        if let Some(existing) = overlays()
            .lock()
            .ok()
            .and_then(|map| map.get(&label).map(|entry| entry.handle))
        {
            position(existing as HWND, owner as HWND);
            return;
        }
        if !register_class() {
            return;
        }
        let instance = GetModuleHandleW(null_mut());
        let handle = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            class_name().as_ptr(),
            null_mut(),
            WS_POPUP | WS_VISIBLE,
            0,
            0,
            BUTTON_WIDTH,
            BUTTON_HEIGHT,
            owner as HWND,
            null_mut(),
            instance,
            null_mut(),
        );
        if handle.is_null() {
            return;
        }
        if let Ok(mut map) = overlays().lock() {
            map.insert(
                label,
                OverlayEntry {
                    handle: handle as isize,
                    key,
                },
            );
        }
        position(handle, owner as HWND);
    });
}

pub fn hide(window: &WebviewWindow) {
    hide_label(window.app_handle(), window.label());
}

pub fn hide_label(app: &AppHandle, label: &str) {
    let label = label.to_string();
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
        if let Some(handle) = overlays()
            .lock()
            .ok()
            .and_then(|map| map.get(&label).map(|entry| entry.handle))
        {
            unsafe { position(handle as HWND, owner as HWND) };
        }
    });
}
