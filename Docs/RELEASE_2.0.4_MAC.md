# 笺影 Mac 2.0.4：关闭原生材质时的便签兼容

从已发布 2.0.3 / main `3a3006c` 重新修改。首轮修改已全部撤回，最终仅修改 Mac 材质模块和原生便签标题栏，版本更新不涉及其他功能。

关闭“Mac 原生材质”时，正文的网页背景无法覆盖位于 WebView 外的 AppKit 标题区，原标题区会露出桌面。本轮只在关闭时为该区域补上系统色实体背景；开启时移除它，保留 2.0.3 的透明标题、液态玻璃、磨砂、融合、回弹和桌面折射效果。标题和按钮不调整透明度，AppKit 边界、固定正文容器和现有视图所有权保持。

旧系统继续沿用 2.0.3 的 NSVisualEffectView 磨砂回退；额外确认玻璃视图及胶囊玻璃容器两个公开类均存在后才选择玻璃，避免只存在其中一个时进入不支持的路径。设置栏、偏好、内部及外部 Markdown 保存、同步、共享、小组件配置和 Windows 实现保持。最低系统仍为 macOS 15；没有液态玻璃的 macOS 15–25 使用磨砂，不宣称支持 14 或更早版本。

## 验证与交付

采用现有 GitHub Actions 完整 Xcode Mac 构建与 Windows 兼容检查，不增加本机动态测试或界面操作。没有旧版 macOS 真机视觉验证，没有 CPU、内存、GPU 或能耗测量。人工验收：旧系统关闭原生材质时标题/正文正常显示，开启时磨砂；macOS 26 开启后与 2.0.3 观感一致；材质反复切换、拖动、合并分离，以及内部/外部便签各一份。

安装前备份真实数据和旧应用，校验包、身份、版本、嵌入扩展及严格签名，只终止本项目进程并替换 /Applications/Folio.app，按要求不启动新版做运行测试。签名仍为 ad-hoc 且未公证，升级可能需要用户重新授权，不承诺永久免授权或所有机器可用。

- 正式源码 `789f2294fb5e31e36160509ae7f07192e36176a2`：[Mac 完整 Xcode 构建](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/37195857429)和 [Windows 兼容工作流](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/37195860072)均通过。先前候选已取消，没有分发，不计作通过。
- DMG `Folio_2.0.4_aarch64.dmg`，SHA-256：`ef5adcd02c418aedcaecb63170b2dc5309a348cf9badf4674f44924725b90fb7`。Actions ZIP SHA-256 `7cdc972d9e13e3ebf941af9c96f82e9157f20f6b86a0282ac8b30ecc868e8e75` 已核对，解压完整性通过。主程序 arm64、扩展 arm64/x86_64；版本、身份、App Intents 元数据及 deep strict 签名检查通过，无开发描述文件。
- 2026-10-04 已安装到 `/Applications/Folio.app`，仅终止旧 Folio 主程序和扩展进程。15 项磁盘文件在替换前后保持相同校验，包括设置、共享编号、内部元数据、外部 Markdown 与绑定/草稿、小组件快照。恢复备份保留在本机，未上传。未启动新版做任何运行或界面测试，未声称未保存的内存编辑可被强制终止保留。
- [PR #20](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/pull/20) 已合并并推送 main `4b2373b45840d478dcbdcff1477389d92d089bb7`，应用源码与已通过构建的提交逐文件一致。[GitHub 2.0.4 发布](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/tag/mac-v2.0.4) 已公开，DMG、校验清单、构建记录、安装说明四项远端资产的大小和 SHA-256 在正式发布前逐项核对一致。相同源码的重复 PR 与 main 构建已取消，不计作通过。
- 本机过时的 2.0.3 DMG 已清理，旧应用恢复 ZIP 和真实数据备份保留。新版安装后未启动；实际显示与旧系统体验由用户验收。
