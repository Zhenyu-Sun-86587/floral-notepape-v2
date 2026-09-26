# Hermes Surface Dev

**简体中文** · [繁體中文](README_zh-HK.md) · [English](README_en-US.md)

把 Markdown 笔记固定在桌面，需要时直接写，暂时不用时收纳到屏幕边缘。当前 Windows 版本为 **1.7.2**。

[下载 Windows 1.7.2](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/tag/v1.7.2) · [反馈问题](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/issues) · [Mac 开发交接](Docs/MAC_HANDOFF.md)

> **平台状态**：Windows x64 已提供 NSIS 安装包。macOS 正由协作者适配，当前没有本项目的 Mac 安装包。1.7.2 的便签、胶囊与快捷键交互仍待人工 GUI 验收，详情见 [项目状态](Docs/STATUS.md)。

## 能做什么

- **独立便签**：从笔记列表固定内部笔记或已绑定的外部 Markdown 文件。每张便签有自己的内容、位置和显示状态。
- **原文件写回**：绑定 Markdown 目录后，在应用内编辑外部 `.md` 会保存到该文件；外部编辑器的修改会通知对应便签。导入 Markdown 则创建应用内副本，两种入口各有用途。
- **同窗读写**：正文使用同一个 Markdown 源编辑器，点击文字定位光标，只显露当前行标记；Esc 或失焦后保存并恢复阅读呈现，保留光标与撤销。显式切换按钮仍在，窗口位置和尺寸不变。阅读支持 Markdown 预览、任务列表、代码、公式、图片与按需加载的 Mermaid。
- **桌面窗口**：Windows 提供普通、置顶和桌面附着模式。桌面附着跟随桌面层；锁定后便签可见、主体鼠标穿透，原锁图标位置可解锁。
- **贴边收纳**：把便签收成左、右或顶部色条，Windows 拖动色条可换边或跨屏。悬停可读/可复制预览，单击直接恢复原窗口；右键可关闭所选胶囊。12 色槽位持久分配；展开后胶囊保留，高亮当前成员。相邻组的前端拖动头可移动整组。
- **外观与唤起**：主题、字体、背景与透明度可调整；支持托盘、静默启动和应用/单便签快捷键。Windows Acrylic 由系统控制，桌面附着模式不使用 Acrylic。

  1.7.2 的实现范围与待验收项见 [发布说明](Docs/RELEASE_1.7.2.md) 与 [交互设计](Docs/INTERACTION_1.7.2.md)。

## 下载安装

下载 [v1.7.2 Windows x64 安装包](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/download/v1.7.2/Hermes.Surface.Dev_1.7.2_x64-setup.exe)。同一 [Release 页面](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/tag/v1.7.2) 提供 `SHA256SUMS.txt`；安装包 SHA-256 为：

```text
8F49DDD18D10346F5460DF0B850D45D6A2285BF70D33BDB3FC914A07C528B5D4
```

安装包未签名，且不内嵌完整 WebView2 Runtime；若电脑尚未安装 Runtime，安装过程需要联网下载。当前没有本 fork 的 Microsoft Store、Mirror 酱、Windows ARM64 或 macOS 产物，请以本仓库的 Release 为准。

## 快速上手

1. 新建笔记并保存；需要在桌面查看时，选中笔记并点击图钉。
2. 如果要编辑已有 `.md` 原文件，选择“绑定 Markdown 目录”；如果只想复制内容进入应用，选择“导入 Markdown”。
3. 单击阅读正文即可写作，Esc 返回阅读；右上角按钮也可显式切换。用锁按钮开启穿透，用边缘收纳按钮把便签收成色条。
4. 在笔记列表的逐便签设置中配置窗口模式、启动行为、快捷键再次触发的动作和默认收纳边。普通关闭与主动收纳是两种状态。

初次测试外部文件与同步目录时，请先使用虚构测试目录。更完整的 Windows 人工检查见 [验收清单](Docs/MANUAL_ACCEPTANCE.md)。

## 开发

项目使用 Tauri 2、Rust、React 和 TypeScript。Windows 构建使用 PowerShell 7，在仓库根目录执行：

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
npm ci
npm run tauri build -- --bundles nsis
```

源码主要位于 `src/`（界面）、`src-tauri/src/`（本机服务和窗口）与 `src-tauri/tauri.conf.json`（打包配置）。Mac 协作者应先按 [交接文档](Docs/MAC_HANDOFF.md) 隔离应用身份，再在 Mac 上构建和验收；Windows 构建成功不能代替 Mac 测试。

## 当前边界

应用内重命名外部文件、缺失文件重新关联和“全部收纳”入口尚未实现。1.6.0 的运行内存、CPU 与首次呼出延迟没有可信实测；Windows GUI 的完整回归也未完成。详细状态和性能复查记录见 [P8 收尾报告](Docs/P8_FINAL.md)。

## 来源与许可

本项目从 [Achilng/floral-notepaper](https://github.com/Achilng/floral-notepaper) fork 开发，保留原仓库历史与原作者版权。项目采用 [MIT 许可证](LICENSE)；[上游来源](Docs/UPSTREAM.md)与[第三方资源声明](THIRD_PARTY_NOTICES.md)列出保留的授权信息。本 fork 使用独立的 Windows 应用身份和发布页面，上游的商店、签名与下载渠道不属于本项目。
