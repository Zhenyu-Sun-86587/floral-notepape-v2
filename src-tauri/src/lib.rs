pub mod capsule_layout;
pub mod desktop;
#[cfg(target_os = "windows")]
pub mod desktop_attachment;
pub mod json_io;
pub mod linked;
pub mod linked_watcher;
pub mod locales;
#[cfg(target_os = "windows")]
pub mod lock_overlay;
pub mod services;
#[cfg(target_os = "windows")]
mod surface_frame;
pub mod surface_sessions;
pub mod updater;

use locales::Locale;
use services::notes::{default_store, AppConfig, AppError, Note, NoteMetadata, SaveNoteRequest};
use std::{env, fs, io::Write, path::PathBuf};
use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
fn linked_bind(path: String) -> Result<linked::LinkedBinding, AppError> {
    let binding = linked::bind(&path)?;
    linked_watcher::watch_binding(&binding.path)?;
    Ok(binding)
}

#[tauri::command]
fn linked_list() -> Result<Vec<linked::LinkedBinding>, AppError> {
    linked::list()
}

#[tauri::command]
fn linked_roots() -> Result<Vec<linked::LinkedRoot>, AppError> {
    linked::list_roots()
}

#[tauri::command]
fn linked_bind_root(
    app: AppHandle,
    path: String,
    recursive: bool,
) -> Result<linked::LinkedRoot, AppError> {
    let root = linked::bind_root(&path, recursive)?;
    linked_watcher::watch_root(&root.path, root.recursive)?;
    let _ = linked::scan_roots()?;
    let _ = app.emit("bindings-changed", ());
    Ok(root)
}

#[tauri::command]
fn linked_unbind(app: AppHandle, id: String) -> Result<(), AppError> {
    linked::unbind(&id)?;
    desktop::remove_surface_session(&app, &format!("linked:{id}"));
    linked_watcher::sync_watches()?;
    let _ = app.emit("bindings-changed", ());
    Ok(())
}

#[tauri::command]
fn surface_session_get(key: String) -> Result<surface_sessions::SurfaceSession, AppError> {
    surface_sessions::get(&key)
}

#[tauri::command]
async fn surface_session_save(
    app: AppHandle,
    session: surface_sessions::SurfaceSession,
) -> Result<(), AppError> {
    desktop::run_capsule_task(move || desktop::save_surface_session(&app, session)).await
}

#[tauri::command]
fn surface_bounds_save(window: tauri::WebviewWindow) {
    desktop::save_session_bounds(&window);
}

#[tauri::command]
fn surface_session_close_current(window: tauri::WebviewWindow) {
    desktop::record_surface_close(&window);
}

#[tauri::command]
async fn surface_store_current(window: tauri::WebviewWindow) -> Result<(), AppError> {
    desktop::run_capsule_task(move || {
        let key = desktop::surface_key_for_window(&window)?;
        desktop::store_surface(window.app_handle(), &key)
    })
    .await
}

#[tauri::command]
fn surface_capsule_group(
    window: tauri::WebviewWindow,
) -> Option<desktop::capsule_groups::GroupSurface> {
    desktop::capsule_groups::snapshot(window.label())
}
#[tauri::command]
fn surface_capsule_group_ready(window: tauri::WebviewWindow, revision: u64) {
    desktop::capsule_groups::ready(window.label(), revision);
}
#[tauri::command]
async fn surface_capsule_entry(key: String) -> Result<Option<desktop::CapsuleEntry>, AppError> {
    desktop::capsule_entry(&key)
}

#[tauri::command]
async fn surface_capsule_preview(
    window: tauri::WebviewWindow,
    key: String,
    anchor_y: f64,
    anchor_x: f64,
    generation: u64,
) -> Result<(), AppError> {
    desktop::run_capsule_task(move || {
        desktop::show_capsule_preview(&window, &key, anchor_y, anchor_x, generation)
    })
    .await
}

#[tauri::command]
async fn surface_restore_stored(app: AppHandle, key: String) -> Result<(), AppError> {
    desktop::advance_capsule_preview();
    desktop::run_capsule_task(move || desktop::restore_stored_surface(&app, &key)).await
}

