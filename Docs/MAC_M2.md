# Mac M2：原生窗口行为 — 1.7.13

日期：2026-10-02，基于 M1 1.7.12。用户反馈 M1 基本正常，可以继续下一阶段；不据此将所有专项 GUI 项标为通过。

## 变更

- Mac 开放普通、置顶、桌面层三种模式。使用 CoreGraphics 标准层级；桌面层位于 Finder 图标上方、普通应用下方，编辑时临时回到普通层，结束编辑后恢复。锁定沿用 M1 的原位解锁入口，锁定期间临时置顶，解锁恢复原模式。
- 桌面层使用 Stationary 和 IgnoresCycle，不强制跨所有 Spaces；退出桌面层恢复原 collectionBehavior。真实“显示桌面”、Mission Control、全屏及 Stage Manager 需要人工验收。
- 静默显示使用 AppKit orderFrontRegardless，避免成为键盘活动窗口。首次静默启动在事件循环 Ready 前禁止应用激活，Ready 后恢复 Regular 身份与 Dock；重复 --silent 启动不找回主窗。显示时重申原生层级，避免框架异步置顶操作覆盖桌面层。
- 关闭最后一窗后继续驻留；菜单栏找回、全局快捷键沿用已有入口。点击 Dock 始终找回列表，包括桌面便签仍显示时；应用菜单 Cmd+Q 通过统一退出入口保存已有布局并退出。
- 接收 Finder 打开支持的 Markdown/文本文件事件；保留原文件打开流程，不设置默认文件关联。
- Mac 外观设置改为“macOS 原生磨砂”。原生窗口不可用时向前端报告错误。

原生接口依据：[Apple 无激活显示](https://developer.apple.com/documentation/appkit/nswindow/orderfrontregardless%28%29?changes=_9)、[窗口 collectionBehavior](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct?changes=__2&language=objc)、[标准窗口层级](https://developer.apple.com/documentation/coregraphics/cgwindowlevelkey)。实际桌面管理器表现以本机人工验收为准。

## 基础检查

- 10 项前端定向测试（首次显示、保存策略、路由）及 oxlint 通过，TypeScript/Vite 构建通过。
- 4 项 Rust 定向测试：层级/锁定回退、collectionBehavior、最后一窗驻留/显式退出、Mac 应用菜单映射。
- Mac arm64 app/dmg 构建通过。隔离虚构笔记目录静默恢复检查通过：三张便签 CoreGraphics 层级分别为 0、3、-2147483602；前台应用 PID 前后均为 427，进程正常运行。初次检查发现抢焦点与异步层级覆盖，已修正并重新构建检查。结果在 `local-build/mac-m2-1.7.13/smoke-result.json` 保存，测试进程已清理。
- 已替换安装 `/Applications/Hermes Surface Dev.app` 为 1.7.13 并启动；旧 1.7.12 app 及已确认哈希的旧 DMG 移到废纸篓，配置与笔记未删除。
- 安装包仅 arm64，无 Developer ID 签名/公证。每阶段自行替换旧 app，旧 app 移入废纸篓，保留真实笔记与配置。

## 本次人工检查

1. 同一便签依次切换普通 → 置顶 → 桌面层；普通应被其他应用遮挡，置顶在前，桌面层在普通应用后。点击桌面层正文编辑，结束后回到桌面层；关闭/重开模式应保留。
2. 桌面层锁定 → 正文穿透 → 原锁图标解锁，确认回到桌面层。普通与置顶各复测一次。
3. 关闭列表和最后一张便签后，菜单栏图标仍在。菜单栏、Dock、已有全局快捷键分别找回；有桌面便签可见时点 Dock 也能打开列表。
4. 保存内容后用 Cmd+Q 或菜单栏“退出”退出，再手动打开；检查笔记和模式恢复。启用已有登录启动设置后，下次登录应静默恢复，不抢前台应用焦点；本阶段不会自动替用户启用登录项。
5. 使用“显示桌面”、切换 Spaces、进入其他应用全屏、Stage Manager；反馈是否消失、层级异常或无法点击。多屏边缘与胶囊原生拖动仍是 M3 范围。

基础运行检查只覆盖独立临时目录，不等于以上交互已验收。下阶段 M3 为 Mac 胶囊拖动、跨屏和安全边缘。
