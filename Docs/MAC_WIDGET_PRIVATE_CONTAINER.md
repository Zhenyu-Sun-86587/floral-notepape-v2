# macOS WidgetKit 私有容器实验

实验分支：`codex/macos-widget-private-container`，版本：1.8.7。

## 目的与隔离

验证真正的 WidgetKit 小组件能否使用本地 ad-hoc 签名，在没有 Apple 账号签名、App Group 和开发描述文件的情况下，由真实主程序直接发布便签快照到扩展的私有沙盒。

- 主程序：`dev.folio.surface.containerexperiment`，安装为 `FolioPrivate.app`。
- 小组件：`dev.folio.surface.containerexperiment.widgets`。
- 主程序配置/笔记：`~/Library/Application Support/FolioWidgetExperiment/config` 与 `data`。构建开关固定独立默认目录，Finder 启动同样生效。
- 小组件使用系统创建的私有容器，在其 `Library/Application Support/FolioWidgets/notes.json` 读取快照。
- 主程序不创建假的容器根目录，只写系统已经建立的容器内的专用快照目录。
- 分页状态使用扩展自己的 `UserDefaults.standard`。
- 实验展开链接使用 `folio-private://widget-open/...`，避免接管正式版的 `folio` 链接。
- 正常构建继续使用原来的 App Group 路径；Windows 功能不变。

macOS 对其他应用容器的访问有单独保护。数据写入成功、扩展登记成功、小组件实际显示和按钮执行成功必须分别记录，不能互相替代。

## 构建

`.github/workflows/macos-widget-private-container.yml` 在 GitHub 的 `macos-26` runner 使用完整 Xcode 构建主程序、扩展和 App Intents 元数据。本机不需要安装完整 Xcode。

主程序构建指定 `FOLIO_WIDGET_CONTAINER_EXPERIMENT=1` 和 `src-tauri/tauri.widget-experiment.conf.json`。`scripts/build-private-container-widgets.py` 只接受这个实验 Bundle ID，并嵌入同版本的 CI 扩展。扩展只保留 `com.apple.security.app-sandbox` entitlement，主程序与扩展均重新进行 ad-hoc 签名，不包含开发描述文件。

实验包为 `FolioPrivate_1.8.7_aarch64.dmg`，不能凭构建检查宣称可长期使用或可稳定分发。

## 验证口径

1. 安装云端产物并启动真正的主程序，检查实际配置/数据路径。
2. 从主程序已有的虚构便签发布快照，核对容器内容和原笔记是否一致。
3. 系统图库能找到实验小组件，扩展由 `chronod` 启动，能够实际读取快照。
4. 小组件展示 Markdown、复制文字、翻页、显式展开；记录每项结果。
5. 主程序退出后保留展示；重新启动或修改便签后刷新。
6. 检查主程序和扩展没有 App Group、Team Identifier 或开发描述文件，并核对正式笔记哈希。

实验日志仅在私有容器模式记录快照字节数、便签数量和 Bundle ID，不输出便签正文。

## 当前结果

2026-10-03，本机完整主程序端到端实验通过；用户反馈小组件人工测试没有问题。

- [GitHub Actions 构建 37101542979](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/37101542979) 成功，产物代码版本 `7f3fa76`，使用完整 Xcode 构建主程序、扩展和 App Intents 元数据。
- 安装 `/Applications/FolioPrivate.app` 1.8.7。主程序与扩展均为 ad-hoc 签名，`TeamIdentifier` 未设置，没有 App Group 或开发描述文件。
- 真正主程序成功将虚构便签快照写入系统建立的扩展容器。通过主程序界面修改标题后，保存数据与快照同步更新；扩展日志确认 `READ_OK`。
- `chronod` 成功生成并接收 `systemLarge` 小组件时间线，图库实际加载了实验扩展。
- 翻页 App Intent 实际执行，扩展私有偏好中的分页索引发生更新；复制正文及复制便签 App Intent 均有执行完成日志。按钮与展示由用户人工测试确认。
- 正式版 `/Applications/Folio.app` 1.8.6 保留，正式笔记文件哈希未变化。实验笔记使用独立数据目录。
- 安装包通过 Clash `127.0.0.1:7890` 下载，压缩包和 DMG 完整性校验通过。DMG SHA-256：`60d81da716f8a98cc21811c2bc82ab70a0a8839c4694d18c0b05cb5136e52540`。

结论：本机已验证“真实主程序直写扩展私有容器 + ad-hoc 签名 + 无 App Group/开发描述文件”的基本运行及交互链路。该实验不依赖七天开发描述文件；重启、升级后容器访问授权及其他电脑分发仍未验证，不应将本机通过推广为所有 macOS 环境保证。保留独立实验分支，尚未合并到正式构建。

早期独立探针曾使用普通 Swift 可执行文件入口，系统查询扩展时退出，图库无法展示。检查完整 Xcode 的链接命令后发现扩展需要标准 `_NSExtensionMain` 入口；这不构成“系统拒绝 ad-hoc 小组件”的结论。正式实验改由完整 Xcode 构建真实主程序和扩展。

## 官方依据

- [macOS App Sandbox 文件访问与容器保护](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)
- [TN3125：macOS 的 unrestricted entitlements 与描述文件](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)
- [WidgetKit 扩展创建与首次启动要求](https://developer.apple.com/documentation/widgetkit/creating-a-widget-extension)
