# 笺影 Mac 2.0.6：关闭重开便签的位置漂移

基线 2.0.5 / main `6a8c447`。便签恢复函数先设置外框左上角坐标，再设置内容大小。Tao 在 macOS 将这两步按顺序排入主线程，分别调用 AppKit setFrameTopLeftPoint 和 setContentSize；后一步改变窗口高度时可能再次移动顶部。关闭时保存此位置，后续重开反复累积偏移。

Mac 恢复改为先设置大小，最后设置保存的左上角位置。内部笔记、外部 Markdown 钉屏便签、已存在窗口与新建窗口均共用该函数。Windows 仍按原顺序；不改变材质、坐标存储格式、屏幕缩放换算、数据、设置或小组件身份，不自动猜测修复已漂移的历史坐标，用户移动到正确位置后保存即可。

增加一个云端 AppKit 回归：隐藏的合成无边框窗口复现旧顺序偏移，然后以不同高度连续恢复 50 次确认左上角不变。不操作本机真实笔记或界面。此验证不等同于真实便签点击、多屏换屏或视觉验收。

自动 CI 保持停用，只临时手动运行一次正式 Mac 构建并恢复停用状态。方案功能不在本轮实现。

- 正式源码 `c3c08fc` 的 [手动 Mac 完整构建](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/38573361464)通过：前端 161 项、Rust 208 项、Swift/WidgetKit 回归及 App Intents 元数据、签名和打包完成。
- AppKit 隐藏窗口回归明确复现旧顺序偏移，新顺序不同高度连续恢复 50 次左上角不变。证据为云端原生 API 回归，未执行本机真实便签点击、多屏或视觉测试。Windows 分支代码顺序未改，本轮未重新运行 Windows 编译。
- Actions ZIP SHA-256 `8cf34d8f822497c607c2a9daa1154acd8c4dbecdfd1875f5dc38f6c78ea212f1`，ZIP 校验与解压完整性通过。

- DMG SHA-256 `b383377c4653583bd2b72dc34f14dd01947f943d1216268c6f65522329dcec62`，2026-10-14 已安装到 /Applications/Folio.app。主程序 arm64、扩展 arm64/x86_64，版本、身份、App Intents 元数据及 deep strict 签名通过。终止的进程仅限本项目宿主与扩展，16 项磁盘文件在替换前后校验一致，真实笔记、外部 Markdown、配置与共享身份保留，旧应用/数据恢复备份留在本机，不分发。
- PR #22 已合并 main `367b33f6ce00e2c31810b93b9e2a3a28d6779e08`，应用源码与正式构建提交一致。[GitHub 2.0.6 发布](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/tag/mac-v2.0.6) 已公开，四项资产（DMG、校验清单、构建记录、安装说明）的大小和 SHA-256 在发布前逐项核对一致。

- 十个构建/检查/发布工作流再次核实为 disabled_manually，仅 Issue 标签保持启用。本机旧 2.0.5 DMG 已清理，旧应用恢复 ZIP 和真实数据备份保留在 Documents/Folio-recovery。本机新版仅后台启动交还使用，未进行真实便签测试。
