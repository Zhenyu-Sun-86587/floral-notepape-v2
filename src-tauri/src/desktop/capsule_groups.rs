use super::*;
use crate::capsule_layout::{self, VisualGroup};
use crate::surface_sessions::{CapsuleSide, SurfaceSession};
use std::collections::HashSet;
use std::sync::{Condvar, LazyLock};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSurface {
    pub runtime_id: u64,
    pub revision: u64,
    pub side: CapsuleSide,
    pub members: Vec<CapsuleEntry>,
    pub slot_css: f64,
    pub grip_css: f64,
    pub cross_css: f64,
    pub viewport_css: f64,
    pub content_css: f64,
    #[serde(skip)]
    axis_start_css: f64,
    #[serde(skip)]
    monitor: usize,
    #[serde(skip)]
    label: String,
    #[serde(skip)]
    bounds: WindowBounds,
}
impl GroupSurface {
    fn keys(&self) -> Vec<String> {
        self.members.iter().map(|entry| entry.key.clone()).collect()
    }
    pub fn member_keys(&self) -> Vec<String> {
        self.keys()
    }
    pub fn monitor_index(&self) -> usize {
        self.monitor
    }
}
#[derive(Default)]
struct Registry {
    active: Vec<GroupSurface>,
    pending: Vec<GroupSurface>,
    ready: HashSet<String>,
    pool: Vec<String>,
    serial: u64,
    revision: u64,
}
static REGISTRY: LazyLock<(Mutex<Registry>, Condvar)> =
    LazyLock::new(|| (Mutex::new(Registry::default()), Condvar::new()));

pub fn snapshot(label: &str) -> Option<GroupSurface> {
    let registry = REGISTRY.0.lock().unwrap_or_else(|e| e.into_inner());
    registry
        .pending
        .iter()
        .find(|g| g.label == label)
        .or_else(|| registry.active.iter().find(|g| g.label == label))
        .cloned()
}
pub fn owner(label: &str, key: &str) -> Option<GroupSurface> {
    let registry = REGISTRY.0.lock().unwrap_or_else(|e| e.into_inner());
    registry
        .active
        .iter()
        .find(|g| g.label == label && g.members.iter().any(|m| m.key == key))
        .cloned()
}

pub fn owner_label(key: &str) -> Option<String> {
    // 鼠标位置检查只需要窗口标识，避免每次复制组内所有便签正文。
    REGISTRY
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .active
        .iter()
        .find(|group| group.members.iter().any(|entry| entry.key == key))
        .map(|group| group.label.clone())
}
pub fn ready(label: &str, revision: u64) {
    let mut registry = REGISTRY.0.lock().unwrap_or_else(|e| e.into_inner());
    if registry
        .pending
        .iter()
        .any(|g| g.label == label && g.revision == revision)
    {
        registry.ready.insert(label.to_owned());
        REGISTRY.1.notify_all();
    }
}
fn error(message: &str) -> AppError {
    AppError {
        code: "capsuleGroup".into(),
        message: message.into(),
        details: Default::default(),
    }
}

fn bounds(monitor: &tauri::Monitor, side: CapsuleSide, group: &VisualGroup) -> WindowBounds {
    let work = monitor.work_area();
    surface_bounds(
        WindowBounds {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        },
        WindowBounds {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width,
            height: work.size.height,
        },
        monitor.scale_factor(),
        side,
        group,
    )
}

pub(super) fn surface_bounds(
    screen: WindowBounds,
    work: WindowBounds,
    scale: f64,
    side: CapsuleSide,
    group: &VisualGroup,
) -> WindowBounds {
    let cross = (capsule_layout::CROSS * scale).round() as u32;
    let (axis, length) =
        capsule_layout::physical_interval(group.axis_start, group.axis_length, scale);
    // 满屏末端的向外补偿可能多出 1px，此时只移动窗口起点，不缩小内容 viewport。
    let physical_extent = if side == CapsuleSide::Top {
        work.width
    } else {
        work.height
    };
    let axis = axis
        .min(physical_extent.saturating_sub(length) as i32)
        .max(0);
    match side {
        CapsuleSide::Top => WindowBounds {
            x: work.x + axis,
            y: screen.y,
            width: length,
            height: cross,
        },
        CapsuleSide::Left => WindowBounds {
            x: screen.x,
            y: work.y + axis,
            width: cross,
            height: length,
        },
        CapsuleSide::Right => WindowBounds {
            x: screen.x + screen.width as i32 - cross as i32,
            y: work.y + axis,
            width: cross,
            height: length,
        },
    }
}

