# Mac Spaces / Mission Control 修复 — 1.7.15

日期：2026-10-02，基于 M3 1.7.14。用户明确“跨屏幕”指 Mission Control 中的多个桌面与全屏空间，不是复制到多个物理显示器。

## 修复

- 便签采用 CanJoinAllSpaces + Managed + ParticipatesInCycle：切换桌面保持可用，作为窗口参与 Mission Control 与窗口循环。移除旧 Stationary/Transient 等互斥位，避免浮动层默认被系统视作隐藏于调度中心的临时窗口。
- 置顶/锁定便签补 FullScreenAuxiliary；macOS 13+ 补 CanJoinAllApplications，申请加入其他应用的全屏空间与 Stage Manager。保留普通、置顶、桌面层各自层级；需要在其他应用之上悬浮时选择“置顶”。
- 胶囊与悬停预览采用跨 Spaces、全屏辅助与跨应用行为，使用 Stationary + IgnoresCycle 保持入口性质，不制造多个 Mission Control 便签窗口卡片。
- 原生显示、组交接和解锁沿用静默路径，不因更新这些窗口行为而主动聚焦；兼容旧系统时不设置 macOS 13+ 的新行为位。
- 不复制笔记、不新增物理显示器上的重复轨道、不改写用户现有窗口模式。此修复取代 M2 “不强制跨所有 Spaces”的默认选择，这是本次用户明确指定的新行为。

依据：[Apple CollectionBehavior](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct?changes=_7%2C_7)、[CanJoinAllApplications](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications)。这些是原生行为请求，真实 Mission Control、其他应用全屏与 Stage Manager 的表现仍须人工复测。

## 基础检查与人工复测

基础检查覆盖互斥行为位、跨 Spaces 与全屏申请、层级及缩放投影；完成 Mac arm64 app/dmg 构建、静默恢复与安全区检查。本机替换安装 1.7.15，旧版移入废纸篓，笔记与配置保留。

1. 在桌面 1 固定便签，将模式设为“置顶”，切换桌面 2/3，检查同一便签和胶囊仍可见；编辑、保存后切回来仍是同一份内容。
2. 让浏览器或其他应用进入原生全屏，检查置顶便签、胶囊及悬停预览能显示、展开/收回和编辑；切回普通桌面后不跳错空间、不残留透明窗口。
3. 打开 Mission Control，确认便签作为窗口参与排列；胶囊维持入口，不出现胶囊窗口卡片。锁定/解锁、普通与桌面层分别复测；桌面层低于应用，不承担悬浮置顶行为。
4. Cmd+Q 退出后重开，或静默恢复，复测跨桌面和全屏；确认不抢前台焦点，M3 胶囊拖动及编辑性能没有退化。

基础测试不等于真实 GUI 验收。首次改动后请关闭旧进程并使用本次新装的 1.7.15 测试。
