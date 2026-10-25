# 笺影 Mac 2.0.8：macOS 27 小组件正文显示兼容

基线 main `49f4fdf` / 已安装 2.0.7，测试机器 Apple Silicon、macOS 27.0.1 (26A434)。用户反馈升级后仅翻页有响应，正文不显示。

## 诊断证据

- PlugInKit 注册正常，正式扩展由系统启动，签名 deep strict 验证通过。
- 私有容器快照存在，两份已选笔记均含正文；扩展 READ_OK 读取两份笔记，编号 1、2 的 WIDGET_DISPLAY 均 assigned=true、resolved=true。chronod 接受时间线并 reload succeeded，不能归因为笔记丢失或容器完全不可读。
- linkd 报 Unable to get teamId、扩展报 Failed to fetch metadata，但相同错误在 macOS 26 的历史故障已有记录；仅凭该警告不能证明本次新原因，更不能推导所有 ad-hoc 按钮不可用。
- 本机用纯合成内容执行生产视图的 ImageRenderer，旧版可正常渲染。普通 SwiftUI 排版未复现真实 WidgetKit 空白，问题范围集中于系统归档/交互渲染链路；其具体系统内部原因尚未确认。

## 候选修复

标题、段落、待办的可见文字放入静态时间线视图，透明交互层保留原 App Intent 和参数、命中范围及无障碍动作。正文不再只存在于 Button 标签内，避免交互还原异常连带吞掉唯一正文视图。无需给文字复制多套缓存，不改身份、私有容器、编号、分页、任务快照校验、保存或同步。保留隐私敏感标记，不强制 unredacted，不伪造 Team ID，不修改系统权限和其他应用配置。

本机合成生产视图对照保持可见文字及版式。此结果不是系统小组件真实展示/点击验证。仅手动运行正式 Mac 完整构建，自动 CI 保持关闭。Windows 路径未修改，本轮不重新构建 Windows。

[候选构建 c3f3f5f](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/40214461143)通过：前端 161 项、Rust 208 项、四种小组件配置及既有原生回归通过，完整主应用/WidgetKit 编译、App Intents 元数据、严格签名和 DMG 完成。

- Actions ZIP SHA-256 `11459028de6fbe9578cafc866d581c196650cf32c10ae5b908f4c62979ee52b4`，DMG SHA-256 `06324eb0cec1c3b00ab4824863907b61b44ef78e84e3c982052db07decb722e2`，整包与解压完整性通过。
- 2026-10-26 候选版安装 /Applications/Folio.app，系统 PlugInKit 登记 2.0.8；主程序 arm64、扩展 arm64/x86_64，身份/版本/元数据/deep strict 签名通过，无开发描述文件。仅终止本项目旧进程；34 项磁盘文件在替换前后校验一致，旧应用与真实数据恢复备份保留本机，不分发。
- 安装后静默启动，请求系统刷新本应用组件。工具只能读取其他系统组件的窗口，不能可靠获取笺影桌面组件的实际截图。需要用户确认正文和点击是否恢复，不能用合成图、版本号、时间线接收成功替代。
- PR #24 保持草稿，未合并或正式发布。在真实链路确认前，不标记问题已解决。
