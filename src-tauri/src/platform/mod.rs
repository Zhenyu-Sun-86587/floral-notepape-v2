//! 平台专属配置按目标编译，不进入其他平台的配置契约。
#[cfg(target_os = "macos")]
pub mod macos;
