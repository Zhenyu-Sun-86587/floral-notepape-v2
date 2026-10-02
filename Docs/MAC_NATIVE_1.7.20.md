# Mac 1.7.20：原生胶囊与便签窗口外层

胶囊改用 AppKit NSPanel、NSButton、NSScrollView 与系统玻璃容器，不再为每组胶囊创建 WebView。删除 Mac 的 React Rail/HoverIntent；Windows 胶囊、CSS 与旧预览保持原实现。

便签采用原生标题栏和 SF Symbols 工具按钮，标题不可选且可以拖动窗口。正文仍使用透明 WebView，保留 Markdown、CodeMirror、中文输入法、公式、任务和外部文件保存管线。编辑状态下的标题输入框仍能选择文字。

## 材质与交接

- 设置分别调节主界面、便签、胶囊与预览，液态玻璃浓度和磨砂不透明度独立保存。数值越低越通透，文字保持不透明。玻璃浓度调节背景扩散与着色，不等同于整窗 alpha；0% 仍有系统折射。
- 使用 NSGlassEffectView.contentView 承载整窗内容，切换材质时先清除旧视图的所有权。窗口复用和尺寸变化同步完整材质几何，避免分离后预览只剩头尾与正文条带。
- 附近胶囊组的融合/分离使用临时原生玻璃容器和 NSAnimationContext，完成后交还真实窗口。动画不接收鼠标，关闭或再次交接会取消旧动画；系统减少动态效果时不播放。最多 12 个成员、640 点局部范围，超出范围直接交接，避免全屏动画面板。
- 原生胶囊全槽位命中、接受首次鼠标点击；280ms 悬停使用可失效任务，复用/离开/拖动取消旧任务。超容量组使用原生滚动。
- macOS 代码通过 Rust cfg 和前端目标模块选择；macOS 26 使用液态玻璃，旧系统回退磨砂，减少透明度时使用实色。

## 基础验证

Mac app/DMG 构建通过。Rust 定向检查：胶囊 16 项、Mac 配置 2 项、融合成员计算 2 项；Mac 预览 2 项通过。前端 lint 与 Windows 目标前端构建通过，Windows 原胶囊三个前端文件及 legacy 预览与上一提交一致。未进行 Windows 原生编译或性能基准测量。

隔离测试数据检查：原生胶囊 AX 树没有 HTML 内容；单次点击展开；原生工具栏编辑/保存切换成功；锁定后正文禁用，点击原位置解锁后正文和工具按钮恢复。标题栏和正文分别出现在原生控件与 HTML AX 树中。

## 人工验收

1. 把多个胶囊合并，再单独拖出，悬停每个成员；预览背景应连续，快速移入移出没有旧内容残留，单击一次即可展开。检查顶部、左右边缘与超容量滚动。
2. 在设置中切换液态玻璃/磨砂，分别改变三组数值并重启；确认已打开窗口同步变化，两个模式各自记住数值。
3. 拖动原生标题栏、选择正文、编辑标题、保存，测试锁定鼠标穿透与原位解锁。用中文输入法和外部 Markdown 验证保存。
4. 检查合并/分离动画、跨桌面及其他应用全屏空间。真实悬停体验、桌面壁纸上的通透度和水滴动画仍需人工验收；基础检查不代表视觉验收完成。

参考：[Apple NSGlassEffectView](https://developer.apple.com/documentation/appkit/nsglasseffectview)、[NSGlassEffectContainerView](https://developer.apple.com/documentation/appkit/nsglasseffectcontainerview)、[WWDC25 AppKit](https://developer.apple.com/videos/play/wwdc2025/310/)。