#[tauri::command]
async fn surface_restore_edit(app: AppHandle, key: String) -> Result<(), AppError> {
    desktop::advance_capsule_preview();
    desktop::run_capsule_task(move || desktop::restore_stored_surface_edit(&app, &key)).await
}

#[tauri::command]
fn surface_take_edit_request(window: tauri::WebviewWindow) -> bool {
    desktop::take_surface_edit_request(&window)
}

#[tauri::command]
async fn surface_capsule_hover(
    app: AppHandle,
    inside: bool,
    source: String,
    key: Option<String>,
    session: Option<u64>,
) -> Result<u64, AppError> {
    desktop::run_capsule_task(move || {
        Ok(desktop::capsule_hover(
            &app,
            inside,
            &source,
            key.as_deref(),
            session,
        ))
    })
    .await
}

#[tauri::command]
fn surface_capsule_menu(window: tauri::WebviewWindow, key: String) -> Result<(), AppError> {
    desktop::popup_capsule_menu(&window, &key)
}

#[tauri::command]
async fn surface_capsule_dismiss(app: AppHandle) -> Result<(), AppError> {
    // 预览窗的隐藏也交给工作线程，避免 WebView2 在同步 IPC 回调里处理窗口消息。
    desktop::advance_capsule_preview();
    desktop::run_capsule_task(move || desktop::dismiss_capsule_preview(&app)).await
}

#[tauri::command]
fn surface_capsule_preview_state() -> Option<desktop::CapsulePreview> {
    desktop::capsule_preview_state()
}

#[tauri::command]
async fn surface_capsule_present(
    window: tauri::WebviewWindow,
    generation: u64,
) -> Result<(), AppError> {
    // 显示与自动关闭串行执行，避免校验后被关闭的旧会话重新弹出。
    desktop::run_capsule_task(move || desktop::present_capsule_preview(&window, generation)).await
}

#[tauri::command]
async fn surface_capsule_drag(
    window: tauri::WebviewWindow,
    key: String,
    group: Option<bool>,
) -> Result<bool, AppError> {
    desktop::drag_capsule(window, key, group.unwrap_or(false)).await
}

#[tauri::command]
async fn surface_capsule_hide(app: AppHandle, key: String) -> Result<(), AppError> {
    desktop::advance_capsule_preview();
    desktop::run_capsule_task(move || desktop::hide_stored_surface(&app, &key)).await
}

#[tauri::command]
fn surface_edit_mode(window: tauri::WebviewWindow, editing: bool) -> Result<(), AppError> {
    desktop::set_surface_edit_mode(&window, editing)
}

#[tauri::command]
fn surface_unlock_button_bounds(
    window: tauri::WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
) {
    #[cfg(target_os = "windows")]
    lock_overlay::set_bounds(
        &window,
        x,
        y,
        width,
        height,
        viewport_width,
        viewport_height,
    );
    #[cfg(not(target_os = "windows"))]
    let _ = (window, x, y, width, height, viewport_width, viewport_height);
}

#[tauri::command]
fn show_silent_surface(window: tauri::WebviewWindow) -> Result<(), AppError> {
    desktop::show_silent_surface(&window)
}

#[tauri::command]
fn shortcut_startup_error(app: AppHandle) -> Option<String> {
    desktop::shortcut_startup_error(&app)
}

#[tauri::command]
fn linked_unbind_root(app: AppHandle, id: String) -> Result<(), AppError> {
    linked::unbind_root(&id)?;
    linked_watcher::sync_watches()?;
    let _ = app.emit("bindings-changed", ());
    Ok(())
}

#[tauri::command]
fn linked_create_in_root(
    app: AppHandle,
    root_id: String,
    name: String,
) -> Result<linked::LinkedBinding, AppError> {
    let binding = linked::create_in_root(&root_id, &name)?;
    linked_watcher::watch_binding(&binding.path)?;
    let _ = app.emit("bindings-changed", ());
    Ok(binding)
}

#[tauri::command]
fn linked_scan_roots(app: AppHandle) -> Result<Vec<linked::LinkedBinding>, AppError> {
    let added = linked::scan_roots()?;
    let _ = app.emit("bindings-changed", ());
    Ok(added)
}

