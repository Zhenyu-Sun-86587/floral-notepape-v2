# macOS 协作者交接（本轮未实施）

本轮以 Windows 为主，没有提交 macOS 专属配置改动、Mac 构建工作流，也没有做 macOS 构建或 GUI 验收。

## 运行前必须处理

1. `src-tauri/tauri.macos.conf.json` 仍把 `identifier` 覆盖为原版的 `com.floral-notepaper.app`，主窗口标题仍为花笺。先改为 fork 的独立应用身份，并核对 `.app` 名称、自启、单实例及 WebView 用户数据目录。**完成隔离前不要在装有原版花笺的 Mac 上运行或安装 fork。**
2. 核对 `src-tauri/src/services/notes.rs` 的 macOS 数据目录、配置目录和环境变量，确认不会读取或迁移原版数据。使用虚构测试目录；不使用真实同步目录做早期测试。
3. 平台覆盖配置仍声明静态主窗口。评估静默启动时的 WebView 成本、托盘/Dock 重开及外部文件事件后，再决定是否改为按需创建。Windows 的本轮包体积和窗口结论不作为 Mac 的实测数据。
4. 建立只面向本 fork 的 macOS 构建工作流。分别在 Mac runner 构建 `aarch64-apple-darwin` 与 `x86_64-apple-darwin` 的 DMG，不引用原作者签名、审批、商店或 MirrorChyan 凭据。最低 macOS 版本暂沿用 `15.0`。

## 验证与回传

- 在 Mac 上执行 lockfile 安装、TypeScript 检查、Rust 检查、DMG 构建，并记录 commit SHA 与 artifact。
- 实测新建、中文输入、保存、磁贴、窗口缩放、静默启动、快捷键、Dock/托盘找回和外部文件入口；特别检查关闭后保存与重开。
- 明确区分“CI 构建通过”和“macOS GUI 已验证”。将平台差异、资源数据与签名状态写入状态文档。
- Windows P3 新增 `linked.rs`、`linked_watcher.rs` 与独立外部文件 Tile；请在完成 Mac 身份及数据隔离后，使用虚构目录验证文件绑定、目录新增、原子替换、冲突与草稿。Unix 路径使用 rename 替换，不能把 Windows GUI 结果作为 Mac 验收。
