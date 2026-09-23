# Hermes Surface Dev：Windows 阶段状态

Windows 源码提交：`0ad4f1f2841d9813130ecb4a37da0e663e9e7575`；上游起点 tag：`baseline-upstream-2026-09-23-69a43ae`。

## 已完成

- P0：核对 fork/上游与 HEAD；Windows 使用独立 bundle identifier、显示名、配置/数据目录；取消原版数据自动迁移、文件关联、默认快捷键及构建前 `taskkill`；Windows NSIS 基线构建通过。
- P1-A：停用启动时原版更新检查；隐藏更新/CDK 设置入口；移除自动更新命令和更新助手入口；dev/build 不再请求 GitHub 贡献者 API，关于页保留静态来源与许可说明。
- P1-B：Windows 主窗口不在静默启动时静态创建；便签池容量改为 0，闲置便签窗口关闭后不保留 WebView。外部文件的静默唤起路径已调整。
- P2：Windows Release 主程序与 NSIS 安装包前后大小已记录；类型检查、编译、Rust 148 项与前端 110 项测试通过。
- P3（Windows）：外部 Markdown 绑定持久化；可绑定多个目录（默认非递归，可选子目录）、创建目录内 `.md`、从列表固定为独立 Tile，并在原文件上编辑保存。Rust 文件监听按绑定 ID 通知相关窗口；自动扫描新增文件，排除已解绑文件。保存使用同目录临时文件和 Windows 原子替换，按内容 revision 检查冲突，本机保存草稿。
- P3 隔离 GUI 验证：在 `D:/pinNote/p3-gui-test` 绑定目录，打开并固定 `Today.md`，独立便签编辑内容成功写回同一原文件；使用外部原子替换后，便签自动显示新正文。未使用真实同步目录。TypeScript 检查、前端 110 项测试、Rust 153 项测试及 Windows NSIS 构建通过。

## 待验收

- P0–P2 的新建、撤销/重做、拖拽缩放、托盘找回、导入副本等完整人工回归仍待验收；P3 GUI 仅验证了上述隔离闭环。
- 运行时 Working Set、Private Bytes、WebView2 子进程、隐藏窗口数及首次呼出延迟未取得可信数据。P2 资源和交互验收尚未通过。
- macOS 平台配置、构建工作流和 GUI 验证交由 Mac 协作者处理，交接见 [MAC_HANDOFF.md](MAC_HANDOFF.md)。当前 macOS 覆盖配置仍使用原版 identifier，不能把 Windows 隔离结果套用到 Mac。
- 主界面关闭到托盘时仍保留隐藏 WebView。此路径涉及现有保存与外部文件监听，本轮没有在缺少 GUI 验证时进一步销毁。
- P3 尚未实现应用内重命名、缺失文件重新关联和可靠识别外部改名；目录断连恢复、冲突交互、托盘退出时的未保存草稿需进一步 GUI 验收。文件 revision 比较与替换不是跨应用事务锁。

## 范围

Windows 已推进到 P3 文件绑定版本；P4 主题/材质、P5 桌面附着和 P6 胶囊收纳尚未开始。macOS 交接范围不变。