#[tauri::command]
fn linked_read(app: AppHandle, id: String) -> Result<linked::LinkedContent, AppError> {
    let result = linked::read(&id)?;
    // 仅开放用户已绑定目录（或单文件父目录）的本地图片给 asset 协议。
    app.asset_protocol_scope()
        .allow_directory(&result.image_root, true)?;
    Ok(result)
}

#[tauri::command]
fn linked_read_draft(id: String) -> Result<Option<linked::LinkedDraft>, AppError> {
    linked::read_draft(&id)
}

#[tauri::command]
fn linked_write_draft(
    id: String,
    content: Option<String>,
    base_revision: String,
) -> Result<(), AppError> {
    linked::write_draft(&id, content, base_revision)
}

#[tauri::command]
fn linked_save(
    id: String,
    content: String,
    expected_revision: String,
    overwrite: bool,
) -> Result<String, AppError> {
    linked::save(&id, &content, &expected_revision, overwrite)
}

#[tauri::command]
async fn toggle_linked_tile_window(
    app: AppHandle,
    binding_id: String,
    bounds: Option<desktop::WindowBounds>,
) -> Result<bool, AppError> {
    desktop::toggle_linked_tile_window(app, binding_id, bounds).await
}

#[tauri::command]
fn app_name() -> Result<String, AppError> {
    let locale = Locale::from_tag(&default_store()?.load_config()?.locale);
    Ok(locales::app_name(locale).to_string())
}

#[tauri::command]
fn notes_list() -> Result<Vec<NoteMetadata>, AppError> {
    default_store()?.list_notes()
}

#[tauri::command]
fn notes_get(id: String) -> Result<Note, AppError> {
    default_store()?.read_note(&id)
}

#[tauri::command]
fn notes_create(app: AppHandle, request: SaveNoteRequest) -> Result<Note, AppError> {
    let note = default_store()?.create_note(request)?;
    let _ = app.emit("notes-changed", ());
    Ok(note)
}

#[tauri::command]
fn notes_update(app: AppHandle, id: String, request: SaveNoteRequest) -> Result<Note, AppError> {
    let note = default_store()?.update_note(&id, request)?;
    let _ = app.emit("notes-changed", ());
    Ok(note)
}

#[tauri::command]
fn notes_delete(app: AppHandle, id: String) -> Result<(), AppError> {
    default_store()?.delete_note(&id)?;
    desktop::remove_surface_session(&app, &format!("note:{id}"));
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
fn notes_import_markdown(
    app: AppHandle,
    path: String,
    category: Option<String>,
) -> Result<Note, AppError> {
    let note = default_store()?
        .import_markdown_file(&PathBuf::from(path), &category.unwrap_or_default())?;
    let _ = app.emit("notes-changed", ());
    Ok(note)
}

#[tauri::command]
fn notes_export_markdown(id: String, path: String) -> Result<(), AppError> {
    default_store()?.export_markdown_file(&id, &PathBuf::from(path))
}

#[tauri::command]
fn read_external_file(app: AppHandle, path: String) -> Result<String, AppError> {
    let content = std::fs::read_to_string(&path)?;
    let canonical = std::fs::canonicalize(&path)?;
    if let Some(parent) = canonical.parent() {
        app.asset_protocol_scope().allow_directory(parent, true)?;
    }
    Ok(content)
}

#[tauri::command]
fn get_file_modified_time(path: String) -> Result<f64, AppError> {
    let metadata = std::fs::metadata(&path).map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })?;
    let modified = metadata.modified().map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })?;
    let duration = modified
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    Ok(duration.as_secs_f64() * 1000.0)
}

#[tauri::command]
fn save_external_file(path: String, content: String) -> Result<(), AppError> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError {
            code: "io".into(),
            message: e.to_string(),
            details: Default::default(),
        })?;
    }
    std::fs::write(&path, content).map_err(|e| AppError {
        code: "io".into(),
        message: e.to_string(),
        details: Default::default(),
    })
}

#[tauri::command]
fn categories_list() -> Result<Vec<String>, AppError> {
    default_store()?.list_categories()
}

