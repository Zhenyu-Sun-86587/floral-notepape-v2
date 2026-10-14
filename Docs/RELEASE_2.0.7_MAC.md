# 笺影 Mac 2.0.7：原生标题区导致便签高度累计回缩

2.0.6 修复了先定位再调整大小导致的顶部偏移，但回归仅覆盖 AppKit 调整顺序，未包含原生标题区，漏掉另一个问题：Tao inner_size 读取其保留视图的 frame，Mac 原生标题栏把含 Wry 正文的该视图缩短 48 点；读取结果被当作整窗高度保存，重开后再扣标题区，底边持续回缩。

将三个尺寸入口统一到 surface_window_size：单便签位置/尺寸保存、全局记忆尺寸保存、从可见便签继承新窗口大小。Mac 的便签均为无边框窗口，以 outer_size 读取整窗尺寸，包含 AppKit 标题区；Windows 仍使用 inner_size。沿用 2.0.6 的先恢复大小再定位。内部和外部 Markdown、钉屏/普通便签、新建/已有窗口覆盖，不改变视图所有权、材质、数据格式或偏好，不用固定加 48 的补丁。

云端隐藏合成 AppKit 视图回归包含整窗 clip、压缩 48 点的正文视图：复现保存正文高度造成回缩，再验证不同高度下连续恢复 60 次完整尺寸及顶部位置稳定。原有 50 次位置回归保留。这是原生几何回归，不等同于真实 Tauri 便签点击、多屏或界面验收。本轮不重新跑 Windows 构建，不做本机动态测试。历史缩水尺寸不猜测修改，请用户手动调整一次。

仅临时手动构建，自动 CI 继续停用。远端和 AI 功能不实施。[手动 Mac 完整构建](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/38577032909)通过。正式源码 `aefbe6a`，前端 161 项、Rust 208 项、Swift/WidgetKit 及生产扩展元数据、签名与打包完成。云端日志明确：48 点回缩成功复现，保存整窗尺寸后不同高度连续恢复 60 次完整尺寸和位置稳定；原有 50 次位置回归通过。ZIP 完整性及校验通过，安装完成，[GitHub 2.0.7 发布](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/tag/mac-v2.0.7) 已公开，四项资产（DMG、校验清单、构建记录、安装说明）的大小和 SHA-256 在发布前逐项核对一致。

Actions ZIP SHA-256 `ac73c67e9e97ae6a0a8b42cd75596150dd8ba94f6158bbdcdc0960bf3e1faab5`。

- DMG SHA-256 `8b75f801b1c3deba10de33c8b087e902d4ef4e2ba50edc2f2cc1fa8c2dfa7950`。2026-10-14 已安装 /Applications/Folio.app；主程序 arm64，扩展 arm64/x86_64。版本、身份、App Intents 元数据和 deep strict 签名通过。只终止本项目旧宿主与扩展，16 项磁盘文件在替换前后校验一致，含真实笔记、外部 Markdown、绑定/草稿、设置、共享编号与小组件快照。旧应用和真实数据恢复备份保留本机，不分发。
- PR #23 已合并 main `f21a20cb41f62148c84ee0db8e70f62dec440422`，应用源码与正式构建提交一致。没有本机真实便签/界面测试，后台启动仅为交还使用。

- 十个构建/检查/发布工作流仍为 disabled_manually，仅 Issue 标签启用。旧 2.0.6 DMG 已清理，旧应用 ZIP 与真实数据恢复备份留在 Documents/Folio-recovery；新版仅后台启动交还使用，没有真实便签或界面测试。
