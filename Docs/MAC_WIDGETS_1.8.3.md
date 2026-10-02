# 笺影 Mac 1.8.3：缩放修复与 WidgetKit 接入

## 已完成与当前限制

便签正文通过 AppKit Auto Layout 保留48pt标题区，避免 Wry 的缩放回调将正文重新铺满窗口。保留原 Wry/WebView 父视图、编辑器和响应链；Windows 布局不改。

原生小组件代码独立位于 `src-tauri/native/widgets/`，提供小、中、大、特大系统尺寸，桌面与通知中心共用 WidgetKit。系统管理背景、尺寸和玻璃/着色外观；不做自定义屏幕捕获。小组件不能直接输入正文或任意拉伸；点击通过经过UUID校验的 `folio://note/...` 或 `folio://linked/...` 打开对应便签。正文展示基础 Markdown 行与行内样式，公式、Mermaid、HTML和图片仍需在便签查看。

**公开的普通1.8.3安装包尚未包含可加载的小组件扩展。** 另有本机个人开发签名测试版：扩展由 GitHub Actions 编译，本机免费 Apple Development 身份签名，已确认 App Group 读写、系统添加及桌面占位内容渲染；选择笔记、刷新和点击打开仍待人工检查。配置文件绑定本机且只有7天有效期，不作为通用分发包。具体流程见 [免费签名实验](MAC_WIDGETS_FREE_SIGNING.md)。

2026-10-03 已实际运行 [GitHub Actions 构建检查](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/37037576845)：macOS runner使用Xcode26.6，56秒完成构建，生成包含arm64/x86_64的`FolioWidgets.appex`，`Metadata.appintents/extract.actionsdata`中存在SelectNote配置元数据。产物已下载并核对扩展点`com.apple.widgetkit-extension`。二进制只有linker临时签名，TeamIdentifier未设置，Info.plist未绑定；本机与runner均有0个有效签名身份。这证明完整Xcode无需安装在本机，但不能证明免费Personal Team签名、App Group访问或小组件系统加载成功。

工作流位于`.github/workflows/macos-widget-check.yml`，只读仓库权限，不使用签名Secrets。运行`python3 scripts/build-macos-widgets.py --compile-only`可生成构建检查产物和`BUILD_REPORT.json`；该产物本身不作为可安装包发布。测试版通过 `--prebuilt-extension` 使用匹配版本的云端扩展，再在本机嵌入配置文件并签名，无需在本机安装完整 Xcode。

## 数据与性能

小组件正文现按原生文本布局分页，支持标题、粗体/斜体/行内代码、无序/有序列表、任务标记、引用、分隔线和围栏代码块。长段落按字符边界分片，避免截断后无法查看；原生 AppIntent 按钮切换上一页/下一页，不启动主应用。页码按笔记和系统尺寸保存，同一笔记同一尺寸的多个小组件共享页码。公式、HTML、图片和复杂表格仍需打开便签查看。

WidgetKit没有任意比例的竖向长条尺寸；中号是横向矩形，大号是方形，特大号由系统决定是否提供。不能将系统中号描述为竖长条。竖向长条需另行使用可自由缩放的桌面层便签，无法作为自定义WidgetFamily加入系统图库。

只有用户在 Mac 设置中明确选择的便签进入 App Group，内部笔记与绑定外部文件均可选择，最多32张。每张快照最多4000个字符；完整原文仍在原存储中。快照为只读，使用原子替换；移除选择或删除笔记会更新快照。普通安装包缺少扩展或 App Group 时不导出笔记。

主应用监听既有笔记/外部内容变化事件，500ms合并；相同快照不重复写入或刷新。WidgetKit使用`.never`时间线，实际刷新由系统调度；没有持续轮询、动画或桌面捕获。不得承诺保存后立即刷新。小组件背景使用系统容器，不受应用自定义玻璃浓度控制。

## 原生签名构建

需要完整Xcode作为active developer directory，以及主应用和扩展共用的有效Apple签名身份/Team。App Group使用macOS支持的`TEAMID.dev.hermes.surface.widgets`形式；脚本给主应用和扩展配置相同容器。无需把原笔记目录迁入沙盒。

先构建普通应用，再执行：

```sh
npm run tauri build -- --config src-tauri/tauri.macos.conf.json --bundles app
python3 scripts/build-macos-widgets.py \
  --app src-tauri/target/release/bundle/macos/Folio.app \
  --team YOURTEAMID \
  --identity 'Apple Development: Your Name (YOURTEAMID)'
```

脚本通过Xcode编译App Intents元数据，验证扩展签名、嵌入`Contents/PlugIns/FolioWidgets.appex`，并重新签名宿主。不采用临时签名假装可用，不修改用户Keychain、权限或后台登记库。必须用签名后的app重新制作安装包，不能复用签名前的DMG。分发签名、公证及不同Mac验收另行完成。

## 检查

基础：Rust编译、Swift扩展/桥接类型检查；原生WKWebView在三种尺寸下模拟Wry覆盖frame，正文保持标题下方；URL入口拒绝路径穿越与其他scheme。前端Mac/Windows构建和lint。

人工：普通便签/写作窗口反复缩放，阅读/编辑、玻璃/磨砂/关闭材质、锁定、胶囊与多Space；签名扩展可用后检查桌面/通知中心的小组件列表、每个尺寸、选择不同便签、删除与撤销授权、点开内部及外部便签、关闭主应用后快照显示、系统玻璃/着色模式及隐私遮挡。