#[tauri::command]
fn categories_create(app: AppHandle, name: String) -> Result<(), AppError> {
    default_store()?.create_category(&name)?;
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
fn categories_rename(app: AppHandle, old_name: String, new_name: String) -> Result<(), AppError> {
    default_store()?.rename_category(&old_name, &new_name)?;
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
fn categories_delete(app: AppHandle, name: String) -> Result<(), AppError> {
    default_store()?.delete_category(&name)?;
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
fn notes_move_category(
    app: AppHandle,
    id: String,
    category: String,
) -> Result<NoteMetadata, AppError> {
    let result = default_store()?.move_note_to_category(&id, &category)?;
    let _ = app.emit("notes-changed", ());
    Ok(result)
}

#[tauri::command]
fn images_save(request: tauri::ipc::Request<'_>) -> Result<String, AppError> {
    // 前端以 raw payload 直传图片字节流（noteId / 扩展名走 headers），
    // 避免二进制经 JSON 数字数组序列化的巨大内存与耗时开销
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err(AppError {
            code: "invalidPayload".into(),
            message: "images_save expects a raw binary payload".into(),
            details: Default::default(),
        });
    };
    let header = |name: &str| -> Result<String, AppError> {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| AppError {
                code: "invalidPayload".into(),
                message: format!("missing {name} header"),
                details: Default::default(),
            })
    };
    let note_id = header("x-note-id")?;
    let extension = header("x-image-ext")?;
    default_store()?.save_image(&note_id, data, &extension)
}

#[tauri::command]
fn images_save_from_path(note_id: String, file_path: String) -> Result<String, AppError> {
    let path = PathBuf::from(&file_path);
    let data = std::fs::read(&path)?;
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("png")
        .to_string();
    default_store()?.save_image(&note_id, &data, &extension)
}

#[tauri::command]
fn images_get_base_dir() -> Result<String, AppError> {
    let store = default_store()?;
    store
        .data_dir()
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| AppError {
            code: "path".into(),
            message: "invalid data dir path".into(),
            details: Default::default(),
        })
}

#[tauri::command]
fn images_clean_unused(note_id: String, content: String) -> Result<Vec<String>, AppError> {
    default_store()?.clean_unused_images(&note_id, &content)
}

#[tauri::command]
fn config_get() -> Result<AppConfig, AppError> {
    default_store()?.load_config()
}

#[tauri::command]
fn copy_background_image(_app: AppHandle, source_path: String) -> Result<String, AppError> {
    let source = PathBuf::from(source_path.trim());
    if !source.is_file() {
        return Err(AppError {
            code: "invalidSource".into(),
            message: "background image source not found".into(),
            details: Default::default(),
        });
    }

    let store = default_store()?;
    let dir = store.data_dir().join("backgrounds");
    fs::create_dir_all(&dir)?;

    let old_config = store.load_config()?;
    if !old_config.background_image_path.is_empty() {
        let old_path = PathBuf::from(&old_config.background_image_path);
        if old_path.starts_with(&dir) && old_path.is_file() {
            let _ = fs::remove_file(&old_path);
        }
    }

    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("png");
    let dest = dir.join(format!("bg-{}.{}", uuid::Uuid::new_v4(), ext));
    fs::copy(&source, &dest)?;

    dest.to_str().map(str::to_string).ok_or_else(|| AppError {
        code: "path".into(),
        message: "invalid destination path".into(),
        details: Default::default(),
    })
}

#[tauri::command]
fn config_save(app: AppHandle, config: AppConfig) -> Result<AppConfig, AppError> {
    let store = default_store()?;
    let previous = store.load_config()?;
    desktop::apply_runtime_config(&app, &previous, &config).map_err(|error| {
        match error.downcast::<AppError>() {
            Ok(app_error) => *app_error,
            Err(error) => AppError {
                code: "desktopConfig".into(),
                message: error.to_string(),
                details: Default::default(),
            },
        }
    })?;
    let saved = store.save_config(config)?;
    if let Err(error) = desktop::refresh_shell_state(&app, &saved) {
        eprintln!("failed to refresh desktop shell state: {error}");
    }
    let _ = app.emit("config-changed", &saved);
    Ok(saved)
}

