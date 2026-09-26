use crate::services::notes::AppError;
use serde::Serialize;
use std::{
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
};

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let temp_path = temporary_json_path(path);
    let result = (|| -> Result<(), AppError> {
        let mut temp_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)?;
        serde_json::to_writer_pretty(&mut temp_file, value)?;
        temp_file.write_all(b"\n")?;
        temp_file.sync_all()?;
        drop(temp_file);
        fs::rename(&temp_path, path)?;
        sync_parent_dir(path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result.map_err(|mut error| {
        error.message = format!("写入 {} 失败：{}", path.display(), error.message);
        error
            .details
            .insert("path".into(), path.display().to_string());
        error
    })
}

fn temporary_json_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state.json");
    // 多窗口同时读取配置也可能触发写回；每次写入必须独占临时文件。
    path.with_file_name(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_json_writers_never_share_temporary_files() {
        let dir = std::env::temp_dir().join(format!("hermes-json-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let writers: Vec<_> = (0..8)
            .map(|id| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    for _ in 0..20 {
                        write_json_atomic(&path, &serde_json::json!({"writer": id})).unwrap();
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(value["writer"].as_u64().unwrap() < 8);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(not(target_os = "windows"))]
fn sync_parent_dir(path: &Path) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn sync_parent_dir(_path: &Path) -> Result<(), AppError> {
    Ok(())
}