fn entries(sessions: &[SurfaceSession], keys: &[String]) -> Result<Vec<CapsuleEntry>, AppError> {
    let notes = default_store()?.list_notes()?;
    let bindings = crate::linked::list()?;
    Ok(keys
        .iter()
        .filter_map(|key| {
            let session = sessions.iter().find(|s| &s.key == key)?;
            let title = if let Some(id) = key.strip_prefix("note:") {
                notes.iter().find(|n| n.id == id).map(|n| {
                    if n.title.trim().is_empty() {
                        "无标题便签".into()
                    } else {
                        n.title.clone()
                    }
                })
            } else {
                key.strip_prefix("linked:")
                    .and_then(|id| bindings.iter().find(|b| b.id == id))
                    .map(|b| {
                        std::path::Path::new(&b.path)
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Markdown")
                            .to_owned()
                    })
            };
            Some(CapsuleEntry {
                key: key.clone(),
                title: title.unwrap_or_else(|| "便签暂不可用".into()),
                preview: String::new(),
                color_key: session.capsule_color_key.unwrap_or(0),
                expanded: session.presentation == crate::surface_sessions::Presentation::Expanded,
            })
        })
        .collect())
}

fn create_window(app: &AppHandle, label: &str) -> Result<tauri::WebviewWindow, AppError> {
    let window =
        WebviewWindowBuilder::new(app, label, WebviewUrl::App("capsule.html?group=1".into()))
            .title("收纳便签")
            .inner_size(18.0, 44.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .build()?;
    #[cfg(target_os = "windows")]
    crate::set_windows_corner_preference(&window, 0.0);
    Ok(window)
}

fn edge_plan(sessions: &[SurfaceSession], extent: f64) -> capsule_layout::CapsuleLayoutPlan {
    capsule_layout::solve(
        sessions
            .iter()
            .map(|s| (s.key.clone(), s.capsule_offset.unwrap_or(0.5)))
            .collect(),
        extent,
        capsule_layout::SLOT,
        capsule_layout::GRIP,
        capsule_layout::MERGE,
        capsule_layout::GAP,
    )
}

pub fn sync(app: &AppHandle) -> Result<(), AppError> {
    if app_is_exiting(app)
        || CAPSULE_DRAGGING.load(Ordering::SeqCst)
        || app
            .try_state::<RuntimeState>()
            .is_some_and(|state| state.windows_hidden.load(Ordering::SeqCst))
    {
        return Ok(());
    }
    crate::surface_sessions::ensure_capsule_colors()?;
    let monitors = app.available_monitors()?;
    let all_sessions = crate::surface_sessions::list()?;
    let all_entries = entries(
        &all_sessions,
        &all_sessions
            .iter()
            .map(|s| s.key.clone())
            .collect::<Vec<_>>(),
    )?;
    let previous = REGISTRY
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .active
        .clone();
    let mut next = Vec::new();
    for (index, monitor) in monitors.iter().enumerate() {
        for side in [CapsuleSide::Left, CapsuleSide::Right, CapsuleSide::Top] {
            let sessions: Vec<_> = all_sessions
                .iter()
                .filter(|session| {
                    (session.presentation == crate::surface_sessions::Presentation::Stored
                        || (session.presentation
                            == crate::surface_sessions::Presentation::Expanded
                            && session.capsule_color_key.is_some()))
                        && session.capsule_side == side
                        && capsule_monitor_index(
                            &monitors,
                            session.capsule_monitor.as_deref().or_else(|| {
                                session
                                    .expanded_bounds
                                    .as_ref()
                                    .and_then(|bounds| bounds.monitor_name.as_deref())
                            }),
                        ) == index
                })
                .cloned()
                .collect();
            if sessions.is_empty() {
                continue;
            }
            let scale = monitor.scale_factor();
            let physical_extent = if side == CapsuleSide::Top {
                monitor.work_area().size.width
            } else {
                monitor.work_area().size.height
            } as f64;
            if physical_extent == 0.0 {
                continue;
            }
            let plan = edge_plan(&sessions, physical_extent / scale);
            debug_assert!(plan
                .groups
                .iter()
                .all(|g| g.axis_start + g.axis_length <= plan.extent));
            let old: Vec<_> = previous
                .iter()
                .filter(|g| g.monitor == index && g.side == side)
                .collect();
            let matches = capsule_layout::reuse_indices(
                &old.iter().map(|g| g.keys()).collect::<Vec<_>>(),
                &plan.groups,
            );
            for (group, reuse) in plan.groups.iter().zip(matches) {
                let existing = reuse.map(|i| old[i]);
                let (id, label) = {
                    let mut registry = REGISTRY.0.lock().unwrap_or_else(|e| e.into_inner());
                    registry.serial += 1;
                    let id = existing.map_or(registry.serial, |g| g.runtime_id);
                    // 成员集合改变时在隐藏的备用 surface 准备；旧 surface 保持可见直到 ready。
                    // 一般位置/展开/颜色更新复用原窗口；merge/split 循环复用备用窗口池。
                    let label = existing
                        .filter(|g| {
                            g.members.len() == group.members.len()
                                && g.slot_css == group.slot_length
                                && g.cross_css == capsule_layout::CROSS
                                && g.bounds.width == bounds(monitor, side, group).width
                                && g.bounds.height == bounds(monitor, side, group).height
                                && group
                                    .members
                                    .iter()
                                    .all(|key| g.members.iter().any(|m| &m.key == key))
                        })
                        .map(|g| g.label.clone())
                        .or_else(|| registry.pool.pop())
                        .unwrap_or_else(|| format!("capsule-group-{}", registry.serial));
                    (id, label)
                };
                next.push(GroupSurface {
                    runtime_id: id,
                    revision: 0,
                    monitor: index,
                    side,
                    label,
                    bounds: bounds(monitor, side, group),
                    members: group
                        .members
                        .iter()
                        .filter_map(|key| {
                            all_entries.iter().find(|entry| &entry.key == key).cloned()
                        })
                        .collect(),
                    slot_css: group.slot_length,
                    grip_css: group.grip_length,
                    cross_css: capsule_layout::CROSS,
                    viewport_css: group.axis_length,
                    content_css: group.content_length,
                    axis_start_css: group.axis_start,
                });
            }
        }
    }
    present(app, next)
}

fn present(app: &AppHandle, mut next: Vec<GroupSurface>) -> Result<(), AppError> {
    let previous;
    {
        let mut registry = REGISTRY.0.lock().unwrap_or_else(|e| e.into_inner());
        previous = registry.active.clone();
        registry.revision += 1;
        for group in &mut next {
            group.revision = registry.revision;
        }
        registry.pending = next.clone();
        registry.ready.clear();
    }
    let prepare = (|| -> Result<(), AppError> {
        for group in &next {
            let window = match app.get_webview_window(&group.label) {
                Some(window) => window,
                None => create_window(app, &group.label)?,
            };
            // 隐藏 surface 可先定位；可见组的几何与退役窗口在最终 batch 中一起切换。
            if !previous.iter().any(|g| g.label == group.label) {
                window.set_position(PhysicalPosition::new(group.bounds.x, group.bounds.y))?;
                window.set_size(PhysicalSize::new(group.bounds.width, group.bounds.height))?;
            }
            app.emit_to(&group.label, "capsule-group-changed", group)?;
        }
        let registry = REGISTRY.0.lock().unwrap_or_else(|e| e.into_inner());
        let (registry, timed) = REGISTRY
            .1
            .wait_timeout_while(registry, std::time::Duration::from_secs(10), |r| {
                next.iter().any(|g| !r.ready.contains(&g.label))
            })
            .unwrap_or_else(|e| e.into_inner());
        let incomplete = next.iter().any(|g| !registry.ready.contains(&g.label));
        drop(registry);
        if timed.timed_out() && incomplete {
            return Err(error("组窗口尚未完成渲染，保留上一份可见布局"));
        }
        apply_native(app, &previous, &next)?;
        Ok(())
    })();
    let mut registry = REGISTRY.0.lock().unwrap_or_else(|e| e.into_inner());
    registry.pending.clear();
    registry.ready.clear();
    if let Err(error) = prepare {
        for group in &next {
            if !previous.iter().any(|g| g.label == group.label) {
                if let Some(window) = app.get_webview_window(&group.label) {
                    let _ = window.hide();
                }
                registry.pool.push(group.label.clone());
            }
        }
        registry.revision += 1;
        let revision = registry.revision;
        for group in &mut registry.active {
            group.revision = revision;
        }
        let restored = registry.active.clone();
        drop(registry);
        // ready 超时或 native 失败时恢复旧 DOM 和几何；旧窗口直到此时仍未退役。
        for group in &restored {
            let _ = app.emit_to(&group.label, "capsule-group-changed", group);
        }
        let _ = apply_native(app, &next, &restored);
        return Err(error);
    }
    for group in &previous {
        if !next.iter().any(|g| g.label == group.label) {
            registry.pool.push(group.label.clone());
        }
    }
    registry.active = next;
    // 备用窗口足够覆盖一次 merge/split；更早的闲置窗口释放，避免随历史无限增长。
    let keep = registry.active.len().max(2);
    let retired = if registry.pool.len() > keep {
        registry.pool.split_off(keep)
    } else {
        Vec::new()
    };
    drop(registry);
    for label in retired {
        if let Some(window) = app.get_webview_window(&label) {
            window.destroy()?;
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_native(
    app: &AppHandle,
    previous: &[GroupSurface],
    next: &[GroupSurface],
) -> Result<(), AppError> {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    let changes: Vec<_> = next
        .iter()
        .map(|g| (g, true))
        .chain(
            previous
                .iter()
                .filter(|g| !next.iter().any(|n| n.label == g.label))
                .map(|g| (g, false)),
        )
        .collect();
    if changes.is_empty() {
        return Ok(());
    }
    let handles = changes
        .iter()
        .map(|(group, show)| {
            let window = app
                .get_webview_window(&group.label)
                .ok_or_else(|| error("组窗口已关闭"))?;
            Ok((window.hwnd()?.0, group.bounds, *show))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let (sender, receiver) = std::sync::mpsc::channel();
    // HWND 只在 UI 线程调用；同一个 native batch 切换全部组，避免先 hide 后 show 的空洞。
    let handles: Vec<_> = handles
        .into_iter()
        .map(|(h, b, s)| (h as usize, b, s))
        .collect();
    app.run_on_main_thread(move || {
        let result = unsafe {
            let mut batch = BeginDeferWindowPos(handles.len() as i32);
            for (hwnd, bounds, show) in handles {
                if batch.is_null() {
                    break;
                }
                batch = DeferWindowPos(
                    batch,
                    hwnd as _,
                    std::ptr::null_mut(),
                    bounds.x,
                    bounds.y,
                    bounds.width as i32,
                    bounds.height as i32,
                    SWP_NOACTIVATE
                        | SWP_NOZORDER
                        | if show {
                            SWP_SHOWWINDOW
                        } else {
                            SWP_HIDEWINDOW | SWP_NOMOVE | SWP_NOSIZE
                        },
                );
            }
            !batch.is_null() && EndDeferWindowPos(batch) != 0
        };
        let _ = sender.send(result);
    })?;
    if receiver.recv().unwrap_or(false) {
        Ok(())
    } else {
        Err(error("原生组窗口事务未完成"))
    }
}
#[cfg(not(target_os = "windows"))]
fn apply_native(
    app: &AppHandle,
    previous: &[GroupSurface],
    next: &[GroupSurface],
) -> Result<(), AppError> {
    for group in next {
        if let Some(window) = app.get_webview_window(&group.label) {
            window.set_position(PhysicalPosition::new(group.bounds.x, group.bounds.y))?;
            window.set_size(PhysicalSize::new(group.bounds.width, group.bounds.height))?;
            show_silent_surface(&window)?;
        }
    }
    for group in previous
        .iter()
        .filter(|g| !next.iter().any(|n| n.label == g.label))
    {
        if let Some(window) = app.get_webview_window(&group.label) {
            window.hide()?;
        }
    }
    Ok(())
}

/// 单成员拖出以同一 snapshot 交接到浮动组；原组紧凑收拢，取消时从 sessions 重求解。
#[cfg(target_os = "windows")]
pub fn detach(app: &AppHandle, label: &str, key: &str) -> Result<tauri::WebviewWindow, AppError> {
    let mut next = REGISTRY
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .active
        .clone();
    let index = next
        .iter()
        .position(|g| g.label == label)
        .ok_or_else(|| error("找不到拖动组"))?;
    if next[index].members.len() == 1 {
        return app
            .get_webview_window(label)
            .ok_or_else(|| error("组窗口已关闭"));
    }
    let mut source = next.remove(index);
    let member_index = source
        .members
        .iter()
        .position(|m| m.key == key)
        .ok_or_else(|| error("找不到拖动成员"))?;
    let mut floating = source.clone();
    {
        let mut registry = REGISTRY.0.lock().unwrap_or_else(|e| e.into_inner());
        registry.serial += 1;
        floating.runtime_id = registry.serial;
    }
    floating.members = vec![source.members.remove(member_index)];
    let scale = app
        .get_webview_window(label)
        .ok_or_else(|| error("组窗口已关闭"))?
        .scale_factor()?;
    let member_start =
        source.axis_start_css + source.grip_css + member_index as f64 * source.slot_css;
    let (source_physical, _) = capsule_layout::physical_interval(source.axis_start_css, 0.0, scale);
    let (member_physical, member_length) =
        capsule_layout::physical_interval(member_start, source.slot_css, scale);
    let local = member_physical - source_physical;
    floating.axis_start_css = member_start;
    floating.grip_css = 0.0;
    floating.viewport_css = floating.slot_css;
    floating.content_css = floating.slot_css;
    if source.side == CapsuleSide::Top {
        floating.bounds.x += local;
        floating.bounds.width = member_length;
    } else {
        floating.bounds.y += local;
        floating.bounds.height = member_length;
    }
    source.grip_css = if source.members.len() > 1 {
        source.grip_css
    } else {
        0.0
    };
    source.content_css = source.grip_css + source.members.len() as f64 * source.slot_css;
    source.viewport_css = source.content_css.min(source.viewport_css);
    let (_, source_length) =
        capsule_layout::physical_interval(source.axis_start_css, source.viewport_css, scale);
    if source.side == CapsuleSide::Top {
        source.bounds.width = source_length;
    } else {
        source.bounds.height = source_length;
    }
    // 两个新成员集合先在隐藏窗口准备，原窗口在 native batch 中一次退役。
    for group in [&mut source, &mut floating] {
        let mut r = REGISTRY.0.lock().unwrap_or_else(|e| e.into_inner());
        r.serial += 1;
        group.label = r
            .pool
            .pop()
            .unwrap_or_else(|| format!("capsule-group-{}", r.serial));
    }
    let floating_label = floating.label.clone();
    next.push(source);
    next.push(floating);
    present(app, next)?;
    app.get_webview_window(&floating_label)
        .ok_or_else(|| error("浮动窗口已关闭"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn assert_physical_projection_contains_logical_group(
        group: &VisualGroup,
        scale: f64,
        side: CapsuleSide,
    ) {
        let screen = WindowBounds {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let work = WindowBounds {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let bounds = surface_bounds(screen, work, scale, side, group);
        let physical_axis = if side == CapsuleSide::Top {
            bounds.width
        } else {
            bounds.height
        };
        let physical_cross = if side == CapsuleSide::Top {
            bounds.height
        } else {
            bounds.width
        };
        assert!(physical_axis as f64 >= (group.axis_length * scale).ceil());
        assert_eq!(
            physical_cross,
            (capsule_layout::CROSS * scale).round() as u32
        );
        assert!(
            group.content_length > group.axis_length
                || physical_axis as f64 >= (group.content_length * scale).ceil()
        );
        if side == CapsuleSide::Top {
            assert!(
                bounds.x >= work.x && bounds.x + bounds.width as i32 <= work.x + work.width as i32
            );
        } else {
            assert!(
                bounds.y >= work.y
                    && bounds.y + bounds.height as i32 <= work.y + work.height as i32
            );
        }
    }

    #[test]
    fn capsule_fractional_dpi_viewports_contain_every_member() {
        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            for side in [CapsuleSide::Left, CapsuleSide::Right, CapsuleSide::Top] {
                let extent = if side == CapsuleSide::Top {
                    1920.0
                } else {
                    1040.0
                } / scale;
                for count in [1, 2, 3, 4, 8] {
                    let offset = 100.0 / (extent - capsule_layout::SLOT);
                    let group = capsule_layout::solve(
                        (0..count).map(|i| (i.to_string(), offset)).collect(),
                        extent,
                        capsule_layout::SLOT,
                        capsule_layout::GRIP,
                        capsule_layout::MERGE,
                        capsule_layout::GAP,
                    )
                    .groups
                    .remove(0);
                    assert_eq!(
                        group.content_length,
                        group.grip_length + count as f64 * capsule_layout::SLOT
                    );
                    assert_physical_projection_contains_logical_group(&group, scale, side);
                }
            }
        }
    }
    #[test]
    fn capsule_expanded_and_color_do_not_change_geometry() {
        let mut sessions: Vec<_> = (0..3)
            .map(|i| SurfaceSession {
                key: i.to_string(),
                capsule_offset: Some(0.1 + i as f64 * 0.01),
                capsule_color_key: Some(i),
                presentation: crate::surface_sessions::Presentation::Stored,
                ..Default::default()
            })
            .collect();
        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            let before = edge_plan(&sessions, 1000.0 / scale);
            sessions[1].presentation = crate::surface_sessions::Presentation::Expanded;
            sessions[1].capsule_color_key = Some(11);
            assert_eq!(before.groups, edge_plan(&sessions, 1000.0 / scale).groups);
            sessions[1].presentation = crate::surface_sessions::Presentation::Stored;
            sessions[1].capsule_color_key = Some(1);
        }
    }
}