#[tauri::command]
fn set_native_material(
    window: tauri::WebviewWindow,
    enabled: bool,
    radius: f64,
) -> Result<bool, AppError> {
    #[cfg(target_os = "windows")]
    {
        use tauri::window::{Effect, EffectsBuilder};
        let is_surface =
            window.label().starts_with("notepad-") || window.label().starts_with("tile-");
        if crate::desktop_attachment::is_attached(&window) {
            // Explorer 子窗口的 Acrylic/阴影会产生黑边；向前端明确报告此组合不可用。
            let none: Option<tauri::utils::config::WindowEffectsConfig> = None;
            window.set_effects(none)?;
            window.set_shadow(false)?;
            return Ok(false);
        }
        if enabled {
            if is_surface {
                // Windows 11 的 DWM 圆角需要无边框窗口保留系统阴影；窗口 Region 会破坏材质合成。
                window.set_shadow(true)?;
            }
            window.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).build())?;
            if is_surface {
                set_windows_corner_preference(&window, radius);
            }
        } else {
            let none: Option<tauri::utils::config::WindowEffectsConfig> = None;
            window.set_effects(none)?;
            if is_surface {
                // 普通/置顶便签即便关闭材质，也保留系统阴影以区分白色背景。
                window.set_shadow(true)?;
                set_windows_corner_preference(&window, radius);
            }
        }
        Ok(enabled)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, enabled, radius);
        Ok(false)
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn set_windows_corner_preference(window: &tauri::WebviewWindow, radius: f64) {
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND, DWMWCP_ROUND,
        DWMWCP_ROUNDSMALL,
    };

    let Ok(hwnd) = window.hwnd() else { return };
    let preference = if radius <= 0.0 {
        DWMWCP_DONOTROUND
    } else if radius < 7.0 {
        DWMWCP_ROUNDSMALL
    } else {
        DWMWCP_ROUND
    };
    unsafe {
        DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            (&preference as *const i32).cast(),
            std::mem::size_of_val(&preference) as u32,
        );
    }
    clear_windows_border(window);
}

#[cfg(target_os = "windows")]
pub(crate) fn clear_windows_border(window: &tauri::WebviewWindow) {
    surface_frame::install(window);
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE,
    };
    let Ok(hwnd) = window.hwnd() else { return };
    // 禁用 DWM 激活色边框；窗口焦点、层级或 Explorer 父窗口变化后需重设。
    unsafe {
        DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_BORDER_COLOR as u32,
            (&DWMWA_COLOR_NONE as *const u32).cast(),
            std::mem::size_of::<u32>() as u32,
        );
    }
}

#[tauri::command]
fn theme_read(path: String) -> Result<String, AppError> {
    let file = PathBuf::from(path);
    if !file
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
    {
        return Err(AppError {
            code: "themeFile".into(),
            message: "请选择 JSON 主题文件".into(),
            details: Default::default(),
        });
    }
    if std::fs::metadata(&file)?.len() > 64 * 1024 {
        return Err(AppError {
            code: "themeFile".into(),
            message: "主题文件超过 64 KB".into(),
            details: Default::default(),
        });
    }
    Ok(std::fs::read_to_string(file)?)
}

#[tauri::command]
fn theme_write(path: String, content: String) -> Result<(), AppError> {
    let file = PathBuf::from(path);
    if !file
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        || content.len() > 64 * 1024
    {
        return Err(AppError {
            code: "themeFile".into(),
            message: "只能保存 64 KB 以内的 JSON 主题文件".into(),
            details: Default::default(),
        });
    }
    // 导出内容由前端按固定 schema 生成；写入前再次验证 JSON 格式。
    let _: serde_json::Value = serde_json::from_str(&content)?;
    std::fs::write(file, content)?;
    Ok(())
}

#[tauri::command]
fn config_migrate_data_dir(app: AppHandle, new_data_dir: String) -> Result<AppConfig, AppError> {
    let store = default_store()?;
    let new_path = PathBuf::from(&new_data_dir).join("floral");
    let new_store = store.migrate_data_to(&new_path)?;

    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(new_path.join("images"), true);
    let _ = scope.allow_directory(new_path.join("backgrounds"), true);

    let config = new_store.load_config()?;
    let _ = app.emit("config-changed", &config);
    Ok(config)
}

