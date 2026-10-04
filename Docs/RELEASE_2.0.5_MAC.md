# 笺影 Mac 2.0.5：便签标题与正文边界衔接

基线 2.0.4 / main `841f154`。关闭原生材质时，AppKit 裁切整块便签，但从标题下方开始的 WebView 正文又绘制自己的圆角、边框和阴影，形成两块面板及接缝。

仅在 Mac 原生材质关闭、原生便签标题栏初始化成功时，移除网页正文的内层圆角、边框和阴影，由原有 AppKit 整窗圆角和系统阴影负责外边界。正文背景、主题、字号、不透明度及原生标题不变。涵盖内部和外部 Markdown 便签；开启玻璃/磨砂时不匹配该规则，2.0.3 的材质效果仍保持。主界面、胶囊、Windows、数据保存和同步不变。

沿用现有 GitHub Actions 完整 Mac 构建和 Windows 兼容检查；不新增重复实现的测试，不执行本机动态或界面测试。接缝与主题观感、旧系统显示仍需用户验收，无性能测量。最低 macOS 15，签名与小组件私有容器路线不变，升级授权仍受 ad-hoc 身份变化限制。

- 正式源码 `63f2602fb6cd4e461080f5c21e35be84aa055d86`：[Mac 完整 Xcode 构建](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/37198083575)与 [Windows 兼容检查](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/37198085521)均通过。
- DMG `Folio_2.0.5_aarch64.dmg`，SHA-256 `646e683426ea6c507b8767934d45a26a6666b72fb3b4a73506614e79955433c0`。Actions ZIP SHA-256 `fd6b3d1824b1bd06ff66f9f59d8de068ca03b33dd19a84310011fca45c51e621` 核对通过，截断分段重新下载后才进行整包校验，ZIP 完整性通过。
- 2026-10-04 已替换 `/Applications/Folio.app`，主程序 arm64、扩展 arm64/x86_64，身份、版本、App Intents 元数据与 deep strict 签名通过，无开发描述文件。仅终止本项目旧进程，15 项磁盘文件在替换前后保持校验一致，含真实外部 Markdown、内部元数据、绑定/草稿、设置、共享与编号、小组件快照。旧应用与数据恢复备份保留本机，未分发。
- 不执行本机运行或界面测试，启动仅用于交还使用；实际接缝、旧系统、主题及内部/外部便签观感由用户验收。
- 合并和 GitHub 发布结果随后补充。

通用 PR 检查 37199109302 未通过：两个原有文件存在格式缺口，其他编译任务在合并后无法读取临时 refs/pull/21/merge，尚未进入编译。已整理 scripts/test-save-handshake.mjs 和 Cargo.toml 的纯排版，全仓 oxfmt --check 通过，脚本语法有效，Cargo.toml 解析后的配置与正式构建提交完全相同。未将此 PR 检查记为通过；正式构建依据为上述独立 Mac 和 Windows 工作流。
