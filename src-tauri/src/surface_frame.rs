//! 便签保留系统阴影与缩放边缘，同时移除 Tao 为阴影预留的顶部非客户区。
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            GetWindowLongPtrW, IsZoomed, SetWindowPos, GWL_STYLE, NCCALCSIZE_PARAMS,
            SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WM_NCCALCSIZE,
            WM_NCDESTROY, WS_CHILD,
        },
    },
};

const FRAME_SUBCLASS: usize = 0x48534652;

unsafe extern "system" fn frame_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    _data: usize,
) -> LRESULT {
    if message == WM_NCDESTROY {
        unsafe { RemoveWindowSubclass(hwnd, Some(frame_proc), id) };
    }
    if message == WM_NCCALCSIZE
        && wparam != 0
        && lparam != 0
        && unsafe { IsZoomed(hwnd) } == 0
        && unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } & WS_CHILD as isize == 0
    {
        let params = lparam as *mut NCCALCSIZE_PARAMS;
        let top = unsafe { (*params).rgrc[0].top };
        // 先保留 Tao 对左右和底部缩放边框的计算，只让网页覆盖顶部的 1–2px 色线。
        let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
        if result == 0 {
            unsafe { (*params).rgrc[0].top = top };
        }
        return result;
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

pub fn install(window: &WebviewWindow) {
    if !window.label().starts_with("tile-") && !window.label().starts_with("notepad-") {
        return;
    }
    let target = window.clone();
    // Subclass 必须安装在 HWND 所属线程；消息处理中只做原生计算，不调用 Tauri IPC。
    if let Err(error) = window.run_on_main_thread(move || {
        let Ok(hwnd) = target.hwnd() else { return };
        let mut data = 0;
        unsafe {
            if GetWindowSubclass(hwnd.0, Some(frame_proc), FRAME_SUBCLASS, &mut data) != 0 {
                return;
            }
            if SetWindowSubclass(hwnd.0, Some(frame_proc), FRAME_SUBCLASS, 0) == 0 {
                eprintln!("failed to install surface frame handler");
                return;
            }
            SetWindowPos(
                hwnd.0,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
            );
        }
    }) {
        eprintln!("failed to schedule surface frame handler: {error}");
    }
}
