# Mac 1.7.18：独立胶囊系统

重做 Mac 胶囊呈现与悬停生命周期，保留既有便签、收纳位置、独立颜色和拖动协议。Windows 使用原胶囊组件、样式与预览运行时，不迁移这次设计。

## 设计与模块边界

- `src/platform/macos/capsules/`：独立 Rail、Preview、预览控制器、HoverIntent 与样式；`#platform-capsules` 在构建时选择平台入口。Windows 入口仍导出旧 CapsuleRail、CapsulePreview 与 capsule.css，原三个文件未改动。
- `src-tauri/src/macos_capsule.rs`：AppKit 主线程安装玻璃宿主与鼠标事件监视器。macOS 26 使用公开的 NSGlassEffectView Clear 样式；较旧系统使用 NSVisualEffectView，系统开启“减少透明度”时使用实色呈现。每组仅一层原生材质，按钮不各自创建模糊层，也不使用 CSS backdrop-filter。
- 玻璃外层使用独立、透明的 NSView 圆角裁切容器。NSGlassEffectView 自身的层掩码可能在尺寸更新时重置，不能负责无边框窗口的最终轮廓。玻璃没有固定绿色染色；焦点轮廓改为细中性亮边。便签图标使用中性色和细阴影，背景决定玻璃色调。
- Mac 逻辑尺寸为 cross 36、slot 48、group grip 20；Windows 保持 18/44/14。沿用原布局 solver 和原生拖动，跨桌面开关与 NSPanel 全屏层级继续有效。
- 后端 `desktop/capsule_preview_macos.rs` 独立负责 Mac 悬停状态、会话代次、预览布局与显示。非 Mac 的旧实现搬入 `capsule_preview_legacy.rs`，维持原算法。窗口材料命令及原生模块仅在 `cfg(target_os = "macos")` 下编译。

## 悬停与性能

停留 280ms 后才读取正文。前端串行提交同一 rail 的 enter/leave，并丢弃已离开 owner 的异步结果。预览呈现依赖 Markdown DOM commit 与材料安装完成，不等待隐藏 WKWebView 的 requestAnimationFrame。新代次不能被旧关闭/显示通知覆盖。

预览退出时保留至多一份 Markdown DOM，隐藏期间不刷新正文；再次打开重新取得当前源文，同文复用 memo 渲染。保留任务勾选及 revision 冲突检查、文本选择/复制、展开与编辑操作。

Mac 移除 150ms 固定轮询；AppKit local/global 鼠标事件和 occupancy 变化触发合并后的 native check，离开两窗后使用 550ms 宽限期穿过间隙。静止且位于预览/胶囊内时不持续查询窗口。高频鼠标事件共用一个待检查定时器；正文通知也合并为一个胶囊同步 worker。原来已有的屏幕几何变化检查保留。

## 参考

采用平台公开 API 和独立实现，未引入第三方产品资源。

- [Apple NSGlassEffectView](https://developer.apple.com/documentation/appkit/nsglasseffectview)：原生动态玻璃与 contentView 的正确层级。
- [Apple Clear 样式](https://developer.apple.com/documentation/appkit/nsglasseffectview/style-swift.enum/clear)：更通透的材质方向。
- [Dropover 5.1](https://dropoverapp.com/whats-new/5.1.0.html)：克制的玻璃、较宽松尺寸与一致的详情视图。
- [FinderHover 原生窗口实现](https://github.com/KoukeNeko/FinderHover/blob/main/FinderHover/UI/Windows/HoverWindow.swift)：外部透明裁切容器解决玻璃窗口矩形底层的思路。

用户提供的控制中心参考图决定最终方向：透背景、薄亮边、取消绿色粗描边；便签正文使用较实的阅读区域以保证长文可读。

## 基础检查与人工验收

基础范围：Mac 前端 lint/TS/build、5 个悬停/预览生命周期测试、16 个 Rust capsule 定向测试、Mac app/DMG 构建、隔离临时数据的原生窗口检查。Windows 前端构建确认不含 Mac 胶囊符号，原三份 Windows 胶囊文件逐字节核对未变。没有 Windows 原生运行环境，未声称完成 Windows 安装包或 GUI 测试。

真实交互、材质观感与跨 Spaces 的人工验收仍由用户完成：

1. 在浅色/深色壁纸上看左右/顶部胶囊：无矩形底层、无绿色粗框，图标可辨；同组最后一个胶囊不截断。
2. 快速掠过不开预览；停留后立即显示 Markdown；连续换便签不显示旧标题/正文；移到预览能滚动和复制，离开后能消失。
3. 在预览勾选任务、展开、编辑、关闭；长文滚动到底后检查末尾任务写回；外部文件变化或冲突时不覆盖源文件。
4. 单击展开/收回，拖动单个和整组，更换左/右/顶部边缘；原收纳位置重启后保持。
5. 分别切换“胶囊跨桌面”开关，切换桌面和其他应用原生全屏；便签的独立开关继续单独生效。
6. 长时间停留/离开与快速往返观察卡顿。这里没有做受控性能基准，不提供百分比提升结论。

安装与测试使用隔离目录，不改用户笔记。发布仍为未公证的 arm64 开发包。
