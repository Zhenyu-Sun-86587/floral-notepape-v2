# Mac 1.7.19：整窗材质与胶囊首次交互

本轮按用户控制中心参考图调整：胶囊取消 CSS 实线描边、双重白环和拖动区焦点白框。预览正文取消独立的白色卡片；主窗口、独立便签、胶囊和预览共用整窗原生材质。原生玻璃自身会随背景产生光泽，效果由系统绘制，不使用 CSS 白线模拟。

## 实现

- 新增 Mac 独立 `macos_material` 宿主，保留原 Tao/Wry 内容视图和响应链。液态玻璃使用 macOS 26 的 NSGlassEffectView Clear，搭配 BehindWindow 背景采样；磨砂使用 NSVisualEffectView。旧版 macOS 自动使用磨砂，系统“减少透明度”使用实色。
- 设置 → 外观添加“Mac 原生材质”和“Mac 材质效果：液态玻璃 / 磨砂”。旧 Mac 配置缺少这两项时默认启用液态玻璃。整窗正文覆盖层保持轻薄透明，文字与编辑仍为正常 DOM。
- 同一窗口材质/圆角未变时复用宿主，不重复重建。切换模式只替换正文下方的材质视图，正文留在固定容器中，不重载或重新挂载 WebView。
- Mac 胶囊、预览和便签开启 accept_first_mouse，避免非活动 WebView 吞掉首次点击。存在收纳便签时预热一个隐藏预览窗口；预览 DOM 提交后直接呈现，不等待隐藏 WebView 的动画帧。
- 同一胶囊的 pointerenter 和 focus 共享一次悬停请求；旧焦点的 blur 不再取消新胶囊的悬停。
- Rust 使用 cfg(macOS)，前端使用目标构建别名选择材质与设置。Windows 的原胶囊、预览、CSS、后端预览算法保持原样，Acrylic 路径保留。

参考：[Apple NSGlassEffectView](https://developer.apple.com/documentation/appkit/nsglasseffectview)、[Apple BehindWindow](https://developer.apple.com/documentation/appkit/nsvisualeffectview/blendingmode-swift.enum/behindwindow)、[Tauri accept_first_mouse](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html)。

## 基础验证与人工检查

已执行前端 lint、TypeScript/Mac 构建、Windows 前端构建、7 个悬停/预览测试、16 个 Rust capsule 定向测试、1 个 Mac 配置迁移/往返测试和 app/DMG 构建。隔离临时数据完成单击展开、Markdown 内容检查及液态玻璃/磨砂双向切换，确认正文与设置保留。冷启动真实鼠标悬停和桌面材质观感仍留给人工验收。Windows 原生运行和实际性能基准未测试。

人工重点：

1. 冷启动后第一次悬停即有预览，第一次单击即展开；切到其他应用后重复检查。
2. 快速换胶囊、移入预览、滚动和离开，检查旧内容与意外关闭。
3. 左右与顶部胶囊均无白色实线描边、无顶部白框；浅深壁纸下检查通透程度和文字可读性。
4. 预览与独立便签从标题到正文共享透明背景，没有内层白色卡片。
5. 外观切换液态玻璃/磨砂并保存，主窗口、便签、胶囊、预览同步变化；重启保留设置。
6. 跨桌面/全屏、锁定解锁、Markdown 任务勾选和编辑仍正常。

观感由系统材质、壁纸、辅助功能和窗口层级共同影响，最终视觉验收由用户完成。
