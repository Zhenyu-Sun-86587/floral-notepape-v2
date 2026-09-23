// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Fork 不执行原版安装更新助手，避免写入原版应用安装位置。
    floral_notepaper_lib::try_exit_for_cli_version_or_help();
    floral_notepaper_lib::run()
}
