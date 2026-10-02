# Mac 桌面配置与全屏层级 — 1.7.16

2026-10-02，基于 1.7.15，仅处理本轮三个要求。

## 设置

应用设置新增 macOS 专属“桌面与全屏空间”：便签在所有桌面显示、胶囊在所有桌面显示。两个开关独立，缺省为开启，兼容上一版行为。保存后更新现有窗口，新窗口和重启恢复也读取相同配置。关闭时移除跨 Spaces 和跨其他应用全屏的行为位，保留窗口所属桌面；不开启 MoveToActiveSpace，避免每次切换都把窗口带走。

配置存为 `macos.notesOnAllSpaces` / `macos.capsulesOnAllSpaces`。预览跟随胶囊开关，原生解锁按钮跟随对应便签。配置更新沿用现有保存与广播路径，刷新时保留正在编辑的临时窗口模式，避免桌面层编辑中掉回底层。

## 全屏置顶

1.7.15 虽已申请 FullScreenAuxiliary 和 CanJoinAllApplications，但置顶仍是 FloatingWindowLevel。1.7.16 将透明无边框便签、胶囊与预览建为真正的 NSPanel，并将置顶/锁定便签、胶囊与预览提高到 StatusWindowLevel；保留跨全屏行为、不隐藏于应用失焦，不主动激活应用。普通窗口和桌面层不提高层级，主窗口仍为 NSWindow，不加入全屏覆盖。仅提高 NSWindow 层级的初次全屏检查失败，改用独立 NSPanel 子类后重复同一检查。

依据：[Apple CanJoinAllApplications](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications)、[NSWindow.Level](https://developer.apple.com/documentation/appkit/nswindow/level-swift.struct)。真实第三方应用、系统界面及 Mission Control 的表现由人工验收；不使用屏保级覆盖或私有 Spaces 操作。

## 编译隔离

- Rust `platform/macos.rs` 及 `AppConfig.macos` 用 `#[cfg(target_os = "macos")]`，其他平台不编译、不序列化 Mac 专属字段。AppKit、Quartz、Mac 锁定入口继续在 Mac 模块中，窗口模式分发通过同名函数的编译条件选取实现。
- Keyring 的 Apple、Windows、Linux 原生后端按 Cargo target 选择；AppKit/Quartz 依赖只属于 Mac target。
- 前端 `#platform-settings` 按 `TAURI_ENV_PLATFORM`（未指定时使用构建机平台）选择 macos/windows/other 模块，不以浏览器 UA 隐藏设置。Mac 开关、磨砂标签、桌面层说明不进入 Windows 前端产物。
- Tauri 的公共 `macos-private-api` feature 和配置标志保留框架要求：tauri-build 检查共享依赖的声明，实际平台实现仍由框架 cfg 限制。这不意味着 Windows 编译 AppKit 代码。
- 当前 TS 类型检查将平台接口映射到 Mac 模块（Mac 可选配置）；实际产物模块由 Vite 目标选择。没有宣称在本机验证 Windows 原生链接或运行。

## 人工检查

1. 开启两个开关，便签设为置顶，切换多个桌面与其他应用原生全屏；便签、胶囊与预览均应可见。
2. 分别关闭“便签”与“胶囊”开关：检查独立生效，当前窗口位置、内容不丢失，预览与入口保持一致。
3. 重启后检查两个开关持久化及恢复；普通窗口/桌面层仍遵守各自层级。
4. 编辑、固定/取消、锁定/解锁、胶囊展开/收回与拖动回归；Mission Control 仍排列便签窗口，不产生解锁按钮卡片。

基础检查：5 项窗口行为/层级/坐标测试、1 项 Mac 配置默认与独立开关序列化测试通过；Mac TS/Vite 与 app/dmg 构建通过。Windows 目标前端构建通过，检查产物不含 Mac 专属字段、开关与标签，保留 Windows 标签。隔离配置原生全屏 fixture 进入真实全屏后，置顶便签仍在 on-screen 窗口列表中（level 25），静默恢复前后台 PID 相同。原生全屏检查验证基础窗口资格与层级；不替代用户对实际应用、可点击性、Mission Control、系统界面的 GUI 验收。

胶囊隔离 fixture：左/右/上三组胶囊均在安全区内，原生全屏后仍在 on-screen 列表中，静默恢复前后台 PID 相同。本机已替换安装 1.7.16，旧版移入废纸篓，保留用户笔记与配置。
