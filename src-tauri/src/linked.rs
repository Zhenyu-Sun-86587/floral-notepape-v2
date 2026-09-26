use crate::services::notes::{default_store, AppError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use uuid::Uuid;

#[cfg(target_os = "windows")]
fn replace_file(temp: &Path, target: &Path) -> Result<(), AppError> {
    use std::{os::windows::ffi::OsStrExt, ptr::null};
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let temp_wide: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    // Windows 的 rename 不覆盖已有目标；ReplaceFileW 保持原路径身份并原子替换正文。
    let ok = unsafe {
        ReplaceFileW(
            target_wide.as_ptr(),
            temp_wide.as_ptr(),
            null(),
            0,
            null(),
            null(),
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn replace_file(temp: &Path, target: &Path) -> Result<(), AppError> {
    fs::rename(temp, target)?;
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedBinding {
    pub id: String,
    pub path: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkedIndex {
    bindings: Vec<LinkedBinding>,
    #[serde(default)]
    roots: Vec<LinkedRoot>,
    #[serde(default)]
    excluded_paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedRoot {
    pub id: String,
    pub path: String,
    pub recursive: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedContent {
    pub binding: LinkedBinding,
    pub content: String,
    pub revision: String,
    pub image_root: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedDraft {
    pub content: Option<String>,
    pub base_revision: String,
}

fn draft_path(id: &str) -> Result<PathBuf, AppError> {
    let parsed = Uuid::parse_str(id).map_err(|_| error("bindingNotFound", "绑定 ID 无效"))?;
    Ok(default_store()?
        .config_dir()
        .join("linked-drafts")
        .join(format!("{parsed}.json")))
}

pub fn read_draft(id: &str) -> Result<Option<LinkedDraft>, AppError> {
    let path = draft_path(id)?;
    if !path.exists() {
        return Ok(None);
    }
    let draft: LinkedDraft = serde_json::from_slice(&fs::read(path)?)?;
    Ok(if draft.content.is_some() {
        Some(draft)
    } else {
        None
    })
}

pub fn write_draft(
    id: &str,
    content: Option<String>,
    base_revision: String,
) -> Result<(), AppError> {
    let _guard = operation_lock()
        .lock()
        .map_err(|_| error("io", "外部文件绑定锁不可用"))?;
    lookup(&load_index(&index_path()?)?, id)?;
    write_linked_json(
        &draft_path(id)?,
        &LinkedDraft {
            content,
            base_revision,
        },
    )
}

pub(crate) fn write_linked_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_file_name(format!(".hermes-index-{}.tmp", Uuid::new_v4()));
    let result = (|| -> Result<(), AppError> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        serde_json::to_writer_pretty(&mut file, value)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        drop(file);
        if path.exists() {
            replace_file(&temp, path)?;
        } else {
            fs::rename(&temp, path)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

static INDEX_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn operation_lock() -> &'static Mutex<()> {
    INDEX_LOCK.get_or_init(|| Mutex::new(()))
}

fn error(code: &str, message: impl Into<String>) -> AppError {
    AppError {
        code: code.into(),
        message: message.into(),
        details: Default::default(),
    }
}

fn index_path() -> Result<PathBuf, AppError> {
    Ok(default_store()?.config_dir().join("linked-files.json"))
}

fn load_index(path: &Path) -> Result<LinkedIndex, AppError> {
    if !path.exists() {
        return Ok(LinkedIndex::default());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn lookup(index: &LinkedIndex, id: &str) -> Result<LinkedBinding, AppError> {
    index
        .bindings
        .iter()
        .find(|item| item.id == id)
        .cloned()
        .ok_or_else(|| error("bindingNotFound", "找不到外部文件绑定"))
}

pub fn bind(path: &str) -> Result<LinkedBinding, AppError> {
    let canonical = fs::canonicalize(path)?;
    if !canonical.is_file()
        || !matches!(
            canonical
                .extension()
                .and_then(|x| x.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("md" | "markdown")
        )
    {
        return Err(error("unsupportedFile", "只支持绑定 Markdown 文件"));
    }
    let _guard = operation_lock()
        .lock()
        .map_err(|_| error("io", "外部文件绑定锁不可用"))?;
    let path = index_path()?;
    let mut index = load_index(&path)?;
    let canonical = canonical.to_string_lossy().to_string();
    if let Some(found) = index
        .bindings
        .iter()
        .find(|item| item.path.eq_ignore_ascii_case(&canonical))
    {
        return Ok(found.clone());
    }
    let binding = LinkedBinding {
        id: Uuid::new_v4().to_string(),
        path: canonical,
    };
    index.bindings.push(binding.clone());
    write_linked_json(&path, &index)?;
    Ok(binding)
}

pub fn list() -> Result<Vec<LinkedBinding>, AppError> {
    let _guard = operation_lock()
        .lock()
        .map_err(|_| error("io", "外部文件绑定锁不可用"))?;
    Ok(load_index(&index_path()?)?.bindings)
}

pub fn list_roots() -> Result<Vec<LinkedRoot>, AppError> {
    let _guard = operation_lock()
        .lock()
        .map_err(|_| error("io", "外部文件绑定锁不可用"))?;
    Ok(load_index(&index_path()?)?.roots)
}

pub fn bind_root(path: &str, recursive: bool) -> Result<LinkedRoot, AppError> {
    let canonical = fs::canonicalize(path)?;
    if !canonical.is_dir() {
        return Err(error("invalidDirectory", "请选择目录"));
    }
    let canonical = canonical.to_string_lossy().to_string();
    let _guard = operation_lock()
        .lock()
        .map_err(|_| error("io", "外部文件绑定锁不可用"))?;
    let path = index_path()?;
    let mut index = load_index(&path)?;
    if let Some(found) = index
        .roots
        .iter_mut()
        .find(|item| item.path.eq_ignore_ascii_case(&canonical))
    {
        if found.recursive != recursive {
            found.recursive = recursive;
            let updated = found.clone();
            write_linked_json(&path, &index)?;
            return Ok(updated);
        }
        return Ok(found.clone());
    }
    let root = LinkedRoot {
        id: Uuid::new_v4().to_string(),
        path: canonical,
        recursive,
    };
    index.roots.push(root.clone());
    write_linked_json(&path, &index)?;
    Ok(root)
}

pub fn unbind(id: &str) -> Result<(), AppError> {
    let _guard = operation_lock()
        .lock()
        .map_err(|_| error("io", "外部文件绑定锁不可用"))?;
    let path = index_path()?;
    let mut index = load_index(&path)?;
    let binding = lookup(&index, id)?;
    if index
        .roots
        .iter()
        .any(|root| Path::new(&binding.path).starts_with(&root.path))
    {
        index.excluded_paths.push(binding.path.clone());
    }
    index.bindings.retain(|item| item.id != id);
    write_linked_json(&path, &index)
}

pub fn unbind_root(id: &str) -> Result<(), AppError> {
    let _guard = operation_lock()
        .lock()
        .map_err(|_| error("io", "外部文件绑定锁不可用"))?;
    let path = index_path()?;
    let mut index = load_index(&path)?;
    index.roots.retain(|root| root.id != id);
    write_linked_json(&path, &index)
}

fn scan_directory(
    root: &LinkedRoot,
    directory: &Path,
    found: &mut Vec<PathBuf>,
) -> Result<(), AppError> {
    let entries = fs::read_dir(directory)?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() && root.recursive {
            scan_directory(root, &path, found)?;
        } else if file_type.is_file() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name.starts_with(".syncthing.")
                || name.starts_with("~syncthing~")
                || name.starts_with(".hermes-")
            {
                continue;
            }
            if matches!(
                path.extension()
                    .and_then(|x| x.to_str())
                    .map(str::to_ascii_lowercase)
                    .as_deref(),
                Some("md" | "markdown")
            ) {
                if let Ok(canonical) = fs::canonicalize(path) {
                    found.push(canonical);
                }
            }
        }
    }
    Ok(())
}

pub fn scan_roots() -> Result<Vec<LinkedBinding>, AppError> {
    let _guard = operation_lock()
        .lock()
        .map_err(|_| error("io", "外部文件绑定锁不可用"))?;
    let path = index_path()?;
    let mut index = load_index(&path)?;
    let mut added = Vec::new();
    for root in &index.roots {
        let root_path = Path::new(&root.path);
        if !root_path.is_dir() {
            continue;
        }
        let mut found = Vec::new();
        scan_directory(root, root_path, &mut found)?;
        for file in found {
            let file = file.to_string_lossy().to_string();
            if index
                .excluded_paths
                .iter()
                .any(|item| item.eq_ignore_ascii_case(&file))
                || index
                    .bindings
                    .iter()
                    .any(|item| item.path.eq_ignore_ascii_case(&file))
            {
                continue;
            }
            let binding = LinkedBinding {
                id: Uuid::new_v4().to_string(),
                path: file,
            };
            index.bindings.push(binding.clone());
            added.push(binding);
        }
    }
    if !added.is_empty() {
        write_linked_json(&path, &index)?;
    }
    Ok(added)
}

pub fn create_in_root(root_id: &str, name: &str) -> Result<LinkedBinding, AppError> {
    let name = name.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') || name == "." || name == ".." {
        return Err(error("invalidName", "文件名不能为空或包含路径分隔符"));
    }
    let root = list_roots()?
        .into_iter()
        .find(|item| item.id == root_id)
        .ok_or_else(|| error("invalidDirectory", "找不到绑定目录"))?;
    let file_name = if name.to_ascii_lowercase().ends_with(".md") {
        name.to_string()
    } else {
        format!("{name}.md")
    };
    let path = Path::new(&root.path).join(file_name);
    // create_new 防止覆盖目录中已有的真实笔记。
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    bind(path.to_string_lossy().as_ref())
}

fn retry_file_read<T>(
    mut read: impl FnMut() -> std::io::Result<T>,
    mut wait: impl FnMut(std::time::Duration),
) -> std::io::Result<T> {
    // 同步工具原子替换时可能短暂缺失或共享冲突；只重试读取，不重试写入。
    for attempt in 0..=3 {
        match read() {
            Err(cause)
                if attempt < 3
                    && (cause.kind() == std::io::ErrorKind::NotFound
                        || matches!(cause.raw_os_error(), Some(32 | 33))
                            && cfg!(target_os = "windows")) =>
            {
                wait(std::time::Duration::from_millis(100 * (1 << attempt)));
            }
            result => return result,
        }
    }
    unreachable!()
}

fn read_external_bytes(path: &Path) -> Result<Vec<u8>, AppError> {
    retry_file_read(|| fs::read(path), std::thread::sleep).map_err(|cause| {
        let mut result = error(
            "externalFileUnavailable",
            format!(
            "无法读取外部文件 {}：{}。文件可能正在同步、已移动或已删除，请稍后重试并确认原路径。",
            path.display(), cause
        ),
        );
        result
            .details
            .insert("path".into(), path.display().to_string());
        result.details.insert("cause".into(), cause.to_string());
        result
    })
}

pub fn read(id: &str) -> Result<LinkedContent, AppError> {
    let (binding, image_root) = {
        let _guard = operation_lock()
            .lock()
            .map_err(|_| error("io", "外部文件绑定锁不可用"))?;
        let index = load_index(&index_path()?)?;
        let binding = lookup(&index, id)?;
        let path = Path::new(&binding.path);
        let root = index
            .roots
            .iter()
            .filter(|root| path.starts_with(&root.path))
            .max_by_key(|root| root.path.len())
            .map(|root| Path::new(&root.path))
            .or_else(|| path.parent())
            .ok_or_else(|| error("io", "外部文件路径无父目录"))?;
        let image_root = root.to_string_lossy().into_owned();
        (binding, image_root)
    };
    let bytes = read_external_bytes(Path::new(&binding.path))?;
    let revision = revision(&bytes);
    let content = String::from_utf8(bytes)
        .map_err(|_| error("invalidEncoding", "外部文件必须使用 UTF-8 编码"))?;
    Ok(LinkedContent {
        binding,
        content,
        revision,
        image_root,
    })
}

pub fn save(
    id: &str,
    content: &str,
    expected_revision: &str,
    overwrite: bool,
) -> Result<String, AppError> {
    // 同一进程的所有外部保存串行；读取当前哈希后才写，避免自动保存覆盖已经变化的原文件。
    let _guard = operation_lock()
        .lock()
        .map_err(|_| error("io", "外部文件绑定锁不可用"))?;
    let binding = lookup(&load_index(&index_path()?)?, id)?;
    save_file(
        Path::new(&binding.path),
        content,
        expected_revision,
        overwrite,
    )
}

fn save_file(
    path: &Path,
    content: &str,
    expected_revision: &str,
    overwrite: bool,
) -> Result<String, AppError> {
    let current = read_external_bytes(path)?;
    if !overwrite && revision(&current) != expected_revision {
        return Err(error(
            "externalConflict",
            "原文件已在应用外修改，请选择重新载入或明确覆盖",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| error("io", "外部文件路径无父目录"))?;
    // textarea 会把 CRLF 归一成 LF；写回时沿用原文件的 BOM 与换行风格。
    let has_bom = current.starts_with(&[0xef, 0xbb, 0xbf]);
    let current_text = std::str::from_utf8(&current)
        .map_err(|_| error("invalidEncoding", "外部文件必须使用 UTF-8 编码"))?;
    let crlf = current_text.contains("\r\n") && !current_text.replace("\r\n", "").contains('\n');
    let editable_content = if has_bom {
        content.strip_prefix('\u{feff}').unwrap_or(content)
    } else {
        content
    };
    let normalized = editable_content.replace("\r\n", "\n");
    let normalized = if crlf {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };
    let mut bytes = Vec::with_capacity(normalized.len() + if has_bom { 3 } else { 0 });
    if has_bom {
        bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    }
    bytes.extend_from_slice(normalized.as_bytes());
    let temp = parent.join(format!(".hermes-{}.tmp", Uuid::new_v4()));
    let write_result = (|| -> Result<(), AppError> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        replace_file(&temp, path)?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    write_result?;
    Ok(revision(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_read_retries_but_permanent_errors_stop() {
        let mut calls = 0;
        let mut delays = Vec::new();
        let value = retry_file_read(
            || {
                calls += 1;
                if calls < 3 {
                    Err(std::io::Error::from(std::io::ErrorKind::NotFound))
                } else {
                    Ok(b"latest".to_vec())
                }
            },
            |delay| delays.push(delay.as_millis()),
        )
        .unwrap();
        assert_eq!(value, b"latest");
        assert_eq!(delays, [100, 200]);
        let mut calls = 0;
        let result = retry_file_read::<()>(
            || {
                calls += 1;
                Err(std::io::Error::from(std::io::ErrorKind::NotFound))
            },
            |_| {},
        );
        assert!(result.is_err());
        assert_eq!(calls, 4);
        let result = retry_file_read::<()>(
            || Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
            |_| panic!("权限错误不应重试"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn revisions_change_with_content() {
        assert_ne!(revision(b"one"), revision(b"two"));
        assert_eq!(revision(b"one"), revision(b"one"));
    }

    #[test]
    fn save_detects_external_replacement_and_keeps_original_on_conflict() {
        let dir = std::env::temp_dir().join(format!("hermes-linked-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create test directory");
        let path = dir.join("Today.md");
        fs::write(&path, "first").expect("write initial file");
        let old_revision = revision(b"first");
        let saved_revision =
            save_file(&path, "second", &old_revision, false).expect("save linked file");
        assert_eq!(saved_revision, revision(b"second"));
        fs::write(&path, "external change").expect("replace outside the app");
        assert!(save_file(&path, "stale local", &saved_revision, false).is_err());
        assert_eq!(
            fs::read_to_string(&path).expect("read original"),
            "external change"
        );
        fs::remove_dir_all(&dir).expect("clean test directory");
    }

    #[test]
    fn index_can_be_rewritten_without_losing_bindings_on_windows() {
        let dir = std::env::temp_dir().join(format!("hermes-linked-index-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create test directory");
        let path = dir.join("linked-files.json");
        let mut index = LinkedIndex::default();
        write_linked_json(&path, &index).expect("create index");
        index.bindings.push(LinkedBinding {
            id: Uuid::new_v4().to_string(),
            path: "Today.md".into(),
        });
        write_linked_json(&path, &index).expect("replace index");
        assert_eq!(load_index(&path).expect("read index").bindings.len(), 1);
        fs::remove_dir_all(&dir).expect("clean test directory");
    }

    #[test]
    fn save_preserves_bom_and_crlf_style() {
        let dir = std::env::temp_dir().join(format!("hermes-linked-lines-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create test directory");
        let path = dir.join("Today.md");
        let original = b"\xef\xbb\xbf# title\r\nold\r\n";
        fs::write(&path, original).expect("write initial file");
        let saved = save_file(&path, "\u{feff}# title\nnew\n", &revision(original), false)
            .expect("save linked file");
        let expected = b"\xef\xbb\xbf# title\r\nnew\r\n";
        assert_eq!(fs::read(&path).expect("read saved file"), expected);
        assert_eq!(saved, revision(expected));
        fs::remove_dir_all(&dir).expect("clean test directory");
    }

    #[test]
    fn directory_scan_is_non_recursive_by_default_and_skips_sync_temp_files() {
        let dir = std::env::temp_dir().join(format!("hermes-linked-scan-{}", Uuid::new_v4()));
        fs::create_dir_all(dir.join("nested")).expect("create test directory");
        fs::write(dir.join("Today.md"), "today").expect("write note");
        fs::write(dir.join(".syncthing.Today.md"), "temporary").expect("write temp");
        fs::write(dir.join("nested").join("Next.md"), "next").expect("write nested");
        let mut files = Vec::new();
        let root = LinkedRoot {
            id: "root".into(),
            path: dir.to_string_lossy().into(),
            recursive: false,
        };
        scan_directory(&root, &dir, &mut files).expect("scan directory");
        assert_eq!(files.len(), 1);
        assert!(files[0].ends_with("Today.md"));
        fs::remove_dir_all(&dir).expect("clean test directory");
    }
}
