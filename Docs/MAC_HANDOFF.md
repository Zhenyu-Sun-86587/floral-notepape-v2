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

## P5 外观与原生材质交接

- Windows 新增主题 token、逐字段的全局/单便签覆盖、便签背景图和透明度；请在 Mac 上确认 WebKit 对 `color-mix`、CSS 变量背景图以及字体回退的表现。Windows NSIS 构建通过不代表 Mac GUI 已验证。
- `set_native_material` 当前只在 Windows 调用 Tauri Acrylic；非 Windows 返回“不可用”。Mac 协作者在完成应用身份和数据隔离后，再实现并实测 Vibrancy，核对关闭/恢复、圆角、缩放和多屏行为。不要把 CSS `backdrop-filter` 当作原生 Vibrancy 验收证据。
- 主题 JSON 不携带本机图片路径。请验证导入/导出、深浅主题、代码和 Mermaid、单便签字体继承及窗口透明背景；记录可用/降级状态。未完成前在状态文档保持 Mac 材质“未实现/未测”。

## P6 静默恢复与逐便签快捷键交接

- Windows 的 `surface-sessions.json` 位于本机配置目录，记录内部笔记与外部绑定各自的启动策略、显示状态、展开位置和快捷键。Mac 完成独立身份/数据目录后，再验证该文件不会与原版或 Windows 配置混用。
- `--silent` 会创建已配置恢复的便签，前端载入正文后显示且不请求焦点。Mac 上请实测登录项、Dock、菜单栏/托盘、全屏空间和多显示器缩放；Windows 构建结果不代表 Mac 行为。
- 验证 Mac 快捷键映射、系统冲突、录制中注销与恢复、关闭后重开。Mac 不具备 Windows 的键盘钩子路径，需单独确认快捷键录制体验。

## P7-A 桌面附着交接

- `desktopAttached` 是 Windows 专有的 Explorer 子窗口模式；Mac 设置界面灰显，Rust 后端也拒绝保存该模式。Mac 协作者如要实现等价桌面层，请单独设计并在 Mac 实测，不要仅取消置顶就称为桌面附着。
- 普通/置顶模式沿用 P6，会话文件可读取新枚举值；在 Mac 端打开来自 Windows 的 `desktopAttached` 会话前，需要设计明确的提示和恢复路径。
- 1.4.1 会话增加 `locked` 字段，锁定时便签置顶且鼠标穿透，主界面负责解锁。Mac 上的点击穿透、窗口焦点、Dock/菜单栏恢复尚未实测；Mac 协作者需单独验收，不沿用 Windows 结果。
- 1.4.2 的局部可点解锁按钮是 Windows 原生窗口；Mac 目前只能通过主界面解锁。若在 Mac 实现同等交互，需保持便签主体穿透，同时提供独立且可用的解锁入口。

## P8 / 1.6.0 交接补充

- `CapsuleSide` 增加 `top`，会话新增可选 `capsuleMonitor`/`capsuleOffset`；旧配置默认保持兼容。顶部轨道和预览是共享代码，拖动采样为 Windows 专用，Mac 需自行实现原生拖动结束与吸附，不可直接宣称支持拖条。
- 1.6.0 的进程资源脚本只面向 Windows。Mac 构建/性能/GUI 仍由协作者执行；本地 Windows P8 总结见 `P8_FINAL.md`。
