//! Windows 桌面层适配：窗口成为承载桌面图标的 Explorer 窗口的子窗口。
use crate::services::notes::AppError;
use std::ptr::null_mut;
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{GetLastError, SetLastError, BOOL, HWND, LPARAM, POINT, RECT},
    Graphics::{
        Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND},
        Gdi::MapWindowPoints,
    },
    UI::{
        HiDpi::{AreDpiAwarenessContextsEqual, GetWindowDpiAwarenessContext},
        WindowsAndMessaging::{
            EnumWindows, FindWindowExW, GetParent, GetWindowLongPtrW, GetWindowRect, IsWindow,
            SetParent, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, HWND_TOP, SWP_FRAMECHANGED,
            SWP_NOACTIVATE, WS_CHILD, WS_POPUP,
        },
    },
};

fn error(message: impl Into<String>) -> AppError {
    AppError {
        code: "desktopAttachment".into(),
        message: message.into(),
        details: Default::default(),
    }
}

fn native_error(operation: &str) -> AppError {
    error(format!(
        "桌面附着失败：{operation}（Win32 错误 {}）",
        unsafe { GetLastError() }
    ))
}

unsafe extern "system" fn find_icon_host(hwnd: HWND, data: LPARAM) -> BOOL {
    let class: Vec<u16> = "SHELLDLL_DefView\0".encode_utf16().collect();
    if unsafe { FindWindowExW(hwnd, null_mut(), class.as_ptr(), null_mut()) } != null_mut() {
        unsafe { *(data as *mut HWND) = hwnd };
        return 0;
    }
    1
}

fn desktop_host() -> Result<HWND, AppError> {
    let mut host: HWND = null_mut();
    unsafe { EnumWindows(Some(find_icon_host), &mut host as *mut HWND as LPARAM) };
    if host.is_null() || unsafe { IsWindow(host) } == 0 {
        return Err(error("找不到 Explorer 桌面图标窗口，请确认桌面已加载"));
    }
    Ok(host)
}

fn hwnd(window: &WebviewWindow) -> Result<HWND, AppError> {
    Ok(window.hwnd()?.0)
}

fn screen_rect(handle: HWND) -> Result<RECT, AppError> {
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(handle, &mut rect) } == 0 {
        return Err(native_error("读取窗口位置"));
    }
    Ok(rect)
}

pub fn screen_bounds(window: &WebviewWindow) -> Result<(i32, i32), AppError> {
    let rect = screen_rect(hwnd(window)?)?;
    Ok((rect.left, rect.top))
}

pub fn is_attached(window: &WebviewWindow) -> bool {
    let Ok(handle) = hwnd(window) else {
        return false;
    };
    unsafe {
        !GetParent(handle).is_null()
            && GetWindowLongPtrW(handle, GWL_STYLE) & WS_CHILD as isize != 0
    }
}

pub fn attach(window: &WebviewWindow) -> Result<(), AppError> {
    if is_attached(window) {
        return Ok(());
    }
    let handle = hwnd(window)?;
    let host = desktop_host()?;
    if unsafe {
        AreDpiAwarenessContextsEqual(
            GetWindowDpiAwarenessContext(handle),
            GetWindowDpiAwarenessContext(host),
        )
    } == 0
    {
        // 跨进程 DPI 模式不一致时 SetParent 可重置本进程的 DPI 上下文，直接拒绝。
        return Err(error("Explorer 与便签的 DPI 模式不同，无法安全附着桌面"));
    }
    // DWM 的 Acrylic/窗口阴影用于顶层窗口；保留在 Explorer 子窗口上会露出黑色边缘。
    let no_effects: Option<tauri::utils::config::WindowEffectsConfig> = None;
    window.set_effects(no_effects)?;
    window.set_shadow(false)?;
    unsafe {
        DwmSetWindowAttribute(
            handle,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            (&DWMWCP_DONOTROUND as *const i32).cast(),
            std::mem::size_of::<i32>() as u32,
        );
    }
    let rect = screen_rect(handle)?;
    let original_style = unsafe { GetWindowLongPtrW(handle, GWL_STYLE) };
    let child_style = (original_style | WS_CHILD as isize) & !(WS_POPUP as isize);
    unsafe {
        SetLastError(0);
        SetWindowLongPtrW(handle, GWL_STYLE, child_style);
    }
    if unsafe { GetLastError() } != 0 {
        return Err(native_error("设置子窗口样式"));
    }
    unsafe { SetLastError(0) };
    let old_parent = unsafe { SetParent(handle, host) };
    if old_parent.is_null() && unsafe { GetLastError() } != 0 {
        let cause = native_error("设置桌面父窗口");
        unsafe { SetWindowLongPtrW(handle, GWL_STYLE, original_style) };
        return Err(cause);
    }
    let mut point = POINT {
        x: rect.left,
        y: rect.top,
    };
    unsafe { SetLastError(0) };
    let mapped = unsafe { MapWindowPoints(null_mut(), host, &mut point, 1) };
    let mapped_error = unsafe { GetLastError() };
    let positioned = mapped_error == 0 || mapped != 0;
    if !positioned
        || unsafe {
            SetWindowPos(
                handle,
                HWND_TOP,
                point.x,
                point.y,
                rect.right - rect.left,
                rect.bottom - rect.top,
                SWP_FRAMECHANGED | SWP_NOACTIVATE,
            )
        } == 0
    {
        let cause = native_error("定位桌面窗口");
        unsafe {
            SetParent(handle, null_mut());
            SetWindowLongPtrW(handle, GWL_STYLE, original_style);
            SetWindowPos(
                handle,
                HWND_TOP,
                rect.left,
                rect.top,
                rect.right - rect.left,
                rect.bottom - rect.top,
                SWP_FRAMECHANGED | SWP_NOACTIVATE,
            );
        }
        return Err(cause);
    }
    Ok(())
}

pub fn detach(window: &WebviewWindow) -> Result<(), AppError> {
    if !is_attached(window) {
        return Ok(());
    }
    let handle = hwnd(window)?;
    let rect = screen_rect(handle)?;
    let style = unsafe { GetWindowLongPtrW(handle, GWL_STYLE) };
    unsafe { SetLastError(0) };
    let old_parent = unsafe { SetParent(handle, null_mut()) };
    if old_parent.is_null() {
        return Err(native_error("脱离桌面父窗口"));
    }
    unsafe {
        SetLastError(0);
        SetWindowLongPtrW(
            handle,
            GWL_STYLE,
            (style & !(WS_CHILD as isize)) | WS_POPUP as isize,
        )
    };
    if unsafe { GetLastError() } != 0 {
        return Err(native_error("恢复普通窗口样式"));
    }
    if unsafe {
        SetWindowPos(
            handle,
            HWND_TOP,
            rect.left,
            rect.top,
            rect.right - rect.left,
            rect.bottom - rect.top,
            SWP_FRAMECHANGED | SWP_NOACTIVATE,
        )
    } == 0
    {
        return Err(native_error("恢复普通窗口位置"));
    }
    Ok(())
}