#[tauri::command]
fn global_shortcut_check(
    app: AppHandle,
    shortcut: String,
) -> Result<desktop::ShortcutCheckResult, AppError> {
    desktop::check_global_shortcut(&app, &shortcut)
}

#[tauri::command]
fn start_shortcut_recording(app: AppHandle) -> Result<(), AppError> {
    desktop::start_shortcut_recording(&app).map_err(|error| AppError {
        code: "shortcutRecording".into(),
        message: error.to_string(),
        details: Default::default(),
    })
}

#[tauri::command]
fn stop_shortcut_recording(app: AppHandle) -> Result<(), AppError> {
    desktop::stop_shortcut_recording(&app).map_err(|error| AppError {
        code: "shortcutRecording".into(),
        message: error.to_string(),
        details: Default::default(),
    })
}

#[tauri::command]
async fn open_notepad_window(
    app: AppHandle,
    note_id: Option<String>,
    bounds: Option<desktop::WindowBounds>,
) -> Result<String, AppError> {
    desktop::open_notepad_window(app, note_id, bounds).await
}

#[tauri::command]
async fn recycle_notepad_window(app: AppHandle, label: String) -> Result<(), AppError> {
    desktop::recycle_notepad_window(&app, &label)
}

/// Pre-shift the window by `(dx, dy)` logical px before starting an OS drag,
/// so a JS-side deadzone (e.g. tile double-click-to-edit) does not leave the
/// window lagging the cursor by the deadzone displacement.
#[tauri::command]
fn start_window_drag_with_offset(
    window: tauri::WebviewWindow,
    dx: f64,
    dy: f64,
) -> Result<(), AppError> {
    let scale = window.scale_factor()?;
    let pos = window.outer_position()?;
    let next_x = pos.x + (dx * scale).round() as i32;
    let next_y = pos.y + (dy * scale).round() as i32;
    window.set_position(tauri::PhysicalPosition::new(next_x, next_y))?;
    window.start_dragging()?;
    Ok(())
}

#[tauri::command]
async fn open_tile_window(
    app: AppHandle,
    note_id: String,
    bounds: Option<desktop::WindowBounds>,
) -> Result<String, AppError> {
    desktop::open_tile_window(app, note_id, bounds).await
}

#[tauri::command]
async fn toggle_tile_window(
    app: AppHandle,
    note_id: String,
    bounds: Option<desktop::WindowBounds>,
) -> Result<bool, AppError> {
    desktop::toggle_tile_window(app, note_id, bounds).await
}

#[tauri::command]
async fn open_note_in_editor(app: AppHandle, note_id: String) -> Result<(), AppError> {
    desktop::show_main_window(&app)?;
    let _ = app.emit("open-note", &note_id);
    Ok(())
}

#[tauri::command]
fn take_startup_file() -> Option<String> {
    desktop::take_startup_file()
}

fn cli_version_or_help_requested() -> bool {
    env::args().any(|arg| matches!(arg.as_str(), "--version" | "-V" | "--help" | "-h"))
}

#[cfg(windows)]
fn ensure_console() {
    use windows_sys::Win32::System::Console::{AllocConsole, AttachConsole, ATTACH_PARENT_PROCESS};

    unsafe {
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            let _ = AllocConsole();
        }
    }
}

#[cfg(not(windows))]
fn ensure_console() {}

fn flush_attached_console_stdout() {
    let _ = std::io::stdout().flush();
}

fn print_cli_version() {
    let _ = writeln!(
        std::io::stdout(),
        "floral-notepaper {}",
        env!("CARGO_PKG_VERSION")
    );
    flush_attached_console_stdout();
}

fn print_cli_help() {
    let _ = writeln!(
        std::io::stdout(),
        "floral-notepaper {}\nFloral Notepaper - lightweight local note app\n\nUSAGE:\n    floral-notepaper [OPTIONS]\n\nOPTIONS:\n    -V, --version\n            Print version\n    -h, --help\n            Print help",
        env!("CARGO_PKG_VERSION"),
    );
    flush_attached_console_stdout();
}

