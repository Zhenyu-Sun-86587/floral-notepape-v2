# 笺影 Mac 2.0.8：macOS 27 容器访问兼容与超大竖排小组件

基线 main `49f4fdf` / 2.0.7。用户升级 macOS 27.0.1 (26A434) 后，小组件保留旧内容，刷新、展开和待办失效，只有翻页正常。

## 26 → 27：先核对系统行为

Apple 的 [macOS 27 发布说明](https://developer.apple.com/documentation/macos-release-notes/macos-27-release-notes)在 System Integrity Protection 部分明确：访问其他开发团队的应用数据容器/组容器不再触发授权弹窗，改为默认拒绝，由用户在隐私与安全性管理。旧 [App Sandbox 文件访问文档](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)描述了此前跨容器访问弹窗及代码签名关联方式。不能假定 ad-hoc 主程序和扩展会被系统视为同一可信开发团队。

本项目采用宿主直写扩展私有容器的免费路线。翻页仅修改扩展自己的 UserDefaults；快照更新需要宿主写容器，展开/待办需要宿主读取容器的操作队列。新策略直接影响这些跨容器方向，不是窗口材质或普通正文排版问题。系统授权必须由用户完成，不伪造 Team ID、不自动授予权限、不操作 TCC 数据库或关闭 SIP。

## 实机证据与纠正

- 扩展正常注册、启动、读取两份已有快照；编号 1、2 均 assigned=true/resolved=true，系统接受时间线。
- 截图显示旧正文仍存在，但外部 Inbox 新增内容没有进入小组件。磁盘文件 265 字符，快照 246 字符且修改时间停在旧时刻；只有 Today 的文件与快照一致。
- 正常应用启动并记录宿主 stderr，反复报告“写入小组件共享容器失败”。28 个展开/待办操作滞留队列。为防止恢复授权后回放旧点击，已先备份并隔离这些文件，没有修改真实笔记。
- linkd 的 Team ID/元数据警告在 macOS 26 就存在，不能单独当作新根因。首个 c3f3f5f 候选误从渲染切入，虽然完整构建通过、合成图逐字节一致，但用户确认无效。该显示层改动已全部撤回，未合并或正式发布。

## 修正内容

- 保留原有小组件正文和 App Intent 实现，补齐宿主与容器间的诊断边界。快照和操作队列分别报告 pending/ready/denied/failed，显示错误域/码；不输出笔记正文或访问令牌。
- 不把“扩展存在”或“旧文件可读”当作可写。每次宿主启动首次发布真实执行一次原子写入，后续相同快照继续去重，不增加空闲轮询。
- 解析容器时保留实际文件系统错误，区分不存在与拒绝访问；操作文件读取失败时保留原文件，不按已消费删除。
- 设置增加明确的 macOS 27 访问提示、打开文件与文件夹设置、重新发布并检查连接。优先由用户授予 Folio 对小组件容器的访问；如果系统不提供窄授权，可由用户自行选择完全磁盘访问。授权后需保存并退出/重开应用，再验证。ad-hoc 升级可能改变授权身份，不承诺永久免授权。
- 不改变笔记/绑定/共享编号/数据格式，不实施远端或 AI 功能。Mac 命令和 UI 独立；Windows 路径保持。

## 验证与交付状态

本机 Swift 无真实文件测试验证 Cocoa/POSIX 权限错误及嵌套错误分类、恢复状态和 FFI JSON；前端类型检查通过。测试接入正式 Mac 手动构建。自动 CI 保持关闭。

首个无效候选的构建为 [40214461143](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/40214461143)，其 DMG SHA-256 06324eb0cec1c3b00ab4824863907b61b44ef78e84e3c982052db07decb722e2，不作为正式修复分发。该候选曾安装，用户确认无效后已由容器访问版本替换。

真实链路验证以最后一节为准；不能仅凭构建、版本号、合成渲染或时间线接收成功宣称修复完成。

## 容器修复候选记录（已由竖排最终产物替换）

- 正式候选源码 `375797b` 的 [完整 Mac 构建 40217140086](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/40217140086)通过：前端 161 项、Rust 208 项、四种组件配置、WidgetBridge 权限分类/恢复/FFI 以及既有原生回归通过。中间 7e66cee 候选构建已取消，不计作通过。
- ZIP SHA-256 `5e65af883f0bfa5854dcbb515fb843692a581c9af010a033645cffc56e413603`，DMG SHA-256 `32affb710e62e621a328eb6458c31e9ca136f33fa250e92195c6e8ee041a44a4`，校验与解压完整性通过。已替换首个无效候选，当前安装 /Applications/Folio.app 2.0.8；身份、架构、元数据和 deep strict 签名通过，17 项当前磁盘文件在替换前后校验一致。早期 34 项及隔离的 28 个旧操作备份仍保留，未上传。
- 本机新日志明确记录 snapshot denied=true / NSCocoaErrorDomain 513，actions denied=true / NSPOSIXErrorDomain 1 (EPERM)，不是仅凭系统发布说明推测。系统设置截图显示 Folio 在文件与文件夹页只有“完全磁盘访问权限”管理项，没有可直接切换的单容器选项。
- 用户已手动移除旧条目，重新添加当前 /Applications/Folio.app 并开启完全磁盘访问，随后反馈“测试正常”。没有自动授予权限或操作系统权限数据库。旧签名授权不匹配是可解释升级问题的因素，但未直接读取 TCC 数据库证明其存储原因。
- 授权后宿主连续 WRITE_OK，扩展连续 READ_OK；Inbox 源文件与快照均为 253 字符，Today 均为 946 字符，两份前 4000 字符逐字一致，待处理操作为 0。真实发布/读取链路恢复且用户确认交互测试正常。没有额外对所有按钮逐项自动点击，没有重启/跨机器/耗电测试。

## 超大竖排尺寸

正式 Release 发布前追加 Apple 的 [systemExtraLargePortrait](https://developer.apple.com/documentation/widgetkit/widgetfamily/systemextralargeportrait) 尺寸。四个编号均支持：macOS 27 使用系统超大竖排单栏，按实际可用高度分页；横向超大继续双栏。页码键包含系统尺寸类型，横竖互不覆盖；内容、字号、复制、展开与待办沿用既有链路。

新尺寸仅在 macOS 27 及以上注册，旧系统继续原有四种尺寸，最低部署版本仍为 macOS 15。构建切换至 GitHub 官方 xcode-27 runner；本地 SDK 26 不支持该符号，不用私有 API 或猜测枚举值绕过。

前述 375797b 为容器修复候选，未正式分发；最终交付采用下方 8e80c46 竖排产物。ad-hoc 身份可能随构建变化，安装后应确认连接状态，必要时由用户重新授权。自动 CI 继续停用，仅手动构建。

### 竖排候选构建与安装

- 源码 `8e80c46474e308287276f99ecaf57e5ea75d268c` 的 [Xcode 27.1 完整构建 40219293040](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/40219293040) 成功。前端 161 项、Rust 208 项及原生回归通过，四个 WidgetKit 配置构造成功，macOS 27 新尺寸注册断言通过。
- Artifact ZIP SHA-256 `2acfa0c2c0e4a8ec5c2567fb4792361baef086fabe9edea311005a05ee07e29e`；DMG SHA-256 `a27dc0b61cbc93bf62a6b58eddfb57eec55b0d7346c44c06b297f1f7de387b46`。完整 ZIP/解压与安装包校验通过。
- 已安装到 `/Applications/Folio.app`，主应用 arm64、扩展 arm64/x86_64、Bundle ID、2.0.8 版本、App Intents 元数据及 deep strict 签名检查通过，17 项当前磁盘文件替换前后 SHA-256 一致。此前已授权应用和真实数据均另存本地恢复备份。
- 新签名安装后宿主再次出现容器写入失败，用户已手动重新授权。当前正常启动宿主 WRITE_OK、扩展 READ_OK，容器方向恢复。

### 竖排尺寸登记恢复

用户重新授权后，正常启动宿主出现 WRITE_OK，扩展出现 READ_OK，容器方向恢复。但用户反馈图库没有竖排尺寸。检查发现已安装 Mach-O 两种架构均使用 SDK 27.0，系统运行时也通过 macOS 27 availability 判断，chronod 使用的旧描述却仍为 sdkVersion 26.5 且仅四种尺寸。候选包均为 2.0.8，单凭同版本覆盖不能保证描述刷新。

先备份笺影自身的 chrono 缓存，仅重新登记 `/Applications/Folio.app` 及其扩展，不删除系统全局小组件数据库、不改签、不再安装。随后 chronod 日志明确显示 sdkVersion 27.0，四个编号的 supportedFamilies 均包含 systemExtraLargePortrait 的五种尺寸。用户重开图库后确认“现在有竖排了”。

## 最终交付与验证边界

交付已安装并重新授权的 8e80c46 原始产物，不重新构建或改签。发布地址：[mac-v2.0.8](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/tag/mac-v2.0.8)，安装包、校验值和验证元数据随 Release 提供。主应用最低 macOS 15；竖排尺寸需要 macOS 27；ad-hoc 未公证，有限分发仍可能需要用户重新授权。

已验证完整构建、签名与身份、数据保留、授权后快照读写、五尺寸系统登记；用户确认容器修复候选交互正常及最终竖排入口出现。最终竖排的逐按钮交互、全文排版、睡眠唤醒、重启后授权、旧系统及跨机器分发尚未逐项人工验收；没有进行性能或能耗测量。不把尺寸入口确认扩大为所有视觉与长期场景已验证。
