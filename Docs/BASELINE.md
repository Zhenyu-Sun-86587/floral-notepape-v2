# P0–P2 瘦身基线（2026-09-23）

## 起点与环境

- 上游起点：`69a43aef87d2d8fa90c7a7d929cd113941f1fde3`。
- 上游起点 tag：`baseline-upstream-2026-09-23-69a43ae`；Windows 瘦身源码提交：`0ad4f1f2841d9813130ecb4a37da0e663e9e7575`。
- fork：`Zhenyu-Sun-86587/floral-notepape-v2`；保留 `upstream` 指向 `Achilng/floral-notepaper`。
- Windows 本机：Node `v25.2.0`、npm `11.6.2`、Rust/Cargo `1.92.0`。
- 使用仓库现有 `package-lock.json` 和 `src-tauri/Cargo.lock`。Cargo lockfile 因 Rust 包名变更而更新；未主动升级依赖。
- P0 在更换应用身份、隔离数据目录、取消文件关联和移除 `taskkill` 后构建；P1 在停用自动更新入口、联网贡献者步骤和空闲便签池后构建。

## 调用关系与保护边界

- 打开：托盘/快捷键/主界面调用 `desktop.rs` 的 `open_notepad_window_now`，优先取池，池空时动态创建窗口。P1 池容量为 0，故总是按需创建。
- 保存：`MainWindow` 的保存队列与 `NotePad` 的 `saveNote` 继续经 notes API 写入 `NoteStore`。更新前准备事件只属于原版安装握手；本轮没有更改正常保存路径。
- 关闭：`NotePad` 保存状态由前端维护；Rust `recycle_notepad_window` 保存窗口大小后回收。P1 入池失败时关闭窗口。主界面关闭到托盘时仍隐藏，避免在未验证保存事件前更改该路径。
- 外部文件：主界面通过 `readExternalFile` / `saveExternalFile` 处理；冷启动参数经 `take_startup_file` 读取。P1 静默运行无主窗口时，第二实例传入文件先暂存，创建主窗口后读取。

## 同口径产物

| 项目                   |    P0 隔离版 |    P1 瘦身版 |
| ---------------------- | -----------: | -----------: |
| Windows Release 主程序 | 31,596,544 B | 28,097,024 B |
| Windows NSIS 安装包    | 19,203,487 B | 18,248,396 B |

两次均使用 `npm run tauri build -- --bundles nsis`，均为本机 Release 构建。主程序减少 3,499,520 B，安装包减少 955,091 B。包体积变化不能代表运行内存变化。

## 运行资源

| 场景                 | P0 Working Set / Private Bytes | P1 Working Set / Private Bytes | 窗口与进程 |
| -------------------- | ------------------------------ | ------------------------------ | ---------- |
| 只有托盘             | 未测                           | 未测                           | 未测       |
| 1 张磁贴，主界面关闭 | 未测                           | 未测                           | 未测       |
| 3 张磁贴             | 未测                           | 未测                           | 未测       |
| 全部关闭/隐藏        | 未测                           | 未测                           | 未测       |
| 完整退出             | 未测                           | 未测                           | 未测       |

本机没有可用的桌面自动化入口；`orca` 命令不存在。一次以虚构目录启动 P0 静默实例的测量尝试无法在受限会话中读取进程信息，随后检查未发现残留进程。因此没有足够证据记录任何运行资源数值，也没有宣称 GUI 回归通过。用户可按 [MANUAL_ACCEPTANCE.md](MANUAL_ACCEPTANCE.md) 在交互桌面补测。

## 构建结果

- P0：`npm ci`、`npm run build`、`cargo check`、Windows NSIS Release 构建通过。
- P1：`npx tsc --noEmit`、`npm run build`、`cargo check`、Windows NSIS Release 构建通过。
- P1：`cargo test --lib` 148 项、`npm test` 110 项通过。
- 首次依赖下载需要网络权限；离线缓存不完整。后续使用 lockfile 的既有版本。
- Vite 报告 `SourceHanSerifSC-Bold.woff2` 构建时未解析；这是已有资源引用，尚未做 GUI 字体确认。