pub fn try_exit_for_cli_version_or_help() {
    if !cli_version_or_help_requested() {
        return;
    }

    ensure_console();

    let wants_version = env::args().any(|arg| arg == "--version" || arg == "-V");
    let wants_help = env::args().any(|arg| arg == "--help" || arg == "-h");

    if wants_version {
        print_cli_version();
        std::process::exit(0);
    }

    if wants_help {
        print_cli_help();
        std::process::exit(0);
    }

    std::process::exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(file_path) = desktop::extract_file_arg(&args) {
                if app.get_webview_window("main").is_some() {
                    let _ = app.emit("open-external-file", file_path);
                } else {
                    // 静默启动没有主 WebView；先缓存文件，待新窗口初始化后读取。
                    desktop::set_startup_file(file_path);
                }
            }
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = desktop::show_main_window(&app);
            });
        }))
        .setup(|app| {
            if let Ok(store) = default_store() {
                let data = store.data_dir();
                let scope = app.asset_protocol_scope();
                let _ = scope.allow_directory(data.join("images"), true);
                let _ = scope.allow_directory(data.join("backgrounds"), true);
            }
            let updater_state = updater::UpdaterState::new(app.package_info().version.to_string());
            if let Err(error) = updater_state.initialize() {
                eprintln!("failed to initialize updater infrastructure: {error}");
            }
            app.manage(updater_state);
            // Fork 的构建由仓库产物分发，启动时不访问原版更新服务。
            desktop::setup_desktop(app)?;
            if let Err(error) = linked_watcher::start(app.handle().clone()) {
                eprintln!("linked watcher startup failed: {error}");
            }
            Ok(())
        })
        .on_window_event(desktop::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            app_name,
            notes_list,
            notes_get,
            notes_create,
            notes_update,
            notes_delete,
            notes_import_markdown,
            notes_export_markdown,
            notes_move_category,
            linked_bind,
            surface_session_get,
            surface_session_save,
            surface_edit_mode,
            surface_unlock_button_bounds,
            surface_bounds_save,
            surface_session_close_current,
            surface_store_current,
            surface_capsule_group,
            surface_capsule_group_ready,
            surface_capsule_entry,
            surface_capsule_preview,
            surface_capsule_hover,
            surface_capsule_menu,
            surface_capsule_dismiss,
            surface_capsule_preview_state,
            surface_capsule_present,
            surface_capsule_hide,
            surface_capsule_drag,
            surface_restore_stored,
            surface_restore_edit,
            surface_take_edit_request,
            show_silent_surface,
            shortcut_startup_error,
            linked_list,
            linked_roots,
            linked_bind_root,
            linked_unbind,
            linked_unbind_root,
            linked_create_in_root,
            linked_scan_roots,
            linked_read,
            linked_read_draft,
            linked_write_draft,
            linked_save,
            toggle_linked_tile_window,
            read_external_file,
            save_external_file,
            get_file_modified_time,
            categories_list,
            categories_create,
            categories_rename,
            categories_delete,
            images_save,
            images_save_from_path,
            images_get_base_dir,
            images_clean_unused,
            config_get,
            copy_background_image,
            config_save,
            set_native_material,
            theme_read,
            theme_write,
            config_migrate_data_dir,
            global_shortcut_check,
            start_shortcut_recording,
            stop_shortcut_recording,
            open_notepad_window,
            recycle_notepad_window,
            start_window_drag_with_offset,
            open_tile_window,
            toggle_tile_window,
            open_note_in_editor,
            updater::commands::update_status,
            take_startup_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, _event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &_event {
                #[cfg(target_os = "windows")]
                if desktop::should_prevent_windowless_exit(
                    *code,
                    desktop::app_is_exiting(_app_handle),
                ) {
                    api.prevent_exit();
                } else {
                    desktop::mark_app_exiting(_app_handle);
                }
                #[cfg(not(target_os = "windows"))]
                desktop::mark_app_exiting(_app_handle);
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = _event
            {
                if !has_visible_windows {
                    if let Err(error) = desktop::show_main_window(_app_handle) {
                        eprintln!("failed to show main window on dock click: {error}");
                    }
                }
            }
        });
}
