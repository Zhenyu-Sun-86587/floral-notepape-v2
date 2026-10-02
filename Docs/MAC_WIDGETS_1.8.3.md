# 笺影 Mac 1.8.3：缩放修复与 WidgetKit 接入

## 已完成与当前限制

便签正文通过 AppKit Auto Layout 保留48pt标题区，避免 Wry 的缩放回调将正文重新铺满窗口。保留原 Wry/WebView 父视图、编辑器和响应链；Windows 布局不改。

原生小组件代码独立位于 `src-tauri/native/widgets/`，提供小、中、大、特大系统尺寸，桌面与通知中心共用 WidgetKit。系统管理背景、尺寸和玻璃/着色外观；不做自定义屏幕捕获。小组件不能直接输入正文或任意拉伸；点击通过经过UUID校验的 `folio://note/...` 或 `folio://linked/...` 打开对应便签。正文展示基础 Markdown 行与行内样式，公式、Mermaid、HTML和图片仍需在便签查看。

**普通1.8.3安装包尚未包含可加载的小组件扩展。** 本机构建环境只有 Command Line Tools，无 Xcode 的 `appintentsmetadataprocessor`，也没有 Apple 签名身份。Swift扩展和桥接完成类型检查；真正的 WidgetKit 扩展构建、签名、系统加载及交互仍待这些条件补齐。设置明确显示不可用，不提供无效启用开关。不能把类型检查通过当作系统小组件验收通过。

## 数据与性能

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
